package mehttp

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	contextapi "github.com/ortus/ortus-crm/backend/internal/api/context"
)

// fakeBranding answers the theme per tenant; a tenant listed in down fails.
type fakeBranding struct{ down map[uuid.UUID]bool }

func (f fakeBranding) Theme(_ context.Context, tenantID uuid.UUID) (*contextapi.BrandingTheme, error) {
	if f.down[tenantID] {
		return nil, errors.New("control DB down")
	}
	return &contextapi.BrandingTheme{Version: 2, DisplayName: tenantID.String(), AccentUsed: "#1F6B52"}, nil
}

// W4.60: у каждой видимой организации — тема оформления (одна на всех участников, без чтения БД организации); сбой
// источника оставляет branding пустым у этой организации и не роняет ответ.
func TestMeContextBranding(t *testing.T) {
	t.Parallel()
	s, _ := newServer()
	s.Branding = fakeBranding{down: map[uuid.UUID]bool{lotos: true}}
	me, err := get(t, s, zimina)
	if err != nil {
		t.Fatal(err)
	}
	got := map[uuid.UUID]int{}
	for _, tn := range me.Tenants {
		if tn.Branding != nil {
			got[tn.TenantId] = tn.Branding.Version
		} else {
			got[tn.TenantId] = 0
		}
	}
	if len(got) != 2 || got[alta] != 2 || got[lotos] != 0 {
		t.Errorf("branding by tenant: %v", got)
	}
}
