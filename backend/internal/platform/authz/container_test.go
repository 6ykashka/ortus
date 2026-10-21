package authz

import (
	"slices"
	"testing"

	"github.com/google/uuid"
)

// task is a task of project id at level (ReadAction tasks.read), in Москва-1, assigned to persons.
func task(id uuid.UUID, level Level, persons ...uuid.UUID) Resource {
	return Resource{Unit: uMsk1, Objects: objects(KindProject, id), Container: ProjectContainer(level), ReadAction: aTasksRead,
		Persons: persons}
}

// noProject is a task whose resource names the container but not the project (a mistake of the wiring of a module).
func noProject(level Level) Resource {
	return Resource{Unit: uMsk1, Container: ProjectContainer(level), ReadAction: aTasksRead}
}

// projAccess (W4.10, models.js 194–216) в оценщике: роль фирмы наследуется по уровню доступа проекта — открытый даёт
// все действия роли, ограниченный — только чтение (правка видимой задачи — 403), закрытый — ничего (задача невидима —
// 404). Своя роль в проекте даёт всё на любом уровне; «своё» (self) не наследуется, а покрывает свои задачи.
func TestPermitProjectLevels(t *testing.T) {
	t.Parallel()
	ev, _ := newStage4World(t)
	runPermit4(t, ev, []permitCase{
		{"открытый: читать", pUnitTasks, aTasksRead, task(projOther, LevelOpen), ""},
		{"открытый: править", pUnitTasks, aTasksUpd, task(projOther, LevelOpen), ""},
		{"ограниченный: читать", pUnitTasks, aTasksRead, task(projOther, LevelLimited), ""},
		{"ограниченный: видеть проект", pUnitTasks, aProjectsRead, task(projOther, LevelLimited), ""},
		{"ограниченный: править — видит, но нельзя", pUnitTasks, aTasksUpd, task(projOther, LevelLimited), codeForbidden},
		{"закрытый: читать", pUnitTasks, aTasksRead, task(projOther, LevelClosed), codeNotFound},
		{"закрытый: править", pUnitTasks, aTasksUpd, task(projOther, LevelClosed), codeNotFound},
		{"уровень не задан — закрытый", pUnitTasks, aTasksRead, task(projOther, ""), codeNotFound},
		{"роль в закрытом проекте", pLead, aTasksApprove, task(projFleet, LevelClosed), ""},
		{"своя задача в закрытом проекте", pSelfTasks, aTasksUpd, task(projOther, LevelClosed, pSelfTasks), ""},
		{"чужая задача в закрытом проекте", pSelfTasks, aTasksRead, task(projOther, LevelClosed, pLead), codeNotFound},
	})
}

// projAccess (W4.10, access.ts:27–37): своя роль в проекте заменяет унаследованную — при роли с областью «проект» на
// этот проект действуют только её действия, роль фирмы или региона в нём не добавляется (на любом уровне). В других
// проектах роль фирмы наследуется как обычно.
func TestPermitProjectOwnRoleReplacesInherited(t *testing.T) {
	t.Parallel()
	ev, _ := newStage4World(t)
	runPermit4(t, ev, []permitCase{
		{"своя роль «Наблюдатель»: читать", pObsUnit, aTasksRead, task(projFleet, LevelOpen), ""},
		{"своя роль «Наблюдатель»: править — роль фирмы не добавляется", pObsUnit, aTasksUpd, task(projFleet, LevelOpen), codeForbidden},
		{"своя роль в ограниченном: править", pObsUnit, aTasksUpd, task(projFleet, LevelLimited), codeForbidden},
		{"своя роль в закрытом: читать", pObsUnit, aTasksRead, task(projFleet, LevelClosed), ""},
		{"другой открытый проект: роль фирмы правит", pObsUnit, aTasksUpd, task(projOther, LevelOpen), ""},
		{"другой ограниченный проект: роль фирмы читает", pObsUnit, aTasksRead, task(projOther, LevelLimited), ""},
		// Q-W4.01-15: контейнер без Objects[project] — проект строки не узнать; при своей роли в каком-нибудь проекте
		// территориальный грант не действует (как ScopeQuery без колонки проекта), без ролей в проектах — по уровню.
		{"контейнер без проекта при своей роли: читать", pObsUnit, aTasksRead, noProject(LevelOpen), codeNotFound},
		{"контейнер без проекта при своей роли: править", pObsUnit, aTasksUpd, noProject(LevelOpen), codeNotFound},
		{"контейнер без проекта без ролей в проектах", pUnitTasks, aTasksUpd, noProject(LevelOpen), ""},
	})
}

