package main

import (
	"testing"
	"time"

	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/expenses"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/trips"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
)

// Operations of the tag Fleet of W2.05: the trip of the driver (fleet/trips) and its expenses (fleet/expenses). The
// trip card (getTripPlan, listTripPlans) is the read of W2.03 in the base of the tag (Q-W2.05-3).
var fleetW205 = []string{
	"startTrip", "getTrip", "listTrips", "finishTripRoute", "returnTrip",
	"createTripExpense", "listTripExpenses", "getTripExpense",
}

// fleetTrips overlays the trips and the expenses of W2.05 on the base of the tag: their operations reach the modules,
// wired on the pools, the evaluator, the inbox port of W1.10 and the clock of the application; the others go down —
// the trip card of W2.03 too, so main has one copy of getTripPlan and listTripPlans.
func TestFleetTrips(t *testing.T) {
	t.Parallel()
	ev := authz.New(nil, nil, time.Now)
	at := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	srv := fleetTrips(nil, noPools{}, ev, nil, func() time.Time { return at })
	checkFleetTripsWiring(t, srv, ev, at)
	pending := fleetPendingOps(srv)
	for _, id := range fleetW205 {
		if pending[id] {
			t.Errorf("%s pending, want served by W2.05", id)
		}
	}
	for _, id := range fleetW203 {
		if !pending[id] {
			t.Errorf("%s served by the overlay of W2.05, want the base (W2.03)", id)
		}
	}
	if len(pending) != 49-len(fleetW205) {
		t.Errorf("%d pending, want %d", len(pending), 49-len(fleetW205))
	}
}

// checkFleetTripsWiring: the expenses on top of the trips, both on the evaluator and the clock of main; the trips
// notify through the inbox port.
func checkFleetTripsWiring(t *testing.T, srv any, ev *authz.Evaluator, at time.Time) {
	t.Helper()
	x, ok := srv.(expenses.Server)
	if !ok || x.S == nil || x.S.Authz != ev || x.S.Now == nil {
		t.Fatalf("fleet server %#v, want the expenses of W2.05 on top", srv)
	}
	tr, ok := x.StrictServerInterface.(trips.Server)
	if !ok || tr.S == nil || tr.S.Authz != ev || tr.S.Now == nil {
		t.Fatalf("base %#v, want the trips of W2.05", x.StrictServerInterface)
	}
	if !x.S.Now().Equal(at) || !tr.S.Now().Equal(at) {
		t.Fatal("the clock of the application is not passed")
	}
	if _, ok := tr.S.Audience.(inbox.AuthzAudience); !ok || tr.S.Recipients == nil {
		t.Fatalf("notifications of the trips: %#v %#v", tr.S.Recipients, tr.S.Audience)
	}
}
