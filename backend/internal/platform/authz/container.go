package authz

import (
	"slices"
	"strings"

	"github.com/google/uuid"
)

// Level is the access level of a container (a project of tasks, a knowledge space): how far the grants of the org
// structure reach inside it (W4.10 projAccess, W4.30 kbAccess).
type Level string

// Access levels of a container. An empty or unknown level is closed (fail-closed; W4.30: a space without a level).
const (
	LevelOpen    Level = "open"    // territorial grants give every action of their role
	LevelLimited Level = "limited" // territorial grants give only the reads of the container
	LevelClosed  Level = "closed"  // territorial grants give nothing: only a role on the container itself
)

// Container is the object whose access level a resource inherits: its id is Resource.Objects[Kind].
type Container struct {
	Kind  string // object-bound kind of the container: project, space
	Level Level  // access level of the container
	// OwnerClosed: a closed container is shut to the owner too, except through a role on it (TP-03 for projects).
	OwnerClosed bool
	// RoleReplaces: a role on the container itself replaces the territorial grants inside it (projAccess: with a role in
	// the project only its actions count, a role of the firm or the region adds nothing). A space adds them up (kbAccess).
	RoleReplaces bool
}

// ContainerColumns names the access level of the container of a row for ScopeQuery.
type ContainerColumns struct {
	Kind         string // object-bound kind of the container
	Level        string // SQL expression of the level: 'open', 'limited' or 'closed'
	OwnerClosed  bool   // as Container.OwnerClosed
	RoleReplaces bool   // as Container.RoleReplaces: needs the column of the container in Columns.Objects[Kind]
}

// ProjectContainer is the container of a project of tasks at level (RS-08: project means tasks.projects): a closed
// project is shut to the owner too (TP-03, Q-W4.10-4); a role in the project replaces the inherited ones (projAccess).
func ProjectContainer(level Level) *Container {
	return &Container{Kind: KindProject, Level: level, OwnerClosed: true, RoleReplaces: true}
}

// SpaceContainer is the container of a knowledge space at level: the owner sees a closed space (KB-04, Q-W4.30-9).
func SpaceContainer(level Level) *Container {
	return &Container{Kind: KindSpace, Level: level}
}

// ProjectColumns is ContainerColumns of a project whose level is the SQL expression level.
func ProjectColumns(level string) *ContainerColumns {
	return &ContainerColumns{Kind: KindProject, Level: level, OwnerClosed: true, RoleReplaces: true}
}

// SpaceColumns is ContainerColumns of a knowledge space whose level is the SQL expression level.
func SpaceColumns(level string) *ContainerColumns {
	return &ContainerColumns{Kind: KindSpace, Level: level}
}

// reachable reports whether a level lets territorial grants in at all (open or limited).
func (l Level) reachable() bool { return l == LevelOpen || l == LevelLimited }

// ownerShut reports whether r lies in a container closed to the owner (TP-03).
func (r Resource) ownerShut() bool {
	return r.Container != nil && r.Container.OwnerClosed && !r.Container.Level.reachable()
}

// levelAdmits reports whether a grant of kind keeps action inside the container of r: territorial grants follow the
// level (in a limited one — the reads its module registered, Evaluator.ContainerReads) and give nothing in a container
// where a role on it replaces them; the others (a role on the object, self, relation) do not depend on the level.
func levelAdmits(reads map[string][]string, sub Subject, kind ScopeKind, action string, r Resource) bool {
	c := r.Container
	if c == nil || !isTerritorial(kind) {
		return true
	}
	if c.RoleReplaces {
		// A role of sub on the container replaces the grant; a resource that does not name its container cannot be told
		// apart from those (Q-W4.01-15) and the grant gives nothing, as ScopeQuery without the column of the container.
		if ids := roleContainers(sub, c.Kind); len(ids) > 0 && (r.Object(c.Kind) == uuid.Nil || slices.Contains(ids, r.Object(c.Kind))) {
			return false
		}
	}
	switch c.Level {
	case LevelOpen:
		return true
	case LevelLimited:
		return slices.Contains(reads[c.Kind], action)
	case LevelClosed:
		return false
	}
	return false // an unknown level is closed
}

// ownerShut reports whether the rows of c may lie in containers closed to the owner.
func (c Columns) ownerShut() bool { return c.Container != nil && c.Container.OwnerClosed }

// Conditions on the level of a container in SQL: a NULL or unknown level matches neither (closed).
func (c *ContainerColumns) reachableSQL() string { return c.Level + " in ('open', 'limited')" }

func (c *ContainerColumns) openSQL() string { return c.Level + " = 'open'" }

// levelSQL is the condition a territorial grant of kind adds for action over c ("" when none); reads as in levelAdmits.
func levelSQL(reads map[string][]string, kind ScopeKind, action string, c Columns) string {
	switch {
	case c.Container == nil || !isTerritorial(kind):
		return ""
	case slices.Contains(reads[c.Container.Kind], action):
		return c.Container.reachableSQL()
	}
	return c.Container.openSQL()
}

// roleContainers returns the containers of kind on which sub holds a role of its own (a grant with the container as
// its object), without repeats.
func roleContainers(sub Subject, kind string) []uuid.UUID {
	var ids []uuid.UUID
	for _, g := range sub.Grants {
		if g.Scope.Kind == kind && g.Scope.Ref != uuid.Nil && !slices.Contains(ids, g.Scope.Ref) {
			ids = append(ids, g.Scope.Ref)
		}
	}
	return ids
}

// replaced returns the containers whose rows a territorial grant of kind leaves to the roles of sub on them
// (Container.RoleReplaces); drop is true when those rows cannot be told apart (no column of the container): the
// grant then gives nothing over c (fail-closed).
func replaced(sub Subject, kind ScopeKind, c Columns) (ids []uuid.UUID, drop bool) {
	if c.Container == nil || !c.Container.RoleReplaces || !isTerritorial(kind) {
		return nil, false
	}
	ids = roleContainers(sub, c.Container.Kind)
	return ids, len(ids) > 0 && c.Objects[c.Container.Kind] == ""
}

// replacedSQL is the condition that keeps a territorial grant out of the rows of the containers ids; a row without a
// container (NULL under a left join) stays, as Permit with no container (Q-W4.01-13).
func replacedSQL(c Columns, ids []uuid.UUID, args *Args) string {
	col := c.Objects[c.Container.Kind]
	conds := make([]string, 0, len(ids))
	for _, id := range ids {
		conds = append(conds, col+" is distinct from "+args.Add(id))
	}
	return strings.Join(conds, " and ")
}
