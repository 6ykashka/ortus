//go:build integration

package trips_test

import (
	"testing"
)

// W2.50 (D-11 комплекта): the plan of a trip the driver reads carries the address of a stop for the navigator
// (fleet.trip_stops.navigation_address, tenant 0017); a stop without it has none.
func TestPlanNavigationAddress(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	tr := seedTrip(t, "a", "msk1", ref("person:a.driver-msk1@a"))
	exec(t, db(t, "a"), `update fleet.trip_stops set navigation_address = 'Лобня, ул. Лейтенанта Бакина, 1'
		where trip_id = $1 and seq = 1`, tr.ID)
	p, err := e.svc.Plan(t.Context(), e.tc(t, "a.driver-msk1", "a"), tr.ID)
	if err != nil {
		t.Fatal(err)
	}
	first, second := p.Stops[0].NavigationAddress, p.Stops[1].NavigationAddress
	expect(t, "stops", p.Stops, first != nil && *first == "Лобня, ул. Лейтенанта Бакина, 1", second == nil)
}
