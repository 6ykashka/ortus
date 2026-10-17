package expenses

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

func wantProblem(t *testing.T, err error, code, detail string) {
	t.Helper()
	pe, ok := errors.AsType[*problem.Error](err)
	if !ok || pe.Code != code || (detail != "" && pe.Detail != detail) {
		t.Fatalf("error %v, want %s %q", err, code, detail)
	}
}

func body(kind string) fleetapi.TripExpenseCreate {
	return fleetapi.TripExpenseCreate{Kind: fleetapi.TripExpenseCreateKind(kind), OccurredAt: time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC),
		Amount: fleetapi.Money{AmountMinor: 50000, Currency: "RUB"}, ReceiptFileIds: []uuid.UUID{uuid.New()}}
}

// TestValidateCreate: the six categories of D-12 (answer of 17.10), «прочее» with a comment, the amount bounds of
// validateExpense of the prototype, one receipt, litres of fuel.
func TestValidateCreate(t *testing.T) {
	t.Parallel()
	for _, k := range []string{"fuel", "wash", "parking", "toll", "tire_service", "other"} {
		b := body(k)
		if k == "other" {
			b.Comment = new("Ремень ГРМ")
		}
		if k == "fuel" {
			b.Quantity = new("40.5")
		}
		if err := validateCreate(&b); err != nil {
			t.Errorf("%s: %v", k, err)
		}
	}
	wantProblem(t, validateCreate(nil), problem.CodeMalformedRequest, "")
	fine := body("fine")
	wantProblem(t, validateCreate(&fine), codeValidation, textKind) // fines are not driver expenses
	other := body("other")
	wantProblem(t, validateCreate(&other), codeValidation, textOtherComment)
	other.Comment = new("   ")
	wantProblem(t, validateCreate(&other), codeValidation, textOtherComment)
	zero := body("wash")
	zero.Amount.AmountMinor = 0
	wantProblem(t, validateCreate(&zero), codeAmount, "Сумма должна быть больше нуля")
	big := body("wash")
	big.Amount.AmountMinor = 20_000_001
	wantProblem(t, validateCreate(&big), codeAmount, "Больше 200 000 ₽ — проверьте сумму")
	limit := body("wash")
	limit.Amount.AmountMinor = 20_000_000
	if err := validateCreate(&limit); err != nil {
		t.Errorf("200 000 ₽ exactly: %v", err)
	}
	usd := body("wash")
	usd.Amount.Currency = "USD"
	wantProblem(t, validateCreate(&usd), codeValidation, textCurrency)
	none := body("wash")
	none.ReceiptFileIds = nil
	wantProblem(t, validateCreate(&none), codeValidation, textReceipt)
	two := body("wash")
	two.ReceiptFileIds = append(two.ReceiptFileIds, uuid.New())
	wantProblem(t, validateCreate(&two), codeValidation, textOneReceipt)
	fuel := body("fuel")
	wantProblem(t, validateCreate(&fuel), codeValidation, textLiters)
	for _, q := range []string{"0", "-1", "abc", "1.2.3", "1000000"} {
		fuel.Quantity = new(q)
		wantProblem(t, validateCreate(&fuel), codeValidation, textLitersValue)
	}
	long := body("wash")
	long.Comment = new(strings.Repeat("я", 1001))
	wantProblem(t, validateCreate(&long), codeValidation, textCommentLong)
	when := body("wash")
	when.OccurredAt = time.Time{}
	wantProblem(t, validateCreate(&when), codeValidation, textDate)
}

func TestReviewState(t *testing.T) {
	t.Parallel()
	for db, want := range map[string]fleetapi.TripExpenseReviewState{
		"claimed": "pending", "verified": "approved", "rejected": "rejected", "reimbursed": "approved",
	} {
		if got := reviewState(db); got != want {
			t.Errorf("reviewState(%s) = %s, want %s", db, got, want)
		}
	}
}

// TestOccurredDay: the day of an expense is the day of the instant in the time zone of the trip unit; it reads back
// as noon of that day (the form of the driver sends noon of the chosen day, W2.22).
func TestOccurredDay(t *testing.T) {
	t.Parallel()
	msk, err := time.LoadLocation("Europe/Moscow")
	if err != nil {
		t.Fatal(err)
	}
	at := time.Date(2026, 9, 30, 22, 30, 0, 0, time.UTC) // 01.10 01:30 in Moscow
	day := occurredDay(at, msk)
	if day.Format(time.DateOnly) != "2026-10-01" {
		t.Fatalf("occurredDay = %s", day)
	}
	if got := occurredAt(day, msk); !got.Equal(time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)) {
		t.Fatalf("occurredAt = %s", got)
	}
}
