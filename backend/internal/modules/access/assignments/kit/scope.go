package kit

import (
	"github.com/google/uuid"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
)

// apiKinds maps Scope.kind of the contract to access.role_assignments.scope_kind (ADR-0014 п.7: org_unit ↔ unit,
// resource_pool ↔ resource; the kinds of stages 4–7 have the same name, W4.01). warehouse has no kind in the contract.
var apiKinds = map[accessapi.ScopeKind]string{
	accessapi.ScopeKindTenant:        authz.KindTenant,
	accessapi.ScopeKindOrgUnit:       authz.KindUnit,
	accessapi.ScopeKindSelf:          authz.KindSelf,
	accessapi.ScopeKindProject:       authz.KindProject,
	accessapi.ScopeKindResourcePool:  authz.KindResource,
	accessapi.ScopeKindSpace:         authz.KindSpace,
	accessapi.ScopeKindPage:          authz.KindPage,
	accessapi.ScopeKindFolder:        authz.KindFolder,
	accessapi.ScopeKindDoc:           authz.KindDoc,
	accessapi.ScopeKindAccount:       authz.KindAccount,
	accessapi.ScopeKindChat:          authz.KindChat,
	accessapi.ScopeKindRepairProject: authz.KindRepairProject,
	accessapi.ScopeKindRelation:      authz.KindRelation,
}

// ScopeFromAPI validates a Scope of the contract and returns the scope of the tenant DB: tenant, self and relation
// take no resourceIds, the other kinds exactly one (a row of access.role_assignments has one scope_ref). Only org_unit
// keeps includeDescendants.
func ScopeFromAPI(s accessapi.Scope) (authz.Scope, error) {
	kind, ok := apiKinds[s.Kind]
	if !ok {
		return authz.Scope{}, Validation("Такая область назначения на этом этапе недоступна.")
	}
	switch kind {
	case authz.KindTenant, authz.KindSelf, authz.KindRelation:
		if len(s.ResourceIds) != 0 {
			return authz.Scope{}, Validation("Для этой области не указывают подразделение или объект.")
		}
		return authz.Scope{Kind: kind, Descendants: kind == authz.KindTenant}, nil
	}
	if len(s.ResourceIds) != 1 || s.ResourceIds[0] == uuid.Nil {
		return authz.Scope{}, Validation("Выберите область действия.")
	}
	return authz.Scope{Kind: kind, Ref: s.ResourceIds[0], Descendants: kind == authz.KindUnit && s.IncludeDescendants}, nil
}

// ScopeToAPI returns the Scope of the contract for a scope of the tenant DB.
func ScopeToAPI(s authz.Scope) accessapi.Scope {
	out := accessapi.Scope{ResourceIds: []accessapi.Id{}, IncludeDescendants: s.Descendants}
	for k, v := range apiKinds {
		if v == s.Kind {
			out.Kind = k
		}
	}
	switch s.Kind {
	case authz.KindTenant:
		out.IncludeDescendants = true
	case authz.KindSelf, authz.KindRelation:
		out.IncludeDescendants = false
	default:
		out.ResourceIds = []accessapi.Id{s.Ref}
		out.IncludeDescendants = s.Kind == authz.KindUnit && s.Descendants
	}
	return out
}
