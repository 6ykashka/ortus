//go:build integration

package reservations

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/sched" //nolint:depguard // W2.02: the scheduling core of the same work stream
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/migrations"              //nolint:depguard // integration test: the owner role publishes a checklist
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: the clock of the suite
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04
)

// requireDetail requires err to be a Problem with code and exactly the detail want.
func requireDetail(t *testing.T, err error, code, want string, msg ...any) {
	t.Helper()
	pe, ok := errors.AsType[*problem.Error](err)
	require.True(t, ok, "not a Problem: %v", err)
	require.Equal(t, [2]string{code, want}, [2]string{pe.Code, pe.Detail}, msg...)
}

// A reservation the actor cannot see and one that does not exist answer the same 404 «Бронь не найдена.» (the mock
// W2.00, reservationOr404; AC-01), on reading and on releasing.
func TestReservationNotFoundDetail(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	r := e.reserved(e.as(t, "a.owner"), t, body(e.vehicle(t), e.driver(t), day(15, 6), day(15, 8))).Body
	for name, c := range map[string]struct {
		ctx string
		id  uuid.UUID
	}{
		"невидимая бронь":      {"a.manager-msk2", r.Id},
		"несуществующая":       {"a.owner", uuid.New()},
		"водитель «своё»":      {"a.driver-msk1", r.Id},
		"id машины — не бронь": {"a.owner", r.VehicleId},
	} {
		ctx := e.as(t, c.ctx)
		_, err := e.get(ctx, c.id)
		requireDetail(t, err, problem.CodeNotFound, "Бронь не найдена.", "get: "+name)
		_, err = e.release(ctx, c.id, `"1"`, fleetapi.Release)
		requireDetail(t, err, problem.CodeNotFound, "Бронь не найдена.", "release: "+name)
	}
}

// Without If-Match the release is 428 revision_required and changes nothing.
func TestReleaseReservationWithoutIfMatch(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	r := e.reserved(e.as(t, "a.owner"), t, body(e.vehicle(t), e.driver(t), day(16, 6), day(16, 8))).Body
	_, err := e.release(e.as(t, "a.manager-msk1"), r.Id, "", fleetapi.Release)
	requireProblem(t, err, "revision_required")
	require.Equal(t, 2, e.count(t, `select count(*) from sched.reservations where bundle_id = $1 and state = 'hold'`, r.Id))
}

// A reservation of a trip that replaces its earlier hold (an assignment of the logist, W2.03: the vehicle only)
// records the release of that hold as a release does — the audit fleet.reservation.release with the reason and the
// event fleet.reservation.released.v1 with the successor — so the journal of the reservation shows the replacement
// (review of W2.02, round 2). A replaced hold that has already ended records nothing.
func TestReserveForTripRecordsTheReplacedHold(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	me, msk1 := id(t, "person:a.driver-msk2@a"), id(t, "unit:a.msk1")
	for name, c := range map[string]struct {
		day     int
		expires time.Time
		records int
	}{
		"живой hold логиста":    {18, harness.Now().Add(time.Hour), 1},
		"истёкший hold логиста": {19, harness.Now().Add(time.Second), 0},
	} {
		v := e.vehicle(t)
		tr := e.trip(t, "msk1", me, "assigned", day(c.day, 12), day(c.day, 16), &v)
		prior := uuid.New()
		tx, err := e.pool(t).Begin(ctx)
		require.NoError(t, err)
		require.NoError(t, sched.Hold(ctx, tx, sched.HoldRequest{
			Bundle: prior, Claims: []sched.Claim{{Kind: sched.KindVehicle, Ref: v, Home: msk1}},
			Window: sched.Window{Start: day(c.day, 12), End: day(c.day, 16)}, ExpiresAt: c.expires,
			SourceType: SourceTrip, SourceID: tr, CreatedBy: id(t, "person:a.manager-msk1@a"), Now: harness.Now(),
		}))
		_, err = tx.Exec(ctx, `update fleet.trips set reservation_bundle_id = $2 where id = $1`, tr, prior)
		require.NoError(t, err)
		require.NoError(t, tx.Commit(ctx))
		if c.records == 0 {
			_, err = e.pool(t).Exec(ctx, `update sched.reservations set hold_expires_at = $2 where bundle_id = $1`, prior,
				harness.Now().Add(-time.Minute))
			require.NoError(t, err)
		}

		b := body(v, me, day(c.day, 12), day(c.day, 16))
		b.TripId = &tr
		r := e.reserved(e.as(t, "a.driver-msk2"), t, b).Body
		require.Equal(t, c.records, e.count(t, `select count(*) from audit.events where action = 'fleet.reservation.release'
			and target_type = 'fleet.reservation' and target_id = $1 and unit_id = $2 and reason = 'Заменена новой бронью рейса.'`,
			prior, msk1), name)
		require.Equal(t, c.records, e.count(t, `select count(*) from outbox.events where type = 'fleet.reservation.released.v1'
			and aggregate_id = $1 and payload->>'replacedBy' = $2::text and payload->>'vehicleId' = $3::text`, prior, r.Id, v), name)
	}
}

