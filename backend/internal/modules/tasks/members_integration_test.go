//go:build integration

package tasks

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: clock of the suites
)

// groupRole adds a group with members and gives it role with the scope of p; it returns the group.
func groupRole(t *testing.T, name string, p, role uuid.UUID, actors ...string) uuid.UUID {
	t.Helper()
	ctx := t.Context()
	g := uuid.New()
	if _, err := superA.Exec(ctx, `insert into access.groups (id, name) values ($1, $2)`, g, name); err != nil {
		t.Fatal(err)
	}
	for _, a := range actors {
		if _, err := superA.Exec(ctx, `insert into access.group_members (group_id, person_id) values ($1, $2)`, g, person(a)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := superA.Exec(ctx, `insert into access.role_assignments (principal_kind, principal_id, role_id, role_version,
		scope_kind, scope_ref, include_descendants, valid, granted_by) values ('group', $1, $2, 1, 'project', $3, false,
		tstzrange($4::timestamptz, null), $5)`, g, role, p, harness.Now().Add(-time.Hour), person("a.owner")); err != nil {
		t.Fatal(err)
	}
	return g
}

func row(t *testing.T, l tasksapi.TaskProjectMemberList, actor string) tasksapi.TaskProjectMember {
	t.Helper()
	i := slices.IndexFunc(l.Items, func(m tasksapi.TaskProjectMember) bool { return m.MemberId == person(actor) })
	if i < 0 {
		t.Fatalf("no %s among %+v", actor, l.Items)
	}
	return l.Items[i]
}

// «Участники» (projAccess for every member): a role assigned in the project, through a group, inherited by the level,
// the system role of the owner; «финансы скрыты» for the function «Водитель»; the roles of projects of the organization.
func TestMembers(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	msk1 := unit("msk1")
	p := fresh(t, "УЧС", &msk1, tasksapi.Limited, tasksapi.Approval)
	assign(t, p.Id, "a.project-approver", roleApprover)
	groupRole(t, "Водители проекта УЧС", p.Id, roleExec, "a.driver-msk1")
	l := must(service().Members(ctx, as(t, "a.owner"), p.Id)).of(t)
	approver := row(t, l, "a.project-approver")
	same(t, "approver", []any{approver.Source, approver.Via, approver.Editable, approver.RoleName, approver.AssignmentId != nil, approver.Actions},
		[]any{tasksapi.TaskProjectMemberSourceAssigned, "Назначен в проекте", true, "Согласующий", true, []string{actProjectsRead, actRead, actApprove}})
	driver := row(t, l, "a.driver-msk1")
	same(t, "driver", []any{driver.Source, driver.Via, driver.Editable, val(driver.FunctionNotes)},
		[]any{tasksapi.TaskProjectMemberSourceGroup, "Назначен через группу «Водители проекта УЧС»", false, []string{"финансы скрыты"}})
	temp := row(t, l, "a.driver-msk2")
	same(t, "inherited", []any{temp.Source, temp.Via, temp.Actions},
		[]any{tasksapi.TaskProjectMemberSourceInherited, "Наследуется: «Водитель» в «Москва-1»", []string{actRead}})
	owner := row(t, l, "a.owner")
	same(t, "owner", []any{owner.Source, owner.Via}, []any{tasksapi.TaskProjectMemberSourceSystem, "Системная роль, вся организация"})
	same(t, "a member without «Задачи» is listed",
		slices.ContainsFunc(l.Items, func(m tasksapi.TaskProjectMember) bool { return m.MemberId == person("a.manager-msk1") }), false)
	roles := make([]string, 0, len(l.Roles))
	for _, r := range l.Roles {
		roles = append(roles, r.Name)
	}
	same(t, "roles of projects", roles, []string{"Руководитель проекта", "Согласующий", "Исполнитель", "Наблюдатель проекта"})
}

// suspendedDirectory is the directory of the control DB with one person suspended.
type suspendedDirectory struct {
	ControlDirectory
	person uuid.UUID
}

func (d suspendedDirectory) Memberships(ctx context.Context, tenantID uuid.UUID) (map[uuid.UUID]Membership, error) {
	ms, err := d.ControlDirectory.Memberships(ctx, tenantID)
	if err == nil {
		ms[d.person] = Membership{Status: "suspended"}
	}
	return ms, err
}

// setTaskProjectMemberRole: the texts of the prototype, the delegation (409), an assignment with the scope project
// that is replaced, the notice to the owners.
func TestSetMemberRole(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	svc := service()
	msk1 := unit("msk1")
	p := fresh(t, "РОЛ", &msk1, tasksapi.Open, tasksapi.Simple)
	owner := as(t, "a.owner")
	_, err := svc.SetMemberRole(ctx, owner, p.Id, uuid.New(), tasksapi.TaskProjectMemberRoleSet{RoleId: roleExec})
	wantField(t, err, "memberId", "Выберите сотрудника")
	nobody := uuid.New()
	if _, err := superA.Exec(ctx, `insert into people.person_profiles (id, full_name, home_unit_id) values ($1, 'Без входа', $2)`,
		nobody, msk1); err != nil {
		t.Fatal(err)
	}
	_, err = svc.SetMemberRole(ctx, owner, p.Id, nobody, tasksapi.TaskProjectMemberRoleSet{RoleId: roleExec})
	wantField(t, err, "memberId", "Выберите сотрудника")
	blocked := service()
	blocked.Directory = suspendedDirectory{ControlDirectory: ControlDirectory{DB: control}, person: person("a.manager-msk1")}
	_, err = blocked.SetMemberRole(ctx, owner, p.Id, person("a.manager-msk1"), tasksapi.TaskProjectMemberRoleSet{RoleId: roleExec})
	wantField(t, err, "memberId", "Менеджер Москва-1 заблокирован — назначить роль нельзя")
	_, err = svc.SetMemberRole(ctx, owner, p.Id, person("a.manager-msk2"), tasksapi.TaskProjectMemberRoleSet{RoleId: ref("role:a.manager")})
	wantField(t, err, "roleId", "В проекте назначаются роли проекта")

	m := must(svc.SetMemberRole(ctx, owner, p.Id, person("a.manager-msk2"), tasksapi.TaskProjectMemberRoleSet{RoleId: roleExec})).of(t)
	if m.RoleName != "Исполнитель" || m.Source != tasksapi.TaskProjectMemberSourceAssigned || !m.Editable {
		t.Fatalf("assigned %+v", m)
	}
	m = must(svc.SetMemberRole(ctx, owner, p.Id, person("a.manager-msk2"), tasksapi.TaskProjectMemberRoleSet{RoleId: roleViewer})).of(t)
	if m.RoleName != "Наблюдатель проекта" {
		t.Fatalf("replaced %+v", m)
	}
	var n int
	if err := superA.QueryRow(ctx, `select count(*) from access.role_assignments where principal_id = $1 and scope_ref = $2 and state = 'active'`,
		person("a.manager-msk2"), p.Id).Scan(&n); err != nil || n != 1 {
		t.Fatalf("one direct assignment, got %d %v", n, err)
	}
	if err := superA.QueryRow(ctx, `select count(*) from notify.notifications where title = $1`,
		"Менеджер Москва-2: роль «Исполнитель» в проекте «Проект РОЛ»").Scan(&n); err != nil || n != 1 {
		t.Fatalf("notice of the role: %d %v", n, err)
	}

	// A member who manages the members of the project but holds less than the role (AUTH-08, delegation).
	small := uuid.New()
	if _, err := superA.Exec(ctx, `insert into access.roles (id, name, kind) values ($1, 'Кадры проекта РОЛ', 'custom')`, small); err != nil {
		t.Fatal(err)
	}
	if _, err := superA.Exec(ctx, `insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`,
		small, []string{actProjectsRead, actRead, actMembersManage}, person("a.owner")); err != nil {
		t.Fatal(err)
	}
	assign(t, p.Id, "a.manager-msk1", small)
	_, err = svc.SetMemberRole(ctx, as(t, "a.manager-msk1"), p.Id, person("a.region-msk"), tasksapi.TaskProjectMemberRoleSet{RoleId: roleManager})
	wantCode(t, err, codeDelegation, "Можно выдать только то, что есть у вас в проекте")
}

// removeTaskProjectMember: not oneself, a group, an inherited or the system access are locked (409), no role — 404.
func TestRemoveMember(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	svc := service()
	msk1 := unit("msk1")
	p := fresh(t, "ИСК", &msk1, tasksapi.Limited, tasksapi.Simple)
	assign(t, p.Id, "a.project-approver", roleApprover)
	groupRole(t, "Водители проекта ИСК", p.Id, roleExec, "a.driver-msk1")
	owner := as(t, "a.owner")
	wantCode(t, svc.RemoveMember(ctx, owner, p.Id, person("a.owner")), codeTransition, "Себя из проекта исключить нельзя")
	wantCode(t, svc.RemoveMember(ctx, owner, p.Id, person("a.driver-msk1")), codeTransition,
		"Доступ Водитель Москва-1 — «Назначен через группу «Водители проекта ИСК»» — меняется только в «Пользователях и ролях»")
	wantCode(t, svc.RemoveMember(ctx, owner, p.Id, person("a.driver-msk2")), codeTransition,
		"Доступ Водитель Москва-2 — «Наследуется: «Водитель» в «Москва-1»» — меняется только в «Пользователях и ролях»")
	wantCode(t, svc.RemoveMember(ctx, owner, p.Id, person("a.manager-msk1")), codeNotFound, "Роли в проекте нет")
	wantCode(t, svc.RemoveMember(ctx, owner, p.Id, uuid.New()), codeNotFound, "Сотрудник не найден")
	if err := svc.RemoveMember(ctx, owner, p.Id, person("a.project-approver")); err != nil {
		t.Fatal(err)
	}
	l := must(svc.Members(ctx, owner, p.Id)).of(t)
	if slices.ContainsFunc(l.Items, func(m tasksapi.TaskProjectMember) bool { return m.MemberId == person("a.project-approver") }) {
		t.Fatal("the removed member keeps access")
	}
	wantCode(t, svc.RemoveMember(ctx, owner, p.Id, person("a.project-approver")), codeNotFound, "Роли в проекте нет")
	_, err := svc.Project(ctx, as(t, "a.project-approver"), p.Id)
	wantCode(t, err, codeNotFound, textNoProject)
}

// «Проверить доступ» (projCan): who may check (Q-W4.00-tasks-7) and the reasons of the prototype word for word.
func TestCheckAccess(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	svc := service()
	msk1 := unit("msk1")
	p := fresh(t, "ПРВ", &msk1, tasksapi.Limited, tasksapi.Simple)
	assign(t, p.Id, "a.project-approver", roleApprover)
	owner := as(t, "a.owner")
	for _, tc := range []struct {
		actor, action string
		allowed       bool
		reason, via   string
	}{
		{"a.project-approver", actApprove, true, "", "Назначен в проекте"},
		{"a.project-approver", actTransition, false, "роль «Согласующий» не даёт «Менять статус»", "Назначен в проекте"},
		{"a.driver-msk2", actTransition, false, "роль «Водитель» не даёт «Менять статус»: в ограниченном проекте унаследованный доступ — только чтение",
			"Наследуется: «Водитель» в «Москва-1»"},
		{"a.manager-msk1", actRead, false, "нет роли с правом «Задачи» в области проекта", ""},
	} {
		got := must(svc.CheckAccess(ctx, owner, p.Id, person(tc.actor), tc.action)).of(t)
		reason, via := "", ""
		if got.Reason != nil {
			reason = *got.Reason
		}
		if got.Via != nil {
			via = *got.Via
		}
		if got.Allowed != tc.allowed || reason != tc.reason || via != tc.via {
			t.Errorf("%s %s: %+v (reason «%s», via «%s»)", tc.actor, tc.action, got, reason, via)
		}
	}
	_, err := svc.CheckAccess(ctx, as(t, "a.project-approver"), p.Id, person("a.owner"), actRead)
	wantCode(t, err, codeForbidden, "Проверять доступ может руководитель проекта")
	// members.read over the area of the project (the manager of Москва-1) — without access to the project it is 404.
	_, err = svc.CheckAccess(ctx, as(t, "a.manager-msk1"), p.Id, person("a.owner"), actRead)
	wantCode(t, err, codeNotFound, textNoProject)
	_, err = svc.CheckAccess(ctx, owner, p.Id, uuid.New(), actRead)
	wantCode(t, err, codeNotFound, "Сотрудник не найден")
}
