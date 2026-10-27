//go:build integration

package spa_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	invapi "github.com/ortus/ortus-crm/backend/internal/api/inventory"
	api "github.com/ortus/ortus-crm/backend/internal/api/spa"
	"github.com/ortus/ortus-crm/backend/internal/modules/inventory" //nolint:depguard // integration test: the stock the visits consume from
	"github.com/ortus/ortus-crm/backend/internal/modules/spa"       //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"              //nolint:depguard // integration test: role names of the test cluster
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"  //nolint:depguard // integration test: the superuser that writes the data of the tests
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: clock and PostgreSQL of the suites
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04
)

// The world of the package: the isolation fixtures of W1.04 and the services wired like cmd/api. Every test makes its
// own rooms, warehouses and items and books on a day of its own, so tests run in parallel without meeting.
var (
	world  *fixtures.World
	superA *pgxpool.Pool // tenant DB of A as the superuser
	e      env
	days   atomic.Int64
)

type env struct {
	dir    *tenantctx.PGDirectory
	svc    *spa.Service
	inv    *inventory.Service
	offers *offers
}

// offers records the proposals of the visits to the cash desks (the port of cmd/api is tested there).
type offers struct {
	mu  sync.Mutex
	got []spa.VisitOffer
}

func (o *offers) OfferVisit(_ context.Context, _ pgx.Tx, v spa.VisitOffer) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.got = append(o.got, v)
	return nil
}

func (o *offers) of(id uuid.UUID) []spa.VisitOffer {
	o.mu.Lock()
	defer o.mu.Unlock()
	var out []spa.VisitOffer
	for _, v := range o.got {
		if v.AppointmentID == id {
			out = append(out, v)
		}
	}
	return out
}

// serviceNow is the clock of the module under test: the visits of the tests are booked on days after the fixed «now» of
// the suites, and the fact of a treatment cannot be recorded in the future, so the clock stands 100 days later.
func serviceNow() time.Time { return harness.Now().AddDate(0, 0, 100) }

func TestMain(m *testing.M) { os.Exit(runMain(m)) }

