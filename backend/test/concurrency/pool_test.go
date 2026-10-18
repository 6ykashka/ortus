//go:build concurrency

package concurrency

import (
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
)

// poolDriver registers a driver of Москва-2 (the releasing firm of the pool) with the work function «Водитель».
func poolDriver(t *testing.T) uuid.UUID {
	t.Helper()
	pid := scalar[uuid.UUID](t, `insert into people.person_profiles (full_name, home_unit_id) values ('Водитель пула', $1) returning id`,
		ref(t, "unit:a.msk2"))
	execSQL(t, `insert into people.work_profiles (person_id, function, unit_id, valid) values ($1, 'driver', $2, tstzrange($3, null))`,
		pid, ref(t, "unit:a.msk2"), time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC))
	return pid
}

// requestTransfer: the logist of Москва-1 requests the driver of Москва-2 for the window w (S2-14, DriverTransferCreate;
// the comment of the request is the default of Q-W2.00-3). Until W2.07 the operation has no handler: 501 skips the
// test with its reason.
func requestTransfer(t *testing.T, pid uuid.UUID, w window) reply {
	t.Helper()
	rep := call(t, req{Actor: logist, Method: http.MethodPost, Path: fleet(t) + "/driver-transfer-requests", Body: map[string]any{
		"driverMemberId": pid, "sourceOrgUnitId": ref(t, "unit:a.msk2"), "targetOrgUnitId": ref(t, "unit:a.msk1"),
		"window": w.json(), "reason": "Запрос на рейс",
	}})
	if rep.Status == http.StatusNotImplemented {
		t.Skip("AC-06, пул водителей: W2.07 не влит в main — requestDriverTransfer отвечает 501 not_implemented; сценарий идёт по контракту, как только у операции появится обработчик")
	}
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

// AC-06 (S2-14): the releasing manager of Москва-2 and the owner approve one request of a driver at the same moment →
// one approval (one temporary assignment), the other 412 or 409; the request reads approved.
func TestPoolTwoApprovals(t *testing.T) { //nolint:paralleltest // the drivers and the clock of the fixtures are shared by the tests
	pid := poolDriver(t)
	transfer := requestTransfer(t, pid, newWindow())
	out := race(t, approve(t, neighbour, transfer), approve(t, owner, transfer))
	one(t, "approvals", out)
	got := want(t, http.StatusOK, req{Actor: logist, Method: http.MethodGet, Path: fleet(t) + "/driver-transfer-requests/" + str(transfer.Body, "id")})
	expect(t, "transfer", got, str(got.Body, "status") == "approved", got.Body["revision"] == float64(2))
}

// AC-06, «Overlapping active duty produces 409 driver_unavailable»: two requests of one driver for overlapping windows
// approved at the same moment → one temporary assignment; the other approval is 409 (driver_unavailable, the alias of
// resources_unavailable in errors.yaml).
func TestPoolOverlappingApprovals(t *testing.T) { //nolint:paralleltest // the drivers and the clock of the fixtures are shared by the tests
	pid := poolDriver(t)
	w := newWindow()
	first := requestTransfer(t, pid, w)
	second := requestTransfer(t, pid, window{from: w.from.Add(2 * time.Hour), until: w.until.Add(2 * time.Hour)})
	out := race(t, approve(t, neighbour, first), approve(t, owner, second))
	ok, busy := 0, 0
	for _, r := range out {
		switch {
		case r.Status == http.StatusOK:
			ok++
		case r.Status == http.StatusConflict && (r.Code() == "driver_unavailable" || r.Code() == "resources_unavailable"):
			busy++
		default:
			t.Fatalf("overlapping approvals: %s", r)
		}
	}
	expect(t, "overlapping approvals", tally(out), ok == 1, busy == 1)
}
