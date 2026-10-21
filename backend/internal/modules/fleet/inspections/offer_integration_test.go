//go:build integration

package inspections_test

import (
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/vehicles" //nolint:depguard // integration test: the status of the usual vehicle
	harness "github.com/ortus/ortus-crm/backend/test"                    //nolint:depguard // integration test: clock of the suites
)

// offerOf makes the reservation of tr a reservation of an open offer to its driver (W2.71 tenant 0023) with a second
// vehicle of the same company, and returns the group.
func offerOf(t *testing.T, tr trip) uuid.UUID {
	t.Helper()
	d := db(t, tr.tenant)
	group, other, res := uuid.New(), uuid.New(), uuid.New()
	exec(t, d, `update sched.reservations set offer_group_id = $2, offered_to = $3, offer_kind = 'host',
		choose_until = hold_expires_at where id = $1`, tr.Reservation, group, tr.Driver)
	exec(t, d, `insert into fleet.vehicles (id, unit_id, plate, body_type, payload_kg, volume_m3, cargo_length_mm)
		values ($1, $2, $3, 'van', 1500, 12, 3200)`, other, tr.Unit, "ПР "+other.String()[:6])
	exec(t, d, `insert into sched.resources (id, kind, ref_id, home_unit_id) values ($1, 'vehicle', $2, $3)`, res, other, tr.Unit)
	exec(t, d, `insert into sched.reservations (resource_id, bundle_id, during, occupied, state, hold_expires_at, source_type,
		source_id, created_by, offer_group_id, offered_to, offer_kind, choose_until)
		select $1, gen_random_uuid(), during, occupied, 'hold', hold_expires_at, source_type, source_id, created_by, $3, $4,
		       'usual', hold_expires_at from sched.reservations where id = $2`, res, tr.Reservation, group, tr.Driver)
	return group
}

// usualTrip writes a trip of Москва-1 driven on the usual vehicle of Москва-2 of its temporary driver (an approved
// request with the usual vehicle) in state, its consumed reservation and, when inspected, a departure inspection;
// usual false — the same trip and vehicle without a request of the pool.
func (e env) usualTrip(t *testing.T, state string, usual bool) (trip, uuid.UUID) {
	t.Helper()
	d := db(t, "a")
	driver := scalar[uuid.UUID](t, d, `insert into people.person_profiles (full_name, home_unit_id) values ('Водитель пула', $1)
		returning id`, ref("unit:a.msk2"))
	tr := seedTrip(t, "a", "msk2", driver)
	now := harness.Now()
	var completed any
	if state == "returning" {
		completed = now.Add(-10 * time.Minute)
	}
	exec(t, d, `update fleet.trips set unit_id = $2, state = $3, started_at = $4, route_completed_at = $5 where id = $1`, tr.ID,
		ref("unit:a.msk1"), state, now.Add(-2*time.Hour), completed)
	exec(t, d, `update sched.reservations set state = 'consumed', during = tstzrange($2, $3), occupied = tstzrange($2, $3)
		 where id = $1`, tr.Reservation, now.Add(-2*time.Hour), now.Add(6*time.Hour))
	if usual {
		pub, grant := uuid.New(), uuid.New()
		exec(t, d, `insert into fleet.pool_publications (id, person_id, home_unit_id, available, published_by, display_name, usual_vehicle_id)
			values ($1, $2, $3, tstzrange($4, $5), $2, $6, $7)`, pub, tr.Driver, ref("unit:a.msk2"), now.Add(-3*time.Hour),
			now.Add(10*time.Hour), "Водитель #U-"+uuid.NewString()[:6], tr.Vehicle)
		exec(t, d, `insert into access.role_assignments (id, principal_kind, principal_id, role_id, role_version, scope_kind,
			include_descendants, valid, source, granted_by) values ($1, 'person', $2, $3, 1, 'self', false,
			tstzrange($4, $5, '[)'), 'transfer', $2)`, grant, tr.Driver, ref("role:a.driver"), now.Add(-3*time.Hour), now.Add(6*time.Hour))
		exec(t, d, `insert into fleet.driver_transfers (publication_id, source_unit_id, target_unit_id, trip_id, period, state,
			requested_by, decided_by, decided_at, assignment_id, vehicle_mode, home_vehicle_id, vehicle_decision)
			values ($1, $2, $3, $4, tstzrange($5, $6, '[)'), 'approved', $7, $7, $5, $8, 'home', $9, 'approved')`,
			pub, ref("unit:a.msk2"), ref("unit:a.msk1"), tr.ID, now.Add(-3*time.Hour), now.Add(6*time.Hour), tr.Driver, grant, tr.Vehicle)
	}
	// The current departure checklist as the module publishes it (never a seeded version: TestChecklist reads its items).
	list, err := e.svc.Checklist(t.Context(), e.tc(t, "a.owner", "a"), tr.Vehicle, "departure")
	if err != nil {
		t.Fatalf("Checklist: %v", err)
	}
	version := list.VersionId
	insp := scalar[uuid.UUID](t, d, `insert into fleet.inspections (trip_id, vehicle_id, kind, checklist_version_id, odometer_km,
		fuel_level, answers, state, submitted_by) values ($1, $2, 'departure', $3, 48250, 'half', '{}', 'submitted', $4) returning id`,
		tr.ID, tr.Vehicle, version, tr.Driver)
	exec(t, d, `update fleet.trips set departure_inspection_id = $2 where id = $1`, tr.ID, insp)
	return tr, insp
}

