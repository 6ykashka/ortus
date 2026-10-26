//go:build integration

package inventory_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	api "github.com/ortus/ortus-crm/backend/internal/api/inventory"
	"github.com/ortus/ortus-crm/backend/internal/modules/inventory" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"              //nolint:depguard // integration test: role names of the test cluster
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"  //nolint:depguard // integration test: the superuser that writes the data of the tests
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: clock and PostgreSQL of the suites
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04
)

// The world of the package: the isolation fixtures of W1.04 and the service wired like cmd/api. Every test creates its
// own warehouses and items (names and skus carry a unique suffix) and never touches those of another test.
var (
	world  *fixtures.World
	superA *pgxpool.Pool // tenant DB of A as the superuser
	e      env
)

type env struct {
	dir *tenantctx.PGDirectory
	svc *inventory.Service
}

func TestMain(m *testing.M) { os.Exit(runMain(m)) }

func runMain(m *testing.M) int {
	ctx := context.Background()
	c, stop, err := harness.StartPostgres(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer stop()
	if world, err = fixtures.Load(ctx, c, "inventory", harness.Now()); err != nil {
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
	dir := tenantctx.NewPGDirectory(control)
	pools := tenantctx.NewPools(dir, func(k string) string { return vars[k] }, vars["TENANT_DB_HOST"])
	defer pools.Close()
	src := authz.PGSource{Pools: pools}
	ev := authz.New(src, src, harness.Now)
	e = env{dir: dir, svc: &inventory.Service{Pools: pools, Authz: ev, Now: harness.Now}}
	return m.Run()
}

func ref(r string) uuid.UUID {
	id, err := world.ID(r)
	if err != nil {
		panic(err)
	}
	return id
}

func unit(key string) uuid.UUID { return ref("unit:a." + key) }

func as(t *testing.T, actor, tenant string) tenantctx.TenantContext {
	t.Helper()
	a, err := world.Actor(actor)
	if err != nil {
		t.Fatal(err)
	}
	tc, err := tenantctx.Resolve(t.Context(), e.dir, a.AccountID, ref("tenant:"+tenant).String(), false)
	if err != nil {
		t.Fatal(err)
	}
	return tc
}

func owner(t *testing.T) tenantctx.TenantContext {
	t.Helper()
	return as(t, "a.owner", "a")
}

func sfx() string { return uuid.NewString()[:8] }

// must returns v or panics: the test of the panic fails with the error and its stack (a call of must takes the result
// of a service call as its only arguments, so it cannot carry the *testing.T).
func must[T any](v T, err error) T {
	if err != nil {
		panic(err)
	}
	return v
}

func wantFailure(t *testing.T, err error, code, reason string) {
	t.Helper()
	f, ok := errors.AsType[*inventory.RefusalError](err)
	if !ok || f.Code != code || f.Reason != reason {
		t.Fatalf("error %v, want %s / %q", err, code, reason)
	}
}

func wantProblem(t *testing.T, err error, code string) {
	t.Helper()
	if !problem.Is(err, code) {
		t.Fatalf("error %v, want %s", err, code)
	}
}

func warehouse(t *testing.T, tc tenantctx.TenantContext, u uuid.UUID) api.Warehouse {
	t.Helper()
	return must(e.svc.CreateWarehouse(t.Context(), tc, api.WarehouseCreate{Name: "Склад " + sfx(), OrgUnitId: u}))
}

func item(t *testing.T, tc tenantctx.TenantContext, tracked bool) api.InventoryItem {
	t.Helper()
	return must(e.svc.CreateItem(t.Context(), tc, api.InventoryItemCreate{
		Name: "Масло " + sfx(), Sku: "SKU-" + sfx(), BaseUnit: api.InventoryItemCreateBaseUnitMl, TrackLots: tracked, OrgUnitId: unit("msk1")}))
}

// expiring is the line with an expiry date (a field of a type of the generator runtime, set without naming it: depguard).
func expiring(l api.InventoryMovementLine, day string) api.InventoryMovementLine {
	d, err := time.Parse(time.DateOnly, day)
	if err != nil {
		panic(err)
	}
	alloc(&l.ExpiresOn).Time = d
	return l
}

func alloc[T any](p **T) *T {
	*p = new(T)
	return *p
}

func line(it api.InventoryItem, qty string) api.InventoryMovementLine {
	return api.InventoryMovementLine{ItemId: it.Id, Quantity: qty}
}

func post(t *testing.T, tc tenantctx.TenantContext, b api.InventoryMovementCreate) (api.InventoryMovement, error) {
	t.Helper()
	return e.svc.PostMovement(t.Context(), tc, b)
}

func receive(t *testing.T, tc tenantctx.TenantContext, wh api.Warehouse, it api.InventoryItem, qty, expires string) api.InventoryMovement {
	t.Helper()
	l := line(it, qty)
	if expires != "" {
		l = expiring(l, expires)
	}
	return must(e.svc.PostMovement(t.Context(), tc, api.InventoryMovementCreate{
		Kind: api.InventoryMovementCreateKindReceipt, WarehouseId: wh.Id, Lines: []api.InventoryMovementLine{l}}))
}

// balance returns the balance of the item in the warehouse (a zero value when there is none).
func balance(t *testing.T, tc tenantctx.TenantContext, wh api.Warehouse, it api.InventoryItem) api.InventoryBalance {
	t.Helper()
	page := must(e.svc.ListBalances(t.Context(), tc, inventory.BalanceQuery{WarehouseID: &wh.Id, ItemID: &it.Id}))
	if len(page.Items) == 0 {
		return api.InventoryBalance{OnHand: "0", Reserved: "0", Available: "0"}
	}
	return page.Items[0]
}

func wantStock(t *testing.T, b api.InventoryBalance, onHand, reserved, available string) {
	t.Helper()
	if b.OnHand != onHand || b.Reserved != reserved || b.Available != available {
		t.Fatalf("balance onHand=%s reserved=%s available=%s, want %s / %s / %s: %+v", b.OnHand, b.Reserved, b.Available, onHand, reserved, available, b)
	}
}

func superExec(t *testing.T, q string, args ...any) {
	t.Helper()
	if _, err := superA.Exec(t.Context(), q, args...); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
}
