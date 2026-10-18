//go:build concurrency

package concurrency

import (
	"fmt"
	"net/http"
	"testing"
)

// defects are the defects of an inspection answer (id and ETag of each).
func defects(t *testing.T, insp reply) []map[string]any {
	t.Helper()
	raw, _ := insp.Body["defects"].([]any)
	out := []map[string]any{}
	for _, d := range raw {
		if m, ok := d.(map[string]any); ok {
			out = append(out, m)
		}
	}
	if len(out) == 0 {
		t.Fatalf("inspection without defects: %s", insp)
	}
	return out
}

// blocked plans and reserves a trip of the driver of the shifts and submits its departure inspection with the
// blocking defects of zones: the inspection waits for the manager and the trip is in defect_review.
func blocked(t *testing.T, zones ...string) (*shift, []map[string]any) {
	t.Helper()
	return blockedOf(t, ours(t), zones...)
}

// blockedOf is blocked for crew c.
func blockedOf(t *testing.T, c crew, zones ...string) (*shift, []map[string]any) {
	t.Helper()
	s := newShiftOf(t, c)
	s.reserve(t)
	ds := make([]map[string]any, 0, len(zones))
	for _, z := range zones {
		ds = append(ds, blocking(z))
	}
	insp := s.inspectDeparture(t, ds...)
	if str(insp.Body, "status") != "requires_review" {
		t.Fatalf("inspection with a blocking defect: %s", insp)
	}
	if state, _ := s.plan(t, logist); state != "defect_review" {
		t.Fatalf("trip with a blocking defect: %s, want defect_review", state)
	}
	return s, defects(t, insp)
}

// decision is a decision of actor on defect d with its revision as If-Match.
func decision(t *testing.T, actor string, d map[string]any, kind string) req {
	t.Helper()
	return req{Actor: actor, Method: http.MethodPost, Path: fleet(t) + "/defects/" + str(d, "id") + "/decision",
		IfMatch: fmt.Sprintf(`"%v"`, d["revision"]), Body: map[string]any{"decision": kind, "comment": "Решение гонки"}}
}

// inspection is the status of the departure inspection of s.
func (s *shift) inspection(t *testing.T) string {
	t.Helper()
	return str(want(t, http.StatusOK, req{Actor: logist, Method: http.MethodGet, Path: fleet(t) + "/inspections/" + s.departure}).Body, "status")
}

// S2-17 (AC-04): two managers allow the departure on one blocking defect at the same moment → one decision; the
// other is 412 or 409. The inspection is approved, the trip is back at the departure with its hold, and the start
// goes through.
func TestDefectTwoAllows(t *testing.T) { //nolint:paralleltest // one trip on the route per driver (trips_active_driver_uq)
	for round := range 2 {
		s, ds := blocked(t, "Шины и колёса")
		out := race(t, decision(t, logist, ds[0], "allow_departure"), decision(t, region, ds[0], "allow_departure"))
		what := fmt.Sprintf("round %d", round+1)
		one(t, what, out)
		state, _ := s.plan(t, driver)
		audit := scalar[int](t, `select count(*) from audit.events where action like 'fleet.defect.%' and target_id = $1::uuid`, str(ds[0], "id"))
		expect(t, what, map[string]any{"trip": state, "inspection": s.inspection(t), "audit": audit},
			state == "inspection", s.inspection(t) == "approved", audit == 1)
		s.start(t)
		s.close(t)
	}
}

// Two blocking defects of one departure allowed by two managers at the same moment (round 1 of the review of W2.04):
// each decision sees the other, the inspection is approved once both are resolved and the trip goes back to the
// departure — never left in defect_review with no defect waiting.
func TestDefectTwoBlockingAllowedAtOnce(t *testing.T) { //nolint:paralleltest // one trip on the route per driver (trips_active_driver_uq)
	for round := range 3 {
		s, ds := blocked(t, "Шины и колёса", "Тормоза и ходовая")
		out := race(t, decision(t, logist, ds[0], "allow_departure"), decision(t, region, ds[1], "allow_departure"))
		what := fmt.Sprintf("round %d", round+1)
		wantTally(t, what, out, map[string]int{"200": 2})
		state, _ := s.plan(t, driver)
		hold := scalar[string](t, `select state from sched.reservations where id = $1::uuid`, s.reservation)
		expect(t, what, map[string]any{"trip": state, "inspection": s.inspection(t), "hold": hold},
			state == "inspection", s.inspection(t) == "approved", hold == "hold")
		s.start(t)
		s.close(t)
	}
}

