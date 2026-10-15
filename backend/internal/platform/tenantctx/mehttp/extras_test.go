package mehttp

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	contextapi "github.com/ortus/ortus-crm/backend/internal/api/context"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// fakeExtras answers tenantState and modules per tenant; a tenant listed in down fails.
type fakeExtras struct {
	down   map[uuid.UUID]bool
	withDB map[uuid.UUID]bool
	caps   map[uuid.UUID]int
}

func (f *fakeExtras) TenantState(_ context.Context, m tenantctx.Membership, withDB bool) (*contextapi.TenantState, error) {
	f.withDB[m.TenantID] = withDB
	if f.down[m.TenantID] {
		return nil, errors.New("control DB down")
	}
	return &contextapi.TenantState{Status: contextapi.TenantStateStatus(m.TenantState), StorageWriteStatus: "allowed"}, nil
}

func (f *fakeExtras) Modules(_ context.Context, tc tenantctx.TenantContext, state string, caps []contextapi.ScopedCapability) ([]contextapi.ModuleAvailability, error) {
	f.caps[tc.TenantID] = len(caps)
	if f.down[tc.TenantID] {
		return nil, errors.New("tenant DB down")
	}
	return []contextapi.ModuleAvailability{{ModuleKey: "fleet", State: "active", AccessMode: "read", Reason: contextapi.ModuleAvailabilityReason(state)}}, nil
}

// W1.08 (Q-W0.09-7): modules и tenantState — из Extras; у каждой видимой организации есть tenantState, модули — только
// у активного членства организации с данными; сбой Extras не роняет ответ и не трогает остальное.
func TestMeContextExtras(t *testing.T) {
	t.Parallel()
	s, _ := newServer()
	ex := &fakeExtras{down: map[uuid.UUID]bool{lotos: true}, withDB: map[uuid.UUID]bool{}, caps: map[uuid.UUID]int{}}
	s.Extras = ex
	me, err := get(t, s, zimina)
	if err != nil {
		t.Fatal(err)
	}
	byID := map[uuid.UUID]contextapi.TenantContext{}
	for _, tn := range me.Tenants {
		byID[tn.TenantId] = tn
	}
	checkExtras(t, ex, byID)
}

func checkExtras(t *testing.T, ex *fakeExtras, byID map[uuid.UUID]contextapi.TenantContext) {
	t.Helper()
	a := byID[alta]
	if a.TenantState == nil || a.TenantState.Status != "trial" || len(a.Modules) != 1 || a.Modules[0].Reason != "trial" ||
		ex.caps[alta] != len(a.Capabilities) || !ex.withDB[alta] {
		t.Errorf("Альта: %+v (caps passed %d)", a, ex.caps[alta])
	}
	l := byID[lotos]
	if l.TenantState != nil || len(l.Modules) != 0 || len(l.Capabilities) == 0 {
		t.Errorf("Лотос (extras down): %+v", l)
	}
	if len(byID) != 2 {
		t.Errorf("visible tenants: %d", len(byID))
	}
}
