//go:build integration

package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strconv"
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
		"APP_ENV":             "test", // down-guard allowlist (W1.02)
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
	// Версия control — последняя выданная стюардом (PD-59; W1.00 — 0004–0005), а не число v0.2.
	cl := migrations.Latest(migrations.Control)
	expect(t, "control status", mustRun(t, env, "control", "status"), fmt.Sprintf("control: version 0 (latest %d)", cl))
	expect(t, "control up", mustRun(t, env, "control", "up"), fmt.Sprintf("control: 0 → %d", cl))
	expect(t, "second control up", mustRun(t, env, "control", "up"), fmt.Sprintf("control: %d → %d", cl, cl))

	alta := registerTenant(t, controlDB, "alta")
	lotos := registerTenant(t, controlDB, "lotos")

	out := mustRun(t, env, "tenants", "status")
	header, _, _ := strings.Cut(out, "\n")
	if got := strings.Join(strings.Fields(header), " "); got != "slug database routing actual drift" {
		t.Errorf("tenants status header: %q", header)
	}
	expect(t, "tenants status", out, "alta", alta, "lotos", lotos, "false")

	// Версия tenant — последняя выданная стюардом (PD-59), а не число v0.2: новые миграции этапов не ломают тест.
	latest := migrations.Latest(migrations.Tenant)
	expect(t, "tenants up", mustRun(t, env, "tenants", "up"),
		fmt.Sprintf("tenant alta (%s): 0 → %d", alta, latest), fmt.Sprintf("tenant lotos (%s): 0 → %d", lotos, latest))
	super := cluster.DB(t, controlDB, migratetest.Super)
	if n := count(t, super, fmt.Sprintf(`select count(*) from tenant_routing where schema_version = %d`, latest)); n != 2 {
		t.Errorf("tenant_routing rows on version %d = %d, want 2", latest, n)
	}
	if n := count(t, super, fmt.Sprintf(`select count(*) from platform_audit
		where action = 'tenant.schema.migrate' and result = 'ok' and actor_kind = 'system'
		  and details->>'from' = '0' and details->>'to' = '%d'`, latest)); n != 2 {
		t.Errorf("platform_audit rows = %d, want 2", n)
	}

	expect(t, "tenant status", mustRun(t, env, "tenant", "status", "--db", alta),
		fmt.Sprintf("tenant %s: version %d (latest %d)", alta, latest, latest))
	// Возврат 1: tenant down по базе с маршрутом идёт через контроллер — routing следует за базой, дрейфа нет.
	expect(t, "tenant down", mustRun(t, env, "tenant", "down", "--db", alta, "--to", "1", "--yes"),
		fmt.Sprintf("tenant %s: %d → 1", alta, latest))
	if v := routingVersion(t, controlDB, "alta"); v != 1 {
		t.Errorf("alta routing after tenant down = %d, want 1", v)
	}
	mustRun(t, env, "tenants", "status", "--fail-on-drift")

	// Дрейф: routing = latest, фактически 1 (routing поправлен мимо контроллера).
	if _, err := super.ExecContext(t.Context(), fmt.Sprintf(`update tenant_routing set schema_version = %d
		where tenant_id = (select id from tenants where slug = 'alta')`, latest)); err != nil {
		t.Fatal(err)
	}
	code, out, _ := invoke(t, env, "tenants", "status", "--fail-on-drift")
	if code != exitDrift {
		t.Errorf("status --fail-on-drift: code %d, want %d\n%s", code, exitDrift, out)
	}
	expect(t, "drifted status", out, "true")
	if code, _, _ := invoke(t, env, "tenants", "status"); code != exitOK {
		t.Errorf("status without --fail-on-drift: code %d", code)
	}
}

