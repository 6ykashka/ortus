//go:build integration

package expenses_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib" // database/sql driver "pgx"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/expenses" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"              //nolint:depguard // integration test: role names of the test cluster
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: clock and PostgreSQL of the suites
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04
)

var (
	world *fixtures.World
	dbs   = map[string]*sql.DB{}
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
	if world, err = fixtures.Load(ctx, c, "expenses", harness.Now()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	for _, t := range []string{"a", "b"} {
		d, err := sql.Open("pgx", world.TenantURL(t, "super"))
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		d.SetMaxOpenConns(8)
		defer d.Close()
		dbs[t] = d
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

type env struct {
	dir *tenantctx.PGDirectory
	svc *expenses.Service
	now time.Time
}

func newEnv(t *testing.T) env {
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
	ev := authz.New(src, src, harness.Now)
	return env{dir: dir, svc: &expenses.Service{Pools: pools, Authz: ev, Now: harness.Now}, now: harness.Now()}
}

func (e env) tc(t *testing.T, actor, tenant string) tenantctx.TenantContext {
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

func exec(t *testing.T, d *sql.DB, q string, args ...any) {
	t.Helper()
	if _, err := d.ExecContext(t.Context(), q, args...); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
}

func scalar[T any](t *testing.T, d *sql.DB, q string, args ...any) T {
	t.Helper()
	var v T
	if err := d.QueryRowContext(t.Context(), q, args...).Scan(&v); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
	return v
}

func wantProblem(t *testing.T, err error, code, detail string) {
	t.Helper()
	pe, ok := errors.AsType[*problem.Error](err)
	if !ok || pe.Code != code || (detail != "" && pe.Detail != detail) {
		t.Fatalf("error %v, want %s %q", err, code, detail)
	}
}

func expect(t *testing.T, what string, got any, checks ...bool) {
	t.Helper()
	for i, ok := range checks {
		if !ok {
			t.Fatalf("%s: check %d of %d failed: %+v", what, i+1, len(checks), got)
		}
	}
}

var seq atomic.Int64

// trip is a seeded started trip of a driver.
type trip struct {
	ID, Vehicle, Unit, Driver uuid.UUID
}

// seedTrip writes a started trip of the driver in unit (fixture key) in state; rework by default keeps the driver
// free for other trips (trips_active_driver_uq covers on_route and returning only).
func seedTrip(t *testing.T, unit string, driver uuid.UUID, state string) trip {
	t.Helper()
	d := dbs["a"]
	n := seq.Add(1)
	tr := trip{ID: uuid.New(), Vehicle: uuid.New(), Unit: ref("unit:a." + unit), Driver: driver}
	now := harness.Now()
	exec(t, d, `insert into fleet.vehicles (id, unit_id, plate, body_type, payload_kg, volume_m3, cargo_length_mm, odometer_km, display_name)
	            values ($1, $2, $3, 'van', 1500, 12, 3200, 48210, 'ГАЗель Next')`, tr.Vehicle, tr.Unit, fmt.Sprintf("Р %03d СХ 77", n))
	exec(t, d, `insert into fleet.trips (id, number, unit_id, state, vehicle_id, driver_person_id, planned, title, started_at,
	                                     route_completed_at)
	            values ($1, $2, $3, $4, $5, $6, tstzrange($7, $8), 'Северный маршрут', $7, case when $4 = 'returning' then $8 end)`,
		tr.ID, "Р-"+strconv.FormatInt(700+n, 10), tr.Unit, state, tr.Vehicle, driver, now.Add(-2*time.Hour), now.Add(2*time.Hour))
	return tr
}

// receipt writes a receipt file of the parent trip in state.
func receipt(t *testing.T, owner uuid.UUID, purpose, state string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	exec(t, dbs["a"], `insert into files.objects (id, object_key, state, purpose, owner_type, owner_id, declared_mime, bytes,
	                                              uploaded_by, ready_at)
	     values ($1::uuid, 'files/'||$1::text, $2::text, $3, 'fleet.trip', $4, 'image/jpeg', 2048, $5,
	             case when $2::text = 'ready' then now() end)`,
		id, state, purpose, owner, person("a.driver-msk1"))
	return id
}

func wash(t *testing.T, tr trip) fleetapi.TripExpenseCreate {
	t.Helper()
	return fleetapi.TripExpenseCreate{Kind: "wash", OccurredAt: time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC),
		Amount: fleetapi.Money{AmountMinor: 50000, Currency: "RUB"}, ReceiptFileIds: []uuid.UUID{receipt(t, tr.ID, "expense_receipt", "ready")}}
}
