package authz

import (
	"context"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Mismatch reasons of a grant (GrantExplanation.mismatch of the contract, explainAccess).
const (
	MismatchOutOfScope          = "out_of_scope"
	MismatchOtherObject         = "other_object"
	MismatchObjectWithoutObject = "object_scope_without_object"
	MismatchFunctionBlocked     = "function_blocked"
)

// GrantVerdict is how one grant with the action relates to the resource.
type GrantVerdict struct {
	Grant    Grant
	Matches  bool
	Mismatch string // "" when Matches
}

// Explanation is the answer to «why is it (not) allowed»: the decision and every active grant with the action.
type Explanation struct {
	Allowed bool
	Owner   bool
	// OwnerShut: the subject is the owner and the resource lies in a container closed to it (TP-03: a closed project
	// without a role of the owner in it).
	OwnerShut bool
	Grants    []GrantVerdict
}

// Explain explains the decision of Permit for action on r (S1-14 «Почему доступно», explainAccess of W1.06).
// Expired grants and dormant modules are not seen by the evaluator (the source reads active grants only). The
// resource is placed as Permit places it (a node — in its space and under its ancestors); a failure of a dependency
// is returned, never explained as a denial (Q-W1.04-21).
func (e *Evaluator) Explain(ctx context.Context, tc tenantctx.TenantContext, action string, r Resource) (Explanation, error) {
	r, err := e.withPlaces(ctx, tc, r)
	if err != nil {
		return Explanation{}, err
	}
	sub, err := e.subject(ctx, tc, true, !tc.Owner || r.ownerShut())
	if err != nil {
		return Explanation{}, err
	}
	if !sub.Owner || r.ownerShut() {
		if r, err = e.withUnitPath(ctx, tc, r); err != nil {
			return Explanation{}, err
		}
	}
	x := Explanation{Owner: sub.Owner, OwnerShut: sub.Owner && r.ownerShut()}
	if x.Grants, err = e.verdicts(ctx, sub, action, r); err != nil {
		return Explanation{}, err
	}
	if !e.Policy.Known(action) {
		return x, nil // Permit refuses an unknown action (fail-closed)
	}
	// The decision comes from the same subject as the verdicts: a second read could see other assignments.
	err = e.decide(ctx, tc, sub, action, r)
	if err != nil && !denial(err) {
		return Explanation{}, err
	}
	x.Allowed = err == nil
	return x, nil
}

// verdicts relates every grant of sub that carries action to r.
func (e *Evaluator) verdicts(ctx context.Context, sub Subject, action string, r Resource) ([]GrantVerdict, error) {
	var out []GrantVerdict
	blocked := e.Policy.Blocked(action, sub.Functions)
	for _, g := range sub.Grants {
		if !g.Has(action) {
			continue
		}
		mismatch, err := e.mismatch(ctx, sub, g, action, r, blocked)
		if err != nil {
			return nil, err
		}
		out = append(out, GrantVerdict{Grant: g, Matches: mismatch == "", Mismatch: mismatch})
	}
	return out, nil
}

// denial reports whether err is a refusal of the evaluator rather than a failure.
func denial(err error) bool {
	return problem.Is(err, problem.CodeForbiddenAction) || problem.Is(err, problem.CodeNotFound) ||
		problem.Is(err, CodeFunctionBlocked)
}

// mismatch is why grant g does not allow the action on r ("" when it does).
func (e *Evaluator) mismatch(ctx context.Context, sub Subject, g Grant, action string, r Resource, blocked bool) (string, error) {
	if blocked {
		return MismatchFunctionBlocked, nil
	}
	if kind, ok := e.Registry.Kind(g.Scope.Kind); ok && kind.ObjectBound() {
		if r.Object(kind.Key()) == uuid.Nil {
			return MismatchObjectWithoutObject, nil
		}
		covers, err := kind.Covers(ctx, g.Scope, sub, r)
		switch {
		case err != nil:
			return "", dependency(err)
		case !covers:
			return MismatchOtherObject, nil
		}
	}
	ok, err := e.grantAllows(ctx, sub, g, action, r)
	if err != nil || ok {
		return "", err
	}
	return MismatchOutOfScope, nil
}
