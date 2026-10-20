package authz

import (
	"slices"
	"strconv"
	"time"

	"github.com/google/uuid"
)

// Scope is where a grant applies: a kind of the registry and, for every kind but tenant and self, the id of its
// unit or object (access.role_assignments.scope_kind, scope_ref, include_descendants).
type Scope struct {
	Kind        string
	Ref         uuid.UUID // uuid.Nil for tenant and self
	Descendants bool      // a unit grant reaches the subtree of its unit
}

// Amount is a sum in minor units of a currency (kopecks of RUB).
type Amount struct {
	Value    int64
	Currency string
}

// Grant is one role assignment of a subject, direct or through a group, with the actions of its role version.
type Grant struct {
	AssignmentID uuid.UUID
	RoleID       uuid.UUID
	Group        uuid.UUID // uuid.Nil: assigned to the person directly
	Actions      []string  // actions of the role version of the assignment
	Scope        Scope
	From         time.Time  // zero: since ever
	Until        *time.Time // nil: open-ended
	Limit        *Amount    // parameter «limit: amount» (docs/26-cash.md); nil: no limit
}

// Has reports whether the role version of the grant carries action.
func (g Grant) Has(action string) bool { return slices.Contains(g.Actions, action) }

// ActiveAt reports whether t lies in the period [From, Until) of the grant.
func (g Grant) ActiveAt(t time.Time) bool {
	return !t.Before(g.From) && (g.Until == nil || t.Before(*g.Until))
}

// Subject is who asks, in one tenant: the person of the membership, the owner binding, the work functions active
// at the moment of the check and the grants active at it.
type Subject struct {
	TenantID  uuid.UUID
	PersonID  uuid.UUID
	Owner     bool
	Functions []string // people.work_profiles.function active «now»: driver closes restricted actions (AUTH-05)
	Grants    []Grant
}

// Resource is what an action is applied to. The zero Resource is an operation without an object (a list, a
// creation in the whole tenant): only territorial grants of the tenant scope reach it.
type Resource struct {
	Unit     uuid.UUID            // org unit the object belongs to; uuid.Nil — none
	UnitPath []uuid.UUID          // Unit and its ancestors; the evaluator fills it from UnitTree when empty
	Objects  map[string]uuid.UUID // object-bound scopes the object lies in: kind → id (project → its project)
	Persons  []uuid.UUID          // people the object is «own» for (scope self): author, assignee, driver
	Author   uuid.UUID            // author of the object (rule not_author)
	Amount   *Amount              // amount of a command (parameter limit: amount)
	// ReadAction is the action that makes the object visible. A denied action on a visible object is 403
	// forbidden_action; on an object the subject cannot see — 404 not_found, like an id that does not exist (AC-01).
	// Empty: the action itself decides visibility.
	ReadAction string
	// Ancestors are the ancestors of the object of a kind among the objects of the same kind, nearest first (the parent
	// pages of a page, the parent folders of a folder): a grant on an ancestor reaches the object (ADR-0014 п.4). The
	// evaluator fills them from the resolver of the kind (Evaluator.Places) when the handler did not.
	Ancestors map[string][]uuid.UUID
	// Related are the people a computed relation with the record names now (scope relation, Q-W4.02-1): the foreman of
	// a repair object, the driver of a trip, the assignee of a task.
	Related []uuid.UUID
	// Container is the object whose access level the resource inherits (a task — its project, a page — its space).
	Container *Container
	// Nodes is the branch of a tree object with access lists, from the top node to the object itself (knowledge pages,
	// document folders and documents): NodeACL checks it.
	Nodes []Node
}

// IsZero reports whether r names no object.
func (r Resource) IsZero() bool {
	return r.Unit == uuid.Nil && len(r.Objects) == 0 && len(r.Persons) == 0 && len(r.Related) == 0
}

// Object returns the id of the object of kind the resource lies in, uuid.Nil if none.
func (r Resource) Object(kind string) uuid.UUID { return r.Objects[kind] }

// Columns names the columns of a query that a scope predicate filters on.
type Columns struct {
	Unit    string            // owning org unit, e.g. "t.unit_id"
	Objects map[string]string // object-bound kind → column, e.g. "project": "t.project_id"
	Persons []string          // «own» people (scope self): "t.driver_person_id", "t.created_by"
	// Paths: object-bound kind → SQL expression of a uuid[] holding the object of the row and its ancestors of the same
	// kind (a grant on an ancestor page reaches the row); it takes the place of Objects for the kind.
	Paths     map[string]string
	Related   []string          // people of the relation with the row (scope relation): "o.foreman_id"
	Container *ContainerColumns // the access level of the container of the row (a project, a space)
}

// Predicate is a boolean SQL condition with its positional arguments.
type Predicate struct {
	SQL  string
	Args []any
}

// Args collects positional arguments of a predicate; numbering continues after the arguments of the query.
type Args struct {
	start int
	vals  []any
}

// NewArgs returns arguments numbered from start+1 ($start+1, $start+2…).
func NewArgs(start int) *Args { return &Args{start: start} }

// Add appends v and returns its placeholder.
func (a *Args) Add(v any) string {
	a.vals = append(a.vals, v)
	return "$" + strconv.Itoa(a.start+len(a.vals))
}

// Values returns the collected arguments.
func (a *Args) Values() []any { return a.vals }

// Operation is what the gateway knows of a contract operation before its handler (x-permissions, x-scope).
type Operation struct {
	ID          string
	Permissions []string
	Mode        string // all | any
	Scope       string // x-scope
}
