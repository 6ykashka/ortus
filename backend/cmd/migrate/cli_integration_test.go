//go:build integration

package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// CLI проверяется на первом образе из migratetest.Images() (PostgreSQL 17.11 по умолчанию);
// сами миграции на 17 и 16.4 покрывает пакет migrations.
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

// stand prepares an empty control database and the environment cmd/migrate reads.
func stand(t *testing.T) (controlDB string, env map[string]string) {
	t.Helper()
	controlDB = cluster.NewDatabase(t, "ctl")
	p := migratetest.Passwords
	env = map[string]string{
		"MIGRATOR_DB_URL":     cluster.URL(controlDB, migrations.RoleMigrator),
		"PG_SUPER_URL":        cluster.URL(controlDB, migratetest.Super),
		"PG_MIGRATOR_PASS":    p.Migrator,
		"PG_API_PASS":         p.API,
		"PG_WORKER_PASS":      p.Worker,
		"PG_PROVISIONER_PASS": p.Provisioner,
	}
	return controlDB, env
}

func mustRun(t *testing.T, env map[string]string, args ...string) string {
	t.Helper()
	code, out, errOut := invoke(t, env, args...)
	if code != exitOK {
		t.Fatalf("migrate %s: code %d\nstdout: %s\nstderr: %s", strings.Join(args, " "), code, out, errOut)
	}
	return out
}

// registerTenant creates tenant DB name and its control rows (as the seed or the provisioner would).
func registerTenant(t *testing.T, controlDB, slug string) string {
	t.Helper()
	name := cluster.NewDatabase(t, "t_"+slug)
	super := cluster.DB(t, controlDB, migratetest.Super)
	_, err := super.ExecContext(t.Context(), `
with t as (
  insert into tenants (slug, display_name, industry_pack, state) values ($1, $1, 'logistics', 'active') returning id
)
insert into tenant_routing (tenant_id, cluster_ref, database_name, secret_ref, sentinel)
select id, 'local', $2, 'env:TENANT_DB_URL', gen_random_uuid() from t`, slug, name)
	if err != nil {
		t.Fatalf("register tenant %s: %v", slug, err)
	}
	return name
}

// expect fails the test when out lacks any of wants.
func expect(t *testing.T, what, out string, wants ...string) {
	t.Helper()
	for _, w := range wants {
		if !strings.Contains(out, w) {
			t.Errorf("%s lacks %q:\n%s", what, w, out)
		}
	}
}

func count(t *testing.T, db *sql.DB, q string) int {
	t.Helper()
	var n int
	if err := db.QueryRowContext(t.Context(), q).Scan(&n); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
	return n
}

// make migrate: роли → control → все tenant DB из tenant_routing; routing и platform_audit обновлены.
func TestControlAndTenantsLifecycle(t *testing.T) {
	t.Parallel()
	controlDB, env := stand(t)

	mustRun(t, env, "roles", "ensure")
	expect(t, "control status", mustRun(t, env, "control", "status"), "control: version 0 (latest 3)")
	expect(t, "control up", mustRun(t, env, "control", "up"), "control: 0 → 3")
	expect(t, "second control up", mustRun(t, env, "control", "up"), "control: 3 → 3")

	alta := registerTenant(t, controlDB, "alta")
	lotos := registerTenant(t, controlDB, "lotos")

	out := mustRun(t, env, "tenants", "status")
	header, _, _ := strings.Cut(out, "\n")
	if got := strings.Join(strings.Fields(header), " "); got != "slug database routing actual drift" {
		t.Errorf("tenants status header: %q", header)
	}
	expect(t, "tenants status", out, "alta", alta, "lotos", lotos, "false")

	expect(t, "tenants up", mustRun(t, env, "tenants", "up"),
		"tenant alta ("+alta+"): 0 → 2", "tenant lotos ("+lotos+"): 0 → 2")
	super := cluster.DB(t, controlDB, migratetest.Super)
	if n := count(t, super, `select count(*) from tenant_routing where schema_version = 2`); n != 2 {
		t.Errorf("tenant_routing rows on version 2 = %d, want 2", n)
	}
	if n := count(t, super, `select count(*) from platform_audit
		where action = 'tenant.schema.migrate' and result = 'ok' and actor_kind = 'system'
		  and details->>'from' = '0' and details->>'to' = '2'`); n != 2 {
		t.Errorf("platform_audit rows = %d, want 2", n)
	}

	expect(t, "tenant status", mustRun(t, env, "tenant", "status", "--db", alta), "tenant "+alta+": version 2 (latest 2)")
	expect(t, "tenant down", mustRun(t, env, "tenant", "down", "--db", alta, "--to", "1", "--yes"), "tenant "+alta+": 2 → 1")

	// Дрейф: routing = 2, фактически 1.
	code, out, _ := invoke(t, env, "tenants", "status", "--fail-on-drift")
	if code != exitDrift {
		t.Errorf("status --fail-on-drift: code %d, want %d\n%s", code, exitDrift, out)
	}
	expect(t, "drifted status", out, "true")
	if code, _, _ := invoke(t, env, "tenants", "status"); code != exitOK {
		t.Errorf("status without --fail-on-drift: code %d", code)
	}
}

