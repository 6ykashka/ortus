//go:build integration

package main

import (
	"bytes"
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

// Сид проверяется на первом образе migratetest.Images() (PostgreSQL 17.11 по умолчанию). Имена tenant DB
// фиксированы (t_alta, t_lotos), поэтому полный прогон — один последовательный тест.
var cluster *migratetest.Cluster

func TestMain(m *testing.M) {
	c, stop, err := migratetest.Start(context.Background(), migratetest.Images()[0])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	cluster = c
	code := m.Run()
	stop()
	os.Exit(code)
}

func seedEnv(controlDB string) map[string]string {
	return map[string]string{
		"MIGRATOR_DB_URL": cluster.URL(controlDB, migrations.RoleMigrator),
		"PG_SUPER_URL":    cluster.URL(controlDB, migratetest.Super),
	}
}

func runSeed(t *testing.T, env map[string]string) (int, string, string) {
	t.Helper()
	var out, errOut bytes.Buffer
	code := run(t.Context(), nil, func(k string) string { return env[k] }, &out, &errOut)
	return code, out.String(), errOut.String()
}

func count(t *testing.T, db *sql.DB, q string, args ...any) int {
	t.Helper()
	var n int
	if err := db.QueryRowContext(t.Context(), q, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
	return n
}

// Без миграций control DB сид не пишет ничего и подсказывает `migrate`.
func TestSeedRequiresMigratedControl(t *testing.T) {
	t.Parallel()
	ctl := cluster.NewDatabase(t, "ctl_empty")
	code, _, errOut := runSeed(t, seedEnv(ctl))
	if code != exitConfig || !strings.Contains(errOut, "migrate") {
		t.Fatalf("code %d, stderr %q; want %d and a hint to run migrate", code, errOut, exitConfig)
	}
}

// Сид дважды: одинаковые счётчики, ссылки control → tenant DB целы, sentinel совпадает, runtime-роль читает данные.
func TestSeedTwice(t *testing.T) {
	t.Parallel()
	ctl := cluster.NewDatabase(t, "ctl")
	if _, err := migrations.Up(t.Context(), cluster.DB(t, ctl, migrations.RoleMigrator), migrations.Control); err != nil {
		t.Fatal(err)
	}
	env := seedEnv(ctl)
	for pass := 1; pass <= 2; pass++ {
		code, out, errOut := runSeed(t, env)
		if code != exitOK {
			t.Fatalf("pass %d: code %d\nstdout: %s\nstderr: %s", pass, code, out, errOut)
		}
		for _, want := range []string{"platform: 4 tenants, 19 accounts (13 users, 6 operators), 12 memberships",
			"tenant alta (t_alta): 15 units, 10 people", "tenant lotos (t_lotos): 3 units, 2 people"} {
			if !strings.Contains(out, want) {
				t.Errorf("pass %d: output lacks %q:\n%s", pass, want, out)
			}
		}
		checkControl(t, cluster.DB(t, ctl, migratetest.Super))
		checkTenant(t, ctl, "t_alta", "t-alta", 15, 27, 10, 3)
		checkTenant(t, ctl, "t_lotos", "t-lotos", 3, 5, 2, 0)
		checkRuntimeSecret(t, ctl, "t_alta")
		checkRuntimeSecret(t, ctl, "t_lotos")
	}
}

func checkControl(t *testing.T, db *sql.DB) {
	t.Helper()
	for q, want := range map[string]int{
		`select count(*) from tenants`:                                                    4,
		`select count(*) from accounts`:                                                   19,
		`select count(*) from accounts where issuer = 'urn:ortus:dev'`:                    13,
		`select count(*) from platform_operators`:                                         6,
		`select count(*) from memberships`:                                                12,
		`select count(*) from owner_bindings where revoked_at is null`:                    2,
		`select count(*) from accounts where status = 'locked' and locked_at is not null`: 1,
	} {
		if got := count(t, db, q); got != want {
			t.Errorf("%s = %d, want %d", q, got, want)
		}
	}
	// Обе tenant DB сида — на последней версии, выданной стюардом (PD-59), а не на числе v0.2.
	if got := count(t, db, `select count(*) from tenant_routing where schema_version = $1`,
		migrations.Latest(migrations.Tenant)); got != 2 {
		t.Errorf("tenant_routing on the latest tenant version = %d, want 2", got)
	}
	acc1 := seedID(scopePlatform, "acc-1")
	if n := count(t, db, `select count(*) from accounts where id = $1 and subject = 'acc-1' and email_norm = 'd.zimina@alta.example'`, acc1); n != 1 {
		t.Errorf("acc-1 is not %s", acc1)
	}
}

func checkTenant(t *testing.T, controlDB, database, proto string, units, closure, people, drivers int) {
	t.Helper()
	db := cluster.DB(t, database, migrations.RoleAPI) // runtime-роль: гранты после Up
	for q, want := range map[string]int{
		`select count(*) from org.units`:                                      units,
		`select count(*) from org.unit_closure`:                               closure,
		`select count(*) from people.person_profiles`:                         people,
		`select count(*) from people.work_profiles where function = 'driver'`: drivers,
	} {
		if got := count(t, db, q); got != want {
			t.Errorf("%s: %s = %d, want %d", database, q, got, want)
		}
	}
	tenantID := seedID(scopePlatform, proto)
	var sentinel string
	if err := db.QueryRowContext(t.Context(), `select sentinel::text from core.tenant_identity where tenant_id = $1`, tenantID).
		Scan(&sentinel); err != nil {
		t.Fatalf("%s: tenant_identity: %v", database, err)
	}
	control := cluster.DB(t, controlDB, migratetest.Super)
	if n := count(t, control, `select count(*) from tenant_routing where tenant_id = $1 and sentinel::text = $2 and database_name = $3`,
		tenantID, sentinel, database); n != 1 {
		t.Errorf("%s: sentinel %s does not match tenant_routing", database, sentinel)
	}
	// Каждое членство организации указывает на существующий профиль в её tenant DB.
	rows, err := control.QueryContext(t.Context(), `select person_profile_id::text from memberships where tenant_id = $1`, tenantID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var pid string
		if err := rows.Scan(&pid); err != nil {
			t.Fatal(err)
		}
		if n := count(t, db, `select count(*) from people.person_profiles where id = $1`, pid); n != 1 {
			t.Errorf("%s: membership → person_profile %s missing", database, pid)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
}

// Пул API (W0.09) открывает tenant DB по tenant_routing.secret_ref = env:<VAR>: в переменной DSN роли ortus_api,
// путь заменяется на database_name (migrations.TenantDSN). Учётка мигратора (DDL) в secret_ref не попадает.
func checkRuntimeSecret(t *testing.T, controlDB, database string) {
	t.Helper()
	control := cluster.DB(t, controlDB, migratetest.Super)
	var ref string
	if err := control.QueryRowContext(t.Context(), `select secret_ref from tenant_routing where database_name = $1`, database).
		Scan(&ref); err != nil {
		t.Fatalf("%s: secret_ref: %v", database, err)
	}
	if ref != "env:TENANT_DB_URL" {
		t.Fatalf("%s: secret_ref = %q, want env:TENANT_DB_URL", database, ref)
	}
	env := map[string]string{"TENANT_DB_URL": cluster.URL("postgres", migrations.RoleAPI)}
	dsn, err := migrations.TenantDSN(env[strings.TrimPrefix(ref, "env:")], "", database)
	if err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var user string
	if err := db.QueryRowContext(t.Context(), `select current_user`).Scan(&user); err != nil {
		t.Fatalf("%s: connect with %s: %v", database, ref, err)
	}
	if user != migrations.RoleAPI {
		t.Errorf("%s: %s connects as %s, want %s", database, ref, user, migrations.RoleAPI)
	}
	if n := count(t, db, `select count(*) from org.units`); n == 0 {
		t.Errorf("%s: runtime role sees no org.units", database)
	}
	_, err = db.ExecContext(t.Context(), `create table org.x (id int)`)
	if pgErr, ok := errors.AsType[*pgconn.PgError](err); !ok || pgErr.Code != "42501" {
		t.Errorf("%s: DDL through %s: %v, want SQLSTATE 42501", database, ref, err)
	}
}
