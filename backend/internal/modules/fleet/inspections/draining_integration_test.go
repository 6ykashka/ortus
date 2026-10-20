//go:build integration

package inspections_test

import (
	"context"
	"strings"
	"testing"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
)

// setModuleState puts «Логистика» of tenant A (the row of the fixtures, logistics, and a contract-key row if any) in
// state.
func setModuleState(t *testing.T, state string) {
	t.Helper()
	exec(t, db(t, "a"), `update modules.installations set state = $1 where module_key in ('fleet', 'logistics')`, state)
}

// AC-12, Q-W2.32-3 (W2.60): while «Логистика» drains the gateway lets submitInspection through (it does not see the
// kind), so the handler closes the departure — a new trip — like startTrip: 403 module_read_only before the body is
// checked, nothing written. The return of a started (returning) trip is recorded; enabled again, departures pass.
func TestSubmitWhileDraining(t *testing.T) { //nolint:paralleltest // changes the module of tenant A; the parallel tests of the package run after it
	e := newEnv(t)
	ctx := t.Context()
	d := db(t, "a")
	driver := e.tc(t, "a.driver-msk1", "a")
	started := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	if _, err := e.svc.Submit(ctx, driver, e.departure(t, started)); err != nil {
		t.Fatal(err)
	}
	returning(t, started)
	t.Cleanup(func() { // trips_active_driver_uq: the parallel tests return trips of the same driver
		_, _ = d.ExecContext(context.WithoutCancel(ctx), `update fleet.trips set state = 'accepted' where id = $1`, started.ID)
	})
	fresh := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	setModuleState(t, "draining")
	t.Cleanup(func() {
		_, _ = d.ExecContext(context.WithoutCancel(ctx),
			`update modules.installations set state = 'enabled' where module_key in ('fleet', 'logistics')`)
	})

	const detail = "Модуль «Логистика» отключается: можно только завершить начатую работу."
	for name, body := range map[string]fleetapi.InspectionCreate{
		"departure":            e.departure(t, fresh),
		"departure, bare body": {Kind: "departure"},
	} {
		if _, err := e.svc.Submit(ctx, driver, body); !isCode(err, "module_read_only") || !strings.Contains(err.Error(), detail) {
			t.Errorf("%s while draining: %v, want module_read_only %q", name, err, detail)
		}
	}
	n := scalar[int](t, d, `select count(*) from fleet.inspections where trip_id = $1`, fresh.ID)
	expect(t, "nothing written", n, n == 0)

	ret, err := e.svc.Submit(ctx, driver, e.returnBody(t, started, "48500"))
	expect(t, "return while draining", ret, err == nil, ret.Kind == "return", ret.TripId != nil && *ret.TripId == started.ID)

	setModuleState(t, "enabled")
	if _, err := e.svc.Submit(ctx, driver, e.departure(t, fresh)); err != nil {
		t.Errorf("departure with the module enabled: %v", err)
	}
}
