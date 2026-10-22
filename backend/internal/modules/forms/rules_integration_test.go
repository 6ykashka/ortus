//go:build integration

package forms

import (
	"context"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
)

// The editor of the actions (dc:645–678): the object of the kind, the condition, the texts of the refusals; the
// address of a letter and the URL of a request only with «Настраивать» (Q-W4.05-18); «Включено» keeps the version,
// «Изменить» raises it.
func TestRulesEditor(t *testing.T) {
	t.Parallel()
	ctx, owner, s := t.Context(), as(t, "a.owner"), service()
	f := published(t, "a.owner", "Правила RE", inspection())
	project := uuid.New()
	tasks.mu.Lock()
	if tasks.may == nil {
		tasks.may = map[uuid.UUID]bool{}
	}
	tasks.may[project] = true
	tasks.mu.Unlock()
	node, table, col := uuid.New(), uuid.New(), uuid.New()
	kb.mu.Lock()
	if kb.nodes == nil {
		kb.nodes, kb.hidden = map[uuid.UUID]KBNode{}, map[uuid.UUID]bool{}
	}
	kb.nodes[node] = KBNode{ID: node, Title: "Журнал RE", AllEmployees: true, Tables: []KBTable{{ID: table, Title: "Осмотры", Columns: []uuid.UUID{col}}}}
	kb.mu.Unlock()

	_, err := s.CreateRule(ctx, owner, f.Id, fapi.FormRuleCreate{Kind: fapi.FormRuleKindTask, Trigger: fapi.FormRuleTriggerSubmitted})
	wantField(t, err, "task", "invalid", "Настройте действие")
	_, err = s.CreateRule(ctx, owner, f.Id, fapi.FormRuleCreate{Kind: fapi.FormRuleKindTask, Trigger: fapi.FormRuleTriggerSubmitted,
		Task:   &fapi.FormRuleTask{ProjectId: project, Title: "x", AssigneeMemberId: person("a.owner")},
		Notify: &fapi.FormRuleNotify{MemberId: person("a.owner")}})
	wantField(t, err, "notify", "invalid", "Настройки другого вида действия")
	_, err = s.CreateRule(ctx, owner, f.Id, fapi.FormRuleCreate{Kind: fapi.FormRuleKindTask, Trigger: fapi.FormRuleTriggerSubmitted,
		Task: &fapi.FormRuleTask{ProjectId: project, Title: "  ", AssigneeMemberId: person("a.owner")}})
	wantField(t, err, "task.title", "invalid", "Укажите название задачи")
	_, err = s.CreateRule(ctx, owner, f.Id, fapi.FormRuleCreate{Kind: fapi.FormRuleKindTask, Trigger: fapi.FormRuleTriggerSubmitted,
		Task: &fapi.FormRuleTask{ProjectId: uuid.New(), Title: "Проверить", AssigneeMemberId: person("a.owner")}})
	wantField(t, err, "task.projectId", "invalid", "Нет права создавать задачи в проекте")
	_, err = s.CreateRule(ctx, owner, f.Id, fapi.FormRuleCreate{Kind: fapi.FormRuleKindTask, Trigger: fapi.FormRuleTriggerSubmitted,
		Task: &fapi.FormRuleTask{ProjectId: project, Title: "Проверить", AssigneeMemberId: uuid.New()}})
	wantField(t, err, "task.assigneeMemberId", "invalid", "Выберите исполнителя")
	_, err = s.CreateRule(ctx, owner, f.Id, fapi.FormRuleCreate{Kind: fapi.FormRuleKindNotify, Trigger: fapi.FormRuleTriggerSubmitted,
		Condition: &fapi.FormRuleCondition{FieldKey: new("q-odo"), Value: new("1")}, Notify: &fapi.FormRuleNotify{MemberId: person("a.owner")}})
	wantField(t, err, "condition.fieldKey", "invalid", "Вопрос не найден")
	_, err = s.CreateRule(ctx, owner, f.Id, fapi.FormRuleCreate{Kind: fapi.FormRuleKindNotify, Trigger: fapi.FormRuleTriggerSubmitted,
		Condition: &fapi.FormRuleCondition{FieldKey: new("q-defect")}, Notify: &fapi.FormRuleNotify{MemberId: person("a.owner")}})
	wantField(t, err, "condition", "invalid", "Укажите вопрос и ответ условия")
	_, err = s.CreateRule(ctx, owner, f.Id, fapi.FormRuleCreate{Kind: fapi.FormRuleKindHttp, Trigger: fapi.FormRuleTriggerSubmitted,
		Http: &fapi.FormRuleHttp{Url: "http://hooks.example"}})
	wantField(t, err, "http.url", "invalid", "Адрес запроса должен начинаться с https://")

	kbIn := fapi.FormRuleKbInput{NodeId: node, Mode: fapi.FormRuleKbInputModeTable, TableId: new(table), Position: fapi.FormRuleKbInputPositionTop,
		Fields: []fapi.FormRuleKbField{{ColumnId: new(col), Name: "Пробег", Source: "q-odo"}}}
	_, err = s.CreateRule(ctx, owner, f.Id, fapi.FormRuleCreate{Kind: fapi.FormRuleKindKb, Trigger: fapi.FormRuleTriggerAccepted, Kb: &kbIn})
	wantField(t, err, "kb.allEmployeesConfirmed", "invalid", "Подтвердите, что записи увидят все сотрудники с доступом к странице")
	missing := kbIn
	missing.NodeId = uuid.New()
	_, err = s.CreateRule(ctx, owner, f.Id, fapi.FormRuleCreate{Kind: fapi.FormRuleKindKb, Trigger: fapi.FormRuleTriggerAccepted, Kb: &missing})
	wantField(t, err, "kb.nodeId", "invalid", "Выберите страницу Базы знаний")
	noTable := kbIn
	noTable.TableId = new(uuid.New())
	_, err = s.CreateRule(ctx, owner, f.Id, fapi.FormRuleCreate{Kind: fapi.FormRuleKindKb, Trigger: fapi.FormRuleTriggerAccepted, Kb: &noTable})
	wantField(t, err, "kb.tableId", "invalid", "Выберите таблицу")
	twice := kbIn
	twice.AllEmployeesConfirmed = true
	twice.Fields = append(twice.Fields, fapi.FormRuleKbField{ColumnId: new(col), Name: " пробег ", Source: "$id"})
	_, err = s.CreateRule(ctx, owner, f.Id, fapi.FormRuleCreate{Kind: fapi.FormRuleKindKb, Trigger: fapi.FormRuleTriggerAccepted, Kb: &twice})
	wantField(t, err, "kb.fields", "invalid", "Названия полей повторяются")

	kbIn.AllEmployeesConfirmed = true
	rule := must(s.CreateRule(ctx, owner, f.Id, fapi.FormRuleCreate{Kind: fapi.FormRuleKindKb, Trigger: fapi.FormRuleTriggerAccepted, Kb: &kbIn})).of(t)
	assert.Equal(t, 1, rule.Version)
	require.NotNil(t, rule.Kb.Node)
	assert.Equal(t, "Журнал RE", rule.Kb.Node.Title)
	assert.Equal(t, "Осмотры", *rule.Kb.TableTitle)
	mail := must(s.CreateRule(ctx, owner, f.Id, fapi.FormRuleCreate{Kind: fapi.FormRuleKindEmail, Trigger: fapi.FormRuleTriggerSubmitted,
		Email: &fapi.FormRuleEmail{To: "dispatch@alta.example"}})).of(t)
	must(s.CreateRule(ctx, owner, f.Id, fapi.FormRuleCreate{Kind: fapi.FormRuleKindHttp, Trigger: fapi.FormRuleTriggerSubmitted,
		Http: &fapi.FormRuleHttp{Url: "https://hooks.example/forms?secret=s3cr3t"}})).of(t)
	mine := must(s.Rules(ctx, owner, f.Id)).of(t)
	require.Len(t, mine.Items, 3)
	assert.NotNil(t, mine.Items[1].Email)
	assert.NotNil(t, mine.Items[2].Http)
	theirs := must(s.Rules(ctx, as(t, "a.manager-msk2"), f.Id)).of(t)
	require.Len(t, theirs.Items, 3)
	assert.Nil(t, theirs.Items[1].Email, "the address of a letter only with «Настраивать»")
	assert.Nil(t, theirs.Items[2].Http, "the URL of a request may carry a secret")

	off := must(s.UpdateRule(ctx, owner, f.Id, mail.Id, rev(mail.Revision), fapi.FormRulePatch{Enabled: new(false)})).of(t)
	assert.Equal(t, []any{1, false, int64(2)}, []any{off.Version, off.Enabled, off.Revision})
	_, err = s.UpdateRule(ctx, as(t, "a.region-msk"), f.Id, rule.Id, rev(rule.Revision), fapi.FormRulePatch{Enabled: new(false)})
	wantCode(t, err, codeForbidden, "Нет права «Настраивать» формы")
	edited := must(s.UpdateRule(ctx, owner, f.Id, rule.Id, rev(rule.Revision), fapi.FormRulePatch{
		Condition: &fapi.FormRuleCondition{FieldKey: new("q-defect"), Value: new("true")}})).of(t)
	assert.Equal(t, []any{2, int64(2), "q-defect"}, []any{edited.Version, edited.Revision, *edited.Condition.FieldKey})
	_, err = s.UpdateRule(ctx, owner, f.Id, rule.Id, rev(rule.Revision), fapi.FormRulePatch{Enabled: new(false)})
	wantCode(t, err, codeRevision, "Действие уже изменили — обновите страницу")
	_, err = s.UpdateRule(ctx, owner, f.Id, rule.Id, rev(edited.Revision), fapi.FormRulePatch{
		Task: &fapi.FormRuleTask{ProjectId: project, Title: "x", AssigneeMemberId: person("a.owner")}})
	wantField(t, err, "task", "invalid", "Настройки другого вида действия")
	_, err = s.UpdateRule(ctx, owner, f.Id, uuid.New(), rev(1), fapi.FormRulePatch{Enabled: new(false)})
	wantCode(t, err, codeNotFound, "Действие не найдено")
}

