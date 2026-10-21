package tasks

import (
	"fmt"
	"slices"
	"strconv"
	"strings"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
)

// Templates of a new project (ProjectCreate.workflowKey) and the keys of the workflows of the seed.
const (
	tmplSimple   = "simple"
	tmplApproval = "approval"
	tmplCopy     = "copy"
	tmplInitial  = "initial"
	tmplLeads    = "leads"
)

// workflow is the statuses and the transitions of a version or a draft.
type workflow struct {
	Statuses    []tasksapi.TaskWorkflowStatus
	Transitions []tasksapi.TaskWorkflowTransition
}

// status returns the status id of wf.
func (w *workflow) status(id string) (tasksapi.TaskWorkflowStatus, bool) {
	for _, s := range w.Statuses {
		if s.Id == id {
			return s, true
		}
	}
	return tasksapi.TaskWorkflowStatus{}, false
}

// transition returns the transition key of wf.
func (w *workflow) transition(key string) (tasksapi.TaskWorkflowTransition, bool) {
	for _, tr := range w.Transitions {
		if tr.Key == key {
			return tr, true
		}
	}
	return tasksapi.TaskWorkflowTransition{}, false
}

// firstTodo is the first status of the category «К выполнению» (the status of a new task), else the first one.
func (w *workflow) firstTodo() string {
	for _, s := range w.Statuses {
		if string(s.Category) == catTodo {
			return s.Id
		}
	}
	if len(w.Statuses) > 0 {
		return w.Statuses[0].Id
	}
	return "s1"
}

// usedStatus is a status a task of the project is in (publishTaskWorkflow).
type usedStatus struct{ ID, Name string }

// ruleRef is a rule of automation entering a status.
type ruleRef struct{ Name, StatusID string }

// tr is a transition without rules.
func tr(key, name string, from []string, to string) tasksapi.TaskWorkflowTransition {
	return tasksapi.TaskWorkflowTransition{Key: key, Name: name, From: from, To: to, Who: []tasksapi.TaskWorkflowTransitionWho{}}
}

var managerOnly = []tasksapi.TaskWorkflowTransitionWho{tasksapi.ProjectManager}

// template is buildWf of the prototype (models.js:185–193): «Простой» — «Принять» and «Вернуть на доработку» at the
// project manager; «С согласованием» — «Согласовать» by one approver, the author does not approve his own, refusal
// — back to «В работе»; both with «Отменить» from any status.
func template(kind string) workflow {
	t1 := tr("t1", "Взять в работу", []string{"s1"}, "s2")
	t2 := tr("t2", "На проверку", []string{"s2"}, "s3")
	t5 := tr("t5", "Отменить", []string{"*"}, "s5")
	t5.Who, t5.CommentRequired = slices.Clone(managerOnly), true
	var transitions []tasksapi.TaskWorkflowTransition
	if kind == tmplApproval {
		t3 := tr("t3", "Согласовать", []string{"s3"}, "s4")
		t3.NotAuthor, t3.ChecklistClosed, t3.ChildrenDone, t3.AssignAuthor = true, true, true, true
		t3.Approval = &tasksapi.TaskWorkflowApproval{Mode: tasksapi.TaskWorkflowApprovalModeAny, RejectTo: "s2"}
		transitions = []tasksapi.TaskWorkflowTransition{t1, t2, t3, t5}
	} else {
		t3 := tr("t3", "Принять", []string{"s3"}, "s4")
		t3.Who, t3.ChecklistClosed, t3.ChildrenDone = slices.Clone(managerOnly), true, true
		t4 := tr("t4", "Вернуть на доработку", []string{"s3"}, "s2")
		t4.Who, t4.CommentRequired = slices.Clone(managerOnly), true
		transitions = []tasksapi.TaskWorkflowTransition{t1, t2, t3, t4, t5}
	}
	return workflow{
		Statuses: []tasksapi.TaskWorkflowStatus{
			{Id: "s1", Name: stNew, Category: tasksapi.Todo},
			{Id: "s2", Name: stProgress, Category: tasksapi.Progress},
			{Id: "s3", Name: "На проверке", Category: tasksapi.Progress},
			{Id: "s4", Name: stDone, Category: tasksapi.Done},
			{Id: "s5", Name: stCancelled, Category: tasksapi.Done},
		},
		Transitions: transitions,
	}
}

// doneNames are the names that are finished without a workflow (DONE_NAMES of the domain).
var doneNames = []string{stDone, stCancelled, stObject, stRejected}

// initialWorkflow is v1 of a project without a workflow (TP-06, Q-W4.00-tasks-3): the statuses 1:1 — «Новая», «В
// работе», «На проверке», «Готово» and every other status its tasks are in — and one transition «all to all» per
// target status, without rules.
func initialWorkflow(used []string) workflow {
	names := []string{stNew, stProgress, "На проверке", stDone}
	for _, n := range used {
		if !slices.Contains(names, n) {
			names = append(names, n)
		}
	}
	var wf workflow
	for i, name := range names {
		cat := tasksapi.Progress
		switch {
		case name == stNew:
			cat = tasksapi.Todo
		case slices.Contains(doneNames, name):
			cat = tasksapi.Done
		}
		id := "s" + strconv.Itoa(i+1)
		wf.Statuses = append(wf.Statuses, tasksapi.TaskWorkflowStatus{Id: id, Name: name, Category: cat})
		wf.Transitions = append(wf.Transitions, tr("to-"+id, name, []string{"*"}, id))
	}
	return wf
}

