package operators

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/control/subscriptions"
)

// The subscription of a tenant in the storage of W1.08 (control/subscriptions/doc.go): one row of subscriptions per
// tenant, state trial | active | grace | ended for trialing | active | grace | read_only, the end of the current
// period in upper(period); every change writes the full set of entitlements under a new version, and the revision of
// the subscription is the greatest entitlements.version (1 without rows). The store of W1.08 keeps its writes
// unexported, so the commands of this package write the same shape inside their own transaction.

// stored state ↔ contract status.
var (
	statusOf = map[string]string{
		"trial": subscriptions.StatusTrialing, "active": subscriptions.StatusActive, "grace": subscriptions.StatusGrace,
		"ended": subscriptions.StatusReadOnly,
	}
	stateOf = map[string]string{
		subscriptions.StatusTrialing: "trial", subscriptions.StatusActive: "active", subscriptions.StatusGrace: "grace",
		subscriptions.StatusReadOnly: "ended",
	}
)

// followed are the tenant states that follow the subscription (W1.08); suspended, provisioning, closing and closed
// are decided by operators and the provisioner.
var followed = map[string]bool{StateTrial: true, StateActive: true, StateGrace: true, StateReadOnly: true}

// subRow is the stored row of a subscription.
type subRow struct {
	id         uuid.UUID
	ok         bool
	plan       string
	state      string
	since      time.Time  // lower(period)
	end        *time.Time // upper(period)
	hasVersion bool       // the tenant has entitlements rows
}

// storedRow reads (and with lock, locks) the subscription row of a tenant; ok is false when there is none.
func storedRow(ctx context.Context, q queryer, tenant uuid.UUID, lock bool) (subRow, bool, error) {
	query := `select id, plan_code, state, lower(period), upper(period) from subscriptions
 where tenant_id = $1 order by created_at desc, id desc limit 1`
	if lock {
		query += ` for update`
	}
	var (
		r     subRow
		since sql.NullTime
		end   sql.NullTime
	)
	err := q.QueryRowContext(ctx, query, tenant).Scan(&r.id, &r.plan, &r.state, &since, &end)
	if errors.Is(err, sql.ErrNoRows) {
		return subRow{}, false, nil
	}
	if err != nil {
		return subRow{}, false, fmt.Errorf("operators: subscription of %s: %w", tenant, err)
	}
	r.ok = true
	if since.Valid {
		r.since = since.Time.UTC()
	}
	if end.Valid {
		e := end.Time.UTC()
		r.end = &e
	}
	return r, true, nil
}

// createPlan is the planKey of the tenant.create request of a tenant ("" — none).
func createPlan(ctx context.Context, q queryer, tenant uuid.UUID) (string, error) {
	var plan sql.NullString
	err := q.QueryRowContext(ctx, `select details->>'planKey' from platform_audit
 where action = 'tenant.create' and target_id = $1 order by id limit 1`, tenant).Scan(&plan)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("operators: plan of %s: %w", tenant, err)
	}
	return plan.String, nil
}

// The current entitlements are the rows of the greatest version of the tenant that have not expired (W1.08).
const entitlementsSQL = `
with v as (select max(version) as version from entitlements where tenant_id = $1)
select e.feature_key, e.source_type, coalesce(e.source_ref, ''), coalesce(e.limit_value, 0), upper(e.effective), v.version
  from v left join entitlements e
    on e.tenant_id = $1 and e.version = v.version and (upper(e.effective) is null or upper(e.effective) > $2)
 order by case e.feature_key when 'seats' then 0 when 'storage_quota_bytes' then 1 else 2 end, e.feature_key`

// currentEntitlements returns the current entitlements and the revision (1 without rows); has reports rows.
func currentEntitlements(ctx context.Context, q queryer, tenant uuid.UUID, now time.Time) (out []subscriptions.Entitlement, revision int64, has bool, err error) {
	rows, err := q.QueryContext(ctx, entitlementsSQL, tenant, now)
	if err != nil {
		return nil, 0, false, fmt.Errorf("operators: entitlements of %s: %w", tenant, err)
	}
	defer rows.Close()
	out, revision = []subscriptions.Entitlement{}, 1
	for rows.Next() {
		var (
			key, source, ref sql.NullString
			value            sql.NullInt64
			until            sql.NullTime
			version          sql.NullInt64
		)
		if err := rows.Scan(&key, &source, &ref, &value, &until, &version); err != nil {
			return nil, 0, false, fmt.Errorf("operators: entitlements of %s: %w", tenant, err)
		}
		if version.Valid {
			revision, has = version.Int64, true
		}
		if !key.Valid {
			continue
		}
		e := subscriptions.Entitlement{Key: key.String, SourceType: source.String, SourceRef: ref.String, Value: value.Int64}
		if until.Valid {
			u := until.Time.UTC()
			e.ValidUntil = &u
		}
		out = append(out, e)
	}
	return out, revision, has, rows.Err()
}

