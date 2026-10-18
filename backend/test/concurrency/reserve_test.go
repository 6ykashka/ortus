//go:build concurrency

package concurrency

import (
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures"
)

// seedDriver registers a person of Москва-1 with the work function «Водитель» since a month (no account: the owner
// reserves for it, as a logist books a driver of the firm).
func seedDriver(t *testing.T) uuid.UUID {
	t.Helper()
	pid := scalar[uuid.UUID](t, `insert into people.person_profiles (full_name, home_unit_id) values ('Водитель гонки', $1) returning id`,
		ref(t, "unit:a.msk1"))
	execSQL(t, `insert into people.work_profiles (person_id, function, unit_id, valid) values ($1, 'driver', $2, tstzrange($3, null))`,
		pid, ref(t, "unit:a.msk1"), time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC))
	return pid
}

// liveHolds counts the live rows of the vehicle in sched (a hold or a confirmed reservation).
func liveHolds(t *testing.T, vehicle string) int {
	t.Helper()
	return scalar[int](t, `select count(*) from sched.reservations r join sched.resources s on s.id = r.resource_id
	   where s.kind = 'vehicle' and s.ref_id = $1::uuid and r.state in ('hold', 'confirmed')`, vehicle)
}

// AC-03 (CAL-04, I-01): 100 parallel reservations of one vehicle for one window, each for its own driver, through
// the whole API → exactly one 201 and 99 × 409 reservation_overlap; the vehicle has one live hold and the drivers of
// the refused reservations hold nothing.
func TestAC03HundredParallelReservations(t *testing.T) { //nolint:paralleltest // one API and one clock for the suite; rounds use the drivers of the fixtures
	const n = 100
	v, w := vehicle(t), newWindow()
	drivers := make([]uuid.UUID, n)
	rs := make([]req, n)
	for i := range n {
		drivers[i] = seedDriver(t)
		rs[i] = req{Actor: owner, Method: http.MethodPost, Path: fleet(t) + "/reservations",
			Body: map[string]any{"vehicleId": v, "driverMemberId": drivers[i], "window": w.json()}}
	}
	began := time.Now()
	out := race(t, rs...)
	t.Logf("AC-03: %d reservations in %s: %v", n, time.Since(began), tally(out))
	wantTally(t, "AC-03", out, map[string]int{"201": 1, "409 reservation_overlap": n - 1})
	expect(t, "live holds of the vehicle", liveHolds(t, v), liveHolds(t, v) == 1)
	held := scalar[int](t, `select count(distinct r.bundle_id) from sched.reservations r join sched.resources s on s.id = r.resource_id
	   where s.kind = 'person' and s.ref_id = any($1) and r.state in ('hold', 'confirmed')`, drivers)
	expect(t, "drivers holding a reservation", held, held == 1)
}

// unitRole gives actor (a person of tenant A) the role «Водитель» on Москва-1 for the test, as the group «Водители
// Север» does on the stand: a row of access.role_assignments written as the superuser, as the suite writes files and
// work profiles, with the policy version bumped so that the gateway reads it. The row is removed after the test.
func unitRole(t *testing.T, actor string) {
	t.Helper()
	id := uuid.New()
	execSQL(t, `insert into access.role_assignments (id, principal_kind, principal_id, role_id, role_version, scope_kind,
	              scope_ref, include_descendants, valid, granted_by, reason)
	            values ($1, 'person', $2, $3, 1, 'unit', $4, true, tstzrange($5::timestamptz, null), $6, 'W2.30 AC-03')`,
		id, person(t, actor), ref(t, "role:a.driver"), ref(t, "unit:a.msk1"),
		time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC), person(t, owner))
	execSQL(t, `update access.policy_state set policy_version = policy_version + 1`)
	t.Cleanup(func() { // t.Context is done by now
		d, ctx := db(t, fixtures.TenantA), context.Background()
		if _, err := d.ExecContext(ctx, `delete from access.role_assignments where id = $1`, id); err != nil {
			t.Errorf("remove the role of %s: %v", actor, err)
		}
		if _, err := d.ExecContext(ctx, `update access.policy_state set policy_version = policy_version + 1`); err != nil {
			t.Errorf("bump the policy: %v", err)
		}
	})
}

// Two drivers book one vehicle for one window at the same moment, each for himself (AC-03 «два водителя одновременно
// бронируют одну машину», self-service W0.16 §10 п. 3): the driver of the shifts and a.driver-msk1 with the role on
// Москва-1 for the test (his fixture role is on «своё», which opens no vehicle: Q-W2.30-1). One reservation is
// confirmed by the server, the other sees «Конфликт брони» (409 reservation_overlap).
func TestAC03TwoDriversOneVehicle(t *testing.T) { //nolint:paralleltest // the drivers of the fixtures are shared by the tests
	unitRole(t, selfDriver)
	for round := range 3 {
		v, w := vehicle(t), newWindow()
		out := race(t,
			req{Actor: driver, Method: http.MethodPost, Path: fleet(t) + "/reservations",
				Body: map[string]any{"vehicleId": v, "driverMemberId": person(t, driver), "window": w.json()}},
			req{Actor: selfDriver, Method: http.MethodPost, Path: fleet(t) + "/reservations",
				Body: map[string]any{"vehicleId": v, "driverMemberId": person(t, selfDriver), "window": w.json()}})
		wantTally(t, fmt.Sprintf("round %d", round+1), out, map[string]int{"201": 1, "409 reservation_overlap": 1})
		expect(t, "live holds of the vehicle", v, liveHolds(t, v) == 1)
		for _, r := range out {
			if r.Status == http.StatusCreated {
				want(t, http.StatusOK, req{Actor: owner, Method: http.MethodPatch, Path: fleet(t) + "/reservations/" + str(r.Body, "id"),
					IfMatch: r.ETag(), Body: map[string]any{"action": "release", "reason": "Конец раунда"}})
			}
		}
	}
}

// The repeat of a reservation with the same Idempotency-Key at the same moment (the outbox of the driver app sends
// it twice): one hold, the answers are the stored 201 or 409 idempotency_in_progress, never a second reservation or
// a reservation_overlap with itself.
func TestReserveSameKeyTwice(t *testing.T) { //nolint:paralleltest // the drivers of the fixtures are shared by the tests
	v, w := vehicle(t), newWindow()
	r := req{Actor: driver, Method: http.MethodPost, Path: fleet(t) + "/reservations", Key: "w230-" + uuid.NewString(),
		Body: map[string]any{"vehicleId": v, "driverMemberId": person(t, driver), "window": w.json()}}
	out := race(t, r, r, r)
	ids := map[string]bool{}
	for _, o := range out {
		switch {
		case o.Status == http.StatusCreated:
			ids[str(o.Body, "id")] = true
		case o.Status == http.StatusConflict && o.Code() == "idempotency_in_progress":
		default:
			t.Fatalf("same key: %s", o)
		}
	}
	expect(t, "one reservation", ids, len(ids) == 1)
	expect(t, "live holds of the vehicle", v, liveHolds(t, v) == 1)
	for id := range ids {
		rep := want(t, http.StatusOK, req{Actor: driver, Method: http.MethodGet, Path: fleet(t) + "/reservations/" + id})
		want(t, http.StatusOK, req{Actor: owner, Method: http.MethodPatch, Path: fleet(t) + "/reservations/" + id, // the driver has no fleet.reservations.manage
			IfMatch: rep.ETag(), Body: map[string]any{"action": "release", "reason": "Конец проверки"}})
	}
}
