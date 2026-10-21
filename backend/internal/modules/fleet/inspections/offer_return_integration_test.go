//go:build integration

package inspections_test

import (
	"testing"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/vehicles" //nolint:depguard // integration test: the status of the vehicle
	harness "github.com/ortus/ortus-crm/backend/test"                    //nolint:depguard // integration test: clock of the suites
)

// W2.72, возврат 1 (S2-20 правила 6–7): блокирующий дефект на выбранной машине предложения разбирается как обычно —
// «Разрешить выезд» оставляет бронь подтверждённой (выбор сделан, рейс стартует), «Подтвердить неисправность» снимает
// её (manager); уведомление о блокирующем дефекте обычной машины получает её фирма, которая его решает; осмотр сдачи
// освобождает до приёмки только обычную машину временного водителя, а не любую машину другой фирмы.

// chosenOffer makes the reservation of tr the chosen reservation of an offer of two vehicles (the other released) and
// the trip assigned with it.
func chosenOffer(t *testing.T, tr trip) uuid.UUID {
	t.Helper()
	group := offerOf(t, tr)
	d := db(t, tr.tenant)
	now := harness.Now()
	exec(t, d, `update sched.reservations set state = 'released', released_at = $3, release_reason = 'chosen'
		 where offer_group_id = $1 and id <> $2`, group, tr.Reservation, now)
	exec(t, d, `update sched.reservations set state = 'confirmed', chosen_at = $2, hold_expires_at = upper(during)
		 where id = $1`, tr.Reservation, now)
	exec(t, d, `update fleet.trips set state = 'assigned', reservation_bundle_id = (select bundle_id from sched.reservations
		 where id = $2) where id = $1`, tr.ID, tr.Reservation)
	return group
}

// reservation is the state of the reservation of tr, whether it is chosen and its reason of the release.
func reservation(t *testing.T, tr trip) (state string, chosen bool, reason string) {
	t.Helper()
	if err := db(t, tr.tenant).QueryRowContext(t.Context(), `select state, chosen_at is not null, coalesce(release_reason, '')
		from sched.reservations where id = $1`, tr.Reservation).Scan(&state, &chosen, &reason); err != nil {
		t.Fatal(err)
	}
	return state, chosen, reason
}

// Правило 7 (S2-17): блокирующий дефект на выбранной машине предложения.
func TestOfferBlockingDefect(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()

	allowed := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	chosenOffer(t, allowed)
	defect := (*e.blocked(t, allowed).Defects)[0]
	if _, err := e.svc.Decide(ctx, e.tc(t, "a.manager-msk1", "a"), defect.Id, etag(defect.Revision),
		fleetapi.DefectDecision{Decision: "allow_departure"}); err != nil {
		t.Fatalf("allow the departure on the chosen vehicle: %v", err)
	}
	state, chosen, _ := reservation(t, allowed)
	expect(t, "the chosen reservation after «Разрешить выезд»", state, state == "confirmed", chosen)
	trip := scalar[string](t, db(t, "a"), `select state from fleet.trips where id = $1`, allowed.ID)
	expect(t, "the trip goes back to the departure", trip, trip == "inspection")

	confirmed := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	chosenOffer(t, confirmed)
	defect = (*e.blocked(t, confirmed).Defects)[0]
	if _, err := e.svc.Decide(ctx, e.tc(t, "a.region-msk", "a"), defect.Id, etag(defect.Revision),
		fleetapi.DefectDecision{Decision: "confirm_out_of_service"}); err != nil {
		t.Fatalf("confirm the fault of the chosen vehicle: %v", err)
	}
	state, chosen, reason := reservation(t, confirmed)
	expect(t, "the chosen reservation after «Подтвердить неисправность»", state, state == "released", !chosen,
		reason == "manager")
}

// Правило 6: блокирующий дефект обычной машины решает её фирма — уведомление получает она (и фирма рейса).
func TestUsualVehicleBlockingNotice(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	d := db(t, "a")
	tr := seedTrip(t, "a", "msk2", person("a.driver-msk1"))
	exec(t, d, `update fleet.trips set unit_id = $2 where id = $1`, tr.ID, ref("unit:a.msk1"))
	if _, err := e.svc.Submit(t.Context(), e.tc(t, "a.owner", "a"), e.departure(t, tr, critical("Кузов"))); err != nil {
		t.Fatalf("departure with a blocking defect: %v", err)
	}
	for _, actor := range []string{"a.manager-msk2", "a.manager-msk1"} {
		if n := len(notices(t, "a", person(actor), "fleet.defect.blocking_reported", tr.ID)); n != 1 {
			t.Errorf("%s: %d notifications of the blocking defect of the usual vehicle, want 1", actor, n)
		}
	}
}

// Правило 6 (Q-W2.70-9): осмотр сдачи на машине другой фирмы без одобренной обычной машины перевода не освобождает её
// до приёмки — машина остаётся за рейсом.
func TestReturnKeepsForeignVehicle(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	tr, _ := e.usualTrip(t, "returning", false)
	if _, err := e.svc.Submit(t.Context(), e.tc(t, "a.owner", "a"), e.returnBody(t, tr, "48500")); err != nil {
		t.Fatalf("return inspection: %v", err)
	}
	running := scalar[bool](t, db(t, "a"), `select upper(occupied) > $2 from sched.reservations where id = $1`,
		tr.Reservation, harness.Now().Add(time.Minute))
	expect(t, "the reservation of a vehicle of another company runs until the acceptance", running, running)
	pool, err := e.pools.For(t.Context(), ref("tenant:a"))
	if err != nil {
		t.Fatal(err)
	}
	v, err := vehicles.Get(t.Context(), pool, tr.Vehicle, harness.Now())
	if err != nil {
		t.Fatal(err)
	}
	status, _, _ := v.State.Status()
	expect(t, "the vehicle stays on the trip", status, status != fleetapi.VehicleStatusAvailable)
}
