//go:build integration

package tasks

import (
	"slices"
	"testing"

	"github.com/google/uuid"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
)

// listTaskProjects and getTaskProject (TP-03, PD-60): the owner sees «Автопарк» (limited) with the system role and not
// the closed «Стройка»; the project lead sees his project only; a closed project is 404 for both.
func TestProjectsVisibility(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	svc := service()
	fleet, build := ref("project:a.fleet"), ref("project:a.build")
	owner := projectIDs(must(svc.Projects(ctx, as(t, "a.owner"), nil, nil)).of(t).Items)
	same(t, "owner sees «Автопарк», not «Стройка»", []bool{slices.Contains(owner, fleet), slices.Contains(owner, build)}, []bool{true, false})
	lead := must(svc.Projects(ctx, as(t, "a.project-lead"), nil, nil)).of(t)
	same(t, "lead projects", projectIDs(lead.Items), []uuid.UUID{fleet})
	p := lead.Items[0]
	same(t, "myAccess of the lead", *p.MyAccess, tasksapi.TaskProjectMyAccess{RoleName: "Руководитель проекта",
		Source: tasksapi.TaskProjectMyAccessSourceAssigned, Via: "Назначен в проекте", Actions: p.MyAccess.Actions, RoleId: new(roleManager)})
	same(t, "actions of the lead", len(p.MyAccess.Actions), len(taskKeys))
	same(t, "level, flow, workflow", []any{val(p.Access), val(p.Flow), val(p.Workflow).Version, val(p.Workflow).HasDraft},
		[]any{tasksapi.Limited, tasksapi.Tasks, 1, false})
	// «Людей»: the project lead, the approver and a.driver-msk2 (the role «Водитель» of Москва-1 for a week: reading in a
	// limited project); the owner (system) is not counted.
	same(t, "counts", val(p.Counts), tasksapi.TaskProjectCounts{Members: 3, Open: 2})
	ownerFleet := must(svc.Project(ctx, as(t, "a.owner"), fleet)).of(t)
	same(t, "access of the owner", []any{ownerFleet.MyAccess.Source, ownerFleet.MyAccess.RoleName, ownerFleet.MyAccess.Via},
		[]any{tasksapi.TaskProjectMyAccessSourceSystem, "Владелец бизнеса", "Системная роль, вся организация"})
	for _, actor := range []string{"a.owner", "a.project-lead"} {
		_, err := svc.Project(ctx, as(t, actor), build)
		wantCode(t, err, codeNotFound, textNoProject)
	}
	_, err := svc.Project(ctx, as(t, "a.owner"), uuid.New())
	wantCode(t, err, codeNotFound, textNoProject)
	// The driver (tasks only in the scope self, other tests give him roles in their projects) sees neither project.
	drv := projectIDs(must(svc.Projects(ctx, as(t, "a.driver-msk1"), nil, nil)).of(t).Items)
	same(t, "the driver sees «Автопарк», «Стройка»", []bool{slices.Contains(drv, fleet), slices.Contains(drv, build)}, []bool{false, false})
}

