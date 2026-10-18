package main

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"slices"
	"time"
)

// Stand part of the seed (W2.54, Q-W2.02-5 and the remarks of the stand of 18.10): what the local stand needs beyond
// the seed of 14.10 of MSW. The access of accessOf stays the baseSeed of MSW (SPA only); the stand switches
// «Логистика» on in «Альта» with the code of the demo (demo.go), so that the drivers of «Альта» see their trips of
// today (fleet_trips.go) without the owner switching the module on. The subscriptions of the operator registry follow
// the run of the seed as the trips do: the prototype lives on 01.10.2026, the stand on the real clock.

// standModules are the modules the base seed switches on in a tenant beyond accessOf.
var standModules = map[string][]string{protoAlta: {demoModule}}

// writeStand switches the modules of the stand on in td; policy_version + 1 when anything changed. A second run
// changes nothing; a module switched off on the stand is switched on again by the next run.
func writeStand(ctx context.Context, tx *sql.Tx, td tenantData) error {
	owner := seedID(td.tenant.proto, memberOwner)
	var changed int64
	for _, key := range standModules[td.tenant.proto] {
		n, err := enableModule(ctx, tx, owner, key)
		if err != nil {
			return fmt.Errorf("stand: %w", err)
		}
		changed += n
	}
	if changed == 0 {
		return nil
	}
	return bumpPolicy(ctx, tx)
}

// prototypeDay is the day the prototype lives on (MSW: 01.10.2026 10:30 Europe/Moscow).
var prototypeDay = time.Date(2026, time.October, 1, 0, 0, 0, 0, msk)

// seedShift is the number of days from the day of the prototype to the day of now (Moscow).
func seedShift(now time.Time) int {
	local := now.In(msk)
	day := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, msk)
	return int(math.Round(day.Sub(prototypeDay).Hours() / 24))
}

// subscriptionsAt returns the subscriptions of the seed for a run at now: every date of subscriptionDefs moves by
// seedShift days, so the trial of «Альта» ends 12 days after the day of the run, as on 01.10 → 13.10 of MSW.
func subscriptionsAt(now time.Time) []subscriptionDef {
	days := seedShift(now)
	shift := func(t *time.Time) *time.Time {
		if t == nil {
			return nil
		}
		moved := t.AddDate(0, 0, days)
		return &moved
	}
	out := slices.Clone(subscriptionDefs)
	for i := range out {
		out[i].from, out[i].end = shift(out[i].from), shift(out[i].end)
	}
	return out
}
