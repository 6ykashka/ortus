//go:build integration

package reservations

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/routes"   //nolint:depguard // integration test: the assignment of the logist (W2.03)
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/vehicles" //nolint:depguard // integration test: the status of the vehicle after the release
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: the clock of the suite
)

// assigned plans a trip of Москва-1 without a driver for [from, until) and lets the logist of Москва-1 assign vehicle
// to it (assignTripVehicle, W2.03): the hold of the vehicle only. It returns the trip and the reservation of the plan.
func (e env) assigned(t *testing.T, vehicle uuid.UUID, from, until time.Time) (trip, reservation uuid.UUID) {
	t.Helper()
	require.NoError(t, e.pool(t).QueryRow(t.Context(), `insert into fleet.trips
		(number, unit_id, state, planned, cargo_weight_kg, cargo_volume_m3, cargo_length_mm)
		values ($1, $2, 'planned', tstzrange($3, $4, '[)'), 1100, 12, 3000) returning id`,
		"Р-"+uuid.NewString()[:8], id(t, "unit:a.msk1"), from, until).Scan(&trip))
	srv := &routes.Server{Pools: e.pools, Evaluator: e.srv.Evaluator, Now: harness.Now}
	ctx := e.as(t, "a.manager-msk1")
	tc, _ := tenantctx.FromContext(ctx)
	resp, err := srv.AssignTripVehicle(ctx, fleetapi.AssignTripVehicleRequestObject{
		TenantId: tc.TenantID, TripId: trip, Params: fleetapi.AssignTripVehicleParams{IfMatch: `"1"`},
		Body: &fleetapi.TripVehicleAssignment{VehicleId: vehicle},
	})
	require.NoError(t, err)
	ok, isOK := resp.(fleetapi.AssignTripVehicle200JSONResponse)
	require.True(t, isOK, "%T", resp)
	require.NotNil(t, ok.Body.ReservationId)
	return trip, *ok.Body.ReservationId
}

func (e env) reservation(ctx context.Context, t *testing.T, rid uuid.UUID) fleetapi.GetReservation200JSONResponse {
	t.Helper()
	resp, err := e.get(ctx, rid)
	require.NoError(t, err)
	ok, isOK := resp.(fleetapi.GetReservation200JSONResponse)
	require.True(t, isOK, "%T", resp)
	return ok
}

// The hold of an assignment of the logist to a trip without a driver (Q-W2.53-3, Q-W2.03-10) is a reservation of the
// API like any other: getReservation and listReservations show it in the scope of fleet.reservations.read — the unit
// of the vehicle or its author — with the trip and without a driver (driverMemberId is the nil UUID until the
// contract makes it optional), and hide it, as a missing one, from the manager of the neighbouring firm and from a
// driver (AC-01).
func TestReservationOfAnAssignment(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	v := e.vehicle(t)
	trip, rid := e.assigned(t, v, day(50, 6), day(50, 12))

	for _, actor := range []string{"a.manager-msk1", "a.owner"} {
		got := e.reservation(e.as(t, actor), t, rid)
		r := got.Body
		require.Equal(t, rid, r.Id, actor)
		require.Equal(t, v, r.VehicleId, actor)
		require.Equal(t, uuid.Nil, r.DriverMemberId, actor)
		require.NotNil(t, r.TripId, actor)
		require.Equal(t, trip, *r.TripId, actor)
		require.Equal(t, fleetapi.ReservationStateHeld, r.State, actor)
		require.True(t, day(50, 6).Equal(r.Window.StartsAt) && day(50, 12).Equal(r.Window.EndsAt), actor)
		require.Equal(t, "Europe/Moscow", r.Window.TimeZone, actor)
		require.True(t, harness.Now().Add(DefaultTTL).Equal(r.HoldExpiresAt), actor)
		require.Equal(t, `"1"`, *got.Headers.ETag, actor)
		require.Contains(t, e.listAll(e.as(t, actor), t, 50), rid, actor)
	}
	for _, actor := range []string{"a.manager-msk2", "a.driver-msk1"} {
		_, err := e.get(e.as(t, actor), rid)
		requireDetail(t, err, problem.CodeNotFound, "Бронь не найдена.", actor)
		require.NotContains(t, e.listAll(e.as(t, actor), t, 50), rid, actor)
		_, err = e.release(e.as(t, actor), rid, `"1"`, fleetapi.Release)
		requireDetail(t, err, problem.CodeNotFound, "Бронь не найдена.", actor)
	}
}

// releaseReservation takes the assignment back (Q-W2.53-3): the hold is released with its journal, the trip goes back
// to planning without its vehicle, and the vehicle is free for other trips. An assignment whose hold has ended still
// keeps its vehicle for the window of the trip (Q-W2.03-7) — releasing it takes the assignment back as well; a hold
// of the trip that is no longer the hold of the trip stays 409.
func TestReleaseOfAnAssignment(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	manager := e.as(t, "a.manager-msk1")
	for name, ended := range map[string]bool{"живой hold назначения": false, "истёкший hold назначения": true} {
		v := e.vehicle(t)
		trip, rid := e.assigned(t, v, day(51, 6), day(51, 12))
		if ended {
			_, err := e.pool(t).Exec(t.Context(), `update sched.reservations set hold_expires_at = $2 where bundle_id = $1`,
				rid, harness.Now().Add(-time.Minute))
			require.NoError(t, err)
			require.Equal(t, fleetapi.ReservationStateExpired, e.reservation(manager, t, rid).Body.State, name)
		}
		resp, err := e.release(manager, rid, `"1"`, fleetapi.Release)
		require.NoError(t, err, name)
		ok, isOK := resp.(fleetapi.ReleaseReservation200JSONResponse)
		require.True(t, isOK, "%s: %T", name, resp)
		require.Equal(t, fleetapi.ReservationStateReleased, ok.Body.State, name)
		require.Equal(t, int64(2), ok.Body.Revision, name)
		require.Equal(t, 1, e.count(t, `select count(*) from fleet.trips where id = $1 and state = 'planned'
			and vehicle_id is null and reservation_bundle_id is null`, trip), name)
		require.Equal(t, 1, e.count(t, `select count(*) from audit.events where action = 'fleet.reservation.release'
			and target_id = $1`, rid), name)
		require.Equal(t, 1, e.count(t, `select count(*) from outbox.events where type = 'fleet.reservation.released.v1'
			and aggregate_id = $1`, rid), name)
		row, err := vehicles.Get(t.Context(), e.pool(t), v, harness.Now())
		require.NoError(t, err)
		status, _, held := row.State.Status()
		require.Equal(t, fleetapi.VehicleStatusAvailable, status, name)
		require.Nil(t, held, name)
		e.assigned(t, v, day(51, 7), day(51, 9)) // the vehicle is free for another trip of the window

		_, err = e.release(manager, rid, `"2"`, fleetapi.Release)
		requireProblem(t, err, "invalid_transition", "Бронь уже снята или использована.")
	}
}
