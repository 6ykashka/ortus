//go:build integration

package migrations_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// clusters — один сервер на образ migratetest.Images() (PostgreSQL 17.11, D-04; W2.49 — без 16.4) на весь пакет.
var clusters []*migratetest.Cluster

func TestMain(m *testing.M) {
	cs, stop, err := migratetest.StartAll(context.Background())
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	clusters = cs
	code := m.Run()
	stop()
	os.Exit(code)
}

// eachCluster runs f as a parallel subtest per PostgreSQL image.
func eachCluster(t *testing.T, f func(t *testing.T, c *migratetest.Cluster)) {
	t.Helper()
	for _, c := range clusters {
		t.Run(imageName(c.Image), func(t *testing.T) {
			t.Parallel()
			f(t, c)
		})
	}
}

func imageName(img string) string {
	name, _, _ := strings.Cut(img, "@")
	return name
}

func sqlState(err error) string {
	if pgErr, ok := errors.AsType[*pgconn.PgError](err); ok {
		return pgErr.Code
	}
	return ""
}

func scalar[T any](t *testing.T, db *sql.DB, q string, args ...any) T {
	t.Helper()
	var v T
	if err := db.QueryRowContext(t.Context(), q, args...).Scan(&v); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
	return v
}

// migrated returns a fresh database of kind k migrated to the latest version by ortus_migrator.
func migrated(t *testing.T, c *migratetest.Cluster, k migrations.Kind) (string, *sql.DB) {
	t.Helper()
	name := c.NewDatabase(t, string(k))
	db := c.DB(t, name, migrations.RoleMigrator)
	if _, err := migrations.Up(t.Context(), db, k); err != nil {
		t.Fatalf("up %s: %v", k, err)
	}
	return name, db
}

// Роли из 14-engineering.md:81 — повторный вызов не пересоздаёт роли.
func TestRolesIdempotent(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		super := c.DB(t, "postgres", migratetest.Super)
		oids := func() string {
			return scalar[string](t, super, `select string_agg(rolname || ':' || oid::text, ',' order by rolname)
				from pg_roles where rolname like 'ortus\_%'`)
		}
		before := oids()
		if err := migrations.EnsureRoles(t.Context(), super, migratetest.Passwords); err != nil {
			t.Fatalf("EnsureRoles again: %v", err)
		}
		if after := oids(); after != before {
			t.Fatalf("roles recreated: %s → %s", before, after)
		}
		type attrs struct{ super, createdb, createrole, login bool }
		want := map[string]attrs{
			migrations.RoleMigrator:    {login: true},
			migrations.RoleAPI:         {login: true},
			migrations.RoleWorker:      {login: true},
			migrations.RoleProvisioner: {login: true, createdb: true},
		}
		for role, w := range want {
			var got attrs
			err := super.QueryRowContext(t.Context(),
				`select rolsuper, rolcreatedb, rolcreaterole, rolcanlogin from pg_roles where rolname = $1`, role).
				Scan(&got.super, &got.createdb, &got.createrole, &got.login)
			if err != nil {
				t.Fatalf("%s: %v", role, err)
			}
			if got != w {
				t.Errorf("%s: %+v, want %+v", role, got, w)
			}
		}
	})
}

// Параллельные `migrate roles ensure` (несколько агентов, CI) не падают на «tuple concurrently updated».
func TestRolesConcurrent(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		const n = 6
		errs := make(chan error, n)
		for range n {
			go func() {
				super, err := sql.Open("pgx", c.URL("postgres", migratetest.Super))
				if err != nil {
					errs <- err
					return
				}
				defer super.Close()
				errs <- migrations.EnsureRoles(context.Background(), super, migratetest.Passwords)
			}()
		}
		for range n {
			if err := <-errs; err != nil {
				t.Errorf("concurrent EnsureRoles: %v", err)
			}
		}
	})
}

