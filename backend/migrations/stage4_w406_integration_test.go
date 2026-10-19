//go:build integration

package migrations_test

import (
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// tenant 0021–0022 (W4.06) на реальном сервере под runtime-ролью API: ресурс календаря с рабочим днём, бронь
// календаря с буферами и видом источника, имена видов «Данных» и состояния задания выгрузки.
func TestStage4W406Constraints(t *testing.T) {
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
		wantState := func(what string, err error, state string) {
			t.Helper()
			if got := sqlState(err); got != state {
				t.Errorf("%s: SQLSTATE %q (%v), want %s", what, got, err, state)
			}
		}
		wantOK := func(what string, err error) {
			t.Helper()
			if err != nil {
				t.Errorf("%s: %v", what, err)
			}
		}

		unit := scalar[string](t, db, `insert into org.units (kind, name, time_zone)
			values ('company', 'Салон', 'Europe/Moscow') returning id::text`)
		person := scalar[string](t, db, `insert into people.person_profiles (full_name, home_unit_id)
			values ('Анна Морозова', $1) returning id::text`, unit)
		other := scalar[string](t, db, `insert into people.person_profiles (full_name, home_unit_id)
			values ('Марина Котова', $1) returning id::text`, unit)

		// Ресурсы: помещение без подписи и рабочий день наоборот — нельзя; сотрудник — по умолчанию 08:00–20:00.
		wantState("room without a label", exec(`insert into sched.resources (kind, ref_id, home_unit_id)
			values ('room', gen_random_uuid(), $1)`, unit), "23514")
		wantState("workday backwards", exec(`insert into sched.resources (kind, ref_id, home_unit_id, label,
			workday_start, workday_end) values ('room', gen_random_uuid(), $1, 'Кабинет № 2', '20:00', '08:00')`, unit), "23514")
		wantOK("room with a label", exec(`insert into sched.resources (kind, ref_id, home_unit_id, label)
			values ('room', gen_random_uuid(), $1, 'Кабинет № 2')`, unit))
		// Возврат 1: у помещения и оборудования нет объекта-источника (ref_id null, таких строк сколько угодно); у машины и
		// сотрудника ref_id обязателен; пояс ресурса и брони — имя IANA.
		wantOK("room without a source object", exec(`insert into sched.resources (kind, home_unit_id, label)
			values ('room', $1, 'Кабинет № 3')`, unit))
		wantOK("equipment without a source object", exec(`insert into sched.resources (kind, home_unit_id, label)
			values ('equipment', $1, 'Стол с подогревом')`, unit))
		wantState("vehicle without a source object", exec(`insert into sched.resources (kind, home_unit_id)
			values ('vehicle', $1)`, unit), "23514")
		wantState("resource time zone not IANA", exec(`insert into sched.resources (kind, home_unit_id, label, time_zone)
			values ('room', $1, 'Кабинет № 4', 'Moscow time')`, unit), "23514")
		wantOK("resource time zone IANA", exec(`insert into sched.resources (kind, home_unit_id, label, time_zone)
			values ('room', $1, 'Кабинет № 5', 'America/Argentina/Buenos_Aires')`, unit))
		day := scalar[string](t, db, `insert into sched.resources (kind, ref_id, home_unit_id) values ('person', $1, $2)
			returning workday_start::text || '–' || workday_end::text`, person, unit)
		if day != "08:00:00–20:00:00" {
			t.Errorf("default workday %q", day)
		}

		booking := func(kind, source string, prep int) error {
			var src any
			module, typ := any(nil), any(nil)
			if source != "" {
				src, module, typ = source, "spa", "appointment"
			}
			return exec(`insert into sched.bookings (org_unit_id, title, source_kind, source_module, source_type, source_id,
				during, time_zone, prep_minutes, created_by) values ($1, 'Классический массаж · Мария К.', $2, $3, $4, $5,
				tstzrange('2026-10-01 07:00Z', '2026-10-01 08:00Z'), 'Europe/Moscow', $6, $7)`,
				unit, kind, module, typ, src, prep, person)
		}
		visit := "7f2b0e2a-3c1d-4b9e-8a4f-2d6c0b1a9e01"
		wantState("appointment without a source", booking("appointment", "", 0), "23514")
		wantState("break with a source", booking("break", visit, 0), "23514")
		wantState("preparation over 4 h", booking("appointment", visit, 241), "23514")
		wantOK("appointment", booking("appointment", visit, 15))
		wantState("second confirmed booking of the same visit", booking("appointment", visit, 0), "23505")
		wantOK("break", booking("break", "", 0))
		wantState("booking time zone not IANA", exec(`insert into sched.bookings (org_unit_id, title, source_kind, during,
			time_zone, created_by) values ($1, 'Перерыв', 'break', tstzrange('2026-10-01 09:00Z', '2026-10-01 10:00Z'),
			'MSK+0', $2)`, unit, person), "23514")

		// Виды «Данных»: личное имя уникально у автора и набора, общее — у набора.
		view := func(owner, vis, nm string) error {
			return exec(`insert into data.saved_views (dataset_id, name, visibility, owner_id, query, schema_version)
				values ('fleet.trips', $1, $2, $3, '{"filters": [], "sort": [], "search": "Р-208"}', '1')`, nm, vis, owner)
		}
		wantOK("personal view", view(person, "personal", "Поездки: «Р-208»"))
		wantState("personal name taken (case)", view(person, "personal", "поездки: «р-208»"), "23505")
		wantOK("same personal name of another member", view(other, "personal", "Поездки: «Р-208»"))
		wantOK("shared view", view(person, "shared", "Рейсы Север"))
		wantState("shared name taken by another member", view(other, "shared", "Рейсы Север"), "23505")
		wantState("unknown visibility", view(person, "team", "Команда"), "23514")

		// Задания выгрузки: готовое — только с файлом, сбой — с кодом, отзыв — с причиной и моментом.
		job := scalar[string](t, db, `insert into data.export_jobs (dataset_id, dataset_name, requested_by, spec, column_labels,
			schema_version, permission_version, time_zone) values ('fleet.trips', 'Поездки', $1,
			'{"select": ["trip"], "filters": [], "sort": []}', '{Рейс}', '1', '7', 'Europe/Moscow') returning id::text`, person)
		wantState("ready without a file", exec(`update data.export_jobs set state = 'ready' where id = $1`, job), "23514")
		wantState("failed without a code", exec(`update data.export_jobs set state = 'failed' where id = $1`, job), "23514")
		wantState("revoked without a reason", exec(`update data.export_jobs set state = 'revoked', revoked_at = now()
			where id = $1`, job), "23514")
		wantState("export job time zone not IANA", exec(`update data.export_jobs set time_zone = 'UTC+3' where id = $1`, job),
			"23514")
		wantState("rows over the limit", exec(`update data.export_jobs set row_count = 100001 where id = $1`, job), "23514")
		wantOK("ready", exec(`update data.export_jobs set state = 'ready', snapshot_at = now(), row_count = 1, truncated = false,
			file_name = 'Поездки-2026-10-01.csv', object_key = 'exports/x.csv', size_bytes = 120, finished_at = now(),
			expires_at = now() + interval '24 hours' where id = $1`, job))
		wantOK("revoked by the author", exec(`update data.export_jobs set state = 'revoked', revoke_reason = 'author',
			revoked_at = now(), revoked_by = requested_by, object_key = null where id = $1`, job))
	})
}
