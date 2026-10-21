package billing

import (
	"context"
	"database/sql"
	"fmt"
	"slices"
	"strconv"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/control/tenants/operators"
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
)

// Audit actions and the target type of the price book (platform_audit).
const (
	ActionPublished     = "price_book.published"
	ActionCancelled     = "price_book.cancelled"
	targetPriceBook     = "price_book"
	detailScheduled     = "Уже запланирована версия v%d. Отмените её, чтобы подготовить другую."
	detailNoScheduled   = "Запланированной версии нет."
	detailDraftRejected = "Проверьте ступени сетки."
	keyVersion          = "version"
)

const versionsSQL = `
select v.version, lower(v.effective), upper(v.effective), v.note, v.published_at, a.id, a.display_name, v.cancelled_at,
       (select count(*) from subscriptions s where s.price_version = v.version)
  from price_book_versions v
  left join platform_operators o on o.id = v.published_by
  left join accounts a on a.id = o.account_id
 order by v.version desc`

// loadVersions reads every version of the price book with its tiers and terms, newest first.
func loadVersions(ctx context.Context, q queryer) ([]Version, error) {
	rows, err := q.QueryContext(ctx, versionsSQL)
	if err != nil {
		return nil, fmt.Errorf("billing: versions: %w", err)
	}
	defer rows.Close()
	var out []Version
	for rows.Next() {
		var (
			v                Version
			until, cancelled sql.NullTime
			published        time.Time
			byID             uuid.NullUUID
			byName           sql.NullString
		)
		if err := rows.Scan(&v.Number, &v.EffectiveFrom, &until, &v.Note, &published, &byID, &byName, &cancelled, &v.SubscriptionCount); err != nil {
			return nil, fmt.Errorf("billing: versions: %w", err)
		}
		v.EffectiveFrom, v.Currency = v.EffectiveFrom.UTC(), Currency
		v.PublishedAt, v.EffectiveUntil, v.CancelledAt = new(published.UTC()), timeOf(until), timeOf(cancelled)
		if byID.Valid {
			v.PublishedBy = &AccountRef{AccountID: new(byID.UUID), DisplayName: byName.String}
		}
		out = append(out, v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("billing: versions: %w", err)
	}
	return out, priceLists(ctx, q, out)
}

// priceLists adds the tiers and the terms to vs.
func priceLists(ctx context.Context, q queryer, vs []Version) error {
	byNumber := map[int]*Version{}
	for i := range vs {
		byNumber[vs[i].Number] = &vs[i]
	}
	if err := tiersOf(ctx, q, byNumber); err != nil {
		return err
	}
	return termsOf(ctx, q, byNumber)
}

// tiersOf adds the tiers of price_tiers, in their order, to the versions of byNumber.
func tiersOf(ctx context.Context, q queryer, byNumber map[int]*Version) error {
	rows, err := q.QueryContext(ctx, `select version, tier_code, name, seats_limit, month_minor, currency from price_tiers order by version, sort`)
	if err != nil {
		return fmt.Errorf("billing: tiers: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			n            int
			t            Tier
			seats, month sql.NullInt64
			currency     string
		)
		if err := rows.Scan(&n, &t.Code, &t.Name, &seats, &month, &currency); err != nil {
			return fmt.Errorf("billing: tiers: %w", err)
		}
		t.SeatsLimit = intOf(seats)
		if month.Valid {
			t.MonthMinor = new(month.Int64)
		}
		if v := byNumber[n]; v != nil {
			v.Tiers, v.Currency = append(v.Tiers, t), currency
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("billing: tiers: %w", err)
	}
	return nil
}

// termsOf adds the terms of price_terms to the versions of byNumber.
func termsOf(ctx context.Context, q queryer, byNumber map[int]*Version) error {
	rows, err := q.QueryContext(ctx, `select version, months, round(discount_pct)::int from price_terms order by version, months`)
	if err != nil {
		return fmt.Errorf("billing: terms: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			n int
			t Term
		)
		if err := rows.Scan(&n, &t.Months, &t.DiscountPercent); err != nil {
			return fmt.Errorf("billing: terms: %w", err)
		}
		if v := byNumber[n]; v != nil {
			v.Terms = append(v.Terms, t)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("billing: terms: %w", err)
	}
	return nil
}

// inState returns the first version of vs (newest first) in state at now.
func inState(vs []Version, state string, now time.Time) (Version, bool) {
	i := slices.IndexFunc(vs, func(v Version) bool { return v.State(now) == state })
	if i < 0 {
		return Version{}, false
	}
	return vs[i], true
}

// numbered returns the version number of vs.
func numbered(vs []Version, number int) (Version, bool) {
	i := slices.IndexFunc(vs, func(v Version) bool { return v.Number == number })
	if i < 0 {
		return Version{}, false
	}
	return vs[i], true
}

// currentOf is the version in force at now; without one (an empty price book or a gap) the newest version that has
// started and is not cancelled.
func currentOf(vs []Version, now time.Time) (Version, bool) {
	if v, ok := inState(vs, StateCurrent, now); ok {
		return v, true
	}
	i := slices.IndexFunc(vs, func(v Version) bool { return v.CancelledAt == nil && !v.EffectiveFrom.After(now) })
	if i < 0 {
		return Version{}, false
	}
	return vs[i], true
}

// Versions returns the versions of the price book, newest first; cancelled ones only with includeCancelled
// (listPriceBookVersions).
func (s Store) Versions(ctx context.Context, includeCancelled bool) ([]Version, error) {
	vs, err := loadVersions(ctx, s.DB)
	if err != nil {
		return nil, err
	}
	if !includeCancelled {
		vs = slices.DeleteFunc(vs, func(v Version) bool { return v.CancelledAt != nil })
	}
	return vs, nil
}

// TenantPriceBook is the price book of the owner's calculation (getTenantPriceBook): the version in force, the
// scheduled one and the version of the paid period of the subscription when it differs.
type TenantPriceBook struct {
	Current               Version
	Scheduled, Subscribed *Version
}

// PriceBook returns the price book of a tenant; an unknown tenant is ErrNotFound.
func (s Store) PriceBook(ctx context.Context, tenantID uuid.UUID) (TenantPriceBook, error) {
	sub, err := s.Subs.Current(ctx, tenantID)
	if err != nil {
		return TenantPriceBook{}, subscriptionError(err)
	}
	vs, err := loadVersions(ctx, s.DB)
	if err != nil {
		return TenantPriceBook{}, err
	}
	now := s.now()
	cur, ok := currentOf(vs, now)
	if !ok {
		return TenantPriceBook{}, errNoVersion
	}
	pb := TenantPriceBook{Current: cur}
	if v, ok := inState(vs, StateScheduled, now); ok {
		pb.Scheduled = &v
	}
	if sub.PriceVersion != nil && *sub.PriceVersion != cur.Number {
		if v, ok := numbered(vs, *sub.PriceVersion); ok {
			pb.Subscribed = &v
		}
	}
	return pb, nil
}

// Publish is publishPriceBookVersion.
type Publish struct {
	Actor     uuid.UUID // the account of the operator
	Draft     Draft
	RequestID string
}

// Publish publishes the next version of the price book (platform.pricing.manage): at most one scheduled version
// (409), the checks of the draft (422 with violations); in one transaction the version in force ends at the start of
// the new one and the new one is inserted (EXCLUDE on effective); price_book.published is audited.
func (s Store) Publish(ctx context.Context, c Publish) (Version, error) {
	reqID := requestIDOf(ctx, c.RequestID)
	op, err := s.authorize(ctx, c.Actor, operators.PermPricingManage, ActionPublished, targetPriceBook, uuid.Nil, reqID)
	if err != nil {
		return Version{}, err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Version{}, fmt.Errorf("billing: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }() // no-op after Commit
	vs, err := lockedVersions(ctx, tx)
	if err != nil {
		return Version{}, err
	}
	now := s.now()
	if v, ok := inState(vs, StateScheduled, now); ok {
		return Version{}, refuse(CodeInvalidTransition, fmt.Sprintf(detailScheduled, v.Number))
	}
	if violations := c.Draft.Check(now); len(violations) > 0 {
		return Version{}, refuse(CodeValidationFailed, detailDraftRejected, violations...)
	}
	number := 1
	if len(vs) > 0 {
		number = vs[0].Number + 1
	}
	v := c.Draft.Version(number)
	if cur, ok := currentOf(vs, now); ok {
		if _, err := tx.ExecContext(ctx, `update price_book_versions set effective = tstzrange(lower(effective), $2) where version = $1`,
			cur.Number, v.EffectiveFrom); err != nil {
			return Version{}, fmt.Errorf("billing: end of v%d: %w", cur.Number, err)
		}
	}
	if err := insertVersion(ctx, tx, v, op.id, now); err != nil {
		return Version{}, err
	}
	e := event(audit.PlatformOperator, c.Actor, ActionPublished, targetPriceBook, uuid.Nil, "", reqID, map[string]string{
		keyVersion: strconv.Itoa(number), "effectiveFrom": c.Draft.EffectiveFrom,
	})
	if err := audit.RecordPlatform(ctx, auditExec{tx}, e); err != nil {
		return Version{}, err
	}
	if err := tx.Commit(); err != nil {
		return Version{}, fmt.Errorf("billing: commit: %w", err)
	}
	v.PublishedAt, v.PublishedBy = &now, &AccountRef{AccountID: new(c.Actor), DisplayName: op.name}
	return v, nil
}

// lockedVersions locks the price book against other publications and cancellations (reads still pass) and reads it.
func lockedVersions(ctx context.Context, tx *sql.Tx) ([]Version, error) {
	if _, err := tx.ExecContext(ctx, `lock table price_book_versions in share row exclusive mode`); err != nil {
		return nil, fmt.Errorf("billing: lock price book: %w", err)
	}
	return loadVersions(ctx, tx)
}

// insertVersion writes v with its tiers (in their order) and terms.
func insertVersion(ctx context.Context, tx *sql.Tx, v Version, publishedBy uuid.UUID, now time.Time) error {
	if _, err := tx.ExecContext(ctx, `insert into price_book_versions (version, effective, note, published_by, published_at)
values ($1, tstzrange($2, null), $3, $4, $5)`, v.Number, v.EffectiveFrom, v.Note, publishedBy, now); err != nil {
		return fmt.Errorf("billing: insert v%d: %w", v.Number, err)
	}
	for i, t := range v.Tiers {
		if _, err := tx.ExecContext(ctx, `insert into price_tiers (version, tier_code, name, seats_limit, month_minor, currency, sort)
values ($1, $2, $3, $4, $5, $6, $7)`, v.Number, t.Code, t.Name, t.SeatsLimit, t.MonthMinor, v.Currency, i+1); err != nil {
			return fmt.Errorf("billing: tier %s of v%d: %w", t.Code, v.Number, err)
		}
	}
	for _, t := range v.Terms {
		if _, err := tx.ExecContext(ctx, `insert into price_terms (version, months, discount_pct) values ($1, $2, $3)`,
			v.Number, t.Months, t.DiscountPercent); err != nil {
			return fmt.Errorf("billing: term %d of v%d: %w", t.Months, v.Number, err)
		}
	}
	return nil
}

// CancelVersion is cancelPriceBookVersion.
type CancelVersion struct {
	Actor     uuid.UUID
	Number    int
	RequestID string
}

// CancelVersion cancels the scheduled version before its start (platform.pricing.manage): it stays in the journal as
// cancelled and the version in force continues without an end; a version that is not scheduled is 409, an unknown one
// ErrNotFound; price_book.cancelled is audited.
func (s Store) CancelVersion(ctx context.Context, c CancelVersion) (Version, error) {
	reqID := requestIDOf(ctx, c.RequestID)
	op, err := s.authorize(ctx, c.Actor, operators.PermPricingManage, ActionCancelled, targetPriceBook, uuid.Nil, reqID)
	if err != nil {
		return Version{}, err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Version{}, fmt.Errorf("billing: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	vs, err := lockedVersions(ctx, tx)
	if err != nil {
		return Version{}, err
	}
	v, ok := numbered(vs, c.Number)
	if !ok {
		return Version{}, ErrNotFound
	}
	now := s.now()
	if v.State(now) != StateScheduled {
		return Version{}, refuse(CodeInvalidTransition, detailNoScheduled)
	}
	if _, err := tx.ExecContext(ctx, `update price_book_versions set cancelled_at = $2, cancelled_by = $3 where version = $1`,
		v.Number, now, op.id); err != nil {
		return Version{}, fmt.Errorf("billing: cancel v%d: %w", v.Number, err)
	}
	if _, err := tx.ExecContext(ctx, `update price_book_versions set effective = tstzrange(lower(effective), null)
 where cancelled_at is null and version <> $1 and upper(effective) = $2`, v.Number, v.EffectiveFrom); err != nil {
		return Version{}, fmt.Errorf("billing: reopen the version in force: %w", err)
	}
	e := event(audit.PlatformOperator, c.Actor, ActionCancelled, targetPriceBook, uuid.Nil, "", reqID, map[string]string{
		keyVersion: strconv.Itoa(v.Number),
	})
	if err := audit.RecordPlatform(ctx, auditExec{tx}, e); err != nil {
		return Version{}, err
	}
	if err := tx.Commit(); err != nil {
		return Version{}, fmt.Errorf("billing: commit: %w", err)
	}
	v.CancelledAt = &now
	return v, nil
}
