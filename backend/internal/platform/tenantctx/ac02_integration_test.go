//go:build integration

package tenantctx_test

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
	harness "github.com/ortus/ortus-crm/backend/test"
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures"
)

// world: the isolation fixtures (W0.15) — tenant A «Холдинг» and tenant B «Чужой клиент» in their own databases.
var world *fixtures.World

func TestMain(m *testing.M) {
	os.Exit(runMain(m))
}

func runMain(m *testing.M) int {
	ctx := context.Background()
	cluster, stop, err := harness.StartPostgres(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer stop()
	if world, err = fixtures.Load(ctx, cluster, "acz", harness.Now()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	return m.Run()
}

func mustID(t *testing.T, ref string) uuid.UUID {
	t.Helper()
	id, err := world.ID(ref)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// resolver is what the gateway of cmd/api builds per process: the control DB directory and the tenant DB pools,
// both as ortus_api.
func resolver(t *testing.T) (*tenantctx.PGDirectory, *tenantctx.Pools) {
	t.Helper()
	pool, err := pgxpool.New(t.Context(), world.ControlURL(migrations.RoleAPI))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	env := world.Env()
	dir := tenantctx.NewPGDirectory(pool)
	pools := tenantctx.NewPools(dir, func(k string) string { return env[k] }, env["TENANT_DB_HOST"])
	pools.RetryAfter = 0
	pools.Reserved = []string{world.ControlDB}
	t.Cleanup(pools.Close)
	return dir, pools
}

// AC-02 (15-quality-security.md:36): «Сессия тенанта A с tenantId B → 404, запрос не открывает пул B».
// Resolve отвечает тем же not_found, что для несуществующей организации, и пул B не открывается; своя организация
// открывает только свой пул.
func TestAC02ForeignTenantNeverOpensPool(t *testing.T) {
	t.Parallel()
	dir, pools := resolver(t)
	tenantA, tenantB := mustID(t, "tenant:a"), mustID(t, "tenant:b")
	for _, actor := range []string{"a.owner", "a.driver-msk1", "a.two-roles"} {
		a, err := world.Actor(actor)
		if err != nil {
			t.Fatal(err)
		}
		for _, target := range []string{tenantB.String(), uuid.NewString(), "not-a-uuid", ""} {
			for _, mutating := range []bool{false, true} {
				_, err := tenantctx.Resolve(t.Context(), dir, a.AccountID, target, mutating)
				if !problem.Is(err, problem.CodeNotFound) {
					t.Errorf("%s → %q (mutating %v): %v, want not_found", actor, target, mutating, err)
				}
			}
		}
	}
	if opened := pools.Opened(); len(opened) != 0 {
		t.Fatalf("pools opened before any tenant data was read: %v", opened)
	}

	owner, err := world.Actor("a.owner")
	if err != nil {
		t.Fatal(err)
	}
	tc, err := tenantctx.Resolve(t.Context(), dir, owner.AccountID, tenantA.String(), false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := (tenantctx.TenantData{Pools: pools}).Profile(t.Context(), tc); err != nil {
		t.Fatal(err)
	}
	if opened := pools.Opened(); len(opened) != 1 || opened[0] != tenantA {
		t.Fatalf("opened pools = %v, want only tenant A %s", opened, tenantA)
	}
}

// Ошибка реестра (02-architecture §3: «защищает от ошибки registry и перепутанного секрета»): маршрут A указывает
// на базу B или на control DB — пул не открывается и не кешируется, запросы A получают dependency_unavailable.
//
//nolint:paralleltest // rewrites tenant_routing of the shared fixtures; runs before the parallel tests
func TestAC02MisroutedTenantIsRefused(t *testing.T) {
	_, pools := resolver(t)
	tenantA, tenantB := mustID(t, "tenant:a"), mustID(t, "tenant:b")
	super := world.Cluster.DB(t, world.ControlDB, migratetest.Super)
	setRoute := func(tenant uuid.UUID, db string) {
		t.Helper()
		if _, err := super.ExecContext(context.WithoutCancel(t.Context()),
			`update tenant_routing set database_name = $2 where tenant_id = $1`, tenant, db); err != nil {
			t.Fatal(err)
		}
	}
	// database_name is unique: B is parked under another name while A points to B's database.
	setRoute(tenantB, "parked_b")
	route := func(db string) { setRoute(tenantA, db) }
	t.Cleanup(func() {
		route(world.TenantDBs[fixtures.TenantA])
		setRoute(tenantB, world.TenantDBs[fixtures.TenantB])
	})

	for name, db := range map[string]string{
		"database of tenant B": world.TenantDBs[fixtures.TenantB],
		"control DB":           world.ControlDB,
		"postgres":             "postgres",
	} {
		route(db)
		if _, err := pools.For(t.Context(), tenantA); !problem.Is(err, problem.CodeDependencyUnavailable) {
			t.Errorf("%s: %v, want dependency_unavailable", name, err)
		}
		if opened := pools.Opened(); len(opened) != 0 {
			t.Errorf("%s: pool cached: %v", name, opened)
		}
	}
}
