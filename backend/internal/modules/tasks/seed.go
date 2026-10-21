package tasks

import (
	"encoding/json"
	"fmt"
)

// Workflow keys of a project of the seed (tasks.projects.workflow_key).
const (
	SeedSimple   = tmplSimple
	SeedApproval = tmplApproval
	SeedInitial  = "initial"
	SeedLeads    = flowLeads
)

// SeedWorkflow is v1 of a project of the seed of the prototype (cmd/seed, MSW tasks/state.ts seedTasks) as the module
// reads it: the template of buildWf, the statuses of the tasks 1:1 (TP-06) or the stages of the funnel (no version is
// stored for it — Statuses and Transitions are nil).
type SeedWorkflow struct {
	Statuses, Transitions []byte // JSON of tasks.workflow_versions
	ids                   map[string]string
}

// SeedWorkflowOf builds the workflow of key for a project whose tasks are in the statuses used (names).
func SeedWorkflowOf(key string, used []string) (SeedWorkflow, error) {
	var wf workflow
	switch key {
	case SeedSimple, SeedApproval:
		wf = template(key)
	case SeedInitial:
		wf = initialWorkflow(used)
	case SeedLeads:
		f := funnelWorkflow()
		return SeedWorkflow{ids: idsOf(f)}, nil
	default:
		return SeedWorkflow{}, fmt.Errorf("tasks: seed workflow %q", key)
	}
	statuses, err := json.Marshal(wf.Statuses)
	if err != nil {
		return SeedWorkflow{}, err
	}
	transitions, err := json.Marshal(wf.Transitions)
	if err != nil {
		return SeedWorkflow{}, err
	}
	return SeedWorkflow{Statuses: statuses, Transitions: transitions, ids: idsOf(wf)}, nil
}

func idsOf(wf workflow) map[string]string {
	ids := map[string]string{}
	for _, s := range wf.Statuses {
		ids[s.Name] = s.Id
	}
	return ids
}

// StatusID is the id of the status name in the workflow, else of its first status (seedTasks of MSW).
func (w SeedWorkflow) StatusID(name string) string {
	if id, ok := w.ids[name]; ok {
		return id
	}
	if id, ok := w.ids[stNew]; ok {
		return id
	}
	return "s1"
}