// control: Up → Down → Up даёт ту же схему; контрольные числа v0.2 и этапа 1 (W1.00: control 0005 —
// таблица idempotency_keys; W1.03: control 0006 — auth_sessions, auth_login_states; W4.07: control 0007 —
// tenant_usage_daily, 0008 — branding_assets; W4.05: control 0009 — public_form_links). Версия — последняя
// выданная стюардом (PD-59).
func TestControlUpDownUp(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		_, db := migrated(t, c, migrations.Control)
		latest := migrations.Latest(migrations.Control)
		if v, err := migrations.Version(t.Context(), db, migrations.Control); err != nil || v != latest {
			t.Fatalf("version = %d, %v; want %d", v, err, latest)
		}
		tables := scalar[int](t, db, `select count(*) from information_schema.tables
			where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'goose_db_version'`)
		views := scalar[int](t, db, `select count(*) from information_schema.views where table_schema = 'public'`)
		enums := scalar[int](t, db, `select count(*) from pg_type where typtype = 'e'`)
		if tables != 22 || views != 2 || enums != 2 {
			t.Errorf("tables=%d views=%d enums=%d; want 22, 2, 2", tables, views, enums)
		}
		s1 := migratetest.Snapshot(t, db)
		if !strings.Contains(s1, "extension btree_gist") {
			t.Error("btree_gist missing after up")
		}

		res, err := migrations.DownTo(t.Context(), db, migrations.Control, 0)
		if err != nil || res != (migrations.Result{From: latest, To: 0}) {
			t.Fatalf("down = %+v, %v", res, err)
		}
		if s0 := migratetest.Snapshot(t, db); s0 != "schema public\n" {
			t.Fatalf("after down to 0 schema is not empty:\n%s", s0)
		}

		if _, err := migrations.Up(t.Context(), db, migrations.Control); err != nil {
			t.Fatal(err)
		}
		if s2 := migratetest.Snapshot(t, db); s2 != s1 {
			t.Fatalf("snapshot after up/down/up differs:\n--- first\n%s\n--- second\n%s", s1, s2)
		}
	})
}

// tenant: 36 таблиц в 11 схемах v0.2 (10-data-model.md:9) + этап 1 (W0.08, 0003–0006): схема notify и
// 4 таблицы — 40 таблиц в 12 схемах; Up → Down → Up даёт ту же схему.
func TestTenantUpDownUp(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		_, db := migrated(t, c, migrations.Tenant)
		latest := migrations.Latest(migrations.Tenant)
		if v, err := migrations.Version(t.Context(), db, migrations.Tenant); err != nil || v != latest {
			t.Fatalf("version = %d, %v; want %d", v, err, latest)
		}
		schemas := scalar[int](t, db, `select count(distinct table_schema) from information_schema.tables
			where table_schema not in ('public','pg_catalog','information_schema')`)
		tables := scalar[int](t, db, `select count(*) from information_schema.tables
			where table_schema not in ('public','pg_catalog','information_schema') and table_type = 'BASE TABLE'`)
		// 45 = 40 таблиц этапов 0–1 + fleet.trip_reviews (W2.00, tenant 0011) + fleet.expense_categories (W2.52,
		// tenant 0015) + fleet.vehicle_assignments, vehicle_imports, vehicle_import_rows (W2.52, tenant 0016); 48 и 13 схем —
		// + sched.bookings (W4.06, tenant 0021) и схема data с data.saved_views, data.export_jobs (W4.06, tenant 0022);
		// 61 и 14 схем — + схема kb «Базы знаний», 13 таблиц (W4.04, tenant 0024); 71 и 15 — + схема tasks с 10
		// таблицами «Задач и проектов» (W4.03, tenant 0025); 79 и 16 — + схема forms с 8 таблицами «Форм и опросов» (W4.05,
		// tenant 0026); 105 и 19 — + схемы cash (13 таблиц), inventory (8) и spa (5) этапа 5 (W5.00, tenant 0040–0044).
		if schemas != 19 || tables != 105 {
			t.Errorf("schemas=%d tables=%d; want 19, 105", schemas, tables)
		}
		s1 := migratetest.Snapshot(t, db)

		// По одной миграции вниз: 0002 снимает fleet и finance, 0001 — всё остальное.
		if res, err := migrations.DownTo(t.Context(), db, migrations.Tenant, 1); err != nil || res.To != 1 {
			t.Fatalf("down to 1 = %+v, %v", res, err)
		}
		if n := scalar[int](t, db, `select count(*) from pg_namespace where nspname in ('fleet','finance')`); n != 0 {
			t.Fatalf("fleet/finance still exist after down to 1")
		}
		if _, err := migrations.DownTo(t.Context(), db, migrations.Tenant, 0); err != nil {
			t.Fatal(err)
		}
		if s0 := migratetest.Snapshot(t, db); s0 != "schema public\n" {
			t.Fatalf("after down to 0 schema is not empty:\n%s", s0)
		}

		if _, err := migrations.Up(t.Context(), db, migrations.Tenant); err != nil {
			t.Fatal(err)
		}
		if s2 := migratetest.Snapshot(t, db); s2 != s1 {
			t.Fatalf("snapshot after up/down/up differs:\n--- first\n%s\n--- second\n%s", s1, s2)
		}
	})
}

