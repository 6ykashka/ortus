//go:build integration

package inspections_test

import (
	"testing"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: clock of the suites
)

// bundled turns the reservation of tr into a bundle as reserveVehicle of W2.02 holds it (sched.Hold): the row of the
// vehicle is the first claim and carries the id of the bundle, the row of the driver is a second row of the same
// bundle with the same window and expiry (10 minutes left, so that a hold again for 30 minutes shows). The driver
// resource is a fresh one: parallel tests do not share a driver row (reservations_no_overlap). It returns the id of
// the driver row.
func bundled(t *testing.T, tr trip) uuid.UUID {
	t.Helper()
	d := db(t, tr.tenant)
	exec(t, d, `update sched.reservations set bundle_id = id, hold_expires_at = $2 where id = $1`, tr.Reservation,
		harness.Now().Add(10*time.Minute))
	resource, row := uuid.New(), uuid.New()
	exec(t, d, `insert into sched.resources (id, kind, ref_id, home_unit_id) values ($1, 'person', $2, $3)`, resource, uuid.New(), tr.Unit)
	exec(t, d, `insert into sched.reservations (id, resource_id, bundle_id, during, occupied, state, hold_expires_at,
	                                            source_type, source_id, created_by)
	            select $1, $2, r.bundle_id, r.during, r.occupied, r.state, r.hold_expires_at, r.source_type, r.source_id, r.created_by
	              from sched.reservations r where r.id = $3`, row, resource, tr.Reservation)
	return row
}

// rowState is the state of a reservation row with its expiry ("" — none).
func rowState(t *testing.T, tr trip, row uuid.UUID) (string, *time.Time) {
	t.Helper()
	var (
		state string
		until *time.Time
	)
	if err := db(t, tr.tenant).QueryRowContext(t.Context(), `select state, hold_expires_at from sched.reservations where id = $1`, row).
		Scan(&state, &until); err != nil {
		t.Fatal(err)
	}
	return state, until
}

// Q-W2.02-13: a blocking defect on departure keeps the whole bundle of the trip for the manager — the row of the
// driver is confirmed with the row of the vehicle instead of expiring by its TTL; «Дефект некритичный — разрешить
// выезд» holds the whole bundle again for 30 minutes.
func TestBlockingKeepsTheWholeBundle(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	driver := bundled(t, tr)
	defect := (*e.blocked(t, tr).Defects)[0]
	for name, row := range map[string]uuid.UUID{"vehicle": tr.Reservation, "driver": driver} {
		if state, _ := rowState(t, tr, row); state != "confirmed" {
			t.Errorf("after the blocking defect the %s row is %q, want confirmed", name, state)
		}
	}
	if _, err := e.svc.Decide(t.Context(), e.tc(t, "a.manager-msk1", "a"), defect.Id, etag(defect.Revision),
		fleetapi.DefectDecision{Decision: "allow_departure"}); err != nil {
		t.Fatal(err)
	}
	for name, row := range map[string]uuid.UUID{"vehicle": tr.Reservation, "driver": driver} {
		state, until := rowState(t, tr, row)
		if state != "hold" || until == nil || !until.Equal(harness.Now().Add(30*time.Minute)) {
			t.Errorf("after allow_departure the %s row is %q until %v, want hold for 30 minutes", name, state, until)
		}
	}
}

// S2-17 п. 3 over the bundle: «Подтвердить неисправность» releases every row of the bundle of the trip.
func TestConfirmReleasesTheWholeBundle(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	driver := bundled(t, tr)
	defect := (*e.blocked(t, tr).Defects)[0]
	if _, err := e.svc.Decide(t.Context(), e.tc(t, "a.region-msk", "a"), defect.Id, etag(defect.Revision),
		fleetapi.DefectDecision{Decision: "confirm_out_of_service"}); err != nil {
		t.Fatal(err)
	}
	for name, row := range map[string]uuid.UUID{"vehicle": tr.Reservation, "driver": driver} {
		if state, _ := rowState(t, tr, row); state != "released" {
			t.Errorf("after confirm_out_of_service the %s row is %q, want released", name, state)
		}
	}
}

// A departure waits for the whole bundle: a bundle whose driver row is no longer held is not a live reservation —
// 409 reservation_expired when its hold ended, 409 invalid_transition when it was released; nothing is written.
func TestDepartureNeedsTheWholeBundle(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	for name, c := range map[string]struct{ q, code string }{
		"hold of the driver ended": {`update sched.reservations set hold_expires_at = $2 where id = $1`, "reservation_expired"},
		"driver released": {`update sched.reservations set state = 'released' where id = $1 and $2::timestamptz is not null`,
			"invalid_transition"},
	} {
		tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
		driver := bundled(t, tr)
		exec(t, db(t, "a"), c.q, driver, harness.Now().Add(-time.Minute))
		if _, err := e.svc.Submit(t.Context(), e.tc(t, "a.driver-msk1", "a"), e.departure(t, tr)); !isCode(err, c.code) {
			t.Errorf("%s: %v, want %s", name, err, c.code)
		}
		n := scalar[int](t, db(t, "a"), `select count(*) from fleet.inspections where trip_id = $1`, tr.ID)
		state, _ := rowState(t, tr, tr.Reservation)
		expect(t, name+": nothing written", []any{n, state}, n == 0, state == "hold")
	}
}
