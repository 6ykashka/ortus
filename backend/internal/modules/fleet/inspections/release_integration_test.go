//go:build integration

package inspections_test

import (
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/vehicles" //nolint:depguard // integration test: the status of the usual vehicle
	harness "github.com/ortus/ortus-crm/backend/test"                    //nolint:depguard // integration test: clock of the suites
)

// W2.78 (Q-W2.72-1, S2-20 правило 6, Q-W2.70-9): обычная машина временного водителя отпущена осмотром сдачи — до
// приёмки смены фирмой рейса другой рейс её фирмы переходит по ней в «Осмотр» (trips_active_vehicle_uq её не держит),
// а машина фирмы рейса и машина другой фирмы без одобренного перевода держатся за рейсом до приёмки (AC-05, S2-10).

// companyTrip writes a planned trip of the company unit («msk1», «msk2») without a vehicle.
func companyTrip(t *testing.T, unit string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	now := harness.Now()
	exec(t, db(t, "a"), `insert into fleet.trips (id, number, unit_id, state, planned, title)
		values ($1, $2, $3, 'planned', tstzrange($4, $5), 'Склад → магазин')`,
		id, "Р-W278-"+id.String()[:8], ref("unit:a."+unit), now.Add(24*time.Hour), now.Add(32*time.Hour))
	return id
}

// toInspection moves trip to «Осмотр» with vehicle, as reserveVehicle does with its hold; the error is the database's.
func toInspection(t *testing.T, trip, vehicle uuid.UUID) error {
	t.Helper()
	_, err := db(t, "a").ExecContext(t.Context(), `update fleet.trips set state = 'inspection', vehicle_id = $2,
		revision = revision + 1 where id = $1`, trip, vehicle)
	return err
}

// sqlState is the SQLSTATE of a database error ("" for nil or another error).
func sqlState(err error) string {
	if pe, ok := errors.AsType[*pgconn.PgError](err); ok {
		return pe.Code
	}
	return ""
}

// submitReturn submits the return inspection of tr as the owner and moves the trip to «Ждёт приёмки» (returnTrip).
func (e env) submitReturn(t *testing.T, tr trip) {
	t.Helper()
	if _, err := e.svc.Submit(t.Context(), e.tc(t, "a.owner", "a"), e.returnBody(t, tr, "48500")); err != nil {
		t.Fatalf("return inspection: %v", err)
	}
	exec(t, db(t, "a"), `update fleet.trips set state = 'submitted', returned_at = $2 where id = $1`, tr.ID, harness.Now())
}

// Обычная машина отпущена до приёмки: другой рейс её фирмы (Москва-2) переходит по ней в «Осмотр», рейс временного
// водителя ждёт приёмки; третий рейс — 23505: индекс держит машину за одним неотпущенным рейсом.
func TestReturnFreesUsualVehicleForItsCompany(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	tr, _ := e.usualTrip(t, "returning", true)
	e.submitReturn(t, tr)
	next := companyTrip(t, "msk2")
	if err := toInspection(t, next, tr.Vehicle); err != nil {
		t.Fatalf("another trip of the vehicle company before the acceptance: %v, want the move", err)
	}
	if got := sqlState(toInspection(t, companyTrip(t, "msk2"), tr.Vehicle)); got != "23505" {
		t.Errorf("a third trip on the vehicle of an active trip: SQLSTATE %q, want 23505", got)
	}
	var (
		state    string
		released sql.NullTime
	)
	if err := db(t, "a").QueryRowContext(t.Context(), `select state, vehicle_released_at from fleet.trips where id = $1`,
		tr.ID).Scan(&state, &released); err != nil {
		t.Fatal(err)
	}
	expect(t, "the trip of the temporary driver", state, state == "submitted", released.Valid,
		released.Time.Equal(harness.Now()))
}