// «У API нет DDL» (14-engineering.md:81): runtime-роль — только DML, goose_db_version — только чтение.
func TestAPIRoleHasNoDDL(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		name, _ := migrated(t, c, migrations.Tenant)
		api := c.DB(t, name, migrations.RoleAPI)
		for _, ddl := range []string{
			`create table fleet.x (id int)`,
			`create schema x`,
			`create extension pg_trgm`,
			`alter table fleet.vehicles add column y int`,
			`drop table fleet.defects`,
			`insert into goose_db_version (version_id, is_applied) values (99, true)`,
		} {
			_, err := api.ExecContext(t.Context(), ddl)
			if got := sqlState(err); got != "42501" {
				t.Errorf("%s: SQLSTATE %q (%v), want 42501", ddl, got, err)
			}
		}
		if _, err := api.ExecContext(t.Context(),
			`insert into org.units (kind, name, time_zone) values ('region', 'Москва', 'Europe/Moscow')`); err != nil {
			t.Errorf("DML as %s: %v", migrations.RoleAPI, err)
		}
		if n := scalar[int](t, api, `select count(*) from goose_db_version`); n == 0 {
			t.Error("goose_db_version is not readable by runtime role")
		}
	})
}

// «Неизменяемые записи … только INSERT» (10-data-model.md:38): runtime-роли не меняют и не удаляют аудит,
// версии ролей, чек-листов и форм, движения квоты; outbox меняет только worker (публикация), API — только пишет.
func TestAppendOnlyForRuntimeRoles(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		tenant, _ := migrated(t, c, migrations.Tenant)
		control, _ := migrated(t, c, migrations.Control)
		type grant struct {
			table string
			roles []string
			privs map[string]bool
		}
		runtime := []string{migrations.RoleAPI, migrations.RoleWorker}
		appendOnly := map[string]bool{"SELECT": true, "INSERT": true, "UPDATE": false, "DELETE": false, "TRUNCATE": false}
		writable := map[string]bool{"SELECT": true, "INSERT": true, "UPDATE": true, "DELETE": true, "TRUNCATE": false}
		for db, grants := range map[string][]grant{
			tenant: {
				{"audit.events", runtime, appendOnly},
				{"access.role_versions", runtime, appendOnly},
				{"fleet.checklist_versions", runtime, appendOnly},
				{"forms.versions", runtime, appendOnly},  // W4.05: опубликованная версия формы неизменяема
				{"cash.operations", runtime, appendOnly}, // W5.00: журнал кассы неизменяем, исправление — сторно
				{"cash.operation_links", runtime, appendOnly},
				{"cash.shift_close_attempts", runtime, appendOnly}, // попытка закрытия не стирается (Q-W4.00-cash-4)
				{"cash.shift_reviews", runtime, appendOnly},
				{"inventory.movements", runtime, appendOnly},
				{"inventory.movement_lines", runtime, appendOnly},
				{"spa.service_revisions", runtime, appendOnly},
				{"files.quota_ledger", runtime, appendOnly},
				{"outbox.events", []string{migrations.RoleAPI}, appendOnly},
				{"outbox.events", []string{migrations.RoleWorker}, writable},
				{"org.units", runtime, writable},
			},
			control: {
				{"platform_audit", runtime, appendOnly},
				{"tenants", runtime, writable},
			},
		} {
			super := c.DB(t, db, migratetest.Super)
			for _, g := range grants {
				for _, role := range g.roles {
					for priv, want := range g.privs {
						if got := scalar[bool](t, super, `select has_table_privilege($1, $2, $3)`, role, g.table, priv); got != want {
							t.Errorf("%s %s on %s = %t, want %t", role, priv, g.table, got, want)
						}
					}
				}
			}
		}
		api := c.DB(t, tenant, migrations.RoleAPI)
		if _, err := api.ExecContext(t.Context(), `insert into audit.events (actor_kind, action, target_type, result, request_id)
			values ('service', 'test.append', 'test', 'ok', 'req-1')`); err != nil {
			t.Errorf("insert audit.events as %s: %v", migrations.RoleAPI, err)
		}
		_, err := api.ExecContext(t.Context(), `update audit.events set reason = 'edited'`)
		if got := sqlState(err); got != "42501" {
			t.Errorf("update audit.events as %s: SQLSTATE %q (%v), want 42501", migrations.RoleAPI, got, err)
		}
	})
}

// CONNECT к базам Ортус — только у ролей с доступом к данным: PUBLIC его теряет, ortus_provisioner в W0.06 тоже
// (явный грант — W1.02, решение в отчёте W0.06).
func TestDatabaseConnectPrivileges(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		for _, k := range []migrations.Kind{migrations.Control, migrations.Tenant} {
			name, _ := migrated(t, c, k)
			super := c.DB(t, name, migratetest.Super)
			for role, want := range map[string]bool{
				"public":                   false,
				migrations.RoleProvisioner: false,
				migrations.RoleAPI:         true,
				migrations.RoleWorker:      true,
				migrations.RoleMigrator:    true,
			} {
				if got := scalar[bool](t, super, `select has_database_privilege($1, current_database(), 'CONNECT')`, role); got != want {
					t.Errorf("%s: CONNECT for %s = %t, want %t", k, role, got, want)
				}
			}
		}
	})
}

