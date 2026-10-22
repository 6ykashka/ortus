//go:build concurrency

package concurrency

import (
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
)

// W2.78 (Q-W2.72-1; S2-20 правило 6, Q-W2.70-9; AC-05, S2-10): обычная машина временного водителя отпущена осмотром
// сдачи. Смена водителя Москвы-2 на своей обычной машине в рейсе Москвы-1 проходит через API до «Ждёт приёмки»; затем
// две брони этой машины фирмой Москва-2 на два своих рейса в разные окна одновременно: окна не пересекаются, спорит
// только trips_active_vehicle_uq — одна 201 (рейс в «Осмотре»), другая 409 reservation_overlap; смена временного
// водителя всё ещё ждёт приёмки. Машина фирмы рейса после сдачи держится до приёмки: бронь её другим рейсом — 409,
// после приёмки — 201.

// companyDriver registers a person of unit with the work function «Водитель» since a month (no account: the owner
// plans and reserves for it).
func companyDriver(t *testing.T, unit string) uuid.UUID {
	t.Helper()
	pid := scalar[uuid.UUID](t, `insert into people.person_profiles (full_name, home_unit_id) values ('Водитель фирмы', $1)
		returning id`, ref(t, unit))
	execSQL(t, `insert into people.work_profiles (person_id, function, unit_id, valid) values ($1, 'driver', $2, tstzrange($3, null))`,
		pid, ref(t, unit), time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC))
	return pid
}

// companyShift plans by the owner a trip of unit for a new driver of it on a new day, the vehicle is set by the caller.
func companyShift(t *testing.T, unit string) *shift {
	t.Helper()
	c := crew{by: owner, who: companyDriver(t, unit)}
	s := &shift{crew: c, win: newWindow()}
	rep := want(t, http.StatusCreated, req{Actor: owner, Method: http.MethodPost, Path: fleet(t) + "/trip-plans", Body: map[string]any{
		"orgUnitId": ref(t, unit), "title": "Склад Юг → ТЦ Запад", "driverMemberId": c.who, "plannedWindow": s.win.json(),
		"cargo": map[string]any{"description": "Сухой груз · 10 паллет-мест", "weightKg": "900", "volumeM3": "10", "lengthM": "3"},
		"stops": []map[string]any{
			{"sequence": 1, "op": "load", "address": "Склад Юг", "weightKg": "900", "volumeM3": "10"},
			{"sequence": 2, "op": "unload", "address": "ТЦ Запад", "weightKg": "900", "volumeM3": "10"},
		},
	}})
	if s.trip = str(rep.Body, "id"); s.trip == "" {
		t.Fatalf("createTripPlan: %s", rep)
	}
	return s
}

// reserveReq is the reservation of vehicle for the trip of s by the owner.
func (s *shift) reserveReq(t *testing.T, vehicle string) req {
	t.Helper()
	return req{Actor: owner, Method: http.MethodPost, Path: fleet(t) + "/reservations",
		Body: map[string]any{"vehicleId": vehicle, "driverMemberId": s.who, "tripId": s.trip, "window": s.win.hold().json()}}
}

// usualShift runs through the API a shift of a temporary driver of Москва-2 on his usual vehicle for a trip of
// Москва-1 up to the acceptance: the approval holds both vehicles as one offer, the owner keeps the usual one, the
// departure inspection, the start, the end of the route, the return inspection and returnTrip.
func usualShift(t *testing.T) *shift {
	t.Helper()
	w := newWindow()
	pid := companyDriver(t, "unit:a.msk2")
	_, usual := offeredTo(t, w, pid)
	want(t, http.StatusOK, choose(t, owner, usual, ""))
	s := &shift{crew: crew{by: owner, who: pid}, win: w, reservation: usual}
	s.trip = scalar[uuid.UUID](t, `select source_id from sched.reservations where id = $1`, usual).String()
	s.vehicle = scalar[uuid.UUID](t, `select s.ref_id from sched.reservations r join sched.resources s on s.id = r.resource_id
		where r.id = $1`, usual).String()
	s.inspectDeparture(t)
	s.start(t)
	s.finish(t)
	s.giveBack(t)
	if state, _ := s.plan(t, owner); state != "submitted" {
		t.Fatalf("trip %s of the temporary driver after the return: %s, want submitted", s.trip, state)
	}
	return s
}

func TestUsualVehicleReleasedBeforeAcceptance(t *testing.T) { //nolint:paralleltest // the drivers and the clock of the fixtures are shared by the tests
	temp := usualShift(t)
	a, b := companyShift(t, "unit:a.msk2"), companyShift(t, "unit:a.msk2")
	out := race(t, a.reserveReq(t, temp.vehicle), b.reserveReq(t, temp.vehicle))
	wantTally(t, "two trips of the vehicle company on the released usual vehicle", out,
		map[string]int{"201": 1, "409 reservation_overlap": 1})
	won := a
	if out[1].Status == http.StatusCreated {
		won = b
	}
	state := scalar[string](t, `select state || '/' || coalesce(vehicle_id::text, '-') from fleet.trips where id = $1::uuid`, won.trip)
	expect(t, "the trip that won the usual vehicle", state, state == "inspection/"+temp.vehicle)
	if state, _ := temp.plan(t, owner); state != "submitted" {
		t.Fatalf("trip of the temporary driver: %s, want submitted (waits for the acceptance)", state)
	}
}

func TestTripCompanyVehicleHeldUntilAcceptance(t *testing.T) { //nolint:paralleltest // one trip on the route per driver (trips_active_driver_uq)
	done := submittedOf(t, theirs(t))
	next := companyShift(t, "unit:a.msk1")
	if rep := call(t, next.reserveReq(t, done.vehicle)); rep.Status != http.StatusConflict || rep.Code() != "reservation_overlap" {
		t.Fatalf("the vehicle of the trip company before the acceptance: %s, want 409 reservation_overlap", rep)
	}
	done.accept(t)
	want(t, http.StatusCreated, next.reserveReq(t, done.vehicle))
}