// Правило 6 (docs/29 «Кто что видит и решает», 1b «Что откроется»): осмотры обычной машины видит её фирма (область
// машины) и фирма рейса — только по рейсу перевода; осмотр машины другой фирмы без перевода фирме рейса не открыт.
func TestUsualVehicleInspections(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	_, usual := e.usualTrip(t, "on_route", true)
	_, plain := e.usualTrip(t, "on_route", false)
	for _, actor := range []string{"a.manager-msk2", "a.manager-msk1"} {
		if _, err := e.svc.Inspection(ctx, e.tc(t, actor, "a"), usual); err != nil {
			t.Errorf("%s: the inspection of the usual vehicle of the trip: %v", actor, err)
		}
	}
	got := e.allInspections(t, "a.manager-msk1")
	expect(t, "the list of the trip company", got, slices.Contains(got, usual), !slices.Contains(got, plain))
	if _, err := e.svc.Inspection(ctx, e.tc(t, "a.manager-msk1", "a"), plain); !isCode(err, "not_found") {
		t.Errorf("a vehicle of another company without a pool request: %v, want not_found", err)
	}
}

// Q-W2.70-9: обычная машина освобождается, когда отправлен осмотр сдачи без блокирующего дефекта, — её бронь на рейс
// закрывается моментом осмотра, приёмки смены фирмой рейса не ждёт.
func TestReturnReleasesUsualVehicle(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	tr, _ := e.usualTrip(t, "returning", true)
	body := e.returnBody(t, tr, "48500")
	if _, err := e.svc.Submit(t.Context(), e.tc(t, "a.owner", "a"), body); err != nil {
		t.Fatalf("return inspection: %v", err)
	}
	ended := scalar[bool](t, db(t, "a"), `select upper(occupied) <= $2 from sched.reservations where id = $1`,
		tr.Reservation, harness.Now())
	expect(t, "the reservation of the usual vehicle ends at the return inspection", ended, ended)
	pool, err := e.pools.For(t.Context(), ref("tenant:a"))
	if err != nil {
		t.Fatal(err)
	}
	v, err := vehicles.Get(t.Context(), pool, tr.Vehicle, harness.Now())
	if err != nil {
		t.Fatal(err)
	}
	status, _, _ := v.State.Status()
	expect(t, "the usual vehicle is free for its company", status, status == fleetapi.VehicleStatusAvailable)
}

// S2-20 (W2.72; docs/29 «Решение» п. 4–5, контракт chooseReservation): до выбора из предложенных осмотра выезда нет —
// 409 «Сначала выберите машину.»; подтверждённая бронь осматривается сразу — первый снимок закрепляет её, рейс
// переходит assigned → inspection (вариант (b), Q-W2.70-2).
func TestSubmitDepartureOffer(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	group := offerOf(t, tr)
	driver := e.tc(t, "a.driver-msk1", "a")
	_, err := e.svc.Submit(ctx, driver, e.departure(t, tr))
	if !isCode(err, "invalid_transition") || !strings.Contains(err.Error(), "Сначала выберите машину.") {
		t.Fatalf("departure before the choice: %v", err)
	}
	d := db(t, "a")
	now := harness.Now()
	exec(t, d, `update sched.reservations set state = 'released', released_at = $3, release_reason = 'chosen'
		 where offer_group_id = $1 and id <> $2`, group, tr.Reservation, now)
	exec(t, d, `update sched.reservations set state = 'confirmed', chosen_at = $2, hold_expires_at = upper(during)
		 where id = $1`, tr.Reservation, now)
	exec(t, d, `update fleet.trips set state = 'assigned', reservation_bundle_id = (select bundle_id from sched.reservations
		 where id = $2) where id = $1`, tr.ID, tr.Reservation)
	got, err := e.svc.Submit(ctx, driver, e.departure(t, tr))
	if err != nil {
		t.Fatalf("departure of the confirmed reservation: %v", err)
	}
	state := scalar[string](t, d, `select state||'/'||coalesce(departure_inspection_id::text, '-') from fleet.trips where id = $1`, tr.ID)
	expect(t, "trip after the first inspection", state, state == "inspection/"+got.Id.String())
	kept := scalar[string](t, d, `select state from sched.reservations where id = $1`, tr.Reservation)
	expect(t, "reservation", kept, kept == "confirmed")
}
