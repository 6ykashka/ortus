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

// Modules returns the installed industry modules of a tenant (moduleKey of the contract); industry is
// tenants.industry_pack for a tenant whose database is not at hand (cmd/api reads the module registry).
type Modules func(ctx context.Context, tenantID uuid.UUID, industry string) ([]string, error)

// activeWindow is the window of «signed in during the last 7 days».
const activeWindow = 7 * day

// Usage returns the Использование screen (getPlatformUsage): one row per tenant that is not closed, from control DB
// metadata only — the subscription and its seats, the latest snapshot of tenant_usage_daily, the members and the
// sign-ins no later than now (Q-W4.07-7), the owner, the pending request — and the modules of modules, summarized in
// moduleOrder.
func (s Store) Usage(ctx context.Context, modules Modules, moduleOrder []string) (Usage, error) {
	vs, err := loadVersions(ctx, s.DB)
	if err != nil {
		return Usage{}, err
	}
	ts, err := usageTenants(ctx, s.DB)
	if err != nil {
		return Usage{}, err
	}
	now := s.now()
	out := make([]UsageTenant, 0, len(ts))
	for _, t := range ts {
		row := UsageTenant{ID: t.id, Name: t.name, Status: t.state, ModuleKeys: []string{}}
		if err := s.usageRow(ctx, &row, vs, now); err != nil {
			return Usage{}, err
		}
		if modules != nil {
			keys, err := modules(ctx, t.id, t.industry)
			if err != nil {
				return Usage{}, err
			}
			if keys != nil {
				row.ModuleKeys = keys
			}
		}
		out = append(out, row)
	}
	return Summarize(out, moduleOrder, now), nil
}

// usageTenant is a tenant of the Использование screen.
type usageTenant struct {
	id                    uuid.UUID
	name, state, industry string
}

// usageTenants are the tenants that are not closed, by name.
func usageTenants(ctx context.Context, q queryer) ([]usageTenant, error) {
	rows, err := q.QueryContext(ctx, `select id, display_name, state::text, industry_pack from tenants where state <> 'closed'
 order by display_name, id`)
	if err != nil {
		return nil, fmt.Errorf("billing: tenants: %w", err)
	}
	defer rows.Close()
	var out []usageTenant
	for rows.Next() {
		var t usageTenant
		if err := rows.Scan(&t.id, &t.name, &t.state, &t.industry); err != nil {
			return nil, fmt.Errorf("billing: tenants: %w", err)
		}
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("billing: tenants: %w", err)
	}
	return out, nil
}

// usageRow fills the subscription, storage, members and pending request of row.
func (s Store) usageRow(ctx context.Context, row *UsageTenant, vs []Version, now time.Time) error {
	sub, err := s.Subs.Current(ctx, row.ID)
	if err != nil {
		return err
	}
	terms, err := s.termsOf(ctx, sub, vs)
	if err != nil {
		return err
	}
	row.TierCode, row.TierName, row.Seats = sub.PlanKey, terms.TierName, terms.Seats
	if sub.Status == subscriptions.StatusTrialing {
		row.TrialEndsAt = sub.TrialEndsAt
	}
	quota, _ := entitlement(sub, subscriptions.KeyStorageQuota)
	row.StorageQuota = quota
	err = s.DB.QueryRowContext(ctx, `select storage_used_bytes from tenant_usage_daily where tenant_id = $1 order by day desc limit 1`, row.ID).
		Scan(&row.StorageUsed)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("billing: storage snapshot: %w", err)
	}
	var owner sql.NullString
	err = s.DB.QueryRowContext(ctx, `select a.display_name from owner_bindings o
  join memberships m on m.id = o.membership_id and m.status = 'active'
  join accounts a on a.id = m.account_id
 where o.tenant_id = $1 and o.revoked_at is null order by o.granted_at, o.id limit 1`, row.ID).Scan(&owner)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("billing: owner: %w", err)
	}
	row.OwnerName = owner.String
	var last sql.NullTime
	err = s.DB.QueryRowContext(ctx, `select count(*) filter (where m.status <> 'ended'),
       count(*) filter (where m.status = 'active'),
       count(*) filter (where m.status = 'active' and a.last_login_at >= $2 and a.last_login_at <= $3),
       max(a.last_login_at) filter (where m.status = 'active' and a.last_login_at <= $3)
  from memberships m join accounts a on a.id = m.account_id
 where m.tenant_id = $1`, row.ID, now.Add(-activeWindow), now).Scan(&row.MemberCount, &row.ActiveMembers, &row.ActiveMembers7d, &last)
	if err != nil {
		return fmt.Errorf("billing: members: %w", err)
	}
	row.LastSignIn = timeOf(last)
	var pending RequestRef
	err = s.DB.QueryRowContext(ctx, `select id, number from subscription_change_requests where tenant_id = $1 and status = 'pending'`, row.ID).
		Scan(&pending.ID, &pending.Number)
	switch {
	case err == nil:
		row.Pending = &pending
	case !errors.Is(err, sql.ErrNoRows):
		return fmt.Errorf("billing: pending request: %w", err)
	}
	return nil
}
