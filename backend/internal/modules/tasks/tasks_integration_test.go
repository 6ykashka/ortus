//go:build integration

package tasks

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: clock of the suites
)

func str(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// history returns the texts of the history of a task, newest first.
func history(t *testing.T, actor string, id uuid.UUID) []string {
	t.Helper()
	h := must(service().History(t.Context(), as(t, actor), id, nil, nil)).of(t)
	out := make([]string, 0, len(h.Items))
	for _, x := range h.Items {
		out = append(out, x.ActorDisplayName+": "+x.Text)
	}
	return out
}

func checklist(t *testing.T, id uuid.UUID, items string) {
	t.Helper()
	if _, err := superA.Exec(t.Context(), `update tasks.tasks set checklist = $2::jsonb where id = $1`, id, items); err != nil {
		t.Fatal(err)
	}
}

func card(t *testing.T, actor string, id uuid.UUID) tasksapi.Task {
	t.Helper()
	return must(service().Task(t.Context(), as(t, actor), id)).of(t)
}

func move(t *testing.T, actor string, id uuid.UUID, key, comment string) (tasksapi.Task, error) {
	t.Helper()
	c := card(t, "a.owner", id)
	b := tasksapi.TaskTransition{TransitionKey: key}
	if comment != "" {
		b.Comment = &comment
	}
	return service().Transition(t.Context(), as(t, actor), id, rev(c.Revision), b)
}

// createTask (createProjectTask): the number {KEY}-101…, the first status of «К выполнению», the author and the
// assignee, the labels lowercased without repeats; the texts of the prototype.
func TestCreateTask(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	svc := service()
	msk1 := unit("msk1")
	p := fresh(t, "ЗДЧ", &msk1, tasksapi.Open, tasksapi.Simple)
	assign(t, p.Id, "a.project-approver", roleApprover)
	labels := []string{" Шины ", "шины", "Закупка"}
	first := newTask(t, "a.owner", p.Id, "Заменить шины", func(b *tasksapi.TaskCreate) { b.Labels = &labels })
	same(t, "created", []any{str(first.Key), first.Status, str(first.StatusName), val(first.AuthorMemberId), val(first.AssigneeMemberId),
		val(first.Labels), val(first.WorkflowVersion)},
		[]any{"ЗДЧ-101", "s1", "Новая", person("a.owner"), person("a.owner"), []string{"шины", "закупка"}, 1})
	second := newTask(t, "a.owner", p.Id, "Проверить тормоза")
	same(t, "second number", str(second.Key), "ЗДЧ-102")
	owner := as(t, "a.owner")
	_, err := svc.CreateTask(ctx, owner, tasksapi.TaskCreate{ProjectId: p.Id, Title: " аб "})
	wantField(t, err, "title", "Тема — не короче 3 символов")
	long := strings.Repeat("я", 5001)
	_, err = svc.CreateTask(ctx, owner, tasksapi.TaskCreate{ProjectId: p.Id, Title: "Длинное", DescriptionMarkdown: &long})
	wantField(t, err, "descriptionMarkdown", "Описание — не длиннее 5000 символов")
	outsider := person("a.manager-msk1")
	_, err = svc.CreateTask(ctx, owner, tasksapi.TaskCreate{ProjectId: p.Id, Title: "Чужому", AssigneeMemberId: &outsider})
	wantField(t, err, "assigneeMemberId", "Исполнитель не видит проект — выберите участника проекта")
	_, err = svc.CreateTask(ctx, as(t, "a.project-approver"), tasksapi.TaskCreate{ProjectId: p.Id, Title: "Согласующий создаёт"})
	wantCode(t, err, codeForbidden, "Нет права «Создавать» в проекте «Проект ЗДЧ»: роль «Согласующий» не даёт «Создавать»")
	board := must(svc.Tasks(ctx, owner, TaskQuery{Project: &p.Id})).of(t)
	same(t, "board, newest first", []uuid.UUID{board.Items[0].Id, board.Items[1].Id}, []uuid.UUID{second.Id, first.Id})
	mine := must(svc.Tasks(ctx, as(t, "a.project-approver"), TaskQuery{Project: &p.Id, Mine: true})).of(t)
	same(t, "«Мои» of the approver", len(mine.Items), 0)
}

// updateTask and updateTaskChecklistItem: If-Match, the assignee who sees the project, the line of the checklist.
func TestUpdateTask(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	svc := service()
	msk1 := unit("msk1")
	p := fresh(t, "ПРВК", &msk1, tasksapi.Open, tasksapi.Simple)
	assign(t, p.Id, "a.project-approver", roleApprover)
	x := newTask(t, "a.owner", p.Id, "Поправить")
	owner := as(t, "a.owner")
	urgent := tasksapi.Urgent
	_, err := svc.UpdateTask(ctx, owner, x.Id, rev(x.Revision+1), tasksapi.TaskPatch{Priority: &urgent})
	wantCode(t, err, codeRevMismatch, "Задачу уже изменили. Обновите и повторите.")
	approver := person("a.project-approver")
	labels := []string{"Срочно"}
	up := must(svc.UpdateTask(ctx, owner, x.Id, rev(x.Revision), tasksapi.TaskPatch{Priority: &urgent, AssigneeMemberId: &approver, Labels: &labels})).of(t)
	if *up.Priority != tasksapi.Urgent || *up.AssigneeMemberId != approver || !slices.Equal(*up.Labels, []string{"срочно"}) || up.Revision != x.Revision+1 {
		t.Fatalf("updated %+v", up)
	}
	_, err = svc.UpdateTask(ctx, as(t, "a.project-approver"), x.Id, rev(up.Revision), tasksapi.TaskPatch{Priority: &urgent})
	wantCode(t, err, codeForbidden, "")
	checklist(t, x.Id, `[{"id":"ch-1","text":"Счёт приложен","done":false}]`)
	c := card(t, "a.owner", x.Id)
	done := must(svc.Checklist(ctx, owner, x.Id, "ch-1", rev(c.Revision), tasksapi.TaskChecklistItemPatch{Done: true})).of(t)
	if !(*done.Checklist)[0].Done {
		t.Fatal("not checked")
	}
	_, err = svc.Checklist(ctx, owner, x.Id, "ch-9", rev(done.Revision), tasksapi.TaskChecklistItemPatch{Done: true})
	wantCode(t, err, codeNotFound, "Пункт чек-листа не найден")
	if h := history(t, "a.owner", x.Id); len(h) == 0 || h[0] != "Владелец Холдинга: отметил(а): Счёт приложен" {
		t.Fatalf("history %v", h)
	}
}

// Transitions of «Простой» (trCheck): «Принять» is the project manager's, the checklist, the comment, the status.
func TestTransitions(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	svc := service()
	msk1 := unit("msk1")
	p := fresh(t, "ПРХ", &msk1, tasksapi.Limited, tasksapi.Simple)
	assign(t, p.Id, "a.driver-msk1", roleExec)
	x := newTask(t, "a.owner", p.Id, "Перевести", func(b *tasksapi.TaskCreate) { b.AssigneeMemberId = new(person("a.driver-msk1")) })
	if _, err := move(t, "a.driver-msk1", x.Id, "t1", ""); err != nil {
		t.Fatal(err)
	}
	moved := must(move(t, "a.driver-msk1", x.Id, "t2", "")).of(t)
	if moved.Status != "s3" {
		t.Fatalf("status %s", moved.Status)
	}
	exec := card(t, "a.driver-msk1", x.Id)
	i := slices.IndexFunc(*exec.AvailableTransitions, func(o tasksapi.TaskTransitionOption) bool { return o.Key == "t3" })
	if i < 0 || (*exec.AvailableTransitions)[i].Allowed || str((*exec.AvailableTransitions)[i].Reason) != codeForbidden ||
		str((*exec.AvailableTransitions)[i].ReasonText) != "Доступно: руководитель проекта" {
		t.Fatalf("options of the executor %+v", exec.AvailableTransitions)
	}
	_, err := move(t, "a.driver-msk1", x.Id, "t3", "")
	wantCode(t, err, codeForbidden, "Доступно: руководитель проекта")
	checklist(t, x.Id, `[{"id":"ch-1","text":"Фото","done":false}]`)
	_, err = move(t, "a.owner", x.Id, "t3", "")
	wantReason(t, err, reasonChecklist, "Сначала закройте чек-лист")
	_, err = move(t, "a.owner", x.Id, "t4", "")
	wantField(t, err, "comment", "Для перехода «Вернуть на доработку» нужен комментарий")
	back := must(move(t, "a.owner", x.Id, "t4", "Нужны фото")).of(t)
	if back.Status != "s2" {
		t.Fatalf("back %s", back.Status)
	}
	if h := history(t, "a.owner", x.Id); h[0] != "Владелец Холдинга: Вернуть на доработку: На проверке → В работе. Нужны фото" {
		t.Fatalf("history %v", h)
	}
	_, err = move(t, "a.owner", x.Id, "t1", "")
	wantReason(t, err, reasonNotIn, "Переход недоступен из текущего статуса")
	_, err = move(t, "a.owner", x.Id, "t9", "")
	wantField(t, err, "transitionKey", "Переход удалён из процесса")
	c := card(t, "a.owner", x.Id)
	_, err = svc.Transition(ctx, as(t, "a.owner"), x.Id, rev(c.Revision-1), tasksapi.TaskTransition{TransitionKey: "t2"})
	wantCode(t, err, codeRevMismatch, "")
	_, err = svc.Transition(ctx, as(t, "a.owner"), x.Id, "", tasksapi.TaskTransition{TransitionKey: "t2"})
	wantCode(t, err, codeRevRequired, "")
}

// «С согласованием», «достаточно одного»: the author does not approve his own, the approver moves the task to
// «Готово» and «на автора»; «нужны все»: the round fixes the approvers, each votes once.
func TestApproval(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	svc := service()
	msk1 := unit("msk1")
	p := fresh(t, "СГЛ", &msk1, tasksapi.Limited, tasksapi.Approval)
	assign(t, p.Id, "a.project-approver", roleApprover)
	assign(t, p.Id, "a.driver-msk1", roleExec)
	x := newTask(t, "a.driver-msk1", p.Id, "Заменить шины")
	must(move(t, "a.driver-msk1", x.Id, "t1", "")).of(t)
	must(move(t, "a.driver-msk1", x.Id, "t2", "")).of(t)
	c := card(t, "a.driver-msk1", x.Id)
	a := val(c.Approval)
	same(t, "approval of the author", []any{a.TransitionKey, a.Mode, a.CanApprove}, []any{"t3", tasksapi.TaskApprovalStateModeAny, false})
	who := make([]string, 0, len(a.Approvers))
	for _, x := range a.Approvers {
		who = append(who, x.DisplayName)
	}
	same(t, "approvers", who, []string{"Владелец Холдинга", "Согласующий проекта"})
	_, err := move(t, "a.driver-msk1", x.Id, "t3", "")
	wantCode(t, err, codeForbidden, "Согласует роль с правом «Согласовывать»; у вас роль «Исполнитель» не даёт «Согласовывать»")
	pending := must(svc.Tasks(ctx, as(t, "a.project-approver"), TaskQuery{Awaiting: true})).of(t)
	same(t, "«Ждут моего согласия»", slices.ContainsFunc(pending.Items, func(x2 tasksapi.Task) bool { return x2.Id == x.Id }), true)
	done := must(move(t, "a.project-approver", x.Id, "t3", "Счёт проверен")).of(t)
	same(t, "approved", []any{done.Status, val(done.AssigneeMemberId)}, []any{"s4", person("a.driver-msk1")})
	h := history(t, "a.owner", x.Id)
	same(t, "history", []bool{slices.Contains(h, "Согласующий проекта: Согласовать: На проверке → Готово. Счёт проверен"),
		slices.Contains(h, "Процесс: Назначено на автора: Водитель Москва-1")}, []bool{true, true})

	// «Нужны все»: a new version with the mode all.
	wf := must(svc.Workflow(ctx, as(t, "a.owner"), p.Id)).of(t)
	d := tasksapi.TaskWorkflowDraftInput{Statuses: wf.Statuses, Transitions: slices.Clone(wf.Transitions)}
	for i := range d.Transitions {
		if d.Transitions[i].Approval != nil {
			d.Transitions[i].Approval = &tasksapi.TaskWorkflowApproval{Mode: tasksapi.TaskWorkflowApprovalModeAll, RejectTo: "s2"}
		}
	}
	saved := must(svc.SaveDraft(ctx, as(t, "a.owner"), p.Id, rev(wf.Revision), d)).of(t)
	must(svc.Publish(ctx, as(t, "a.owner"), p.Id, rev(saved.Revision))).of(t)
	y := newTask(t, "a.driver-msk1", p.Id, "Подготовить парк")
	must(move(t, "a.driver-msk1", y.Id, "t1", "")).of(t)
	must(move(t, "a.driver-msk1", y.Id, "t2", "")).of(t)
	first := must(move(t, "a.project-approver", y.Id, "t3", "")).of(t)
	same(t, "after the first vote", []any{first.Status, val(first.Approval).Mode, val(first.Approval).WorkflowVersion},
		[]any{"s3", tasksapi.TaskApprovalStateModeAll, 2})
	same(t, "history", history(t, "a.owner", y.Id)[0], "Согласующий проекта: Согласовал(а). Ждём: Владелец Холдинга")
	_, err = move(t, "a.project-approver", y.Id, "t3", "")
	wantReason(t, err, reasonVoted, "Вы уже согласовали, ждём остальных")
	same(t, "after every vote", must(move(t, "a.owner", y.Id, "t3", "")).of(t).Status, "s4")
}

// «Вернуть на доработку» (Q-W4.00-tasks-8): only the right, «не автор» and the status; the comment is required.
func TestReject(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	svc := service()
	msk1 := unit("msk1")
	p := fresh(t, "ОТК", &msk1, tasksapi.Limited, tasksapi.Approval)
	assign(t, p.Id, "a.project-approver", roleApprover)
	assign(t, p.Id, "a.driver-msk1", roleExec)
	x := newTask(t, "a.driver-msk1", p.Id, "Счёт на шины")
	must(move(t, "a.driver-msk1", x.Id, "t1", "")).of(t)
	must(move(t, "a.driver-msk1", x.Id, "t2", "")).of(t)
	checklist(t, x.Id, `[{"id":"ch-1","text":"Счёт приложен","done":false}]`)
	c := card(t, "a.project-approver", x.Id)
	if c.Approval == nil || !c.Approval.CanReject || c.Approval.CanApprove {
		t.Fatalf("approval of the approver %+v", c.Approval)
	}
	_, err := svc.Reject(ctx, as(t, "a.project-approver"), x.Id, "t3", rev(c.Revision), tasksapi.TaskApprovalRejection{Comment: "  "})
	wantField(t, err, "comment", "Напишите, что доработать")
	_, err = svc.Reject(ctx, as(t, "a.driver-msk1"), x.Id, "t3", rev(c.Revision), tasksapi.TaskApprovalRejection{Comment: "Сам"})
	wantCode(t, err, codeForbidden, "")
	back := must(svc.Reject(ctx, as(t, "a.project-approver"), x.Id, "t3", rev(c.Revision), tasksapi.TaskApprovalRejection{Comment: "Нужен счёт с НДС"})).of(t)
	if back.Status != "s2" || back.Approval != nil {
		t.Fatalf("returned %+v", back)
	}
	if h := history(t, "a.owner", x.Id); h[0] != "Согласующий проекта: Вернул(а) на доработку (На проверке → В работе): Нужен счёт с НДС" {
		t.Fatalf("history %v", h)
	}
	_, err = svc.Reject(ctx, as(t, "a.project-approver"), x.Id, "t3", rev(back.Revision), tasksapi.TaskApprovalRejection{Comment: "Ещё раз"})
	wantReason(t, err, reasonNotIn, "Задача не ждёт этого согласования")
	_, err = svc.Reject(ctx, as(t, "a.project-approver"), x.Id, "t1", rev(back.Revision), tasksapi.TaskApprovalRejection{Comment: "Нет"})
	wantCode(t, err, codeNotFound, "Согласование не найдено")
}

// setTaskParent (checkParent): one parent, three levels, no cycles, a visible unfinished parent; the histories.
func TestHierarchy(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	svc := service()
	msk1 := unit("msk1")
	p := fresh(t, "ИЕР", &msk1, tasksapi.Open, tasksapi.Simple)
	owner := as(t, "a.owner")
	top := newTask(t, "a.owner", p.Id, "Подготовить парк к зиме")
	mid := newTask(t, "a.owner", p.Id, "Заменить шины", func(b *tasksapi.TaskCreate) { b.ParentTaskId = &top.Id })
	low := newTask(t, "a.owner", p.Id, "Купить шины")
	set := func(id, parent uuid.UUID) (tasksapi.Task, error) {
		c := card(t, "a.owner", id)
		var par *uuid.UUID
		if parent != uuid.Nil {
			par = &parent
		}
		return svc.SetParent(ctx, owner, id, rev(c.Revision), tasksapi.TaskParentSet{ParentTaskId: par})
	}
	low2 := must(set(low.Id, mid.Id)).of(t)
	same(t, "parent", []any{val(low2.ParentTaskId), val(low2.Parent).State}, []any{mid.Id, tasksapi.Visible})
	_, err := set(top.Id, low.Id)
	wantField(t, err, "parentTaskId", fmt.Sprintf("Получится цикл: %s уже входит в %s", str(low.Key), str(top.Key)))
	deep := newTask(t, "a.owner", p.Id, "Четвёртый уровень")
	_, err = set(deep.Id, low.Id)
	wantField(t, err, "parentTaskId", "Не больше трёх уровней: задача → подзадача → подзадача")
	_, err = set(top.Id, top.Id)
	wantField(t, err, "parentTaskId", "Задача не может входить в саму себя")
	_, err = set(deep.Id, uuid.New())
	wantField(t, err, "parentTaskId", "Задача не найдена")
	_, err = set(deep.Id, ref("task:a.build-1"))
	wantCode(t, err, codeNotFound, "Задача не найдена")
	same(t, "children", val(card(t, "a.owner", top.Id).Children), tasksapi.TaskChildrenSummary{Total: 1})
	// A subtask in the closed «Стройка» the owner does not see: counted as hidden, not named.
	if _, err := superA.Exec(ctx, `update tasks.tasks set parent_task_id = $2 where id = $1`, ref("task:a.build-1"), top.Id); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = superA.Exec(ctx, `update tasks.tasks set parent_task_id = null where id = $1`, ref("task:a.build-1"))
	})
	same(t, "children with a hidden one", val(card(t, "a.owner", top.Id).Children), tasksapi.TaskChildrenSummary{Total: 2, Hidden: 1})
	unlinked := must(set(mid.Id, uuid.Nil)).of(t)
	same(t, "unlinked", []bool{unlinked.Parent == nil, unlinked.ParentTaskId == nil}, []bool{true, true})
	same(t, "history of the parent", history(t, "a.owner", top.Id)[0], "Владелец Холдинга: из состава исключена "+str(mid.Key))
}

