//go:build integration

package reservations

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/vehicles" //nolint:depguard // integration test: the status of the reserved vehicle
	"github.com/ortus/ortus-crm/backend/internal/modules/sched"          //nolint:depguard // integration test: a hold of a logist (W2.03) through the core
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: the clock of the suite
)

func TestReserveVehicle(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	v, me := e.vehicle(t), id(t, "person:a.driver-msk2@a")
	ok := e.reserved(e.as(t, "a.driver-msk2"), t, body(v, me, day(1, 6), day(1, 10)))
	r := ok.Body
	require.NotEqual(t, uuid.Nil, r.Id)
	require.Equal(t, v, r.VehicleId)
	require.Equal(t, me, r.DriverMemberId)
	require.True(t, day(1, 6).Equal(r.Window.StartsAt) && day(1, 10).Equal(r.Window.EndsAt))
	require.Equal(t, "Europe/Moscow", r.Window.TimeZone)
	require.Equal(t, fleetapi.ReservationStateHeld, r.State)
	require.True(t, harness.Now().Add(30*time.Minute).Equal(r.HoldExpiresAt), "hold until %v", r.HoldExpiresAt)
	require.Equal(t, int64(1), r.Revision)
	require.Nil(t, r.TripId)
	require.Nil(t, r.RouteId)
	require.Equal(t, `"1"`, *ok.Headers.ETag)
	require.False(t, *ok.Headers.IdempotencyReplayed)

	require.Equal(t, 2, e.count(t, `select count(*) from sched.reservations where bundle_id = $1 and state = 'hold'
		and source_type = 'fleet.reservation' and source_id = $1 and created_by = $2`, r.Id, me))
	require.Equal(t, 1, e.count(t, `select count(*) from audit.events where action = 'fleet.reservation.hold'
		and target_type = 'fleet.reservation' and target_id = $1 and unit_id = $2`, r.Id, id(t, "unit:a.msk1")))
	require.Equal(t, 1, e.count(t, `select count(*) from outbox.events where type = 'fleet.reservation.held.v1'
		and aggregate_id = $1 and payload->>'vehicleId' = $2::text`, r.Id, v))
	row, err := vehicles.Get(t.Context(), e.pool(t), v, harness.Now())
	require.NoError(t, err)
	status, _, held := row.State.Status()
	require.Equal(t, fleetapi.VehicleStatusReserved, status)
	require.Nil(t, held)
}

// The hold lasts reservationTtlMinutes of the settings of the module (LogisticsSettings, Q-W2.00-4).
func TestReserveVehicleHoldFromSettings(t *testing.T) { //nolint:paralleltest // changes the settings of the module for the tenant
	e := newEnv(t)
	ctx, pool := t.Context(), e.pool(t)
	var keys []string
	var before [][]byte
	rows, err := pool.Query(ctx, `select module_key, settings::text::bytea from modules.installations where module_key in ('fleet', 'logistics')`)
	require.NoError(t, err)
	for rows.Next() {
		var k string
		var s []byte
		require.NoError(t, rows.Scan(&k, &s))
		keys, before = append(keys, k), append(before, s)
	}
	require.NoError(t, rows.Err())
	require.NotEmpty(t, keys, "the module logistics is installed in the fixtures")
	t.Cleanup(func() {
		for i, k := range keys {
			_, _ = pool.Exec(context.WithoutCancel(ctx), `update modules.installations set settings = convert_from($2, 'UTF8')::jsonb
				where module_key = $1`, k, before[i])
		}
	})
	_, err = pool.Exec(ctx, `update modules.installations set settings = settings || '{"reservationTtlMinutes": 45}'
		where module_key in ('fleet', 'logistics')`)
	require.NoError(t, err)
	r := e.reserved(e.as(t, "a.owner"), t, body(e.vehicle(t), e.driver(t), day(1, 12), day(1, 14))).Body
	require.True(t, harness.Now().Add(45*time.Minute).Equal(r.HoldExpiresAt), "hold until %v", r.HoldExpiresAt)
}

