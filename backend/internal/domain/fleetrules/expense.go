package fleetrules

import (
	"math"
	"strings"
)

// ExpenseDraft — черновик расхода в пути: сумма (строка ввода с запятой и пробелами или число),
// дата (пустая строка — не указана) и фото чека.
type ExpenseDraft struct {
	Amount  FormValue `json:"amount"`
	Date    string    `json:"date"`
	Receipt *Photo    `json:"receipt"`
}

// ExpenseErrors — ошибки формы расхода по полям; пустая строка — поле без ошибки.
type ExpenseErrors struct {
	Amount  string `json:"amount,omitempty"`
	Date    string `json:"date,omitempty"`
	Receipt string `json:"receipt,omitempty"`
}

// OK сообщает, что расход можно отправить.
func (e ExpenseErrors) OK() bool { return e == ExpenseErrors{} }

// First возвращает первую ошибку в порядке полей (сумма, дата, чек) — её сервер отдаёт как
// validation, как мок эталона; пустая строка — ошибок нет.
func (e ExpenseErrors) First() string {
	for _, s := range []string{e.Amount, e.Date, e.Receipt} {
		if s != "" {
			return s
		}
	}
	return ""
}

// maxExpenseRub — сумма, больше которой расход считается ошибкой ввода.
const maxExpenseRub = 200000

// ValidateExpense проверяет форму расхода (validateExpense эталона): сумма (запятая вместо
// точки и пробелы допустимы, больше нуля и не больше 200 000 ₽), дата, чек готов или в очереди.
func ValidateExpense(e ExpenseDraft) ExpenseErrors {
	var err ExpenseErrors
	a := toNumber(strings.Replace(e.Amount.jsString(), ",", ".", 1))
	switch {
	case e.Amount.IsEmpty() || e.Amount == Text(""):
		err.Amount = "Укажите сумму"
	case math.IsNaN(a) || math.IsInf(a, 0):
		err.Amount = "Сумма должна быть числом"
	case a <= 0:
		err.Amount = "Сумма должна быть больше нуля"
	case a > maxExpenseRub:
		err.Amount = "Больше 200 000 ₽ — проверьте сумму"
	}
	if e.Date == "" {
		err.Date = "Укажите дату"
	}
	switch {
	case e.Receipt != nil && e.Receipt.State == PhotoUploading:
		err.Receipt = "Дождитесь окончания загрузки чека"
	case !e.Receipt.counts():
		err.Receipt = "Добавьте фото чека"
	}
	return err
}