// rulesWorld is a published form with the rules «задача», «в БЗ» (a table) and «уведомить» of the tests.
func rulesWorld(t *testing.T, name string) (fapi.Form, fapi.FormRule, fapi.FormRule, uuid.UUID) {
	t.Helper()
	ctx, owner, s := t.Context(), as(t, "a.owner"), service()
	f := published(t, "a.owner", name, inspection())
	project := uuid.New()
	tasks.mu.Lock()
	if tasks.may == nil {
		tasks.may = map[uuid.UUID]bool{}
	}
	tasks.may[project] = true
	tasks.mu.Unlock()
	node, table, col := uuid.New(), uuid.New(), uuid.New()
	kb.mu.Lock()
	if kb.nodes == nil {
		kb.nodes, kb.hidden = map[uuid.UUID]KBNode{}, map[uuid.UUID]bool{}
	}
	kb.nodes[node] = KBNode{ID: node, Title: "Журнал " + name, Tables: []KBTable{{ID: table, Title: "Осмотры", Columns: []uuid.UUID{col}}}}
	kb.mu.Unlock()
	task := must(s.CreateRule(ctx, owner, f.Id, fapi.FormRuleCreate{Kind: fapi.FormRuleKindTask, Trigger: fapi.FormRuleTriggerAccepted,
		Task: &fapi.FormRuleTask{ProjectId: project, Title: "Проверить осмотр", AssigneeMemberId: person("a.manager-msk1")}})).of(t)
	kbRule := must(s.CreateRule(ctx, owner, f.Id, fapi.FormRuleCreate{Kind: fapi.FormRuleKindKb, Trigger: fapi.FormRuleTriggerAccepted,
		Kb: &fapi.FormRuleKbInput{NodeId: node, Mode: fapi.FormRuleKbInputModeTable, TableId: new(table), Position: fapi.FormRuleKbInputPositionTop,
			Fields: []fapi.FormRuleKbField{{ColumnId: new(col), Name: "Пробег", Source: "q-odo"}, {ColumnId: new(col), Name: "Ответ", Source: "$id"}}}})).of(t)
	return f, task, kbRule, node
}

