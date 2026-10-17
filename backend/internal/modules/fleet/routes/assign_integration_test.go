//go:build integration

package routes

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/sched" //nolint:depguard // integration test: a hold of the driver outside a trip
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: the clock of the suite
)

func (e env) assign(ctx context.Context, trip, vehicle uuid.UUID, ifMatch string) (fleetapi.AssignTripVehicleResponseObject, error) {
	tc, _ := tenantctx.FromContext(ctx)
	return e.srv.AssignTripVehicle(ctx, fleetapi.AssignTripVehicleRequestObject{
		TenantId: tc.TenantID, TripId: trip, Params: fleetapi.AssignTripVehicleParams{IfMatch: ifMatch},
		Body: &fleetapi.TripVehicleAssignment{VehicleId: vehicle},
	})
}

// assigned assigns and requires a 200.
func (e env) assigned(ctx context.Context, t *testing.T, trip, vehicle uuid.UUID, ifMatch string) fleetapi.AssignTripVehicle200JSONResponse {
	t.Helper()
	resp, err := e.assign(ctx, trip, vehicle, ifMatch)
	require.NoError(t, err)
	ok, isOK := resp.(fleetapi.AssignTripVehicle200JSONResponse)
	require.True(t, isOK, "%T", resp)
	return ok
}

// fits is a vehicle of Москва-1 that fits the cargo of plan (1,5 т · 16 м³ · 4,2 м).
func (e env) fits(t *testing.T) uuid.UUID {
	t.Helper()
	return e.vehicle(t, "msk1", "1500", "16", 4200)
}

func TestAssignTripVehicle(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := e.as(t, "a.manager-msk1")
	driver := e.driver(t, "msk1")
	p := e.planned(ctx, t, plan(t, "msk1", day(40, 6), day(40, 12), &driver))
	vid := e.fits(t)

	ok := e.assigned(ctx, t, p.Id, vid, `"1"`)
	got := ok.Body
	assert.Equal(t, `"2"`, *ok.Headers.ETag)
	assert.Equal(t, fleetapi.TripState("assigned"), got.State)
	assert.Equal(t, &vid, got.VehicleId)
	require.NotNil(t, got.ReservationId)
	require.NotNil(t, got.HoldExpiresAt)
	assert.Equal(t, harness.Now().Add(DefaultTTL).UTC(), *got.HoldExpiresAt)
	assert.Equal(t, int64(2), got.Revision)
	assert.Equal(t, p.Stops, got.Stops)
	first := *got.ReservationId
	assert.Equal(t, 2, e.count(t, `select count(*) from sched.reservations where bundle_id = $1 and state = 'hold'
		and source_type = 'fleet.trip' and source_id = $2 and during = tstzrange($3, $4, '[)')`, first, p.Id, day(40, 6), day(40, 12)),
		"the vehicle and the driver of the trip for its window")
	assert.Equal(t, 1, e.count(t, `select count(*) from sched.reservations r join sched.resources s on s.id = r.resource_id
		where r.id = $1 and s.kind = 'vehicle' and s.ref_id = $2`, first, vid), "the row of the vehicle is the bundle (W2.02)")
	assert.Equal(t, 1, e.count(t, `select count(*) from fleet.trips where id = $1 and state = 'assigned' and vehicle_id = $2
		and reservation_bundle_id = $3`, p.Id, vid, first))
	assert.Equal(t, 1, e.count(t, `select count(*) from audit.events where action = 'fleet.reservation.hold' and target_id = $1`, first))
	assert.Equal(t, 1, e.count(t, `select count(*) from outbox.events where type = 'fleet.reservation.held.v1' and aggregate_id = $1
		and payload->>'tripId' = $2`, first, p.Id.String()))

	// Another vehicle in place of the first: the earlier hold is released under the locks, with its journal.
	other := e.fits(t)
	got = e.assigned(ctx, t, p.Id, other, `"2"`).Body
	assert.Equal(t, &other, got.VehicleId)
	require.NotNil(t, got.ReservationId)
	assert.NotEqual(t, first, *got.ReservationId)
	assert.Equal(t, 2, e.count(t, `select count(*) from sched.reservations where bundle_id = $1 and state = 'released'`, first))
	assert.Equal(t, 1, e.count(t, `select count(*) from audit.events where action = 'fleet.reservation.release' and target_id = $1
		and reason = $2`, first, textReplaced))
	assert.Equal(t, 1, e.count(t, `select count(*) from outbox.events where type = 'fleet.reservation.released.v1'
		and aggregate_id = $1 and payload->>'replacedBy' = $2`, first, got.ReservationId.String()))

	// The same vehicle again renews the hold (a new bundle in place of the live one).
	again := e.assigned(ctx, t, p.Id, other, `"3"`).Body
	assert.NotEqual(t, *got.ReservationId, *again.ReservationId)
	assert.Equal(t, 2, e.count(t, `select count(*) from sched.reservations where bundle_id = $1 and state = 'hold'`, *again.ReservationId))

	// A released hold is no reservation of the trip any more (the trip shows no reservationId).
	e.exec(t, `update sched.reservations set state = 'released' where bundle_id = $1`, *again.ReservationId)
	resp, err := e.get(ctx, p.Id)
	require.NoError(t, err)
	assert.Nil(t, gotPlan(t, resp).ReservationId)
	assert.Nil(t, gotPlan(t, resp).HoldExpiresAt)

	// A trip without a driver holds its vehicle only.
	solo := e.planned(ctx, t, plan(t, "msk1", day(40, 6), day(40, 12), nil))
	got = e.assigned(ctx, t, solo.Id, e.fits(t), `"1"`).Body
	assert.Equal(t, 1, e.count(t, `select count(*) from sched.reservations where bundle_id = $1`, *got.ReservationId))
}

