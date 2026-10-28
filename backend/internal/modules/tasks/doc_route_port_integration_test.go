//go:build integration

package tasks

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: clock of the suites
)

// inTx runs fn in a transaction of tenant A as the application and commits it.
func inTx(t *testing.T, fn func(ctx context.Context, tx pgx.Tx)) {
	t.Helper()
	pool, err := pools.For(t.Context(), ref("tenant:a"))
	if err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(t.Context())) }()
	fn(t.Context(), tx)
	if err := tx.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
}

func routeTask(project uuid.UUID, author string, waiting ...uuid.UUID) DocRouteTask {
	due := harness.Now().Add(48 * time.Hour)
	return DocRouteTask{Project: project, Author: person(author), Document: uuid.New(), Route: uuid.New(), Title: "Согласовать: Приказ № 5",
		Description: "Маршрут документа", State: DocRouteState{Status: "active", Title: "Приказ № 5", Version: 1, Step: 1, Steps: 2, StepName: "Согласовать",
			Waiting: waiting, WaitingNames: []string{"Исполнитель"}, Assignee: first(waiting), Due: &due}}
}

func first(ids []uuid.UUID) uuid.UUID {
	if len(ids) == 0 {
		return uuid.Nil
	}
	return ids[0]
}

// The route of a document keeps a mirror task in a project: the status, the assignee and the card follow the route, a
// person cannot move it by hand (documents.js syncTask, Q-W4.00-documents-3).
func TestDocRouteTask(t *testing.T) { //nolint:gocyclo,paralleltest // a scenario of one story: the steps share the data and run in order
	svc := service()
	p := fresh(t, "ДОР", nil, tasksapi.Open, tasksapi.Approval)
	exec := person("a.manager-msk1")
	in := routeTask(p.Id, "a.owner", exec)
	var res DocRouteTaskResult
	inTx(t, func(ctx context.Context, tx pgx.Tx) {
		var err error
		if res, err = svc.CreateDocRouteTask(ctx, tx, ref("tenant:a"), in); err != nil || res.Refused != "" {
			t.Fatalf("create: %v %+v", err, res)
		}
	})
	if res.Key == "" || res.Project != p.Id {
		t.Fatalf("result %+v", res)
	}
	got := must(svc.Task(t.Context(), as(t, "a.owner"), res.ID)).of(t)
	if got.Title != in.Title || val(got.Priority) != tasksapi.High || got.DocRoute == nil || got.DocRoute.Document.EntityId != in.Document ||
		got.DocRoute.StepName != "Согласовать" || got.DocRoute.StepsTotal != 2 || got.AssigneeMemberId == nil || *got.AssigneeMemberId != exec {
		t.Fatalf("task %+v route %+v", got, got.DocRoute)
	}
	if st := val(got.StatusName); st != "На проверке" {
		t.Fatalf("status %q, want «На проверке»", st)
	}
	if n := count(t, `select count(*) from tasks.tasks where source_module = 'docs' and source_type = 'route' and source_id = $1`, in.Route); n != 1 {
		t.Fatalf("%d tasks of the route, want 1", n)
	}
	// nobody moves a mirror task by hand
	_, err := svc.Transition(t.Context(), as(t, "a.owner"), res.ID, rev(got.Revision), tasksapi.TaskTransition{TransitionKey: "any"})
	wantReason(t, err, "doc_route", "")

	sync := func(st DocRouteState, note string) tasksapi.Task {
		inTx(t, func(ctx context.Context, tx pgx.Tx) {
			st.Actor = person("a.manager-msk1")
			if err := svc.SyncDocRouteTask(ctx, tx, ref("tenant:a"), res.ID, st, note); err != nil {
				t.Fatalf("sync %s: %v", st.Status, err)
			}
		})
		return must(svc.Task(t.Context(), as(t, "a.owner"), res.ID)).of(t)
	}
	state := in.State
	state.Status, state.Waiting, state.WaitingNames, state.Assignee = "returned", nil, nil, person("a.owner")
	got = sync(state, "Менеджер: вернул(а) на доработку v1 — Уточните сумму")
	if st := val(got.StatusName); st != "В работе" || *got.AssigneeMemberId != person("a.owner") {
		t.Fatalf("returned: status %q assignee %v, want «В работе» and the author", st, got.AssigneeMemberId)
	}
	hist := must(svc.History(t.Context(), as(t, "a.owner"), res.ID, nil, nil)).of(t)
	if len(hist.Items) == 0 || hist.Items[0].Text == "" {
		t.Fatalf("history %+v", hist)
	}
	state.Status, state.Step = "done", 2
	got = sync(state, "Маршрут завершён")
	if st := val(got.StatusName); st != "Готово" {
		t.Fatalf("done: status %q", st)
	}
	state.Status = "cancelled"
	got = sync(state, "")
	if st := val(got.StatusName); st != "Отменена" {
		t.Fatalf("cancelled: status %q", st)
	}
	if got.DocRoute == nil || got.DocRoute.Step != 2 {
		t.Fatalf("card of the route %+v", got.DocRoute)
	}
	// a task that is gone is no error: the route goes on
	inTx(t, func(ctx context.Context, tx pgx.Tx) {
		if err := svc.SyncDocRouteTask(ctx, tx, ref("tenant:a"), uuid.New(), state, ""); err != nil {
			t.Fatalf("sync of a missing task: %v", err)
		}
	})
}

