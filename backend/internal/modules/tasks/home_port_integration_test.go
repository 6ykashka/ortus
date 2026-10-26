//go:build integration

package tasks

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: clock of the suites
)

const (
	homeLead   = "a.project-lead"
	homeDriver = "a.driver-msk1"
)

// homeOf is Home of actor in tenant A with the limit of the queue (3).
func homeOf(t *testing.T, actor string) HomeView {
	t.Helper()
	return must(service().Home(t.Context(), as(t, actor), 3)).of(t)
}

// minus is the difference of two summaries.
func minus(a, b HomeSummary) HomeSummary {
	return HomeSummary{New: a.New - b.New, InProgress: a.InProgress - b.InProgress, Review: a.Review - b.Review, MyNew: a.MyNew - b.MyNew}
}

// exec runs a statement of the superuser of tenant A.
func exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := superA.Exec(t.Context(), sql, args...); err != nil {
		t.Fatal(err)
	}
}

// hasCard reports whether cards hold the task id with place.
func hasCard(cards []HomeTask, id uuid.UUID, place string) bool {
	for _, c := range cards {
		if c.ID == id && c.Place == place {
			return true
		}
	}
	return false
}

// W4.81 · The port of «Главная»: the tasks the member sees as listTasks shows them (tasks.read by the level of the
// project, TP-03, or the scope self) — the counters of the card «Задачи» and of the badge, and the first three tasks
// of the member «Новая» and «На проверке», newest first, with the urgency, the deadline, the origin «из ответа формы»
// and a request of a funnel. Not parallel: the counters are compared before and after the rows of the test, and the
// parallel tests of the package add tasks of the same people.
func TestHomePort(t *testing.T) { //nolint:paralleltest // counters before and after; parallel tests add tasks of the same people
	homeFixtures(t)
	homeProject(t)
	homeFunnel(t)
}

// homeFixtures: the project lead has fleet-2 «На проверке» and sees fleet-1 «Новая» of the driver; the driver (scope
// self) sees fleet-1 and build-1 «В работе» of the closed «Стройка».
func homeFixtures(t *testing.T) {
	t.Helper()
	lead := homeOf(t, homeLead)
	if !hasCard(lead.Mine, ref("task:a.fleet-2"), PlaceReview) || hasCard(lead.Mine, ref("task:a.fleet-1"), PlaceNew) {
		t.Fatalf("lead cards %+v: want fleet-2 on review, not fleet-1 of the driver", lead.Mine)
	}
	drv := homeOf(t, homeDriver)
	if !hasCard(drv.Mine, ref("task:a.fleet-1"), PlaceNew) || hasCard(drv.Mine, ref("task:a.build-1"), PlaceProgress) {
		t.Fatalf("driver cards %+v: want fleet-1 new only", drv.Mine)
	}
	if drv.Summary.InProgress < 1 || drv.Summary.MyNew < 1 {
		t.Fatalf("driver summary %+v: build-1 «В работе» of the closed project and fleet-1 of his own count", drv.Summary)
	}
}

