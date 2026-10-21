package tasks

import (
	"slices"
	"testing"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
)

func statusNames(st []tasksapi.TaskWorkflowStatus) []string {
	out := make([]string, 0, len(st))
	for _, s := range st {
		out = append(out, s.Id+":"+s.Name+":"+string(s.Category))
	}
	return out
}

func transitionOf(t *testing.T, wf workflow, key string) tasksapi.TaskWorkflowTransition {
	t.Helper()
	for _, tr := range wf.Transitions {
		if tr.Key == key {
			return tr
		}
	}
	t.Fatalf("no transition %s in %+v", key, wf.Transitions)
	return tasksapi.TaskWorkflowTransition{}
}

// buildWf of the prototype (models.js:185–193): «Простой» — «Принять» and «Вернуть на доработку» at the project
// manager; «С согласованием» — «Согласовать» by one approver, not the author, refusal back to «В работе».
func TestTemplates(t *testing.T) {
	t.Parallel()
	want := []string{"s1:Новая:todo", "s2:В работе:progress", "s3:На проверке:progress", "s4:Готово:done", "s5:Отменена:done"}
	simple := template(tmplSimple)
	same(t, "simple statuses", statusNames(simple.Statuses), want)
	keys := func(wf workflow) []string {
		var out []string
		for _, tr := range wf.Transitions {
			out = append(out, tr.Key+":"+tr.Name)
		}
		return out
	}
	same(t, "simple transitions", keys(simple), []string{"t1:Взять в работу", "t2:На проверку", "t3:Принять", "t4:Вернуть на доработку", "t5:Отменить"})
	manager := []tasksapi.TaskWorkflowTransitionWho{tasksapi.ProjectManager}
	same(t, "«Принять»", transitionOf(t, simple, "t3"), tasksapi.TaskWorkflowTransition{Key: "t3", Name: "Принять", From: []string{"s3"},
		To: "s4", Who: manager, ChecklistClosed: true, ChildrenDone: true})
	same(t, "«Вернуть на доработку»", transitionOf(t, simple, "t4"), tasksapi.TaskWorkflowTransition{Key: "t4", Name: "Вернуть на доработку",
		From: []string{"s3"}, To: "s2", Who: manager, CommentRequired: true})
	same(t, "«Отменить»", transitionOf(t, simple, "t5"), tasksapi.TaskWorkflowTransition{Key: "t5", Name: "Отменить", From: []string{"*"},
		To: "s5", Who: manager, CommentRequired: true})
	approval := template(tmplApproval)
	same(t, "approval transitions", keys(approval), []string{"t1:Взять в работу", "t2:На проверку", "t3:Согласовать", "t5:Отменить"})
	same(t, "«Согласовать»", transitionOf(t, approval, "t3"), tasksapi.TaskWorkflowTransition{Key: "t3", Name: "Согласовать", From: []string{"s3"},
		To: "s4", Who: []tasksapi.TaskWorkflowTransitionWho{}, NotAuthor: true, ChecklistClosed: true, ChildrenDone: true, AssignAuthor: true,
		Approval: &tasksapi.TaskWorkflowApproval{Mode: tasksapi.TaskWorkflowApprovalModeAny, RejectTo: "s2"}})
	for _, tr := range append(simple.Transitions, approval.Transitions...) {
		if tr.Who == nil || tr.From == nil {
			t.Errorf("%s: who and from are arrays, never null: %+v", tr.Key, tr)
		}
	}
}

// TP-06 (Q-W4.00-tasks-3): v1 takes the current statuses 1:1 — «Новая», «В работе», «На проверке», «Готово» and every
// other status of the tasks — with one transition «all to all» per target status and no rules.
func TestInitialWorkflow(t *testing.T) {
	t.Parallel()
	wf := initialWorkflow([]string{"В работе", "Новая"})
	same(t, "statuses", statusNames(wf.Statuses), []string{"s1:Новая:todo", "s2:В работе:progress", "s3:На проверке:progress", "s4:Готово:done"})
	same(t, "transitions", len(wf.Transitions), 4)
	same(t, "to-s3", transitionOf(t, wf, "to-s3"), tasksapi.TaskWorkflowTransition{Key: "to-s3", Name: "На проверке", From: []string{"*"},
		To: "s3", Who: []tasksapi.TaskWorkflowTransitionWho{}})
	extra := initialWorkflow([]string{"Отменена", "Пауза", "Объект"})
	same(t, "extra statuses", statusNames(extra.Statuses), []string{
		"s1:Новая:todo", "s2:В работе:progress", "s3:На проверке:progress", "s4:Готово:done", "s5:Отменена:done",
		"s6:Пауза:progress", "s7:Объект:done",
	})
}

// The funnel «Заявки» (WORKFLOWS.leads): fixed stages, a move — a transition named after the target stage.
func TestFunnelWorkflow(t *testing.T) {
	t.Parallel()
	wf := funnelWorkflow()
	want := []string{"new:Новая:todo", "measure:Замер:progress", "estimate:Смета:progress", "contract:Договор:progress", "object:Объект:done", "rejected:Отказ:done"}
	if got := statusNames(wf.Statuses); !slices.Equal(got, want) {
		t.Fatalf("stages %v", got)
	}
	measure := transitionOf(t, wf, "to-measure")
	if measure.Name != "Замер" || !slices.Equal(measure.From, []string{"new", "estimate"}) || measure.To != "measure" {
		t.Errorf("to-measure %+v", measure)
	}
	if again := transitionOf(t, wf, "to-new"); !slices.Equal(again.From, []string{"rejected"}) {
		t.Errorf("to-new %+v", again)
	}
	if len(wf.Transitions) != 6 {
		t.Errorf("transitions %d, want 6 (every stage has a move into it)", len(wf.Transitions))
	}
}

