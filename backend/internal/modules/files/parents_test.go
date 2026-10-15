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