// uploaded writes a completed upload of a file for the task id as the person by (files.objects + upload_sessions).
func uploaded(t *testing.T, task uuid.UUID, by uuid.UUID, name, contentType string, size int64) uuid.UUID {
	t.Helper()
	ctx := t.Context()
	id := uuid.New()
	if _, err := superA.Exec(ctx, `insert into files.objects (id, object_key, state, purpose, owner_type, owner_id, declared_mime,
		bytes, uploaded_by) values ($1, $2, 'scanning', 'task_attachment', 'tasks.task', $3, $4, $5, $6)`,
		id, "files/"+id.String(), task, contentType+`; name="`+name+`"`, size, by); err != nil {
		t.Fatal(err)
	}
	if _, err := superA.Exec(ctx, `insert into files.upload_sessions (file_id, actor_id, state, reserved_bytes, ticket_expires_at,
		session_expires_at, completed_at) values ($1, $2, 'completed', 0, $3, $3, $3)`, id, by, harness.Now()); err != nil {
		t.Fatal(err)
	}
	return id
}

// attachTaskFiles and removeTaskFile: the own completed upload of this task, the limits of checkFiles, the uploader
// or the project manager removes.
func TestAttachments(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	svc := service()
	msk1 := unit("msk1")
	p := fresh(t, "ФАЙ", &msk1, tasksapi.Open, tasksapi.Simple)
	assign(t, p.Id, "a.driver-msk1", roleExec)
	x := newTask(t, "a.owner", p.Id, "Счёт поставщика", func(b *tasksapi.TaskCreate) { b.AssigneeMemberId = new(person("a.driver-msk1")) })
	other := newTask(t, "a.owner", p.Id, "Другая задача")
	attach := func(actor string, ids ...uuid.UUID) (tasksapi.Task, error) {
		c := card(t, actor, x.Id)
		return svc.AttachFiles(ctx, as(t, actor), x.Id, rev(c.Revision), tasksapi.TaskFilesAttach{FileIds: ids})
	}
	exec := person("a.driver-msk1")
	pdf := uploaded(t, x.Id, exec, "Счёт № 418.pdf", "application/pdf", 184320)
	got := must(attach("a.driver-msk1", pdf)).of(t)
	if got.Files == nil || len(*got.Files) != 1 || (*got.Files)[0].Name != "Счёт № 418.pdf" || (*got.Files)[0].UploadedByMemberId != exec {
		t.Fatalf("files %+v", got.Files)
	}
	_, err := attach("a.driver-msk1", pdf)
	wantField(t, err, "fileIds[0]", "Файл не найден или загружен к другой задаче")
	_, err = attach("a.driver-msk1", uploaded(t, x.Id, person("a.owner"), "Чужой.pdf", "application/pdf", 10))
	wantField(t, err, "fileIds[0]", "Файл не найден или загружен к другой задаче")
	_, err = attach("a.driver-msk1", uploaded(t, other.Id, exec, "Другой.pdf", "application/pdf", 10))
	wantField(t, err, "fileIds[0]", "Файл не найден или загружен к другой задаче")
	_, err = attach("a.driver-msk1", uploaded(t, x.Id, exec, "Большой.pdf", "application/pdf", fileMaxBytes+1))
	wantField(t, err, "fileIds[0]", "Файл «Большой.pdf» не принят: больше 20 МБ")
	_, err = attach("a.driver-msk1", uploaded(t, x.Id, exec, "setup.exe", "application/x-msdownload", 10))
	wantField(t, err, "fileIds[0]", "Файл «setup.exe» не принят: такой тип не принимаем")
	many := make([]uuid.UUID, 30)
	for i := range many {
		many[i] = uuid.New()
	}
	_, err = attach("a.driver-msk1", many...)
	wantField(t, err, "fileIds", "К задаче можно прикрепить не больше 30 файлов")
	ownerFile := uploaded(t, x.Id, person("a.owner"), "Акт.pdf", "application/pdf", 10)
	must(attach("a.owner", ownerFile)).of(t)
	remove := func(actor string, file uuid.UUID) (tasksapi.Task, error) {
		c := card(t, actor, x.Id)
		return svc.RemoveFile(ctx, as(t, actor), x.Id, file, rev(c.Revision))
	}
	_, err = remove("a.driver-msk1", ownerFile)
	wantCode(t, err, codeForbidden, "Удалить можно свой файл; чужие — руководитель проекта")
	must(remove("a.driver-msk1", pdf)).of(t)
	left := must(remove("a.owner", ownerFile)).of(t)
	if len(*left.Files) != 0 {
		t.Fatalf("files left %+v", left.Files)
	}
	_, err = remove("a.owner", ownerFile)
	wantCode(t, err, codeNotFound, "Файл уже удалён")
	// As removeTaskFile of MSW: If-Match is checked before the attachment and the right (Q-W4.11-7).
	_, err = svc.RemoveFile(ctx, as(t, "a.owner"), x.Id, ownerFile, rev(left.Revision-1))
	wantCode(t, err, codeRevMismatch, staleTask)
	_, err = svc.RemoveFile(ctx, as(t, "a.owner"), x.Id, ownerFile, "")
	wantCode(t, err, codeRevRequired, "")
	if h := history(t, "a.owner", x.Id); !slices.Contains(h, "Водитель Москва-1: прикрепил(а): Счёт № 418.pdf") ||
		!slices.Contains(h, "Владелец Холдинга: удалил(а) файл Акт.pdf") {
		t.Fatalf("history %v", h)
	}
}

