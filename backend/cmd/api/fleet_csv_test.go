package main

import (
	"testing"
	"time"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	fleetcsv "github.com/ortus/ortus-crm/backend/internal/modules/fleet/csv"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
)

// Operations of the tag Fleet of W2.50: the CSV import of vehicles (D-11 комплекта, fleet/csv).
var fleetW250 = []string{"createVehicleImport", "getVehicleImport", "commitVehicleImport"}

// fleetCSV overlays the CSV import of vehicles of W2.50 on the base of the tag: its operations reach the module, wired
// on the pools, the evaluator and the clock of the application; the others go down.
func TestFleetCSV(t *testing.T) {
	t.Parallel()
	ev := authz.New(nil, nil, time.Now)
	at := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	srv := fleetCSV(nil, noPools{}, ev, func() time.Time { return at })
	s, ok := srv.(fleetcsv.Server)
	if !ok || s.Imports == nil || s.Imports.Authz != ev || s.Imports.Pools == nil || s.Imports.Now == nil || !s.Imports.Now().Equal(at) {
		t.Fatalf("fleet server %#v, want the CSV import of W2.50 on the evaluator and the clock of main", srv)
	}
	pending := fleetPendingOps(srv)
	for _, id := range fleetW250 {
		if pending[id] {
			t.Errorf("%s pending, want served by W2.50", id)
		}
	}
	// 49 operations of the tag Fleet (48 of contract 0.6.1-stage2, W2.52, and chooseReservation of W2.71, 0.7.1-stage4).
	if len(pending) != 49-len(fleetW250) {
		t.Errorf("%d pending, want %d", len(pending), 49-len(fleetW250))
	}
}

// underCSV requires the CSV import of W2.50 on top of srv, on the evaluator ev, and returns the server under it.
func underCSV(t *testing.T, srv fleetapi.StrictServerInterface, ev *authz.Evaluator) fleetapi.StrictServerInterface {
	t.Helper()
	s, ok := srv.(fleetcsv.Server)
	if !ok || s.Imports == nil || s.Imports.Authz != ev {
		t.Fatalf("fleet server %#v, want the CSV import of W2.50 on top", srv)
	}
	return s.StrictServerInterface
}
