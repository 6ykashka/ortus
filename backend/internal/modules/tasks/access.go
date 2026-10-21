package tasks

import (
	"slices"

	"github.com/google/uuid"
)

// Scope kinds of access.role_assignments the module reads.
const (
	kindTenant  = "tenant"
	kindUnit    = "unit"
	kindSelf    = "self"
	kindProject = "project"
)

// Sources of the access to a project (TaskProjectMember.source).
const (
	srcAssigned  = "assigned"
	srcGroup     = "group"
	srcInherited = "inherited"
	srcSystem    = "system"
)

// Texts of «Откуда доступ» and of projCan (models.js:194–213).
const (
	ownerRole      = "Владелец бизнеса"
	viaSystem      = "Системная роль, вся организация"
	viaAssigned    = "Назначен в проекте"
	whyBlocked     = "сотрудник заблокирован"
	whyClosed      = "закрытый проект — нужна роль в самом проекте"
	whyNoRole      = "нет роли с правом «Задачи» в области проекта"
	whyLimitedRead = ": в ограниченном проекте унаследованный доступ — только чтение"
)

// grant is an active assignment of a person (directly or through a group) with what the descriptions need.
type grant struct {
	Assignment  uuid.UUID
	Role        uuid.UUID
	RoleName    string
	Template    string
	Group       uuid.UUID // uuid.Nil — assigned to the person
	GroupName   string
	Actions     []string
	Kind        string
	Ref         uuid.UUID
	Descendants bool
}

func (g *grant) has(action string) bool { return slices.Contains(g.Actions, action) }

func (g *grant) hasTaskKey() bool { return slices.ContainsFunc(g.Actions, isTaskKey) }

// member is a person of the tenant with an account: the membership, the owner binding, the work function and grants.
type member struct {
	ID     uuid.UUID
	Name   string
	Active bool
	Owner  bool
	Driver bool
	Grants []grant
}

// access is projAccess of a member to a project.
type access struct {
	Actions    []string
	RoleName   string
	RoleID     *uuid.UUID
	Source     string // assigned | group | inherited | system
	Via        string
	Assignment *uuid.UUID
}

func (a *access) has(action string) bool { return a != nil && slices.Contains(a.Actions, action) }

// taskActions are the actions of core.tasks among grants, in the order of the catalog.
func taskActions(gs []grant) []string {
	out := []string{}
	for _, k := range taskKeys {
		if slices.ContainsFunc(gs, func(g grant) bool { return g.has(k) }) {
			out = append(out, k)
		}
	}
	return out
}

// covers reports whether a territorial grant reaches a project whose unit has the ancestors path (the unit first):
// the tenant reaches every project, a unit — the project of the unit or, with its descendants, of a unit below it.
func covers(g *grant, p *project, path []uuid.UUID) bool {
	switch g.Kind {
	case kindTenant:
		return true
	case kindUnit:
		if p.Unit == nil {
			return false
		}
		return g.Ref == *p.Unit || (g.Descendants && slices.Contains(path, g.Ref))
	}
	return false
}

// projAccess is the access of m to p (projAccess of the prototype with TP-03): the system role of the owner except in
// a closed project; a role of the project (a grant with the scope of the project, directly or through a group) — its
// actions, the roles of the area do not count there (Q-W4.01-10: several roles of the project add up, the first names
// the access); otherwise the roles of the area covering the project by its level — every action in an open project
// and in a funnel, the reads in a limited one, nothing in a closed one. path is the unit of the project and its
// ancestors, names the names of the units. nil — no access.
func projAccess(p *project, m *member, path []uuid.UUID, names map[uuid.UUID]string) *access {
	if m.Owner && p.Access != levelClosed {
		return &access{Actions: slices.Clone(taskKeys), RoleName: ownerRole, Source: srcSystem, Via: viaSystem}
	}
	if a := ownAccess(p, m); a != nil {
		return a
	}
	if p.level() == levelClosed {
		return nil
	}
	return inheritedAccess(p, m, path, names)
}

// ownAccess is the access of m through its roles of the project p (nil — none).
func ownAccess(p *project, m *member) *access {
	own := slices.DeleteFunc(slices.Clone(m.Grants), func(g grant) bool { return g.Kind != kindProject || g.Ref != p.ID })
	if len(own) == 0 {
		return nil
	}
	first := own[0]
	a := &access{Actions: taskActions(own), RoleName: first.RoleName, RoleID: &first.Role, Source: srcAssigned, Via: viaAssigned,
		Assignment: &first.Assignment}
	if first.Group != uuid.Nil {
		a.Source, a.Via = srcGroup, "Назначен через группу «"+first.GroupName+"»"
	}
	return a
}

// inheritedAccess is the access of m to p through the roles of the area covering it, by the level of p (nil — none).
func inheritedAccess(p *project, m *member, path []uuid.UUID, names map[uuid.UUID]string) *access {
	inherited := slices.DeleteFunc(slices.Clone(m.Grants), func(g grant) bool { return !covers(&g, p, path) || !g.hasTaskKey() })
	if len(inherited) == 0 {
		return nil
	}
	first := inherited[0]
	actions := taskActions(inherited)
	if p.level() == levelLimited {
		actions = slices.DeleteFunc(actions, func(a string) bool { return !slices.Contains(readKeys, a) })
	}
	via := "Наследуется: «" + first.RoleName + "»"
	if first.Kind == kindUnit {
		via += " в «" + names[first.Ref] + "»"
	}
	return &access{Actions: actions, RoleName: first.RoleName, RoleID: &first.Role, Source: srcInherited, Via: via}
}

// canIn is projCan of the prototype: whether m may apply action in p, else the reason word for word.
func canIn(p *project, m *member, action string, path []uuid.UUID, names map[uuid.UUID]string) (bool, string, *access) {
	if m == nil || !m.Active {
		return false, whyBlocked, nil
	}
	a := projAccess(p, m, path, names)
	switch {
	case a == nil && p.level() == levelClosed:
		return false, whyClosed, nil
	case a == nil:
		return false, whyNoRole, nil
	case a.has(action):
		return true, "", a
	}
	why := "роль «" + a.RoleName + "» не даёт «" + verb(action) + "»"
	if a.Source == srcInherited && p.Access == levelLimited {
		why += whyLimitedRead
	}
	return false, why, a
}

// selfGrant reports whether m holds action with the scope «своё» (the tasks assigned to it, x-scope …-self).
func selfGrant(m *member, action string) bool {
	return m != nil && slices.ContainsFunc(m.Grants, func(g grant) bool { return g.Kind == kindSelf && g.has(action) })
}