// loadSubscription reads the subscription of a locked tenant inside the command (its row locked too): the stored
// one, or the derived one of W1.08 when there is no row.
func loadSubscription(ctx context.Context, tx *sql.Tx, row tenantRow, now time.Time) (subscriptions.Subscription, subRow, error) {
	r, ok, err := storedRow(ctx, tx, row.id, true)
	if err != nil {
		return subscriptions.Subscription{}, subRow{}, err
	}
	ents, revision, has, err := currentEntitlements(ctx, tx, row.id, now)
	if err != nil {
		return subscriptions.Subscription{}, subRow{}, err
	}
	r.hasVersion = has
	if !ok {
		plan, err := createPlan(ctx, tx, row.id)
		if err != nil {
			return subscriptions.Subscription{}, subRow{}, err
		}
		sub := subscriptions.Derive(subscriptions.Tenant{ID: row.id, State: row.state, StateChangedAt: row.changedAt, PlanKey: plan})
		r.since = row.changedAt
		return sub, r, nil
	}
	sub := subscriptions.Subscription{
		TenantID: row.id, PlanKey: r.plan, Status: statusOf[r.state], Stored: true, Entitlements: ents, Revision: revision,
	}
	switch sub.Status {
	case subscriptions.StatusTrialing:
		sub.TrialEndsAt = r.end
	case subscriptions.StatusActive:
		sub.PeriodEndsAt = r.end
	case subscriptions.StatusGrace:
		sub.GraceEndsAt = r.end
	}
	return sub, r, nil
}

// periodEnd is the end of the period the stored state of s covers.
func periodEnd(s subscriptions.Subscription) *time.Time {
	switch s.Status {
	case subscriptions.StatusTrialing:
		return s.TrialEndsAt
	case subscriptions.StatusActive:
		return s.PeriodEndsAt
	case subscriptions.StatusGrace:
		return s.GraceEndsAt
	}
	return nil
}

// limitUnit is entitlements.limit_unit of a key (as W1.08).
func limitUnit(key string) any {
	switch {
	case key == subscriptions.KeySeats:
		return "seats"
	case strings.HasSuffix(key, "_bytes"):
		return "bytes"
	}
	return nil
}

// writeSubscription stores next as the subscription row of the tenant (period [since, end of next]) and its
// entitlements as version next.Revision.
func writeSubscription(ctx context.Context, tx *sql.Tx, r subRow, next subscriptions.Subscription, since time.Time, reason string, actor uuid.UUID, now time.Time) error {
	end := periodEnd(next)
	if end != nil && end.Before(since) {
		since = *end
	}
	var err error
	if r.ok {
		_, err = tx.ExecContext(ctx, `update subscriptions set plan_code = $2, state = $3, period = tstzrange($4, $5, '[]') where id = $1`,
			r.id, next.PlanKey, stateOf[next.Status], since, end)
	} else {
		_, err = tx.ExecContext(ctx, `insert into subscriptions (tenant_id, plan_code, state, period) values ($1, $2, $3, tstzrange($4, $5, '[]'))`,
			next.TenantID, next.PlanKey, stateOf[next.Status], since, end)
	}
	if err != nil {
		return fmt.Errorf("operators: subscription of %s: %w", next.TenantID, err)
	}
	return writeEntitlements(ctx, tx, next, strings.TrimSpace(reason), actor, now)
}

