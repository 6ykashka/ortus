//go:build isolation

package fixtures

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
	harness "github.com/ortus/ortus-crm/backend/test"
)

var cluster *migratetest.Cluster

func TestMain(m *testing.M) {
	c, stop, err := harness.StartPostgres(context.Background())
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	cluster = c
	code := m.Run()
	stop()
	os.Exit(code)
}

func count(t *testing.T, db *sql.DB, q string, args ...any) int {
	t.Helper()
	var n int
	if err := db.QueryRowContext(t.Context(), q, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
	return n
}

func id(t *testing.T, w *World, ref string) uuid.UUID {
	t.Helper()
	v, err := w.ID(ref)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func TestLoadControl(t *testing.T) {
	t.Parallel()
	w, err := Load(t.Context(), cluster, "fx_control", harness.Now())
	if err != nil {
		t.Fatal(err)
	}
	db := cluster.DB(t, w.ControlDB, migrations.RoleAPI)
	if n := count(t, db, `select count(*) from tenants where state = 'active'`); n != 2 {
		t.Errorf("active tenants = %d, want 2", n)
	}
	if n := count(t, db, `select count(*) from accounts where issuer = $1`, IssuerDev); n != len(w.Catalog.Actors) {
		t.Errorf("accounts = %d, want %d", n, len(w.Catalog.Actors))
	}
	if n := count(t, db, `select count(*) from memberships where status = 'active'`); n != 13 {
		t.Errorf("active memberships = %d, want 13", n)
	}
	if n := count(t, db, `select count(*) from owner_bindings where revoked_at is null`); n != 2 {
		t.Errorf("owner bindings = %d, want 2", n)
	}
	for _, tn := range []string{TenantA, TenantB} {
		var dbName, secret string
		var version int64
		if err := db.QueryRowContext(t.Context(), `select database_name, secret_ref, schema_version from tenant_routing
			where tenant_id = $1`, id(t, w, "tenant:"+tn)).Scan(&dbName, &secret, &version); err != nil {
			t.Fatal(err)
		}
		if dbName != w.TenantDBs[tn] || secret != tenantSecretRef || version != migrations.Latest(migrations.Tenant) {
			t.Errorf("tenant_routing %s = %s %s %d", tn, dbName, secret, version)
		}
	}
	// Членство ссылается на профиль человека в tenant DB своего тенанта.
	if n := count(t, db, `select count(*) from memberships where id = $1 and person_profile_id = $2 and tenant_id = $3`,
		id(t, w, "membership:ab.member@b"), id(t, w, "person:ab.member@b"), id(t, w, "tenant:b")); n != 1 {
		t.Error("membership ab.member@b does not point to person ab.member@b in tenant B")
	}
}

// loadWorld loads a world and opens both tenant databases as ortus_api.
func loadWorld(t *testing.T, name string) (w *World, a, b *sql.DB) {
	t.Helper()
	w, err := Load(t.Context(), cluster, name, harness.Now())
	if err != nil {
		t.Fatal(err)
	}
	return w, cluster.DB(t, w.TenantDBs[TenantA], migrations.RoleAPI), cluster.DB(t, w.TenantDBs[TenantB], migrations.RoleAPI)
}

// Sentinel tenant DB совпадает с tenant_routing (W1.02 проверяет его при открытии пула); модули и роли на месте.
func TestLoadTenantIdentity(t *testing.T) {
	t.Parallel()
	w, a, b := loadWorld(t, "fx_identity")
	control := cluster.DB(t, w.ControlDB, migrations.RoleAPI)
	for tn, db := range map[string]*sql.DB{TenantA: a, TenantB: b} {
		if n := count(t, db, `select count(*) from core.tenant_identity where tenant_id = $1`, id(t, w, "tenant:"+tn)); n != 1 {
			t.Errorf("tenant_identity of %s is missing", tn)
		}
		var routing, identity uuid.UUID
		_ = control.QueryRowContext(t.Context(), `select sentinel from tenant_routing where tenant_id = $1`,
			id(t, w, "tenant:"+tn)).Scan(&routing)
		_ = db.QueryRowContext(t.Context(), `select sentinel from core.tenant_identity`).Scan(&identity)
		if routing == uuid.Nil || routing != identity {
			t.Errorf("sentinel of %s: routing %s, tenant DB %s", tn, routing, identity)
		}
		if n := count(t, db, `select count(*) from modules.installations where module_key = 'logistics' and state = 'enabled'`); n != 1 {
			t.Errorf("logistics is not enabled in %s", tn)
		}
		if n := count(t, db, `select count(*) from access.roles r join access.role_versions v on v.role_id = r.id
			and v.version = r.current_version`); n != 4 {
			t.Errorf("roles with a current version in %s = %d, want 4", tn, n)
		}
	}
}

// Структура, водители, две роли, временное назначение и начисления через группу.
func TestLoadAccess(t *testing.T) {
	t.Parallel()
	now := harness.Now()
	w, a, _ := loadWorld(t, "fx_access")
	if n := count(t, a, `select count(*) from org.units`); n != 5 {
		t.Errorf("units of A = %d, want 5", n)
	}
	if n := count(t, a, `select count(*) from org.unit_closure where ancestor_id = $1 and descendant_id = $2 and depth = 1`,
		id(t, w, "unit:a.msk"), id(t, w, "unit:a.msk1")); n != 1 {
		t.Error("unit_closure: Москва → Москва-1 is missing")
	}
	if n := count(t, a, `select count(*) from people.work_profiles where function = 'driver' and valid @> $1::timestamptz`, now); n != 3 {
		t.Errorf("active drivers of A = %d, want 3", n)
	}
	if n := count(t, a, `select count(*) from access.role_assignments where principal_kind = 'person' and principal_id = $1
		and state = 'active' and valid @> $2::timestamptz`, id(t, w, "person:a.two-roles@a"), now); n != 2 {
		t.Errorf("active assignments of a.two-roles = %d, want 2", n)
	}
	var upper time.Time
	if err := a.QueryRowContext(t.Context(), `select upper(valid) from access.role_assignments where principal_id = $1
		and scope_ref = $2`, id(t, w, "person:a.driver-msk2@a"), id(t, w, "unit:a.msk1")).Scan(&upper); err != nil {
		t.Fatalf("temporary grant of a.driver-msk2: %v", err)
	}
	if !upper.Equal(now.Add(TemporaryFor)) {
		t.Errorf("temporary grant ends %s, want %s", upper, now.Add(TemporaryFor))
	}
	if n := count(t, a, `select count(*) from access.group_members gm join access.role_assignments ra
		on ra.principal_kind = 'group' and ra.principal_id = gm.group_id
		join access.role_versions v on v.role_id = ra.role_id and v.version = ra.role_version
		where gm.person_id = $1 and 'fleet.earnings.read' = any(v.actions)`, id(t, w, "person:a.driver-earnings@a")); n != 1 {
		t.Error("a.driver-earnings does not reach fleet.earnings.read through a group")
	}
}

// Изоляция данных: в БД A нет ни одного идентификатора B и наоборот.
func TestLoadKeepsTenantsApart(t *testing.T) {
	t.Parallel()
	w, a, b := loadWorld(t, "fx_apart")
	for _, pair := range []struct {
		db      *sql.DB
		foreign string
	}{{a, TenantB}, {b, TenantA}} {
		ids := w.Catalog.TenantIDs(pair.foreign)
		if len(ids) == 0 {
			t.Fatalf("no ids of %s", pair.foreign)
		}
		if n := count(t, pair.db, `select (select count(*) from org.units where id = any($1))
			+ (select count(*) from people.person_profiles where id = any($1))
			+ (select count(*) from access.roles where id = any($1))
			+ (select count(*) from core.tenant_identity where tenant_id = any($1))`, ids); n != 0 {
			t.Errorf("tenant DB holds %d ids of tenant %s", n, pair.foreign)
		}
	}
}

func TestWorldEnv(t *testing.T) {
	t.Parallel()
	w, err := Load(t.Context(), cluster, "fx_env", harness.Now())
	if err != nil {
		t.Fatal(err)
	}
	env := w.Env()
	user := func(key string) (string, string) {
		u, err := url.Parse(env[key])
		if err != nil {
			t.Fatalf("%s: %v", key, err)
		}
		return u.User.Username(), u.Path
	}
	for key, want := range map[string][2]string{
		"CONTROL_DB_URL":  {migrations.RoleAPI, "/" + w.ControlDB},
		"TENANT_DB_URL":   {migrations.RoleAPI, "/"},
		"MIGRATOR_DB_URL": {migrations.RoleMigrator, "/" + w.ControlDB},
	} {
		if u, p := user(key); u != want[0] || p != want[1] {
			t.Errorf("%s = %s %s, want %s %s", key, u, p, want[0], want[1])
		}
	}
	if env["APP_ENV"] != "test" || env["AUTH_PROVIDER"] != "dev" {
		t.Errorf("APP_ENV=%q AUTH_PROVIDER=%q", env["APP_ENV"], env["AUTH_PROVIDER"])
	}
	// TENANT_DB_URL + database_name (migrations.TenantDSN) открывает tenant DB под ortus_api.
	dsn, err := migrations.TenantDSN(env["TENANT_DB_URL"], "", w.TenantDBs[TenantB])
	if err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if n := count(t, db, `select count(*) from org.units`); n != 3 {
		t.Errorf("units of B via TENANT_DB_URL = %d, want 3", n)
	}
	if got := w.TenantURL(TenantA, migrations.RoleAPI); got != cluster.URL(w.TenantDBs[TenantA], migrations.RoleAPI) {
		t.Errorf("TenantURL = %s", got)
	}
}

func TestLoadRejectsDuplicateName(t *testing.T) {
	t.Parallel()
	if _, err := Load(t.Context(), cluster, "fx_dup", harness.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(t.Context(), cluster, "fx_dup", harness.Now()); err == nil {
		t.Fatal("second Load with the same name must fail: worlds never share databases")
	}
	if _, err := Load(t.Context(), cluster, "Bad-Name", harness.Now()); err == nil {
		t.Fatal("Load must reject names that are not [a-z][a-z0-9_]*")
	}
}
