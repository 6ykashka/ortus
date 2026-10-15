package fleetrules

import (
	"encoding/json"
	"testing"
)

func TestValidateExpense_Fixture(t *testing.T) {
	t.Parallel()
	var fx struct {
		Cases []struct {
			Name    string          `json:"name"`
			Expense ExpenseDraft    `json:"expense"`
			Want    json.RawMessage `json:"want"`
		} `json:"cases"`
	}
	loadFixture(t, "validateExpense", &fx)
	if len(fx.Cases) == 0 {
		t.Fatal("validateExpense.json: нет кейсов")
	}
	for _, c := range fx.Cases {
		t.Run(c.Name, func(t *testing.T) {
			t.Parallel()
			assertJSON(t, ValidateExpense(c.Expense), c.Want)
		})
	}
}

func TestExpenseErrors_OKAndFirst(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		in        ExpenseErrors
		wantOK    bool
		wantFirst string
	}{
		{name: "нет ошибок", in: ExpenseErrors{}, wantOK: true},
		{name: "сумма первой", in: ExpenseErrors{Amount: "a", Date: "d", Receipt: "r"}, wantFirst: "a"},
		{name: "дата раньше чека", in: ExpenseErrors{Date: "d", Receipt: "r"}, wantFirst: "d"},
		{name: "только чек", in: ExpenseErrors{Receipt: "r"}, wantFirst: "r"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if tt.in.OK() != tt.wantOK {
				t.Errorf("OK() = %v, want %v", tt.in.OK(), tt.wantOK)
			}
			if got := tt.in.First(); got != tt.wantFirst {
				t.Errorf("First() = %q, want %q", got, tt.wantFirst)
			}
		})
	}
}

func TestValidateExpense_GoValues(t *testing.T) {
	t.Parallel()
	got := ValidateExpense(ExpenseDraft{
		Amount:  Number(1500.5),
		Date:    "2026-10-01",
		Receipt: &Photo{State: PhotoReady},
	})
	if !got.OK() {
		t.Errorf("ValidateExpense = %+v, want без ошибок", got)
	}
	got = ValidateExpense(ExpenseDraft{})
	want := ExpenseErrors{Amount: "Укажите сумму", Date: "Укажите дату", Receipt: "Добавьте фото чека"}
	if got != want {
		t.Errorf("ValidateExpense(пусто) = %+v, want %+v", got, want)
	}
}
