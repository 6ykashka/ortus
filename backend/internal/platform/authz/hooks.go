package authz

import (
	"context"

	"github.com/google/uuid"
)

// Admission is the answer of an object access list.
type Admission int

// Answers of ObjectACL.
const (
	// Inherited: the object has no access list of its own; grants decide (visibility_mode inherited).
	Inherited Admission = iota
	// Admitted: the object is restricted and the subject is on its list. The list adds no action: a grant still
	// has to allow the action (02-architecture §5 «Членство в restricted-контейнере не добавляет действие»).
	Admitted
	// Denied: the object is restricted and the subject is not on its list: the object is invisible (404).
	Denied
)

// ObjectACL is the access list of objects (knowledge nodes, document shares, chat sources — W4.01, W7.00). The
// owner is not asked: the owner keeps access to restricted containers of the tenant.
type ObjectACL interface {
	Admit(ctx context.Context, sub Subject, action string, r Resource) (Admission, error)
}

// ACLPredicate is implemented by an ObjectACL whose restrictions also filter lists (scopeQuery).
type ACLPredicate interface {
	Predicate(sub Subject, action string, c Columns, a *Args) string
}

// InheritedACL is the access list of stage 1: no object of the pilot has one.
type InheritedACL struct{}

// Admit implements ObjectACL.
func (InheritedACL) Admit(context.Context, Subject, string, Resource) (Admission, error) {
	return Inherited, nil
}

// GrantParam is a parameter of a grant checked against the resource, as part of the grant (each grant whole).
type GrantParam interface {
	Key() string
	Admits(g Grant, r Resource) bool
}

// LimitAmount is the parameter «limit: amount» (docs/26-cash.md): a grant with a limit allows a command up to it
// in its currency; a command without an amount is not limited.
type LimitAmount struct{}

// Key implements GrantParam.
func (LimitAmount) Key() string { return "limit" }

// Admits implements GrantParam.
func (LimitAmount) Admits(g Grant, r Resource) bool {
	if g.Limit == nil || r.Amount == nil {
		return true
	}
	return r.Amount.Currency == g.Limit.Currency && r.Amount.Value <= g.Limit.Value
}

// Rule is a rule of an action applied after a grant allowed it, to everyone including the owner (business rules
// such as «the author does not approve own work», «not the one who closed the shift»).
type Rule interface {
	Key() string
	Allows(sub Subject, r Resource) bool
}

// NotAuthor is the rule «not the author» (permissions.yaml tasks.approve note; docs/26-cash.md approvals).
type NotAuthor struct{}

// Key implements Rule.
func (NotAuthor) Key() string { return "not_author" }

// Allows implements Rule: an object without a known author is not restricted by the rule.
func (NotAuthor) Allows(sub Subject, r Resource) bool {
	return r.Author == uuid.Nil || r.Author != sub.PersonID
}
