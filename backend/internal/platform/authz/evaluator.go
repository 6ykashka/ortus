package authz

import (
	"context"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// CodeFunctionBlocked is the Problem code of an action closed by a work function (errors.yaml function_blocked).
const CodeFunctionBlocked = "function_blocked"

// modeAny is x-permissions-mode «any»; every other value means «all».
const modeAny = "any"

// Source reads what the evaluator needs of the tenant DB of a request.
type Source interface {
	// Subject returns the subject of tc at the moment at: work functions active at it and, when grants is true,
	// the grants active at it (direct and through groups, of live roles).
	Subject(ctx context.Context, tc tenantctx.TenantContext, at time.Time, grants bool) (Subject, error)
	// InstalledModules returns module_key of the installed modules (enabled, draining, read_only).
	InstalledModules(ctx context.Context, tc tenantctx.TenantContext) ([]string, error)
}

// UnitTree knows the ancestors of org units (org.unit_closure).
type UnitTree interface {
	// Ancestors returns unit and all its ancestors.
	Ancestors(ctx context.Context, tenantID, unit uuid.UUID) ([]uuid.UUID, error)
}

// Evaluator decides access in a tenant. It keeps no cache: every check reads the current grants, so a revoked
// role stops working at the next check (AC-10: the delivery of an export re-checks).
type Evaluator struct {
	Source   Source
	Units    UnitTree // nil: a resource is only in its own unit (no subtree)
	Registry *Registry
	Policy   Policy
	Params   []GrantParam      // checked for every grant (LimitAmount)
	Rules    map[string][]Rule // action → rules (NotAuthor)
	ACL      ObjectACL         // nil: InheritedACL
	Now      func() time.Time  // the clock of the application (APP_FIXED_NOW outside prod); nil: time.Now
}

// New returns an evaluator with the kinds of stage 1, the catalog policy, LimitAmount and no object lists.
func New(src Source, units UnitTree, now func() time.Time) *Evaluator {
	reg, err := NewRegistry(PilotKinds()...)
	if err != nil { // the pilot kinds have distinct non-empty keys (TestPilotKinds)
		panic(err)
	}
	return &Evaluator{
		Source: src, Units: units, Registry: reg, Policy: DefaultPolicy(),
		Params: []GrantParam{LimitAmount{}}, Now: now,
	}
}

func (e *Evaluator) now() time.Time {
	if e.Now != nil {
		return e.Now()
	}
	return time.Now()
}

func (e *Evaluator) acl() ObjectACL {
	if e.ACL != nil {
		return e.ACL
	}
	return InheritedACL{}
}

func forbidden() error { return problem.New(problem.CodeForbiddenAction, "") }

func notFound() error { return problem.New(problem.CodeNotFound, "") }

func blockedByFunction() error { return problem.New(CodeFunctionBlocked, "") }

// subject loads the subject of tc. The owner (OwnerBinding, from the control DB) needs the tenant DB only for the
// work functions of actions a function can close; grants are read only for members.
func (e *Evaluator) subject(ctx context.Context, tc tenantctx.TenantContext, functions, grants bool) (Subject, error) {
	sub := Subject{TenantID: tc.TenantID, PersonID: tc.PersonID, Owner: tc.Owner}
	if !functions && !grants {
		return sub, nil
	}
	at := e.now()
	loaded, err := e.Source.Subject(ctx, tc, at, grants)
	if err != nil {
		return Subject{}, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	sub.Functions = loaded.Functions
	// A grant outside its period never counts, whatever the source returned.
	// The source's slice is not modified.
	sub.Grants = slices.DeleteFunc(slices.Clone(loaded.Grants), func(g Grant) bool { return !g.ActiveAt(at) })
	return sub, nil
}

// Permit decides whether the subject of tc may apply action to r (permit(c, a, r, t) of 02-architecture §5).
func (e *Evaluator) Permit(ctx context.Context, tc tenantctx.TenantContext, action string, r Resource) error {
	if !e.Policy.Known(action) {
		return forbidden()
	}
	blockable := e.Policy.Blockable(action) || e.Policy.Blockable(r.ReadAction)
	sub, err := e.subject(ctx, tc, blockable, !tc.Owner)
	if err != nil {
		return err
	}
	return e.decide(ctx, tc, sub, action, r)
}

// decide is Permit for a loaded subject (its work functions must be loaded when action or r.ReadAction is
// blockable). An owner_only action of a member is denied like any other: 403 when the member sees the object or
// there is none, 404 when the object is invisible (AC-01).
func (e *Evaluator) decide(ctx context.Context, tc tenantctx.TenantContext, sub Subject, action string, r Resource) error {
	if e.Policy.Blocked(action, sub.Functions) {
		return blockedByFunction()
	}
	if !sub.Owner {
		var err error
		if r, err = e.withUnitPath(ctx, tc, r); err != nil {
			return err
		}
		if e.Policy.OwnerOnly[action] {
			return e.deny(ctx, sub, action, r)
		}
	}
	ok, err := e.allows(ctx, sub, action, r)
	switch {
	case err != nil:
		return err
	case !ok:
		return e.deny(ctx, sub, action, r)
	}
	return e.admitted(ctx, sub, action, r)
}

// withUnitPath fills the unit and its ancestors of r from the unit tree.
func (e *Evaluator) withUnitPath(ctx context.Context, tc tenantctx.TenantContext, r Resource) (Resource, error) {
	if r.Unit == uuid.Nil || len(r.UnitPath) > 0 || e.Units == nil {
		return r, nil
	}
	path, err := e.Units.Ancestors(ctx, tc.TenantID, r.Unit)
	if err != nil {
		return r, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	r.UnitPath = path
	return r, nil
}

// allows reports whether one grant of sub allows action on r whole; the owner is allowed every action.
func (e *Evaluator) allows(ctx context.Context, sub Subject, action string, r Resource) (bool, error) {
	if sub.Owner {
		return true, nil
	}
	for _, g := range sub.Grants {
		if !g.Has(action) {
			continue
		}
		if ok, err := e.grantAllows(ctx, sub, g, r); err != nil || ok {
			return ok, err
		}
	}
	return false, nil
}

// grantAllows checks one grant whole: a registered kind, PD-53 for object-bound kinds, the scope covering r and
// every parameter admitting r.
func (e *Evaluator) grantAllows(ctx context.Context, sub Subject, g Grant, r Resource) (bool, error) {
	kind, ok := e.Registry.Kind(g.Scope.Kind)
	if !ok {
		return false, nil // a kind of a later stage gives nothing until it is registered
	}
	if kind.ObjectBound() && r.Object(kind.Key()) == uuid.Nil {
		return false, nil // PD-53: an object grant without its object
	}
	covers, err := kind.Covers(ctx, g.Scope, sub, r)
	if err != nil || !covers {
		return false, err
	}
	for _, p := range e.Params {
		if !p.Admits(g, r) {
			return false, nil
		}
	}
	return true, nil
}

// deny chooses the answer to a denied action: 403 when there is no object or the subject sees it, 404 when the
// object is invisible to the subject (AC-01: the same as an id that does not exist).
func (e *Evaluator) deny(ctx context.Context, sub Subject, action string, r Resource) error {
	if r.IsZero() {
		return forbidden()
	}
	if r.ReadAction != "" && r.ReadAction != action && !e.Policy.Blocked(r.ReadAction, sub.Functions) {
		visible, err := e.sees(ctx, sub, r)
		if err != nil {
			return err
		}
		if visible {
			return forbidden()
		}
	}
	return notFound()
}

// sees reports whether the subject sees the object r: a whole grant allows r.ReadAction on it and its access list
// does not hide it (a restricted object outside the list answers like a missing one).
func (e *Evaluator) sees(ctx context.Context, sub Subject, r Resource) (bool, error) {
	read := r
	read.Amount = nil // seeing an object is not limited by the amount of a command
	visible, err := e.allows(ctx, sub, r.ReadAction, read)
	if err != nil || !visible || sub.Owner {
		return visible, err
	}
	adm, err := e.acl().Admit(ctx, sub, r.ReadAction, read)
	if err != nil {
		return false, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return adm != Denied, nil
}

// admitted applies what follows an allowing grant: the access list of the object (the owner is not asked) and the
// rules of the action (for everyone).
func (e *Evaluator) admitted(ctx context.Context, sub Subject, action string, r Resource) error {
	if !sub.Owner && !r.IsZero() {
		adm, err := e.acl().Admit(ctx, sub, action, r)
		if err != nil {
			return problem.Wrap(problem.CodeDependencyUnavailable, err)
		}
		if adm == Denied {
			return notFound()
		}
	}
	for _, rule := range e.Rules[action] {
		if !rule.Allows(sub, r) {
			return forbidden()
		}
	}
	return nil
}

// Admit is the check of the gateway: the subject has every (mode all) or some (mode any) action of the operation
// in a grant whose scope kind the x-scope of the operation admits. The object is checked by the handler (Permit,
// ScopeQuery). PD-53 holds here too: an object-bound grant counts only where x-scope admits its kind. x-scope
// tenant-owner is checked first: an owner-only operation stays closed to members even without x-permissions.
func (e *Evaluator) Admit(ctx context.Context, tc tenantctx.TenantContext, op Operation) error {
	adm := admissionOf(op.Scope)
	if adm.ownerOnly && !tc.Owner {
		return forbidden()
	}
	if len(op.Permissions) == 0 {
		return nil
	}
	sub, err := e.subject(ctx, tc, slices.ContainsFunc(op.Permissions, e.Policy.Blockable), !tc.Owner)
	if err != nil {
		return err
	}
	granted, blocked := 0, false
	for _, p := range op.Permissions {
		switch {
		case e.Policy.Blocked(p, sub.Functions):
			blocked = true
		case e.admitsAction(sub, adm, p):
			granted++
		}
	}
	if granted == len(op.Permissions) || (op.Mode == modeAny && granted > 0) {
		return nil
	}
	if blocked {
		return blockedByFunction()
	}
	return forbidden()
}

// admitsAction reports whether sub has action in a grant of a kind adm admits (any kind, for the owner).
func (e *Evaluator) admitsAction(sub Subject, adm admission, action string) bool {
	switch {
	case !e.Policy.Known(action), e.Policy.OwnerOnly[action] && !sub.Owner:
		return false
	case sub.Owner:
		return true
	}
	return slices.ContainsFunc(sub.Grants, func(g Grant) bool {
		_, known := e.Registry.Kind(g.Scope.Kind)
		return known && g.Has(action) && adm.admits(g.Scope.Kind)
	})
}

// ScopeQuery returns the condition of the rows the subject of tc may apply action to over columns c, built from
// whole allowing grants only (OR of their scopes), with placeholders after argStart (scopeQuery(action)). The owner
// gets «true»; an action closed by a work function or reserved to the owner — «false». Parameters of grants
// (limit: amount) restrict commands, not reads, and are not part of the predicate.
func (e *Evaluator) ScopeQuery(ctx context.Context, tc tenantctx.TenantContext, action string, c Columns, argStart int) (Predicate, error) {
	none := Predicate{SQL: sqlFalse}
	if !e.Policy.Known(action) {
		return none, nil
	}
	sub, err := e.subject(ctx, tc, e.Policy.Blockable(action), !tc.Owner)
	switch {
	case err != nil:
		return Predicate{}, err
	case e.Policy.Blocked(action, sub.Functions), e.Policy.OwnerOnly[action] && !sub.Owner:
		return none, nil
	case sub.Owner:
		return Predicate{SQL: sqlTrue}, nil
	}
	args := NewArgs(argStart)
	sql := e.grantsPredicate(sub, action, c, args)
	if sql == sqlFalse {
		return none, nil
	}
	if ap, ok := e.acl().(ACLPredicate); ok {
		if p := ap.Predicate(sub, action, c, args); p != "" {
			sql = "(" + sql + " and " + p + ")"
		}
	}
	return Predicate{SQL: sql, Args: args.Values()}, nil
}

// grantsPredicate is the OR of the predicates of the grants of sub with action; «true» as soon as one is.
func (e *Evaluator) grantsPredicate(sub Subject, action string, c Columns, args *Args) string {
	type part struct {
		kind ScopeKind
		g    Grant
	}
	var parts []part
	for _, g := range sub.Grants {
		if kind, ok := e.Registry.Kind(g.Scope.Kind); ok && g.Has(action) {
			if kind.Predicate(g.Scope, sub, c, NewArgs(0)) == sqlTrue {
				return sqlTrue
			}
			parts = append(parts, part{kind, g})
		}
	}
	var sqls []string
	for _, p := range parts {
		if s := p.kind.Predicate(p.g.Scope, sub, c, args); s != sqlFalse {
			sqls = append(sqls, s)
		}
	}
	if len(sqls) == 0 {
		return sqlFalse
	}
	return "(" + strings.Join(sqls, " or ") + ")"
}

// Capabilities lists what the subject of tc may do, for GET /me/context (hints for the UI; the gateway and the
// handlers authorize every call). The owner: the actions of the installed modules and the core, except those its
// work functions close (as MSW W0.13, П-14). A member: the actions of its active grants with their scope, except
// those closed by its functions and the owner_only ones.
func (e *Evaluator) Capabilities(ctx context.Context, tc tenantctx.TenantContext) ([]tenantctx.Grant, error) {
	sub, err := e.subject(ctx, tc, true, !tc.Owner)
	if err != nil {
		return nil, err
	}
	if !sub.Owner {
		return e.memberCapabilities(sub), nil
	}
	keys, err := e.Source.InstalledModules(ctx, tc)
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	installed := Installed(keys)
	out := []tenantctx.Grant{}
	for _, a := range slices.Sorted(slices.Values(e.Policy.Actions)) {
		if installed[ModuleOf(a)] && !e.Policy.Blocked(a, sub.Functions) {
			out = append(out, tenantctx.Grant{Action: a, ScopeKind: KindTenant})
		}
	}
	return out, nil
}

func (e *Evaluator) memberCapabilities(sub Subject) []tenantctx.Grant {
	out := []tenantctx.Grant{}
	seen := map[string]bool{}
	for _, g := range sub.Grants {
		if _, ok := e.Registry.Kind(g.Scope.Kind); !ok {
			continue
		}
		for _, a := range g.Actions {
			key := a + "|" + g.Scope.Kind + "|" + g.Scope.Ref.String()
			if seen[key] || !e.Policy.Known(a) || e.Policy.Blocked(a, sub.Functions) || e.Policy.OwnerOnly[a] {
				continue
			}
			seen[key] = true
			c := tenantctx.Grant{Action: a, ScopeKind: g.Scope.Kind}
			if g.Scope.Ref != uuid.Nil {
				ref := g.Scope.Ref
				c.ScopeRef = &ref
			}
			out = append(out, c)
		}
	}
	return out
}

// Gateway adapts the evaluator to tenantctx.Authorizer of cmd/api.
type Gateway struct{ E *Evaluator }

// Permit implements tenantctx.Authorizer for a caller that does not know the x-scope: tenant grants only.
func (g Gateway) Permit(ctx context.Context, tc tenantctx.TenantContext, perms []string, mode string) error {
	return g.E.Admit(ctx, tc, Operation{Permissions: perms, Mode: mode, Scope: KindTenant})
}

// Admit checks an operation with its x-scope.
func (g Gateway) Admit(ctx context.Context, tc tenantctx.TenantContext, op Operation) error {
	return g.E.Admit(ctx, tc, op)
}
