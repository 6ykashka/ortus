//go:build integration

package vehicles_test

// Модель данных 2 (W2.42): машина перемещена из Москвы-1 в Москву-2. Прежняя фирма больше не видит машину и рейсов,
// которые новая фирма делает на ней, и не может назначить её на свой рейс; свой прежний рейс на этой машине она видит —
// рейсы остаются у фирм, где сделаны. Рейсы планирует модуль W2.03 (fleet/routes) — так же, как в cmd/api.

import (
	"context"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/routes"   //nolint:depguard // integration test: trips of the moved vehicle (W2.03)
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/vehicles" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"              //nolint:depguard // integration test: roles of the fixture databases
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: the clock of the suite
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04
)

type stack struct {
	t        *testing.T
	dir      *tenantctx.PGDirectory
	pools    *tenantctx.Pools
	vehicles *vehicles.Server
	routes   *routes.Server
}

func newStack(t *testing.T) *stack {
	t.Helper()
	w := vehicles.World()
	control, err := pgxpool.New(t.Context(), w.ControlURL(migrations.RoleAPI))
	require.NoError(t, err)
	t.Cleanup(control.Close)
	vars := w.Env()
	dir := tenantctx.NewPGDirectory(control)
	pools := tenantctx.NewPools(dir, func(k string) string { return vars[k] }, vars["TENANT_DB_HOST"])
	t.Cleanup(pools.Close)
	src := authz.PGSource{Pools: pools}
	ev := authz.New(src, src, harness.Now)
	return &stack{
		t: t, dir: dir, pools: pools,
		vehicles: &vehicles.Server{Pools: pools, Authz: ev, Now: harness.Now},
		routes:   &routes.Server{Pools: pools, Evaluator: ev, Now: harness.Now},
	}
}

func (s *stack) id(ref string) uuid.UUID {
	s.t.Helper()
	v, err := vehicles.World().ID(ref)
	require.NoError(s.t, err)
	return v
}

// as is the context of a request of actor in tenant A, as the gateway builds it.
func (s *stack) as(actor string) context.Context {
	s.t.Helper()
	a, err := vehicles.World().Actor(actor)
	require.NoError(s.t, err)
	tc, err := tenantctx.Resolve(s.t.Context(), s.dir, a.AccountID, s.id("tenant:a").String(), false)
	require.NoError(s.t, err)
	return tenantctx.WithTenant(s.t.Context(), tc)
}

func (s *stack) pool() *pgxpool.Pool {
	s.t.Helper()
	p, err := s.pools.For(s.t.Context(), s.id("tenant:"+fixtures.TenantA))
	require.NoError(s.t, err)
	return p
}

// vehicle registers a vehicle of unit that fits the cargo of plan (1,5 т · 16 м³ · 4,2 м).
func (s *stack) vehicle(unit string) uuid.UUID {
	s.t.Helper()
	var vid uuid.UUID
	require.NoError(s.t, s.pool().QueryRow(s.t.Context(), `insert into fleet.vehicles
		(unit_id, plate, display_name, body_type, payload_kg, volume_m3, cargo_length_mm, odometer_km, created_at)
		values ($1, $2, 'Газель Next', 'van', 1500, 16, 4200, 1000, $3) returning id`,
		s.id("unit:a."+unit), "П "+strings.ToUpper(uuid.NewString()[:8]), harness.Now().Add(-30*24*time.Hour)).Scan(&vid))
	return vid
}

// driver registers a person of unit with the work function «Водитель» since a month.
func (s *stack) driver(unit string) uuid.UUID {
	s.t.Helper()
	var pid uuid.UUID
	require.NoError(s.t, s.pool().QueryRow(s.t.Context(), `insert into people.person_profiles (full_name, home_unit_id)
		values ('Водитель ' || $2, $1) returning id`, s.id("unit:a."+unit), unit).Scan(&pid))
	_, err := s.pool().Exec(s.t.Context(), `insert into people.work_profiles (person_id, function, unit_id, valid)
		values ($1, 'driver', $2, tstzrange($3, null))`, pid, s.id("unit:a."+unit), harness.Now().AddDate(0, -1, 0))
	require.NoError(s.t, err)
	return pid
}