// commentTask: whoever reads the task comments (append-only); listTaskHistory — newest first.
func TestComments(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	svc := service()
	msk1 := unit("msk1")
	p := fresh(t, "КОМ", &msk1, tasksapi.Limited, tasksapi.Simple)
	assign(t, p.Id, "a.project-approver", roleApprover)
	x := newTask(t, "a.owner", p.Id, "Обсудить")
	_, err := svc.Comment(ctx, as(t, "a.project-approver"), x.Id, tasksapi.TaskCommentCreate{Text: "   "})
	wantField(t, err, "text", "Комментарий пустой")
	c := must(svc.Comment(ctx, as(t, "a.project-approver"), x.Id, tasksapi.TaskCommentCreate{Text: " Счёт проверила "})).of(t)
	if c.Kind != tasksapi.TaskHistoryEntryKindComment || c.Text != "Счёт проверила" || c.ActorDisplayName != "Согласующий проекта" {
		t.Fatalf("comment %+v", c)
	}
	if got := card(t, "a.owner", x.Id); got.Revision != x.Revision {
		t.Fatalf("a comment changed the revision %d → %d", x.Revision, got.Revision)
	}
	_, err = svc.Comment(ctx, as(t, "a.manager-msk1"), x.Id, tasksapi.TaskCommentCreate{Text: "Чужой"})
	wantCode(t, err, codeNotFound, "Задача не найдена")
}
