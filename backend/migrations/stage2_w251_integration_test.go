//go:build integration

package migrations_test

import (
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// tenant 0014 (W2.51) на реальном сервере под runtime-ролью API: индекс комплекта брони, публикации пула без
// пересечения окон водителя, снятие — с автором, псевдоним уникален; запрос — один открытый на публикацию,
// одобренный — только с временным назначением, завершённый и отозванный — с моментом завершения.
func TestStage2W251Constraints(t *testing.T) {
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

		if n := scalar[int](t, db, `select count(*) from pg_indexes
			where schemaname = 'sched' and indexname = 'reservations_bundle_idx'`); n != 1 {
			t.Error("no index sched.reservations_bundle_idx (Q-W2.02-14)")
		}

		yug := scalar[string](t, db, `insert into org.units (kind, name, time_zone)
			values ('company', 'Юг Транс', 'Europe/Moscow') returning id::text`)
		sever := scalar[string](t, db, `insert into org.units (kind, name, time_zone)
			values ('company', 'Север Логистик', 'Europe/Moscow') returning id::text`)
		driver := scalar[string](t, db, `insert into people.person_profiles (full_name, home_unit_id)
			values ('Водитель Юга', $1) returning id::text`, yug)
		manager := scalar[string](t, db, `insert into people.person_profiles (full_name, home_unit_id)
			values ('Марина Котова', $1) returning id::text`, sever)

		// Публикация: окно ограничено с двух сторон, условия до 500 символов, псевдоним уникален.
		publish := `insert into fleet.pool_publications (person_id, home_unit_id, qualifications, available,
			published_by, display_name, terms)
			values ($1, $2, '{Кат. C}', tstzrange($3::timestamptz, $4::timestamptz), $1, $5, $6) returning id::text`
		pub := scalar[string](t, db, publish, driver, yug, "2026-10-01 10:00Z", "2026-10-01 16:00Z",
			"Водитель #104", "По соглашению фирм группы")
		wantState("overlapping active publication", exec(publish, driver, yug,
			"2026-10-01 15:00Z", "2026-10-01 18:00Z", "Водитель #105", nil), "23P01")
		wantState("unbounded window", exec(`insert into fleet.pool_publications (person_id, home_unit_id, available,
			published_by) values ($1, $2, tstzrange('2026-10-02 10:00Z', null), $1)`, driver, yug), "23514")
		wantState("duplicate pool label", exec(publish, driver, yug,
			"2026-10-02 10:00Z", "2026-10-02 16:00Z", "Водитель #104", nil), "23505")
		wantState("terms longer than 500", exec(publish, driver, yug,
			"2026-10-03 10:00Z", "2026-10-03 16:00Z", "Водитель #106", strings.Repeat("a", 501)), "23514")
		wantState("withdrawn without author", exec(`update fleet.pool_publications set withdrawn_at = now()
			where id = $1`, pub), "23514")

		// Запрос: один открытый на публикацию; решение — с автором и временем; одобрение — с назначением.
		request := `insert into fleet.driver_transfers (publication_id, source_unit_id, target_unit_id, period, state,
			requested_by, reason) values ($1, $2, $3, tstzrange('2026-10-01 11:00Z', '2026-10-01 15:00Z'), 'requested',
			$4, 'Запрос на рейс Р-211') returning id::text`
		req := scalar[string](t, db, request, pub, yug, sever, manager)
		wantState("second open request", exec(request, pub, yug, sever, manager), "23505")
		wantState("rejected without decision", exec(`update fleet.driver_transfers set state = 'rejected'
			where id = $1`, req), "23514")
		wantState("approved without grant", exec(`update fleet.driver_transfers set state = 'approved',
			decided_by = $2, decided_at = now() where id = $1`, req, manager), "23514")
		mustExec("rejected", `update fleet.driver_transfers set state = 'rejected', decided_by = $2,
			decided_at = now(), decision_comment = 'Водитель нужен на своём рейсе' where id = $1`, req, manager)
		again := scalar[string](t, db, request, pub, yug, sever, manager)

		role := scalar[string](t, db, `insert into access.roles (name, kind) values ('Водитель', 'template')
			returning id::text`)
		mustExec("role version", `insert into access.role_versions (role_id, version, actions, created_by)
			values ($1, 1, '{fleet.trips.read}', $2)`, role, manager)
		grant := scalar[string](t, db, `insert into access.role_assignments (principal_kind, principal_id, role_id,
			role_version, scope_kind, valid, source, granted_by)
			values ('person', $1, $2, 1, 'self', tstzrange('2026-10-01 11:00Z', '2026-10-01 15:00Z'), 'transfer', $3)
			returning id::text`, driver, role, manager)
		mustExec("approved with grant", `update fleet.driver_transfers set state = 'approved', decided_by = $2,
			decided_at = now(), assignment_id = $3 where id = $1`, again, manager, grant)
		wantState("completed without moment", exec(`update fleet.driver_transfers set state = 'completed'
			where id = $1`, again), "23514")
		mustExec("completed", `update fleet.driver_transfers set state = 'completed',
			completed_at = '2026-10-01 15:00Z' where id = $1`, again)

		// Возврат 1: отзыв хранит автора отдельно от одобрившего (decided_by не меняется).
		wantState("revoked by without revoke", exec(`update fleet.driver_transfers set revoked_by = $2
			where id = $1`, again, manager), "23514")
		mustExec("approved again", `update fleet.driver_transfers set state = 'approved', completed_at = null
			where id = $1`, again)
		wantState("revoked without author", exec(`update fleet.driver_transfers set state = 'revoked',
			completed_at = now() where id = $1`, again), "23514")
		mustExec("revoked with author", `update fleet.driver_transfers set state = 'revoked',
			completed_at = now(), revoked_by = $2 where id = $1`, again, driver)
		if got := scalar[string](t, db, `select decided_by::text from fleet.driver_transfers where id = $1`,
			again); got != manager {
			t.Errorf("decided_by after revoke = %s, want the approver %s", got, manager)
		}

		// Возврат 1: комментарий снятия — только у снятой публикации и не длиннее 2000 символов.
		wantState("withdrawal comment of an active publication", exec(`update fleet.pool_publications
			set withdrawal_comment = 'Водитель нужен' where id = $1`, pub), "23514")
		wantState("withdrawal comment longer than 2000", exec(`update fleet.pool_publications
			set withdrawn_at = now(), withdrawn_by = $2, withdrawal_comment = $3 where id = $1`,
			pub, manager, strings.Repeat("a", 2001)), "23514")

		// Снятие с автором и комментарием; после снятия окно водителя свободно для новой публикации.
		mustExec("withdrawn", `update fleet.pool_publications set withdrawn_at = now(), withdrawn_by = $2,
			withdrawal_comment = 'Водитель нужен на своём рейсе', revision = revision + 1 where id = $1`, pub, manager)
		if _, err := db.ExecContext(ctx, publish, driver, yug, "2026-10-01 15:00Z", "2026-10-01 18:00Z",
			"Водитель #107", nil); err != nil {
			t.Errorf("publication after withdrawal: %v", err)
		}

		// Истёкшая (не снятая) публикация по-прежнему держит своё окно: новая публикация с началом в прошлом,
		// пересекающая её, — 23P01. MSW проверяет то же правило (state != withdrawn), а не только active.
		other := scalar[string](t, db, `insert into people.person_profiles (full_name, home_unit_id)
			values ('Водитель Юга 2', $1) returning id::text`, yug)
		mustExec("expired publication", publish, other, yug, "2020-01-01 08:00Z", "2020-01-01 10:00Z",
			"Водитель #120", nil)
		wantState("overlap with an expired publication", exec(publish, other, yug,
			"2020-01-01 09:00Z", "2099-01-01 10:00Z", "Водитель #121", nil), "23P01")
	})
}

