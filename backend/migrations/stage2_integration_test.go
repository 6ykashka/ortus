//go:build integration

package migrations_test

import (
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// Ограничения миграций этапа 2 (W2.00, tenant 0010–0012) на реальном сервере под runtime-ролью API.
func TestStage2Constraints(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		name, _ := migrated(t, c, migrations.Tenant)
		db := c.DB(t, name, migrations.RoleAPI)
		ctx := t.Context()
		exec := func(q string, args ...any) error {
			_, err := db.ExecContext(ctx, q, args...)
			return err
		}
		mustExec := func(what, q string, args ...any) {
			t.Helper()
			if err := exec(q, args...); err != nil {
				t.Fatalf("%s: %v", what, err)
			}
		}
		wantState := func(what string, err error, state string) {
			t.Helper()
			if got := sqlState(err); got != state {
				t.Errorf("%s: SQLSTATE %q (%v), want %s", what, got, err, state)
			}
		}

		unit := scalar[string](t, db, `insert into org.units (kind, name, time_zone)
			values ('company', 'Север Логистик', 'Europe/Moscow') returning id::text`)
		driver := scalar[string](t, db, `insert into people.person_profiles (full_name, home_unit_id)
			values ('Илья Васильев', $1) returning id::text`, unit)
		manager := scalar[string](t, db, `insert into people.person_profiles (full_name, home_unit_id)
			values ('Марина Котова', $1) returning id::text`, unit)
		// 0012: машина с названием, складом и отметкой; рейс с заголовком, грузом и расстоянием.
		vehicle := scalar[string](t, db, `insert into fleet.vehicles (unit_id, plate, body_type, payload_kg,
			volume_m3, cargo_length_mm, odometer_km, display_name, depot, service_note)
			values ($1, 'А 412 МР 77', 'tent', 1500, 16, 4200, 84370, 'ГАЗель Next', 'Склад № 1', null)
			returning id::text`, unit)
		trip := scalar[string](t, db, `insert into fleet.trips (number, unit_id, state, driver_person_id, planned,
			cargo_weight_kg, cargo_volume_m3, cargo_length_mm, title, cargo_description, distance_km)
			values ('Р-208', $1, 'planned', $2, tstzrange('2026-10-01 06:00Z', '2026-10-01 10:00Z'),
			        1100, 12, 3000, 'Северный маршрут', 'Сухой груз · 14 паллет-мест', 46)
			returning id::text`, unit, driver)
		checklist := scalar[string](t, db, `insert into fleet.checklist_versions (kind, version, items)
			values ('return', 1, '[]') returning id::text`)
		dep := scalar[string](t, db, `insert into fleet.checklist_versions (kind, version, items)
			values ('departure', 1, '[]') returning id::text`)
		insp := scalar[string](t, db, `insert into fleet.inspections (trip_id, vehicle_id, kind, checklist_version_id,
			odometer_km, fuel_level, answers, state, submitted_by)
			values ($1, $2, 'departure', $3, 84500, 'half', '{}', 'submitted', $4) returning id::text`,
			trip, vehicle, dep, driver)

		// 0012: «Сдача машины» (returning) — только после отметки завершения маршрута.
		toReturning := `update fleet.trips set state = 'returning', vehicle_id = $2, started_at = now(),
			route_completed_at = $3 where id = $1`
		wantState("returning without route_completed_at", exec(toReturning, trip, vehicle, nil), "23514")
		mustExec("returning", toReturning, trip, vehicle, "2026-10-01T07:30:00Z")

		// 0010: в очереди — только блокирующие дефекты без решения; решение несёт автора, время и своё состояние.
		defect := scalar[string](t, db, `insert into fleet.defects (vehicle_id, inspection_id, trip_id, zone, severity,
			description, state, reported_by) values ($1, $2, $3, 'Стёкла', 'blocking', 'Скол', 'in_review', $4)
			returning id::text`, vehicle, insp, trip, driver)
		wantState("minor defect in review", exec(`insert into fleet.defects (vehicle_id, inspection_id, zone, severity,
			description, state) values ($1, $2, 'Кузов', 'minor', 'Царапина', 'in_review')`, vehicle, insp), "23514")
		wantState("decision while in review", exec(`update fleet.defects set decision = 'allow_departure',
			resolved_by = $2, resolved_at = now() where id = $1`, defect, manager), "23514")
		wantState("decision without author", exec(`update fleet.defects set state = 'resolved',
			decision = 'allow_departure' where id = $1`, defect), "23514")
		wantState("decision of another state", exec(`update fleet.defects set state = 'resolved',
			decision = 'confirm_out_of_service', resolved_by = $2, resolved_at = now() where id = $1`, defect, manager),
			"23514")
		wantState("unknown decision", exec(`update fleet.defects set state = 'resolved', decision = 'allow',
			resolved_by = $2, resolved_at = now() where id = $1`, defect, manager), "23514")
		mustExec("allow departure", `update fleet.defects set state = 'resolved', decision = 'allow_departure',
			decision_comment = 'Скол вне зоны обзора', resolved_by = $2, resolved_at = now(), revision = revision + 1
			where id = $1`, defect, manager)
		// Дефект, устранённый ремонтом, решения менеджера не требует.
		mustExec("resolved by repair", `insert into fleet.defects (vehicle_id, zone, severity, description, state)
			values ($1, 'Салон', 'minor', 'Порван чехол', 'resolved')`, vehicle)
		if n := scalar[int](t, db, `select count(*) from fleet.defects where state = 'in_review'`); n != 0 {
			t.Errorf("queue after decision: %d defects in review, want 0", n)
		}

		// 0011: повторная сдача после доработки — следующая попытка осмотра того же вида.
		ret := `insert into fleet.inspections (trip_id, vehicle_id, kind, checklist_version_id, odometer_km,
			fuel_level, answers, state, submitted_by, attempt, comment)
			values ($1, $2, 'return', $3, 84560, 'half', '{}', 'submitted', $4, $5, 'Ключи у охраны')`
		mustExec("return attempt 1", ret, trip, vehicle, checklist, driver, 1)
		wantState("same return attempt", exec(ret, trip, vehicle, checklist, driver, 1), "23505")
		mustExec("return attempt 2", ret, trip, vehicle, checklist, driver, 2)
		wantState("attempt 0", exec(ret, trip, vehicle, checklist, driver, 0), "23514")

		// 0011: доработка — непустой комментарий и хотя бы один раздел; разделы — только у доработки.
		review := `insert into fleet.trip_reviews (trip_id, attempt, decision, comment, steps, reviewed_by)
			values ($1, $2, $3, $4, $5::text[], $6)`
		wantState("rework without steps", exec(review, trip, 1, "rework", "Переснимите фото", "{}", manager), "23514")
		wantState("rework with blank comment", exec(review, trip, 1, "rework", "  ", "{photos}", manager), "23514")
		wantState("approve with steps", exec(review, trip, 1, "approve", nil, "{photos}", manager), "23514")
		wantState("unknown step", exec(review, trip, 1, "rework", "Пробег", "{odo}", manager), "23514")
		wantState("unknown decision", exec(review, trip, 1, "accept", nil, "{}", manager), "23514")
		mustExec("rework", review, trip, 1, "rework", "Переснимите фото слева", "{photos,odometer}", manager)
		wantState("same review attempt", exec(review, trip, 1, "approve", nil, "{}", manager), "23505")
		mustExec("approve", review, trip, 2, "approve", nil, "{}", manager)
	})
}