func TestFromHere(t *testing.T) {
	t.Parallel()
	anyTr := tasksapi.TaskWorkflowTransition{From: []string{"*"}, To: "s5"}
	if !fromHere(anyTr, "s1") || fromHere(anyTr, "s5") {
		t.Error("«Из любого» starts from every status but the target")
	}
	one := tasksapi.TaskWorkflowTransition{From: []string{"s3"}, To: "s4"}
	if !fromHere(one, "s3") || fromHere(one, "s2") {
		t.Error("a listed status only")
	}
}

func wantFailure(t *testing.T, err error, code, field, detail string) {
	t.Helper()
	f, ok := asFailure(err)
	if !ok {
		t.Fatalf("error %v, want %s «%s»", err, code, detail)
	}
	if f.code != code || f.detail != detail {
		t.Fatalf("%s «%s», want %s «%s»", f.code, f.detail, code, detail)
	}
	if field != "" && (len(f.violations) != 1 || f.violations[0].Field != field || f.violations[0].Message != detail) {
		t.Fatalf("violations %+v, want field %s", f.violations, field)
	}
}

// The structural checks of the editor (saveTaskWorkflowDraft): the texts of the prototype.
func TestCheckDraft(t *testing.T) {
	t.Parallel()
	base := template(tmplSimple)
	if err := checkDraft(base); err != nil {
		t.Fatalf("a template is a valid draft: %v", err)
	}
	dup := clone(base)
	dup.Statuses = append(dup.Statuses, tasksapi.TaskWorkflowStatus{Id: "s6", Name: " новая ", Category: tasksapi.Todo})
	wantFailure(t, checkDraft(dup), codeValidation, "statuses[5].name", "Статус «новая» уже есть")
	noName := clone(base)
	noName.Transitions[1].Name = "  "
	wantFailure(t, checkDraft(noName), codeValidation, "transitions[1].name", "Назовите переход")
	loop := clone(base)
	loop.Transitions[0].To = "s1"
	wantFailure(t, checkDraft(loop), codeValidation, "transitions[0].to", "Переход должен вести в другой статус")
}

// The checks of the publication (publishWorkflow of the prototype and Q-W4.00-tasks-13).
func TestCheckPublish(t *testing.T) {
	t.Parallel()
	base := template(tmplApproval)
	if err := checkPublish(&base, nil, nil); err != nil {
		t.Fatalf("a template publishes: %v", err)
	}
	wantFailure(t, checkPublish(nil, nil, nil), codeValidation, "draft", "Изменений нет")
	empty := clone(base)
	empty.Statuses[1].Name = " "
	wantFailure(t, checkPublish(&empty, nil, nil), codeValidation, "statuses", "У статуса нет названия")
	dup := clone(base)
	dup.Statuses[2].Name = "В РАБОТЕ"
	wantFailure(t, checkPublish(&dup, nil, nil), codeValidation, "statuses", "Названия статусов повторяются")
	noDone := clone(base)
	noDone.Statuses = noDone.Statuses[:3]
	noDone.Transitions = nil
	wantFailure(t, checkPublish(&noDone, nil, nil), codeValidation, "statuses", "Нужен хотя бы один статус категории «Готово»")
	gone := clone(base)
	gone.Statuses = slices.DeleteFunc(gone.Statuses, func(s tasksapi.TaskWorkflowStatus) bool { return s.Id == "s3" })
	wantFailure(t, checkPublish(&gone, nil, nil), codeValidation, "transitions",
		"Переход «На проверку» ссылается на удалённый статус или без названия")
	gone.Transitions = slices.DeleteFunc(gone.Transitions, func(tr tasksapi.TaskWorkflowTransition) bool {
		return tr.To == "s3" || slices.Contains(tr.From, "s3")
	})
	used := []usedStatus{{ID: "s3", Name: "На проверке"}, {ID: "s1", Name: "Новая"}, {ID: "s3", Name: "На проверке"}}
	wantFailure(t, checkPublish(&gone, used, nil), codeValidation, "statuses",
		"Есть задачи в статусах, которых нет в новой версии: На проверке. Переведите их или верните статус")
	rule := []ruleRef{{Name: "Задача готова → напомнить", StatusID: "s3"}}
	wantFailure(t, checkPublish(&gone, nil, rule), codeValidation, "automations",
		"Правило «Задача готова → напомнить» ссылается на удалённый статус — измените или удалите правило")
}

func clone(w workflow) workflow {
	out := workflow{Statuses: slices.Clone(w.Statuses)}
	for _, tr := range w.Transitions {
		tr.From = slices.Clone(tr.From)
		tr.Who = slices.Clone(tr.Who)
		out.Transitions = append(out.Transitions, tr)
	}
	return out
}