// AC-04 (I-06, LOG-03/04): the departure is not confirmed with a missing or unchecked photo or with a blocking defect
// in review — through the API, with the texts of the prototype. 4 photos of 5 → 409 inspection_incomplete «Осмотр не
// завершён: 1 фото»; a photo still being checked → 409 photo_not_ready «Не все фото загружены на сервер»; the start of a
// trip whose departure waits for the manager → 409 blocking_defect_open.
func TestAC04DepartureRefusals(t *testing.T) { //nolint:paralleltest // one trip on the route per driver (trips_active_driver_uq)
	s := newShift(t)
	s.reserve(t)
	photos := files(t, "inspection", "fleet.reservation", s.reservation, 5)
	body := func(ps []map[string]any) map[string]any {
		return map[string]any{
			"checklistVersionId": s.checklist(t, "departure"), "vehicleId": s.vehicle, "reservationId": s.reservation, "kind": "departure",
			"odometerKm": "48250", "fuelPercent": 75, "capturedAt": "2026-10-01T07:20:00Z", "photos": ps,
			"checks": []map[string]any{{"key": "body", "result": "pass"}, {"key": "tires", "result": "pass"}, {"key": "docs", "result": "pass"}},
		}
	}
	four := want(t, http.StatusConflict, req{Actor: driver, Method: http.MethodPost, Path: fleet(t) + "/inspections", Body: body(shots(photos)[:4])})
	expect(t, "4 photos of 5", four, four.Code() == "inspection_incomplete", str(four.Body, "detail") == "Осмотр не завершён: 1 фото")
	execSQL(t, `update files.objects set state = 'scanning', ready_at = null where id = $1::uuid`, photos[4])
	scanning := want(t, http.StatusConflict, req{Actor: driver, Method: http.MethodPost, Path: fleet(t) + "/inspections", Body: body(shots(photos))})
	expect(t, "a photo being checked", scanning, scanning.Code() == "photo_not_ready", str(scanning.Body, "detail") == "Не все фото загружены на сервер")

	b, _ := blocked(t, "Шины и колёса")
	start := want(t, http.StatusConflict, b.startReq(t, ""))
	expect(t, "start with a blocking defect in review", start, start.Code() == "blocking_defect_open")
}

// startRefused tells whether r is a refusal of a start racing the confirmation of its blocking defect: the defect still open
// (409 blocking_defect_open), the trip moved on under the start (409 invalid_transition), or the trip back in planning
// without its departure inspection (422 validation_failed «Нужен осмотр перед выездом этого рейса.», Q-W2.30-3).
func startRefused(r reply) bool {
	switch r.Status {
	case http.StatusConflict:
		return r.Code() == "blocking_defect_open" || r.Code() == "invalid_transition"
	case http.StatusUnprocessableEntity:
		return r.Code() == "validation_failed" && str(r.Body, "detail") == "Нужен осмотр перед выездом этого рейса."
	}
	return false
}

// The start of a trip and the confirmation of its blocking defect at the same moment: the trip never leaves — the start
// is refused by one of startRefused; the fault is confirmed.
func TestDefectConfirmVersusStart(t *testing.T) { //nolint:paralleltest // one trip on the route per driver (trips_active_driver_uq)
	for round := range 3 {
		s, ds := blocked(t, "Шины и колёса")
		out := race(t, s.startReq(t, ""), decision(t, logist, ds[0], "confirm_out_of_service"))
		state, _ := s.plan(t, logist)
		what := fmt.Sprintf("round %d: start %s, confirm %s, trip %s", round+1, out[0], out[1], state)
		expect(t, what, nil, startRefused(out[0]), out[1].Status == http.StatusOK, state == "planned")
	}
}

// «Дефект некритичный — разрешить выезд» and «Подтвердить неисправность» on one defect at the same moment → one
// decision; the shift follows the winner: allowed — the trip goes to the departure and starts; confirmed — the trip is
// back in planning, the vehicle is out of service and the start is refused.
func TestDefectAllowVersusConfirm(t *testing.T) { //nolint:paralleltest // one trip on the route per driver (trips_active_driver_uq)
	for round := range 2 {
		s, ds := blocked(t, "Шины и колёса")
		out := race(t, decision(t, logist, ds[0], "allow_departure"), decision(t, region, ds[0], "confirm_out_of_service"))
		what := fmt.Sprintf("round %d", round+1)
		win := one(t, what, out)
		state, _ := s.plan(t, logist)
		if win == 0 {
			expect(t, what+": allowed", state, state == "inspection", s.inspection(t) == "approved")
			s.start(t)
			s.close(t)
			continue
		}
		expect(t, what+": confirmed", state, state == "planned", s.inspection(t) == "rejected", s.vehicleStatus(t) != "available")
		if r := call(t, s.startReq(t, "")); r.Status < http.StatusBadRequest {
			t.Fatalf("%s: start after the confirmed fault: %s", what, r)
		}
	}
}
