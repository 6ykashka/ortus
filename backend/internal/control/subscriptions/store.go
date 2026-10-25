package subscriptions

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
)

// Store is the subscription of tenants in the control DB (role ortus_api: DML).
type Store struct {
	DB  *sql.DB
	Now func() time.Time // the clock of the application; nil — time.Now
}

func (s Store) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

// queryer is a *sql.DB or *sql.Tx.
type queryer interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

const tenantSQL = `
select t.state::text, t.state_changed_at,
       coalesce((select a.details->>'planKey' from platform_audit a
                  where a.action = 'tenant.create' and a.target_id = t.id order by a.id limit 1), '')
  from tenants t
 where t.id = $1`

func loadTenant(ctx context.Context, q queryer, id uuid.UUID, lock string) (Tenant, error) {
	t := Tenant{ID: id}
	err := q.QueryRowContext(ctx, tenantSQL+lock, id).Scan(&t.State, &t.StateChangedAt, &t.PlanKey)
	if errors.Is(err, sql.ErrNoRows) {
		return Tenant{}, ErrUnknownTenant
	}
	if err != nil {
		return Tenant{}, fmt.Errorf("subscriptions: tenant: %w", err)
	}
	return t, nil
}

// row is the stored subscription of a tenant.
type row struct {
	id uuid.UUID
	ok bool
}

const subscriptionSQL = `
select id, plan_code, state, upper(period), term_months, price_version, amount_minor from subscriptions
 where tenant_id = $1 order by created_at desc, id desc limit 1`

// The current entitlements are the rows of the greatest version of the tenant that have not expired.
const entitlementsSQL = `
with v as (select max(version) as version from entitlements where tenant_id = $1)
select e.feature_key, e.source_type, coalesce(e.source_ref, ''), coalesce(e.limit_value, 0), upper(e.effective), v.version
  from v left join entitlements e
    on e.tenant_id = $1 and e.version = v.version and (upper(e.effective) is null or upper(e.effective) > $2)
 order by case e.feature_key when 'seats' then 0 when 'storage_quota_bytes' then 1 else 2 end, e.feature_key`

// stored state ↔ contract status (control 0001: subscriptions.state trial | active | grace | ended).
var (
	statusOf = map[string]string{stateTrial: StatusTrialing, stateActive: StatusActive, stateGrace: StatusGrace, "ended": StatusReadOnly}
	stateOf  = map[string]string{StatusTrialing: stateTrial, StatusActive: stateActive, StatusGrace: stateGrace, StatusReadOnly: "ended"}
)

// current reads the subscription of t (derived when there is no row).
func (s Store) current(ctx context.Context, q queryer, t Tenant) (Subscription, row, error) {
	var (
		r             row
		plan, st      string
		end           sql.NullTime
		term, version sql.NullInt64
		amount        sql.NullInt64
	)
	err := q.QueryRowContext(ctx, subscriptionSQL, t.ID).Scan(&r.id, &plan, &st, &end, &term, &version, &amount)
	if errors.Is(err, sql.ErrNoRows) {
		return Derive(t), row{}, nil
	}
	if err != nil {
		return Subscription{}, row{}, fmt.Errorf("subscriptions: read: %w", err)
	}
	r.ok = true
	sub := Subscription{TenantID: t.ID, PlanKey: plan, Status: statusOf[st], Stored: true, Revision: 1}
	if term.Valid {
		sub.TermMonths = new(int(term.Int64))
	}
	if version.Valid {
		sub.PriceVersion = new(int(version.Int64))
	}
	if amount.Valid {
		sub.AmountMinor = new(amount.Int64)
	}
	if end.Valid {
		e := end.Time.UTC()
		switch sub.Status {
		case StatusTrialing:
			sub.TrialEndsAt = &e
		case StatusActive:
			sub.PeriodEndsAt = &e
		case StatusGrace:
			sub.GraceEndsAt = &e
		}
	}
	if sub.Entitlements, sub.Revision, err = s.entitlements(ctx, q, t.ID); err != nil {
		return Subscription{}, row{}, err
	}
	return sub, r, nil
}

