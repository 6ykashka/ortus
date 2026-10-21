package tasks

import (
	"encoding/json"
	"testing"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
)

// The seed (cmd/seed) writes v1 as MSW seedTasks builds it: «Логистика · Север» — «С согласованием», «Салон ·
// Тверская» — the statuses of its tasks 1:1, the funnel «Заявки» — its stages without a stored version.
func TestSeedWorkflow(t *testing.T) {
	t.Parallel()
	approval, err := SeedWorkflowOf(SeedApproval, nil)
	if err != nil {
		t.Fatal(err)
	}
	var trs []tasksapi.TaskWorkflowTransition
	if err := json.Unmarshal(approval.Transitions, &trs); err != nil {
		t.Fatal(err)
	}
	same(t, "approval", []any{len(trs), trs[2].Name, trs[2].Approval != nil, approval.StatusID("На проверке")}, []any{4, "Согласовать", true, "s3"})
	initial, err := SeedWorkflowOf(SeedInitial, []string{"В работе", "Новая"})
	if err != nil {
		t.Fatal(err)
	}
	var sts []tasksapi.TaskWorkflowStatus
	if err := json.Unmarshal(initial.Statuses, &sts); err != nil {
		t.Fatal(err)
	}
	same(t, "initial", []any{len(sts), initial.StatusID("В работе"), initial.StatusID("Пауза")}, []any{4, "s2", "s1"})
	leads, err := SeedWorkflowOf(SeedLeads, nil)
	if err != nil {
		t.Fatal(err)
	}
	same(t, "funnel", []any{leads.Statuses == nil, leads.StatusID("Замер"), leads.StatusID("Объект"), leads.StatusID("Отказ")},
		[]any{true, "measure", "object", "rejected"})
	if _, err := SeedWorkflowOf("copy", nil); err == nil {
		t.Fatal("copy is not a workflow of the seed")
	}
}