// funnelWorkflow is the fixed funnel «Заявки» (WORKFLOWS.leads): its stages and a move into each stage named after it
// from the stages the old board moves from.
func funnelWorkflow() workflow {
	names := slices.Clone(funnelStages)
	for _, f := range funnelFlow {
		if !slices.Contains(names, f.from) {
			names = append(names, f.from)
		}
	}
	var wf workflow
	for _, name := range names {
		cat := tasksapi.Progress
		switch name {
		case stNew:
			cat = tasksapi.Todo
		case stObject, stRejected:
			cat = tasksapi.Done
		}
		wf.Statuses = append(wf.Statuses, tasksapi.TaskWorkflowStatus{Id: funnelIDs[name], Name: name, Category: cat})
	}
	for _, to := range wf.Statuses {
		var from []string
		for _, s := range wf.Statuses {
			for _, f := range funnelFlow {
				if f.from == s.Name && slices.Contains(f.to, to.Name) {
					from = append(from, s.Id)
				}
			}
		}
		if len(from) > 0 {
			wf.Transitions = append(wf.Transitions, tr("to-"+to.Id, to.Name, from, to.Id))
		}
	}
	return wf
}

// fromHere reports whether tr starts from statusID: «*» — from any status except its target.
func fromHere(t tasksapi.TaskWorkflowTransition, statusID string) bool {
	if slices.Contains(t.From, "*") {
		return statusID != t.To && !slices.Contains(t.From, t.To)
	}
	return slices.Contains(t.From, statusID)
}

// checkDraft is what the editor of «Процесс» checks before it saves the draft: a repeated status name, a transition
// without a name, a transition into its only source.
func checkDraft(d workflow) error {
	seen := map[string]bool{}
	for i, s := range d.Statuses {
		n := strings.ToLower(strings.TrimSpace(s.Name))
		if seen[n] {
			return invalid(fmt.Sprintf("statuses[%d].name", i), "taken", "Статус «"+strings.TrimSpace(s.Name)+"» уже есть")
		}
		seen[n] = true
	}
	for i, t := range d.Transitions {
		if strings.TrimSpace(t.Name) == "" {
			return invalid(fmt.Sprintf("transitions[%d].name", i), "required", "Назовите переход")
		}
		if len(t.From) == 1 && t.From[0] == t.To {
			return invalid(fmt.Sprintf("transitions[%d].to", i), "same", "Переход должен вести в другой статус")
		}
	}
	return nil
}

// checkPublish is publishWorkflow of the prototype (api.js:677–691) on the draft d: used — the statuses the tasks of
// the project are in, rules — the rules entering a status (Q-W4.00-tasks-13).
func checkPublish(d *workflow, used []usedStatus, rules []ruleRef) error {
	if d == nil {
		return invalid("draft", "empty", "Изменений нет")
	}
	if err := checkStatuses(d.Statuses); err != nil {
		return err
	}
	known := map[string]bool{}
	for _, s := range d.Statuses {
		known[s.Id] = true
	}
	if err := checkTransitions(d.Transitions, known); err != nil {
		return err
	}
	var gone []string
	for _, u := range used {
		if !known[u.ID] && !slices.Contains(gone, u.Name) {
			gone = append(gone, u.Name)
		}
	}
	if len(gone) > 0 {
		return invalid("statuses", "in_use",
			"Есть задачи в статусах, которых нет в новой версии: "+strings.Join(gone, ", ")+". Переведите их или верните статус")
	}
	for _, r := range rules {
		if !known[r.StatusID] {
			return invalid("automations", "status", "Правило «"+r.Name+"» ссылается на удалённый статус — измените или удалите правило")
		}
	}
	return nil
}

// checkStatuses requires named statuses without repeats and one of the category «Готово».
func checkStatuses(statuses []tasksapi.TaskWorkflowStatus) error {
	names := map[string]bool{}
	for _, s := range statuses {
		n := strings.ToLower(strings.TrimSpace(s.Name))
		if n == "" {
			return invalid("statuses", "name", "У статуса нет названия")
		}
		if names[n] {
			return invalid("statuses", "duplicate", "Названия статусов повторяются")
		}
		names[n] = true
	}
	if !slices.ContainsFunc(statuses, func(s tasksapi.TaskWorkflowStatus) bool { return s.Category == tasksapi.Done }) {
		return invalid("statuses", "done", "Нужен хотя бы один статус категории «Готово»")
	}
	return nil
}

// checkTransitions requires named transitions between the known statuses.
func checkTransitions(transitions []tasksapi.TaskWorkflowTransition, known map[string]bool) error {
	for _, t := range transitions {
		bad := strings.TrimSpace(t.Name) == "" || !known[t.To] ||
			slices.ContainsFunc(t.From, func(f string) bool { return f != "*" && !known[f] })
		if !bad {
			continue
		}
		name := t.Name
		if strings.TrimSpace(name) == "" {
			name = "без названия"
		}
		return invalid("transitions", "status", "Переход «"+name+"» ссылается на удалённый статус или без названия")
	}
	return nil
}
