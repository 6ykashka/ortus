package tenantctx

import (
	"context"
	"slices"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// Scope kinds of access.role_assignments.
const ScopeTenant = "tenant"

// Grant is one action granted to a person in the tenant DB, with the scope of its assignment.
type Grant struct {
	Action    string
	ScopeKind string     // tenant | unit | project | warehouse | resource | self
	ScopeRef  *uuid.UUID // nil for tenant and self
}

// GrantSource lists the grants of the person of tc (direct and through groups).
type GrantSource interface {
	Grants(ctx context.Context, tc TenantContext) ([]Grant, error)
}

// Authorizer decides whether the actor of tc may run an operation with x-permissions perms (mode all | any).
// The evaluator of W1.04 (permit(), scopes, restricted actions, driver function, PD-53) replaces GrantAuthorizer.
type Authorizer interface {
	Permit(ctx context.Context, tc TenantContext, perms []string, mode string) error
}

// GrantAuthorizer is the stage-0 permission check: an owner (OwnerBinding) has every tenant action; any other
// member has the actions of their assignments with the tenant scope. Narrower scopes (unit, project…) do not grant
// an operation without an object until the evaluator of W1.04: they fail closed.
type GrantAuthorizer struct {
	Source        GrantSource
	TenantActions []string // catalog.TenantActions
}

// Permit returns nil or forbidden_action; a failing grant source gives dependency_unavailable.
func (a *GrantAuthorizer) Permit(ctx context.Context, tc TenantContext, perms []string, mode string) error {
	if len(perms) == 0 {
		return nil
	}
	have := map[string]bool{}
	if tc.Owner {
		for _, k := range a.TenantActions {
			have[k] = true
		}
	} else {
		grants, err := a.Source.Grants(ctx, tc)
		if err != nil {
			return problem.Wrap(problem.CodeDependencyUnavailable, err)
		}
		for _, g := range grants {
			if g.ScopeKind == ScopeTenant {
				have[g.Action] = true
			}
		}
	}
	ok := slices.ContainsFunc(perms, func(p string) bool { return have[p] })
	if mode != "any" {
		ok = !slices.ContainsFunc(perms, func(p string) bool { return !have[p] })
	}
	if !ok {
		return problem.New(problem.CodeForbiddenAction, "")
	}
	return nil
}

// Capabilities lists what the actor of tc may do, for GET /me/context (UI hints; the backend authorizes each call).
func (a *GrantAuthorizer) Capabilities(ctx context.Context, tc TenantContext) ([]Grant, error) {
	if tc.Owner {
		actions := slices.Sorted(slices.Values(a.TenantActions))
		out := make([]Grant, 0, len(actions))
		for _, k := range actions {
			out = append(out, Grant{Action: k, ScopeKind: ScopeTenant})
		}
		return out, nil
	}
	grants, err := a.Source.Grants(ctx, tc)
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return grants, nil
}
