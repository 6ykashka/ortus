package service

import "testing"

func TestHmAndDayLabel(t *testing.T) {
	t.Parallel()
	for _, c := range []struct{ got, want string }{
		{Hm(at(1, 10, 16, 24)), "16:24"}, {Hm(at(1, 10, 9, 5)), "9:05"}, {Hm(at(1, 10, 0, 0)), "0:00"},
		{DayLabel(at(1, 10, 12, 0)), "1 октября"}, {DayLabel(at(30, 9, 12, 0)), "30 сентября"}, {DayLabel(at(31, 12, 12, 0)), "31 декабря"},
	} {
		if c.got != c.want {
			t.Errorf("got %q, want %q", c.got, c.want)
		}
	}
}

func TestWhen(t *testing.T) {
	t.Parallel()
	now := at(1, 10, 16, 24)
	for _, c := range []struct {
		at   string
		got  string
		want string
	}{
		{"today", When(at(1, 10, 9, 5), now), "сегодня, 9:05"},
		{"yesterday", When(at(30, 9, 15, 40), now), "вчера, 15:40"},
		{"earlier", When(at(26, 9, 14, 20), now), "26 сентября, 14:20"},
		{"later", When(at(2, 10, 8, 0), now), "2 октября, 8:00"},
		{"the day border is Moscow's", When(at(1, 10, 0, 10), at(1, 10, 1, 0)), "сегодня, 0:10"},
		{"the day before", When(at(30, 9, 23, 50), at(1, 10, 0, 5)), "вчера, 23:50"},
	} {
		if c.got != c.want {
			t.Errorf("%s: %q, want %q", c.at, c.got, c.want)
		}
	}
}

func TestDueText(t *testing.T) {
	t.Parallel()
	now := at(1, 10, 16, 24)
	for _, c := range []struct{ got, want string }{
		{DueText(at(1, 10, 18, 24), now), "18:24"},
		{DueText(at(2, 10, 10, 30), now), "2 октября, 10:30"},
		{DueText(at(10, 10, 10, 30), now), "10 октября"},
		{DueText(at(30, 9, 10, 0), now), "30 сентября, 10:00"},
	} {
		if c.got != c.want {
			t.Errorf("got %q, want %q", c.got, c.want)
		}
	}
}

func TestDur(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		mins float64
		cal  *Calendar
		want string
	}{
		{0, nil, "0 мин"}, {48, nil, "48 мин"}, {60, &calSpa, "1 ч"}, {220, &calSpa, "3 ч 40 мин"}, {659, &calSpa, "10 ч 59 мин"},
		{660, &calSpa, "1 день"}, {1320, &calSpa, "2 дня"}, {5 * 660, &calSpa, "5 дней"}, {6000, &calRep, "10 раб. дней"},
		{600, &calRep, "1 раб. день"}, {1440, nil, "1 день"}, {-5, &calRep, "0 мин"}, {47.6, &calRep, "48 мин"},
		{11 * 660, &calSpa, "11 дней"}, {21 * 660, &calSpa, "21 день"},
	} {
		if got := Dur(c.mins, c.cal); got != c.want {
			t.Errorf("Dur(%v) = %q, want %q", c.mins, got, c.want)
		}
	}
}

func TestSpan(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		mins float64
		want string
	}{{5, "5 мин"}, {125, "2 ч 5 мин"}, {120, "2 ч"}, {1440, "1 день"}, {3000, "2 дня"}, {7300, "5 дней"}} {
		if got := Span(c.mins); got != c.want {
			t.Errorf("Span(%v) = %q, want %q", c.mins, got, c.want)
		}
	}
}

func TestFillTemplate(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name, text string
		v          TemplateVars
		want       string
	}{
		{"all three", "{имя}, приняли ваше обращение {номер}. Ответим {срок}.", TemplateVars{Name: "Наталья Гусева", Key: "ГРЗ-57", Until: "до 11:00"},
			"Наталья, приняли ваше обращение ГРЗ-57. Ответим до 11:00."},
		{"was until", "Ответим {срок}", TemplateVars{Name: "А Б", Key: "К-1", Until: "был до 10:00"}, "Ответим до 10:00"},
		{"no term", "Ответим {срок}", TemplateVars{Name: "А Б", Key: "К-1"}, "Ответим в течение рабочего дня"},
		{"only the first occurrence", "{имя} {имя}", TemplateVars{Name: "Олег", Key: "К"}, "Олег {имя}"},
		{"no name", "{имя}!", TemplateVars{Key: "К"}, "!"},
	} {
		if got := FillTemplate(c.text, c.v); got != c.want {
			t.Errorf("%s: %q, want %q", c.name, got, c.want)
		}
	}
}

func TestMaskPhone(t *testing.T) {
	t.Parallel()
	for _, c := range []struct{ in, want string }{
		{"+79161234567", "+7 ••• •••-••-67"}, {"+7 916 204-44-12", "+7 ••• •••-••-12"}, {"12", "•••"}, {"", "•••"},
	} {
		if got := MaskPhone(c.in); got != c.want {
			t.Errorf("MaskPhone(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestPlural(t *testing.T) {
	t.Parallel()
	for n, want := range map[int]string{1: "день", 2: "дня", 5: "дней", 11: "дней", 12: "дней", 21: "день", 22: "дня", 100: "дней", 0: "дней"} {
		if got := Plural(n, "день", "дня", "дней"); got != want {
			t.Errorf("Plural(%d) = %q, want %q", n, got, want)
		}
	}
}
