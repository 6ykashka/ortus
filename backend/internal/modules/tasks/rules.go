package tasks

import (
	"regexp"
	"slices"
	"strings"

	"github.com/google/uuid"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
)

// scene is a project with what its rules need: the unit path, the names of the units and the people of the tenant.
type scene struct {
	p      *project
	path   []uuid.UUID
	names  map[uuid.UUID]string
	people map[uuid.UUID]*member
}

// can is canIn of the person id in the project of the scene (an unknown person is blocked).
func (s *scene) can(id uuid.UUID, action string) (bool, string, *access) {
	return canIn(s.p, s.people[id], action, s.path, s.names)
}

// name is the display name of a person of the tenant.
func (s *scene) name(id uuid.UUID) string {
	if m := s.people[id]; m != nil {
		return m.Name
	}
	return unknownName
}

// verdict is the answer of a check of a transition: ok, or the Problem.code with the reason and the text.
type verdict struct {
	ok     bool
	code   string
	reason string
	text   string
}

var allowed = verdict{ok: true}

// err is the refusal of a verdict: 403 forbidden_action or 409 invalid_transition with its reason.
func (v verdict) err() error {
	if v.code == codeForbidden {
		return forbidden(v.text)
	}
	return conflict(v.reason, v.text)
}

// kid is a subtask of a task as the requesting member sees it.
type kid struct {
	Key     string
	Visible bool
	Done    bool
}

// fits reports whether the person id is «Кто может» who for the task: the assignee, the author, or a member whose
// role of the project (not the system role) has the action that stands for the role (WHO_VERB).
func (s *scene) fits(t *task, who string, id uuid.UUID) bool {
	switch who {
	case whoAssignee:
		return t.assignedTo(id)
	case whoAuthor:
		return t.authoredBy(id)
	}
	action, ok := whoAction[who]
	if !ok {
		action = actTransition
	}
	can, _, a := s.can(id, action)
	return can && a.Source != srcSystem
}

// whoText is «Доступно: {кто}».
func whoText(who []tasksapi.TaskWorkflowTransitionWho) string {
	labels := make([]string, 0, len(who))
	for _, w := range who {
		if l, ok := whoLabel[string(w)]; ok {
			labels = append(labels, l)
		} else {
			labels = append(labels, string(w))
		}
	}
	return "Доступно: " + strings.Join(labels, ", ")
}

func (s *scene) fitsAny(t *task, tr tasksapi.TaskWorkflowTransition, id uuid.UUID) bool {
	return slices.ContainsFunc(tr.Who, func(w tasksapi.TaskWorkflowTransitionWho) bool { return s.fits(t, string(w), id) })
}

// check is trCheck of the prototype (models.js:217–233) for the person id from the current status, split into «нет
// права» (403 forbidden_action) and «не выполнено условие» (409 invalid_transition with a reason, Q-W4.00-tasks-12): a
// transition by approval needs «Согласовывать» narrowed by «Кто может» (Q-W4.00-tasks-10), any other «Менять статус»
// and «Кто может»; then «не автор», the vote of the round, the checklist and the subtasks the member sees (kids).
func (s *scene) check(t *task, tr tasksapi.TaskWorkflowTransition, id uuid.UUID, r *round, kids []kid) verdict {
	if tr.Approval != nil {
		if v := s.right(t, tr, id, actApprove, "Согласует роль с правом «Согласовывать»; у вас "); !v.ok {
			return v
		}
		if tr.NotAuthor && t.authoredBy(id) {
			return verdict{code: codeTransition, reason: reasonAuthor, text: "Вы автор задачи — свою согласовать нельзя"}
		}
		if r != nil && r.TransitionKey == tr.Key && r.voted(id) {
			return verdict{code: codeTransition, reason: reasonVoted, text: "Вы уже согласовали, ждём остальных"}
		}
		return gates(t, tr, kids)
	}
	if v := s.right(t, tr, id, actTransition, "Менять статус нельзя: "); !v.ok {
		return v
	}
	if tr.NotAuthor && t.authoredBy(id) {
		return verdict{code: codeTransition, reason: reasonAuthor, text: "Автор задачи не может выполнить этот переход"}
	}
	return gates(t, tr, kids)
}

// right is the right of the person id to run tr: action in the project (403 with prefix and the reason of projCan),
// narrowed by «Кто может» (the system role is not narrowed).
func (s *scene) right(t *task, tr tasksapi.TaskWorkflowTransition, id uuid.UUID, action, prefix string) verdict {
	ok, why, a := s.can(id, action)
	if !ok {
		return verdict{code: codeForbidden, text: prefix + why}
	}
	if len(tr.Who) > 0 && a.Source != srcSystem && !s.fitsAny(t, tr, id) {
		return verdict{code: codeForbidden, text: whoText(tr.Who)}
	}
	return allowed
}

