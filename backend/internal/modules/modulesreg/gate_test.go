package modulesreg

import (
	"errors"
	"testing"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

func operation(t *testing.T, id string) catalog.Operation {
	t.Helper()
	for _, op := range catalog.Operations {
		if op.ID == id {
			return op
		}
	}
	t.Fatalf("no operation %s in the contract", id)
	return catalog.Operation{}
}

// AC-12: гейт модуля на шлюзе. Модуль не подключён или выключен полностью — 403 module_not_installed; «только
// чтение» — чтение проходит, изменения 403 module_read_only; draining — чтение и завершение начатой работы.
func TestGate(t *testing.T) {
	t.Parallel()
	const ok = ""
	cases := []struct {
		op, state, want string
	}{
		{"listTrips", "", "module_not_installed"},
		{"listTrips", StateActive, ok},
		{"listTrips", StateDraining, ok},
		{"listTrips", StateReadOnly, ok},
		{"listTrips", StateDisabled, "module_not_installed"},
		{"startTrip", StateActive, ok},
		{"startTrip", StateDraining, "module_read_only"},
		{"startTrip", StateReadOnly, "module_read_only"},
		{"reserveVehicle", StateDraining, "module_read_only"},
		{"createTripPlan", StateDraining, "module_read_only"},
		// Q-W2.32-3 (W2.60): начатый рейс завершается на экране — «Завершить рейс» и осмотр при сдаче. Шлюз не видит
		// вид осмотра: осмотр перед выездом при draining закрывает обработчик осмотра (fleet/inspections).
		{"finishTripRoute", StateActive, ok},
		{"finishTripRoute", StateDraining, ok},
		{"finishTripRoute", StateReadOnly, "module_read_only"},
		{"submitInspection", StateDraining, ok},
		{"submitInspection", StateReadOnly, "module_read_only"},
		{"returnTrip", StateDraining, ok},
		{"returnTrip", StateReadOnly, "module_read_only"},
		{"createTripExpense", StateDraining, ok},
		{"reviewTrip", StateDraining, ok},
		{"reviewTripExpense", StateDraining, ok},
		{"releaseReservation", StateDraining, ok},
		{"setTripEarnings", StateDraining, ok},
		{"getTripEarnings", "", "module_not_installed"},
		{"getTripEarnings", StateReadOnly, ok},
		{"setTripEarnings", StateReadOnly, "module_read_only"},
	}
	for _, c := range cases {
		store := newStore()
		if c.state != "" {
			store.rows["fleet"] = Installation{Key: "fleet", StoredKey: "logistics", State: c.state, Revision: 2}
		}
		act := &fakeActivity{module: "fleet", started: true}
		err := Gate{S: service(t, store, act)}.Admit(t.Context(), ownerCtx, operation(t, c.op))
		if c.want == ok && err != nil || c.want != ok && !problem.Is(err, c.want) {
			t.Errorf("%s in %q: %v, want %q", c.op, c.state, err, c.want)
		}
	}
}

func TestGateOtherModules(t *testing.T) {
	t.Parallel()
	store := newStore(Installation{Key: "spa", StoredKey: "spa", State: StateDraining, Revision: 3},
		Installation{Key: "repairs", StoredKey: "repairs", State: StateDraining, Revision: 3})
	acts := []Activity{&fakeActivity{module: "spa", started: true}, &fakeActivity{module: "repairs", started: true}}
	g := Gate{S: service(t, store, acts...)}
	for id, want := range map[string]string{
		"completeAppointment":          "",
		"recordAppointmentPerformance": "",
		"createAppointment":            "module_read_only",
		"listAppointments":             "",
		"submitWorkLog":                "module_read_only",
		"listRepairProjects":           "",
		"listTaskProjects":             "",
		"createTaskProject":            "",
		"listModuleCatalog":            "",
	} {
		err := g.Admit(t.Context(), ownerCtx, operation(t, id))
		if want == "" && err != nil || want != "" && !problem.Is(err, want) {
			t.Errorf("%s: %v, want %q", id, err, want)
		}
	}
	broken := newStore()
	broken.err = errors.New("pool closed")
	err := Gate{S: service(t, broken)}.Admit(t.Context(), ownerCtx, operation(t, "listTrips"))
	wantCode(t, err, problem.CodeDependencyUnavailable)
	// Операции вне модулей не читают tenant DB.
	if err := (Gate{S: service(t, broken)}).Admit(t.Context(), ownerCtx, operation(t, "listMembers")); err != nil {
		t.Errorf("listMembers: %v", err)
	}
}
