package tasks

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
)

// The checks of the schemas of the contract the strict server does not apply (lengths, enums, patterns): a violation
// is 422 validation_failed with the messages of the scenario server (MSW core/validate.ts).

var (
	idRE   = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,31}$`)
	fromRE = regexp.MustCompile(`^(\*|[a-z][a-z0-9_-]{0,31})$`)
)

var (
	categories  = []tasksapi.TaskStatusCategory{tasksapi.Todo, tasksapi.Progress, tasksapi.Done}
	whos        = []tasksapi.TaskWorkflowTransitionWho{tasksapi.ProjectManager, tasksapi.ProjectApprover, tasksapi.ProjectExecutor, tasksapi.Assignee, tasksapi.Author}
	priorities  = []string{prioUrgent, prioHigh, prioNormal, prioLow}
	approvalMod = []tasksapi.TaskWorkflowApprovalMode{tasksapi.TaskWorkflowApprovalModeAny, tasksapi.TaskWorkflowApprovalModeAll}
)

func runes(s string) int { return utf8.RuneCountInString(s) }

// durationOf keeps rows inserted in one transaction in their order (created_at of a copy).
func durationOf(i int) time.Duration { return time.Duration(i) * time.Microsecond }

// validDraft checks TaskWorkflowDraftInput against its schema: 1…30 statuses with an id, a name of 1…40 characters
// and a category; up to 60 transitions with a key, a name of 1…60 characters, 1…30 sources, a target, at most five
// distinct «Кто может» and an approval with a mode and a status to return to.
func validDraft(d tasksapi.TaskWorkflowDraftInput) error {
	if len(d.Statuses) < 1 || len(d.Statuses) > 30 {
		return invalid("statuses", "length", textLength)
	}
	if len(d.Transitions) > 60 {
		return invalid("transitions", "length", textLength)
	}
	for i, s := range d.Statuses {
		at := fmt.Sprintf("statuses[%d]", i)
		switch {
		case !idRE.MatchString(s.Id):
			return invalid(at+".id", "format", "Неверный формат")
		case runes(s.Name) < 1 || runes(s.Name) > 40:
			return invalid(at+".name", "length", textLength)
		case !slices.Contains(categories, s.Category):
			return invalid(at+".category", "enum", textEnum)
		}
	}
	for i, t := range d.Transitions {
		if err := validTransition(fmt.Sprintf("transitions[%d]", i), t); err != nil {
			return err
		}
	}
	return nil
}

func validTransition(at string, t tasksapi.TaskWorkflowTransition) error {
	switch {
	case !idRE.MatchString(t.Key):
		return invalid(at+".key", "format", "Неверный формат")
	case runes(t.Name) > 60:
		return invalid(at+".name", "length", textLength)
	case len(t.From) < 1 || len(t.From) > 30:
		return invalid(at+".from", "length", textLength)
	case slices.ContainsFunc(t.From, func(f string) bool { return !fromRE.MatchString(f) }):
		return invalid(at+".from", "format", "Неверный формат")
	case !idRE.MatchString(t.To):
		return invalid(at+".to", "format", "Неверный формат")
	case len(t.Who) > 5:
		return invalid(at+".who", "length", textLength)
	case slices.ContainsFunc(t.Who, func(w tasksapi.TaskWorkflowTransitionWho) bool { return !slices.Contains(whos, w) }):
		return invalid(at+".who", "enum", textEnum)
	case len(uniqueSorted(whoStrings(t.Who))) != len(t.Who):
		return invalid(at+".who", "unique", "Значения повторяются")
	}
	if t.Approval != nil && (!slices.Contains(approvalMod, t.Approval.Mode) || !idRE.MatchString(t.Approval.RejectTo)) {
		return invalid(at+".approval", "enum", textEnum)
	}
	return nil
}

func whoStrings(ws []tasksapi.TaskWorkflowTransitionWho) []string {
	out := make([]string, 0, len(ws))
	for _, w := range ws {
		out = append(out, string(w))
	}
	return out
}

// validLabels checks the labels of a task: at most ten, each 1…40 characters without a comma.
func validLabels(labels []string) error {
	if len(labels) > labelsMax {
		return invalid("labels", "length", textLength)
	}
	for i, l := range labels {
		if runes(l) < 1 || runes(l) > 40 || strings.Contains(l, ",") {
			return invalid(fmt.Sprintf("labels[%d]", i), "format", "Неверный формат")
		}
	}
	return nil
}

// validPriority checks a priority of the contract.
func validPriority(field string, p *tasksapi.TaskPriority) error {
	if p != nil && !slices.Contains(priorities, string(*p)) {
		return invalid(field, "enum", textEnum)
	}
	return nil
}
