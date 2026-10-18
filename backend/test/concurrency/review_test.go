//go:build concurrency

package concurrency

import (
	"fmt"
	"net/http"
	"testing"
)

// staleOrDone is the answer of the loser of a race of two decisions with one If-Match: the revision moved (412
// revision_mismatch) or the object is already decided (409 invalid_transition).
func staleOrDone(r reply) bool {
	return (r.Status == http.StatusPreconditionFailed && r.Code() == "revision_mismatch") ||
		(r.Status == http.StatusConflict && r.Code() == "invalid_transition")
}

// one splits the answers of a race of two decisions: exactly one 200 (the winner, its index) and the other the
// loser of staleOrDone.
func one(t *testing.T, what string, out []reply) int {
	t.Helper()
	win := -1
	for i, r := range out {
		switch {
		case r.Status == http.StatusOK && win < 0:
			win = i
		case staleOrDone(r):
		default:
			t.Fatalf("%s: answer %d %s; all %v", what, i, r, tally(out))
		}
	}
	if win < 0 {
		t.Fatalf("%s: no decision won: %v", what, tally(out))
	}
	return win
}

// reviews counts the decisions on the shift of trip (fleet.trip_reviews) and the audit rows of fleet.trip.review.
func reviews(t *testing.T, trip string) (rounds, audit int) {
	t.Helper()
	return scalar[int](t, `select count(*) from fleet.trip_reviews where trip_id = $1::uuid`, trip),
		scalar[int](t, `select count(*) from audit.events where action = 'fleet.trip.review' and target_id = $1::uuid`, trip)
}

// S2-10: two managers accept one shift at the same moment with the ETag of the same card → exactly one decision; the
// other is 412 revision_mismatch or 409 invalid_transition «Смена уже обработана». One round of the review, the trip
// accepted, the vehicle free again, the expense approved with the acceptance.
func TestReviewTwoManagersAccept(t *testing.T) { //nolint:paralleltest // one trip on the route per driver (trips_active_driver_uq)
	for round := range 2 {
		s := submitted(t)
		_, tag := s.plan(t, logist)
		approve := map[string]any{"decision": "approve"}
		out := race(t, s.reviewReq(t, logist, tag, approve), s.reviewReq(t, region, tag, approve))
		what := fmt.Sprintf("round %d", round+1)
		one(t, what, out)
		state, _ := s.plan(t, logist)
		rounds, audit := reviews(t, s.trip)
		x := want(t, http.StatusOK, req{Actor: logist, Method: http.MethodGet, Path: s.path(t) + "/expenses/" + s.expense})
		expect(t, what, map[string]any{"state": state, "rounds": rounds, "audit": audit, "expense": str(x.Body, "reviewState")},
			state == "accepted", rounds == 1, audit == 1, str(x.Body, "reviewState") == "approved", s.vehicleStatus(t) == "available")
	}
}

// S2-10, S2-11: «Принять» and «Вернуть на доработку» of one shift at the same moment → one decision wins and the shift
// follows it: accepted with the vehicle free, or rework with the vehicle still taken by the trip.
func TestReviewAcceptVersusRework(t *testing.T) { //nolint:paralleltest // one trip on the route per driver (trips_active_driver_uq)
	for round := range 2 {
		s := submitted(t)
		_, tag := s.plan(t, logist)
		out := race(t,
			s.reviewReq(t, logist, tag, map[string]any{"decision": "approve"}),
			s.reviewReq(t, region, tag, map[string]any{"decision": "rework", "comment": "Переснимите одометр", "steps": []string{"photos", "odometer"}}))
		what := fmt.Sprintf("round %d", round+1)
		win := one(t, what, out)
		state, _ := s.plan(t, logist)
		rounds, _ := reviews(t, s.trip)
		status := s.vehicleStatus(t)
		if win == 0 {
			expect(t, what+": approve won", map[string]any{"state": state, "rounds": rounds, "vehicle": status},
				state == "accepted", rounds == 1, status == "available")
			continue
		}
		expect(t, what+": rework won", map[string]any{"state": state, "rounds": rounds, "vehicle": status},
			state == "rework", rounds == 1, status != "available")
		s.close(t)
	}
}

// S2-11: the expense of a shift is approved and rejected by two managers at the same moment with one If-Match → one
// check; the expense keeps the decision of the winner.
func TestReviewExpenseTwice(t *testing.T) { //nolint:paralleltest // one trip on the route per driver (trips_active_driver_uq)
	s := submitted(t)
	path := s.path(t) + "/expenses/" + s.expense
	x := want(t, http.StatusOK, req{Actor: logist, Method: http.MethodGet, Path: path})
	out := race(t,
		req{Actor: logist, Method: http.MethodPost, Path: path + "/review", IfMatch: x.ETag(), Body: map[string]any{"decision": "approve"}},
		req{Actor: region, Method: http.MethodPost, Path: path + "/review", IfMatch: x.ETag(),
			Body: map[string]any{"decision": "reject", "comment": "Чек не читается"}})
	win := one(t, "expense", out)
	got := str(want(t, http.StatusOK, req{Actor: logist, Method: http.MethodGet, Path: path}).Body, "reviewState")
	wantState := map[int]string{0: "approved", 1: "rejected"}[win]
	audit := scalar[int](t, `select count(*) from audit.events where action = 'fleet.expense.review' and target_id = $1::uuid`, s.expense)
	expect(t, "expense", map[string]any{"state": got, "audit": audit}, got == wantState, audit == 1)
	s.accept(t)
}

// S2-12 (Q-55): the owner writes the earnings of an accepted shift from two tabs at the same moment with the ETag of
// the draft → one write (revision 2), the other 412 revision_mismatch; the amount is the one of the winner and the
// ledger (audit finance.earnings.set) has one entry.
func TestEarningsTwoWrites(t *testing.T) { //nolint:paralleltest // one trip on the route per driver (trips_active_driver_uq)
	s := submitted(t)
	s.accept(t)
	draft := want(t, http.StatusOK, req{Actor: owner, Method: http.MethodGet, Path: s.earnings(t)})
	body := func(minor int) map[string]any {
		return map[string]any{"amount": map[string]any{"amountMinor": minor, "currency": "RUB"}, "calculationNote": "Ставка за рейс"}
	}
	out := race(t,
		req{Actor: owner, Method: http.MethodPut, Path: s.earnings(t), IfMatch: draft.ETag(), Body: body(450000)},
		req{Actor: owner, Method: http.MethodPut, Path: s.earnings(t), IfMatch: draft.ETag(), Body: body(500000)})
	wantTally(t, "earnings", out, map[string]int{"200": 1, "412 revision_mismatch": 1})
	win := 0
	if out[1].Status == http.StatusOK {
		win = 1
	}
	got := want(t, http.StatusOK, req{Actor: owner, Method: http.MethodGet, Path: s.earnings(t)})
	amount, _ := got.Body["amount"].(map[string]any)
	ledger := scalar[int](t, `select count(*) from audit.events where action = 'finance.earnings.set'
	   and target_id in (select id from finance.earnings where trip_id = $1::uuid)`, s.trip)
	expect(t, "earnings", got, amount["amountMinor"] == float64([]int{450000, 500000}[win]), got.Body["revision"] == float64(2), ledger == 1)
}
