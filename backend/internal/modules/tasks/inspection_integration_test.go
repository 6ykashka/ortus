//go:build integration

package tasks

import (
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: clock of the suites
)

// W4.24 (D-29 комплекта: «дефект → задача вместо очереди S2-17»): the check of the blocking defect of an inspection is
// one task — the task of the response of the inspection (the rule «задача» of «Осмотр машины») or, without one, the task
// of the defect of W4.11. The rows of the inspection are written as fleet/inspections writes them; the vehicle is of
// Москва-2, where no other test has a project (the task of a defect goes to the project of the nearest area).

// inspVehicle is the vehicle of the inspections of the tests (Москва-2).
func inspVehicle(t *testing.T) uuid.UUID {
	t.Helper()
	id := uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:w424:tasks:vehicle"))
	_, err := superA.Exec(t.Context(), `insert into fleet.vehicles (id, unit_id, plate, body_type, payload_kg, volume_m3,
		cargo_length_mm, display_name) values ($1, $2, 'В 424 ОС 77', 'van', 1500, 12, 3200, 'ГАЗель Next') on conflict do nothing`,
		id, unit("msk2"))
	require.NoError(t, err)
	return id
}

// inspDefect is a departure inspection of a new trip of Москва-2 with one blocking defect of state (in_review — in the
// queue): the inspection, the defect and the trip.
func inspDefect(t *testing.T, number, zone, description, state string) (uuid.UUID, uuid.UUID, uuid.UUID) {
	t.Helper()
	ctx, now := t.Context(), harness.Now()
	checklist := uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:w424:tasks:checklist"))
	_, err := superA.Exec(ctx, `insert into fleet.checklist_versions (id, kind, version, items) values ($1, 'departure', 424,
		'[{"key":"body","label":"Кузов и стёкла осмотрены","required":true}]') on conflict do nothing`, checklist)
	require.NoError(t, err)
	trip, inspection, defect := uuid.New(), uuid.New(), uuid.New()
	_, err = superA.Exec(ctx, `insert into fleet.trips (id, number, unit_id, state, planned)
		values ($1, $2, $3, 'planned', tstzrange($4::timestamptz, $5::timestamptz))`, trip, number, unit("msk2"), now, now.Add(4*time.Hour))
	require.NoError(t, err)
	_, err = superA.Exec(ctx, `insert into fleet.inspections (id, trip_id, vehicle_id, kind, checklist_version_id, odometer_km,
		fuel_level, answers, state, submitted_by, submitted_at) values ($1, $2, $3, 'departure', $4, 84530, 'half', '{}', 'blocked', $5, $6)`,
		inspection, trip, inspVehicle(t), checklist, person("a.driver-msk1"), now)
	require.NoError(t, err)
	var decision, by, at any // a defect in the queue has no decision
	if state == "resolved" {
		decision, by, at = "allow_departure", person("a.owner"), now
	}
	_, err = superA.Exec(ctx, `insert into fleet.defects (id, vehicle_id, inspection_id, trip_id, zone, severity, description, state,
		reported_by, created_at, decision, resolved_by, resolved_at) values ($1, $2, $3, $4, $5, 'blocking', $6, $7, $8, $9, $10, $11, $12)`,
		defect, inspVehicle(t), inspection, trip, zone, description, state, person("a.driver-msk1"), now, decision, by, at)
	require.NoError(t, err)
	return inspection, defect, trip
}

// inspectionTask is the task of the response of an inspection made by the port of the forms (urgent, the checklist and
// the trip of the reference) in project p.
func inspectionTask(t *testing.T, p, trip uuid.UUID) FormTaskResult {
	t.Helper()
	var res FormTaskResult
	inTenantTx(t, func(tx pgx.Tx) {
		res = must(service().CreateFormTask(t.Context(), tx, ref("tenant:a"), FormTask{Project: p, Author: person("a.owner"),
			AuthorOwner: true, AuthorName: "Владелец", Assignee: person("a.owner"), Title: "Проверить осмотр Р-4242 (выезд)",
			Description: "Ответ R-0001 формы «Осмотр машины»", Response: uuid.New(), Origin: "Ответ R-0001 формы «Осмотр машины»",
			Priority: prioUrgent, Checklist: []string{"Сверить фото с прошлым осмотром", "Проверить пробег"},
			Related: []tasksapi.ObjectRef{{ModuleKey: "fleet", EntityType: "trip", EntityId: trip}}})).of(t)
	})
	require.Empty(t, res.Refused)
	return res
}

// inspectionDefects runs the port of the blocking defect of inspection in a transaction of tenant A.
func inspectionDefects(t *testing.T, inspection uuid.UUID, task *uuid.UUID) {
	t.Helper()
	inTenantTx(t, func(tx pgx.Tx) {
		require.NoError(t, service().InspectionDefects(t.Context(), tx, ref("tenant:a"), inspection, task))
	})
}

