package inbox

import (
	"context"
	"slices"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Rule is what decides who may receive and read a notification (required_permission, unit_id, sensitivity).
type Rule struct {
	Permission  string
	Unit        uuid.UUID
	Sensitivity string // "" is normal
}

// Audience decides whether the person of a tenant context may receive a notification now. It is asked when a
// notification is enqueued and again on every read.
type Audience interface {
	// Admits reports whether tc may see a notification of rule r; an error means the decision could not be made
	// (dependency_unavailable), never «no».
	Admits(ctx context.Context, tc tenantctx.TenantContext, r Rule) (bool, error)
}

// AuthzAudience checks rules with the permission evaluator of W1.04:
//   - no permission: only a normal notification without a unit (anything else fails closed);
//   - a permission: Permit(permission, the unit of the object) — one whole grant must reach the unit, a work
//     function may close the action (fleet.earnings.read for a driver), the owner passes;
//   - sensitive or restricted: also no active driver work function (AC-05).
type AuthzAudience struct{ E *authz.Evaluator }

var _ Audience = AuthzAudience{}

// Denials of the evaluator that mean «not an audience» (Q-W1.04-2).
var denials = []string{problem.CodeForbiddenAction, problem.CodeNotFound, authz.CodeFunctionBlocked}

// Admits implements Audience.
func (a AuthzAudience) Admits(ctx context.Context, tc tenantctx.TenantContext, r Rule) (bool, error) {
	normal := r.Sensitivity == "" || r.Sensitivity == SensitivityNormal
	if r.Permission == "" {
		return r.Unit == uuid.Nil && normal, nil
	}
	if !normal {
		driver, err := a.driver(ctx, tc)
		if err != nil || driver {
			return false, err
		}
	}
	err := a.E.Permit(ctx, tc, r.Permission, authz.Resource{Unit: r.Unit})
	switch {
	case err == nil:
		return true, nil
	case slices.ContainsFunc(denials, func(code string) bool { return problem.Is(err, code) }):
		return false, nil
	}
	return false, err
}

// driver reports whether the person of tc has an active driver work function by the clock of the evaluator.
func (a AuthzAudience) driver(ctx context.Context, tc tenantctx.TenantContext) (bool, error) {
	at := time.Now()
	if a.E.Now != nil {
		at = a.E.Now()
	}
	sub, err := a.E.Source.Subject(ctx, tc, at, false)
	if err != nil {
		return false, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return slices.Contains(sub.Functions, authz.FunctionDriver), nil
}