// A response runs its rules once (forms.response_actions — one row per response and rule): the task on behalf of the
// author of the rule with the answers in its description, the row of the knowledge base; a failure is in the journal
// with «Повторить», an event and a notice to the owners; «Повторить» after the cause is gone; a deleted rule — 409.
func TestActions(t *testing.T) { //nolint:paralleltest // the fakes of the ports refuse for a while
	ctx, owner, s := t.Context(), as(t, "a.owner"), service()
	f, task, kbRule, node := rulesWorld(t, "Действия AC")
	before, writes := tasks.count(), kb.writes()
	x := must(s.Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: *f.PublishedVersionId, Answers: []fapi.FieldEntry{
		dec("q-odo", "84530"), choice("q-fuel", "o3"), flag("q-defect", false)}})).of(t)
	require.Len(t, x.Actions, 2)
	assert.Equal(t, before+1, tasks.count())
	assert.Equal(t, writes+1, kb.writes())
	byRule := map[uuid.UUID]fapi.FormResponseAction{}
	for _, a := range x.Actions {
		byRule[a.RuleId] = a
	}
	assert.True(t, byRule[task.Id].Ok)
	assert.Regexp(t, `^Задача LOG-\d+ «Проверить осмотр» · Исполнитель · К выполнению$`, *byRule[task.Id].Text)
	assert.Equal(t, "LOG-1", *byRule[task.Id].TaskKey)
	assert.Equal(t, "Строка в таблице «Осмотры» · страница «Журнал Действия AC»", *byRule[kbRule.Id].Text)
	assert.Equal(t, node, byRule[kbRule.Id].Node.Id)
	tasks.mu.Lock()
	last := tasks.created[len(tasks.created)-1]
	tasks.mu.Unlock()
	assert.Equal(t, person("a.owner"), last.Author, "on behalf of the author of the rule")
	assert.True(t, last.AuthorOwner)
	assert.Equal(t, "Пробег: 84530\nТопливо: ¾\nЕсть дефекты?: нет\nОтвет "+x.Number+" формы «Действия AC»", last.Description)
	kb.mu.Lock()
	rec := kb.written[len(kb.written)-1]
	kb.mu.Unlock()
	assert.Equal(t, x.Number, rec.Response)
	assert.Len(t, rec.Cells, 1, "one column: the last source wins")

	again := must(s.Retry(ctx, owner, f.Id, x.Id, task.Id)).of(t)
	assert.True(t, again.Ok)
	assert.Equal(t, before+1, tasks.count(), "a done action is not repeated")

	refuseKB(t, "страница удалена из Базы знаний")
	y := must(s.Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: *f.PublishedVersionId, Answers: []fapi.FieldEntry{
		dec("q-odo", "84600"), choice("q-fuel", "o1"), flag("q-defect", false)}})).of(t)
	var failed fapi.FormResponseAction
	for _, a := range y.Actions {
		if a.RuleId == kbRule.Id {
			failed = a
		}
	}
	assert.False(t, failed.Ok)
	assert.True(t, failed.Retryable)
	assert.Equal(t, "страница удалена из Базы знаний", *failed.Error)
	assert.Equal(t, 1, count(t, `select count(*) from outbox.events where type = 'forms.action.failed.v1' and aggregate_id = $1`, y.Id))
	assert.Equal(t, 1, count(t, `select count(*) from notify.notifications where entity_id = $1 and kind = 'forms.action.failed'
		and title like '%не сохранён в Базу знаний — страница удалена из Базы знаний'`, y.Id))
	_, err := s.Retry(ctx, owner, f.Id, y.Id, kbRule.Id)
	wantField(t, err, "ruleId", "invalid", "Не выполнено: страница удалена из Базы знаний")
	rules := must(s.Rules(ctx, owner, f.Id)).of(t)
	assert.Equal(t, []int{1, 1, 1}, []int{rules.Items[1].DoneCount, rules.Items[1].FailedCount, rules.Items[1].PendingBackfillCount})

	refuseKB(t, "")
	ok := must(s.Retry(ctx, owner, f.Id, y.Id, kbRule.Id)).of(t)
	assert.True(t, ok.Ok)
	res := must(s.Backfill(ctx, owner, f.Id, kbRule.Id)).of(t)
	assert.Equal(t, fapi.FormRuleBackfillResult{}, res, "«Новых ответов для переноса нет»")

	g := must(s.Rules(ctx, owner, f.Id)).of(t)
	require.NoError(t, s.DeleteRule(ctx, owner, f.Id, kbRule.Id, rev(g.Items[1].Revision)))
	_, err = s.Retry(ctx, owner, f.Id, y.Id, kbRule.Id)
	wantReason(t, err, reasonRuleDeleted, "Действие удалено из формы — повторить нельзя")
	_, err = s.Retry(ctx, owner, f.Id, y.Id, uuid.New())
	wantCode(t, err, codeNotFound, "Действие не найдено")
	kept := must(s.Response(ctx, owner, f.Id, y.Id)).of(t)
	for _, a := range kept.Actions {
		if a.RuleId == kbRule.Id {
			assert.False(t, a.Retryable, "the journal keeps the line of a deleted rule without «Повторить»")
		}
	}
}

