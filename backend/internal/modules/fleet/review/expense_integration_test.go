//go:build integration

package review_test

import (
	"testing"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// TestReviewExpense: the manager approves and rejects one expense of a returned shift (S2-11) with the If-Match of
// the expense; a decided expense is 409; the acceptance of the shift confirms only the waiting ones.
func TestReviewExpense(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	sh := seedShift(t, "a", "msk1", person("a.driver-msk1"), "submitted")
	d := db(t, "a")
	manager := e.tc(t, "a.manager-msk1", "a")
	wash, other := sh.Expenses[0], sh.Expenses[1]
	out, err := e.svc.ReviewExpense(t.Context(), manager, sh.ID, wash, etag(1), fleetapi.ExpenseReview{Decision: fleetapi.ExpenseReviewDecisionApprove})
	if err != nil {
		t.Fatalf("ReviewExpense(approve): %v", err)
	}
	expect(t, "TripExpense", out, out.Id == wash, out.TripId == sh.ID, out.ReviewState == fleetapi.TripExpenseReviewStateApproved,
		out.Revision == 2, out.Amount.AmountMinor == 50000, out.Amount.Currency == "RUB", out.Kind == "wash")
	if st := scalar[string](t, d, `select state from fleet.expenses where id = $1 and reviewed_by = $2 and reviewed_at = $3`,
		wash, person("a.manager-msk1"), e.now); st != "verified" {
		t.Fatalf("state %s, want verified", st)
	}
	_, err = e.svc.ReviewExpense(t.Context(), manager, sh.ID, wash, etag(2), fleetapi.ExpenseReview{Decision: fleetapi.ExpenseReviewDecisionReject})
	wantProblem(t, err, "invalid_transition", "Расход уже проверен.")
	_, err = e.svc.ReviewExpense(t.Context(), manager, sh.ID, other, "", fleetapi.ExpenseReview{Decision: fleetapi.ExpenseReviewDecisionReject})
	wantProblem(t, err, "revision_required", "")
	out, err = e.svc.ReviewExpense(t.Context(), manager, sh.ID, other, etag(1), fleetapi.ExpenseReview{
		Decision: fleetapi.ExpenseReviewDecisionReject, Comment: new("Чек не читается")})
	if err != nil {
		t.Fatalf("ReviewExpense(reject): %v", err)
	}
	expect(t, "TripExpense", out, out.ReviewState == fleetapi.TripExpenseReviewStateRejected, out.Comment != nil && *out.Comment == "Замена лампы фары")
	if n := scalar[int](t, d, `select count(*) from audit.events where action = 'fleet.expense.review' and target_id = any($1::uuid[])`,
		[]uuid.UUID{wash, other}); n != 2 {
		t.Fatalf("audit of the expense reviews: %d, want 2", n)
	}
	if n := scalar[int](t, d, `select count(*) from outbox.events where type = 'fleet.expense.reviewed.v1' and aggregate_id = $1`, other); n != 1 {
		t.Fatalf("events of the expense review: %d, want 1", n)
	}
	// The acceptance leaves a rejected expense rejected; afterwards the expenses of the shift are closed.
	_, rev := state(t, sh)
	if _, err := e.svc.Review(t.Context(), manager, sh.ID, etag(rev), fleetapi.TripReview{Decision: fleetapi.TripReviewDecisionApprove}); err != nil {
		t.Fatalf("Review: %v", err)
	}
	if st := scalar[string](t, d, `select state from fleet.expenses where id = $1`, other); st != "rejected" {
		t.Fatalf("rejected expense after the acceptance: %s", st)
	}
	late := uuid.New()
	exec(t, d, `insert into fleet.expenses (id, trip_id, category, amount_minor, occurred_on, claimed_by)
	            values ($1, $2, 'parking', 20000, current_date, $3)`, late, sh.ID, sh.Driver)
	_, err = e.svc.ReviewExpense(t.Context(), manager, sh.ID, late, etag(1), fleetapi.ExpenseReview{Decision: fleetapi.ExpenseReviewDecisionApprove})
	wantProblem(t, err, "invalid_transition", "Расходы проверяют до приёмки смены.")
}

// TestReviewExpenseRefusals: the expense of another trip, a missing or invisible one is 404; the driver without the
// right is 403; the manager never checks his own expense.
func TestReviewExpenseRefusals(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	sh := seedShift(t, "a", "msk1", person("a.driver-msk1"), "submitted")
	another := seedShift(t, "a", "msk1", person("a.driver-msk1"), "submitted")
	manager := e.tc(t, "a.manager-msk1", "a")
	approve := fleetapi.ExpenseReview{Decision: fleetapi.ExpenseReviewDecisionApprove}
	_, err := e.svc.ReviewExpense(t.Context(), manager, sh.ID, uuid.New(), etag(1), fleetapi.ExpenseReview{Decision: "accept"})
	wantProblem(t, err, "validation_failed", "Неизвестное решение по расходу.")
	_, err = e.svc.ReviewExpense(t.Context(), manager, another.ID, sh.Expenses[0], etag(1), approve)
	wantProblem(t, err, problem.CodeNotFound, "Расход не найден.")
	_, err = e.svc.ReviewExpense(t.Context(), manager, uuid.New(), sh.Expenses[0], etag(1), approve)
	wantProblem(t, err, problem.CodeNotFound, "Рейс не найден.")
	_, err = e.svc.ReviewExpense(t.Context(), e.tc(t, "a.manager-msk2", "a"), sh.ID, sh.Expenses[0], etag(1), approve)
	wantProblem(t, err, problem.CodeNotFound, "Рейс не найден.")
	_, err = e.svc.ReviewExpense(t.Context(), e.tc(t, "a.driver-msk1", "a"), sh.ID, sh.Expenses[0], etag(1), approve)
	wantProblem(t, err, problem.CodeForbiddenAction, "")
	_, err = e.svc.ReviewExpense(t.Context(), manager, sh.ID, sh.Expenses[0], etag(3), approve)
	wantProblem(t, err, "revision_mismatch", "")
	own := seedShift(t, "a", "msk1", person("a.manager-msk1"), "submitted")
	_, err = e.svc.ReviewExpense(t.Context(), manager, own.ID, own.Expenses[0], etag(1), approve)
	wantProblem(t, err, problem.CodeForbiddenAction, "Свой расход проверяет другой менеджер.")
}
