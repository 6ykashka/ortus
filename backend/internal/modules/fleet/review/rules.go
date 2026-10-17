package review

import (
	"strings"
	"unicode/utf8"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// Problem codes of the module (api/errors.yaml).
const (
	codeValidation        = "validation_failed"
	codeInvalidTransition = "invalid_transition"
	codeRevisionRequired  = "revision_required"
	codeRevisionMismatch  = "revision_mismatch"
	codeIdemInProgress    = "idempotency_in_progress"
)

// Texts of the answers: the contract (TripReview.steps) and the mock W2.00 (adapter/src/msw/fleet/{trips,expenses}.ts)
// where they have one.
const (
	textReworkComment   = "Опишите, что нужно исправить"
	textReworkSteps     = "Отметьте хотя бы один раздел для доработки"
	textStepsOnlyRework = "Разделы доработки — только при возврате на доработку."
	textReject          = "В пилоте смену принимают или возвращают на доработку."
	textDecision        = "Неизвестное решение по смене."
	textStep            = "Неизвестный раздел доработки."
	textCommentLong     = "Комментарий — не длиннее 5000 символов."
	textExpenseDecision = "Неизвестное решение по расходу."
	textProcessed       = "Смена уже обработана"
	textExpenseDone     = "Расход уже проверен."
	textExpenseClosed   = "Расходы проверяют до приёмки смены."
	textTripNotFound    = "Рейс не найден."
	textExpenseNotFound = "Расход не найден."
	textOwnShift        = "Свою смену принимает другой менеджер."
	textOwnExpense      = "Свой расход проверяет другой менеджер."
	textStale           = "Данные изменились. Обновите страницу и повторите."
)

// maxComment is the length of a review comment (TripReview.comment, ExpenseReview.comment, fleet.trip_reviews).
const maxComment = 5000

// maxTitle is the length of a notification title (inbox.Notice).
const maxTitle = 300

// reworkSteps are the sections of a rework (ReworkStep, the check of tenant 0011).
var reworkSteps = map[fleetapi.ReworkStep]bool{
	fleetapi.ReworkStepPhotos: true, fleetapi.ReworkStepOdometer: true,
	fleetapi.ReworkStepExpenses: true, fleetapi.ReworkStepChecklist: true,
}

func invalid(detail string) *problem.Error { return problem.New(codeValidation, detail) }

func blank(s *string) bool { return s == nil || strings.TrimSpace(*s) == "" }

func tooLong(s *string) bool { return s != nil && utf8.RuneCountInString(*s) > maxComment }

// checkReview checks the body of reviewTrip before the trip is read: in the pilot a shift is accepted (approve,
// maintenance_required) or sent back by sections with a comment (rework); reject is 422 (Q-W2.00-5).
func checkReview(b *fleetapi.TripReview) error {
	if b == nil {
		return problem.New(problem.CodeMalformedRequest, "")
	}
	var steps []fleetapi.ReworkStep
	if b.Steps != nil {
		steps = *b.Steps
	}
	switch b.Decision {
	case fleetapi.TripReviewDecisionApprove, fleetapi.TripReviewDecisionMaintenanceRequired:
		if len(steps) > 0 {
			return invalid(textStepsOnlyRework)
		}
	case fleetapi.TripReviewDecisionRework:
		switch {
		case blank(b.Comment):
			return invalid(textReworkComment)
		case len(steps) == 0:
			return invalid(textReworkSteps)
		}
		for _, s := range steps {
			if !reworkSteps[s] {
				return invalid(textStep)
			}
		}
	case fleetapi.TripReviewDecisionReject:
		return invalid(textReject)
	default:
		return invalid(textDecision)
	}
	if tooLong(b.Comment) {
		return invalid(textCommentLong)
	}
	return nil
}

// checkExpenseReview checks the body of reviewTripExpense before the expense is read.
func checkExpenseReview(b *fleetapi.ExpenseReview) error {
	switch {
	case b == nil:
		return problem.New(problem.CodeMalformedRequest, "")
	case b.Decision != fleetapi.ExpenseReviewDecisionApprove && b.Decision != fleetapi.ExpenseReviewDecisionReject:
		return invalid(textExpenseDecision)
	case tooLong(b.Comment):
		return invalid(textCommentLong)
	}
	return nil
}

// acceptedTitle is the notification of the driver about an accepted shift (the mock W2.00: «Смена {номер} принята.
// Машина свободна.»); with maintenance the vehicle is not free.
func acceptedTitle(number string, maintenance bool) string {
	if maintenance {
		return "Смена " + number + " принята. Машина отправлена в ремонт."
	}
	return "Смена " + number + " принята. Машина свободна."
}

// reworkTitle is the notification of the driver about a shift sent back for rework (the mock W2.00), cut to the
// length of a notification title.
func reworkTitle(number, comment string) string {
	title := strings.TrimSpace("Смена " + number + " возвращена на доработку: " + strings.TrimSpace(comment))
	if utf8.RuneCountInString(title) <= maxTitle {
		return title
	}
	r := []rune(title)
	return string(r[:maxTitle-1]) + "…"
}

// decided is the state of fleet.expenses an expense decision leaves.
func decided(d fleetapi.ExpenseReviewDecision) string {
	if d == fleetapi.ExpenseReviewDecisionApprove {
		return "verified"
	}
	return "rejected"
}

// reviewState is TripExpense.reviewState of fleet.expenses.state (as W2.05 fleet/expenses).
func reviewState(state string) fleetapi.TripExpenseReviewState {
	switch state {
	case "verified", "reimbursed":
		return fleetapi.TripExpenseReviewStateApproved
	case "rejected":
		return fleetapi.TripExpenseReviewStateRejected
	}
	return fleetapi.TripExpenseReviewStatePending
}