// «Перенести прошлые ответы»: the responses that fit and were not written, by number; a disabled rule — 409; a rule
// of another kind — 404.
func TestBackfill(t *testing.T) { //nolint:paralleltest // counts the writes of the fake knowledge base
	ctx, owner, s := t.Context(), as(t, "a.owner"), service()
	f := published(t, "a.owner", "Перенос BF", inspection())
	for _, odo := range []string{"1", "2", "3"} {
		must(s.Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: *f.PublishedVersionId, Answers: []fapi.FieldEntry{
			dec("q-odo", odo), choice("q-fuel", "o1"), flag("q-defect", false)}})).of(t)
	}
	node := uuid.New()
	kb.mu.Lock()
	if kb.nodes == nil {
		kb.nodes, kb.hidden = map[uuid.UUID]KBNode{}, map[uuid.UUID]bool{}
	}
	kb.nodes[node] = KBNode{ID: node, Title: "Записи BF"}
	kb.mu.Unlock()
	rule := must(s.CreateRule(ctx, owner, f.Id, fapi.FormRuleCreate{Kind: fapi.FormRuleKindKb, Trigger: fapi.FormRuleTriggerSubmitted,
		Kb: &fapi.FormRuleKbInput{NodeId: node, Mode: fapi.FormRuleKbInputModeEntry, Position: fapi.FormRuleKbInputPositionBottom,
			Fields: []fapi.FormRuleKbField{{Name: "Пробег", Source: "q-odo"}}}})).of(t)
	assert.Equal(t, 3, rule.PendingBackfillCount)
	writes := kb.writes()
	res := must(s.Backfill(ctx, owner, f.Id, rule.Id)).of(t)
	assert.Equal(t, fapi.FormRuleBackfillResult{Added: 3}, res)
	assert.Equal(t, writes+3, kb.writes())
	kb.mu.Lock()
	recs := kb.written[len(kb.written)-3:]
	kb.mu.Unlock()
	assert.Equal(t, []string{"1", "2", "3"}, []string{recs[0].Lines[0].Value, recs[1].Lines[0].Value, recs[2].Lines[0].Value}, "by number")
	assert.True(t, recs[0].Bottom)
	assert.Equal(t, fapi.FormRuleBackfillResult{}, must(s.Backfill(ctx, owner, f.Id, rule.Id)).of(t))
	off := must(s.UpdateRule(ctx, owner, f.Id, rule.Id, rev(rule.Revision), fapi.FormRulePatch{Enabled: new(false)})).of(t)
	_, err := s.Backfill(ctx, owner, f.Id, off.Id)
	wantReason(t, err, reasonRuleDisabled, "Действие выключено — включите его, чтобы перенести ответы")
	n := must(s.CreateRule(ctx, owner, f.Id, fapi.FormRuleCreate{Kind: fapi.FormRuleKindNotify, Trigger: fapi.FormRuleTriggerSubmitted,
		Notify: &fapi.FormRuleNotify{MemberId: person("a.owner")}})).of(t)
	_, err = s.Backfill(ctx, owner, f.Id, n.Id)
	wantCode(t, err, codeNotFound, "Действие не найдено")
}