// closedTrip registers an accepted trip of unit with vehicle vid a week before the clock of the suite.
func (s *stack) closedTrip(unit string, vid uuid.UUID) uuid.UUID {
	s.t.Helper()
	var tid uuid.UUID
	from := harness.Now().Add(-7 * 24 * time.Hour)
	require.NoError(s.t, s.pool().QueryRow(s.t.Context(), `insert into fleet.trips
		(number, unit_id, state, vehicle_id, planned, started_at, returned_at)
		values ($1, $2, 'accepted', $3, tstzrange($4, $5, '[)'), $4, $5) returning id`,
		"Р-"+uuid.NewString()[:8], s.id("unit:a."+unit), vid, from, from.Add(8*time.Hour)).Scan(&tid))
	return tid
}

// day is midnight UTC of 1 October 2026 + n days at hh:00.
func day(n, hh int) time.Time { return time.Date(2026, 10, 1+n, hh, 0, 0, 0, time.UTC) }

// plan plans a trip of unit for [from, until) with driver and requires a 201.
func (s *stack) plan(ctx context.Context, unit string, from, until time.Time, driver uuid.UUID) fleetapi.TripPlan {
	s.t.Helper()
	resp, err := s.routes.CreateTripPlan(ctx, fleetapi.CreateTripPlanRequestObject{TenantId: s.id("tenant:a"), Body: &fleetapi.TripPlanCreate{
		OrgUnitId: s.id("unit:a." + unit), Title: "Склад Север → ТЦ",
		PlannedWindow: fleetapi.TimeWindow{StartsAt: from, EndsAt: until, TimeZone: "Europe/Moscow"},
		Cargo:         fleetapi.TripCargo{Description: "Сухой груз · 14 паллет-мест", WeightKg: "1100", VolumeM3: "12", LengthM: "3"},
		Stops: []fleetapi.TripStop{
			{Sequence: 1, Op: fleetapi.Load, Address: "Склад Север", WeightKg: "1100", VolumeM3: "12", PlannedAt: &from},
			{Sequence: 2, Op: fleetapi.Unload, Address: "ТЦ Восток", WeightKg: "1100", VolumeM3: "12"},
		},
		DriverMemberId: &driver,
	}})
	require.NoError(s.t, err)
	ok, isOK := resp.(fleetapi.CreateTripPlan201JSONResponse)
	require.True(s.t, isOK, "%T", resp)
	return ok.Body
}

func (s *stack) assign(ctx context.Context, trip, vid uuid.UUID, ifMatch string) (fleetapi.AssignTripVehicleResponseObject, error) {
	return s.routes.AssignTripVehicle(ctx, fleetapi.AssignTripVehicleRequestObject{
		TenantId: s.id("tenant:a"), TripId: trip, Params: fleetapi.AssignTripVehicleParams{IfMatch: ifMatch},
		Body: &fleetapi.TripVehicleAssignment{VehicleId: vid},
	})
}

// trips lists the trips ctx sees (listTripPlans, every page).
func (s *stack) trips(ctx context.Context) []uuid.UUID {
	s.t.Helper()
	var out []uuid.UUID
	p := fleetapi.ListTripPlansParams{}
	for n := 0; ; n++ {
		require.Less(s.t, n, 100, "too many pages")
		resp, err := s.routes.ListTripPlans(ctx, fleetapi.ListTripPlansRequestObject{TenantId: s.id("tenant:a"), Params: p})
		require.NoError(s.t, err)
		ok, isOK := resp.(fleetapi.ListTripPlans200JSONResponse)
		require.True(s.t, isOK, "%T", resp)
		for _, it := range ok.Body.Items {
			out = append(out, it.Id)
		}
		if ok.Body.NextCursor == nil {
			return out
		}
		p.Cursor = ok.Body.NextCursor
	}
}

func (s *stack) seesVehicle(ctx context.Context, vid uuid.UUID) bool {
	s.t.Helper()
	resp, err := s.vehicles.ListVehicles(ctx, fleetapi.ListVehiclesRequestObject{TenantId: s.id("tenant:a")})
	require.NoError(s.t, err)
	ok, isOK := resp.(fleetapi.ListVehicles200JSONResponse)
	require.True(s.t, isOK, "%T", resp)
	return slices.ContainsFunc(ok.Body.Items, func(v fleetapi.Vehicle) bool { return v.Id == vid })
}

