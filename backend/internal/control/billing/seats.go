package billing

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/control/subscriptions"
)

// seatCounts reads the occupied seats of a tenant (control view tenant_seat_usage: active and invited memberships).
func seatCounts(ctx context.Context, q queryer, tenantID uuid.UUID) (active, invited int, err error) {
	var used int
	err = q.QueryRowContext(ctx, `select seats_used, seats_invited from tenant_seat_usage where tenant_id = $1`, tenantID).Scan(&used, &invited)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, 0, nil
	}
	if err != nil {
		return 0, 0, fmt.Errorf("billing: seats: %w", err)
	}
	return used - invited, invited, nil
}

// usedSeats is the occupied seats of a tenant.
func usedSeats(ctx context.Context, q queryer, tenantID uuid.UUID) (int, error) {
	active, invited, err := seatCounts(ctx, q, tenantID)
	return active + invited, err
}

// seatsOf are the seats of sub (SeatUsage): the limit is the seats entitlement, none for the unlimited tier (its tier
// in the version of the paid period, or in the version in force without one, has no seat limit).
func seatsOf(ctx context.Context, q queryer, sub subscriptions.Subscription, vs []Version, now time.Time) (Seats, error) {
	active, invited, err := seatCounts(ctx, q, sub.TenantID)
	if err != nil {
		return Seats{}, err
	}
	s := Seats{Active: active, Invited: invited}
	limit, ok := entitlement(sub, subscriptions.KeySeats)
	if !ok || limit >= subscriptions.UnlimitedSeats {
		return s, nil
	}
	if v, ok := paidVersion(sub, vs, now); ok {
		if t, ok := v.Tier(sub.PlanKey); ok && t.SeatsLimit == nil {
			return s, nil
		}
	}
	s.Limit = new(int(limit))
	return s, nil
}

// entitlement is the value of the entitlement key of sub.
func entitlement(sub subscriptions.Subscription, key string) (int64, bool) {
	for _, e := range sub.Entitlements {
		if e.Key == key {
			return e.Value, true
		}
	}
	return 0, false
}

// paidVersion is the price book version of the paid period of sub, the version in force without one.
func paidVersion(sub subscriptions.Subscription, vs []Version, now time.Time) (Version, bool) {
	if sub.PriceVersion != nil {
		return numbered(vs, *sub.PriceVersion)
	}
	return currentOf(vs, now)
}

// Terms are the terms of a subscription for the screens (Subscription.tierName, monthlyAmount, periodAmount, seats).
type Terms struct {
	TierName                  string // "" — the tier is not in the version of the paid period
	MonthlyMinor, PeriodMinor *int64 // nil — a trial, a period without a term or an individual price
	Seats                     Seats
}

// Terms returns the terms of sub: the name of its tier and the amounts of its term by the price book version of the
// paid period (MSW subscriptionWithTerms), and its seats.
func (s Store) Terms(ctx context.Context, sub subscriptions.Subscription) (Terms, error) {
	vs, err := loadVersions(ctx, s.DB)
	if err != nil {
		return Terms{}, err
	}
	return s.termsOf(ctx, sub, vs)
}

func (s Store) termsOf(ctx context.Context, sub subscriptions.Subscription, vs []Version) (Terms, error) {
	now := s.now()
	seats, err := seatsOf(ctx, s.DB, sub, vs, now)
	if err != nil {
		return Terms{}, err
	}
	t := Terms{Seats: seats}
	if sub.PriceVersion == nil {
		return t, nil
	}
	v, ok := numbered(vs, *sub.PriceVersion)
	if !ok {
		return t, nil
	}
	if tier, ok := v.Tier(sub.PlanKey); ok {
		t.TierName = tier.Name
	}
	if sub.TermMonths != nil {
		if q, ok := QuoteOf(v, sub.PlanKey, *sub.TermMonths); ok {
			t.MonthlyMinor, t.PeriodMinor = &q.MonthlyMinor, &q.PeriodMinor
		}
	}
	return t, nil
}

// Facts are the seats, the members that are not ended and the tier of a tenant for the operator lists (Tenant.seats,
// memberCount, tierCode).
type Facts struct {
	Seats       Seats
	MemberCount int
	TierCode    string
}

// Facts returns the facts of the tenants of ids; an unknown tenant is left out.
func (s Store) Facts(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]Facts, error) {
	vs, err := loadVersions(ctx, s.DB)
	if err != nil {
		return nil, err
	}
	out := make(map[uuid.UUID]Facts, len(ids))
	for _, id := range ids {
		sub, err := s.Subs.Current(ctx, id)
		if errors.Is(err, subscriptions.ErrUnknownTenant) {
			continue
		}
		if err != nil {
			return nil, err
		}
		seats, err := seatsOf(ctx, s.DB, sub, vs, s.now())
		if err != nil {
			return nil, err
		}
		f := Facts{Seats: seats, TierCode: sub.PlanKey}
		if err := s.DB.QueryRowContext(ctx, `select count(*) from memberships where tenant_id = $1 and status <> 'ended'`, id).
			Scan(&f.MemberCount); err != nil {
			return nil, fmt.Errorf("billing: members: %w", err)
		}
		out[id] = f
	}
	return out, nil
}
