package subscriptions

import (
	"context"
	"database/sql"
	"fmt"
	"slices"
	"strconv"
	"time"

	"github.com/google/uuid"
)

// UnlimitedSeats is the seat value of a tier without a limit (MSW: «Безлимит» and unknown plans).
const UnlimitedSeats = unlimitedSeats

// PlanChange is the change of the tier of an approved tier request (W4.60, decidePlatformSubscriptionRequest): the
// tier of a price book version and its seats, the paid term and its amount, the end of the paid period.
type PlanChange struct {
	Tier         string
	Seats        int64 // UnlimitedSeats for the unlimited tier
	TermMonths   int
	PriceVersion int
	AmountMinor  *int64 // the amount of the period; nil — priced individually
	PeriodEndsAt time.Time
	Reason       string    // entitlements.reason
	Actor        uuid.UUID // entitlements.actor_id: the operator (uuid.Nil — the billing scheduler)
}

// Locked returns the subscription of a tenant in tx under the lock of its tenant row (SELECT … FOR UPDATE, the lock
// order of Update); ErrUnknownTenant. The caller holds the lock until it commits or rolls back.
func (s Store) Locked(ctx context.Context, tx *sql.Tx, tenantID uuid.UUID) (Subscription, error) {
	t, err := loadTenant(ctx, tx, tenantID, " for update of t")
	if err != nil {
		return Subscription{}, err
	}
	sub, _, err := s.current(ctx, tx, t)
	return sub, err
}

// ChangePlan writes the tier of c in tx (the tenant row locked by Locked): the subscription becomes active for the
// paid period that starts now and ends at c.PeriodEndsAt with the terms of the period (subscriptions.tier_code,
// term_months, price_version, amount_minor), a new version of the entitlements — the seats of the tier and the
// storage quota of the plan history, both from the plan of the price book version, and the manual entitlements still
// in force — and a tenant that follows its subscription (trial, grace, read_only) becomes active; a suspended one
// stays suspended (the operator resumes it).
func (s Store) ChangePlan(ctx context.Context, tx *sql.Tx, tenantID uuid.UUID, c PlanChange) (Subscription, error) {
	t, err := loadTenant(ctx, tx, tenantID, " for update of t")
	if err != nil {
		return Subscription{}, err
	}
	cur, r, err := s.current(ctx, tx, t)
	if err != nil {
		return Subscription{}, err
	}
	history, err := planHistory(ctx, tx, tenantID)
	if err != nil {
		return Subscription{}, err
	}
	end := c.PeriodEndsAt.UTC()
	next := Subscription{
		TenantID: tenantID, PlanKey: c.Tier, Status: StatusActive, PeriodEndsAt: &end, Revision: cur.Revision + 1, Stored: true,
		TermMonths: new(c.TermMonths), PriceVersion: new(c.PriceVersion), AmountMinor: c.AmountMinor,
		Entitlements: planEntitlements(c, cur, history),
	}
	id, err := s.write(ctx, tx, t, r, next, s.now(), c.Reason, c.Actor)
	if err != nil {
		return Subscription{}, err
	}
	// Only the row write wrote: the earlier rows of the tenant keep the terms of their periods.
	if _, err := tx.ExecContext(ctx, `update subscriptions set tier_code = $2, term_months = $3, price_version = $4, amount_minor = $5
 where id = $1`, id, c.Tier, c.TermMonths, c.PriceVersion, c.AmountMinor); err != nil {
		return Subscription{}, fmt.Errorf("subscriptions: terms: %w", err)
	}
	return next, nil
}

// planEntitlements are the entitlements of the tier of c: seats and the storage quota of the plan (the quota of the
// plan history, else the default), from the price book version of c; the manual entitlements of cur still in force
// hide the plan one of their key.
func planEntitlements(c PlanChange, cur Subscription, history map[string]Entitlement) []Entitlement {
	ref := "price-book:v" + strconv.Itoa(c.PriceVersion) + ":" + c.Tier
	quota := DefaultQuotaBytes
	if e, ok := history[KeyStorageQuota]; ok {
		quota = e.Value
	}
	out := []Entitlement{
		{Key: KeySeats, SourceType: SourcePlan, SourceRef: ref, Value: c.Seats},
		{Key: KeyStorageQuota, SourceType: SourcePlan, SourceRef: ref, Value: quota},
	}
	for _, m := range cur.Entitlements {
		if m.SourceType != SourceManual {
			continue
		}
		out = slices.DeleteFunc(out, func(e Entitlement) bool { return e.Key == m.Key })
		out = append(out, m)
	}
	slices.SortFunc(out, entitlementOrder)
	return out
}
