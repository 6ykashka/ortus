package expenses

import (
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// Problem codes of the module (api/errors.yaml).
const (
	codeValidation        = "validation_failed"
	codeAmount            = "amount_invalid"
	codeInvalidTransition = "invalid_transition"
	codePhotoNotReady     = "photo_not_ready"
	codeIdemInProgress    = "idempotency_in_progress"
)

// Texts of the answers: validateExpense of the prototype (fleetrules), the mock W2.00 and W2.40 (expenses.ts).
const (
	textOtherComment  = "Для категории «Прочее» добавьте комментарий"
	textCurrency      = "Расходы пилота — в рублях."
	textAmountZero    = "Сумма должна быть больше нуля"
	textAmountBig     = "Больше 200 000 ₽ — проверьте сумму"
	textReceipt       = "Добавьте фото чека"
	textOneReceipt    = "Один чек на расход."
	textLiters        = "Укажите литры топлива."
	textLitersValue   = "Литры — число больше нуля."
	textCommentLong   = "Комментарий — не длиннее 1000 символов."
	textDate          = "Укажите дату"
	textTripNotFound  = "Рейс не найден."
	textNotFound      = "Расход не найден."
	textDriverOnly    = "Расход добавляет водитель рейса."
	textClosed        = "Расходы добавляются в рейсе и при сдаче."
	textForeign       = "Чек не относится к этому рейсу."
	textUsed          = "Чек уже прикреплён к другому расходу."
	textReceiptNotYet = "Фото чека ещё не загружено"
)

// Codes of seed categories the rules know (tenant 0015). Since the contract 0.6.1-stage2 (W2.52) TripExpense.kind is
// a code of the tenant catalogue fleet.expense_categories (W2.41, categories.go): fuel needs its litres, «прочее» a
// comment in every tenant (CHECK of tenant 0013 and 0015); fines are not driver expenses and have no category.
const (
	kindFuel  = "fuel"
	kindOther = "other"
)

// maxMinor is 200 000 ₽ in kopecks — the upper bound of an expense (validateExpense of the prototype).
const maxMinor = 200_000 * 100

const (
	maxComment = 1000
	currency   = "RUB"
)

// litersRE is a quantity of litres fleet.expenses.liters (numeric(8,2)) holds: up to 999 999 and three decimals of
// the contract (rounded to two by the column).
var litersRE = regexp.MustCompile(`^[0-9]{1,6}(\.[0-9]{1,3})?$`)

func invalid(detail string) *problem.Error { return problem.New(codeValidation, detail) }

func blank(s *string) bool { return s == nil || strings.TrimSpace(*s) == "" }

// validateCreate checks the body of createTripExpense before the trip is read. In the pilot an expense has exactly one
// receipt (fleet.expenses.receipt_file_id) and fuel has its litres (CHECK of tenant 0002).
func validateCreate(b *fleetapi.TripExpenseCreate) error {
	switch {
	case b == nil:
		return problem.New(problem.CodeMalformedRequest, "")
	case !codeRE.MatchString(b.Kind): // the category itself — checkKind in the transaction
		return invalid(textKindUnknown)
	case b.OccurredAt.IsZero():
		return invalid(textDate)
	case b.Amount.AmountMinor <= 0:
		return problem.New(codeAmount, textAmountZero)
	case b.Amount.AmountMinor > maxMinor:
		return problem.New(codeAmount, textAmountBig)
	case b.Amount.Currency != currency:
		return invalid(textCurrency)
	case b.Kind == kindOther && blank(b.Comment):
		return invalid(textOtherComment)
	case b.Comment != nil && utf8.RuneCountInString(*b.Comment) > maxComment:
		return invalid(textCommentLong)
	case len(b.ReceiptFileIds) == 0:
		return invalid(textReceipt)
	case len(b.ReceiptFileIds) > 1:
		return invalid(textOneReceipt)
	}
	return checkLiters(b)
}

func checkLiters(b *fleetapi.TripExpenseCreate) error {
	if b.Quantity == nil {
		if b.Kind == kindFuel {
			return invalid(textLiters)
		}
		return nil
	}
	q := strings.TrimSpace(*b.Quantity)
	if !litersRE.MatchString(q) {
		return invalid(textLitersValue)
	}
	if v, err := strconv.ParseFloat(q, 64); err != nil || v <= 0 {
		return invalid(textLitersValue)
	}
	return nil
}

// reviewState is TripExpense.reviewState of fleet.expenses.state: a claimed expense waits for the manager; a
// reimbursed one was approved first.
func reviewState(state string) fleetapi.TripExpenseReviewState {
	switch state {
	case "verified", "reimbursed":
		return fleetapi.TripExpenseReviewStateApproved
	case "rejected":
		return fleetapi.TripExpenseReviewStateRejected
	}
	return fleetapi.TripExpenseReviewStatePending
}

// occurredDay is the day (fleet.expenses.occurred_on) of the instant at in the time zone of the trip unit.
func occurredDay(at time.Time, loc *time.Location) time.Time {
	y, m, d := at.In(loc).Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// occurredAt is TripExpense.occurredAt of a day: noon of the day in the time zone of the trip unit (the form of the
// driver sends noon of the chosen day).
func occurredAt(day time.Time, loc *time.Location) time.Time {
	y, m, d := day.Date()
	return time.Date(y, m, d, 12, 0, 0, 0, loc).UTC()
}
