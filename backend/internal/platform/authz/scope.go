package authz

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/google/uuid"
)

// Scope kinds of stage 1 (access.role_assignments.scope_kind, «scopes» of api/permissions.yaml).
const (
	KindTenant    = "tenant"
	KindUnit      = "unit" // region, firm, branch: one kind, the subtree through org.unit_closure
	KindSelf      = "self" // «own»: created by me, assigned to me, my trips
	KindProject   = "project"
	KindWarehouse = "warehouse"
	KindResource  = "resource"
)

// Scope.kind of the contract for the kinds of the catalog that are named differently (ADR-0014 п.7).
const (
	APIKindTenant       = "tenant"
	APIKindOrgUnit      = "org_unit"
	APIKindSelf         = "self"
	APIKindProject      = "project"
	APIKindResourcePool = "resource_pool"
)

// ScopeKind is one kind of the registry. Modules register their kinds with their contract PR (ADR-0014 п.3).
type ScopeKind interface {
	// Key is the kind in access.role_assignments.scope_kind and in the permission catalog.
	Key() string
	// APIKind is Scope.kind of the contract, "" while the contract has none (warehouse).
	APIKind() string
	// ObjectBound kinds name one object: a grant counts only for a resource inside that object (PD-53).
	ObjectBound() bool
	// Covers reports whether a grant scoped s reaches r. The evaluator never asks an object-bound kind about a
	// resource without an object of that kind.
	Covers(ctx context.Context, s Scope, sub Subject, r Resource) (bool, error)
	// Predicate returns the SQL condition of the rows a grant scoped s reaches over columns c ("false" when c
	// lacks the column of the kind).
	Predicate(s Scope, sub Subject, c Columns, a *Args) string
}

// Errors of NewRegistry.
var (
	ErrEmptyKind     = errors.New("authz: scope kind with an empty key")
	ErrDuplicateKind = errors.New("authz: scope kind registered twice")
)

// Registry is the explicit registry of scope kinds (no init(), CLAUDE.md).
type Registry struct {
	kinds map[string]ScopeKind
	keys  []string
}

// NewRegistry registers kinds in order.
func NewRegistry(kinds ...ScopeKind) (*Registry, error) {
	r := &Registry{kinds: map[string]ScopeKind{}}
	for _, k := range kinds {
		key := k.Key()
		switch {
		case key == "":
			return nil, ErrEmptyKind
		case r.kinds[key] != nil:
			return nil, fmt.Errorf("%w: %s", ErrDuplicateKind, key)
		}
		r.kinds[key] = k
		r.keys = append(r.keys, key)
	}
	return r, nil
}

// Kind returns the kind of key.
func (r *Registry) Kind(key string) (ScopeKind, bool) {
	k, ok := r.kinds[key]
	return k, ok
}

// Keys returns the keys of the registered kinds in registration order.
func (r *Registry) Keys() []string { return append([]string(nil), r.keys...) }

// FutureKinds are the scope kinds of the catalog and the documents that a later stage adds to the registry, with
// that work stream (ADR-0014 п.3): until then a grant of such a kind gives nothing (fail-closed). W4.01 registered
// every kind of contract 0.7.0-stage4 (ModuleKinds): repair_project instead of repair_object (Q-W4.00-repair-2), no
// service_direction — a direction of «Обращения» is a service project of tasks, kind project (Q-W4.02-4).
var FutureKinds = map[string]string{}

// PilotKinds returns the kinds of stage 1: tenant, unit, self, project, warehouse, resource.
func PilotKinds() []ScopeKind {
	return []ScopeKind{
		tenantKind{}, unitKind{}, selfKind{},
		objectKind{key: KindProject, api: APIKindProject},
		objectKind{key: KindWarehouse},
		objectKind{key: KindResource, api: APIKindResourcePool},
	}
}

// sqlFalse and sqlTrue are the constant predicates.
const (
	sqlFalse = "false"
	sqlTrue  = "true"
)

// tenantKind: the whole tenant.
type tenantKind struct{}

func (tenantKind) Key() string       { return KindTenant }
func (tenantKind) APIKind() string   { return APIKindTenant }
func (tenantKind) ObjectBound() bool { return false }

func (tenantKind) Covers(context.Context, Scope, Subject, Resource) (bool, error) { return true, nil }

func (tenantKind) Predicate(Scope, Subject, Columns, *Args) string { return sqlTrue }

// unitKind: an org unit, with its subtree when Descendants (org.unit_closure). The evaluator fills
// Resource.UnitPath; a resource without a unit is not in any unit.
type unitKind struct{}

func (unitKind) Key() string       { return KindUnit }
func (unitKind) APIKind() string   { return APIKindOrgUnit }
func (unitKind) ObjectBound() bool { return false }

func (unitKind) Covers(_ context.Context, s Scope, _ Subject, r Resource) (bool, error) {
	if r.Unit == uuid.Nil {
		return false, nil
	}
	return r.Unit == s.Ref || (s.Descendants && slices.Contains(r.UnitPath, s.Ref)), nil
}

func (unitKind) Predicate(s Scope, _ Subject, c Columns, a *Args) string {
	switch {
	case c.Unit == "":
		return sqlFalse
	case s.Descendants:
		return c.Unit + " in (select descendant_id from org.unit_closure where ancestor_id = " + a.Add(s.Ref) + ")"
	default:
		return c.Unit + " = " + a.Add(s.Ref)
	}
}

// selfKind: objects whose «own» people include the subject.
type selfKind struct{}

func (selfKind) Key() string       { return KindSelf }
func (selfKind) APIKind() string   { return APIKindSelf }
func (selfKind) ObjectBound() bool { return false }

func (selfKind) Covers(_ context.Context, _ Scope, sub Subject, r Resource) (bool, error) {
	return sub.PersonID != uuid.Nil && slices.Contains(r.Persons, sub.PersonID), nil
}

func (selfKind) Predicate(_ Scope, sub Subject, c Columns, a *Args) string {
	if len(c.Persons) == 0 || sub.PersonID == uuid.Nil {
		return sqlFalse
	}
	parts := make([]string, 0, len(c.Persons))
	for _, col := range c.Persons {
		parts = append(parts, col+" = "+a.Add(sub.PersonID))
	}
	return "(" + strings.Join(parts, " or ") + ")"
}

// objectKind: one object and the objects inside it (project, warehouse, resource; space, page, folder, doc,
// account, chat, repair_project) — PD-53, ADR-0014 п.4.
type objectKind struct{ key, api string }

func (k objectKind) Key() string     { return k.key }
func (k objectKind) APIKind() string { return k.api }
func (objectKind) ObjectBound() bool { return true }

// Covers: the object of the kind of r is the object of the grant or lies inside it (an ancestor of its own kind).
func (k objectKind) Covers(_ context.Context, s Scope, _ Subject, r Resource) (bool, error) {
	id := r.Object(k.key)
	return id != uuid.Nil && (id == s.Ref || slices.Contains(r.Ancestors[k.key], s.Ref)), nil
}

func (k objectKind) Predicate(s Scope, _ Subject, c Columns, a *Args) string {
	if path := c.Paths[k.key]; path != "" {
		return a.Add(s.Ref) + " = any(" + path + ")"
	}
	col := c.Objects[k.key]
	if col == "" {
		return sqlFalse
	}
	return col + " = " + a.Add(s.Ref)
}
