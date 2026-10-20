//go:build integration

package migrations_test

import (
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// Q-W4.06-15 (W4.40): Up → помещение и оборудование без объекта-источника (ref_id null) и бронь календаря → Down до
// 0020 → у них синтетический ref_id = id, ref_id снова NOT NULL, sched.bookings нет. Up снова с такими строками 0021 не
// проходит (resources_label: подписи после Down нет — SQLSTATE 23514); это вопрос стюарда к 0021 (отчёт W4.40), здесь
// не проверяется.
func TestStage4W440CalendarDownWithData(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		ctx := t.Context()
		_, mig := migrated(t, c, migrations.Tenant)
		unit := scalar[string](t, mig, `insert into org.units (kind, name, time_zone)
			values ('company', 'Салон', 'Europe/Moscow') returning id::text`)
		room := scalar[string](t, mig, `insert into sched.resources (kind, home_unit_id, label)
			values ('room', $1, 'Кабинет № 2') returning id::text`, unit)
		table := scalar[string](t, mig, `insert into sched.resources (kind, home_unit_id, label)
			values ('equipment', $1, 'Стол с подогревом') returning id::text`, unit)
		if _, err := mig.ExecContext(ctx, `insert into sched.bookings (org_unit_id, title, source_kind, during, time_zone, created_by)
			values ($1, 'Перерыв', 'break', tstzrange('2026-10-01 10:15Z', '2026-10-01 11:00Z', '[)'), 'Europe/Moscow', gen_random_uuid())`,
			unit); err != nil {
			t.Fatal(err)
		}
		if res, err := migrations.DownTo(ctx, mig, migrations.Tenant, 20); err != nil || res.To != 20 {
			t.Fatalf("down to 20 = %+v, %v", res, err)
		}
		for _, id := range []string{room, table} {
			if n := scalar[int](t, mig, `select count(*) from sched.resources where id = $1 and ref_id = id`, id); n != 1 {
				t.Errorf("resource %s: no synthetic ref_id = id after Down", id)
			}
		}
		if got := scalar[string](t, mig, `select is_nullable from information_schema.columns
			where table_schema = 'sched' and table_name = 'resources' and column_name = 'ref_id'`); got != "NO" {
			t.Errorf("sched.resources.ref_id nullable after Down: %s", got)
		}
		if _, err := mig.ExecContext(ctx, `insert into sched.resources (kind, home_unit_id) values ('room', $1)`, unit); sqlState(err) != "23502" {
			t.Errorf("a room without ref_id after Down: %v, want 23502", err)
		}
		if n := scalar[int](t, mig, `select count(*) from information_schema.tables
			where table_schema = 'sched' and table_name = 'bookings'`); n != 0 {
			t.Error("sched.bookings survives Down")
		}
	})
}
