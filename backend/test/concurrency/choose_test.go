//go:build concurrency

package concurrency

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
)

// S2-20 (W2.72; docs/29 «Приёмка»: «Два параллельных choose в одной группе — подтверждена ровно одна бронь, вторая →
// released»). The driver of Москва-2 is published with his usual vehicle; the logist of Москва-1 requests him for a
// trip with a vehicle of Москва-1 and «Можно взять свою обычную» (host_or_home); the approval holds both vehicles as one
// offer. The logist keeps one vehicle and the owner the other at the same moment: one choice, the other 409
// offer_closed; the group has exactly one confirmed reservation, the other is released. A repeat of the winner with its
// Idempotency-Key answers the same 200.

// offerVehicle registers a vehicle of unit (a van of 1.5 t, 12 m³, 3.2 m).
func offerVehicle(t *testing.T, unit string) uuid.UUID {
	t.Helper()
	return scalar[uuid.UUID](t, `insert into fleet.vehicles (unit_id, plate, display_name, body_type, payload_kg, volume_m3,
		cargo_length_mm) values ($1, $2, 'Фургон', 'van', 1500, 12, 3200) returning id`, ref(t, unit),
		fmt.Sprintf("К %s 77", uuid.NewString()[:6]))
}

// offered approves a request of a driver of Москва-2 with his usual vehicle for a trip of Москва-1 in w and returns the
// two reservations of the offer: the vehicle of the trip company and the usual one.
func offered(t *testing.T, w window) (host, usual string) {
	t.Helper()
	pid := scalar[uuid.UUID](t, `insert into people.person_profiles (full_name, home_unit_id) values ('Водитель с машиной', $1)
		returning id`, ref(t, "unit:a.msk2"))
	execSQL(t, `insert into people.work_profiles (person_id, function, unit_id, valid) values ($1, 'driver', $2, tstzrange($3, null))`,
		pid, ref(t, "unit:a.msk2"), time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC))
	return offeredTo(t, w, pid)
}

// offeredTo is offered for the driver pid of Москва-2.
func offeredTo(t *testing.T, w window, pid uuid.UUID) (host, usual string) {
	t.Helper()
	hostVehicle, usualVehicle := offerVehicle(t, "unit:a.msk1"), offerVehicle(t, "unit:a.msk2")
	free := window{from: w.from.Add(-2 * time.Hour), until: w.until.Add(4 * time.Hour)}
	want(t, http.StatusCreated, req{Actor: neighbour, Method: http.MethodPost, Path: fleet(t) + "/driver-pool/publications", Body: map[string]any{
		"driverMemberId": pid, "homeOrgUnitId": ref(t, "unit:a.msk2"), "freeWindow": free.json(), "qualifications": []string{"Кат. C"},
		"usualVehicleId": usualVehicle,
	}})
	trip := uuid.New()
	execSQL(t, `insert into fleet.trips (id, number, unit_id, state, planned) values ($1, $2, $3, 'planned', tstzrange($4, $5))`,
		trip, "Р-S220-"+trip.String()[:6], ref(t, "unit:a.msk1"), w.from, w.until)
	transfer := want(t, http.StatusCreated, req{Actor: logist, Method: http.MethodPost, Path: fleet(t) + "/driver-transfer-requests", Body: map[string]any{
		"driverMemberId": pid, "sourceOrgUnitId": ref(t, "unit:a.msk2"), "targetOrgUnitId": ref(t, "unit:a.msk1"),
		"window": w.json(), "reason": "Запрос на рейс", "tripId": trip,
		"vehicle": map[string]any{"mode": "host_or_home", "hostVehicleId": hostVehicle},
	}})
	approved := want(t, http.StatusOK, approve(t, neighbour, transfer))
	v, _ := approved.Body["vehicle"].(map[string]any)
	h, _ := v["hostVehicle"].(map[string]any)
	u, _ := v["homeVehicle"].(map[string]any)
	host, usual = str(h, "reservationId"), str(u, "reservationId")
	if host == "" || usual == "" || str(h, "reservationState") != "held" || str(u, "reservationState") != "held" {
		t.Fatalf("approval with two vehicles: %s", approved)
	}
	return host, usual
}

func choose(t *testing.T, actor, reservation, key string) req {
	t.Helper()
	return req{Actor: actor, Method: http.MethodPost, Path: fleet(t) + "/reservations/" + reservation + "/choose", Key: key}
}

func TestChooseTwoAtOnce(t *testing.T) { //nolint:paralleltest // the drivers and the clock of the fixtures are shared by the tests
	w := newWindow()
	host, usual := offered(t, w)
	keys := []string{"w272-" + uuid.NewString(), "w272-" + uuid.NewString()}
	out := race(t, choose(t, logist, host, keys[0]), choose(t, owner, usual, keys[1]))
	win, closed := -1, 0
	for i, r := range out {
		switch {
		case r.Status == http.StatusOK && win < 0:
			win = i
		case r.Status == http.StatusConflict && r.Code() == "offer_closed":
			closed++
		default:
			t.Fatalf("two choices at once: %v", tally(out))
		}
	}
	expect(t, "two choices at once", tally(out), win >= 0, closed == 1)
	group := scalar[uuid.UUID](t, `select offer_group_id from sched.reservations where id = $1`, host)
	expect(t, "one confirmed reservation in the offer", group,
		scalar[int](t, `select count(*) from sched.reservations where offer_group_id = $1 and state = 'confirmed'`, group) == 1,
		scalar[int](t, `select count(*) from sched.reservations where offer_group_id = $1 and state = 'released'`, group) == 1)
	chosen, actor, key := host, logist, keys[0]
	if win == 1 {
		chosen, actor, key = usual, owner, keys[1]
	}
	again := want(t, http.StatusOK, choose(t, actor, chosen, key))
	chosenBody, _ := again.Body["chosen"].(map[string]any)
	expect(t, "repeat with the same key", again.Header.Get("Idempotency-Replayed"), str(chosenBody, "id") == chosen,
		again.Header.Get("Idempotency-Replayed") == "true")
}

// W2.72, return 1 (docs/29 «Приёмка»: the driver chooses): the temporary driver chooses the usual vehicle at the moment
// the logist keeps the vehicle of the trip company («Оставить …»): one choice, the other 409 offer_closed, exactly one
// confirmed reservation in the offer.
func TestChooseDriverAndLogist(t *testing.T) { //nolint:paralleltest // the drivers and the clock of the fixtures are shared by the tests
	w := newWindow()
	host, usual := offeredTo(t, w, person(t, driver))
	keys := []string{"w272-" + uuid.NewString(), "w272-" + uuid.NewString()}
	out := race(t, choose(t, driver, usual, keys[0]), choose(t, logist, host, keys[1]))
	won, closed := 0, 0
	for _, r := range out {
		switch {
		case r.Status == http.StatusOK:
			won++
		case r.Status == http.StatusConflict && r.Code() == "offer_closed":
			closed++
		default:
			t.Fatalf("the driver and the logist at once: %v", tally(out))
		}
	}
	expect(t, "the driver and the logist at once", tally(out), won == 1, closed == 1)
	group := scalar[uuid.UUID](t, `select offer_group_id from sched.reservations where id = $1`, host)
	expect(t, "one confirmed reservation in the offer", group,
		scalar[int](t, `select count(*) from sched.reservations where offer_group_id = $1 and state = 'confirmed'`, group) == 1,
		scalar[int](t, `select count(*) from sched.reservations where offer_group_id = $1 and state = 'released'`, group) == 1)
}
