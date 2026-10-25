//go:build integration

package main

// W4.24 (D-30, D-29 комплекта; критерий этапа 4 «Осмотр → ответ формы → задача менеджеру»): `worker run` on the Go seed
// of «Альта» writes a departure inspection with a blocking defect as a response of «Осмотр машины» v3 — its rule au-1
// makes the task «Проверить осмотр Р-… (выезд)» for Марина Котова in «Логистика · Север», urgent and taken by the
// defect, au-2 writes the row of «Осмотры»; the decision on the defect finishes the task. The rows of the inspection
// are written as fleet/inspections writes them, with its event.

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/migrations"
)

// relatedRef is an object of tasks.tasks.related_objects.
type relatedRef struct {
	ModuleKey  string    `json:"moduleKey"`
	EntityType string    `json:"entityType"`
	EntityID   uuid.UUID `json:"entityId"`
}

// altaID is the id of a proto of the seed of «Альта» (PD-30).
func altaID(proto string) uuid.UUID {
	return uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:t-alta:"+proto))
}

// logisticsOn enables «Логистика» in «Альта» for the test (the base seed has it off, Q-W2.90-1): a form of the module
// accepts responses only while its module is on.
func logisticsOn(t *testing.T, alta *sql.DB) {
	t.Helper()
	ctx := t.Context()
	var before sql.NullString
	err := alta.QueryRowContext(ctx, `select state from modules.installations where module_key = 'logistics'`).Scan(&before)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		t.Fatal(err)
	}
	if _, err := alta.ExecContext(ctx, `insert into modules.installations (module_key, state, manifest_version, updated_by)
		values ('logistics', 'enabled', '1.0.0', $1) on conflict (module_key) do update set state = 'enabled'`, altaID("m-owner")); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx := context.WithoutCancel(t.Context())
		if !before.Valid {
			_, _ = alta.ExecContext(ctx, `delete from modules.installations where module_key = 'logistics'`)
			return
		}
		_, _ = alta.ExecContext(ctx, `update modules.installations set state = $1 where module_key = 'logistics'`, before.String)
	})
}

// altaInspection writes a departure inspection of a new planned trip of the vehicle of the seed with a blocking defect
// in the queue: the inspection, the defect, the trip and the vehicle.
func altaInspection(t *testing.T, alta *sql.DB, number string) (uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) {
	t.Helper()
	ctx := t.Context()
	var vehicle, unit uuid.UUID
	if err := alta.QueryRowContext(ctx, `select id, unit_id from fleet.vehicles where archived_at is null order by plate limit 1`).
		Scan(&vehicle, &unit); err != nil {
		t.Fatal(err)
	}
	var checklist uuid.UUID
	if _, err := alta.ExecContext(ctx, `insert into fleet.checklist_versions (kind, version, items) values ('departure', 1,
		'[{"key":"body","label":"Кузов и стёкла осмотрены","required":true}]') on conflict do nothing`); err != nil {
		t.Fatal(err)
	}
	if err := alta.QueryRowContext(ctx, `select id from fleet.checklist_versions where kind = 'departure' and version = 1`).Scan(&checklist); err != nil {
		t.Fatal(err)
	}
	trip, inspection, defect, driver := uuid.New(), uuid.New(), uuid.New(), altaID("m-vasiliev")
	answers, err := json.Marshal(map[string]any{"checks": []map[string]string{{"key": "body", "result": "pass"}},
		"photos": []map[string]string{{"role": "front"}, {"role": "rear"}, {"role": "left"}, {"role": "right"}, {"role": "odometer"}}})
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{`insert into fleet.trips (id, number, unit_id, state, driver_person_id, planned)
			values ($1, $2, $3, 'planned', $4, tstzrange(now(), now() + interval '4 hours'))`, []any{trip, number, unit, driver}},
		{`insert into fleet.inspections (id, trip_id, vehicle_id, kind, checklist_version_id, odometer_km, fuel_level, answers, state,
			submitted_by, submitted_at) values ($1, $2, $3, 'departure', $4, 84530, 'three_quarters', $5, 'blocked', $6, now())`,
			[]any{inspection, trip, vehicle, checklist, answers, driver}},
		{`insert into fleet.defects (id, vehicle_id, inspection_id, trip_id, zone, severity, description, state, reported_by)
			values ($1, $2, $3, $4, 'Шины', 'blocking', 'Порез боковины, корд виден', 'in_review', $5)`, []any{defect, vehicle, inspection, trip, driver}},
	} {
		if _, err := alta.ExecContext(ctx, q.sql, q.args...); err != nil {
			t.Fatalf("%s: %v", q.sql, err)
		}
	}
	return inspection, defect, trip, vehicle
}

