package review

import (
	"errors"
	"strings"
	"testing"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

func steps(s ...fleetapi.ReworkStep) *[]fleetapi.ReworkStep { return &s }

// wantErr fails unless err is a Problem of code with detail ("" — no error expected).
func wantErr(t *testing.T, name string, err error, code, detail string) {
	t.Helper()
	if code == "" {
		if err != nil {
			t.Errorf("%s: %v, want no error", name, err)
		}
		return
	}
	pe, ok := errors.AsType[*problem.Error](err)
	if !ok || pe.Code != code || pe.Detail != detail {
		t.Errorf("%s: %v, want %s %q", name, err, code, detail)
	}
}

// TestCheckReview: the decisions of the pilot (accept, accept with maintenance, rework by sections) and the texts of
// the contract and the mock for a rework without a comment or a section; reject is 422 in the pilot (Q-W2.00-5).
func TestCheckReview(t *testing.T) {
	t.Parallel()
	long := strings.Repeat("я", 5001)
	for _, c := range []struct {
		name         string
		body         *fleetapi.TripReview
		code, detail string
	}{
		{"нет тела", nil, problem.CodeMalformedRequest, ""},
		{"принять", &fleetapi.TripReview{Decision: fleetapi.TripReviewDecisionApprove}, "", ""},
		{"принять с комментарием", &fleetapi.TripReview{Decision: fleetapi.TripReviewDecisionApprove, Comment: new("Спасибо")}, "", ""},
		{"ремонт", &fleetapi.TripReview{Decision: fleetapi.TripReviewDecisionMaintenanceRequired}, "", ""},
		{"доработка", &fleetapi.TripReview{Decision: fleetapi.TripReviewDecisionRework, Comment: new("Нет фото слева"),
			Steps: steps(fleetapi.ReworkStepPhotos, fleetapi.ReworkStepOdometer)}, "", ""},
		{"доработка без комментария", &fleetapi.TripReview{Decision: fleetapi.TripReviewDecisionRework,
			Steps: steps(fleetapi.ReworkStepPhotos)}, codeValidation, textReworkComment},
		{"доработка с пустым комментарием", &fleetapi.TripReview{Decision: fleetapi.TripReviewDecisionRework, Comment: new("  "),
			Steps: steps(fleetapi.ReworkStepPhotos)}, codeValidation, textReworkComment},
		{"доработка без разделов", &fleetapi.TripReview{Decision: fleetapi.TripReviewDecisionRework, Comment: new("Нет фото")},
			codeValidation, textReworkSteps},
		{"доработка с пустым списком", &fleetapi.TripReview{Decision: fleetapi.TripReviewDecisionRework, Comment: new("Нет фото"),
			Steps: steps()}, codeValidation, textReworkSteps},
		{"неизвестный раздел", &fleetapi.TripReview{Decision: fleetapi.TripReviewDecisionRework, Comment: new("Нет фото"),
			Steps: steps("odo")}, codeValidation, textStep},
		{"разделы не у доработки", &fleetapi.TripReview{Decision: fleetapi.TripReviewDecisionApprove,
			Steps: steps(fleetapi.ReworkStepPhotos)}, codeValidation, textStepsOnlyRework},
		{"отклонить", &fleetapi.TripReview{Decision: fleetapi.TripReviewDecisionReject}, codeValidation, textReject},
		{"неизвестное решение", &fleetapi.TripReview{Decision: "accept"}, codeValidation, textDecision},
		{"длинный комментарий", &fleetapi.TripReview{Decision: fleetapi.TripReviewDecisionApprove, Comment: &long},
			codeValidation, textCommentLong},
	} {
		wantErr(t, c.name, checkReview(c.body), c.code, c.detail)
	}
}

func TestCheckExpenseReview(t *testing.T) {
	t.Parallel()
	long := strings.Repeat("я", 5001)
	for _, c := range []struct {
		name         string
		body         *fleetapi.ExpenseReview
		code, detail string
	}{
		{"нет тела", nil, problem.CodeMalformedRequest, ""},
		{"подтвердить", &fleetapi.ExpenseReview{Decision: fleetapi.ExpenseReviewDecisionApprove}, "", ""},
		{"отклонить", &fleetapi.ExpenseReview{Decision: fleetapi.ExpenseReviewDecisionReject, Comment: new("Чек не читается")}, "", ""},
		{"неизвестное решение", &fleetapi.ExpenseReview{Decision: "accept"}, codeValidation, textExpenseDecision},
		{"длинный комментарий", &fleetapi.ExpenseReview{Decision: fleetapi.ExpenseReviewDecisionReject, Comment: &long},
			codeValidation, textCommentLong},
	} {
		wantErr(t, c.name, checkExpenseReview(c.body), c.code, c.detail)
	}
}

// TestNoticeTitles: the notifications of the driver (the mock W2.00 reviewTrip).
func TestNoticeTitles(t *testing.T) {
	t.Parallel()
	for got, want := range map[string]string{
		acceptedTitle("Р-208", false):          "Смена Р-208 принята. Машина свободна.",
		acceptedTitle("Р-208", true):           "Смена Р-208 принята. Машина отправлена в ремонт.",
		reworkTitle("Р-208", "Нет фото слева"): "Смена Р-208 возвращена на доработку: Нет фото слева",
	} {
		if got != want {
			t.Errorf("title %q, want %q", got, want)
		}
	}
	if got := reworkTitle("Р-208", strings.Repeat("я", 400)); len([]rune(got)) > 300 {
		t.Errorf("rework title of %d characters, want at most 300 (inbox.Notice)", len([]rune(got)))
	}
}