func (s Store) entitlements(ctx context.Context, q queryer, tenantID uuid.UUID) ([]Entitlement, int64, error) {
	rows, err := q.QueryContext(ctx, entitlementsSQL, tenantID, s.now())
	if err != nil {
		return nil, 0, fmt.Errorf("subscriptions: entitlements: %w", err)
	}
	defer rows.Close()
	out, revision := []Entitlement{}, int64(1)
	for rows.Next() {
		var (
			key, source, ref sql.NullString
			value            sql.NullInt64
			until            sql.NullTime
			version          sql.NullInt64
		)
		if err := rows.Scan(&key, &source, &ref, &value, &until, &version); err != nil {
			return nil, 0, fmt.Errorf("subscriptions: entitlements: %w", err)
		}
		if version.Valid {
			revision = version.Int64
		}
		if !key.Valid {
			continue
		}
		e := Entitlement{Key: key.String, SourceType: source.String, SourceRef: ref.String, Value: value.Int64}
		if until.Valid {
			e.ValidUntil = new(until.Time.UTC())
		}
		out = append(out, e)
	}
	return out, revision, rows.Err()
}

// Current returns the subscription of a tenant (derived when there is no row); ErrUnknownTenant.
func (s Store) Current(ctx context.Context, tenantID uuid.UUID) (Subscription, error) {
	t, err := loadTenant(ctx, s.DB, tenantID, "")
	if err != nil {
		return Subscription{}, err
	}
	sub, _, err := s.current(ctx, s.DB, t)
	return sub, err
}

// followed are the tenant states that follow the subscription; suspended, provisioning, closing and closed are
// decided by operators and the provisioner (W1.02, W1.11).
var followed = map[string]bool{stateTrial: true, stateActive: true, stateGrace: true, stateReadOnly: true}

// write stores next as the subscription of t (since: the start of its period), its entitlements as version
// next.Revision and the tenant state it leads to; it returns the id of the subscription row it wrote (r.id, or the
// inserted one when t had none).
func (s Store) write(ctx context.Context, tx *sql.Tx, t Tenant, r row, next Subscription, since time.Time, reason string, actor uuid.UUID) (uuid.UUID, error) {
	end := periodEnd(next)
	if end != nil && end.Before(since) {
		since = *end
	}
	id := r.id
	var err error
	if r.ok {
		_, err = tx.ExecContext(ctx, `update subscriptions set plan_code = $2, state = $3, period = tstzrange($4, $5, '[]') where id = $1`,
			r.id, next.PlanKey, stateOf[next.Status], since, end)
	} else {
		err = tx.QueryRowContext(ctx, `insert into subscriptions (tenant_id, plan_code, state, period) values ($1, $2, $3, tstzrange($4, $5, '[]'))
 returning id`, t.ID, next.PlanKey, stateOf[next.Status], since, end).Scan(&id)
	}
	if err != nil {
		return uuid.Nil, fmt.Errorf("subscriptions: write: %w", err)
	}
	now := s.now()
	if err := writeEntitlements(ctx, tx, t.ID, next, now, reason, actor); err != nil {
		return uuid.Nil, err
	}
	if st := TenantStateFor(next.Status); followed[t.State] && st != t.State {
		if _, err := tx.ExecContext(ctx, `update tenants set state = $2::tenant_state, state_changed_at = $3,
			revision = revision + 1 where id = $1`, t.ID, st, now); err != nil {
			return uuid.Nil, fmt.Errorf("subscriptions: tenant state: %w", err)
		}
	}
	return id, nil
}

// periodEnd is the end of the period the stored state of s covers (upper(period); nil — open).
func periodEnd(s Subscription) *time.Time {
	switch s.Status {
	case StatusTrialing:
		return s.TrialEndsAt
	case StatusActive:
		return s.PeriodEndsAt
	case StatusGrace:
		return s.GraceEndsAt
	}
	return nil
}

// writeEntitlements inserts the entitlements of next as version next.Revision.
func writeEntitlements(ctx context.Context, tx *sql.Tx, tenantID uuid.UUID, next Subscription, now time.Time, reason string, actor uuid.UUID) error {
	for _, e := range next.Entitlements {
		from := now
		if e.ValidUntil != nil && e.ValidUntil.Before(from) {
			from = *e.ValidUntil
		}
		if _, err := tx.ExecContext(ctx, `
insert into entitlements (tenant_id, feature_key, source_type, source_ref, limit_value, limit_unit, effective, version, reason, actor_id)
values ($1, $2, $3, nullif($4, ''), $5, $6, tstzrange($7, $8, '[]'), $9, $10, $11)`,
			tenantID, e.Key, e.SourceType, e.SourceRef, e.Value, limitUnit(e.Key), from, e.ValidUntil, next.Revision, reason, actor); err != nil {
			return fmt.Errorf("subscriptions: entitlement %s: %w", e.Key, err)
		}
	}
	return nil
}

func limitUnit(key string) any {
	switch {
	case key == KeySeats:
		return "seats"
	case strings.HasSuffix(key, "_bytes"):
		return "bytes"
	}
	return nil
}