func writeEntitlements(ctx context.Context, tx *sql.Tx, next subscriptions.Subscription, reason string, actor uuid.UUID, now time.Time) error {
	for _, e := range next.Entitlements {
		from := now
		if e.ValidUntil != nil && e.ValidUntil.Before(from) {
			from = *e.ValidUntil
		}
		if _, err := tx.ExecContext(ctx, `
insert into entitlements (tenant_id, feature_key, source_type, source_ref, limit_value, limit_unit, effective, version, reason, actor_id)
values ($1, $2, $3, nullif($4, ''), $5, $6, tstzrange($7, $8, '[]'), $9, $10, $11)`,
			next.TenantID, e.Key, e.SourceType, e.SourceRef, e.Value, limitUnit(e.Key), from, e.ValidUntil, next.Revision, reason, actor); err != nil {
			return fmt.Errorf("operators: entitlement %s of %s: %w", e.Key, next.TenantID, err)
		}
	}
	return nil
}

// materialize stores the derived subscription of a tenant without a row before it is suspended (Q-W1.08-13): the
// subscription itself does not change, so its revision stays the derived one (entitlements are written only when
// the tenant has none).
func materialize(ctx context.Context, tx *sql.Tx, row tenantRow, actor uuid.UUID, reason string, now time.Time) error {
	sub, r, err := loadSubscription(ctx, tx, row, now)
	if err != nil || sub.Stored {
		return err
	}
	sub.Stored = true
	if r.hasVersion {
		sub.Entitlements = nil
	}
	return writeSubscription(ctx, tx, r, sub, row.changedAt, reason, actor, now)
}

// planHistorySQL: the latest entitlement of each key that does not come from an operator (W1.08).
const planHistorySQL = `
select distinct on (feature_key) feature_key, source_type, coalesce(source_ref, ''), coalesce(limit_value, 0)
  from entitlements where tenant_id = $1 and source_type <> 'manual'
 order by feature_key, version desc`

func planHistory(ctx context.Context, q queryer, tenant uuid.UUID) (map[string]subscriptions.Entitlement, error) {
	rows, err := q.QueryContext(ctx, planHistorySQL, tenant)
	if err != nil {
		return nil, fmt.Errorf("operators: plan entitlements of %s: %w", tenant, err)
	}
	defer rows.Close()
	out := map[string]subscriptions.Entitlement{}
	for rows.Next() {
		var e subscriptions.Entitlement
		if err := rows.Scan(&e.Key, &e.SourceType, &e.SourceRef, &e.Value); err != nil {
			return nil, fmt.Errorf("operators: plan entitlements of %s: %w", tenant, err)
		}
		out[e.Key] = e
	}
	return out, rows.Err()
}

// entitlementOrder: seats, the storage quota, then the other keys alphabetically (as W1.08).
func entitlementOrder(a, b subscriptions.Entitlement) int {
	rank := func(k string) int {
		switch k {
		case subscriptions.KeySeats:
			return 0
		case subscriptions.KeyStorageQuota:
			return 1
		}
		return 2
	}
	if d := rank(a.Key) - rank(b.Key); d != 0 {
		return d
	}
	return strings.Compare(a.Key, b.Key)
}

// trialEntitlements are the entitlements of an extended trial: the plan values of the tenant (its history, else the
// current ones, else the plan of W1.08) with source trial, the manual ones of cur kept over the same key.
func trialEntitlements(cur subscriptions.Subscription, history map[string]subscriptions.Entitlement) []subscriptions.Entitlement {
	if len(history) == 0 {
		for _, e := range cur.Entitlements {
			if e.SourceType != subscriptions.SourceManual {
				history[e.Key] = e
			}
		}
	}
	quota := subscriptions.DefaultQuotaBytes
	if e, ok := history[subscriptions.KeyStorageQuota]; ok {
		quota = e.Value
	}
	out := make([]subscriptions.Entitlement, 0, len(history)+2)
	for _, e := range history {
		out = append(out, subscriptions.Entitlement{Key: e.Key, SourceType: subscriptions.SourceTrial, SourceRef: e.SourceRef, Value: e.Value})
	}
	for _, e := range subscriptions.PlanEntitlements(cur.PlanKey, subscriptions.SourceTrial, quota) {
		if _, ok := history[e.Key]; !ok {
			out = append(out, e)
		}
	}
	for _, m := range cur.Entitlements {
		if m.SourceType == subscriptions.SourceManual {
			out = slices.DeleteFunc(out, func(e subscriptions.Entitlement) bool { return e.Key == m.Key })
			out = append(out, m)
		}
	}
	slices.SortFunc(out, entitlementOrder)
	return out
}
