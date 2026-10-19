package files_test

import (
	"slices"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/internal/modules/files" //nolint:depguard // the package under test
)

// Parents of the pilot (tenant 0002): reservation and trip carry inspection photos before the inspection exists,
// the trip and the expense carry receipts (UploadCreate). Each names the action that makes it visible.
func TestFleetParents(t *testing.T) {
	t.Parallel()
	p, err := files.NewParents(files.FleetParents()...)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"fleet.expense", "fleet.inspection", "fleet.reservation", "fleet.trip", "fleet.vehicle"}
	if got := p.Keys(); !slices.Equal(got, want) {
		t.Fatalf("keys %v, want %v", got, want)
	}
	read := map[string]string{
		"fleet.trip": "fleet.trips.read", "fleet.reservation": "fleet.reservations.read",
		"fleet.vehicle": "fleet.vehicles.read", "fleet.inspection": "fleet.inspections.read",
		"fleet.expense": "fleet.expenses.read",
	}
	for key, action := range read {
		module, entity, _ := strings.Cut(key, ".")
		k, ok := p.Kind(module, entity)
		if !ok || k.ReadAction != action || !strings.Contains(k.Rows, files.IDPlaceholder) {
			t.Errorf("%s: %+v %v", key, k, ok)
		}
	}
	trip, _ := p.Kind("fleet", "trip")
	if !trip.Allows(files.PurposeInspection) || !trip.Allows(files.PurposeExpenseReceipt) || trip.Allows(files.PurposeFormAttachment) {
		t.Errorf("trip purposes %v", trip.Purposes)
	}
	if _, ok := p.Kind("tasks", "task"); ok {
		t.Error("an unregistered kind is found")
	}
}

// W2.57 (AC-06, Q-W2.07-1 «только рейс»): the parents that belong to a trip — the trip, its reservation, its
// inspection and its expense — leave out the trips the pool closes to the subject ({{hidden}}, files.Hider): the
// files of a trip of a transfer answer its driver 404 outside his grant whatever his home role in scope self says. A
// vehicle is not a parent of a trip (scope resource of the grant of the vehicle of the trip, closed with the window).
func TestFleetParentsHideClosedTrips(t *testing.T) {
	t.Parallel()
	const hidden = "{{hidden}}"
	p, err := files.NewParents(files.FleetParents()...)
	if err != nil {
		t.Fatal(err)
	}
	for key, want := range map[string]bool{
		"fleet.trip": true, "fleet.reservation": true, "fleet.inspection": true, "fleet.expense": true, "fleet.vehicle": false,
	} {
		module, entity, _ := strings.Cut(key, ".")
		k, _ := p.Kind(module, entity)
		if got := strings.Contains(k.Rows, hidden); got != want {
			t.Errorf("%s: rows with %s — %v, want %v:\n%s", key, hidden, got, want, k.Rows)
		}
	}
}

// W2.57, return 2 (D09): a trip left to its continuation (the grant of its driver is closing) closes only its
// reservation as a parent ({{continued}}) — a departure photo is new work, as startTrip and the departure inspection
// by that reservation are in the overlay of the tag Fleet; the photos of the trip, its inspections and the receipts of
// its expenses stay open (the return, its photos and the expenses of this trip).
func TestFleetParentsCloseTheContinuedReservation(t *testing.T) {
	t.Parallel()
	const continued = "{{continued}}"
	p, err := files.NewParents(files.FleetParents()...)
	if err != nil {
		t.Fatal(err)
	}
	for key, want := range map[string]bool{
		"fleet.trip": false, "fleet.reservation": true, "fleet.inspection": false, "fleet.expense": false, "fleet.vehicle": false,
	} {
		module, entity, _ := strings.Cut(key, ".")
		k, _ := p.Kind(module, entity)
		if got := strings.Contains(k.Rows, continued); got != want {
			t.Errorf("%s: rows with %s — %v, want %v:\n%s", key, continued, got, want, k.Rows)
		}
	}
}

func TestNewParentsRejectsBrokenKinds(t *testing.T) {
	t.Parallel()
	good := files.ParentKind{
		Module: "fleet", Entity: "trip", ReadAction: "fleet.trips.read", Purposes: []files.Purpose{files.PurposeInspection},
		Rows: "select t.unit_id, null::uuid as project_id, null::uuid as person_a, null::uuid as person_b, t.number " +
			"from fleet.trips t where t.id = " + files.IDPlaceholder,
	}
	broken := map[string]func(*files.ParentKind){
		"duplicate":      nil,
		"bad module":     func(k *files.ParentKind) { k.Module = "Fleet" },
		"bad entity":     func(k *files.ParentKind) { k.Entity = "trip'; drop" },
		"no read action": func(k *files.ParentKind) { k.ReadAction = "" },
		"no purposes":    func(k *files.ParentKind) { k.Purposes = nil },
		"no id":          func(k *files.ParentKind) { k.Rows = "select 1" },
	}
	for name, edit := range broken {
		k := good
		kinds := []files.ParentKind{good}
		if edit != nil {
			edit(&k)
			kinds = []files.ParentKind{k}
		} else {
			kinds = append(kinds, good)
		}
		if _, err := files.NewParents(kinds...); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}