// audit inserts a platform_audit row of the subscription of tenantID.
func audit(ctx context.Context, tx *sql.Tx, kind string, actor *uuid.UUID, action string, tenantID uuid.UUID, reason, reqID string, details map[string]string) error {
	raw, err := json.Marshal(details)
	if err != nil {
		return fmt.Errorf("subscriptions: audit: %w", err)
	}
	_, err = tx.ExecContext(ctx, `insert into platform_audit (actor_kind, actor_id, action, target_type, target_id, reason, result,
		request_id, details) values ($1, $2, $3, 'subscription', $4, nullif($5, ''), 'ok', $6, $7::jsonb)`,
		kind, actor, action, tenantID, reason, reqID, string(raw))
	if err != nil {
		return fmt.Errorf("subscriptions: audit: %w", err)
	}
	return nil
}

func stamp(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

// Update applies the change of an operator at revision ifMatch: subscription, entitlements, tenants.state (unless
// the tenant is suspended, provisioning, closing or closed) and platform_audit, in one transaction.
func (s Store) Update(ctx context.Context, tenantID uuid.UUID, u Update, ifMatch int64, actor uuid.UUID) (Subscription, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Subscription{}, fmt.Errorf("subscriptions: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }() // no-op after Commit
	t, err := loadTenant(ctx, tx, tenantID, " for update of t")
	if err != nil {
		return Subscription{}, err
	}
	cur, r, err := s.current(ctx, tx, t)
	if err != nil {
		return Subscription{}, err
	}
	if err := Validate(u, cur); err != nil {
		return Subscription{}, err
	}
	if ifMatch != cur.Revision {
		return Subscription{}, ErrRevision
	}
	plan, err := planHistory(ctx, tx, tenantID)
	if err != nil {
		return Subscription{}, err
	}
	next := s.applied(u, cur, plan)
	if _, err := s.write(ctx, tx, t, r, next, s.now(), u.Reason, actor); err != nil {
		return Subscription{}, err
	}
	reqID := requestid.FromContext(ctx)
	if reqID == "" {
		reqID = "subscriptions:" + uuid.NewString()
	}
	if err := audit(ctx, tx, "operator", &actor, ActionUpdated, tenantID, u.Reason, reqID, UpdateDetails(cur, next)); err != nil {
		return Subscription{}, err
	}
	if err := tx.Commit(); err != nil {
		return Subscription{}, fmt.Errorf("subscriptions: commit: %w", err)
	}
	return next, nil
}

// planHistorySQL: the latest entitlement of each key that does not come from an operator (plan, trial, addon).
const planHistorySQL = `
select distinct on (feature_key) feature_key, source_type, coalesce(source_ref, ''), coalesce(limit_value, 0)
  from entitlements where tenant_id = $1 and source_type <> 'manual'
 order by feature_key, version desc`

// planHistory returns the plan entitlements of a tenant by key; a manual entitlement hides the plan one of its key
// only while it is set (unique (tenant_id, feature_key, version) of control 0001 keeps one value per version).
func planHistory(ctx context.Context, q queryer, tenantID uuid.UUID) (map[string]Entitlement, error) {
	rows, err := q.QueryContext(ctx, planHistorySQL, tenantID)
	if err != nil {
		return nil, fmt.Errorf("subscriptions: plan entitlements: %w", err)
	}
	defer rows.Close()
	out := map[string]Entitlement{}
	for rows.Next() {
		var e Entitlement
		if err := rows.Scan(&e.Key, &e.SourceType, &e.SourceRef, &e.Value); err != nil {
			return nil, fmt.Errorf("subscriptions: plan entitlements: %w", err)
		}
		out[e.Key] = e
	}
	return out, rows.Err()
}

// entitlementOrder: seats, the storage quota, then the other keys alphabetically (as entitlementsSQL).
func entitlementOrder(a, b Entitlement) int {
	rank := func(k string) int {
		switch k {
		case KeySeats:
			return 0
		case KeyStorageQuota:
			return 1
		}
		return 2
	}
	if d := rank(a.Key) - rank(b.Key); d != 0 {
		return d
	}
	return strings.Compare(a.Key, b.Key)
}

// applied is cur after the update u. The plan entitlements are kept for the same plan (MSW W0.13) and derived
// from the new plan otherwise, with the storage quota of the plan history; the manual ones of u replace those of
// cur and hide the plan entitlement of the same key.
func (s Store) applied(u Update, cur Subscription, plan map[string]Entitlement) Subscription {
	next := Subscription{TenantID: cur.TenantID, PlanKey: u.PlanKey, Status: u.Status, Stored: true, Revision: cur.Revision + 1}
	s.dates(&next, u, cur)
	next.Entitlements = entitlementsAfter(u, cur, plan)
	return next
}

// dates sets the end of the period of next: the end of trial is kept when u names none, grace lasts GraceDays.
func (s Store) dates(next *Subscription, u Update, cur Subscription) {
	switch u.Status {
	case StatusTrialing:
		next.TrialEndsAt = u.TrialEndsAt
		if next.TrialEndsAt == nil {
			next.TrialEndsAt = cur.TrialEndsAt
		}
	case StatusActive:
		next.PeriodEndsAt = u.PeriodEndsAt
	case StatusGrace:
		next.GraceEndsAt = u.GraceEndsAt
		if next.GraceEndsAt == nil {
			next.GraceEndsAt = new(s.now().Add(GraceDays * oneDay))
		}
	}
}

// entitlementsAfter returns the entitlements after u (see applied).
func entitlementsAfter(u Update, cur Subscription, plan map[string]Entitlement) []Entitlement {
	if len(plan) == 0 { // derived subscription: nothing stored yet
		for _, e := range cur.Entitlements {
			if e.SourceType != SourceManual {
				plan[e.Key] = e
			}
		}
	}
	source := SourcePlan
	if u.Status == StatusTrialing {
		source = SourceTrial
	}
	quota := DefaultQuotaBytes
	if e, ok := plan[KeyStorageQuota]; ok {
		quota = e.Value
	}
	var base []Entitlement
	if u.PlanKey == cur.PlanKey && len(plan) > 0 {
		for _, e := range plan {
			base = append(base, e)
			source = e.SourceType
		}
		// A key hidden by a manual entitlement since the derived trial was never stored: its plan value is the default.
		for _, e := range PlanEntitlements(u.PlanKey, source, quota) {
			if _, ok := plan[e.Key]; !ok {
				base = append(base, e)
			}
		}
	} else {
		base = PlanEntitlements(u.PlanKey, source, quota)
	}
	for _, m := range u.Manual {
		m.SourceType = SourceManual
		base = slices.DeleteFunc(base, func(e Entitlement) bool { return e.Key == m.Key })
		base = append(base, m)
	}
	slices.SortFunc(base, entitlementOrder)
	return base
}

// Advance applies the lifecycle steps due now to every tenant and returns how many steps were applied. A tenant
// locked by another transaction (an operator, another replica) is skipped until the next run.
func (s Store) Advance(ctx context.Context) (int, error) {
	ids, err := s.candidates(ctx)
	if err != nil {
		return 0, err
	}
	run, total := "subscriptions-lifecycle:"+uuid.NewString(), 0
	for _, id := range ids {
		n, err := s.advance(ctx, id, run)
		if err != nil {
			return total, err
		}
		total += n
	}
	return total, nil
}

// candidates are the tenants whose subscription may move: read_only is final, provisioning, closing and closed
// have no lifecycle; a suspended tenant keeps its state, but its subscription moves on.
func (s Store) candidates(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := s.DB.QueryContext(ctx, `select id from tenants where state in ('trial', 'active', 'grace', 'suspended') order by id`)
	if err != nil {
		return nil, fmt.Errorf("subscriptions: lifecycle: %w", err)
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("subscriptions: lifecycle: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (s Store) advance(ctx context.Context, tenantID uuid.UUID, run string) (int, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("subscriptions: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	t, err := loadTenant(ctx, tx, tenantID, " for update of t skip locked")
	if errors.Is(err, ErrUnknownTenant) { // locked now (or gone): the next run takes it
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	cur, r, err := s.current(ctx, tx, t)
	if err != nil {
		return 0, err
	}
	next, steps, since := cur, 0, time.Time{}
	for {
		n, tr, due := Next(next, s.now())
		if !due {
			break
		}
		if err := audit(ctx, tx, "system", nil, tr.Action, tenantID, "", run, map[string]string{
			"fromStatus": tr.From, "toStatus": tr.To, "at": stamp(&tr.At),
		}); err != nil {
			return 0, err
		}
		next, since, steps = n, tr.At, steps+1
	}
	if steps == 0 {
		return 0, nil
	}
	next.Stored, next.Revision = true, cur.Revision+1
	if _, err := s.write(ctx, tx, t, r, next, since, "Жизненный цикл подписки (PLAT-05)", uuid.Nil); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("subscriptions: commit: %w", err)
	}
	return steps, nil
}
