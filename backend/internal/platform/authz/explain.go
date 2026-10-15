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
	Grants  []GrantVerdict
}

// Explain explains the decision of Permit for action on r (S1-14 «Почему доступно», explainAccess of W1.06).
// Expired grants and dormant modules are not seen by the evaluator (the source reads active grants only).
func (e *Evaluator) Explain(ctx context.Context, tc tenantctx.TenantContext, action string, r Resource) (Explanation, error) {
	sub, err := e.subject(ctx, tc, true, !tc.Owner)
	if err != nil {
		return Explanation{}, err
	}
	if !sub.Owner {
		if r, err = e.withUnitPath(ctx, tc, r); err != nil {
			return Explanation{}, err
		}
	}
	x := Explanation{Owner: sub.Owner}
	blocked := e.Policy.Blocked(action, sub.Functions)
	for _, g := range sub.Grants {
		if !g.Has(action) {
			continue
		}
		v := GrantVerdict{Grant: g}
		if v.Mismatch, err = e.mismatch(ctx, sub, g, r, blocked); err != nil {
			return Explanation{}, err
		}
		v.Matches = v.Mismatch == ""
		x.Grants = append(x.Grants, v)
	}
	if !e.Policy.Known(action) {
		return x, nil // Permit refuses an unknown action (fail-closed)
	}
	// The decision comes from the same subject as the verdicts: a second read could see other assignments.
	err = e.decide(ctx, tc, sub, action, r)
	if problem.Is(err, problem.CodeDependencyUnavailable) {
		return Explanation{}, err
	}
	x.Allowed = err == nil
	return x, nil
}

// mismatch is why grant g does not allow the action on r ("" when it does).
func (e *Evaluator) mismatch(ctx context.Context, sub Subject, g Grant, r Resource, blocked bool) (string, error) {
	if blocked {
		return MismatchFunctionBlocked, nil
	}
	if kind, ok := e.Registry.Kind(g.Scope.Kind); ok && kind.ObjectBound() {
		switch id := r.Object(kind.Key()); {
		case id == uuid.Nil:
			return MismatchObjectWithoutObject, nil
		case id != g.Scope.Ref:
			return MismatchOtherObject, nil
		}
	}
	ok, err := e.grantAllows(ctx, sub, g, r)
	if err != nil || ok {
		return "", err
	}
	return MismatchOutOfScope, nil
}