// publishOf writes an event of fleet in the outbox of «Альта», as the module of inspections does.
func publishOf(t *testing.T, api *pgxpool.Pool, typ, aggregate string, id uuid.UUID, payload map[string]any) {
	t.Helper()
	if _, err := events.Publish(t.Context(), api, events.Event{Type: typ, Aggregate: aggregate, AggregateID: id, Payload: payload}); err != nil {
		t.Fatal(err)
	}
}

// inspectionResponse is the response of «Осмотр машины» of key once the worker wrote it; it checks the object, the
// author, the version and the status.
func inspectionResponse(t *testing.T, alta *sql.DB, key string) uuid.UUID {
	t.Helper()
	eventually(t, 20*time.Second, "the response of the inspection", func() bool {
		return count(t, alta, `select count(*) from forms.responses where dedup_key = $1`, key) == 1
	})
	var (
		response, author    uuid.UUID
		number, version     int
		label, reviewStatus string
	)
	if err := alta.QueryRowContext(t.Context(), `select id, number, subject_label, author_id, version_number, review_status
		from forms.responses where dedup_key = $1 and form_id = $2 and channel = 'inspection'`, key, altaID("fm-insp")).
		Scan(&response, &number, &label, &author, &version, &reviewStatus); err != nil {
		t.Fatal(err)
	}
	if label != "Рейс Р-4247 · выезд" || author != altaID("m-vasiliev") || version != 3 || reviewStatus != "accepted" || number < 1013 {
		t.Errorf("response R-%d: %q, author %v, v%d, %s", number, label, author, version, reviewStatus)
	}
	return response
}

// responseTask is the task au-1 made for response; it checks the task of the reference taken by defect.
func responseTask(t *testing.T, alta *sql.DB, response, defect uuid.UUID) uuid.UUID {
	t.Helper()
	var (
		task, assignee, project uuid.UUID
		title, priority         string
		labeled                 bool
		related                 []byte
		refs                    []relatedRef
	)
	if err := alta.QueryRowContext(t.Context(), `select t.id, t.title, t.priority, t.assignee_id, t.project_id,
		'дефект' = any(t.labels), t.related_objects from forms.response_actions a join tasks.tasks t on t.id = a.task_id
		where a.response_id = $1 and a.kind = 'task' and a.ok`, response).Scan(&task, &title, &priority, &assignee, &project, &labeled,
		&related); err != nil {
		t.Fatalf("the task of au-1: %v", err)
	}
	if title != "Проверить осмотр Р-4247 (выезд)" || priority != "urgent" || assignee != altaID("m-kotova") ||
		project != altaID("fleet") || !labeled {
		t.Errorf("task %q %s, assignee %v, project %v, «дефект» %v", title, priority, assignee, project, labeled)
	}
	if err := json.Unmarshal(related, &refs); err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(refs, relatedRef{ModuleKey: "fleet", EntityType: "defect", EntityID: defect}) {
		t.Errorf("the task is not of the defect: %s", related)
	}
	return task
}

//nolint:paralleltest // the worker delivers every seeded tenant
func TestRunInspectionResponse(t *testing.T) {
	alta, api := superDB(t, "t_alta"), tenantPool(t, "t_alta", migrations.RoleAPI)
	logisticsOn(t, alta)
	inspection, defect, trip, vehicle := altaInspection(t, alta, "Р-4247")
	publishOf(t, api, "fleet.inspection.submitted.v1", "fleet.inspection", inspection, map[string]any{"inspectionId": inspection,
		"tripId": trip, "vehicleId": vehicle, "kind": "departure", "blocking": true})
	publishOf(t, api, "fleet.defect.blocking_reported.v1", "fleet.defect", defect, map[string]any{"defectId": defect, "tripId": trip,
		"vehicleId": vehicle})
	runWorker(t, nil)

	response := inspectionResponse(t, alta, trip.String()+":dep:rev1")
	task := responseTask(t, alta, response, defect)
	if count(t, alta, `select count(*) from forms.response_actions where response_id = $1 and kind = 'kb' and ok`, response) != 1 {
		t.Error("no row of «Осмотры» (au-2)")
	}
	if n := count(t, alta, `select count(*) from tasks.tasks where source_module = 'fleet' and source_id = $1`, defect); n != 0 {
		t.Errorf("%d tasks of the defect of their own: blocking_reported made a second task", n)
	}
	publishOf(t, api, "fleet.defect.decided.v1", "fleet.defect", defect, map[string]any{"defectId": defect, "tripId": trip,
		"vehicleId": vehicle, "decision": "confirm_out_of_service"})
	eventually(t, 20*time.Second, "the decision finishes the task", func() bool {
		return count(t, alta, `select count(*) from tasks.task_events where task_id = $1 and text like 'Решение по дефекту:%'`, task) == 1
	})
}
