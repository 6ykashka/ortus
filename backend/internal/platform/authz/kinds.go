package authz

import (
	"context"
	"slices"
	"strings"

	"github.com/google/uuid"
)

// Scope kinds of stages 4–7 (W4.01, contract 0.7.0-stage4 of W4.02, tenant 0020): their keys are also Scope.kind of the
// contract. RS-08 (Q-W4.00-tasks-1, Q-W4.00-repair-2): project is the project of «Задачи» only (and a service
// direction, which is a service project of tasks); a repair object is repair_project, never project.
const (
	KindSpace         = "space"          // a knowledge space
	KindPage          = "page"           // a knowledge node and its subtree
	KindFolder        = "folder"         // a document folder and its subtree
	KindDoc           = "doc"            // one document
	KindAccount       = "account"        // a cash account (its acquiring included)
	KindChat          = "chat"           // one chat
	KindRepairProject = "repair_project" // a repair object
	KindRelation      = "relation"       // a computed relation with the record: no object, like self (Q-W4.02-1)
)

// ModuleKinds returns the kinds of stages 4–7 that W4.01 registers (ADR-0014 п.3): the object-bound kinds of the
// modules (PD-53: a grant counts only for its object or an object inside it) and relation.
func ModuleKinds() []ScopeKind {
	out := make([]ScopeKind, 0, 8)
	for _, k := range []string{KindSpace, KindPage, KindFolder, KindDoc, KindAccount, KindChat, KindRepairProject} {
		out = append(out, objectKind{key: k, api: k})
	}
	return append(out, relationKind{})
}

// Kinds returns every kind of the evaluator: PilotKinds and ModuleKinds.
func Kinds() []ScopeKind { return append(PilotKinds(), ModuleKinds()...) }

// Territorial is implemented by the kinds whose grants reach objects through the org structure (tenant, unit): in a
// container with an access level they are inherited grants (Container).
type Territorial interface {
	Territorial() bool
}

// isTerritorial reports whether grants of kind are inherited grants inside a container.
func isTerritorial(k ScopeKind) bool {
	t, ok := k.(Territorial)
	return ok && t.Territorial()
}

// Territorial implements Territorial: the whole tenant.
func (tenantKind) Territorial() bool { return true }

// Territorial implements Territorial: a unit and its subtree.
func (unitKind) Territorial() bool { return true }

// relationKind: records whose relation names the subject (Resource.Related) — the foreman of a repair object, the
// driver of a trip, the assignee of a task. Every relation of the record counts (Q-W4.02-1): the module of the
// record decides which people its relations name.
type relationKind struct{}

func (relationKind) Key() string       { return KindRelation }
func (relationKind) APIKind() string   { return KindRelation }
func (relationKind) ObjectBound() bool { return false }

func (relationKind) Covers(_ context.Context, _ Scope, sub Subject, r Resource) (bool, error) {
	return sub.PersonID != uuid.Nil && slices.Contains(r.Related, sub.PersonID), nil
}

func (relationKind) Predicate(_ Scope, sub Subject, c Columns, a *Args) string {
	if len(c.Related) == 0 || sub.PersonID == uuid.Nil {
		return sqlFalse
	}
	parts := make([]string, 0, len(c.Related))
	for _, col := range c.Related {
		parts = append(parts, col+" = "+a.Add(sub.PersonID))
	}
	return "(" + strings.Join(parts, " or ") + ")"
}
