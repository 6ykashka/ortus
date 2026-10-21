//go:build integration

package tasks

import (
	"slices"
	"testing"

	"github.com/google/uuid"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
)

func commentRule(name, text string) tasksapi.TaskAutomationCreate {
	return tasksapi.TaskAutomationCreate{Name: name, Trigger: tasksapi.TaskAutomationTrigger{Kind: tasksapi.TaskAutomationTriggerKindCreated},
		Action: tasksapi.TaskAutomationAction{Kind: tasksapi.TaskAutomationActionKindComment, Text: &text}}
}

// «Автоматизация»: the form «Новое правило» (texts of the prototype), a rule runs on behalf of its author, the
// journal, a change raises the version, If-Match.
func TestAutomations(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	svc := service()
	owner := as(t, "a.owner")
	msk1 := unit("msk1")
	p := fresh(t, "АВТМ", &msk1, tasksapi.Open, tasksapi.Simple)
	_, err := svc.CreateAutomation(ctx, owner, p.Id, commentRule("  ", "Текст"))
	wantField(t, err, "name", "Назовите правило")
	_, err = svc.CreateAutomation(ctx, owner, p.Id, commentRule("Комментарий", " "))
	wantField(t, err, "action", "Заполните действие")
	st := tasksapi.TaskAutomationCreate{Name: "В работе → срочно", Trigger: tasksapi.TaskAutomationTrigger{Kind: tasksapi.TaskAutomationTriggerKindStatusEntered,
		StatusId: new("s9")}, Action: tasksapi.TaskAutomationAction{Kind: tasksapi.TaskAutomationActionKindSetPriority, Priority: new(tasksapi.Urgent)}}
	_, err = svc.CreateAutomation(ctx, owner, p.Id, st)
	wantField(t, err, "trigger.statusId", "Выберите статус для триггера")
	assign(t, p.Id, "a.project-approver", roleApprover)
	_, err = svc.CreateAutomation(ctx, as(t, "a.project-approver"), p.Id, commentRule("Чужое", "Текст"))
	wantCode(t, err, codeForbidden, "")

	c := must(svc.CreateAutomation(ctx, owner, p.Id, commentRule("Новая задача → комментарий", "Проверьте исполнителя"))).of(t)
	same(t, "rule", []any{c.Version, c.Enabled, c.AuthorDisplayName, c.RunCount}, []any{1, true, "Владелец Холдинга", 0})
	st.Trigger.StatusId = new("s2")
	urgent := must(svc.CreateAutomation(ctx, owner, p.Id, st)).of(t)
	x := newTask(t, "a.owner", p.Id, "Проверить рули")
	h := history(t, "a.owner", x.Id)
	same(t, "history", []bool{slices.Contains(h, "Автоматизация: Проверьте исполнителя"),
		slices.Contains(h, "Автоматизация: Правило «Новая задача → комментарий» v1")}, []bool{true, true})
	moved := must(move(t, "a.owner", x.Id, "t1", "")).of(t)
	same(t, "priority after the rule", val(moved.Priority), tasksapi.Urgent)
	runs := must(svc.Runs(ctx, owner, p.Id)).of(t)
	journal := make([]string, 0, len(runs.Items))
	for _, x := range runs.Items {
		journal = append(journal, x.AutomationName+" | "+x.Text+" | "+str(x.TaskKey))
	}
	same(t, "runs", journal, []string{"В работе → срочно | АВТМ-101: приоритет «Срочно» | АВТМ-101",
		"Новая задача → комментарий | АВТМ-101: добавлен комментарий | АВТМ-101"})

	_, err = svc.UpdateAutomation(ctx, owner, p.Id, c.Id, rev(c.Revision+1), tasksapi.TaskAutomationPatch{Enabled: new(false)})
	wantCode(t, err, codeRevMismatch, "Правило уже изменили. Обновите и повторите.")
	off := must(svc.UpdateAutomation(ctx, owner, p.Id, c.Id, rev(c.Revision), tasksapi.TaskAutomationPatch{Enabled: new(false)})).of(t)
	same(t, "disabled", []any{off.Enabled, off.Version}, []any{false, 1})
	renamed := must(svc.UpdateAutomation(ctx, owner, p.Id, c.Id, rev(off.Revision), tasksapi.TaskAutomationPatch{Name: new("Новая → комментарий")})).of(t)
	same(t, "renamed", []any{renamed.Version, renamed.Name}, []any{2, "Новая → комментарий"})
	if err := svc.DeleteAutomation(ctx, owner, p.Id, urgent.Id, rev(urgent.Revision)); err != nil {
		t.Fatal(err)
	}
	_, err = svc.UpdateAutomation(ctx, owner, p.Id, urgent.Id, rev(urgent.Revision), tasksapi.TaskAutomationPatch{Enabled: new(true)})
	wantCode(t, err, codeNotFound, "Правило не найдено")
	same(t, "the journal keeps the runs of a deleted rule", len(must(svc.Runs(ctx, owner, p.Id)).of(t).Items), 2)
}

// A rule whose author lost «Менять статус» in the project is not run: the journal says why and the owners are told.
func TestAutomationAuthorWithoutRight(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	svc := service()
	msk1 := unit("msk1")
	p := fresh(t, "ПРАВ", &msk1, tasksapi.Limited, tasksapi.Simple)
	assign(t, p.Id, "a.manager-msk2", roleManager)
	rule := must(svc.CreateAutomation(ctx, as(t, "a.manager-msk2"), p.Id, commentRule("Комментарий менеджера", "Проверьте"))).of(t)
	if _, err := superA.Exec(ctx, `update access.role_assignments set state = 'revoked', revoked_at = now()
		where principal_id = $1 and scope_ref = $2`, person("a.manager-msk2"), p.Id); err != nil {
		t.Fatal(err)
	}
	x := newTask(t, "a.owner", p.Id, "Без правила")
	runs := must(svc.Runs(ctx, as(t, "a.owner"), p.Id)).of(t)
	if len(runs.Items) != 1 || runs.Items[0].AutomationId != rule.Id ||
		runs.Items[0].Result != tasksapi.Error || !contains(runs.Items[0].Text, "У автора правила Менеджер Москва-2 нет права менять задачи") {
		t.Fatalf("runs %+v", runs.Items)
	}
	if h := history(t, "a.owner", x.Id); slices.Contains(h, "Автоматизация: Проверьте") {
		t.Fatalf("the rule ran: %v", h)
	}
}

// The funnel «Заявки» has no automation and no workflow of its own (TP-02): 409 with the text of the prototype.
func TestFunnelHasNoRules(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	id := uuid.New()
	if _, err := superA.Exec(ctx, `insert into tasks.projects (id, key, name, flow, workflow_key, owner_id)
		values ($1, 'ЗАЯ', 'Заявки · Ремонт', 'leads', 'leads', $2)`, id, person("a.owner")); err != nil {
		t.Fatal(err)
	}
	_, err := service().CreateAutomation(ctx, as(t, "a.owner"), id, commentRule("Правило воронки", "Текст"))
	wantReason(t, err, reasonFunnel, "У воронки «Заявки» нет автоматизации")
}
