//go:build integration

package trips_test

import (
	"testing"

	"github.com/google/uuid"

	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: clock of the suites
)

// S2-20 (W2.72; контракт startTrip 0.6.3-stage2): старт потребляет бронь held или confirmed; бронь предложения до
// выбора — 409 invalid_transition «Сначала выберите машину.».
func TestStartTripOffer(t *testing.T) { //nolint:paralleltest // starts a trip of a.driver-msk1: one trip on the route per driver
	e := newEnv(t)
	d := db(t, "a")
	tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	release(t, tr)
	group, other, res := uuid.New(), uuid.New(), uuid.New()
	exec(t, d, `update sched.reservations set offer_group_id = $2, offered_to = $3, offer_kind = 'host',
		choose_until = hold_expires_at where id = $1`, tr.Reservation, group, tr.Driver)
	exec(t, d, `insert into fleet.vehicles (id, unit_id, plate, body_type, payload_kg, volume_m3, cargo_length_mm)
		values ($1, $2, $3, 'van', 1500, 12, 3200)`, other, tr.Unit, "ПС "+other.String()[:6])
	exec(t, d, `insert into sched.resources (id, kind, ref_id, home_unit_id) values ($1, 'vehicle', $2, $3)`, res, other, tr.Unit)
	exec(t, d, `insert into sched.reservations (resource_id, bundle_id, during, occupied, state, hold_expires_at, source_type,
		source_id, created_by, offer_group_id, offered_to, offer_kind, choose_until)
		select $1, gen_random_uuid(), during, occupied, 'hold', hold_expires_at, source_type, source_id, created_by, $3, $4,
		       'usual', hold_expires_at from sched.reservations where id = $2`, res, tr.Reservation, group, tr.Driver)
	drv := e.tc(t, "a.driver-msk1", "a")
	_, err := e.svc.Start(t.Context(), drv, start(tr))
	wantProblem(t, err, "invalid_transition", "Сначала выберите машину.")

	now := harness.Now()
	exec(t, d, `update sched.reservations set state = 'released', released_at = $3, release_reason = 'chosen'
		 where offer_group_id = $1 and id <> $2`, group, tr.Reservation, now)
	exec(t, d, `update sched.reservations set state = 'confirmed', chosen_at = $2, hold_expires_at = upper(during)
		 where id = $1`, tr.Reservation, now)
	got, err := e.svc.Start(t.Context(), drv, start(tr))
	if err != nil {
		t.Fatalf("start by the confirmed reservation of the offer: %v", err)
	}
	expect(t, "started", got, got.Id == tr.ID)
	consumed := scalar[string](t, d, `select state from sched.reservations where id = $1`, tr.Reservation)
	expect(t, "reservation", consumed, consumed == "consumed")
}
