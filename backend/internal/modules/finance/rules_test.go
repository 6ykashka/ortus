package finance

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	earningsapi "github.com/ortus/ortus-crm/backend/internal/api/earnings"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

func rub(minor int) earningsapi.Money { return earningsapi.Money{AmountMinor: minor, Currency: "RUB"} }

var (
	fixedAt = time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	fixedID = uuid.MustParse("6f0e4c1a-5a4b-4c3d-9e8f-102030405060")
)

// TestCheckUpdate: an amount in roubles of at least zero (finance.earnings.amount_minor), a note up to 5000
// characters.
func TestCheckUpdate(t *testing.T) {
	t.Parallel()
	long := strings.Repeat("я", 5001)
	for _, c := range []struct {
		name         string
		body         *earningsapi.EarningsUpdate
		code, detail string
	}{
		{"нет тела", nil, problem.CodeMalformedRequest, ""},
		{"сумма", &earningsapi.EarningsUpdate{Amount: rub(450000)}, "", ""},
		{"ноль", &earningsapi.EarningsUpdate{Amount: rub(0)}, "", ""},
		{"с примечанием", &earningsapi.EarningsUpdate{Amount: rub(450000), CalculationNote: new("Доплата за выходной")}, "", ""},
		{"меньше нуля", &earningsapi.EarningsUpdate{Amount: rub(-1)}, codeValidation, textAmount},
		{"слишком большая", &earningsapi.EarningsUpdate{Amount: rub(9007199254740992)}, codeValidation, textAmountBig},
		{"не рубли", &earningsapi.EarningsUpdate{Amount: earningsapi.Money{AmountMinor: 100, Currency: "USD"}}, codeValidation, textCurrency},
		{"длинное примечание", &earningsapi.EarningsUpdate{Amount: rub(1), CalculationNote: &long}, codeValidation, textNoteLong},
	} {
		err := checkUpdate(c.body)
		if c.code == "" {
			if err != nil {
				t.Errorf("%s: %v, want no error", c.name, err)
			}
			continue
		}
		pe, ok := errors.AsType[*problem.Error](err)
		if !ok || pe.Code != c.code || pe.Detail != c.detail {
			t.Errorf("%s: %v, want %s %q", c.name, err, c.code, c.detail)
		}
	}
}

// TestCursor: the cursor of a page round-trips; garbage is 400.
func TestCursor(t *testing.T) {
	t.Parallel()
	c := pageCursor{At: fixedAt, ID: fixedID}
	got, err := decodeCursor(encodeCursor(c))
	if err != nil || !got.At.Equal(c.At) || got.ID != c.ID {
		t.Fatalf("cursor round trip: %+v %v, want %+v", got, err, c)
	}
	if _, err := decodeCursor("не курсор"); !problem.Is(err, problem.CodeMalformedRequest) {
		t.Fatalf("garbage cursor: %v, want malformed_request", err)
	}
}