func (s *stack) history(ctx context.Context, vid uuid.UUID) ([]uuid.UUID, error) {
	s.t.Helper()
	resp, err := s.vehicles.ListVehicleAssignments(ctx, fleetapi.ListVehicleAssignmentsRequestObject{TenantId: s.id("tenant:a"), VehicleId: vid})
	if err != nil {
		return nil, err
	}
	ok, isOK := resp.(fleetapi.ListVehicleAssignments200JSONResponse)
	require.True(s.t, isOK, "%T", resp)
	var out []uuid.UUID
	for _, p := range ok.Body.Items {
		out = append(out, p.OrgUnitId)
	}
	return out, nil
}

func TestTripsAfterMove(t *testing.T) {
	t.Parallel()
	s := newStack(t)
	former, target, owner := s.as("a.manager-msk1"), s.as("a.manager-msk2"), s.as("a.owner")
	vid := s.vehicle("msk1")
	before := s.closedTrip("msk1", vid)
	require.Contains(t, s.trips(former), before)

	resp, err := s.vehicles.MoveVehicle(owner, fleetapi.MoveVehicleRequestObject{
		TenantId: s.id("tenant:a"), VehicleId: vid,
		Params: fleetapi.MoveVehicleParams{IdempotencyKey: uuid.NewString(), IfMatch: `"1"`},
		Body:   &fleetapi.VehicleMove{OrgUnitId: s.id("unit:a.msk2"), Reason: "Передана в Москву-2"},
	})
	require.NoError(t, err)
	moved, isOK := resp.(fleetapi.MoveVehicle200JSONResponse)
	require.True(t, isOK, "%T", resp)
	require.Equal(t, s.id("unit:a.msk2"), moved.Body.OrgUnitId)

	// The new company plans a trip on the vehicle.
	after := s.plan(target, "msk2", day(60, 6), day(60, 14), s.driver("msk2"))
	assigned, err := s.assign(target, after.Id, vid, `"1"`)
	require.NoError(t, err)
	_, isOK = assigned.(fleetapi.AssignTripVehicle200JSONResponse)
	require.True(t, isOK, "%T", assigned)

	// The former company: no vehicle, no new trips, its own trip stays.
	require.False(t, s.seesVehicle(former, vid), "the former company does not see the moved vehicle")
	got := s.trips(former)
	require.Contains(t, got, before, "the trip stays with the company it was made in")
	require.NotContains(t, got, after.Id, "the former company does not see the new trips of the vehicle")
	_, err = s.routes.GetTripPlan(former, fleetapi.GetTripPlanRequestObject{TenantId: s.id("tenant:a"), TripId: after.Id})
	require.True(t, problem.Is(err, problem.CodeNotFound), "%v", err)
	own := s.plan(former, "msk1", day(61, 6), day(61, 14), s.driver("msk1"))
	_, err = s.assign(former, own.Id, vid, `"1"`)
	require.True(t, problem.Is(err, problem.CodeNotFound), "the former company assigns the moved vehicle: %v", err)
	_, err = s.history(former, vid)
	require.True(t, problem.Is(err, problem.CodeNotFound), "history of a vehicle the actor no longer sees: %v", err)

	// The new company: the vehicle and its trip, not the trip of the former company nor its period.
	require.True(t, s.seesVehicle(target, vid))
	got = s.trips(target)
	require.Contains(t, got, after.Id)
	require.NotContains(t, got, before)
	periods, err := s.history(target, vid)
	require.NoError(t, err)
	require.Equal(t, []uuid.UUID{s.id("unit:a.msk2")}, periods)

	// The owner sees the whole history; the vehicle on a trip that is not closed does not move.
	periods, err = s.history(owner, vid)
	require.NoError(t, err)
	require.Equal(t, []uuid.UUID{s.id("unit:a.msk2"), s.id("unit:a.msk1")}, periods)
	var revision int64
	require.NoError(t, s.pool().QueryRow(t.Context(), `select revision from fleet.vehicles where id = $1`, vid).Scan(&revision))
	_, err = s.vehicles.MoveVehicle(owner, fleetapi.MoveVehicleRequestObject{
		TenantId: s.id("tenant:a"), VehicleId: vid,
		Params: fleetapi.MoveVehicleParams{IdempotencyKey: uuid.NewString(), IfMatch: `"` + strconv.FormatInt(revision, 10) + `"`},
		Body:   &fleetapi.VehicleMove{OrgUnitId: s.id("unit:a.msk1"), Reason: "Вернуть"},
	})
	require.True(t, problem.Is(err, "resources_unavailable"), "%v", err)
}