// createTaskProject (createProject of the prototype): the texts of the prototype in its order; the creator becomes the
// project manager; the copy takes the workflow and the rules disabled; the owners are notified.
func TestCreateProject(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	svc := service()
	msk1 := unit("msk1")
	b := func(name, key string, area *uuid.UUID, tmpl tasksapi.ProjectCreateWorkflowKey) tasksapi.ProjectCreate {
		return tasksapi.ProjectCreate{Name: name, Key: key, OrgUnitId: area, WorkflowKey: tmpl}
	}
	owner := as(t, "a.owner")
	missing := uuid.New()
	_, err := svc.CreateProject(ctx, owner, b("Ремонт · ЖК Речной", "РЧН", &missing, tasksapi.Simple))
	wantField(t, err, "orgUnitId", "Выберите область проекта")
	_, err = svc.CreateProject(ctx, as(t, "a.project-lead"), b("Ремонт · ЖК Речной", "РЧН", &msk1, tasksapi.Simple))
	wantCode(t, err, codeForbidden, "Создавать проекты может роль с правом «Задачи · Настраивать»")
	_, err = svc.CreateProject(ctx, owner, b(" Ре ", "РЧН", &msk1, tasksapi.Simple))
	wantField(t, err, "name", "Название — не короче 3 символов")
	for _, key := range []string{"рчн", "1АБ", "А", "АБВГДЕЖ"} {
		_, err = svc.CreateProject(ctx, owner, b("Ремонт · ЖК Речной", key, &msk1, tasksapi.Simple))
		wantField(t, err, "key", "Ключ — 2–6 заглавных букв или цифр, первая — буква")
	}
	_, err = svc.CreateProject(ctx, owner, b("Дубль", "АВТ", &msk1, tasksapi.Simple))
	wantField(t, err, "key", "Ключ АВТ уже занят")
	_, err = svc.CreateProject(ctx, owner, b("Копия", "КОП", &msk1, tasksapi.Copy))
	wantField(t, err, "copyFromProjectId", "Выберите проект, процесс которого копировать")
	build := ref("project:a.build")
	c := b("Копия", "КОП", &msk1, tasksapi.Copy)
	c.CopyFromProjectId = &build
	_, err = svc.CreateProject(ctx, owner, c)
	wantField(t, err, "copyFromProjectId", "Выберите проект, процесс которого копировать")

	p := must(svc.CreateProject(ctx, owner, b("Ремонт · ЖК Речной", "РЧН", nil, tasksapi.Simple))).of(t)
	same(t, "created", []any{p.Key, p.OrgUnitId, val(p.Access), p.WorkflowKey, val(p.Workflow).Version, val(p.MyAccess).Source, val(p.OwnerDisplayName)},
		[]any{"РЧН", (*uuid.UUID)(nil), tasksapi.Limited, "simple", 1, tasksapi.TaskProjectMyAccessSourceSystem, "Владелец Холдинга"})
	// The creator is its project manager: the role of the project replaces nothing for the owner (the system role first,
	// MSW accessOf) but is the assignment «Руководитель проекта» with the scope of the project.
	same(t, "assignment of the creator", count(t, `select count(*) from access.role_assignments where principal_id = $1 and role_id = $2
		and scope_kind = 'project' and scope_ref = $3 and state = 'active'`, person("a.owner"), roleManager, p.Id), 1)
	wf := must(svc.Workflow(ctx, owner, p.Id)).of(t)
	same(t, "simple workflow", []any{len(wf.Statuses), wf.Transitions[2].Name}, []any{5, "Принять"})
	same(t, "notice to the owner", count(t, `select count(*) from notify.notifications where recipient_person_id = $1 and title = $2`,
		person("a.owner"), "Создан проект «Ремонт · ЖК Речной» (РЧН)"), 1)

	fleet := ref("project:a.fleet")
	c = b("Логистика · копия", "ЛК", &msk1, tasksapi.Copy)
	c.CopyFromProjectId = &fleet
	cp := must(svc.CreateProject(ctx, owner, c)).of(t)
	cwf := must(svc.Workflow(ctx, owner, cp.Id)).of(t)
	same(t, "copied workflow has approval", slices.ContainsFunc(cwf.Transitions, func(tr tasksapi.TaskWorkflowTransition) bool { return tr.Approval != nil }), true)
	rules := must(svc.Automations(ctx, owner, cp.Id)).of(t)
	same(t, "copied rules", len(rules.Items), 1)
	same(t, "copied rule", []any{rules.Items[0].Enabled, rules.Items[0].Name}, []any{false, "Новая задача → комментарий"})
}

// updateTaskProject: the name — «Настраивать» (tasks.projects.manage), the level — tasks.members.manage, If-Match;
// closing a project shuts it to the owner (TP-03).
func TestUpdateProject(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	svc := service()
	msk1 := unit("msk1")
	p := fresh(t, "ОБН", &msk1, tasksapi.Open, tasksapi.Simple)
	assign(t, p.Id, "a.project-approver", roleApprover)
	name := "Обновлённый"
	_, err := svc.UpdateProject(ctx, as(t, "a.project-approver"), p.Id, rev(p.Revision), tasksapi.TaskProjectPatch{Name: &name})
	wantCode(t, err, codeForbidden, "Нет права «Настраивать» в проекте «Проект ОБН»: роль «Согласующий» не даёт «Настраивать»")
	owner := as(t, "a.owner")
	_, err = svc.UpdateProject(ctx, owner, p.Id, "", tasksapi.TaskProjectPatch{Name: &name})
	wantCode(t, err, codeRevRequired, "")
	_, err = svc.UpdateProject(ctx, owner, p.Id, rev(p.Revision+1), tasksapi.TaskProjectPatch{Name: &name})
	wantCode(t, err, codeRevMismatch, "")
	short := "Аб"
	_, err = svc.UpdateProject(ctx, owner, p.Id, rev(p.Revision), tasksapi.TaskProjectPatch{Name: &short})
	wantField(t, err, "name", "Название — не короче 3 символов")
	closed := tasksapi.Closed
	up := must(svc.UpdateProject(ctx, owner, p.Id, rev(p.Revision), tasksapi.TaskProjectPatch{Name: &name, Access: &closed})).of(t)
	if up.Name != name || up.Access == nil || *up.Access != tasksapi.Closed || up.Revision != p.Revision+1 {
		t.Fatalf("updated %+v", up)
	}
	// The owner keeps his role of the project manager (the creator): closed, the project stays his by the role.
	if got := must(svc.Project(ctx, owner, p.Id)).of(t); got.MyAccess == nil || got.MyAccess.Source != tasksapi.TaskProjectMyAccessSourceAssigned {
		t.Fatalf("owner with the role %+v", got.MyAccess)
	}
	_, err = svc.UpdateProject(ctx, as(t, "a.project-approver"), p.Id, rev(up.Revision), tasksapi.TaskProjectPatch{Access: &closed})
	wantCode(t, err, codeForbidden, "")
}