// Q-W2.75-3 (Q-W2.91-1): осмотр сдачи обычной машины, поданный до начала окна рейса (рейс начат по доступу до окна),
// не оставляет у брони пустой интервал — listReservations читает lower(during) и lower(occupied) и на NULL отвечает
// 503; бронь закрыта сразу (верх не дальше нижней границы и минимального шага), машина свободна фирме.
func TestReturnBeforeWindowKeepsReservationInterval(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	tr, _ := e.usualTrip(t, "returning", true)
	now := harness.Now()
	exec(t, db(t, "a"), `update sched.reservations set during = tstzrange($2, $3), occupied = tstzrange($2, $3) where id = $1`,
		tr.Reservation, now.Add(time.Hour), now.Add(8*time.Hour))
	if _, err := e.svc.Submit(t.Context(), e.tc(t, "a.owner", "a"), e.returnBody(t, tr, "48500")); err != nil {
		t.Fatalf("return inspection before the window: %v", err)
	}
	var (
		during, occupied     bool
		lowerD, lowerO       sql.NullTime
		spanDuring, spanOccp float64
	)
	if err := db(t, "a").QueryRowContext(t.Context(), `select not isempty(during), not isempty(occupied), lower(during), lower(occupied),
		coalesce(extract(epoch from upper(during) - lower(during)), 0), coalesce(extract(epoch from upper(occupied) - lower(occupied)), 0)
		from sched.reservations where id = $1`, tr.Reservation).Scan(&during, &occupied, &lowerD, &lowerO, &spanDuring, &spanOccp); err != nil {
		t.Fatal(err)
	}
	expect(t, "the intervals of the reservation are not empty", during, during, occupied, lowerD.Valid, lowerO.Valid)
	expect(t, "the reservation is closed at once: no longer than the minimal step", spanDuring, spanDuring <= 1, spanOccp <= 1)
	pool, err := e.pools.For(t.Context(), ref("tenant:a"))
	if err != nil {
		t.Fatal(err)
	}
	v, err := vehicles.Get(t.Context(), pool, tr.Vehicle, now)
	if err != nil {
		t.Fatal(err)
	}
	status, _, _ := v.State.Status()
	expect(t, "the usual vehicle is free for its company at once", status, status == fleetapi.VehicleStatusAvailable)
	e.freeForCompany(t, tr)
}

// freeForCompany: another trip of the vehicle company moves to «Осмотр» on the vehicle (vehicle_released_at, W2.78).
func (e env) freeForCompany(t *testing.T, tr trip) {
	t.Helper()
	exec(t, db(t, "a"), `update fleet.trips set state = 'submitted', returned_at = $2 where id = $1`, tr.ID, harness.Now())
	if err := toInspection(t, companyTrip(t, "msk2"), tr.Vehicle); err != nil {
		t.Errorf("another trip of the vehicle company after the early return: %v, want the move", err)
	}
}

// Машина фирмы рейса и машина другой фирмы без одобренного перевода держатся за рейсом до приёмки: другой рейс по ним
// до приёмки — 23505, после приёмки — переход есть; отметки «машина отпущена» у рейса нет.
func TestReturnKeepsTripCompanyVehicle(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	own, _ := e.usualTrip(t, "returning", false)
	exec(t, db(t, "a"), `update fleet.trips set unit_id = $2 where id = $1`, own.ID, ref("unit:a.msk2"))
	foreign, _ := e.usualTrip(t, "returning", false)
	for _, c := range []struct {
		what string
		tr   trip
	}{{"the vehicle of the trip company", own}, {"a vehicle of another company without a transfer", foreign}} {
		e.submitReturn(t, c.tr)
		next := companyTrip(t, "msk2")
		if got := sqlState(toInspection(t, next, c.tr.Vehicle)); got != "23505" {
			t.Errorf("%s before the acceptance: SQLSTATE %q, want 23505", c.what, got)
		}
		released := scalar[bool](t, db(t, "a"), `select vehicle_released_at is not null from fleet.trips where id = $1`, c.tr.ID)
		expect(t, c.what+": no release mark", released, !released)
		exec(t, db(t, "a"), `update fleet.trips set state = 'accepted', reviewed_at = $2 where id = $1`, c.tr.ID, harness.Now())
		if err := toInspection(t, next, c.tr.Vehicle); err != nil {
			t.Errorf("%s after the acceptance: %v, want the move", c.what, err)
		}
	}
}