// Возврат 1 (ревью, minor): migrate tenant up|down --db по базе организации идёт через контроллер — замок,
// sentinel, tenant_routing и аудит; база без маршрута — низкоуровневый прогон с пометкой «routing не обновлён»;
// база организации в provisioning — отказ (её ведёт провиженер).
func TestTenantCommandUsesController(t *testing.T) {
	t.Parallel()
	controlDB, env := stand(t)
	mustRun(t, env, "roles", "ensure")
	mustRun(t, env, "control", "up")
	alta := registerTenant(t, controlDB, "alta")
	latest := migrations.Latest(migrations.Tenant)
	super := cluster.DB(t, controlDB, migratetest.Super)

	expect(t, "tenant up --to 2", mustRun(t, env, "tenant", "up", "--db", alta, "--to", "2"), fmt.Sprintf("tenant %s: 0 → 2", alta))
	if v := routingVersion(t, controlDB, "alta"); v != 2 {
		t.Errorf("routing after tenant up --to 2 = %d, want 2", v)
	}
	if n := count(t, super, `select count(*) from platform_audit where action = 'tenant.schema.migrate' and result = 'ok'
		and details->>'to' = '2'`); n != 1 {
		t.Errorf("audit rows of tenant up = %d, want 1", n)
	}
	mustRun(t, env, "tenant", "up", "--db", alta)
	if v := routingVersion(t, controlDB, "alta"); v != latest {
		t.Errorf("routing after tenant up = %d, want %d", v, latest)
	}
	expect(t, "status", mustRun(t, env, "tenants", "status", "--fail-on-drift"), "alta")

	loose := cluster.NewDatabase(t, "t_loose")
	expect(t, "tenant up without a route", mustRun(t, env, "tenant", "up", "--db", loose),
		fmt.Sprintf("tenant %s: 0 → %d", loose, latest), "tenant_routing not updated")

	pendingDB := "t_pending_not_created"
	if _, err := super.ExecContext(t.Context(), `
with t as (
  insert into tenants (slug, display_name, industry_pack, state) values ('pending', 'pending', 'custom', 'provisioning') returning id
)
insert into tenant_routing (tenant_id, cluster_ref, database_name, secret_ref, sentinel)
select id, 'local', $1, 'env:TENANT_DB_URL', gen_random_uuid() from t`, pendingDB); err != nil {
		t.Fatal(err)
	}
	if code, out, errOut := invoke(t, env, "tenant", "up", "--db", pendingDB); code == exitOK || !strings.Contains(errOut, "provisioning") {
		t.Errorf("tenant up of a tenant in provisioning: code %d\n%s\n%s", code, out, errOut)
	}
}

// Возврат 1 (ревью, major): организация в provisioning без базы не валит tenants up (код 0, «provisioning,
// skipped») и не считается дрейфом в tenants status --fail-on-drift.
func TestTenantsUpSkipsProvisioning(t *testing.T) {
	t.Parallel()
	controlDB, env := stand(t)
	mustRun(t, env, "roles", "ensure")
	mustRun(t, env, "control", "up")
	registerTenant(t, controlDB, "alta")
	mustRun(t, env, "tenants", "up")
	if _, err := cluster.DB(t, controlDB, migratetest.Super).ExecContext(t.Context(), `
with t as (
  insert into tenants (slug, display_name, industry_pack, state) values ('pending', 'pending', 'custom', 'provisioning') returning id
)
insert into tenant_routing (tenant_id, cluster_ref, database_name, secret_ref, sentinel)
select id, 'local', 't_pending_not_created', 'env:TENANT_DB_URL', gen_random_uuid() from t`); err != nil {
		t.Fatal(err)
	}
	expect(t, "tenants up", mustRun(t, env, "tenants", "up"),
		"tenant pending (t_pending_not_created): provisioning, skipped", "tenants: 0 migrated, 2 skipped, 0 failed")
	expect(t, "all up", mustRun(t, env, "all", "up"), "tenants: 0 migrated, 2 skipped, 0 failed")
	out := mustRun(t, env, "tenants", "status", "--fail-on-drift")
	for line := range strings.Lines(out) {
		if strings.HasPrefix(line, "pending ") && strings.Join(strings.Fields(line), " ") != "pending t_pending_not_created 0 provisioning false" {
			t.Errorf("status line of the pending tenant: %q", line)
		}
	}
	if code, _, errOut := invoke(t, env, "tenants", "down", "--to", "0", "--canary", "pending", "--yes"); code != exitUsage ||
		!strings.Contains(errOut, "provisioning") {
		t.Errorf("tenants down of a tenant in provisioning: code %d, stderr %s", code, errOut)
	}
}