func runMain(m *testing.M) int {
	ctx := context.Background()
	c, stop, err := harness.StartPostgres(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer stop()
	if world, err = fixtures.Load(ctx, c, "spa", harness.Now()); err != nil {
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
	inv := &inventory.Service{Pools: pools, Authz: ev, Now: harness.Now}
	off := &offers{}
	e = env{dir: dir, inv: inv, offers: off, svc: &spa.Service{Pools: pools, Authz: ev, Stock: inv, Offers: off, Now: serviceNow}}
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

// person is the person profile of a member of A: the practitioner of a visit.
func person(key string) uuid.UUID { return ref("person:" + key + "@a") }

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

// must returns v or panics: the test of the panic fails with the error and its stack.
func must[T any](v T, err error) T {
	if err != nil {
		panic(err)
	}
	return v
}

func wantProblem(t *testing.T, err error, code string) {
	t.Helper()
	if !problem.Is(err, code) {
		t.Fatalf("error %v, want %s", err, code)
	}
}

func wantRefusal(t *testing.T, err error, code, reason, field string) *spa.RefusalError {
	t.Helper()
	f, ok := errors.AsType[*spa.RefusalError](err)
	if !ok || f.Code != code || f.Reason != reason || (field != "" && f.Field != field) {
		t.Fatalf("error %v, want %s / %q / %q", err, code, reason, field)
	}
	return f
}

func superExec(t *testing.T, q string, args ...any) {
	t.Helper()
	if _, err := superA.Exec(t.Context(), q, args...); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
}

func superInt(t *testing.T, q string, args ...any) int {
	t.Helper()
	var n int
	if err := superA.QueryRow(t.Context(), q, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
	return n
}

// day is a calendar day of its own for the test (Moscow, after the fixed «now» of the suites).
func day() time.Time {
	msk, err := time.LoadLocation("Europe/Moscow")
	if err != nil {
		panic(err)
	}
	n := harness.Now().In(msk)
	return time.Date(n.Year(), n.Month(), n.Day()+1+int(days.Add(1)), 0, 0, 0, 0, msk)
}

// clock is the instant of «HH:MM» of the day in Moscow.
func clock(d time.Time, hh, mm int) time.Time {
	return d.Add(time.Duration(hh)*time.Hour + time.Duration(mm)*time.Minute).UTC()
}

// resource makes a room or an equipment item of the unit (sched.resources) and returns its id.
func resource(t *testing.T, kind string, u uuid.UUID) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := superA.QueryRow(t.Context(), `insert into sched.resources (kind, home_unit_id, label) values ($1, $2, $3) returning id`,
		kind, u, kind+" "+sfx()).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func money(minor int) api.Money { return api.Money{AmountMinor: minor, Currency: "RUB"} }

func warehouse(t *testing.T, tc tenantctx.TenantContext) invapi.Warehouse {
	t.Helper()
	return must(e.inv.CreateWarehouse(t.Context(), tc, invapi.WarehouseCreate{Name: "Склад салона " + sfx(), OrgUnitId: unit("msk1")}))
}

func material(t *testing.T, tc tenantctx.TenantContext, base invapi.InventoryItemCreateBaseUnit) invapi.InventoryItem {
	t.Helper()
	return must(e.inv.CreateItem(t.Context(), tc, invapi.InventoryItemCreate{
		Name: "Материал " + sfx(), Sku: "SPA-" + sfx(), BaseUnit: base, TrackLots: true, OrgUnitId: unit("msk1")}))
}

func receive(t *testing.T, tc tenantctx.TenantContext, wh invapi.Warehouse, it invapi.InventoryItem, qty string) {
	t.Helper()
	must(e.inv.PostMovement(t.Context(), tc, invapi.InventoryMovementCreate{Kind: invapi.InventoryMovementCreateKindReceipt, WarehouseId: wh.Id,
		Lines: []invapi.InventoryMovementLine{{ItemId: it.Id, Quantity: qty}}}))
}

func onHand(t *testing.T, tc tenantctx.TenantContext, wh invapi.Warehouse, it invapi.InventoryItem) string {
	t.Helper()
	page := must(e.inv.ListBalances(t.Context(), tc, inventory.BalanceQuery{WarehouseID: &wh.Id, ItemID: &it.Id}))
	if len(page.Items) == 0 {
		return "0"
	}
	return page.Items[0].OnHand
}

// treatment makes a service of Москва-1 (60 minutes, 5 minutes of preparation, 15 of cleaning) with the recipe.
func treatment(t *testing.T, tc tenantctx.TenantContext, equipment []uuid.UUID, recipe ...api.ConsumptionRecipeLine) api.SpaService {
	t.Helper()
	if equipment == nil {
		equipment = []uuid.UUID{}
	}
	if recipe == nil {
		recipe = []api.ConsumptionRecipeLine{}
	}
	return must(e.svc.CreateService(t.Context(), tc, api.SpaServiceCreate{OrgUnitId: unit("msk1"), Name: "Массаж " + sfx(), DurationMinutes: 60,
		BufferBeforeMinutes: 5, BufferAfterMinutes: 15, Price: money(450000), RequiredEquipmentIds: equipment, Recipe: recipe}))
}

func recipeLine(it invapi.InventoryItem, qty string, unit api.ConsumptionRecipeLineUnit) api.ConsumptionRecipeLine {
	return api.ConsumptionRecipeLine{ItemId: it.Id, Quantity: qty, Unit: unit}
}

// booking is a request of a visit at the instant.
func booking(svc api.SpaService, practitioner, room uuid.UUID, equipment []uuid.UUID, start time.Time) api.AppointmentCreate {
	if equipment == nil {
		equipment = []uuid.UUID{}
	}
	return api.AppointmentCreate{OrgUnitId: svc.OrgUnitId, ServiceId: svc.Id, ClientId: uuid.New(), PractitionerMemberId: practitioner,
		RoomId: room, EquipmentIds: equipment, StartsAt: start, TimeZone: "Europe/Moscow"}
}

func book(t *testing.T, tc tenantctx.TenantContext, b api.AppointmentCreate) api.Appointment {
	t.Helper()
	return must(e.svc.CreateAppointment(t.Context(), tc, b))
}

func tag(a api.Appointment) string { return fmt.Sprintf(`"rev-%d"`, a.Revision) }

// grant gives the member a role with the actions in the scope (self: no scope_ref; warehouse: the id of the warehouse).
func grant(t *testing.T, member, scopeKind string, scopeRef *uuid.UUID, actions ...string) {
	t.Helper()
	role, by := uuid.New(), ref("person:a.owner@a")
	superExec(t, `insert into access.roles (id, name, kind) values ($1, $2, 'custom')`, role, "Мастер "+sfx())
	superExec(t, `insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`, role, actions, by)
	superExec(t, `insert into access.role_assignments (principal_kind, principal_id, role_id, role_version, scope_kind, scope_ref,
		include_descendants, valid, granted_by) values ('person', $1, $2, 1, $3, $4, false, tstzrange('2026-01-01 00:00Z', null), $5)`,
		ref("person:"+member+"@a"), role, scopeKind, scopeRef, by)
}
