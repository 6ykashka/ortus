//go:build integration

package reservations

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/offers" //nolint:depguard // integration test: an offer of the same module
	"github.com/ortus/ortus-crm/backend/internal/modules/sched"        //nolint:depguard // integration test: the window of the offer
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: clock of the suites
)

// W2.72, возврат 1 (S2-20 правило 8, docs/29 «Права», «События»): releaseReservation брони предложения. Снять её
// может только логист фирмы рейса (fleet.reservations.manage над фирмой рейса) — фирма обычной машины видит бронь
// своей машины, но не снимает её (403); событие несёт группу и причину manager; после срока выбора, пока воркер не
// закрыл предложение, бронь снимается как живая.

// offered is an open offer to a driver of Москва-2 for a trip of Москва-1 on day n: a vehicle of Москва-1 (host) and
// one of Москва-2 (usual), held until until.
type offered struct {
	trip, group, host, usual uuid.UUID
}

func (e env) offered(t *testing.T, n int, until time.Time) offered {
	t.Helper()
	ctx := t.Context()
	driver := e.personOf(t, "msk2", true)
	from, to := day(n, 6), day(n, 12)
	o := offered{trip: e.trip(t, "msk1", driver, "planned", from, to, nil)}
	host, usual := e.vehicle(t), e.vehicleOf(t, "msk2", "1500", "16", 4200, "")
	var got offers.Offer
	err := pgx.BeginFunc(ctx, e.pool(t), func(tx pgx.Tx) error {
		var err error
		got, err = offers.HoldOffer(ctx, tx, offers.OfferRequest{
			Trip: o.trip, Window: sched.Window{Start: from, End: to}, Driver: driver,
			Vehicles: []offers.OfferVehicle{
				{Vehicle: host, Unit: id(t, "unit:a.msk1"), Kind: offers.OfferHost},
				{Vehicle: usual, Unit: id(t, "unit:a.msk2"), Kind: offers.OfferUsual},
			},
			ChooseUntil: until, CreatedBy: id(t, "person:a.owner@a"), Now: harness.Now(),
		})
		return err
	})
	require.NoError(t, err)
	o.group, o.host, o.usual = got.Group, got.Bundles[0], got.Bundles[1]
	return o
}

func TestReleaseOfferReservation(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	o := e.offered(t, 40, day(40, 5))

	_, err := e.release(e.as(t, "a.manager-msk2"), o.usual, `"1"`, fleetapi.Release)
	requireProblem(t, err, problem.CodeForbiddenAction) // the company of the usual vehicle sees it, the trip is not its own

	resp, err := e.release(e.as(t, "a.manager-msk1"), o.usual, `"1"`, fleetapi.Release)
	require.NoError(t, err)
	got, ok := resp.(fleetapi.ReleaseReservation200JSONResponse)
	require.True(t, ok, "%T", resp)
	require.Equal(t, fleetapi.ReservationStateReleased, got.Body.State)
	require.NotNil(t, got.Body.ReleaseReason)
	require.Equal(t, fleetapi.ReservationReleaseReasonManager, *got.Body.ReleaseReason)
	require.Equal(t, 1, e.count(t, `select count(*) from outbox.events where type = 'fleet.reservation.released.v1'
		and aggregate_id = $1 and payload->>'offerGroupId' = $2 and payload->>'reason' = 'manager'
		and payload->>'tripId' = $3`, o.usual, o.group.String(), o.trip.String()))
	require.Equal(t, 1, e.count(t, `select count(*) from sched.reservations where id = $1 and state = 'hold'`, o.host),
		"the other reservation of the offer stays open")
}

func TestReleaseOfferAfterTheDeadline(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	until := harness.Now().Add(time.Hour)
	o := e.offered(t, 41, until)
	later := *e.srv
	later.Now = func() time.Time { return until.Add(time.Minute) } // the worker has not closed the offer yet
	after := env{dir: e.dir, pools: e.pools, srv: &later}
	_, err := after.release(e.as(t, "a.manager-msk1"), o.host, `"1"`, fleetapi.Release)
	require.NoError(t, err)
	require.Equal(t, 1, e.count(t, `select count(*) from sched.reservations where id = $1 and state = 'released'
		and release_reason = 'manager'`, o.host))
}
