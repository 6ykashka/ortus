package authz

import (
	"context"
	"errors"
	"slices"
	"testing"

	contextapi "github.com/ortus/ortus-crm/backend/internal/api/context"
)

type namedKind struct {
	objectKind
	name string
}

func (k namedKind) Key() string { return k.name }

func (namedKind) Covers(context.Context, Scope, Subject, Resource) (bool, error) { return true, nil }

// Реестр явный: пустой ключ и повтор вида — ошибки; новый вид модуля добавляется без правки ядра (ADR-0014).
func TestNewRegistry(t *testing.T) {
	t.Parallel()
	if _, err := NewRegistry(append(PilotKinds(), namedKind{name: KindProject})...); !errors.Is(err, ErrDuplicateKind) {
		t.Errorf("duplicate kind: %v, want ErrDuplicateKind", err)
	}
	if _, err := NewRegistry(namedKind{name: ""}); !errors.Is(err, ErrEmptyKind) {
		t.Errorf("empty kind: %v, want ErrEmptyKind", err)
	}
	reg, err := NewRegistry(append(PilotKinds(), namedKind{name: "space"})...)
	if err != nil {
		t.Fatal(err)
	}
	if k, ok := reg.Kind("space"); !ok || !k.ObjectBound() {
		t.Errorf("space: %v %v", k, ok)
	}
	if _, ok := reg.Kind("galaxy"); ok {
		t.Error("galaxy must be unknown")
	}
}

// Виды этапа 1, объектные — проект, склад, ресурс (PD-53); соответствие видам Scope.kind контракта.
func TestPilotKinds(t *testing.T) {
	t.Parallel()
	reg, err := NewRegistry(PilotKinds()...)
	if err != nil {
		t.Fatal(err)
	}
	if got := reg.Keys(); !slices.Equal(got, []string{KindTenant, KindUnit, KindSelf, KindProject, KindWarehouse, KindResource}) {
		t.Errorf("pilot kinds = %v", got)
	}
	api := map[string]string{}
	for _, key := range reg.Keys() {
		k, _ := reg.Kind(key)
		if bound := slices.Contains([]string{KindProject, KindWarehouse, KindResource}, key); k.ObjectBound() != bound {
			t.Errorf("%s: ObjectBound = %v, want %v", key, k.ObjectBound(), bound)
		}
		api[k.APIKind()] = key
	}
	for _, kind := range []contextapi.ScopeKind{contextapi.Tenant, contextapi.OrgUnit, contextapi.Project, contextapi.Self, contextapi.ResourcePool} {
		if _, ok := api[string(kind)]; !ok {
			t.Errorf("Scope.kind %q of the contract has no kind in the registry", kind)
		}
	}
	if api[APIKindOrgUnit] != KindUnit || api[APIKindResourcePool] != KindResource {
		t.Errorf("unit ↔ org_unit, resource ↔ resource_pool: %v", api)
	}
}
