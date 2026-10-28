package service

import (
	"strings"
	"testing"

	api "github.com/ortus/ortus-crm/backend/internal/api/service"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

func detailOf(t *testing.T, err error, code string) string {
	t.Helper()
	pe, ok := err.(*problem.Error) //nolint:errorlint // the rules return the error itself
	if !ok || pe.Code != code {
		t.Fatalf("error %v, want %s", err, code)
	}
	return pe.Detail
}

func TestTitleOfTakesTheFirstSentence(t *testing.T) {
	t.Parallel()
	long := strings.Repeat("я", 90)
	for in, want := range map[string]string{
		"Две коробки помяты. Внутри бой": "Две коробки помяты",
		"  Нет горячей воды!  Совсем  ":  "Нет горячей воды",
		"Первая строка\nвторая":          "Первая строка",
		long:                    strings.Repeat("я", 77) + "…",
		strings.Repeat("я", 80): strings.Repeat("я", 80),
	} {
		eq(t, in, TitleOf(in), want)
	}
}

func TestCheckCallInTheOrderOfThePrototype(t *testing.T) {
	t.Parallel()
	for _, c := range []struct{ name, phone, text, want string }{
		{"О", "+7 900 000-00-00", "Что случилось", "Укажите имя клиента"},
		{"Ольга", "12345", "Что случилось", "Телефон — не меньше 10 цифр"},
		{"Ольга", "+7 (900) 000-00-00", "коротк", ""},
		{"Ольга", "+7 900 000-00-00", "1234", "Опишите, что случилось"},
		{"Ольга", "89001234567", "Что случилось", ""},
	} {
		err := CheckCall(c.name, c.phone, c.text)
		if c.want == "" {
			eq(t, c.name+c.text, err == nil, true)
			continue
		}
		eq(t, c.want, detailOf(t, err, "validation_failed"), c.want)
	}
}

func TestCheckReplyText(t *testing.T) {
	t.Parallel()
	_, err := CheckReplyText(" a ", false)
	eq(t, "reply", detailOf(t, err, "validation_failed"), "Напишите текст ответа")
	_, err = CheckReplyText("", true)
	eq(t, "note", detailOf(t, err, "validation_failed"), "Напишите текст заметки")
	got, err := CheckReplyText("  Приняли  ", false)
	eq(t, "trimmed", got, "Приняли")
	eq(t, "ok", err == nil, true)
}

func TestCheckOutcomeDependsOnTheAboutMark(t *testing.T) {
	t.Parallel()
	eq(t, "plain", CheckOutcome(false, "Устранено") == nil, true)
	eq(t, "about", CheckOutcome(true, "Подтвердилась") == nil, true)
	eq(t, "about with a plain outcome", detailOf(t, CheckOutcome(true, "Устранено"), "validation_failed"), "Выберите итог решения")
	eq(t, "empty", detailOf(t, CheckOutcome(false, ""), "validation_failed"), "Выберите итог решения")
}

func TestCheckTaskTitleConclusionAndPriority(t *testing.T) {
	t.Parallel()
	_, err := CheckTaskTitle("аб")
	eq(t, "task", detailOf(t, err, "validation_failed"), "Тема задачи — не короче 3 символов")
	got, err := CheckTaskTitle("  Замер  ")
	eq(t, "task ok", got+"|"+boolStr(err == nil), "Замер|true")
	_, err = CheckConclusion("мало")
	eq(t, "conclusion", detailOf(t, err, "validation_failed"), "Напишите вывод для сотрудника")
	eq(t, "priority", detailOf(t, CheckPriority("urgent"), "validation_failed"), "Неизвестный приоритет")
	eq(t, "priority ok", CheckPriority("high") == nil, true)
}

func boolStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

func TestCheckKey(t *testing.T) {
	t.Parallel()
	got, err := CheckKey("  мас ")
	eq(t, "cyrillic", got+"|"+boolStr(err == nil), "МАС|true")
	got, err = CheckKey("dev1")
	eq(t, "latin", got+"|"+boolStr(err == nil), "DEV1|true")
	for _, bad := range []string{"", "М", "1АБ", "ТООДЛИННЫЙ", "АБ-1"} {
		eq(t, bad, CheckKey2(bad), true)
	}
}

// CheckKey2 reports whether the key is refused.
func CheckKey2(k string) bool { _, err := CheckKey(k); return err != nil }

//nolint:revive // the field names of the generated type
func validBody() api.ServiceDirectionBody {
	first := int64(120)
	return api.ServiceDirectionBody{Name: "Массаж", Color: "#7B3F6E",
		Calendar: api.ServiceWorkCalendar{Days: []int64{1, 2, 3, 4, 5}, From: "09:00", To: "19:00", TimeZone: "Europe/Moscow"},
		Types: []struct {
			FirstMinutes   *int64                                `json:"firstMinutes,omitempty"`
			Id             string                                `json:"id"`
			Kind           api.ServiceDirectionBodyTypesKind     `json:"kind"`
			LegalDays      *int64                                `json:"legalDays,omitempty"`
			Name           string                                `json:"name"`
			Priority       api.ServiceDirectionBodyTypesPriority `json:"priority"`
			ResolveMinutes *int64                                `json:"resolveMinutes,omitempty"`
		}{{Id: "complaint", Kind: "complaint", Name: "Жалоба", Priority: "high", FirstMinutes: &first}}}
}

func TestCheckBodyAcceptsAGoodDraftAndRefusesBadOnes(t *testing.T) {
	t.Parallel()
	eq(t, "good", CheckBody(validBody()) == nil, true)
	for name, mut := range map[string]func(*api.ServiceDirectionBody){
		"short name":    func(b *api.ServiceDirectionBody) { b.Name = "М" },
		"bad color":     func(b *api.ServiceDirectionBody) { b.Color = "red" },
		"no types":      func(b *api.ServiceDirectionBody) { b.Types = nil },
		"no days":       func(b *api.ServiceDirectionBody) { b.Calendar.Days = nil },
		"day 8":         func(b *api.ServiceDirectionBody) { b.Calendar.Days = []int64{8} },
		"reversed time": func(b *api.ServiceDirectionBody) { b.Calendar.From, b.Calendar.To = "19:00", "09:00" },
		"bad time":      func(b *api.ServiceDirectionBody) { b.Calendar.From = "9am" },
		"bad type id":   func(b *api.ServiceDirectionBody) { b.Types[0].Id = "Жалоба" },
		"bad kind":      func(b *api.ServiceDirectionBody) { b.Types[0].Kind = "rating" },
		"zero goal":     func(b *api.ServiceDirectionBody) { z := int64(0); b.Types[0].FirstMinutes = &z },
		"two same ids":  func(b *api.ServiceDirectionBody) { b.Types = append(b.Types, b.Types[0]) },
	} {
		b := validBody()
		mut(&b)
		eq(t, name, CheckBody(b) != nil, true)
	}
}