func TestReserveVehicleRefusals(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	v, smr := e.vehicle(t), e.vehicleOf(t, "smr2", "1500", "16", 4200, "")
	me, other := id(t, "person:a.driver-msk2@a"), e.driver(t)
	from, until := day(2, 6), day(2, 10)
	inverted := body(v, other, until, from)
	past := body(v, other, harness.Now().Add(-2*time.Hour), harness.Now().Add(-time.Hour))
	route := body(v, other, from, until)
	route.RouteId = new(uuid.New())
	mars := body(v, other, from, until)
	mars.Window.TimeZone = "Mars/Olympus"
	for name, c := range map[string]struct {
		actor string
		body  *fleetapi.ReservationCreate
		code  string
	}{
		"водитель за другого":        {"a.driver-msk2", body(v, other, from, until), problem.CodeForbiddenAction},
		"водитель «своё» за другого": {"a.driver-msk1", body(v, me, from, until), problem.CodeForbiddenAction},
		"машина невидимой фирмы":     {"a.driver-msk2", body(smr, me, from, until), problem.CodeNotFound},
		"неизвестная машина":         {"a.driver-msk2", body(uuid.New(), me, from, until), problem.CodeNotFound},
		"менеджер без права брони":   {"a.manager-msk1", body(v, other, from, until), problem.CodeForbiddenAction},
		"не водитель":                {"a.owner", body(v, id(t, "person:a.manager-msk1@a"), from, until), "validation_failed"},
		"неизвестный водитель":       {"a.owner", body(v, uuid.New(), from, until), "validation_failed"},
		"обратный интервал":          {"a.owner", inverted, "validation_failed"},
		"прошедшее окно":             {"a.owner", past, "validation_failed"},
		"маршрут до W2.03":           {"a.owner", route, "validation_failed"},
		"неизвестный часовой пояс":   {"a.owner", mars, "validation_failed"},
		"без тела":                   {"a.owner", nil, problem.CodeMalformedRequest},
	} {
		_, err := e.reserve(e.as(t, c.actor), c.body)
		pe, ok := errors.AsType[*problem.Error](err)
		require.True(t, ok && pe.Code == c.code, "%s: %v, want %s", name, err, c.code)
	}
	require.Zero(t, e.count(t, `select count(*) from sched.reservations r join sched.resources s on s.id = r.resource_id
		where s.ref_id = any($1)`, []uuid.UUID{v, smr}), "a refused reservation holds nothing")
}

func TestReserveVehicleOverlap(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := e.as(t, "a.owner")
	v, v2, d1, d2 := e.vehicle(t), e.vehicle(t), e.driver(t), e.driver(t)
	e.reserved(ctx, t, body(v, d1, day(3, 6), day(3, 10)))
	_, err := e.reserve(ctx, body(v, d2, day(3, 8), day(3, 12)))
	requireProblem(t, err, codeOverlap, "Машина уже недоступна. Обновите список.")
	_, err = e.reserve(ctx, body(v2, d1, day(3, 9), day(3, 11)))
	requireProblem(t, err, codeUnavailable, "Водитель уже занят")
	e.reserved(ctx, t, body(v, d2, day(3, 10), day(3, 12))) // [06, 10) and [10, 12) do not overlap
}

func TestReserveUnavailableVehicle(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := e.as(t, "a.owner")
	service := e.vehicleOf(t, "msk1", "1500", "16", 4200, "maintenance")
	onRoute := e.vehicle(t)
	e.trip(t, "msk1", e.driver(t), "on_route", day(4, 6), day(4, 8), &onRoute)
	defect := e.vehicle(t)
	_, err := e.pool(t).Exec(t.Context(), `insert into fleet.defects (vehicle_id, zone, severity, description, state)
		values ($1, 'Тормоза и ходовая', 'blocking', 'Стучит', 'open')`, defect)
	require.NoError(t, err)
	for _, v := range []uuid.UUID{service, onRoute, defect} {
		_, err := e.reserve(ctx, body(v, e.driver(t), day(4, 10), day(4, 12)))
		requireProblem(t, err, codeOverlap, "Машина уже недоступна")
	}
}