// scopeQuery повторяет замену: территориальный грант не действует в строках проектов, где у субъекта своя роль;
// без колонки проекта такие строки не отличить — территориальные гранты не действуют (fail-closed).
func TestScopeQueryProjectOwnRoleReplacesInherited(t *testing.T) {
	t.Parallel()
	ev, _ := newStage4World(t)
	cols := Columns{Unit: "t.unit_id", Objects: map[string]string{KindProject: "t.project_id"}, Container: ProjectColumns("p.access")}
	const open, readable = "p.access = 'open'", "p.access in ('open', 'limited')"
	for _, tc := range []struct {
		name   string
		action string
		cols   Columns
		sql    string
		args   []any
	}{
		{"читать", aTasksRead, cols, "(t.project_id = $1 or (t.unit_id" + closure + "$2) and " + readable + " and t.project_id is distinct from $3))",
			[]any{projFleet, uMsk1, projFleet}},
		{"править", aTasksUpd, cols, "((t.unit_id" + closure + "$1) and " + open + " and t.project_id is distinct from $2))", []any{uMsk1, projFleet}},
		{"без колонки проекта", aTasksUpd, Columns{Unit: "t.unit_id", Container: ProjectColumns("p.access")}, "false", nil},
	} {
		p, err := ev.ScopeQuery(t.Context(), as(pObsUnit, false), tc.action, tc.cols, 0)
		if err != nil || p.SQL != tc.sql || !slices.Equal(p.Args, tc.args) {
			t.Errorf("%s:\n got %s %v %v\nwant %s %v", tc.name, p.SQL, p.Args, err, tc.sql, tc.args)
		}
	}
	// the space keeps the union of kbAccess: a role of the space and the role of the firm add up
	space := Columns{Unit: "s.unit_id", Objects: map[string]string{KindSpace: "s.id"}, Container: SpaceColumns("s.access")}
	if p, err := ev.ScopeQuery(t.Context(), as(pKbEditor, false), aKbUpdate, space, 0); err != nil ||
		p.SQL != "((s.unit_id"+closure+"$1) and s.access = 'open'))" {
		t.Errorf("space: %q %v", p.SQL, err)
	}
}

// TP-03 (ответы 17.10, Q-W4.10-4): закрытый проект закрыт и владельцу бизнеса, кроме его роли в самом проекте;
// открытый и ограниченный — владельцу всё. KB-04 (Q-W4.30-9): закрытое пространство владелец видит.
func TestPermitOwnerAndClosedContainers(t *testing.T) {
	t.Parallel()
	ev, src := newStage4World(t)
	for _, tc := range []struct {
		name   string
		person uuid.UUID
		action string
		r      Resource
		code   string
	}{
		{"владелец: открытый проект", pOwner, aTasksUpd, task(projOther, LevelOpen), ""},
		{"владелец: ограниченный проект", pOwner, aTasksUpd, task(projOther, LevelLimited), ""},
		{"владелец: закрытый проект", pOwner, aTasksRead, task(projOther, LevelClosed), codeNotFound},
		{"владелец с ролью в закрытом проекте", pOwnerInProj, aTasksUpd, task(projClosed, LevelClosed), ""},
		{"владелец с ролью в другом закрытом проекте", pOwnerInProj, aTasksRead, task(projOther, LevelClosed), codeNotFound},
		{"владелец: закрытое пространство", pOwner, aKbUpdate, Resource{Objects: objects(KindSpace, spaceRules),
			Container: SpaceContainer(LevelClosed), ReadAction: aKbRead}, ""},
	} {
		wantCode(t, tc.name, ev.Permit(t.Context(), as(tc.person, true), tc.action, tc.r), tc.code)
	}
	src.calls = 0
	wantCode(t, "владелец вне закрытого не читает гранты", ev.Permit(t.Context(), as(pOwner, true), aTasksUpd, task(projOther, LevelOpen)), "")
	if src.calls != 0 {
		t.Errorf("owner, open project: %d source calls, want 0", src.calls)
	}
}

// Уровень пространства (kbAccess): роль фирмы в открытом пространстве — всё, в ограниченном — чтение, в закрытом —
// ничего; роль пространства — всё. Уровень приходит от резолвера пространства.
func TestPermitSpaceLevels(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		level  Level
		action string
		code   string
	}{
		{LevelOpen, aKbUpdate, ""},
		{LevelLimited, aKbRead, ""},
		{LevelLimited, aKbUpdate, codeForbidden},
		{LevelClosed, aKbRead, codeNotFound},
	} {
		ev, _ := newStage4World(t)
		ev.Places[KindSpace] = fakePlaces{kind: KindSpace, spaceLevel: tc.level}
		wantCode(t, string(tc.level)+" "+tc.action, ev.Permit(t.Context(), as(pKbEditor, false), tc.action, page(pageOpen, uuid.Nil)), tc.code)
		wantCode(t, string(tc.level)+" роль пространства", ev.Permit(t.Context(), as(pSpaceLead, false), aKbUpdate, page(pageOpen, uuid.Nil)), "")
	}
}

