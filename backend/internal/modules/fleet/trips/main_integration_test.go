//go:build integration

package trips_test

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

	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/trips" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"              //nolint:depguard // integration test: role names of the test cluster
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: clock and PostgreSQL of the suites
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04
)

// The world of the package: the isolation fixtures (W1.04) without content; every test seeds its own vehicles,
// trips, reservations and inspections as W2.02 and W2.04 leave them.
var (
	world *fixtures.World
	dbs   = map[string]*sql.DB{} // the tenant DBs as the superuser
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
	if world, err = fixtures.Load(ctx, c, "trips", harness.Now()); err != nil {
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

// env is the module wired like cmd/api: tenant pools of ortus_api, the evaluator on the fixtures' clock, the
// memberships of the control DB and the audience of the inbox (W1.10).
type env struct {
	dir *tenantctx.PGDirectory
	svc *trips.Service
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
	svc := &trips.Service{Pools: pools, Authz: ev, Recipients: inbox.PGRecipients{Control: control},
		Audience: inbox.AuthzAudience{E: ev}, Now: harness.Now}
	return env{dir: dir, svc: svc, now: harness.Now()}
}

// tc resolves the tenant context of actor in tenant («a» or «b»), as the gateway does.
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

func db(t *testing.T, tenant string) *sql.DB {
	t.Helper()
	d, ok := dbs[tenant]
	if !ok {
		t.Fatalf("no tenant %q", tenant)
	}
	return d
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

// wantProblem fails unless err is a Problem with code (and detail, when not empty).
func wantProblem(t *testing.T, err error, code, detail string) {
	t.Helper()
	pe, ok := errors.AsType[*problem.Error](err)
	if !ok || pe.Code != code || (detail != "" && pe.Detail != detail) {
		t.Fatalf("error %v, want %s %q", err, code, detail)
	}
}

// expect fails the test at the first false check, printing what was checked.
func expect(t *testing.T, what string, got any, checks ...bool) {
	t.Helper()
	for i, ok := range checks {
		if !ok {
			t.Fatalf("%s: check %d of %d failed: %+v", what, i+1, len(checks), got)
		}
	}
}

var seq atomic.Int64

// trip is a seeded trip in state «inspection» with its vehicle, the held reservation of the vehicle and the driver
// (the bundle of W2.02: the row of the vehicle carries the id of the bundle) and a submitted departure inspection
// (W2.04).
type trip struct {
	tenant                     string
	ID, Vehicle, Reservation   uuid.UUID
	Departure                  uuid.UUID
	Number, Plate, VehicleName string
	Unit, Driver               uuid.UUID
}

const startKm = 48250

// seedTrip writes a trip of the driver in unit (fixture key) ready for its start.
func seedTrip(t *testing.T, tenant, unit string, driver uuid.UUID) trip {
	t.Helper()
	d := db(t, tenant)
	n := seq.Add(1)
	tr := trip{tenant: tenant, ID: uuid.New(), Vehicle: uuid.New(), Reservation: uuid.New(),
		Number: "Р-" + strconv.FormatInt(500+n, 10), Plate: fmt.Sprintf("Т %03d РС 77", n), VehicleName: "ГАЗель Next",
		Unit: ref("unit:" + tenant + "." + unit), Driver: driver}
	now := harness.Now()
	exec(t, d, `insert into fleet.vehicles (id, unit_id, plate, body_type, payload_kg, volume_m3, cargo_length_mm, odometer_km, display_name)
	            values ($1, $2, $3, 'van', 1500, 12, 3200, 48210, $4)`, tr.Vehicle, tr.Unit, tr.Plate, tr.VehicleName)
	vres := uuid.New()
	exec(t, d, `insert into sched.resources (id, kind, ref_id, home_unit_id) values ($1, 'vehicle', $2, $3)`, vres, tr.Vehicle, tr.Unit)
	exec(t, d, `insert into fleet.trips (id, number, unit_id, state, vehicle_id, driver_person_id, reservation_bundle_id, planned,
	                                     title, cargo_description, cargo_weight_kg, cargo_volume_m3, cargo_length_mm, distance_km)
	            values ($1, $2, $3, 'inspection', $4, $5, $6, tstzrange($7, $8), 'Северный маршрут',
	                    'Сухой груз · 14 паллет-мест', 1100, 12, 3000, 46)`,
		tr.ID, tr.Number, tr.Unit, tr.Vehicle, driver, tr.Reservation, now.Add(-90*time.Minute), now.Add(150*time.Minute))
	exec(t, d, `insert into fleet.trip_stops (trip_id, seq, op, address, time_window, weight_kg, volume_m3)
	            values ($1, 1, 'load', 'Склад № 1, Лобня', tstzrange($2, $2, '[]'), 1100, 12),
	                   ($1, 2, 'unload', 'Химки, ул. Заводская, 8', tstzrange($3, $3, '[]'), 700, 8)`,
		tr.ID, now.Add(-90*time.Minute), now.Add(-15*time.Minute))
	// The row of the vehicle of the bundle (its id is the id of the bundle, W2.02); the row of the driver is left out:
	// one driver holds many seeded trips of overlapping windows here.
	exec(t, d, `insert into sched.reservations (id, resource_id, bundle_id, during, occupied, state, hold_expires_at,
	                                            source_type, source_id, created_by)
	            values ($1, $2, $1, tstzrange($3, $4), tstzrange($3, $4), 'hold', $5, 'fleet.trip', $6, $7)`,
		tr.Reservation, vres, now.Add(-90*time.Minute), now.Add(150*time.Minute), now.Add(30*time.Minute), tr.ID, driver)
	tr.Departure = inspect(t, tr, "departure", startKm, now.Add(-10*time.Minute))
	return tr
}

// inspect writes a submitted inspection of kind for tr (odometer km) and points the trip at it.
func inspect(t *testing.T, tr trip, kind string, km int, at time.Time) uuid.UUID {
	t.Helper()
	d := db(t, tr.tenant)
	version := scalar[uuid.UUID](t, d, `insert into fleet.checklist_versions (kind, version, items) values ($1, 1, '[]')
	     on conflict (kind, version) do update set kind = excluded.kind returning id`, kind)
	id := uuid.New()
	exec(t, d, `insert into fleet.inspections (id, trip_id, vehicle_id, kind, checklist_version_id, odometer_km, fuel_level,
	                                           answers, state, submitted_by, submitted_at, attempt)
	            select $1, $2, $3, $4, $5, $6, 'three_quarters', jsonb_build_object('odometerKm', $9::text), 'submitted', $7, $8,
	                   coalesce(max(attempt), 0) + 1 from fleet.inspections where trip_id = $2 and kind = $4`,
		id, tr.ID, tr.Vehicle, kind, version, km, tr.Driver, at, strconv.Itoa(km))
	col := "departure_inspection_id"
	if kind == "return" {
		col = "return_inspection_id"
	}
	exec(t, d, `update fleet.trips set `+col+` = $2, revision = revision + 1 where id = $1`, tr.ID, id)
	return id
}

// release ends the active trip tr at the end of the test: one driver has one trip on the route at a time
// (trips_active_driver_uq).
func release(t *testing.T, tr trip) {
	t.Helper()
	t.Cleanup(func() {
		_, _ = db(t, tr.tenant).ExecContext(context.Background(), `update fleet.trips set state = 'accepted'
		  where id = $1 and state in ('on_route', 'returning', 'submitted', 'rework')`, tr.ID)
	})
}

// state reads the state and the revision of a trip.
func state(t *testing.T, tr trip) (string, int64) {
	t.Helper()
	var (
		s   string
		rev int64
	)
	if err := db(t, tr.tenant).QueryRowContext(t.Context(), `select state, revision from fleet.trips where id = $1`, tr.ID).
		Scan(&s, &rev); err != nil {
		t.Fatal(err)
	}
	return s, rev
}

func etag(rev int64) string { return `"` + strconv.FormatInt(rev, 10) + `"` }