// «Повторить» and «Перенести» at once (return 3): the action and its row of the journal in one transaction under the
// lock of the row — one task, one row of the knowledge base.
func TestRetryConcurrently(t *testing.T) { //nolint:paralleltest // the fakes of the ports refuse for a while
	ctx, owner, s := t.Context(), as(t, "a.owner"), service()
	f, task, kbRule, _ := rulesWorld(t, "Гонка повтора RC")
	refuseTasks(t, "у автора правила нет права «Создавать» в проекте «Логистика»")
	refuseKB(t, "страница удалена из Базы знаний")
	x := must(s.Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: *f.PublishedVersionId, Answers: []fapi.FieldEntry{
		dec("q-odo", "7"), choice("q-fuel", "o1"), flag("q-defect", false)}})).of(t)
	for _, a := range x.Actions {
		assert.False(t, a.Ok)
	}
	refuseTasks(t, "")
	refuseKB(t, "")
	beforeTasks, beforeKB := tasks.count(), kb.writes()
	var wg sync.WaitGroup
	for range 4 {
		wg.Go(func() { _, _ = service().Retry(ctx, owner, f.Id, x.Id, task.Id) })
		wg.Go(func() { _, _ = service().Retry(ctx, owner, f.Id, x.Id, kbRule.Id) })
		wg.Go(func() { _, _ = service().Backfill(ctx, owner, f.Id, kbRule.Id) })
	}
	wg.Wait()
	assert.Equal(t, beforeTasks+1, tasks.count(), "one task")
	assert.Equal(t, beforeKB+1, kb.writes(), "one row")
	assert.Equal(t, 2, count(t, `select count(*) from forms.response_actions where response_id = $1 and ok`, x.Id))
}

