//go:build integration

package routes

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

// world is the fixture world of the isolation suite (W1.04) without its content: the tests plan their trips and
// register their vehicles and drivers. Actors: a.manager-msk1 — the manager of Москва-1 (fleet.routes.manage),
// a.manager-msk2 — of Москва-2, a.two-roles — the manager of Москва-1 and an observer of Самара-2, a.driver-msk1 — a
// driver of Москва-1 with the scope «own», a.driver-msk2 — a driver of Москва-2 assigned to Москва-1 for a while,
// a.owner.
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
	if world, err = fixtures.Load(ctx, c, "routes", harness.Now()); err != nil {
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

func (e env) exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	_, err := e.pool(t).Exec(t.Context(), sql, args...)
	require.NoError(t, err, sql)
}

func (e env) count(t *testing.T, sql string, args ...any) int {
	t.Helper()
	var n int
	require.NoError(t, e.pool(t).QueryRow(t.Context(), sql, args...).Scan(&n))
	return n
}

// day is midnight UTC of 1 October 2026 + n days (the clock of the suite is 1 October 10:30 MSK): every test takes its
// own days, so that the drivers of the fixtures are free in its windows.
func day(n, hh int) time.Time { return time.Date(2026, 10, 1+n, hh, 0, 0, 0, time.UTC) }

// driver registers a person of unit (a key of tenant A) with the work function «Водитель» since a month.
func (e env) driver(t *testing.T, unit string) uuid.UUID {
	t.Helper()
	var pid uuid.UUID
	require.NoError(t, e.pool(t).QueryRow(t.Context(), `insert into people.person_profiles (full_name, home_unit_id)
		values ('Водитель ' || $2, $1) returning id`, id(t, "unit:a."+unit), unit).Scan(&pid))
	e.exec(t, `insert into people.work_profiles (person_id, function, unit_id, valid)
		values ($1, 'driver', $2, tstzrange($3, null))`, pid, id(t, "unit:a."+unit), harness.Now().AddDate(0, -1, 0))
	return pid
}

// vehicle registers a vehicle of unit with payload kg, volume m³ and cargo length mm.
func (e env) vehicle(t *testing.T, unit, payload, volume string, lengthMM int) uuid.UUID {
	t.Helper()
	var vid uuid.UUID
	require.NoError(t, e.pool(t).QueryRow(t.Context(), `insert into fleet.vehicles
		(unit_id, plate, display_name, body_type, payload_kg, volume_m3, cargo_length_mm, odometer_km)
		values ($1, $2, 'Машина', 'van', $3::numeric, $4::numeric, $5, 1000) returning id`,
		id(t, "unit:a."+unit), "Р "+strings.ToUpper(uuid.NewString()[:8]), payload, volume, lengthMM).Scan(&vid))
	return vid
}

// plan is a body of createTripPlan in unit for [from, until): 1,1 т · 12 м³ · 3 м loaded at a depot and unloaded at
// two shops (Р-208 of the prototype).
func plan(t *testing.T, unit string, from, until time.Time, driver *uuid.UUID) *fleetapi.TripPlanCreate {
	t.Helper()
	return &fleetapi.TripPlanCreate{
		OrgUnitId: id(t, "unit:a."+unit), Title: "Склад Север → ТЦ",
		PlannedWindow: fleetapi.TimeWindow{StartsAt: from, EndsAt: until, TimeZone: "Europe/Moscow"},
		Cargo:         fleetapi.TripCargo{Description: "Сухой груз · 14 паллет-мест", WeightKg: "1100", VolumeM3: "12", LengthM: "3"},
		Stops: []fleetapi.TripStop{
			{Sequence: 1, Op: fleetapi.Load, Address: "Склад Север", WeightKg: "1100", VolumeM3: "12", PlannedAt: &from},
			{Sequence: 2, Op: fleetapi.Unload, Address: "ТЦ Восток", WeightKg: "600", VolumeM3: "7.5"},
			{Sequence: 3, Op: fleetapi.Unload, Address: "ТЦ Запад", WeightKg: "500", VolumeM3: "4.5"},
		},
		DriverMemberId: driver,
	}
}

func (e env) create(ctx context.Context, b *fleetapi.TripPlanCreate) (fleetapi.CreateTripPlanResponseObject, error) {
	tc, _ := tenantctx.FromContext(ctx)
	return e.srv.CreateTripPlan(ctx, fleetapi.CreateTripPlanRequestObject{TenantId: tc.TenantID, Body: b})
}

// planned plans a trip and requires a 201.
func (e env) planned(ctx context.Context, t *testing.T, b *fleetapi.TripPlanCreate) fleetapi.TripPlan {
	t.Helper()
	resp, err := e.create(ctx, b)
	require.NoError(t, err)
	ok, isOK := resp.(fleetapi.CreateTripPlan201JSONResponse)
	require.True(t, isOK, "%T", resp)
	return ok.Body
}

func (e env) get(ctx context.Context, trip uuid.UUID) (fleetapi.GetTripPlanResponseObject, error) {
	tc, _ := tenantctx.FromContext(ctx)
	return e.srv.GetTripPlan(ctx, fleetapi.GetTripPlanRequestObject{TenantId: tc.TenantID, TripId: trip})
}

func (e env) list(ctx context.Context, p fleetapi.ListTripPlansParams) (fleetapi.ListTripPlansResponseObject, error) {
	tc, _ := tenantctx.FromContext(ctx)
	return e.srv.ListTripPlans(ctx, fleetapi.ListTripPlansRequestObject{TenantId: tc.TenantID, Params: p})
}

// requireProblem requires err to be a Problem with code (and, if given, exactly the detail).
func requireProblem(t *testing.T, err error, code string, detail ...string) {
	t.Helper()
	pe, ok := errors.AsType[*problem.Error](err)
	require.True(t, ok, "not a Problem: %v", err)
	require.Equal(t, code, pe.Code, "%v", err)
	for _, d := range detail {
		require.Equal(t, d, pe.Detail)
	}
}
