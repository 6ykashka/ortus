//go:build integration

package fleet_test

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib" // database/sql driver "pgx"

	"github.com/ortus/ortus-crm/backend/internal/modules/data"       //nolint:depguard // the registry the provider plugs into
	"github.com/ortus/ortus-crm/backend/internal/modules/data/fleet" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"              //nolint:depguard // integration test: role names of the test cluster
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: clock and PostgreSQL of the suites
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04
)

// The world of the package: the isolation fixtures (W1.04) and the vehicles, trips, inspections, earnings and
// expenses of seed (seed_integration_test.go), written once before the tests; the tests only read.
var (
	world  *fixtures.World
	dbs    = map[string]*sql.DB{} // the tenant DBs as the superuser, one pool each
	seeded seedIDs
)

func TestMain(m *testing.M) {
	os.Exit(runMain(m))
}

func runMain(m *testing.M) int {
	ctx := context.Background()
	c, stop, err := harness.StartPostgres(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer stop()
	if world, err = fixtures.Load(ctx, c, "datafleet", harness.Now()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	for _, t := range []string{"a", "b"} {
		d, err := sql.Open("pgx", world.TenantURL(t, "super"))
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		d.SetMaxOpenConns(4)
		defer d.Close()
		dbs[t] = d
	}
	if seeded, err = seed(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "seed:", err)
		return 1
	}
	return m.Run()
}

func ref(r string) uuid.UUID {
	id, err := world.ID(r)
	if err != nil {
		panic(err)
	}
	return id
}

func person(actor, tenant string) uuid.UUID { return ref("person:" + actor + "@" + tenant) }

// states is the module registry of the tests: one state of logistics for every tenant ("" — not installed).
type states string

func (s states) States(context.Context, uuid.UUID) (map[string]string, error) {
	if s == "" {
		return map[string]string{}, nil
	}
	return map[string]string{fleet.ModuleKey: string(s)}, nil
}

// env is the service wired like cmd/api: tenant pools of ortus_api, the evaluator on the fixtures' clock and the
// registry with the logistics provider.
type env struct {
	dir *tenantctx.PGDirectory
	svc *data.Service
}

func newEnv(t *testing.T, state string) env {
	t.Helper()
	ctx := t.Context()
	control, err := pgxpool.New(ctx, world.ControlURL(migrations.RoleAPI))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(control.Close)
	vars := world.Env()
	dir := tenantctx.NewPGDirectory(control)
	pools := tenantctx.NewPools(dir, func(k string) string { return vars[k] }, vars["TENANT_DB_HOST"])
	t.Cleanup(pools.Close)
	src := authz.PGSource{Pools: pools}
	reg, err := data.NewRegistry(fleet.Provider{})
	if err != nil {
		t.Fatal(err)
	}
	return env{dir: dir, svc: &data.Service{
		Pools: pools, Authz: authz.New(src, src, harness.Now), Registry: reg, Modules: states(state), Now: harness.Now,
		Timeout: time.Minute,
	}}
}

// tc resolves the tenant context of actor in tenant («a» or «b»), as the gateway does.
func (e env) tc(t *testing.T, actor, tenant string) tenantctx.TenantContext {
	t.Helper()
	a, err := world.Actor(actor)
	if err != nil {
		t.Fatal(err)
	}
	tc, err := tenantctx.Resolve(t.Context(), e.dir, a.AccountID, ref("tenant:"+tenant).String(), true)
	if err != nil {
		t.Fatal(err)
	}
	return tc
}