// A trip whose departure inspection found a blocking defect (defect_review, W2.04) still keeps its hold: the release
// returns it to planning without the vehicle and without that inspection, as in the mock (releaseReservation drops
// departureInspectionId) and as W2.04 does when the fault is confirmed (decide.go confirm). The next departure is
// inspected again (attempt 2, unique (trip_id, kind, attempt)); the defect stays in the queue for the vehicle, and its
// decision no longer moves the trip (tripReviewed: departure_inspection_id of the trip).
func TestReleaseReservationOfATripInDefectReview(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx, pool := t.Context(), e.pool(t)
	me := id(t, "person:a.driver-msk2@a")
	tr := e.trip(t, "msk1", me, "planned", day(17, 6), day(17, 12), nil)
	vid := e.vehicle(t)
	b := body(vid, me, day(17, 7), day(17, 9))
	b.TripId = &tr
	r := e.reserved(e.as(t, "a.driver-msk2"), t, b).Body
	var checklist, inspection uuid.UUID
	owner, err := pgxpool.New(ctx, world.TenantURL(fixtures.TenantA, migrations.RoleMigrator)) // checklists are not the API's
	require.NoError(t, err)
	t.Cleanup(owner.Close)
	require.NoError(t, owner.QueryRow(ctx, `insert into fleet.checklist_versions (kind, version, items) values ('departure', 1, '[]')
		on conflict (kind, version) do update set items = fleet.checklist_versions.items returning id`).Scan(&checklist))
	require.NoError(t, pool.QueryRow(ctx, `insert into fleet.inspections (trip_id, vehicle_id, kind, checklist_version_id,
		odometer_km, fuel_level, answers, state, submitted_by) values ($1, $2, 'departure', $3, 1000, 'full', '{}', 'blocked', $4)
		returning id`, tr, vid, checklist, me).Scan(&inspection))
	_, err = pool.Exec(ctx, `update fleet.trips set state = 'defect_review', departure_inspection_id = $2, revision = revision + 1
		where id = $1`, tr, inspection)
	require.NoError(t, err)

	_, err = e.release(e.as(t, "a.manager-msk1"), r.Id, `"1"`, fleetapi.Release)
	require.NoError(t, err)
	require.Equal(t, 1, e.count(t, `select count(*) from fleet.trips where id = $1 and state = 'planned' and vehicle_id is null
		and reservation_bundle_id is null and departure_inspection_id is null and revision = 4`, tr))
	require.Equal(t, 1, e.count(t, `select count(*) from fleet.inspections where id = $1 and state = 'blocked'`, inspection),
		"the inspection itself stays: its defect waits for the decision on the vehicle")
}