// suspended is the directory of the control DB in which one member is no longer active.
type suspended struct {
	base Directory
	who  uuid.UUID
}

func (d suspended) Memberships(ctx context.Context, tenant uuid.UUID) (map[uuid.UUID]Membership, error) {
	ms, err := d.base.Memberships(ctx, tenant)
	if err == nil {
		m := ms[d.who]
		m.Status = "suspended"
		ms[d.who] = m
	}
	return ms, err
}

// Return 1: «Уведомить сотрудника» notifies an active member only — the member of the rule who left meanwhile is a
// refusal of the journal («сотрудник не найден»), not a notice nobody reads.
func TestNotifyLeftMember(t *testing.T) {
	t.Parallel()
	ctx, owner, s := t.Context(), as(t, "a.owner"), service()
	f := published(t, "a.owner", "Уведомление ушедшему NL", page(qq("q-text", fapi.FormQuestionTypeText, "Отзыв", true)))
	must(s.CreateRule(ctx, owner, f.Id, fapi.FormRuleCreate{Kind: fapi.FormRuleKindNotify, Trigger: fapi.FormRuleTriggerSubmitted,
		Notify: &fapi.FormRuleNotify{MemberId: person("a.manager-msk2")}})).of(t)
	left := service()
	left.Directory = suspended{base: ControlDirectory{DB: control}, who: person("a.manager-msk2")}
	x := must(left.Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: *f.PublishedVersionId,
		Answers: []fapi.FieldEntry{text("q-text", "ок")}})).of(t)
	require.Len(t, x.Actions, 1)
	assert.False(t, x.Actions[0].Ok)
	assert.Equal(t, "сотрудник не найден", *x.Actions[0].Error)
	assert.Zero(t, count(t, `select count(*) from notify.notifications where entity_id = $1 and recipient_person_id = $2`, x.Id,
		person("a.manager-msk2")))
}

// refuseKB makes the fake knowledge base refuse with text ("" — accept) until the end of the test.
func refuseKB(t *testing.T, text string) {
	t.Helper()
	kb.mu.Lock()
	kb.refuse = text
	kb.mu.Unlock()
	t.Cleanup(func() {
		kb.mu.Lock()
		kb.refuse = ""
		kb.mu.Unlock()
	})
}

// refuseTasks makes the fake tasks refuse with text ("" — accept) until the end of the test.
func refuseTasks(t *testing.T, text string) {
	t.Helper()
	tasks.mu.Lock()
	tasks.refuse = text
	tasks.mu.Unlock()
	t.Cleanup(func() {
		tasks.mu.Lock()
		tasks.refuse = ""
		tasks.mu.Unlock()
	})
}
