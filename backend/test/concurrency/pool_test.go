//go:build concurrency

package concurrency

import (
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
)

// poolDriver registers a driver of Москва-2 (the releasing firm of the pool) with the work function «Водитель» and
// publishes him in the pool by the manager of Москва-2 for a day around w (contract 0.6.0-stage2: a driver without a
// publication is 404 «Водитель не опубликован в пуле.», W2.07).
func poolDriver(t *testing.T, w window) uuid.UUID {
	t.Helper()
	pid := scalar[uuid.UUID](t, `insert into people.person_profiles (full_name, home_unit_id) values ('Водитель пула', $1) returning id`,
		ref(t, "unit:a.msk2"))
	execSQL(t, `insert into people.work_profiles (person_id, function, unit_id, valid) values ($1, 'driver', $2, tstzrange($3, null))`,
		pid, ref(t, "unit:a.msk2"), time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC))
	free := window{from: w.from.Add(-2 * time.Hour), until: w.until.Add(4 * time.Hour)}
	want(t, http.StatusCreated, req{Actor: neighbour, Method: http.MethodPost, Path: fleet(t) + "/driver-pool/publications", Body: map[string]any{
		"driverMemberId": pid, "homeOrgUnitId": ref(t, "unit:a.msk2"), "freeWindow": free.json(), "qualifications": []string{"Кат. C"},
	}})
	return pid
}

// requestTransfer: the logist of Москва-1 requests the driver of Москва-2 for the window w (S2-14, DriverTransferCreate;
// the comment of the request is the default of Q-W2.00-3).
func requestTransfer(t *testing.T, pid uuid.UUID, w window) reply {
	t.Helper()
	rep := call(t, req{Actor: logist, Method: http.MethodPost, Path: fleet(t) + "/driver-transfer-requests", Body: map[string]any{
		"driverMemberId": pid, "sourceOrgUnitId": ref(t, "unit:a.msk2"), "targetOrgUnitId": ref(t, "unit:a.msk1"),
		"window": w.json(), "reason": "Запрос на рейс",
	}})
	if rep.Status != http.StatusCreated || str(rep.Body, "status") != "requested" {
		t.Fatalf("requestDriverTransfer: %s", rep)
	}
	return rep
}

// approve is the approval of transfer by actor with the ETag of the request.
func approve(t *testing.T, actor string, transfer reply) req {
	t.Helper()
	return req{Actor: actor, Method: http.MethodPost, Path: fleet(t) + "/driver-transfer-requests/" + str(transfer.Body, "id") + "/decision",
		IfMatch: transfer.ETag(), Body: map[string]any{"decision": "approve"}}
}

// grants counts the temporary assignments of the driver (access.role_assignments, source transfer).
func grants(t *testing.T, pid uuid.UUID) int {
	t.Helper()
	return scalar[int](t, `select count(*) from access.role_assignments where principal_id = $1 and source = 'transfer'`, pid)
}

// AC-06 (S2-14): the releasing manager of Москва-2 and the owner approve one request of a driver at the same moment →
// one approval (one temporary assignment), the other 412 or 409; the request reads approved.
func TestPoolTwoApprovals(t *testing.T) { //nolint:paralleltest // the drivers and the clock of the fixtures are shared by the tests
	w := newWindow()
	pid := poolDriver(t, w)
	transfer := requestTransfer(t, pid, w)
	out := race(t, approve(t, neighbour, transfer), approve(t, owner, transfer))
	one(t, "approvals", out)
	got := want(t, http.StatusOK, req{Actor: logist, Method: http.MethodGet, Path: fleet(t) + "/driver-transfer-requests/" + str(transfer.Body, "id")})
	expect(t, "transfer", got, str(got.Body, "status") == "approved", got.Body["revision"] == float64(2), grants(t, pid) == 1)
}

// AC-06, «Overlapping active duty produces 409 driver_unavailable»: the publication of an approved driver takes a second
// request for an overlapping window (one open request per publication, Q-W2.51-3); its two approvals at the same moment
// are both 409 resources_unavailable (driver_unavailable of 0.1, errors.yaml) — the approvals of one driver are
// serialized, the driver keeps one temporary assignment.
func TestPoolOverlappingApprovals(t *testing.T) { //nolint:paralleltest // the drivers and the clock of the fixtures are shared by the tests
	w := newWindow()
	pid := poolDriver(t, w)
	first := requestTransfer(t, pid, w)
	want(t, http.StatusOK, approve(t, neighbour, first))
	second := requestTransfer(t, pid, window{from: w.from.Add(2 * time.Hour), until: w.until.Add(2 * time.Hour)})
	out := race(t, approve(t, neighbour, second), approve(t, owner, second))
	busy := 0
	for _, r := range out {
		switch {
		case r.Status == http.StatusConflict && (r.Code() == "driver_unavailable" || r.Code() == "resources_unavailable"):
			busy++
		default:
			t.Fatalf("overlapping approvals: %s", r)
		}
	}
	expect(t, "overlapping approvals", tally(out), busy == 2, grants(t, pid) == 1)
}
