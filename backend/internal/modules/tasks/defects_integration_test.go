//go:build integration

package tasks

import (
	"context"
	"encoding/json"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: clock of the suites
)

// deliver hands the consumer an event of the queue of defects of tenant A, as the worker does.
func deliver(t *testing.T, eventID uuid.UUID, typ string, payload map[string]any) {
	t.Helper()
	b, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	d := DefectTasks{Pools: pools, Now: clock}
	if err := d.Handle(t.Context(), events.Message{TenantID: ref("tenant:a"), EventID: eventID, Type: typ, Payload: b}); err != nil {
		t.Fatal(err)
	}
}

// defectTasks lists the live tasks made for the defect id.
func defectTasks(t *testing.T, id uuid.UUID) []uuid.UUID {
	t.Helper()
	rows, err := superA.Query(t.Context(), `select id from tasks.tasks where source_module = 'fleet' and source_type = 'defect'
		and source_id = $1 and deleted_at is null`, id)
	if err != nil {
		t.Fatal(err)
	}
	var out []uuid.UUID
	for rows.Next() {
		var x uuid.UUID
		if err := rows.Scan(&x); err != nil {
			t.Fatal(err)
		}
		out = append(out, x)
	}
	return out
}

// S2-17 → task (D-29: «на шаге 4.1 — задача»): a blocking defect on departure becomes the urgent task of the project of
// the area of the vehicle, its assignment moves to the task, the decision finishes it; a repeated delivery changes
// nothing.
func TestDefectTask(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	smr2 := unit("smr2")
	p := fresh(t, "ДФК", &smr2, tasksapi.Limited, tasksapi.Approval)
	vehicle := ref("vehicle:a.smr2")
	// W4.11 возврат 1 (ревью): blocking_reported delivered after the decision (or again after it) finds the defect
	// decided and makes no task in the project of the area — the queue S2-17 has nothing to check. Here, not in a test of
	// its own: a second project of «Самара-2» in a parallel test would take the task of the defect below (the oldest).
	// The subtests run once the main flow below is done (parallel), each with defects of its own.
	t.Run("decided before the report", func(t *testing.T) {
		t.Parallel()
		decided := uuid.New()
		if _, err := superA.Exec(ctx, `insert into fleet.defects (id, vehicle_id, zone, severity, description, state, decision,
			resolved_by, resolved_at) values ($1, $2, 'Фары', 'blocking', 'Не горит ближний свет', 'resolved', 'allow_departure', $3, now())`,
			decided, vehicle, person("a.owner")); err != nil {
			t.Fatal(err)
		}
		deliver(t, uuid.New(), EventDefectBlocking, map[string]any{"defectId": decided, "vehicleId": vehicle})
		if ids := defectTasks(t, decided); len(ids) != 0 {
			t.Fatalf("a decided defect got tasks %v", ids)
		}
	})
	t.Run("events at once, then a publication in flight", func(t *testing.T) {
		t.Parallel()
		defectsAtOnce(t, vehicle)
		defectAfterPublication(t, p.Id, vehicle)
	})
	trip, defect := uuid.New(), uuid.New()
	now := harness.Now()
	if _, err := superA.Exec(ctx, `insert into fleet.trips (id, number, unit_id, state, vehicle_id, planned)
		values ($1, 'Р-0417', $2, 'defect_review', $3, tstzrange($4::timestamptz, $5::timestamptz))`,
		trip, smr2, vehicle, now, now.Add(4*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := superA.Exec(ctx, `insert into fleet.defects (id, vehicle_id, zone, severity, description, state, trip_id)
		values ($1, $2, 'Шины', 'blocking', 'Порез боковины, корд виден', 'in_review', $3)`, defect, vehicle, trip); err != nil {
		t.Fatal(err)
	}
	reported := uuid.New()
	payload := map[string]any{"defectId": defect, "tripId": trip, "vehicleId": vehicle}
	deliver(t, reported, EventDefectBlocking, payload)
	deliver(t, reported, EventDefectBlocking, payload)   // the same delivery again
	deliver(t, uuid.New(), EventDefectBlocking, payload) // another event of the same defect
	ids := defectTasks(t, defect)
	if len(ids) != 1 {
		t.Fatalf("tasks of the defect %v", ids)
	}
	x := card(t, "a.owner", ids[0])
	same(t, "task of the defect", []any{x.ProjectId, x.Title, val(x.Priority), x.Status, val(x.AssigneeMemberId), str(x.DescriptionMarkdown)},
		[]any{p.Id, "Проверить дефект: ИЗ-202 — Шины", tasksapi.Urgent, "s1", person("a.owner"),
			"Шины: Порез боковины, корд виден\nРейс Р-0417. Выезд заблокирован до решения по дефекту."})
	same(t, "related", x.RelatedObjects, []tasksapi.ObjectRef{{ModuleKey: "fleet", EntityType: "vehicle", EntityId: vehicle},
		{ModuleKey: "fleet", EntityType: "trip", EntityId: trip}})
	same(t, "history", slices.Contains(history(t, "a.owner", x.Id), "Система: Создана по дефекту осмотра: Шины — Порез боковины, корд виден"), true)

	due := now.Add(24 * time.Hour)
	if _, err := superA.Exec(ctx, `update fleet.defects set assignee_id = $2, due_at = $3, assigned_by = $4, assigned_at = $5 where id = $1`,
		defect, person("a.region-msk"), due, person("a.owner"), now); err != nil {
		t.Fatal(err)
	}
	deliver(t, uuid.New(), EventDefectAssigned, map[string]any{"defectId": defect, "vehicleId": vehicle, "tripId": trip,
		"assigneeMemberId": person("a.region-msk"), "dueAt": due})
	x = card(t, "a.owner", x.Id)
	same(t, "assigned", []any{val(x.AssigneeMemberId), val(x.DueAt).Equal(due)}, []any{person("a.region-msk"), true})

	deliver(t, uuid.New(), EventDefectDecided, map[string]any{"defectId": defect, "vehicleId": vehicle, "tripId": trip,
		"decision": "allow_departure"})
	x = card(t, "a.owner", x.Id)
	same(t, "decided", x.Status, "s4")
	same(t, "history", history(t, "a.owner", x.Id)[0], "Процесс: Решение по дефекту: Новая → Готово. Дефект признан некритичным — выезд разрешён")
	deliver(t, uuid.New(), EventDefectDecided, map[string]any{"defectId": defect, "vehicleId": vehicle, "decision": "confirm_out_of_service"})
	same(t, "a finished task stays", card(t, "a.owner", x.Id).Revision, x.Revision)
}

// reportDefect is the blocking_reported of the consumer under a new event id, as a worker gets it (an error, not a
// failure of the test: it runs in goroutines).
func reportDefect(ctx context.Context, defect, vehicle uuid.UUID) error {
	b, err := json.Marshal(map[string]any{"defectId": defect, "vehicleId": vehicle})
	if err != nil {
		return err
	}
	d := DefectTasks{Pools: pools, Now: clock}
	return d.Handle(ctx, events.Message{TenantID: ref("tenant:a"), EventID: uuid.New(), Type: EventDefectBlocking, Payload: b})
}

// openDefect is a new open blocking defect of the vehicle.
func openDefect(t *testing.T, vehicle uuid.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := superA.Exec(t.Context(), `insert into fleet.defects (id, vehicle_id, zone, severity, description, state)
		values ($1, $2, 'Зеркала', 'blocking', 'Трещина правого зеркала', 'open')`, id, vehicle); err != nil {
		t.Fatal(err)
	}
	return id
}

// defectsAtOnce (W4.11 возврат 1, ревью): the consumer looks for the task of the defect under the lock of the project,
// so several events of one defect at once (blocking_reported again, or two workers) make one task.
func defectsAtOnce(t *testing.T, vehicle uuid.UUID) {
	t.Helper()
	once := openDefect(t, vehicle)
	for i, err := range together(4, func(int) error { return reportDefect(t.Context(), once, vehicle) }) {
		if err != nil {
			t.Fatalf("event %d: %v", i, err)
		}
	}
	if ids := defectTasks(t, once); len(ids) != 1 {
		t.Fatalf("events at once made tasks %v, want one", ids)
	}
}

// defectAfterPublication (W4.11 возврат 1, ревью): the consumer takes the project before it reads the current version
// of the workflow, so an event waiting while the workflow is published follows the new version.
func defectAfterPublication(t *testing.T, p, vehicle uuid.UUID) {
	t.Helper()
	ctx := t.Context()
	waiting := openDefect(t, vehicle)
	hold, err := superA.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = hold.Rollback(context.WithoutCancel(ctx)) }()
	var holder, next int
	if err := hold.QueryRow(ctx, `select pg_backend_pid(), current_version + 1 from tasks.projects where id = $1 for update`, p).
		Scan(&holder, &next); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- reportDefect(ctx, waiting, vehicle) }()
	for blocked := false; !blocked; time.Sleep(10 * time.Millisecond) {
		if err := superA.QueryRow(ctx, `select exists (select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid)))`,
			holder).Scan(&blocked); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := hold.Exec(ctx, `insert into tasks.workflow_versions (project_id, version, statuses, transitions, published_at, published_by)
		select project_id, $2, statuses, transitions, published_at, published_by from tasks.workflow_versions
		 where project_id = $1 and version = $2 - 1`, p, next); err != nil {
		t.Fatal(err)
	}
	if _, err := hold.Exec(ctx, `update tasks.projects set current_version = $2 where id = $1`, p, next); err != nil {
		t.Fatal(err)
	}
	if err := hold.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	ids := defectTasks(t, waiting)
	if len(ids) != 1 {
		t.Fatalf("tasks of the waiting defect %v", ids)
	}
	same(t, "the version of the task made after the publication", val(card(t, "a.owner", ids[0]).WorkflowVersion), next)
}

// An event of a defect the tenant does not have (deleted, or of another tenant) is consumed without a task.
func TestDefectUnknown(t *testing.T) {
	t.Parallel()
	id := uuid.New()
	deliver(t, uuid.New(), EventDefectBlocking, map[string]any{"defectId": id, "vehicleId": ref("vehicle:a.smr2")})
	deliver(t, uuid.New(), EventDefectDecided, map[string]any{"defectId": id, "vehicleId": ref("vehicle:a.smr2"), "decision": "allow_departure"})
	if ids := defectTasks(t, id); len(ids) != 0 {
		t.Fatalf("unknown defect has tasks %v", ids)
	}
}
