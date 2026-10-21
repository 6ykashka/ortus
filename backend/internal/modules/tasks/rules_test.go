package tasks

import (
	"slices"
	"testing"

	"github.com/google/uuid"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
)

// sceneLOG is the project «Логистика · Север» of the demo (api.js:23–36) with «С согласованием»: Котова — the project
// manager, Котельникова — the approver, Васильев — the executor through «Водители Север», Зимина — the owner.
type people struct {
	kotova, kotelnikova, vasiliev, zimina, petrova *member
}

func sceneLOG(t *testing.T, level string) (*scene, people) {
	t.Helper()
	sever := uSever
	p := projectAt(level, &sever)
	approverActions := []string{actProjectsRead, actRead, actApprove, actFilesRead}
	group := onProject(p, "Исполнитель", execActions)
	group.Group, group.GroupName = gDrivers, "Водители Север"
	ppl := people{
		kotova:      &member{ID: uuid.New(), Name: "Марина Котова", Active: true, Grants: []grant{onProject(p, "Руководитель проекта", pmActions)}},
		kotelnikova: &member{ID: uuid.New(), Name: "Вера Котельникова", Active: true, Grants: []grant{onProject(p, "Согласующий", approverActions)}},
		vasiliev:    &member{ID: uuid.New(), Name: "Илья Васильев", Active: true, Driver: true, Grants: []grant{group}},
		zimina:      &member{ID: uuid.New(), Name: "Дарья Зимина", Active: true, Owner: true},
		petrova:     &member{ID: uuid.New(), Name: "Олеся Петрова", Active: false, Grants: []grant{onProject(p, "Согласующий", approverActions)}},
	}
	s := &scene{p: p, path: pathSever, names: unitNames, people: map[uuid.UUID]*member{}}
	for _, m := range []*member{ppl.kotova, ppl.kotelnikova, ppl.vasiliev, ppl.zimina, ppl.petrova} {
		s.people[m.ID] = m
	}
	return s, ppl
}

func t65(author, assignee uuid.UUID) *task {
	return &task{ID: uuid.New(), StatusID: "s3", Priority: prioHigh, Author: &author, Assignee: &assignee,
		Checklist: []tasksapi.TaskChecklistItem{{Id: "ch-1", Text: "Счёт приложен", Done: true}, {Id: "ch-2", Text: "Сезонность подтверждена", Done: true}}}
}

func wantVerdict(t *testing.T, name string, v verdict, ok bool, code, reason, text string) {
	t.Helper()
	if v.ok != ok || v.code != code || v.reason != reason || v.text != text {
		t.Errorf("%s: %+v, want ok=%v %s %s «%s»", name, v, ok, code, reason, text)
	}
}

// trCheck of the prototype (models.js:217–233) split into «нет права» (403) and «не выполнено условие» (409 with a
// reason, Q-W4.00-tasks-12).
func TestCheckApproval(t *testing.T) {
	t.Parallel()
	s, ppl := sceneLOG(t, levelLimited)
	agree := transitionOf(t, template(tmplApproval), "t3")
	tk := t65(ppl.vasiliev.ID, ppl.vasiliev.ID)
	wantVerdict(t, "согласующий", s.check(tk, agree, ppl.kotelnikova.ID, nil, nil), true, "", "", "")
	wantVerdict(t, "владелец согласует", s.check(tk, agree, ppl.zimina.ID, nil, nil), true, "", "", "")
	wantVerdict(t, "автор", s.check(tk, agree, ppl.vasiliev.ID, nil, nil), false, codeForbidden, "",
		"Согласует роль с правом «Согласовывать»; у вас роль «Исполнитель» не даёт «Согласовывать»")
	tk.Author = &ppl.kotova.ID
	wantVerdict(t, "автор с правом", s.check(tk, agree, ppl.kotova.ID, nil, nil), false, codeTransition, reasonAuthor,
		"Вы автор задачи — свою согласовать нельзя")
	r := &round{TransitionKey: "t3", Mode: "all", Votes: []vote{{Member: ppl.kotelnikova.ID}}}
	wantVerdict(t, "уже согласовал", s.check(tk, agree, ppl.kotelnikova.ID, r, nil), false, codeTransition, reasonVoted,
		"Вы уже согласовали, ждём остальных")
	tk.Checklist[1].Done = false
	wantVerdict(t, "чек-лист", s.check(tk, agree, ppl.zimina.ID, nil, nil), false, codeTransition, reasonChecklist, "Сначала закройте чек-лист")
	tk.Checklist[1].Done = true
	kids := []kid{{Key: "T-58", Visible: true}, {Key: "T-70", Visible: false}, {Key: "T-71", Visible: true, Done: true}}
	wantVerdict(t, "подзадачи", s.check(tk, agree, ppl.zimina.ID, nil, kids), false, codeTransition, reasonChildren,
		"Сначала завершите подзадачи: T-58")
	hidden := []kid{{Key: "T-70", Visible: false}}
	wantVerdict(t, "скрытые подзадачи (Q-W4.02-8)", s.check(tk, agree, ppl.zimina.ID, nil, hidden), false, codeTransition, reasonChildren,
		"Сначала завершите подзадачи")
	narrowed := agree
	narrowed.Who = []tasksapi.TaskWorkflowTransitionWho{tasksapi.ProjectManager}
	wantVerdict(t, "«Кто может» сужает согласующих", s.check(tk, narrowed, ppl.kotelnikova.ID, nil, nil), false, codeForbidden, "",
		"Доступно: руководитель проекта")
	wantVerdict(t, "владелец вне «Кто может»", s.check(tk, narrowed, ppl.zimina.ID, nil, nil), true, "", "", "")
}