func TestReserveVehicleForTrip(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx, me := e.as(t, "a.driver-msk2"), id(t, "person:a.driver-msk2@a")
	fit, small := e.vehicle(t), e.vehicleOf(t, "msk1", "900", "9", 3100, "")
	tr := e.trip(t, "msk1", me, "planned", day(5, 6), day(5, 12), nil)

	withTrip := func(v uuid.UUID, trip uuid.UUID, from, until time.Time) *fleetapi.ReservationCreate {
		b := body(v, me, from, until)
		b.TripId = &trip
		return b
	}
	_, err := e.reserve(ctx, withTrip(small, tr, day(5, 7), day(5, 9)))
	requireProblem(t, err, codeIncompatible,
		"Машина не подходит рейсу: Грузоподъёмность: 0,9 т, нужно от 1,1 т; Объём: 9 м³, нужно от 12 м³")

	r := e.reserved(ctx, t, withTrip(fit, tr, day(5, 7), day(5, 9))).Body
	require.Equal(t, &tr, r.TripId)
	var (
		state     string
		vehicleID *uuid.UUID
		bundleID  *uuid.UUID
		revision  int
	)
	require.NoError(t, e.pool(t).QueryRow(t.Context(), `select state, vehicle_id, reservation_bundle_id, revision from fleet.trips
		where id = $1`, tr).Scan(&state, &vehicleID, &bundleID, &revision))
	require.Equal(t, "inspection", state)
	require.Equal(t, fit, *vehicleID)
	require.Equal(t, r.Id, *bundleID)
	require.Equal(t, 2, revision)
	row, err := vehicles.Get(t.Context(), e.pool(t), fit, harness.Now())
	require.NoError(t, err)
	status, _, held := row.State.Status()
	require.Equal(t, fleetapi.VehicleStatusReserved, status)
	require.Equal(t, &tr, held, "Назначена на рейс")

	_, err = e.reserve(ctx, withTrip(e.vehicle(t), tr, day(5, 9), day(5, 11)))
	requireProblem(t, err, "invalid_transition", "Рейс уже в работе")

	foreignDriver := e.trip(t, "msk1", e.driver(t), "planned", day(6, 6), day(6, 12), nil)
	_, err = e.reserve(ctx, withTrip(e.vehicle(t), foreignDriver, day(6, 7), day(6, 9)))
	requireProblem(t, err, "validation_failed", "Бронь оформляется на водителя рейса.")

	short := e.trip(t, "msk1", me, "planned", day(6, 6), day(6, 8), nil)
	_, err = e.reserve(ctx, withTrip(e.vehicle(t), short, day(6, 7), day(6, 9)))
	requireProblem(t, err, "validation_failed", "Окно брони должно лежать в окне рейса.")

	hidden := e.trip(t, "smr2", e.driver(t), "planned", day(6, 6), day(6, 12), nil)
	_, err = e.reserve(ctx, withTrip(e.vehicle(t), hidden, day(6, 7), day(6, 9)))
	requireProblem(t, err, problem.CodeNotFound, "Рейс не найден.")
	_, err = e.reserve(ctx, withTrip(e.vehicle(t), uuid.New(), day(6, 7), day(6, 9)))
	requireProblem(t, err, problem.CodeNotFound, "Рейс не найден.")
}

// A trip the logist already assigned a vehicle to (assignTripVehicle, W2.03) keeps one hold: the driver's reservation
// releases the earlier one.
func TestReserveVehicleReplacesTheHoldOfTheTrip(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx, me := e.as(t, "a.driver-msk2"), id(t, "person:a.driver-msk2@a")
	v := e.vehicle(t)
	tr := e.trip(t, "msk1", me, "assigned", day(7, 12), day(7, 16), &v)
	prior := uuid.New()
	tx, err := e.pool(t).Begin(t.Context())
	require.NoError(t, err)
	require.NoError(t, sched.Hold(t.Context(), tx, sched.HoldRequest{
		Bundle: prior, Claims: []sched.Claim{{Kind: sched.KindVehicle, Ref: v, Home: id(t, "unit:a.msk1")}},
		Window: sched.Window{Start: day(7, 12), End: day(7, 16)}, ExpiresAt: harness.Now().Add(time.Hour),
		SourceType: SourceTrip, SourceID: tr, CreatedBy: id(t, "person:a.manager-msk1@a"), Now: harness.Now(),
	}))
	_, err = tx.Exec(t.Context(), `update fleet.trips set reservation_bundle_id = $2 where id = $1`, tr, prior)
	require.NoError(t, err)
	require.NoError(t, tx.Commit(t.Context()))

	b := body(v, me, day(7, 12), day(7, 16))
	b.TripId = &tr
	r := e.reserved(ctx, t, b).Body
	require.NotEqual(t, prior, r.Id)
	require.Equal(t, 1, e.count(t, `select count(*) from sched.reservations where bundle_id = $1 and state = 'released'`, prior))
	require.Equal(t, 1, e.count(t, `select count(*) from fleet.trips where id = $1 and reservation_bundle_id = $2 and state = 'inspection'`, tr, r.Id))
}

