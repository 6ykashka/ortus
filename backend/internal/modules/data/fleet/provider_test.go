package fleet_test

import (
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/internal/modules/data/fleet" //nolint:depguard // the package under test
)

// W2.57 (AC-06, Q-W2.07-1 «только рейс»): «Поездки» and «Расходы» leave out the trips the pool closes to the member
// ({{hidden}}, data.Hider) — the trip of a transfer and its expenses are not in «Данные» of its driver outside his grant,
// whatever his home role «Водитель» in scope self says; «Автомобили» are not rows of a trip.
func TestDatasetsHideClosedTrips(t *testing.T) {
	t.Parallel()
	const hidden = "{{hidden}}"
	want := map[string]bool{fleet.Vehicles: false, fleet.Trips: true, fleet.Expenses: true}
	specs := fleet.Provider{}.Datasets()
	if len(specs) != len(want) {
		t.Fatalf("%d datasets, want %d", len(specs), len(want))
	}
	for _, s := range specs {
		if got := strings.Contains(s.From+" "+s.Where, hidden); got != want[s.ID] {
			t.Errorf("%s: rows with %s — %v, want %v:\n%s\n%s", s.ID, hidden, got, want[s.ID], s.From, s.Where)
		}
	}
}