// make migrate на чистом стенде: all up = roles ensure + control up + tenants up.
func TestAllUp(t *testing.T) {
	t.Parallel()
	_, env := stand(t)
	out := mustRun(t, env, "all", "up")
	for _, want := range []string{"roles: ensured", "control: 0 → 3", "tenants: 0 migrated"} {
		if !strings.Contains(out, want) {
			t.Errorf("all up lacks %q:\n%s", want, out)
		}
	}
}

// Тенант в tenant_routing без базы: tenants up — код 4, а в platform_audit (его читают ortus_api и журнал
// операторов) нет ни DSN, ни паролей.
func TestTenantsUpMissingDatabaseKeepsSecretsOutOfAudit(t *testing.T) {
	t.Parallel()
	controlDB, env := stand(t)
	mustRun(t, env, "roles", "ensure")
	mustRun(t, env, "control", "up")
	super := cluster.DB(t, controlDB, migratetest.Super)
	if _, err := super.ExecContext(t.Context(), `
with t as (
  insert into tenants (slug, display_name, industry_pack, state) values ('ghost', 'ghost', 'logistics', 'active') returning id
)
insert into tenant_routing (tenant_id, cluster_ref, database_name, secret_ref, sentinel)
select id, 'local', 't_ghost_missing', 'env:TENANT_DB_URL', gen_random_uuid() from t`); err != nil {
		t.Fatal(err)
	}

	code, out, errOut := invoke(t, env, "tenants", "up")
	if code != exitConfig {
		t.Errorf("code %d, want %d\nstdout: %s\nstderr: %s", code, exitConfig, out, errOut)
	}
	var details string
	if err := super.QueryRowContext(t.Context(), `select coalesce(string_agg(details::text, ' '), '') from platform_audit
		where action = 'tenant.schema.migrate' and result = 'failed'`).Scan(&details); err != nil {
		t.Fatal(err)
	}
	expect(t, "platform_audit.details", details, "t_ghost_missing")
	p := migratetest.Passwords
	for _, secret := range []string{p.Migrator, p.API, p.Worker, p.Provisioner, "postgres://", migrations.RoleMigrator + ":"} {
		if strings.Contains(details, secret) {
			t.Errorf("platform_audit.details contains %q: %s", secret, details)
		}
		if strings.Contains(out+errOut, secret) {
			t.Errorf("output contains %q: %s %s", secret, out, errOut)
		}
	}
}

// Миграции применяет только ortus_migrator: под ortus_api — код 5 до первого SQL.
func TestNotMigrator(t *testing.T) {
	t.Parallel()
	controlDB, env := stand(t)
	env["MIGRATOR_DB_URL"] = cluster.URL(controlDB, migrations.RoleAPI)
	code, _, errOut := invoke(t, env, "control", "up")
	if code != exitNotMigrator {
		t.Errorf("code %d, want %d (%s)", code, exitNotMigrator, errOut)
	}
}