// Up → Down до 0013 → Up (W2.51): Down снимает индекс комплекта брони, колонки и ограничения пула.
func TestStage2W251Down(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		ctx := t.Context()
		_, mig := migrated(t, c, migrations.Tenant)
		if res, err := migrations.DownTo(ctx, mig, migrations.Tenant, 13); err != nil || res.To != 13 {
			t.Fatalf("down to 13 = %+v, %v", res, err)
		}
		idx := `select count(*) from pg_indexes where indexname in ('reservations_bundle_idx',
			'driver_transfers_open_uq', 'pool_publications_display_name_uq')`
		if n := scalar[int](t, mig, idx); n != 0 {
			t.Errorf("%d indexes of 0014 survive Down", n)
		}
		col := `select count(*) from information_schema.columns where table_schema = 'fleet'
			and column_name in ('display_name', 'terms', 'withdrawn_by', 'withdrawal_comment', 'reason',
				'decision_comment', 'completed_at', 'revoked_by')
			and table_name in ('pool_publications', 'driver_transfers')`
		if n := scalar[int](t, mig, col); n != 0 {
			t.Errorf("%d columns of 0014 survive Down", n)
		}
		if _, err := migrations.Up(ctx, mig, migrations.Tenant); err != nil {
			t.Fatalf("up again: %v", err)
		}
		if n := scalar[int](t, mig, idx); n != 3 {
			t.Errorf("after Up again: %d indexes of 0014, want 3", n)
		}
		if n := scalar[int](t, mig, col); n != 8 {
			t.Errorf("after Up again: %d columns of 0014, want 8", n)
		}
	})
}