// Миграции применяет только ortus_migrator (control_0001_init.sql:4).
func TestUpRequiresMigrator(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		name := c.NewDatabase(t, "notmig")
		for _, role := range []string{migrations.RoleAPI, migratetest.Super} {
			db := c.DB(t, name, role)
			if _, err := migrations.Up(t.Context(), db, migrations.Tenant); !errors.Is(err, migrations.ErrNotMigrator) {
				t.Errorf("Up as %s: %v, want ErrNotMigrator", role, err)
			}
		}
		mig := c.DB(t, name, migrations.RoleMigrator)
		if v, err := migrations.Version(t.Context(), mig, migrations.Tenant); err != nil || v != 0 {
			t.Errorf("version after refused runs = %d, %v; want 0", v, err)
		}
	})
}

// Повторный Up — без изменений; UpTo промежуточной версии.
func TestUpIdempotentAndUpTo(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		name := c.NewDatabase(t, "upto")
		db := c.DB(t, name, migrations.RoleMigrator)
		if res, err := migrations.UpTo(t.Context(), db, migrations.Control, 2); err != nil || res != (migrations.Result{From: 0, To: 2}) {
			t.Fatalf("UpTo 2 = %+v, %v", res, err)
		}
		latest := migrations.Latest(migrations.Control)
		if res, err := migrations.Up(t.Context(), db, migrations.Control); err != nil || res != (migrations.Result{From: 2, To: latest}) {
			t.Fatalf("Up = %+v, %v", res, err)
		}
		if res, err := migrations.Up(t.Context(), db, migrations.Control); err != nil || res != (migrations.Result{From: latest, To: latest}) {
			t.Fatalf("second Up = %+v, %v", res, err)
		}
	})
}

// Смоук ограничений из 10-data-model.md «Проверка 01.10.2026» на реальном сервере.
func TestTenantConstraintsSmoke(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		name, _ := migrated(t, c, migrations.Tenant)
		db := c.DB(t, name, migrations.RoleAPI)
		ctx := t.Context()
		var unit, res string
		if err := db.QueryRowContext(ctx, `insert into org.units (kind, name, time_zone)
			values ('company', 'Север Логистик', 'Europe/Moscow') returning id`).Scan(&unit); err != nil {
			t.Fatal(err)
		}
		if err := db.QueryRowContext(ctx, `insert into sched.resources (kind, ref_id, home_unit_id)
			values ('vehicle', gen_random_uuid(), $1) returning id`, unit).Scan(&res); err != nil {
			t.Fatal(err)
		}
		book := func(from, to, state string) error {
			_, err := db.ExecContext(ctx, `insert into sched.reservations
				(resource_id, bundle_id, during, occupied, state, hold_expires_at, source_type, source_id, created_by)
				values ($1, gen_random_uuid(), tstzrange($2::timestamptz, $3::timestamptz), tstzrange($2::timestamptz, $3::timestamptz),
				        $4, case when $4 = 'hold' then now() + interval '15 minutes' end, 'fleet.trip', gen_random_uuid(), gen_random_uuid())`,
				res, from, to, state)
			return err
		}
		if err := book("2026-10-01 10:00+03", "2026-10-01 12:00+03", "confirmed"); err != nil {
			t.Fatal(err)
		}
		err := book("2026-10-01 11:00+03", "2026-10-01 13:00+03", "confirmed")
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "23P01" || pgErr.ConstraintName != "reservations_no_overlap" {
			t.Errorf("overlap: %v, want 23P01 reservations_no_overlap", err)
		}
		if err := book("2026-10-01 12:00+03", "2026-10-01 14:00+03", "confirmed"); err != nil {
			t.Errorf("adjacent [12,14) rejected: %v", err)
		}
		if _, err := db.ExecContext(ctx, `insert into access.roles (name, kind) values ('Все права', 'custom')`); err != nil {
			t.Fatal(err)
		}
		_, err = db.ExecContext(ctx, `insert into access.role_versions (role_id, version, actions, created_by)
			select id, 1, '{"*"}', gen_random_uuid() from access.roles where name = 'Все права'`)
		if got := sqlState(err); got != "23514" {
			t.Errorf("wildcard role: SQLSTATE %q (%v), want 23514", got, err)
		}
	})
}
