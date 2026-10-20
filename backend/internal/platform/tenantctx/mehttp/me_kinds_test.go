package mehttp

import (
	"slices"
	"testing"

	"github.com/google/uuid"

	contextapi "github.com/ortus/ortus-crm/backend/internal/api/context"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// /me/context (W4.01): возможности видов областей этапов 4–7 приходят со своим Scope.kind и объектом — меню и гейты
// считают canAny по ним (PD-53, Q-W0.11-1); relation — без объекта; склад (вида в контракте нет) пропускается.
func TestCapabilitiesStage4Kinds(t *testing.T) {
	t.Parallel()
	ref := uuid.New()
	kinds := []contextapi.ScopeKind{contextapi.Space, contextapi.Page, contextapi.Folder, contextapi.Doc, contextapi.Account,
		contextapi.Chat, contextapi.RepairProject}
	var grants []tenantctx.Grant
	for _, k := range kinds {
		grants = append(grants, tenantctx.Grant{Action: "knowledge.read", ScopeKind: string(k), ScopeRef: &ref})
	}
	grants = append(grants, tenantctx.Grant{Action: "chat.read", ScopeKind: "relation"},
		tenantctx.Grant{Action: "inventory.read", ScopeKind: "warehouse", ScopeRef: &ref})
	got := capabilities(grants)
	if len(got) != len(kinds)+1 {
		t.Fatalf("capabilities = %+v, want %d", got, len(kinds)+1)
	}
	for i, k := range kinds {
		if c := got[i]; c.Scope.Kind != k || !slices.Equal(c.Scope.ResourceIds, []uuid.UUID{ref}) || c.Scope.IncludeDescendants {
			t.Errorf("%s: %+v", k, c)
		}
	}
	if c := got[len(kinds)]; c.Scope.Kind != contextapi.Relation || c.Scope.ResourceIds == nil || len(c.Scope.ResourceIds) != 0 {
		t.Errorf("relation: %+v", c)
	}
}