// homeProject: a project of the test where the lead is an executor — an urgent new task with a deadline, one on
// review, one in progress, one made by a rule of a form and a new task of somebody else.
func homeProject(t *testing.T) {
	t.Helper()
	before := homeOf(t, homeLead)
	p := fresh(t, "ГЛВ", nil, tasksapi.Limited, tasksapi.Simple)
	assign(t, p.Id, homeLead, roleExec)
	// The package's parallel tests count the projects of the lead; the grant must not outlive this test.
	t.Cleanup(func() {
		_, err := superA.Exec(context.WithoutCancel(t.Context()),
			`delete from access.role_assignments where scope_kind = 'project' and scope_ref = $1`, p.Id)
		if err != nil {
			t.Error(err)
		}
	})
	due := harness.Now().Add(48 * time.Hour).UTC().Truncate(time.Second)
	toLead := func(b *tasksapi.TaskCreate) { b.AssigneeMemberId = new(person(homeLead)) }
	urgent := newTask(t, "a.owner", p.Id, "Срочная новая", toLead, func(b *tasksapi.TaskCreate) {
		b.Priority, b.DueAt = new(tasksapi.Urgent), &due
	})
	review := newTask(t, "a.owner", p.Id, "На проверке у руководителя", toLead)
	exec(t, `update tasks.tasks set status_id = 's3' where id = $1`, review.Id)
	work := newTask(t, "a.owner", p.Id, "В работе у руководителя", toLead)
	exec(t, `update tasks.tasks set status_id = 's2' where id = $1`, work.Id)
	form := newTask(t, "a.owner", p.Id, "Проверить осмотр", toLead)
	exec(t, `update tasks.tasks set source_module = 'forms', source_type = 'response', source_id = $2 where id = $1`, form.Id, uuid.New())
	newTask(t, "a.owner", p.Id, "Новая владельца", func(b *tasksapi.TaskCreate) { b.AssigneeMemberId = new(person("a.owner")) })

	after := homeOf(t, homeLead)
	if got, want := minus(after.Summary, before.Summary), (HomeSummary{New: 3, InProgress: 1, Review: 1, MyNew: 2}); got != want {
		t.Fatalf("summary delta %+v, want %+v", got, want)
	}
	want := []HomeTask{
		{ID: form.Id, Project: p.Id, Key: val(form.Key), Title: "Проверить осмотр", Place: PlaceNew, FromForm: true},
		{ID: review.Id, Project: p.Id, Key: val(review.Key), Title: "На проверке у руководителя", Place: PlaceReview},
		{ID: urgent.Id, Project: p.Id, Key: val(urgent.Key), Title: "Срочная новая", Place: PlaceNew, Urgent: true},
	}
	if len(after.Mine) != len(want) {
		t.Fatalf("cards %+v, want the first three", after.Mine)
	}
	if d := after.Mine[2].DueAt; d == nil || !d.Equal(due) || after.Mine[0].DueAt != nil {
		t.Fatalf("deadlines %v, %v; want %v of the urgent task only", after.Mine[0].DueAt, d, due)
	}
	for i, w := range want {
		g := after.Mine[i]
		g.DueAt = nil
		if g != w {
			t.Fatalf("card %d %+v, want %+v", i, g, w)
		}
	}
}

// homeFunnel: a request of a funnel assigned to the driver (scope self) — «Новые» and a card opened on the board of the
// funnel, not the badge.
func homeFunnel(t *testing.T) {
	t.Helper()
	before := homeOf(t, homeDriver)
	funnel, request := uuid.New(), uuid.New()
	var noUnit, noAccess, noVersion *string
	exec(t, `insert into tasks.projects (id, key, name, org_unit_id, access, flow, workflow_key, owner_id, current_version,
		created_at, updated_at) values ($1, 'ЗВК', 'Заявки теста', $2, $3, 'leads', 'leads', $4, $5::int, $6, $6)`,
		funnel, noUnit, noAccess, person("a.owner"), noVersion, harness.Now())
	exec(t, `insert into tasks.tasks (id, project_id, number, title, status_id, assignee_id, created_at, updated_at)
		values ($1, $2, 101, 'Квартира теста', 'new', $3, $4, $4)`, request, funnel, person(homeDriver), harness.Now().Add(time.Hour))
	after := homeOf(t, homeDriver)
	if got, want := minus(after.Summary, before.Summary), (HomeSummary{New: 1}); got != want {
		t.Fatalf("driver summary delta %+v, want %+v (a request of a funnel is new, not the badge)", got, want)
	}
	if len(after.Mine) == 0 || after.Mine[0].ID != request || !after.Mine[0].Funnel || after.Mine[0].Place != PlaceNew || after.Mine[0].Key != "ЗВК-101" {
		t.Fatalf("driver cards %+v, want the request of the funnel first", after.Mine)
	}
}
