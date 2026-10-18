//go:build integration

package review_test

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

	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/reservations" //nolint:depguard // integration test: a new reservation of the vehicle after the acceptance (W2.02)
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/review"       //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"              //nolint:depguard // integration test: role names of the test cluster
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: clock and PostgreSQL of the suites
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04
)

// The world of the package: the isolation fixtures (W1.04) without content; every test seeds its own shifts as W2.05
// leaves them after returnTrip.
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
	if world, err = fixtures.Load(ctx, c, "review", harness.Now()); err != nil {
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
	svc *review.Service
	res *reservations.Server // reserveVehicle of W2.02 on the same pools and clock
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
	svc := &review.Service{Pools: pools, Authz: ev, Recipients: inbox.PGRecipients{Control: control},
		Audience: inbox.AuthzAudience{E: ev}, Now: harness.Now}
	return env{dir: dir, svc: svc, res: &reservations.Server{Pools: pools, Evaluator: ev, Now: harness.Now}, now: harness.Now()}
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

// shift is a seeded trip as W2.05 leaves it after returnTrip: started two hours ago with its vehicle, the consumed
// reservation of the vehicle (the bundle of W2.02), the departure inspection at departKm and the return inspection at
// returnKm (W2.04), and two expenses waiting for the manager (claimed).
type shift struct {
	tenant                            string
	ID, Vehicle, Bundle               uuid.UUID
	Departure, Return                 uuid.UUID
	Number                            string
	Unit, Driver                      uuid.UUID
	Expenses                          []uuid.UUID
	PlannedStart, PlannedEnd, Started time.Time
}

const (
	departKm = 48250
	returnKm = 48296
)

// seedShift writes a shift of driver in unit (fixture key) in state (submitted — returned and waiting for the
// acceptance).
func seedShift(t *testing.T, tenant, unit string, driver uuid.UUID, state string) shift {
	t.Helper()
	now := harness.Now()
	return seedShiftAt(t, tenant, unit, driver, state, now.Add(-3*time.Hour), now.Add(3*time.Hour))
}

// seedShiftAt is seedShift with the planned window [from, until) of the trip (started two hours ago all the same).
func seedShiftAt(t *testing.T, tenant, unit string, driver uuid.UUID, state string, from, until time.Time) shift {
	t.Helper()
	d := db(t, tenant)
	n := seq.Add(1)
	now := harness.Now()
	sh := shift{tenant: tenant, ID: uuid.New(), Vehicle: uuid.New(), Bundle: uuid.New(),
		Number: "Р-" + strconv.FormatInt(700+n, 10), Unit: ref("unit:" + tenant + "." + unit), Driver: driver,
		PlannedStart: from, PlannedEnd: until, Started: now.Add(-2 * time.Hour)}
	exec(t, d, `insert into fleet.vehicles (id, unit_id, plate, body_type, payload_kg, volume_m3, cargo_length_mm, odometer_km, display_name)
	            values ($1, $2, $3, 'van', 1500, 12, 3200, 48210, 'ГАЗель Next')`, sh.Vehicle, sh.Unit, fmt.Sprintf("П %03d РМ 77", n))
	vres := uuid.New()
	exec(t, d, `insert into sched.resources (id, kind, ref_id, home_unit_id) values ($1, 'vehicle', $2, $3)`, vres, sh.Vehicle, sh.Unit)
	exec(t, d, `insert into fleet.trips (id, number, unit_id, state, vehicle_id, driver_person_id, reservation_bundle_id, planned,
	                                     started_at, route_completed_at, returned_at)
	            values ($1, $2, $3, $11, $4, $5, $6, tstzrange($7, $8), $9, $10, $10)`,
		sh.ID, sh.Number, sh.Unit, sh.Vehicle, driver, sh.Bundle, sh.PlannedStart, sh.PlannedEnd, sh.Started, now.Add(-15*time.Minute), state)
	exec(t, d, `insert into sched.reservations (id, resource_id, bundle_id, during, occupied, state, source_type, source_id, created_by)
	            values ($1, $2, $1, tstzrange($3, $4), tstzrange($3, $4), 'consumed', 'fleet.trip', $5, $6)`,
		sh.Bundle, vres, sh.PlannedStart, sh.PlannedEnd, sh.ID, driver)
	sh.Departure = inspect(t, sh, "departure", departKm, sh.Started.Add(-5*time.Minute))
	sh.Return = inspect(t, sh, "return", returnKm, now.Add(-10*time.Minute))
	for _, x := range []struct {
		kind    string
		amount  int64
		comment any
	}{{"wash", 50000, nil}, {"other", 30000, "Замена лампы фары"}} {
		id := uuid.New()
		exec(t, d, `insert into fleet.expenses (id, trip_id, category, amount_minor, occurred_on, comment, claimed_by)
		            values ($1, $2, $3, $4, $5::date, $6, $7)`, id, sh.ID, x.kind, x.amount, now, x.comment, driver)
		sh.Expenses = append(sh.Expenses, id)
	}
	return sh
}

// inspect writes a submitted inspection of kind for sh (odometer km) and points the trip at it.
func inspect(t *testing.T, sh shift, kind string, km int, at time.Time) uuid.UUID {
	t.Helper()
	d := db(t, sh.tenant)
	version := scalar[uuid.UUID](t, d, `insert into fleet.checklist_versions (kind, version, items) values ($1, 1, '[]')
	     on conflict (kind, version) do update set kind = excluded.kind returning id`, kind)
	id := uuid.New()
	exec(t, d, `insert into fleet.inspections (id, trip_id, vehicle_id, kind, checklist_version_id, odometer_km, fuel_level,
	                                           answers, state, submitted_by, submitted_at, attempt)
	            select $1, $2, $3, $4, $5, $6, 'three_quarters', jsonb_build_object('odometerKm', $9::text), 'submitted', $7, $8,
	                   coalesce(max(attempt), 0) + 1 from fleet.inspections where trip_id = $2 and kind = $4`,
		id, sh.ID, sh.Vehicle, kind, version, km, sh.Driver, at, strconv.Itoa(km))
	col := "departure_inspection_id"
	if kind == "return" {
		col = "return_inspection_id"
	}
	exec(t, d, `update fleet.trips set `+col+` = $2 where id = $1`, sh.ID, id)
	return id
}

// state reads the state and the revision of a trip.
func state(t *testing.T, sh shift) (string, int64) {
	t.Helper()
	var (
		s   string
		rev int64
	)
	if err := db(t, sh.tenant).QueryRowContext(t.Context(), `select state, revision from fleet.trips where id = $1`, sh.ID).
		Scan(&s, &rev); err != nil {
		t.Fatal(err)
	}
	return s, rev
}

func etag(rev int64) string { return `"` + strconv.FormatInt(rev, 10) + `"` }