// Up → Down до 0007 → Up (W2.00): Down снимает ровно объекты 0010–0012 — таблицу приёмок, попытку осмотра
// (уникальность (trip_id, kind) возвращается), поля дефекта, плана рейса и машины.
func TestStage2Down(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		ctx := t.Context()
		_, mig := migrated(t, c, migrations.Tenant)
		if res, err := migrations.DownTo(ctx, mig, migrations.Tenant, 7); err != nil || res.To != 7 {
			t.Fatalf("down to 7 = %+v, %v", res, err)
		}
		if n := scalar[int](t, mig, `select count(*) from information_schema.tables
			where table_schema = 'fleet' and table_name = 'trip_reviews'`); n != 0 {
			t.Error("fleet.trip_reviews survives Down")
		}
		cols := `select count(*) from information_schema.columns where table_schema = 'fleet'
			and (table_name, column_name) in (('defects','decision'), ('defects','trip_id'), ('inspections','attempt'),
			('trips','title'), ('trips','route_completed_at'), ('vehicles','display_name'), ('vehicles','depot'))`
		if n := scalar[int](t, mig, cols); n != 0 {
			t.Errorf("%d columns of 0010–0012 survive Down", n)
		}
		if n := scalar[int](t, mig, `select count(*) from pg_constraint
			where conname = 'inspections_trip_id_kind_key'`); n != 1 {
			t.Error("unique (trip_id, kind) of 0002 is not restored by Down")
		}
		if _, err := migrations.Up(ctx, mig, migrations.Tenant); err != nil {
			t.Fatalf("up again: %v", err)
		}
		if n := scalar[int](t, mig, cols); n != 7 {
			t.Errorf("after Up again: %d of 7 columns", n)
		}
	})
}