func TestAssignTripVehicleRefusals(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := e.as(t, "a.manager-msk1")
	p := e.planned(ctx, t, plan(t, "msk1", day(41, 6), day(41, 12), nil))
	vid := e.fits(t)

	_, err := e.assign(ctx, p.Id, vid, "")
	requireProblem(t, err, "revision_required")
	_, err = e.assign(ctx, p.Id, vid, `"7"`)
	requireProblem(t, err, "revision_mismatch")

	_, err = e.assign(e.as(t, "a.manager-msk2"), p.Id, vid, `"1"`)
	requireProblem(t, err, problem.CodeNotFound, textTripNotFound) // the trip of the neighbouring firm (AC-01)
	_, err = e.assign(ctx, uuid.New(), vid, `"1"`)
	requireProblem(t, err, problem.CodeNotFound, textTripNotFound)

	samara := e.planned(e.as(t, "a.owner"), t, plan(t, "smr2", day(41, 6), day(41, 12), nil))
	_, err = e.assign(e.as(t, "a.two-roles"), samara.Id, vid, `"1"`)
	requireProblem(t, err, problem.CodeForbiddenAction) // visible to the observer, no fleet.routes.manage there

	_, err = e.assign(ctx, p.Id, e.vehicle(t, "msk2", "1500", "16", 4200), `"1"`)
	requireProblem(t, err, problem.CodeNotFound, textVehicleNotFound) // a vehicle of the neighbouring firm
	_, err = e.assign(ctx, p.Id, uuid.New(), `"1"`)
	requireProblem(t, err, problem.CodeNotFound, textVehicleNotFound)

	_, err = e.assign(ctx, p.Id, e.vehicle(t, "msk1", "500", "4", 2000), `"1"`)
	requireProblem(t, err, codeIncompatible)
	pe, isProblem := errors.AsType[*problem.Error](err)
	require.True(t, isProblem)
	assert.True(t, strings.HasPrefix(pe.Detail, textIncompatiblePre), pe.Detail)
	assert.Contains(t, pe.Detail, "Грузоподъёмность: 0,5 т, нужно от 1,1 т")
	assert.Contains(t, pe.Detail, "; Объём: 4 м³, нужно от 12 м³")
	assert.NotContains(t, pe.Detail, "Доступность")

	broken := e.fits(t)
	e.exec(t, `update fleet.vehicles set service_state = 'maintenance' where id = $1`, broken)
	_, err = e.assign(ctx, p.Id, broken, `"1"`)
	requireProblem(t, err, codeOverlap, textVehicleTaken)

	started := e.planned(ctx, t, plan(t, "msk1", day(41, 6), day(41, 12), nil))
	e.exec(t, `update fleet.trips set state = 'inspection' where id = $1`, started.Id)
	_, err = e.assign(ctx, started.Id, vid, `"1"`)
	requireProblem(t, err, "invalid_transition", textNotPlanned)

	assert.Equal(t, 0, e.count(t, `select count(*) from sched.reservations where source_id = $1`, p.Id), "nothing was held")
	assert.Equal(t, 1, e.count(t, `select count(*) from fleet.trips where id = $1 and state = 'planned' and revision = 1`, p.Id))
}

