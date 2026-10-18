package data

import (
	"errors"
	"slices"
	"testing"
)

type provider struct {
	module string
	specs  []Spec
}

func (p provider) Module() string   { return p.module }
func (p provider) Datasets() []Spec { return p.specs }

func ids(entries []entry) []string {
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		out = append(out, e.module+":"+e.spec.ID)
	}
	return out
}

// The registry keeps the order of the providers and of their datasets (the order of the catalog) and finds a
// dataset by id with its module.
func TestRegistry(t *testing.T) {
	t.Parallel()
	r, err := NewRegistry(
		provider{"fleet", []Spec{{ID: "fleet.vehicles"}, {ID: "fleet.trips"}}},
		provider{"repairs", []Spec{{ID: "repairs.projects"}}},
	)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := ids(r.all()), []string{"fleet:fleet.vehicles", "fleet:fleet.trips", "repairs:repairs.projects"}; !slices.Equal(got, want) {
		t.Fatalf("all %v, want %v", got, want)
	}
	if got, want := r.IDs(), []string{"fleet.vehicles", "fleet.trips", "repairs.projects"}; !slices.Equal(got, want) {
		t.Fatalf("IDs %v, want %v", got, want)
	}
	e, ok := r.lookup("fleet.trips")
	if !ok || e.module != "fleet" || e.spec.ID != "fleet.trips" {
		t.Fatalf("lookup fleet.trips: %v %v", e, ok)
	}
	if _, ok := r.lookup("fleet.earnings"); ok {
		t.Fatal("an unknown dataset was found")
	}
	var empty *Registry
	if empty.all() != nil {
		t.Fatal("nil registry has datasets")
	}
	if _, ok := empty.lookup("fleet.trips"); ok {
		t.Fatal("nil registry finds a dataset")
	}
}

func TestRegistryRefusesWiringErrors(t *testing.T) {
	t.Parallel()
	if _, err := NewRegistry(nil); !errors.Is(err, ErrNilProvider) {
		t.Fatalf("nil provider: %v", err)
	}
	_, err := NewRegistry(provider{"fleet", []Spec{{ID: "fleet.trips"}}}, provider{"other", []Spec{{ID: "fleet.trips"}}})
	if !errors.Is(err, ErrDuplicateDataset) {
		t.Fatalf("duplicate id: %v", err)
	}
}