func TestCheckTransition(t *testing.T) {
	t.Parallel()
	s, ppl := sceneLOG(t, levelLimited)
	wf := template(tmplSimple)
	tk := t65(ppl.vasiliev.ID, ppl.vasiliev.ID)
	take, accept := transitionOf(t, wf, "t1"), transitionOf(t, wf, "t3")
	wantVerdict(t, "исполнитель", s.check(tk, take, ppl.vasiliev.ID, nil, nil), true, "", "", "")
	wantVerdict(t, "согласующий без «Менять статус»", s.check(tk, take, ppl.kotelnikova.ID, nil, nil), false, codeForbidden, "",
		"Менять статус нельзя: роль «Согласующий» не даёт «Менять статус»")
	wantVerdict(t, "«Принять» — руководитель", s.check(tk, accept, ppl.vasiliev.ID, nil, nil), false, codeForbidden, "",
		"Доступно: руководитель проекта")
	wantVerdict(t, "руководитель", s.check(tk, accept, ppl.kotova.ID, nil, nil), true, "", "", "")
	byAuthor := take
	byAuthor.NotAuthor = true
	wantVerdict(t, "не автор", s.check(tk, byAuthor, ppl.vasiliev.ID, nil, nil), false, codeTransition, reasonAuthor,
		"Автор задачи не может выполнить этот переход")
	assignee := take
	assignee.Who = []tasksapi.TaskWorkflowTransitionWho{tasksapi.Assignee, tasksapi.Author}
	wantVerdict(t, "исполнитель задачи", s.check(tk, assignee, ppl.vasiliev.ID, nil, nil), true, "", "", "")
	wantVerdict(t, "не исполнитель", s.check(tk, assignee, ppl.kotova.ID, nil, nil), false, codeForbidden, "",
		"Доступно: исполнитель задачи, автор задачи")
	wantVerdict(t, "заблокирован", s.check(tk, take, ppl.petrova.ID, nil, nil), false, codeForbidden, "",
		"Менять статус нельзя: сотрудник заблокирован")
}

// approversOf: active members with «Согласовывать» in the project, without the author at «не автор», narrowed by «Кто
// может» (Q-W4.00-tasks-10); the owner of the organization approves (the system role).
func TestApprovers(t *testing.T) {
	t.Parallel()
	s, ppl := sceneLOG(t, levelLimited)
	agree := transitionOf(t, template(tmplApproval), "t3")
	tk := t65(ppl.kotova.ID, ppl.vasiliev.ID)
	got := s.approvers(tk, agree)
	want := []uuid.UUID{ppl.kotelnikova.ID, ppl.zimina.ID}
	slices.SortFunc(want, func(a, b uuid.UUID) int { return compareNames(s, a, b) })
	if !slices.Equal(got, want) {
		t.Fatalf("approvers %v, want %v (Котова — the author, Петрова — blocked)", got, want)
	}
	narrowed := agree
	narrowed.Who = []tasksapi.TaskWorkflowTransitionWho{tasksapi.ProjectApprover}
	// «согласующий» is the action «Согласовывать» of a role of the project (WHO_VERB): the project manager has it too.
	if got := s.approvers(t65(ppl.vasiliev.ID, ppl.vasiliev.ID), narrowed); len(got) != 3 || !slices.Contains(got, ppl.kotelnikova.ID) ||
		!slices.Contains(got, ppl.zimina.ID) || !slices.Contains(got, ppl.kotova.ID) {
		t.Fatalf("narrowed to the approver role: %v", got)
	}
	executors := agree
	executors.Who = []tasksapi.TaskWorkflowTransitionWho{tasksapi.ProjectExecutor}
	if got := s.approvers(t65(ppl.petrova.ID, ppl.vasiliev.ID), executors); !slices.Equal(got, []uuid.UUID{ppl.zimina.ID, ppl.kotova.ID}) {
		t.Fatalf("narrowed to the executors: %v (Котельникова has no «Менять статус», the owner approves)", got)
	}
}

