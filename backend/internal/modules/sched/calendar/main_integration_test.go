//go:build integration

package calendar

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"              //nolint:depguard // integration test: role names of the test cluster
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"  //nolint:depguard // integration test: the superuser that writes the calendar
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: clock and PostgreSQL of the suites
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04
)

// The world of the package: the isolation fixtures (W1.04, with their vehicles) and the calendar of the prototype
// day written into tenant A by sharedDay (fixture_integration_test.go). Tests that change bookings build their
// own day on their own resources (Москва-3) and never touch the shared one.
var (
	world  *fixtures.World
	superA *pgxpool.Pool // tenant DB of A as the superuser: the calendar of the tests
	pools  *tenantctx.Pools
	dir    *tenantctx.PGDirectory
	ev     *authz.Evaluator
	shared day
)

func TestMain(m *testing.M) { os.Exit(runMain(m)) }

func runMain(m *testing.M) int {
	ctx := context.Background()
	c, stop, err := harness.StartPostgres(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer stop()
	if world, err = fixtures.Load(ctx, c, "calendar", harness.Now(), fixtures.WithContent()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if superA, err = pgxpool.New(ctx, world.TenantURL(fixtures.TenantA, migratetest.Super)); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer superA.Close()
	control, err := pgxpool.New(ctx, world.ControlURL(migrations.RoleAPI))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer control.Close()
	vars := world.Env()
	dir = tenantctx.NewPGDirectory(control)
	pools = tenantctx.NewPools(dir, func(k string) string { return vars[k] }, vars["TENANT_DB_HOST"])
	defer pools.Close()
	src := authz.PGSource{Pools: pools}
	ev = authz.New(src, src, harness.Now)
	if err := grantCalendar(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "grants:", err)
		return 1
	}
	if shared, err = sharedDay(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "calendar:", err)
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

func person(actor string) uuid.UUID { return ref("person:" + actor + "@a") }

func unit(key string) uuid.UUID { return ref("unit:a." + key) }

// states is the module registry of a test: module key → state.
type states map[string]string

func (s states) States(context.Context, uuid.UUID) (map[string]string, error) { return s, nil }

// Module states of the tests: SPA only (the calendar of the prototype without «Логистика»), and both.
var (
	spaOnly   = states{"spa": "active"}
	withFleet = states{"spa": "active", "fleet": "active"}
)

// service is the calendar wired like cmd/api over the module states m.
func service(m Modules) *Service {
	return &Service{Pools: pools, Authz: ev, Modules: m, Now: harness.Now}
}

// as resolves the tenant context of actor in tenant A, as the gateway does.
func as(t *testing.T, actor string) tenantctx.TenantContext {
	t.Helper()
	a, err := world.Actor(actor)
	if err != nil {
		t.Fatal(err)
	}
	tc, err := tenantctx.Resolve(t.Context(), dir, a.AccountID, ref("tenant:a").String(), true)
	if err != nil {
		t.Fatal(err)
	}
	return tc
}

// at is an instant of October 2026 in Moscow.
func at(dd, hh, mm int) time.Time { return time.Date(2026, 10, dd, hh, mm, 0, 0, moscow) }