// initTaskProjectWorkflow (TP-06): v1 of the statuses of the tasks 1:1, «all to all»; twice — workflow_exists.
func TestInitWorkflow(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	svc := service()
	owner := as(t, "a.owner")
	id := uuid.New()
	if _, err := superA.Exec(ctx, `insert into tasks.projects (id, key, name, org_unit_id, access, flow, workflow_key, owner_id)
		values ($1, 'БЕЗ', 'Без процесса', $2, 'open', 'tasks', 'initial', $3)`, id, unit("msk1"), person("a.owner")); err != nil {
		t.Fatal(err)
	}
	for i, st := range []string{"В работе", "Новая", "Пауза"} {
		if _, err := superA.Exec(ctx, `insert into tasks.tasks (project_id, number, title, status_id) values ($1, $2, $3, $4)`,
			id, 101+i, "Задача "+st, slug(st)); err != nil {
			t.Fatal(err)
		}
	}
	_, err := svc.Workflow(ctx, owner, id)
	wantCode(t, err, codeNotFound, "Процесс не настроен")
	wf := must(svc.InitWorkflow(ctx, owner, id)).of(t)
	if wf.Version != 1 || len(wf.Statuses) < 4 || wf.Statuses[0].Name != "Новая" || len(wf.Transitions) != len(wf.Statuses) {
		t.Fatalf("v1 %+v", wf)
	}
	_, err = svc.InitWorkflow(ctx, owner, id)
	wantReason(t, err, reasonExists, "У проекта уже есть процесс")
}

// slug is a status id of a test made of a name of a status (the project without a workflow keeps names as ids).
func slug(name string) string {
	switch name {
	case "Новая":
		return "new"
	case "В работе":
		return "progress"
	}
	return "pause"
}

// «Процесс»: the draft is the manager's, the editor refuses repeats, the publication — the texts of the prototype; the
// tasks stay in their statuses and follow the new version.
func TestDraftAndPublish(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	svc := service()
	owner := as(t, "a.owner")
	msk1 := unit("msk1")
	p := fresh(t, "ПРЦ", &msk1, tasksapi.Open, tasksapi.Simple)
	task := newTask(t, "a.owner", p.Id, "Задача в «На проверке»")
	_ = task
	wf := must(svc.Workflow(ctx, owner, p.Id)).of(t)
	_, err := svc.Publish(ctx, owner, p.Id, rev(wf.Revision))
	wantField(t, err, "draft", "Изменений нет")
	d := tasksapi.TaskWorkflowDraftInput{Statuses: append(slices.Clone(wf.Statuses),
		tasksapi.TaskWorkflowStatus{Id: "s6", Name: " новая ", Category: tasksapi.Todo}), Transitions: wf.Transitions}
	_, err = svc.SaveDraft(ctx, owner, p.Id, rev(wf.Revision), d)
	wantField(t, err, "statuses[5].name", "Статус «новая» уже есть")
	d.Statuses[5].Name = "Пауза"
	d.Statuses[5].Category = tasksapi.Progress
	saved := must(svc.SaveDraft(ctx, owner, p.Id, rev(wf.Revision), d)).of(t)
	same(t, "draft", []any{len(val(saved.Draft).Statuses), saved.Revision, saved.Version}, []any{6, wf.Revision + 1, 1})
	assign(t, p.Id, "a.project-approver", roleApprover)
	if viewer := must(svc.Workflow(ctx, as(t, "a.project-approver"), p.Id)).of(t); viewer.Draft != nil {
		t.Fatal("the draft is shown to a member without «Настраивать»")
	}
	_, err = svc.SaveDraft(ctx, owner, p.Id, rev(wf.Revision), d)
	wantCode(t, err, codeRevMismatch, "")
	pub := must(svc.Publish(ctx, owner, p.Id, rev(saved.Revision))).of(t)
	same(t, "published", []any{pub.Version, pub.Draft == nil, len(pub.Statuses)}, []any{2, true, 6})
	got := must(svc.Task(ctx, owner, task.Id)).of(t)
	same(t, "task after the publication", []any{val(got.WorkflowVersion), got.Status}, []any{2, "s1"})
	// Removing the status of a task is refused with its name.
	gone := tasksapi.TaskWorkflowDraftInput{Statuses: pub.Statuses[1:], Transitions: nil}
	saved = must(svc.SaveDraft(ctx, owner, p.Id, rev(pub.Revision), gone)).of(t)
	_, err = svc.Publish(ctx, owner, p.Id, rev(saved.Revision))
	wantField(t, err, "statuses", "Есть задачи в статусах, которых нет в новой версии: Новая. Переведите их или верните статус")
	disc := must(svc.DiscardDraft(ctx, owner, p.Id, rev(saved.Revision))).of(t)
	if disc.Draft != nil {
		t.Fatal("discarded draft")
	}
	_, err = svc.DiscardDraft(ctx, owner, p.Id, rev(disc.Revision))
	wantCode(t, err, codeNotFound, "Черновика нет")
	same(t, "notice of the publication", count(t, `select count(*) from notify.notifications where title = $1`,
		"Опубликован процесс проекта «Проект ПРЦ» v2. Задачи остаются в своих статусах"), 1)
}