// Действия, которые территориальный грант сохраняет в ограниченном контейнере («только чтение»), регистрирует модуль
// контейнера (Evaluator.ContainerReads), а не платформа: новое чтение задач или БЗ не требует правки authz.
// Незарегистрированный вид контейнера в ограниченном уровне не даёт ничего (fail-closed).
func TestContainerReadsFromModule(t *testing.T) {
	t.Parallel()
	ev, _ := newStage4World(t)
	ev.ContainerReads = map[string][]string{KindProject: {aTasksRead}}
	ev.Places[KindSpace] = fakePlaces{kind: KindSpace, spaceLevel: LevelLimited}
	runPermit4(t, ev, []permitCase{
		{"зарегистрированное чтение", pUnitTasks, aTasksRead, task(projOther, LevelLimited), ""},
		{"не зарегистрировано модулем", pUnitTasks, aProjectsRead, task(projOther, LevelLimited), codeForbidden},
		{"вид контейнера без регистрации", pKbReader, aKbRead, page(pageOpen, uuid.Nil), codeNotFound},
	})
	cols := Columns{Unit: "t.unit_id", Container: ProjectColumns("p.access")}
	for action, want := range map[string]string{
		aTasksRead:    "((t.unit_id" + closure + "$1) and p.access in ('open', 'limited')))",
		aProjectsRead: "((t.unit_id" + closure + "$1) and p.access = 'open'))",
	} {
		if p, err := ev.ScopeQuery(t.Context(), as(pUnitTasks, false), action, cols, 0); err != nil || p.SQL != want {
			t.Errorf("%s: %q %v, want %q", action, p.SQL, err, want)
		}
	}
}

// scopeQuery с уровнем контейнера: территориальные гранты — только в открытых (и ограниченных — для чтения)
// контейнерах; роль на проекте — без условия; владелец — всё, кроме закрытых проектов без его роли (TP-03).
func TestScopeQueryContainerLevels(t *testing.T) {
	t.Parallel()
	ev, _ := newStage4World(t)
	cols := Columns{Unit: "t.unit_id", Objects: map[string]string{KindProject: "t.project_id"}, Persons: []string{"t.assignee_id"},
		Container: ProjectColumns("p.access")}
	const open, readable = "p.access = 'open'", "p.access in ('open', 'limited')"
	for _, tc := range []struct {
		name   string
		person uuid.UUID
		owner  bool
		action string
		sql    string
		args   []any
	}{
		{"фирма: читать", pUnitTasks, false, aTasksRead, "((t.unit_id" + closure + "$1) and " + readable + "))", []any{uMsk1}},
		{"фирма: править", pUnitTasks, false, aTasksUpd, "((t.unit_id" + closure + "$1) and " + open + "))", []any{uMsk1}},
		{"организация: читать", pReader, false, aTasksRead, "(" + readable + ")", nil},
		{"роль проекта", pLead, false, aTasksRead, "(t.project_id = $1)", []any{projFleet}},
		{"своё", pSelfTasks, false, aTasksRead, "((t.assignee_id = $1))", []any{pSelfTasks}},
		{"владелец", pOwner, true, aTasksRead, "(" + readable + ")", nil},
		{"владелец с ролью проекта", pOwnerInProj, true, aTasksRead, "(" + readable + " or (t.project_id = $1))", []any{projClosed}},
	} {
		p, err := ev.ScopeQuery(t.Context(), as(tc.person, tc.owner), tc.action, cols, 0)
		if err != nil || p.SQL != tc.sql || !slices.Equal(p.Args, tc.args) {
			t.Errorf("%s:\n got %s %v %v\nwant %s %v", tc.name, p.SQL, p.Args, err, tc.sql, tc.args)
		}
	}
	space := Columns{Unit: "s.unit_id", Container: SpaceColumns("s.access")}
	if p, err := ev.ScopeQuery(t.Context(), as(pOwner, true), aKbRead, space, 0); err != nil || p.SQL != "true" {
		t.Errorf("owner, spaces (KB-04): %q %v", p.SQL, err)
	}
}