// The task of the response of an inspection carries what recordInspection gives it (api.js:76): the priority, the
// checklist and the trip next to the response.
func TestFormTaskOfInspection(t *testing.T) {
	t.Parallel()
	p := fresh(t, "ИНЗ", nil, tasksapi.Limited, tasksapi.Approval) // the organization: the task of a defect of Москва-2 goes to «ИНС»
	_, _, trip := inspDefect(t, "Р-4240", "Кузов", "Скол", "open")
	res := inspectionTask(t, p.Id, trip)
	x := card(t, "a.owner", res.ID)
	assert.Equal(t, []any{"Проверить осмотр Р-4242 (выезд)", tasksapi.Urgent}, []any{x.Title, val(x.Priority)})
	assert.Equal(t, []tasksapi.TaskChecklistItem{{Id: "ch-1", Text: "Сверить фото с прошлым осмотром"}, {Id: "ch-2", Text: "Проверить пробег"}},
		val(x.Checklist))
	require.Len(t, x.RelatedObjects, 2)
	assert.Equal(t, tasksapi.ObjectRef{ModuleKey: "fleet", EntityType: "trip", EntityId: trip}, x.RelatedObjects[1])
}

// The blocking defect of an inspection takes the task of its response (one task, as in the reference): urgent, the
// label «дефект», the vehicle and the defect among the related objects, the line of the history; the assignment and
// the decision of the defect (W4.11) follow it by the defect. Without the task of a response — the task of the defect
// of W4.11; a task done or of another defect is not taken; a decided defect gets none; a second call changes nothing.
func TestInspectionDefectTask(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	msk2 := unit("msk2")
	p := fresh(t, "ИНС", &msk2, tasksapi.Limited, tasksapi.Approval)
	vehicle := inspVehicle(t)

	inspection, defect, trip := inspDefect(t, "Р-4242", "Шины", "Порез боковины", "in_review")
	res := inspectionTask(t, p.Id, trip)
	inspectionDefects(t, inspection, &res.ID)
	x := card(t, "a.owner", res.ID)
	same(t, "the task of the response is the task of the defect", []any{val(x.Priority), val(x.Labels), x.Status},
		[]any{tasksapi.Urgent, []string{"дефект"}, "s1"})
	assert.Subset(t, x.RelatedObjects, []tasksapi.ObjectRef{{ModuleKey: "fleet", EntityType: "vehicle", EntityId: vehicle},
		{ModuleKey: "fleet", EntityType: "defect", EntityId: defect}})
	assert.Contains(t, history(t, "a.owner", x.Id), "Система: Связана с дефектом осмотра: Шины — Порез боковины")
	assert.Empty(t, defectTasks(t, defect), "no task of its own")
	inspectionDefects(t, inspection, &res.ID)
	same(t, "a second call", card(t, "a.owner", res.ID).Revision, x.Revision)

	due := harness.Now().Add(24 * time.Hour)
	deliver(t, uuid.New(), EventDefectAssigned, map[string]any{"defectId": defect, "vehicleId": vehicle, "tripId": trip,
		"assigneeMemberId": person("a.region-msk"), "dueAt": due})
	x = card(t, "a.owner", res.ID)
	same(t, "assigned by the defect", []any{val(x.AssigneeMemberId), val(x.DueAt).Equal(due)}, []any{person("a.region-msk"), true})
	deliver(t, uuid.New(), EventDefectDecided, map[string]any{"defectId": defect, "vehicleId": vehicle, "tripId": trip,
		"decision": "confirm_out_of_service"})
	x = card(t, "a.owner", res.ID)
	same(t, "decided", x.Status, "s4")
	same(t, "history", history(t, "a.owner", x.Id)[0],
		"Процесс: Решение по дефекту: Новая → Готово. Неисправность подтверждена — машина недоступна")

	own, ownDefect, _ := inspDefect(t, "Р-4243", "Зеркала", "Трещина правого зеркала", "in_review")
	inspectionDefects(t, own, nil)
	ids := defectTasks(t, ownDefect)
	require.Len(t, ids, 1, "no task of a response — the task of the defect")
	same(t, "the task of the defect", []any{card(t, "a.owner", ids[0]).ProjectId, card(t, "a.owner", ids[0]).Title},
		[]any{p.Id, "Проверить дефект: ГАЗель Next В 424 ОС 77 — Зеркала"})

	done, doneDefect, doneTrip := inspDefect(t, "Р-4244", "Фары", "Не горит ближний свет", "in_review")
	finished := inspectionTask(t, p.Id, doneTrip)
	_, err := superA.Exec(ctx, `update tasks.tasks set status_id = 's4' where id = $1`, finished.ID)
	require.NoError(t, err)
	inspectionDefects(t, done, &finished.ID)
	assert.Len(t, defectTasks(t, doneDefect), 1, "a task done is not taken")
	assert.Empty(t, val(card(t, "a.owner", finished.ID).Labels))

	other, otherDefect, _ := inspDefect(t, "Р-4245", "Стёкла", "Скол на лобовом", "in_review")
	inspectionDefects(t, other, &res.ID)
	assert.Len(t, defectTasks(t, otherDefect), 1, "the task of another defect is not taken")

	late, lateDefect, lateTrip := inspDefect(t, "Р-4246", "Кузов", "Вмятина", "resolved")
	untouched := inspectionTask(t, p.Id, lateTrip)
	inspectionDefects(t, late, &untouched.ID)
	assert.Empty(t, defectTasks(t, lateDefect), "a decided defect")
	assert.Empty(t, val(card(t, "a.owner", untouched.ID).Labels))
	assert.False(t, slices.ContainsFunc(card(t, "a.owner", untouched.ID).RelatedObjects, func(r tasksapi.ObjectRef) bool {
		return r.EntityType == "defect"
	}))
}
