//go:build integration

package tasks

import (
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
)

// inTenantTx runs fn in a transaction of tenant A as the application (the transaction of a response of a form) and
// commits it.
func inTenantTx(t *testing.T, fn func(tx pgx.Tx)) {
	t.Helper()
	pool, err := pools.For(t.Context(), ref("tenant:a"))
	if err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(t.Context()) }()
	fn(tx)
	if err := tx.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
}

func fullName(t *testing.T, actor string) string {
	t.Helper()
	var name string
	if err := superA.QueryRow(t.Context(), `select full_name from people.person_profiles where id = $1`, person(actor)).Scan(&name); err != nil {
		t.Fatal(err)
	}
	return name
}

// The port of «Формы» (W4.21, Q-W4.05-27): the task of a rule «Создать задачу» is created in the transaction of the
// response on behalf of the author of the rule — its number, the first status of «К выполнению» («Новая» of the simple
// process), the response as its source and related object, the line of the history and the event; the refusals are
// texts for the journal.
func TestFormTask(t *testing.T) {
	t.Parallel()
	ctx, s, tenant := t.Context(), service(), ref("tenant:a")
	p := fresh(t, "ФРМ", nil, tasksapi.Limited, tasksapi.Simple)
	response := uuid.New()
	var res FormTaskResult
	inTenantTx(t, func(tx pgx.Tx) {
		assert.True(t, must(s.MayCreate(ctx, tx, tenant, person("a.owner"), true, p.Id)).of(t), "the owner may create")
		assert.False(t, must(s.MayCreate(ctx, tx, tenant, person("a.driver-msk1"), false, p.Id)).of(t), "outside of a limited project")
		assert.False(t, must(s.MayCreate(ctx, tx, tenant, person("a.owner"), true, uuid.New())).of(t), "no project — no tasks")
		res = must(s.CreateFormTask(ctx, tx, tenant, FormTask{Project: p.Id, Author: person("a.owner"), AuthorOwner: true,
			AuthorName: "Владелец", Assignee: person("a.owner"), Title: "Проверить осмотр", Description: "Пробег: 84530\nОтвет R-0001 формы «Осмотр»",
			Response: response, Origin: "Ответ R-0001 формы «Осмотр»"})).of(t)
	})
	assert.Empty(t, res.Refused)
	assert.Contains(t, res.Key, "ФРМ-")
	assert.Equal(t, []string{"Новая", fullName(t, "a.owner")}, []string{res.Status, res.Assigned})
	x := must(s.Task(ctx, as(t, "a.owner"), res.ID)).of(t)
	assert.Equal(t, "Проверить осмотр", x.Title)
	assert.Equal(t, "Пробег: 84530\nОтвет R-0001 формы «Осмотр»", val(x.DescriptionMarkdown))
	assert.Equal(t, []tasksapi.ObjectRef{{ModuleKey: "forms", EntityType: "response", EntityId: response}}, x.RelatedObjects)
	assert.Equal(t, 1, count(t, `select count(*) from tasks.tasks where id = $1 and source_module = 'forms' and source_type = 'response'
		and source_id = $2 and author_id = $3`, res.ID, response, person("a.owner")), "source and author")
	assert.Equal(t, 1, count(t, `select count(*) from tasks.task_events where task_id = $1 and kind = 'created' and actor_id = $2
		and text = 'Создана действием формы: Ответ R-0001 формы «Осмотр»'`, res.ID, person("a.owner")), "history")
	assert.Equal(t, 1, count(t, `select count(*) from outbox.events where type = 'tasks.task.created.v1' and aggregate_id = $1
		and payload->>'responseId' = $2`, res.ID, response.String()), "event")
	inTenantTx(t, func(tx pgx.Tx) {
		assert.Equal(t, map[uuid.UUID]string{res.ID: res.Key}, must(s.FormTaskKeys(ctx, tx, []uuid.UUID{res.ID, uuid.New()})).of(t))
		refusals := []struct {
			in   FormTask
			want string
		}{
			{FormTask{Project: uuid.New(), Author: person("a.owner"), AuthorOwner: true, Assignee: person("a.owner"), Title: "Проверить"},
				"проект задач удалён"},
			{FormTask{Project: p.Id, Author: person("a.driver-msk1"), AuthorName: "Водитель", Assignee: person("a.owner"), Title: "Проверить"},
				"у автора правила Водитель нет права «Создавать» в проекте «" + p.Name + "»"},
			{FormTask{Project: p.Id, Author: person("a.owner"), AuthorOwner: true, Assignee: person("a.driver-msk1"), Title: "Проверить"},
				"исполнитель " + fullName(t, "a.driver-msk1") + " не видит проект «" + p.Name + "»"},
		}
		for _, c := range refusals {
			assert.Equal(t, FormTaskResult{Refused: c.want}, must(s.CreateFormTask(ctx, tx, tenant, c.in)).of(t))
		}
	})
	assert.Equal(t, 1, count(t, `select count(*) from tasks.tasks where project_id = $1`, p.Id), "a refusal creates no task")
}
