//go:build integration

package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/internal/control/provisioning"
	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

var cluster *migratetest.Cluster

func TestMain(m *testing.M) {
	c, stop, err := migratetest.Start(context.Background(), migratetest.Images()[0])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	cluster = c
	super, err := sql.Open("pgx", c.URL("postgres", migratetest.Super))
	if err == nil {
		err = provisioning.EnsureRoleGrants(context.Background(), super)
		_ = super.Close()
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		stop()
		os.Exit(1)
	}
	code := m.Run()
	stop()
	os.Exit(code)
}

// stand is a migrated control DB and the environment cmd/provisioner reads.
func stand(t *testing.T) (controlDB string, env map[string]string) {
	t.Helper()
	controlDB = cluster.NewDatabase(t, "ctl")
	if _, err := migrations.Up(t.Context(), cluster.DB(t, controlDB, migrations.RoleMigrator), migrations.Control); err != nil {
		t.Fatal(err)
	}
	return controlDB, map[string]string{
		"MIGRATOR_DB_URL":    cluster.URL(controlDB, migrations.RoleMigrator),
		"PROVISIONER_DB_URL": cluster.URL("postgres", migrations.RoleProvisioner),
	}
}

func one(t *testing.T, controlDB, q string, args ...any) string {
	t.Helper()
	var v sql.NullString
	if err := cluster.DB(t, controlDB, migratetest.Super).QueryRowContext(t.Context(), q, args...).Scan(&v); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
	return v.String
}

// create: регистрация и сага одной командой — организация в trial, база на последней версии.
func TestCreate(t *testing.T) {
	t.Parallel()
	controlDB, env := stand(t)
	code, out, errOut := invoke(t, env, "create", "--name", "Альта Логистика", "--owner-email", "owner@alta.example",
		"--time-zone", "Europe/Moscow", "--plan", "pilot", "--key", "cli-create-alta-0001")
	if code != exitOK {
		t.Fatalf("code %d\n%s\n%s", code, out, errOut)
	}
	latest := migrations.Latest(migrations.Tenant)
	if !strings.Contains(out, fmt.Sprintf("trial, schema %d", latest)) || !strings.Contains(out, "alta-logistika-") {
		t.Errorf("output: %s", out)
	}
	if got := one(t, controlDB, `select state::text || ' ' || r.schema_version from tenants t join tenant_routing r on r.tenant_id = t.id`); got != fmt.Sprintf("trial %d", latest) {
		t.Errorf("control: %s", got)
	}
	// The same key again: the registration replays, the saga skips the tenant.
	code, out, _ = invoke(t, env, "create", "--name", "Альта Логистика", "--owner-email", "owner@alta.example",
		"--time-zone", "Europe/Moscow", "--plan", "pilot", "--key", "cli-create-alta-0001")
	if code != exitOK || !strings.Contains(out, "trial") || one(t, controlDB, `select count(*) from tenants`) != "1" {
		t.Errorf("replay: code %d, %s", code, out)
	}
}

// run --once: организации, зарегистрированные API, доводятся до trial; сводка в выводе.
func TestRunOnce(t *testing.T) {
	t.Parallel()
	controlDB, env := stand(t)
	reg := provisioning.Registrar{Control: cluster.DB(t, controlDB, migrations.RoleAPI)}
	for i, name := range []string{"Лотос", "Карго"} {
		req := provisioning.Request{Name: name, OwnerEmail: "o@x.example", TimeZone: "Europe/Samara", PlanKey: "pilot",
			IdempotencyKey: fmt.Sprintf("api-request-%08d", i)}
		if _, _, err := reg.Register(t.Context(), req); err != nil {
			t.Fatal(err)
		}
	}
	code, out, errOut := invoke(t, env, "run", "--once")
	if code != exitOK || !strings.Contains(out, "provisioner: 2 provisioned, 0 failed") {
		t.Fatalf("code %d\n%s\n%s", code, out, errOut)
	}
	if got := one(t, controlDB, `select string_agg(state::text, ',') from tenants`); got != "trial,trial" {
		t.Errorf("states %s", got)
	}
	code, out, _ = invoke(t, env, "run", "--once")
	if code != exitOK || !strings.Contains(out, "provisioner: 0 provisioned, 0 failed") {
		t.Errorf("second run: %d %s", code, out)
	}
}