// «Вернуть на доработку» (Q-W4.00-tasks-8, PD-60): an open checklist, open subtasks and a vote do not block it.
func TestRejectCheck(t *testing.T) {
	t.Parallel()
	s, ppl := sceneLOG(t, levelLimited)
	agree := transitionOf(t, template(tmplApproval), "t3")
	tk := t65(ppl.vasiliev.ID, ppl.vasiliev.ID)
	tk.Checklist[0].Done = false
	r := &round{TransitionKey: "t3", Votes: []vote{{Member: ppl.kotelnikova.ID}}}
	wantVerdict(t, "чек-лист и голос", s.rejectCheck(tk, agree, ppl.kotelnikova.ID, r, []kid{{Key: "T-58", Visible: true}}), true, "", "", "")
	wantVerdict(t, "исполнитель", s.rejectCheck(tk, agree, ppl.vasiliev.ID, nil, nil), false, codeForbidden, "",
		"Согласует роль с правом «Согласовывать»; у вас роль «Исполнитель» не даёт «Согласовывать»")
	tk.Author = &ppl.kotelnikova.ID
	wantVerdict(t, "автор", s.rejectCheck(tk, agree, ppl.kotelnikova.ID, nil, nil), false, codeTransition, reasonAuthor,
		"Вы автор задачи — свою согласовать нельзя")
}

// checkParent of the prototype (api.js:128–139): itself, a cycle, three levels, a finished parent.
func TestCheckHierarchy(t *testing.T) {
	t.Parallel()
	child, par := uuid.New(), uuid.New()
	wantFailure(t, checkHierarchy(link{Task: &child, TaskKey: "T-65", Parent: child, ParentKey: "T-65", Below: 1}),
		codeValidation, "parentTaskId", "Задача не может входить в саму себя")
	wantFailure(t, checkHierarchy(link{Task: &child, TaskKey: "T-66", Parent: par, ParentKey: "T-65", Chain: []uuid.UUID{child}, Below: 2}),
		codeValidation, "parentTaskId", "Получится цикл: T-65 уже входит в T-66")
	wantFailure(t, checkHierarchy(link{Task: &child, TaskKey: "T-1", Parent: par, ParentKey: "T-65", Chain: []uuid.UUID{uuid.New()}, Below: 2}),
		codeValidation, "parentTaskId", "Не больше трёх уровней: задача → подзадача → подзадача")
	wantFailure(t, checkHierarchy(link{Parent: par, ParentKey: "T-65", Chain: []uuid.UUID{uuid.New(), uuid.New()}, Below: 1}),
		codeValidation, "parentTaskId", "Не больше трёх уровней: задача → подзадача → подзадача")
	wantFailure(t, checkHierarchy(link{Parent: par, ParentKey: "T-61", ParentDone: true, Below: 1}),
		codeValidation, "parentTaskId", "Задача T-61 уже завершена — сначала верните её в работу")
	if err := checkHierarchy(link{Task: &child, TaskKey: "T-65", Parent: par, ParentKey: "T-66", Chain: []uuid.UUID{uuid.New()}, Below: 1}); err != nil {
		t.Fatalf("three levels: %v", err)
	}
}

// checkFiles of the prototype (api.js:120–127): 20 MB, an empty file, the types FILE_OK, 30 per task.
func TestCheckFile(t *testing.T) {
	t.Parallel()
	for _, ct := range []string{"image/jpeg", "application/pdf", "text/plain", "application/msword",
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel",
		"application/vnd.oasis.opendocument.text", "application/zip"} {
		if why := fileRefusal(1024, ct); why != "" {
			t.Errorf("%s: %s", ct, why)
		}
	}
	for _, tc := range []struct {
		size int64
		ct   string
		why  string
	}{
		{fileMaxBytes + 1, "application/pdf", "больше 20 МБ"},
		{0, "application/pdf", "пустой файл"},
		{10, "application/x-msdownload", "такой тип не принимаем"},
	} {
		if why := fileRefusal(tc.size, tc.ct); why != tc.why {
			t.Errorf("%d %s: «%s», want «%s»", tc.size, tc.ct, why, tc.why)
		}
	}
}

// normLabels of the prototype: trimmed, lowercased, without repeats, at most 10 (Q-W4.03-6).
func TestNormLabels(t *testing.T) {
	t.Parallel()
	got := normLabels([]string{" Шины ", "закупка", "шины", "", "A", "b", "c", "d", "e", "f", "g", "h", "i"})
	if !slices.Equal(got, []string{"шины", "закупка", "a", "b", "c", "d", "e", "f", "g", "h"}) {
		t.Fatalf("labels %v", got)
	}
}
