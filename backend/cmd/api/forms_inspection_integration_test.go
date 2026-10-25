//go:build integration

package main

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"

	formsapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
	"github.com/ortus/ortus-crm/backend/internal/modules/forms"
	"github.com/ortus/ortus-crm/backend/internal/modules/tasks"
)

// W4.24: the adapter of the port of the tasks gives the module of tasks what the task of the response of an
// inspection carries («Повторить» in the journal of such a response builds it in cmd/api): the priority, the checklist
// and the trip next to the response. The task is made in «Логистика · Север» of the seed and rolled back.
func TestFormTasksOfInspection(t *testing.T) {
	t.Parallel()
	pools, ev := formsPorts(t)
	ctx := t.Context()
	pool, err := pools.For(ctx, seedAlta)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	owner, kotova := altaMember(t, "m-owner", true), altaMember(t, "m-kotova", false)
	trip := formsapi.ObjectRef{ModuleKey: "fleet", EntityType: "trip", EntityId: uuid.New()}
	a := formTasks{S: &tasks.Service{Pools: pools, Authz: ev}}
	res, err := a.CreateFormTask(ctx, tx, seedAlta, forms.FormTask{Project: uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:t-alta:fleet")),
		Author: owner.PersonID, AuthorOwner: true, AuthorName: "Дарья Зимина", Assignee: kotova.PersonID, Title: "Проверить осмотр Р-208 (выезд)",
		Response: uuid.New(), Origin: "Ответ R-1013 формы «Осмотр машины»", Priority: "urgent",
		Checklist: []string{"Сверить фото с прошлым осмотром", "Проверить пробег"}, Related: []formsapi.ObjectRef{trip}})
	if err != nil || res.Refused != "" {
		t.Fatalf("CreateFormTask: %+v %v", res, err)
	}
	var (
		priority           string
		checklist, related []byte
	)
	if err := tx.QueryRow(ctx, `select priority, checklist, related_objects from tasks.tasks where id = $1`, res.ID).
		Scan(&priority, &checklist, &related); err != nil {
		t.Fatal(err)
	}
	var items []struct{ Text string }
	var refs []formsapi.ObjectRef
	if err := json.Unmarshal(checklist, &items); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(related, &refs); err != nil {
		t.Fatal(err)
	}
	if priority != "urgent" || len(items) != 2 || items[1].Text != "Проверить пробег" || len(refs) != 2 || refs[1] != trip {
		t.Fatalf("task: %s, checklist %s, related %s", priority, checklist, related)
	}
}