func (e env) get(ctx context.Context, rid uuid.UUID) (fleetapi.GetReservationResponseObject, error) {
	tc, _ := tenantContext(ctx)
	return e.srv.GetReservation(ctx, fleetapi.GetReservationRequestObject{TenantId: tc, ReservationId: rid})
}

// listAll pages through the reservations ctx sees.
func (e env) listAll(ctx context.Context, t *testing.T, limit int) []uuid.UUID {
	t.Helper()
	tc, _ := tenantContext(ctx)
	p := fleetapi.ListReservationsParams{Limit: &limit}
	var out []uuid.UUID
	for range 1000 {
		resp, err := e.srv.ListReservations(ctx, fleetapi.ListReservationsRequestObject{TenantId: tc, Params: p})
		require.NoError(t, err)
		ok, isOK := resp.(fleetapi.ListReservations200JSONResponse)
		require.True(t, isOK, "%T", resp)
		for _, r := range ok.Body.Items {
			out = append(out, r.Id)
		}
		if ok.Body.NextCursor == nil {
			return out
		}
		p.Cursor = ok.Body.NextCursor
	}
	t.Fatal("too many pages")
	return nil
}

func TestReservationReads(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	me := id(t, "person:a.driver-msk2@a")
	r := e.reserved(e.as(t, "a.owner"), t, body(e.vehicle(t), me, day(8, 6), day(8, 10))).Body
	for _, actor := range []string{"a.owner", "a.manager-msk1", "a.region-msk", "a.driver-msk2"} {
		resp, err := e.get(e.as(t, actor), r.Id)
		require.NoError(t, err, actor)
		ok := resp.(fleetapi.GetReservation200JSONResponse) //nolint:forcetypeassert // the test fails on a panic anyway
		require.Equal(t, r, ok.Body, actor)
		require.Equal(t, `"1"`, *ok.Headers.ETag)
		require.Contains(t, e.listAll(e.as(t, actor), t, 50), r.Id, actor)
	}
	for _, actor := range []string{"a.manager-msk2", "a.driver-msk1"} {
		_, err := e.get(e.as(t, actor), r.Id)
		requireProblem(t, err, problem.CodeNotFound)
		require.NotContains(t, e.listAll(e.as(t, actor), t, 50), r.Id, actor)
	}
	_, err := e.get(e.as(t, "a.owner"), uuid.New())
	requireProblem(t, err, problem.CodeNotFound)

	paged := e.listAll(e.as(t, "a.owner"), t, 1)
	n := 0
	for _, x := range paged {
		if x == r.Id {
			n++
		}
	}
	require.Equal(t, 1, n, "keyset pages of one item list the reservation once")

	later := *e.srv
	later.Now = func() time.Time { return r.HoldExpiresAt }
	resp, err := (&env{dir: e.dir, pools: e.pools, srv: &later}).get(e.as(t, "a.owner"), r.Id)
	require.NoError(t, err)
	require.Equal(t, fleetapi.ReservationStateExpired, resp.(fleetapi.GetReservation200JSONResponse).Body.State) //nolint:forcetypeassert // see above
}

