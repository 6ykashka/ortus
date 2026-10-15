//go:build integration

package people

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W1.05: shared helpers of org, people, importer (integratorNotes)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"              //nolint:depguard // integration test: roles of the fixture databases
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: PostgreSQL in testcontainers
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04 (3 regions × 4 firms)
)

// world is the fixture world of the isolation suite (W1.04). Tests that change people create their own cards.
var world *fixtures.World

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
	if world, err = fixtures.Load(ctx, c, "people", harness.Now()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	return m.Run()
}

type env struct {
	dir     *tenantctx.PGDirectory
	pools   *tenantctx.Pools
	control *pgxpool.Pool
	ev      *authz.Evaluator
	srv     *Server
}

// newEnv wires the server with the clock of the fixtures, shifted by later (a request made later).
func newEnv(t *testing.T, later time.Duration) env {
	t.Helper()
	control, err := pgxpool.New(t.Context(), world.ControlURL(migrations.RoleAPI))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(control.Close)
	vars := world.Env()
	dir := tenantctx.NewPGDirectory(control)
	pools := tenantctx.NewPools(dir, func(k string) string { return vars[k] }, vars["TENANT_DB_HOST"])
	t.Cleanup(pools.Close)
	now := func() time.Time { return harness.Now().Add(later) }
	src := authz.PGSource{Pools: pools}
	ev := authz.New(src, src, now)
	return env{dir: dir, pools: pools, control: control, ev: ev,
		srv: &Server{Pools: pools, Authz: ev, Directory: kit.ControlDirectory{DB: control}, Now: now}}
}

func (e env) tc(t *testing.T, actor string) tenantctx.TenantContext {
	t.Helper()
	a, err := world.Actor(actor)
	if err != nil {
		t.Fatal(err)
	}
	tc, err := tenantctx.Resolve(t.Context(), e.dir, a.AccountID, tenantA(t).String(), false)
	if err != nil {
		t.Fatal(err)
	}
	return tc
}

// as is the context of a request of actor in tenant A.
func (e env) as(t *testing.T, actor string) context.Context {
	t.Helper()
	return tenantctx.WithTenant(t.Context(), e.tc(t, actor))
}

func id(t *testing.T, ref string) uuid.UUID {
	t.Helper()
	v, err := world.ID(ref)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func tenantA(t *testing.T) uuid.UUID {
	t.Helper()
	return id(t, "tenant:a")
}

func (e env) pool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	p, err := e.pools.For(t.Context(), tenantA(t))
	if err != nil {
		t.Fatal(err)
	}
	return p
}