// TestAssignTripVehicleTaken: a vehicle held for an overlapping window, or kept by another trip whose hold ended, is 409
// reservation_overlap; a driver held elsewhere is 409 resources_unavailable.
func TestAssignTripVehicleTaken(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := e.as(t, "a.manager-msk1")
	vid := e.fits(t)
	a := e.planned(ctx, t, plan(t, "msk1", day(42, 6), day(42, 12), nil))
	b := e.planned(ctx, t, plan(t, "msk1", day(42, 10), day(42, 14), nil))
	c := e.planned(ctx, t, plan(t, "msk1", day(42, 12), day(42, 16), nil))
	e.assigned(ctx, t, a.Id, vid, `"1"`)

	_, err := e.assign(ctx, b.Id, vid, `"1"`)
	requireProblem(t, err, codeOverlap, textVehicleTaken)
	e.assigned(ctx, t, c.Id, vid, `"1"`) // right after the window of a

	// The hold of a ends, a stays assigned: the vehicle is still the vehicle of a for its window.
	e.exec(t, `update sched.reservations set hold_expires_at = $2 where source_id = $1`, a.Id, harness.Now().Add(-time.Minute))
	_, err = e.assign(ctx, b.Id, vid, `"1"`)
	requireProblem(t, err, codeOverlap, textVehicleTaken)

	driver := e.driver(t, "msk1")
	d := e.planned(ctx, t, plan(t, "msk1", day(43, 6), day(43, 12), &driver))
	pool := e.pool(t)
	tx, err := pool.Begin(t.Context())
	require.NoError(t, err)
	hold := uuid.New()
	require.NoError(t, sched.Hold(t.Context(), tx, sched.HoldRequest{
		Bundle: hold, Claims: []sched.Claim{{Kind: sched.KindPerson, Ref: driver, Home: id(t, "unit:a.msk1")}},
		Window: sched.Window{Start: day(43, 8), End: day(43, 9)}, ExpiresAt: harness.Now().Add(time.Hour),
		SourceType: "fleet.reservation", SourceID: hold, CreatedBy: driver, Now: harness.Now(),
	}))
	require.NoError(t, tx.Commit(t.Context()))
	_, err = e.assign(ctx, d.Id, e.fits(t), `"1"`)
	requireProblem(t, err, codeUnavailable, textDriverBusy)
}

// TestAssignTripVehicleParallel: concurrent assignments of one vehicle to trips of overlapping windows give one 200
// and 409 reservation_overlap for the rest — no deadlock (the order of locks of W2.02: trip, resources, trip rows).
func TestAssignTripVehicleParallel(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := e.as(t, "a.manager-msk1")
	vid := e.fits(t)
	const n = 6
	trips := make([]uuid.UUID, n)
	for i := range trips {
		trips[i] = e.planned(ctx, t, plan(t, "msk1", day(44, 6+i), day(44, 12+i), nil)).Id
	}
	type result struct {
		resp fleetapi.AssignTripVehicleResponseObject
		err  error
	}
	results := make(chan result, n)
	for _, trip := range trips {
		go func() {
			resp, err := e.assign(ctx, trip, vid, `"1"`)
			results <- result{resp, err}
		}()
	}
	won := 0
	for range n {
		r := <-results
		if r.err == nil {
			_, ok := r.resp.(fleetapi.AssignTripVehicle200JSONResponse)
			assert.True(t, ok, "%T", r.resp)
			won++
			continue
		}
		requireProblem(t, r.err, codeOverlap, textVehicleTaken)
	}
	assert.Equal(t, 1, won)
	assert.Equal(t, 1, e.count(t, `select count(*) from fleet.trips where vehicle_id = $1 and state = 'assigned'`, vid))
}