// make migrate на чистом стенде: all up = roles ensure + control up + tenants up.
func TestAllUp(t *testing.T) {
	t.Parallel()
	_, env := stand(t)
	out := mustRun(t, env, "all", "up")
	control := fmt.Sprintf("control: 0 → %d", migrations.Latest(migrations.Control))
	for _, want := range []string{"roles: ensured", control, "tenants: 0 migrated"} {
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

	// W1.02: the only tenant is the canary of the rollout; its connection failure is a canary failure (code 6).
	code, out, errOut := invoke(t, env, "tenants", "up")
	if code != exitCanary {
		t.Errorf("code %d, want %d\nstdout: %s\nstderr: %s", code, exitCanary, out, errOut)
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

func routingVersion(t *testing.T, controlDB, slug string) int64 {
	t.Helper()
	var v int64
	if err := cluster.DB(t, controlDB, migratetest.Super).QueryRowContext(t.Context(), `select r.schema_version
		from tenant_routing r join tenants t on t.id = r.tenant_id where t.slug = $1`, slug).Scan(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

// S1-03: dry-run печатает план (canary, партии) и ничего не меняет; up с --canary и --batch идёт фазами.
func TestTenantsCanaryAndBatches(t *testing.T) {
	t.Parallel()
	controlDB, env := stand(t)
	mustRun(t, env, "roles", "ensure")
	mustRun(t, env, "control", "up")
	alta := registerTenant(t, controlDB, "alta")
	lotos := registerTenant(t, controlDB, "lotos")
	cargo := registerTenant(t, controlDB, "cargo")

	out := mustRun(t, env, "tenants", "up", "--dry-run", "--canary", "lotos", "--batch", "1")
	expect(t, "dry-run", out, "phase canary: lotos", "phase batch 1: alta", "phase batch 2: cargo", "dry-run: nothing changed")
	for _, slug := range []string{"alta", "lotos", "cargo"} {
		if v := routingVersion(t, controlDB, slug); v != 0 {
			t.Errorf("dry-run moved %s to %d", slug, v)
		}
	}

	latest := migrations.Latest(migrations.Tenant)
	out = mustRun(t, env, "tenants", "up", "--canary", "lotos", "--batch", "1")
	first := strings.Index(out, fmt.Sprintf("tenant lotos (%s): 0 → %d", lotos, latest))
	second := strings.Index(out, fmt.Sprintf("tenant alta (%s): 0 → %d", alta, latest))
	third := strings.Index(out, fmt.Sprintf("tenant cargo (%s): 0 → %d", cargo, latest))
	if first < 0 || second < first || third < second {
		t.Errorf("rollout order (canary lotos, then alta, cargo):\n%s", out)
	}
	expect(t, "tenants up", out, "tenants: 3 migrated, 0 skipped, 0 failed")
	expect(t, "second tenants up", mustRun(t, env, "tenants", "up", "--to", strconv.FormatInt(latest, 10)),
		"tenants: 0 migrated, 3 skipped, 0 failed")
	code, _, errOut := invoke(t, env, "tenants", "up", "--canary", "ghost")
	if code != exitUsage || !strings.Contains(errOut, "ghost") {
		t.Errorf("unknown canary: code %d, stderr %s", code, errOut)
	}
}

// Отказ canary — код 6, партии не тронуты.
func TestTenantsCanaryFailureExitCode(t *testing.T) {
	t.Parallel()
	controlDB, env := stand(t)
	mustRun(t, env, "roles", "ensure")
	mustRun(t, env, "control", "up")
	registerTenant(t, controlDB, "alta")
	registerTenant(t, controlDB, "lotos")
	super := cluster.DB(t, controlDB, migratetest.Super)
	if _, err := super.ExecContext(t.Context(), `update tenant_routing set database_name = 't_lost_db'
		where tenant_id = (select id from tenants where slug = 'alta')`); err != nil {
		t.Fatal(err)
	}
	code, out, errOut := invoke(t, env, "tenants", "up", "--canary", "alta")
	if code != exitCanary {
		t.Fatalf("code %d, want %d\n%s\n%s", code, exitCanary, out, errOut)
	}
	if v := routingVersion(t, controlDB, "lotos"); v != 0 {
		t.Errorf("batch tenant lotos moved to %d after a failed canary", v)
	}
}

// Down-guard: tenants down трогает только перечисленные slug.
func TestTenantsDownCanaryOnly(t *testing.T) {
	t.Parallel()
	controlDB, env := stand(t)
	mustRun(t, env, "roles", "ensure")
	mustRun(t, env, "control", "up")
	alta := registerTenant(t, controlDB, "alta")
	registerTenant(t, controlDB, "lotos")
	mustRun(t, env, "tenants", "up")
	latest := migrations.Latest(migrations.Tenant)
	expect(t, "tenants down", mustRun(t, env, "tenants", "down", "--to", "1", "--canary", "alta", "--yes"),
		fmt.Sprintf("tenant alta (%s): %d → 1", alta, latest))
	if v := routingVersion(t, controlDB, "alta"); v != 1 {
		t.Errorf("alta routing %d, want 1", v)
	}
	if v := routingVersion(t, controlDB, "lotos"); v != latest {
		t.Errorf("lotos routing %d, want %d (not listed)", v, latest)
	}
	expect(t, "status after rollback", mustRun(t, env, "tenants", "status", "--fail-on-drift"), "alta")
}

// Q-W0.06-2: roles ensure даёт ortus_provisioner право SET ROLE ortus_migrator (CREATE DATABASE … OWNER) без
// наследования его прав.
func TestRolesEnsureGrantsProvisioner(t *testing.T) {
	t.Parallel()
	controlDB, env := stand(t)
	mustRun(t, env, "roles", "ensure")
	mustRun(t, env, "roles", "ensure") // idempotent
	var inherit, set bool
	err := cluster.DB(t, controlDB, migratetest.Super).QueryRowContext(t.Context(), `
select m.inherit_option, m.set_option from pg_auth_members m
  join pg_roles r on r.oid = m.roleid join pg_roles u on u.oid = m.member
 where r.rolname = 'ortus_migrator' and u.rolname = 'ortus_provisioner'`).Scan(&inherit, &set)
	if err != nil {
		t.Fatalf("membership of ortus_provisioner in ortus_migrator: %v", err)
	}
	if inherit || !set {
		t.Errorf("inherit %v set %v, want false/true", inherit, set)
	}
}

// Миграции tenant DB тоже только под ortus_migrator: под ortus_api — код 5.
func TestTenantsUpNotMigrator(t *testing.T) {
	t.Parallel()
	controlDB, env := stand(t)
	mustRun(t, env, "roles", "ensure")
	mustRun(t, env, "control", "up")
	registerTenant(t, controlDB, "alta")
	env["MIGRATOR_DB_URL"] = cluster.URL(controlDB, migrations.RoleAPI)
	code, _, errOut := invoke(t, env, "tenants", "up")
	if code != exitNotMigrator {
		t.Errorf("code %d, want %d (%s)", code, exitNotMigrator, errOut)
	}
}
