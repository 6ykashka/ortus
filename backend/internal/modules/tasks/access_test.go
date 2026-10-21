package tasks

import (
	"slices"
	"testing"

	"github.com/google/uuid"
)

// A world of access: the region Москва and its firm «Север»; the roles of the prototype.
var (
	uMsk      = uuid.MustParse("00000000-0000-4000-8000-0000000000a1")
	uSever    = uuid.MustParse("00000000-0000-4000-8000-0000000000a2")
	uSmr      = uuid.MustParse("00000000-0000-4000-8000-0000000000a3")
	gDrivers  = uuid.MustParse("00000000-0000-4000-8000-0000000000b1")
	unitNames = map[uuid.UUID]string{uMsk: "Москва", uSever: "Север Логистик", uSmr: "Самара"}
	pathSever = []uuid.UUID{uSever, uMsk}
	pmActions = []string{actProjectsRead, actProjectsManage, actRead, actCreate, actUpdate, actTransition, actApprove,
		actMembersManage, actWorkflowManage, actAutomation, actFilesRead, "files.upload"}
	execActions    = []string{actProjectsRead, actRead, actCreate, actUpdate, actTransition, actFilesRead, "files.upload"}
	viewerActions  = []string{actProjectsRead, actRead, actFilesRead}
	managerActions = []string{"members.read", actRead, actCreate, actUpdate, actTransition, "fleet.trips.read"}
)

func projectAt(level string, unit *uuid.UUID) *project {
	return &project{ID: uuid.New(), Key: "LOG", Name: "Логистика · Север", Unit: unit, Access: level, Flow: flowTasks}
}

func onProject(p *project, role string, actions []string) grant {
	return grant{Assignment: uuid.New(), Role: uuid.New(), RoleName: role, Actions: actions, Kind: kindProject, Ref: p.ID}
}

func onUnit(unit uuid.UUID, role string, actions []string) grant {
	return grant{Assignment: uuid.New(), Role: uuid.New(), RoleName: role, Actions: actions, Kind: kindUnit, Ref: unit, Descendants: true}
}

func onTenant(role string, actions []string) grant {
	return grant{Assignment: uuid.New(), Role: uuid.New(), RoleName: role, Actions: actions, Kind: kindTenant}
}

func someone(grants ...grant) *member {
	return &member{ID: uuid.New(), Name: "Марина Котова", Active: true, Grants: grants}
}

// projAccess of the prototype (models.js:194–213) with TP-03: the system role of the owner except in a closed
// project, a role of the project (assigned or through a group) replacing the roles of the area, an inherited role
// by the level (open — every action, limited — reading, closed — nothing).
func TestProjAccess(t *testing.T) {
	t.Parallel()
	sever := uSever
	open, limited, closed := projectAt(levelOpen, &sever), projectAt(levelLimited, &sever), projectAt(levelClosed, &sever)
	funnel := projectAt("", &sever)
	funnel.Flow = flowLeads
	owner := someone()
	owner.Owner = true
	for name, tc := range map[string]struct {
		p       *project
		m       *member
		actions []string
		role    string
		source  string
		via     string
	}{
		"владелец в открытом":     {open, owner, taskKeys, "Владелец бизнеса", "system", "Системная роль, вся организация"},
		"владелец в ограниченном": {limited, owner, taskKeys, "Владелец бизнеса", "system", "Системная роль, вся организация"},
		"роль проекта":            {closed, someone(onProject(closed, "Руководитель проекта", pmActions)), taskKeys, "Руководитель проекта", "assigned", "Назначен в проекте"},
		"роль области в открытом": {open, someone(onUnit(uMsk, "Менеджер логистики", managerActions)),
			[]string{actRead, actCreate, actUpdate, actTransition}, "Менеджер логистики", "inherited", "Наследуется: «Менеджер логистики» в «Москва»"},
		"роль области в ограниченном": {limited, someone(onUnit(uSever, "Менеджер логистики", managerActions)),
			[]string{actRead}, "Менеджер логистики", "inherited", "Наследуется: «Менеджер логистики» в «Север Логистик»"},
		"роль организации": {open, someone(onTenant("Наблюдатель", viewerActions)),
			[]string{actProjectsRead, actRead}, "Наблюдатель", "inherited", "Наследуется: «Наблюдатель»"},
		"воронка как открытый": {funnel, someone(onUnit(uMsk, "Менеджер логистики", managerActions)),
			[]string{actRead, actCreate, actUpdate, actTransition}, "Менеджер логистики", "inherited", "Наследуется: «Менеджер логистики» в «Москва»"},
	} {
		a := projAccess(tc.p, tc.m, pathSever, unitNames)
		if a == nil {
			t.Errorf("%s: no access", name)
			continue
		}
		if !slices.Equal(a.Actions, tc.actions) || a.RoleName != tc.role || a.Source != tc.source || a.Via != tc.via {
			t.Errorf("%s: %+v, want %v %s %s %s", name, a, tc.actions, tc.role, tc.source, tc.via)
		}
	}
	for name, tc := range map[string]struct {
		p *project
		m *member
	}{
		"владелец в закрытом (TP-03)":   {closed, owner},
		"роль области в закрытом":       {closed, someone(onUnit(uMsk, "Менеджер логистики", managerActions))},
		"роль другого региона":          {open, someone(onUnit(uSmr, "Менеджер логистики", managerActions))},
		"роль без «Задач»":              {open, someone(onUnit(uMsk, "Кадры", []string{"members.read"}))},
		"роль другого проекта (PD-53)":  {open, someone(grant{Role: uuid.New(), RoleName: "Исполнитель", Actions: execActions, Kind: kindProject, Ref: uuid.New()})},
		"подразделение без потомков":    {open, someone(grant{Role: uuid.New(), RoleName: "М", Actions: managerActions, Kind: kindUnit, Ref: uMsk})},
		"область всей организации нет":  {projectAt(levelOpen, nil), someone(onUnit(uMsk, "Менеджер логистики", managerActions))},
		"«своё» в наследование не идёт": {open, someone(grant{Role: uuid.New(), RoleName: "Прораб", Actions: []string{actRead, actCreate}, Kind: kindSelf})},
	} {
		if a := projAccess(tc.p, tc.m, pathSever, unitNames); a != nil {
			t.Errorf("%s: %+v, want no access", name, a)
		}
	}
}

