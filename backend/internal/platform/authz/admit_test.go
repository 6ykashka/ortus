package authz

import (
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
)

type admitCase struct {
	name   string
	person uuid.UUID
	op     Operation
	code   string
}

func op(xScope string, perms ...string) Operation {
	return Operation{Permissions: perms, Mode: "all", Scope: xScope}
}

// Шлюз: грант засчитывается, если x-scope операции допускает вид его области (объект проверит хендлер).
func TestAdmitByOperationScope(t *testing.T) {
	t.Parallel()
	ev, _ := newWorld(t)
	for _, tc := range []admitCase{
		{"подразделение на tenant-or-org-unit", pRegion, op("tenant-or-org-unit", aMembersRead), ""},
		{"подразделение на tenant", pRegion, op("tenant", aMembersRead), codeForbidden},
		{"организация на tenant", pAdmin, op("tenant", aMembersRead), ""},
		{"PD-53: проект на tenant-or-org-unit", pLead, op("tenant-or-org-unit", aProjectsManage), codeForbidden},
		{"PD-53: проект на tenant-org-unit-project", pLead, op("tenant-org-unit-project", aProjectsRead), ""},
		{"своё на tenant-org-unit-self", pDriver, op("tenant-org-unit-self", aTripsRead), ""},
		{"своё на tenant-org-unit-resource-pool", pDriver, op("tenant-org-unit-resource-pool", aVehiclesRead), codeForbidden},
		{"временное назначение на подразделение", pTemp, op("tenant-org-unit-resource-pool", aVehiclesRead), ""},
		{"истёкшее назначение", pExpired, op("tenant-or-org-unit", aMembersRead), codeForbidden},
		{"объект владельца файла — любой вид", pLead, op("owning-object-scope", "files.read"), ""},
		{"неизвестный вид области", pGalaxy, op("owning-object-scope", aVehiclesRead), codeForbidden},
		{"tenant-owner: администратор", pAdmin, op("tenant-owner", aMembersManage), codeForbidden},
		{"tenant-owner: владелец", pOwner, op("tenant-owner", aMembersManage), ""},
		{"owner_only в роли", pAdmin, op("tenant", aBillingManage), codeForbidden},
		{"владелец или billing-менеджер", pAdmin, op("tenant-owner-or-billing-manager", aBillingRead), ""},
		{"billing-менеджер только на организацию", pRegion, op("tenant-owner-or-billing-manager", aBillingRead), codeForbidden},
		{"функция driver", pDriver, op("responsible-manager-or-owner-only", aEarningsRead), codeBlocked},
		{"владелец с функцией driver", pOwnerDriver, op("responsible-manager-or-owner-only", aEarningsRead), codeBlocked},
		{"владелец", pOwner, op("tenant-org-unit-self", aTripsRead, aEarningsRead), ""},
		{"нет действия", pNobody, op("tenant", aMembersRead), codeForbidden},
		{"неизвестное действие", pOwner, op("tenant", "fleet.teleport"), codeForbidden},
		{"неизвестный x-scope — только организация", pRegion, op("galaxy-wide", aMembersRead), codeForbidden},
		{"без x-permissions", pNobody, Operation{Scope: "tenant"}, ""},
		{"tenant-owner без x-permissions: участник", pAdmin, Operation{Scope: "tenant-owner"}, codeForbidden},
		{"tenant-owner без x-permissions: без грантов", pNobody, Operation{Scope: "tenant-owner"}, codeForbidden},
		{"tenant-owner без x-permissions: владелец", pOwner, Operation{Scope: "tenant-owner"}, ""},
	} {
		wantCode(t, tc.name, ev.Admit(t.Context(), member(tc.person), tc.op), tc.code)
	}
}

// x-permissions-mode: all — каждое действие, any — хотя бы одно.
func TestAdmitMode(t *testing.T) {
	t.Parallel()
	ev, _ := newWorld(t)
	both := []string{aMembersRead, aCashRead}
	wantCode(t, "all", ev.Admit(t.Context(), member(pRegion), Operation{Permissions: both, Mode: "all", Scope: "tenant-or-org-unit"}), codeForbidden)
	wantCode(t, "any", ev.Admit(t.Context(), member(pRegion), Operation{Permissions: both, Mode: "any", Scope: "tenant-or-org-unit"}), "")
	wantCode(t, "по умолчанию all", ev.Admit(t.Context(), member(pRegion), Operation{Permissions: both, Scope: "tenant-or-org-unit"}), codeForbidden)
}

// Gateway — tenantctx.Authorizer для шлюза cmd/api: без x-scope засчитывается только область организации.
func TestGatewayAdapter(t *testing.T) {
	t.Parallel()
	ev, src := newWorld(t)
	g := Gateway{E: ev}
	wantCode(t, "Permit без x-scope", g.Permit(t.Context(), member(pRegion), []string{aMembersRead}, "all"), codeForbidden)
	wantCode(t, "Admit с x-scope", g.Admit(t.Context(), member(pRegion), op("tenant-or-org-unit", aMembersRead)), "")
	wantCode(t, "владелец", g.Permit(t.Context(), member(pOwner), []string{aMembersRead}, "all"), "")
	src.err = errBoom
	wantCode(t, "сбой источника", g.Permit(t.Context(), member(pRegion), []string{aMembersRead}, "all"), codeDep)
}

// Таблица x-scope покрывает каждую tenant-операцию контракта: новая область операции без строки таблицы — красный тест.
func TestEveryTenantOperationScopeIsKnown(t *testing.T) {
	t.Parallel()
	seen := 0
	for _, o := range catalog.Operations {
		if !strings.HasPrefix(o.Path, "/api/v1/tenants/{tenantId}/") || o.Public {
			continue
		}
		seen++
		if _, ok := xScopes[o.Scope]; !ok {
			t.Errorf("%s: x-scope %q is not in xScopes", o.ID, o.Scope)
		}
	}
	if seen < 100 {
		t.Fatalf("tenant operations in the catalog: %d, want ≥ 100", seen)
	}
	for xs, a := range xScopes {
		for _, k := range a.kinds {
			if _, ok := FutureKinds[k]; !ok && !isPilotKind(k) {
				t.Errorf("x-scope %s admits unknown kind %q", xs, k)
			}
		}
	}
}

func isPilotKind(k string) bool {
	for _, p := range PilotKinds() {
		if p.Key() == k {
			return true
		}
	}
	return false
}
