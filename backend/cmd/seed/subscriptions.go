package main

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
)

// Subscriptions of the platform (W1.08): the subscriptions and entitlements of the four tenants of the prototype
// (design/ortus/mock-data.js baseSeed().platform.tenants), as the MSW adapter W0.13 projects them (core/project.ts
// subscription): plan tier, trial or plan source, seats, quota and the version of the plan as the revision.

// subscriptionDef is a subscription of the seed.
type subscriptionDef struct {
	tenant    string     // proto id
	plan      string     // tier
	state     string     // subscriptions.state: trial | active | grace | ended
	from, end *time.Time // period
	seats     int64
	quotaGiB  int64
	trial     bool  // entitlements come from the trial
	version   int64 // plan.version of the prototype: the revision of the subscription
}

// mskEndOfDay is the end of a day of Europe/Moscow ("13.10.2026" → 2026-10-13T21:00:00Z, mskEndOfDay of MSW).
func mskEndOfDay(day string) *time.Time {
	d, err := time.Parse("02.01.2006", day)
	if err != nil {
		panic(err) // fixed data
	}
	t := d.Add(21 * time.Hour).UTC()
	return &t
}

func seedDay(day string) *time.Time {
	d, err := time.Parse("02.01.2006", day)
	if err != nil {
		panic(err) // fixed data
	}
	return &d
}

// Prototype: Альта — trial till 13.10 (plan v2); Лотос — team paid till 31.03.2027; Ремстрой — trial ended 20.09
// (restricted → read_only); Карго — team paid till 15.09, suspended by the operator, past_due in MSW — stored as grace
// without an end (past_due is not set in the pilot, D-33; resuming returns grace, decision 3 of W1.00).
var subscriptionDefs = []subscriptionDef{
	{tenant: protoAlta, plan: "start", state: "trial", from: seedDay("29.09.2026"), end: mskEndOfDay("13.10.2026"), seats: 10, quotaGiB: 100, trial: true, version: 2},
	{tenant: protoLotos, plan: "team", state: "active", from: seedDay("01.04.2026"), end: mskEndOfDay("31.03.2027"), seats: 25, quotaGiB: 50, version: 1},
	{tenant: protoRemstroy, plan: "start", state: "ended", from: mskEndOfDay("20.09.2026"), seats: 10, quotaGiB: 25, trial: true, version: 1},
	{tenant: protoCargo, plan: "team", state: "grace", from: mskEndOfDay("15.09.2026"), seats: 25, quotaGiB: 100, version: 1},
}

// Tenants of the seed without a tenant DB in the stand.
const (
	protoRemstroy = "t-remstroy"
	protoCargo    = "t-cargo"
)

// priceBook is the price book version of sourceRef (price-book:v2:<tier>).
const priceBook = 2

// seedSubscriptions writes the subscriptions with the dates of the run (subscriptionsAt, W2.54); a subscription
// already in the database is left as it is.
func seedSubscriptions(ctx context.Context, tx *sql.Tx) error {
	for _, s := range subscriptionsAt(time.Now()) {
		tenantID := seedID(scopePlatform, s.tenant)
		if _, err := tx.ExecContext(ctx, `
insert into subscriptions (id, tenant_id, plan_code, period, state)
select $1, $2, $3, tstzrange($4, $5, '[]'), $6
 where not exists (select 1 from subscriptions where tenant_id = $2)`,
			seedID(scopePlatform, "subscription:"+s.tenant), tenantID, s.plan, s.from, s.end, s.state); err != nil {
			return fmt.Errorf("subscription %s: %w", s.tenant, err)
		}
		source := "plan"
		if s.trial {
			source = "trial"
		}
		ref := "price-book:v" + strconv.Itoa(priceBook) + ":" + s.plan
		for key, value := range map[string]int64{"seats": s.seats, "storage_quota_bytes": s.quotaGiB << 30} {
			unit := "bytes"
			if key == "seats" {
				unit = key
			}
			if _, err := tx.ExecContext(ctx, `
insert into entitlements (id, tenant_id, feature_key, source_type, source_ref, limit_value, limit_unit, effective, version, reason, actor_id)
values ($1, $2, $3, $4, $5, $6, $7, tstzrange($8, null), $9, 'Сид прототипа 14.10', $10)
on conflict (tenant_id, feature_key, version) do nothing`,
				seedID(scopePlatform, "entitlement:"+s.tenant+":"+key), tenantID, key, source, ref, value, unit, s.from, s.version,
				uuid.Nil); err != nil {
				return fmt.Errorf("entitlement %s %s: %w", s.tenant, key, err)
			}
		}
	}
	return nil
}