// A role of the project replaces the roles of the area (Q-W4.01-10, projAccess): «Наблюдатель» in the project with a
// role of the firm that changes tasks only reads there; several roles in one project add up, the first names it.
func TestProjAccessOwnRole(t *testing.T) {
	t.Parallel()
	sever := uSever
	p := projectAt(levelOpen, &sever)
	viewer := onProject(p, "Наблюдатель", viewerActions)
	m := someone(onUnit(uMsk, "Менеджер логистики", managerActions), viewer)
	a := projAccess(p, m, pathSever, unitNames)
	if a == nil || !slices.Equal(a.Actions, []string{actProjectsRead, actRead}) || a.RoleName != "Наблюдатель" ||
		a.RoleID == nil || *a.RoleID != viewer.Role || a.Assignment == nil || *a.Assignment != viewer.Assignment {
		t.Fatalf("viewer with a firm role: %+v", a)
	}
	approver := onProject(p, "Согласующий", []string{actProjectsRead, actRead, actApprove})
	both := someone(viewer, approver)
	if a := projAccess(p, both, pathSever, unitNames); !slices.Equal(a.Actions, []string{actProjectsRead, actRead, actApprove}) || a.RoleName != "Наблюдатель" {
		t.Fatalf("two roles: %+v", a)
	}
	group := onProject(p, "Исполнитель", execActions)
	group.Group, group.GroupName = gDrivers, "Водители Север"
	if a := projAccess(p, someone(group), pathSever, unitNames); a.Source != "group" || a.Via != "Назначен через группу «Водители Север»" ||
		!slices.Equal(a.Actions, []string{actProjectsRead, actRead, actCreate, actUpdate, actTransition}) {
		t.Fatalf("through a group: %+v", a)
	}
}

// projCan of the prototype (models.js:208–212): the reason of a refusal word for word.
func TestCanIn(t *testing.T) {
	t.Parallel()
	sever := uSever
	open, limited, closed := projectAt(levelOpen, &sever), projectAt(levelLimited, &sever), projectAt(levelClosed, &sever)
	manager := someone(onUnit(uMsk, "Менеджер логистики", managerActions))
	blocked := someone(onProject(open, "Руководитель проекта", pmActions))
	blocked.Active = false
	for name, tc := range map[string]struct {
		p      *project
		m      *member
		action string
		ok     bool
		why    string
	}{
		"заблокирован":         {open, blocked, actRead, false, "сотрудник заблокирован"},
		"закрытый":             {closed, manager, actRead, false, "закрытый проект — нужна роль в самом проекте"},
		"нет роли":             {open, someone(), actRead, false, "нет роли с правом «Задачи» в области проекта"},
		"роль не даёт":         {open, manager, actApprove, false, "роль «Менеджер логистики» не даёт «Согласовывать»"},
		"ограниченный":         {limited, manager, actTransition, false, "роль «Менеджер логистики» не даёт «Менять статус»: в ограниченном проекте унаследованный доступ — только чтение"},
		"ограниченный, чтение": {limited, manager, actRead, true, ""},
		"настраивать":          {open, manager, actWorkflowManage, false, "роль «Менеджер логистики» не даёт «Настраивать»"},
		"открытый":             {open, manager, actTransition, true, ""},
	} {
		ok, why, _ := canIn(tc.p, tc.m, tc.action, pathSever, unitNames)
		if ok != tc.ok || why != tc.why {
			t.Errorf("%s: %v «%s», want %v «%s»", name, ok, why, tc.ok, tc.why)
		}
	}
}

// «своё» (scope self) gives an action on the tasks assigned to the member, whatever the project.
func TestSelfGrant(t *testing.T) {
	t.Parallel()
	foreman := someone(grant{Role: uuid.New(), RoleName: "Прораб", Actions: []string{actRead, actCreate, "files.read"}, Kind: kindSelf})
	if !selfGrant(foreman, actRead) || selfGrant(foreman, actUpdate) || selfGrant(someone(), actRead) {
		t.Error("self grants")
	}
}
