//go:build concurrency

package concurrency

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/google/uuid"
)

// consumed counts the consumed rows of the reservation bundle (the vehicle and the driver).
func consumed(t *testing.T, reservation string) int {
	t.Helper()
	return scalar[int](t, `select count(*) from sched.reservations where bundle_id = $1::uuid and state = 'consumed'`, reservation)
}

// starts counts the audit rows and the outbox events of the start of trip.
func starts(t *testing.T, trip string) (audit, outbox int) {
	t.Helper()
	return scalar[int](t, `select count(*) from audit.events where action = 'fleet.trip.start' and target_id = $1::uuid`, trip),
		scalar[int](t, `select count(*) from outbox.events where type = 'fleet.trip.started.v1' and aggregate_id = $1::uuid`, trip)
}

// S2-06: two starts of one reservation with their own keys at the same moment (the driver taps «Выехать на маршрут»
// on two devices) → exactly one 201, the other 409 invalid_transition «Бронь уже использована или снята.»; the hold is
// consumed once (the vehicle and the driver), one audit row and one event of the start.
func TestStartTwiceOneReservation(t *testing.T) { //nolint:paralleltest // one trip on the route per driver (trips_active_driver_uq)
	for round := range 3 {
		s := ready(t)
		out := race(t, s.startReq(t, ""), s.startReq(t, ""))
		what := fmt.Sprintf("round %d", round+1)
		wantTally(t, what, out, map[string]int{"201": 1, "409 invalid_transition": 1})
		state, _ := s.plan(t, driver)
		audit, outbox := starts(t, s.trip)
		expect(t, what, map[string]any{"state": state, "consumed": consumed(t, s.reservation), "audit": audit, "outbox": outbox},
			state == "on_route", consumed(t, s.reservation) == 2, audit == 1, outbox == 1)
		s.close(t)
	}
}

// The repeat of the start with the same Idempotency-Key at the same moment (the outbox of the driver app resends the
// command, AC-07 on the start): one start; every answer is the stored 201 of this trip or 409 idempotency_in_progress;
// a later repeat replays the stored 201.
func TestStartSameKeyTwice(t *testing.T) { //nolint:paralleltest // one trip on the route per driver (trips_active_driver_uq)
	s := ready(t)
	r := s.startReq(t, "w230-"+uuid.NewString())
	out := race(t, r, r, r)
	created := 0
	for _, o := range out {
		switch {
		case o.Status == http.StatusCreated && str(o.Body, "id") == s.trip:
			created++
		case o.Status == http.StatusConflict && o.Code() == "idempotency_in_progress":
		default:
			t.Fatalf("same key: %s", o)
		}
	}
	audit, outbox := starts(t, s.trip)
	expect(t, "one start", tally(out), created >= 1, audit == 1, outbox == 1, consumed(t, s.reservation) == 2)
	again := want(t, http.StatusCreated, r)
	expect(t, "replay", again, again.Header.Get("Idempotency-Replayed") == "true", str(again.Body, "id") == s.trip)
	s.close(t)
}

// The start and the release of its reservation at the same moment (the driver leaves while the owner releases the
// vehicle): exactly one of them happens. Either the trip is on the route with the reservation consumed and the release
// is refused (409 or 412), or the reservation is released, the trip is back in planning and the start is 409
// invalid_transition.
func TestStartVersusRelease(t *testing.T) { //nolint:paralleltest // one trip on the route per driver (trips_active_driver_uq)
	for round := range 3 {
		s := ready(t)
		res := want(t, http.StatusOK, req{Actor: owner, Method: http.MethodGet, Path: fleet(t) + "/reservations/" + s.reservation})
		out := race(t, s.startReq(t, ""), req{Actor: owner, Method: http.MethodPatch, Path: fleet(t) + "/reservations/" + s.reservation,
			IfMatch: res.ETag(), Body: map[string]any{"action": "release", "reason": "Машина нужна на другой рейс"}})
		started, released := out[0], out[1]
		state, _ := s.plan(t, owner)
		what := fmt.Sprintf("round %d: start %s, release %s, trip %s", round+1, started, released, state)
		switch {
		case started.Status == http.StatusCreated:
			expect(t, what, nil, released.Status == http.StatusConflict || released.Status == http.StatusPreconditionFailed,
				state == "on_route", consumed(t, s.reservation) == 2)
		case released.Status == http.StatusOK:
			expect(t, what, nil, started.Status == http.StatusConflict && started.Code() == "invalid_transition",
				state == "planned", consumed(t, s.reservation) == 0)
		default:
			t.Fatal(what)
		}
		s.close(t)
	}
}
