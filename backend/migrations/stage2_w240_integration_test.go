//go:build integration

package migrations_test

import (
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// tenant 0013 (W2.40) на реальном сервере под runtime-ролью API: шесть категорий расходов, «прочее» только
// с непустым комментарием, юрлицо рейса — nullable FK на org.legal_entities.
func TestStage2W240Constraints(t *testing.T) {
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
		trip := scalar[string](t, db, `insert into fleet.trips (number, unit_id, state, driver_person_id, planned,
			cargo_weight_kg, cargo_volume_m3, cargo_length_mm, title)
			values ('Р-208', $1, 'planned', $2, tstzrange('2026-10-01 06:00Z', '2026-10-01 10:00Z'),
			        1100, 12, 3000, 'Северный маршрут') returning id::text`, unit, driver)

		// Юрлицо рейса: null допустим, чужой id — нарушение FK, юрлицо организации — принимается.
		if n := scalar[int](t, db, `select count(*) from fleet.trips where id = $1 and legal_entity_id is null`,
			trip); n != 1 {
			t.Errorf("legal_entity_id of a new trip is not null")
		}
		wantState("unknown legal entity", exec(`update fleet.trips set legal_entity_id = gen_random_uuid()
			where id = $1`, trip), "23503")
		entity := scalar[string](t, db, `insert into org.legal_entities (name, inn)
			values ('ООО «Север Логистик»', '7701234567') returning id::text`)
		mustExec("trip legal entity", `update fleet.trips set legal_entity_id = $2 where id = $1`, trip, entity)

		// Категории: шесть кодов ответа на D-12 комплекта; «прочее» — только с непустым комментарием.
		expense := `insert into fleet.expenses (trip_id, category, amount_minor, occurred_on, comment, claimed_by)
			values ($1, $2, 120000, '2026-10-01', $3, $4)`
		mustExec("tire_service", expense, trip, "tire_service", nil, driver)
		mustExec("parking", expense, trip, "parking", nil, driver)
		mustExec("other with comment", expense, trip, "other", "Ремень ГРМ", driver)
		wantState("other without comment", exec(expense, trip, "other", nil, driver), "23514")
		wantState("other with blank comment", exec(expense, trip, "other", "   ", driver), "23514")
		wantState("fine is not an expense", exec(expense, trip, "fine", "Штраф ГИБДД", driver), "23514")
	})
}

// Up → Down до 0012 → Up (W2.40): Down снимает колонку юрлица и проверку «прочее», возвращает пять категорий.
func TestStage2W240Down(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		ctx := t.Context()
		_, mig := migrated(t, c, migrations.Tenant)
		if res, err := migrations.DownTo(ctx, mig, migrations.Tenant, 12); err != nil || res.To != 12 {
			t.Fatalf("down to 12 = %+v, %v", res, err)
		}
		col := `select count(*) from information_schema.columns
			where table_schema = 'fleet' and table_name = 'trips' and column_name = 'legal_entity_id'`
		if n := scalar[int](t, mig, col); n != 0 {
			t.Error("fleet.trips.legal_entity_id survives Down")
		}
		if n := scalar[int](t, mig, `select count(*) from pg_constraint
			where conname = 'expenses_other_comment'`); n != 0 {
			t.Error("expenses_other_comment survives Down")
		}
		def := `select pg_get_constraintdef(oid) from pg_constraint where conname = 'expenses_category_check'`
		if got := scalar[string](t, mig, def); got == "" || strings.Contains(got, "tire_service") {
			t.Errorf("expenses_category_check after Down = %q, want five categories of 0002", got)
		}
		if _, err := migrations.Up(ctx, mig, migrations.Tenant); err != nil {
			t.Fatalf("up again: %v", err)
		}
		if n := scalar[int](t, mig, col); n != 1 {
			t.Error("after Up again: no fleet.trips.legal_entity_id")
		}
		if got := scalar[string](t, mig, def); !strings.Contains(got, "tire_service") {
			t.Errorf("after Up again: expenses_category_check = %q, want tire_service", got)
		}
	})
}