// The system project «ДОК · Документы · маршруты» is made once with the process «С согласованием» and open for all; a
// chosen project needs «Создавать» of the author; a project without a process is refused (Q-W4.00-documents-18).
func TestDocRouteProject(t *testing.T) { //nolint:gocyclo,paralleltest // a scenario of one story: the test counts the projects of the organization
	svc := service()
	var a, b DocRouteTaskResult
	inTx(t, func(ctx context.Context, tx pgx.Tx) {
		var err error
		if a, err = svc.CreateDocRouteTask(ctx, tx, ref("tenant:a"), routeTask(uuid.Nil, "a.manager-msk1")); err != nil || a.Refused != "" {
			t.Fatalf("default project: %v %+v", err, a)
		}
		if b, err = svc.CreateDocRouteTask(ctx, tx, ref("tenant:a"), routeTask(uuid.Nil, "a.manager-msk2")); err != nil || b.Refused != "" {
			t.Fatalf("default project again: %v %+v", err, b)
		}
	})
	if a.Project != b.Project || a.Project == uuid.Nil {
		t.Fatalf("projects %v and %v, want one", a.Project, b.Project)
	}
	var name, flow, workflow, access string
	if err := superA.QueryRow(t.Context(), `select name, flow, workflow_key, access from tasks.projects where id = $1`, a.Project).Scan(&name, &flow, &workflow, &access); err != nil ||
		name != "ДОК · Документы · маршруты" || flow != "tasks" || workflow != "approval" || access != "open" {
		t.Fatalf("system project: %v %q %q %q %q", err, name, flow, workflow, access)
	}
	if n := count(t, `select count(*) from tasks.projects where name = 'ДОК · Документы · маршруты'`); n != 1 {
		t.Fatalf("%d system projects, want 1", n)
	}
	closed := fresh(t, "ДЗК", nil, tasksapi.Closed, tasksapi.Approval)
	var denied DocRouteTaskResult
	inTx(t, func(ctx context.Context, tx pgx.Tx) {
		var err error
		if denied, err = svc.CreateDocRouteTask(ctx, tx, ref("tenant:a"), routeTask(closed.Id, "a.manager-msk2")); err != nil {
			t.Fatal(err)
		}
		ok, err := svc.MayCreate(ctx, tx, ref("tenant:a"), person("a.manager-msk2"), false, closed.Id)
		if err != nil || ok {
			t.Fatalf("MayCreate of a stranger in a closed project: %v %v", ok, err)
		}
	})
	if denied.Refused == "" || !denied.Forbidden || denied.ID != uuid.Nil {
		t.Fatalf("closed project: %+v, want a refusal «нет права»", denied)
	}
	var missing DocRouteTaskResult
	inTx(t, func(ctx context.Context, tx pgx.Tx) {
		var err error
		if missing, err = svc.CreateDocRouteTask(ctx, tx, ref("tenant:a"), routeTask(uuid.New(), "a.owner")); err != nil {
			t.Fatal(err)
		}
	})
	if missing.Refused == "" || missing.Forbidden {
		t.Fatalf("missing project: %+v, want a refusal «нет проекта»", missing)
	}
}
