//go:build integration

package reservations

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"              //nolint:depguard // integration test: roles of the fixture databases
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: PostgreSQL in testcontainers
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04 (3 regions × 4 firms)
)

// world is the fixture world of the isolation suite (W1.04) without its content: the tests register their vehicles,
// drivers and trips. Actors of the fixtures: a.driver-msk2 — a driver with a temporary assignment on Москва-1,
// a.manager-msk1 — the manager of Москва-1 (no fleet.reservations.create), a.owner.
var world *fixtures.World

func TestMain(m *testing.M) { os.Exit(runMain(m)) }

func runMain(m *testing.M) int {
	ctx := context.Background()
	c, stop, err := harness.StartPostgres(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer stop()
	if world, err = fixtures.Load(ctx, c, "reservations", harness.Now()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	return m.Run()
}

type env struct {
	dir   *tenantctx.PGDirectory
	pools *tenantctx.Pools // DefaultMaxConns (4) per tenant, as cmd/api
	srv   *Server
}

func newEnv(t *testing.T) env {
	t.Helper()
	control, err := pgxpool.New(t.Context(), world.ControlURL(migrations.RoleAPI))
	require.NoError(t, err)
	t.Cleanup(control.Close)
	vars := world.Env()
	dir := tenantctx.NewPGDirectory(control)
	pools := tenantctx.NewPools(dir, func(k string) string { return vars[k] }, vars["TENANT_DB_HOST"])
	t.Cleanup(pools.Close)
	src := authz.PGSource{Pools: pools}
	return env{dir: dir, pools: pools, srv: &Server{Pools: pools, Evaluator: authz.New(src, src, harness.Now), Now: harness.Now}}
}

// as is the context of a request of actor in tenant A, as the gateway builds it.
func (e env) as(t *testing.T, actor string) context.Context {
	t.Helper()
	a, err := world.Actor(actor)
	require.NoError(t, err)
	tc, err := tenantctx.Resolve(t.Context(), e.dir, a.AccountID, id(t, "tenant:a").String(), false)
	require.NoError(t, err)
	return tenantctx.WithTenant(t.Context(), tc)
}

func id(t *testing.T, ref string) uuid.UUID {
	t.Helper()
	v, err := world.ID(ref)
	require.NoError(t, err)
	return v
}

// pool is the tenant DB of A as ortus_api, for the rows the API does not write.
func (e env) pool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	p, err := e.pools.For(t.Context(), id(t, "tenant:a"))
	require.NoError(t, err)
	return p
}

// day is midnight UTC of 1 October 2026 + n days (the clock of the suite is 1 October 10:30 MSK): every test takes
// its own days, so that the drivers of the fixtures are free in its windows.
func day(n, hh int) time.Time { return time.Date(2026, 10, 1+n, hh, 0, 0, 0, time.UTC) }

// vehicleOf registers a vehicle of unit (a key of tenant A) with payload kg, volume m³ and cargo length mm.
func (e env) vehicleOf(t *testing.T, unit string, payload, volume string, lengthMM int, service string) uuid.UUID {
	t.Helper()
	if service == "" {
		service = "ok"
	}
	var vid uuid.UUID
	require.NoError(t, e.pool(t).QueryRow(t.Context(), `insert into fleet.vehicles
		(unit_id, plate, display_name, body_type, payload_kg, volume_m3, cargo_length_mm, odometer_km, service_state)
		values ($1, $2, 'Машина', 'van', $3::numeric, $4::numeric, $5, 1000, $6) returning id`,
		id(t, "unit:a."+unit), "Б "+strings.ToUpper(uuid.NewString()[:8]), payload, volume, lengthMM, service).Scan(&vid))
	return vid
}

// vehicle is a vehicle of Москва-1 that fits the cargo of the trips of these tests (1,5 т · 16 м³ · 4,2 м).
func (e env) vehicle(t *testing.T) uuid.UUID {
	t.Helper()
	return e.vehicleOf(t, "msk1", "1500", "16", 4200, "")
}

// driver registers a person of Москва-1 with the work function «Водитель» since a month.
func (e env) driver(t *testing.T) uuid.UUID {
	t.Helper()
	ctx, pool := t.Context(), e.pool(t)
	var pid uuid.UUID
	require.NoError(t, pool.QueryRow(ctx, `insert into people.person_profiles (full_name, home_unit_id) values ('Водитель', $1)
		returning id`, id(t, "unit:a.msk1")).Scan(&pid))
	_, err := pool.Exec(ctx, `insert into people.work_profiles (person_id, function, unit_id, valid)
		values ($1, 'driver', $2, tstzrange($3, null))`, pid, id(t, "unit:a.msk1"), harness.Now().AddDate(0, -1, 0))
	require.NoError(t, err)
	return pid
}

// trip registers a trip of unit with the driver, the state and the planned window; its cargo is 1,1 т · 12 м³ · 3 м
// (Р-208 of the prototype). A started trip gets the vehicle.
func (e env) trip(t *testing.T, unit string, driver uuid.UUID, state string, from, until time.Time, vehicle *uuid.UUID) uuid.UUID {
	t.Helper()
	var started *time.Time
	if state == "on_route" {
		s := harness.Now().Add(-time.Hour)
		started = &s
	}
	var tid uuid.UUID
	require.NoError(t, e.pool(t).QueryRow(t.Context(), `insert into fleet.trips
		(number, unit_id, state, driver_person_id, vehicle_id, planned, cargo_weight_kg, cargo_volume_m3, cargo_length_mm,
		 started_at)
		values ($1, $2, $3, $4, $5, tstzrange($6, $7, '[)'), 1100, 12, 3000, $8) returning id`,
		"Р-"+uuid.NewString()[:8], id(t, "unit:a."+unit), state, driver, vehicle, from, until, started).Scan(&tid))
	return tid
}

func body(vehicle, driver uuid.UUID, from, until time.Time) *fleetapi.ReservationCreate {
	return &fleetapi.ReservationCreate{
		VehicleId: vehicle, DriverMemberId: driver,
		Window: fleetapi.TimeWindow{StartsAt: from, EndsAt: until, TimeZone: "Europe/Moscow"},
	}
}

func (e env) reserve(ctx context.Context, b *fleetapi.ReservationCreate) (fleetapi.ReserveVehicleResponseObject, error) {
	tc, _ := tenantctx.FromContext(ctx)
	return e.srv.ReserveVehicle(ctx, fleetapi.ReserveVehicleRequestObject{TenantId: tc.TenantID, Body: b})
}

// reserved reserves and requires a 201.
func (e env) reserved(ctx context.Context, t *testing.T, b *fleetapi.ReservationCreate) fleetapi.ReserveVehicle201JSONResponse {
	t.Helper()
	resp, err := e.reserve(ctx, b)
	require.NoError(t, err)
	ok, isOK := resp.(fleetapi.ReserveVehicle201JSONResponse)
	require.True(t, isOK, "%T", resp)
	return ok
}

// requireProblem requires err to be a Problem with code (and, if given, a detail containing want).
func requireProblem(t *testing.T, err error, code string, want ...string) {
	t.Helper()
	pe, ok := errors.AsType[*problem.Error](err)
	require.True(t, ok, "not a Problem: %v", err)
	require.Equal(t, code, pe.Code, "%v", err)
	for _, w := range want {
		require.Contains(t, pe.Detail, w)
	}
}

func (e env) count(t *testing.T, sql string, args ...any) int {
	t.Helper()
	var n int
	require.NoError(t, e.pool(t).QueryRow(t.Context(), sql, args...).Scan(&n))
	return n
}

// tenantContext returns the tenant of the request context ctx.
func tenantContext(ctx context.Context) (uuid.UUID, bool) {
	tc, ok := tenantctx.FromContext(ctx)
	return tc.TenantID, ok
}