// gates are the checks of both kinds of transitions: the checklist and the open subtasks — only the visible ones are
// named (Q-W4.02-8).
func gates(t *task, tr tasksapi.TaskWorkflowTransition, kids []kid) verdict {
	if tr.ChecklistClosed && slices.ContainsFunc(t.Checklist, func(c tasksapi.TaskChecklistItem) bool { return !c.Done }) {
		return verdict{code: codeTransition, reason: reasonChecklist, text: "Сначала закройте чек-лист"}
	}
	if !tr.ChildrenDone {
		return allowed
	}
	var open, seen []string
	for _, k := range kids {
		if k.Done {
			continue
		}
		open = append(open, k.Key)
		if k.Visible {
			seen = append(seen, k.Key)
		}
	}
	switch {
	case len(open) == 0:
		return allowed
	case len(seen) > 0:
		return verdict{code: codeTransition, reason: reasonChildren, text: "Сначала завершите подзадачи: " + strings.Join(seen, ", ")}
	}
	return verdict{code: codeTransition, reason: reasonChildren, text: "Сначала завершите подзадачи"}
}

// rejectCheck is «Вернуть на доработку» (Q-W4.00-tasks-8, PD-60): only the right, «не автор» and the status count — an
// open checklist, open subtasks and a vote of the member do not block it.
func (s *scene) rejectCheck(t *task, tr tasksapi.TaskWorkflowTransition, id uuid.UUID, r *round, kids []kid) verdict {
	v := s.check(t, tr, id, r, kids)
	switch {
	case v.ok, v.reason == reasonVoted, v.reason == reasonChecklist, v.reason == reasonChildren:
		return allowed
	}
	return v
}

// approvers is approversOf of the prototype: the active members with «Согласовывать» in the project, without the
// author at «не автор», narrowed by «Кто может» (Q-W4.00-tasks-10; the owner of the organization approves), by name.
func (s *scene) approvers(t *task, tr tasksapi.TaskWorkflowTransition) []uuid.UUID {
	var out []uuid.UUID
	for id, m := range s.people {
		if !m.Active {
			continue
		}
		ok, _, a := s.can(id, actApprove)
		if !ok || (tr.NotAuthor && t.authoredBy(id)) {
			continue
		}
		if len(tr.Who) > 0 && a.Source != srcSystem && !s.fitsAny(t, tr, id) {
			continue
		}
		out = append(out, id)
	}
	slices.SortFunc(out, func(a, b uuid.UUID) int { return compareNames(s, a, b) })
	return out
}

// compareNames orders people by their names, then ids.
func compareNames(s *scene, a, b uuid.UUID) int {
	if c := strings.Compare(s.name(a), s.name(b)); c != 0 {
		return c
	}
	return strings.Compare(a.String(), b.String())
}

// link is a parent being set: the task (nil — a new one), the parent, the ancestors of the parent and the levels of
// the subtree of the task (1 — a task without subtasks).
type link struct {
	Task       *uuid.UUID
	TaskKey    string
	Parent     uuid.UUID
	ParentKey  string
	ParentDone bool
	Chain      []uuid.UUID
	Below      int
}

const fieldParent = "parentTaskId"

// checkHierarchy is checkParent of the prototype (api.js:128–139) for a visible parent: not the task itself, no cycle,
// at most three levels, the parent not finished.
func checkHierarchy(l link) error {
	if l.Task != nil && *l.Task == l.Parent {
		return invalid(fieldParent, "self", "Задача не может входить в саму себя")
	}
	if l.Task != nil && slices.Contains(l.Chain, *l.Task) {
		return invalid(fieldParent, "cycle", "Получится цикл: "+l.ParentKey+" уже входит в "+l.TaskKey)
	}
	below := max(l.Below, 1)
	if 1+len(l.Chain)+below > maxLevels {
		return invalid(fieldParent, "levels", "Не больше трёх уровней: задача → подзадача → подзадача")
	}
	if l.ParentDone {
		return invalid(fieldParent, "done", "Задача "+l.ParentKey+" уже завершена — сначала верните её в работу")
	}
	return nil
}

// fileOK is FILE_OK of the prototype: photos, PDF, text, Office documents and ZIP.
var fileOK = regexp.MustCompile(`^(image/|application/pdf|text/|application/(msword|vnd\.openxmlformats|vnd\.ms-excel|vnd\.oasis|zip))`)

// fileRefusal is why a file is not attached (checkFiles of the prototype), "" — it is.
func fileRefusal(size int64, contentType string) string {
	switch {
	case size > fileMaxBytes:
		return "больше 20 МБ"
	case size <= 0:
		return "пустой файл"
	case !fileOK.MatchString(contentType):
		return "такой тип не принимаем"
	}
	return ""
}

// normLabels trims and lowercases the labels, drops empty ones and repeats and keeps at most ten (normLabels).
func normLabels(in []string) []string {
	out := []string{}
	for _, l := range in {
		n := strings.ToLower(strings.TrimSpace(l))
		if n != "" && !slices.Contains(out, n) {
			out = append(out, n)
		}
	}
	if len(out) > labelsMax {
		out = out[:labelsMax]
	}
	return out
}