func (e env) release(ctx context.Context, rid uuid.UUID, ifMatch string, action fleetapi.ReservationPatchAction) (fleetapi.ReleaseReservationResponseObject, error) {
	tc, _ := tenantContext(ctx)
	reason := "Водитель заболел"
	return e.srv.ReleaseReservation(ctx, fleetapi.ReleaseReservationRequestObject{
		TenantId: tc, ReservationId: rid, Params: fleetapi.ReleaseReservationParams{IfMatch: ifMatch},
		Body: &fleetapi.ReservationPatch{Action: action, Reason: &reason},
	})
}

func TestReleaseReservation(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	owner := e.as(t, "a.owner")
	v, d := e.vehicle(t), e.driver(t)
	r := e.reserved(owner, t, body(v, d, day(9, 6), day(9, 10))).Body

	_, err := e.release(e.as(t, "a.driver-msk2"), r.Id, `"1"`, fleetapi.Release)
	requireProblem(t, err, problem.CodeForbiddenAction) // sees the vehicle of Москва-1, no fleet.reservations.manage (Q-W2.00-1)
	_, err = e.release(e.as(t, "a.manager-msk2"), r.Id, `"1"`, fleetapi.Release)
	requireProblem(t, err, problem.CodeNotFound)
	manager := e.as(t, "a.manager-msk1")
	_, err = e.release(manager, r.Id, `"2"`, fleetapi.Release)
	requireProblem(t, err, "revision_mismatch")
	_, err = e.release(manager, r.Id, `"1"`, "cancel")
	requireProblem(t, err, problem.CodeMalformedRequest)

	resp, err := e.release(manager, r.Id, `"1"`, fleetapi.Release)
	require.NoError(t, err)
	ok := resp.(fleetapi.ReleaseReservation200JSONResponse) //nolint:forcetypeassert // the test fails on a panic anyway
	require.Equal(t, fleetapi.ReservationStateReleased, ok.Body.State)
	require.Equal(t, int64(2), ok.Body.Revision)
	require.Equal(t, `"2"`, *ok.Headers.ETag)
	require.Equal(t, 1, e.count(t, `select count(*) from audit.events where action = 'fleet.reservation.release'
		and target_id = $1 and reason = 'Водитель заболел'`, r.Id))
	require.Equal(t, 1, e.count(t, `select count(*) from outbox.events where type = 'fleet.reservation.released.v1' and aggregate_id = $1`, r.Id))

	_, err = e.release(manager, r.Id, `"2"`, fleetapi.Release)
	requireProblem(t, err, "invalid_transition", "Бронь уже снята или использована.")
	e.reserved(owner, t, body(v, d, day(9, 6), day(9, 10))) // the interval is free again
}

func TestReleaseReservationOfATrip(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	me := id(t, "person:a.driver-msk2@a")
	tr := e.trip(t, "msk1", me, "planned", day(10, 6), day(10, 12), nil)
	b := body(e.vehicle(t), me, day(10, 7), day(10, 9))
	b.TripId = &tr
	r := e.reserved(e.as(t, "a.driver-msk2"), t, b).Body
	_, err := e.release(e.as(t, "a.manager-msk1"), r.Id, `"1"`, fleetapi.Release)
	require.NoError(t, err)
	require.Equal(t, 1, e.count(t, `select count(*) from fleet.trips where id = $1 and state = 'planned'
		and vehicle_id is null and reservation_bundle_id is null and revision = 3`, tr))
}

func TestReleaseOfAnEndedHold(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	earlier := *e.srv
	earlier.Now = func() time.Time { return harness.Now().Add(-time.Hour) }
	past := env{dir: e.dir, pools: e.pools, srv: &earlier}
	r := past.reserved(e.as(t, "a.owner"), t, body(e.vehicle(t), e.driver(t), day(11, 6), day(11, 10))).Body
	require.True(t, r.HoldExpiresAt.Before(harness.Now()))
	_, err := e.release(e.as(t, "a.owner"), r.Id, `"1"`, fleetapi.Release)
	requireProblem(t, err, "invalid_transition")
	resp, err := e.get(e.as(t, "a.owner"), r.Id)
	require.NoError(t, err)
	require.Equal(t, fleetapi.ReservationStateExpired, resp.(fleetapi.GetReservation200JSONResponse).Body.State) //nolint:forcetypeassert // see above
}
