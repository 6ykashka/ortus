package finance

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	earningsapi "github.com/ortus/ortus-crm/backend/internal/api/earnings"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// Problem codes of the module (api/errors.yaml).
const (
	codeValidation       = "validation_failed"
	codeRevisionRequired = "revision_required"
	codeRevisionMismatch = "revision_mismatch"
	codeIdemInProgress   = "idempotency_in_progress"
	codeFunctionBlocked  = "function_blocked"
)

// Texts of the answers: the mock W2.00 (adapter/src/msw/fleet/earnings.ts) where it has one.
const (
	textTripNotFound = "Рейс не найден."
	textNoEarnings   = "Начисления по рейсу нет: оно появляется при приёмке смены."
	textDriver       = "Функция «Водитель» закрывает начисления."
	textAmount       = "Сумма начисления — не меньше нуля."
	textAmountBig    = "Сумма начисления слишком большая."
	textCurrency     = "Начисления пилота — в рублях."
	textNoteLong     = "Примечание — не длиннее 5000 символов."
	textStale        = "Данные изменились. Обновите страницу и повторите."
)

const (
	// maxMinor is the largest amount in kopecks a client may send (Money.amountMinor, 2^53 − 1).
	maxMinor = 9007199254740991
	maxNote  = 5000
	currency = "RUB"
)

func invalid(detail string) *problem.Error { return problem.New(codeValidation, detail) }

// checkUpdate checks the body of setTripEarnings before the trip is read: roubles, at least zero
// (finance.earnings.amount_minor), a note up to 5000 characters.
func checkUpdate(b *earningsapi.EarningsUpdate) error {
	switch {
	case b == nil:
		return problem.New(problem.CodeMalformedRequest, "")
	case b.Amount.AmountMinor < 0:
		return invalid(textAmount)
	case b.Amount.AmountMinor > maxMinor:
		return invalid(textAmountBig)
	case b.Amount.Currency != currency:
		return invalid(textCurrency)
	case b.CalculationNote != nil && utf8.RuneCountInString(*b.CalculationNote) > maxNote:
		return invalid(textNoteLong)
	}
	return nil
}

// note is the calculation note of a write: a blank one is none.
func note(b earningsapi.EarningsUpdate) *string {
	if b.CalculationNote == nil || strings.TrimSpace(*b.CalculationNote) == "" {
		return nil
	}
	n := strings.TrimSpace(*b.CalculationNote)
	return &n
}

// pageCursor is the keyset position after the last item of a page: the moment of the earnings, the trip.
type pageCursor struct {
	At time.Time `json:"t"`
	ID uuid.UUID `json:"i"`
}

func encodeCursor(c pageCursor) string {
	b, _ := json.Marshal(c) // plain fields always marshal
	return base64.RawURLEncoding.EncodeToString(b)
}

func decodeCursor(raw string) (pageCursor, error) {
	var c pageCursor
	b, err := base64.RawURLEncoding.DecodeString(raw)
	if err == nil {
		err = json.Unmarshal(b, &c)
	}
	if err != nil || c.ID == uuid.Nil || c.At.IsZero() {
		return pageCursor{}, problem.New(problem.CodeMalformedRequest, "Курсор не подходит к запросу.")
	}
	return c, nil
}
