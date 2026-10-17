//go:build integration

package main

import (
	"context"
	"database/sql"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// demoTenant writes the base tenant rows of «Альта» (units, people, access) into a fresh tenant DB.
func demoTenant(t *testing.T) *sql.DB {
	t.Helper()
	name := cluster.NewDatabase(t, "demo_seed")
	db := cluster.DB(t, name, migrations.RoleMigrator)
	if _, err := migrations.Up(t.Context(), db, migrations.Tenant); err != nil {
		t.Fatal(err)
	}
	tx, err := db.BeginTx(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, step := range []func() error{
		func() error { return writeUnits(t.Context(), tx, alta) },
		func() error { return writePeople(t.Context(), tx, alta) },
		func() error { return writeAccess(t.Context(), tx, alta) },
	} {
		if err := step(); err != nil {
			_ = tx.Rollback()
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return db
}

// demoPass runs writeDemo in its own transaction and returns the rows it changed.
func demoPass(t *testing.T, db *sql.DB) int64 {
	t.Helper()
	tx, err := db.BeginTx(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	n, err := writeDemo(t.Context(), tx, alta)
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return n
}

// The demo twice: «Логистика» on, one assignment of Марина Котова, policy_version + 1 once; a second run changes
// nothing; a module switched off before the show is switched on again.
func TestWriteDemoTwice(t *testing.T) {
	t.Parallel()
	db := demoTenant(t)
	before := count(t, db, `select policy_version from access.policy_state`)
	if n := demoPass(t, db); n == 0 {
		t.Fatal("first pass changed nothing")
	}
	if n := demoPass(t, db); n != 0 {
		t.Fatalf("second pass changed %d rows, want 0", n)
	}
	checkDemo(t, db, before+1)

	if _, err := db.ExecContext(t.Context(), `update modules.installations set state = 'disabled' where module_key = $1`, demoModule); err != nil {
		t.Fatal(err)
	}
	if n := demoPass(t, db); n != 1 {
		t.Fatalf("pass after the module was switched off changed %d rows, want 1", n)
	}
	checkDemo(t, db, before+2)
}

func checkDemo(t *testing.T, db *sql.DB, policy int) {
	t.Helper()
	g := kotovaManager
	for q, want := range map[string]int{
		`select count(*) from modules.installations where module_key = '` + demoModule + `' and state = 'enabled'`: 1,
		`select count(*) from access.role_assignments where principal_id = '` + seedID(protoAlta, g.member).String() + `'
		   and role_id = '` + seedID(protoAlta, g.role).String() + `'`: 1,
		`select count(*) from access.role_assignments where id = '` + g.id().String() + `' and principal_kind = 'person'
		   and scope_kind = 'unit' and scope_ref = '` + seedID(protoAlta, g.unit).String() + `' and include_descendants
		   and upper_inf(valid) and role_version = 1`: 1,
		`select policy_version from access.policy_state`: policy,
	} {
		if got := count(t, db, q); got != want {
			t.Errorf("%s = %d, want %d", strings.Join(strings.Fields(q), " "), got, want)
		}
	}
}

// `seed demo` on a migrated control DB: the base seed, then the demo in t_alta; t_lotos stays without logistics.
// Sequential: the tenant DBs of the full seed have fixed names (t_alta, t_lotos); the demo rows are removed after.
func TestSeedDemo(t *testing.T) { //nolint:paralleltest // fixed tenant DB names, see above
	ctl := cluster.NewDatabase(t, "ctl_demo")
	if _, err := migrations.Up(t.Context(), cluster.DB(t, ctl, migrations.RoleMigrator), migrations.Control); err != nil {
		t.Fatal(err)
	}
	env := seedEnv(ctl)
	var out, errOut strings.Builder
	code := run(t.Context(), []string{demoArg}, func(k string) string { return env[k] }, &out, &errOut)
	if code != exitOK {
		t.Fatalf("seed demo: code %d\nstdout: %s\nstderr: %s", code, out.String(), errOut.String())
	}
	altaDB := cluster.DB(t, "t_alta", migratetest.Super)
	t.Cleanup(func() {
		for _, q := range []string{
			`delete from modules.installations where module_key = '` + demoModule + `'`,
			`delete from access.role_assignments where id = '` + kotovaManager.id().String() + `'`,
		} {
			if _, err := altaDB.ExecContext(context.WithoutCancel(t.Context()), q); err != nil {
				t.Errorf("%s: %v", q, err)
			}
		}
	})
	for _, want := range []string{"tenant alta (t_alta): 15 units, 10 people",
		"demo alta (t_alta): «Логистика» включена, Марина Котова — «Менеджер логистики» в «Север Логистик»"} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("output lacks %q:\n%s", want, out.String())
		}
	}
	if n := count(t, altaDB, `select count(*) from modules.installations where module_key = $1 and state = 'enabled'`, demoModule); n != 1 {
		t.Errorf("t_alta: logistics enabled %d, want 1", n)
	}
	lotosDB := cluster.DB(t, "t_lotos", migratetest.Super)
	if n := count(t, lotosDB, `select count(*) from modules.installations where module_key = $1`, demoModule); n != 0 {
		t.Errorf("t_lotos: logistics %d, want 0", n)
	}
}
