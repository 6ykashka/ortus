package service

import (
	"math"
	"strconv"
	"strings"
	"time"
)

var months = [...]string{"января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"}

// Plural is the form of a word for n: one (1, 21), few (2–4, 22–24) or many.
func Plural(n int, one, few, many string) string {
	m, h := n%10, n%100
	switch {
	case m == 1 && h != 11:
		return one
	case m >= 2 && m <= 4 && (h < 10 || h >= 20):
		return few
	}
	return many
}

// Hm is «16:24», «9:05»: the hour without a leading zero, in Moscow.
func Hm(t time.Time) string { return HmIn(t, Moscow) }

// HmIn is Hm in the zone loc.
func HmIn(t time.Time, loc *time.Location) string {
	t = t.In(loc)
	return strconv.Itoa(t.Hour()) + ":" + pad2(t.Minute())
}

func pad2(n int) string {
	if n < 10 {
		return "0" + strconv.Itoa(n)
	}
	return strconv.Itoa(n)
}

// DayLabel is «1 октября», in Moscow.
func DayLabel(t time.Time) string { return DayLabelIn(t, Moscow) }

// DayLabelIn is DayLabel in the zone loc.
func DayLabelIn(t time.Time, loc *time.Location) string {
	t = t.In(loc)
	return strconv.Itoa(t.Day()) + " " + months[t.Month()-1]
}

func sameDay(a, b time.Time, loc *time.Location) bool {
	ay, am, ad := a.In(loc).Date()
	by, bm, bd := b.In(loc).Date()
	return ay == by && am == bm && ad == bd
}

// When is «сегодня, 9:05», «вчера, 15:40», «26 сентября, 14:20», in Moscow.
func When(t, now time.Time) string { return WhenIn(t, now, Moscow) }

// WhenIn is When in the zone loc.
func WhenIn(t, now time.Time, loc *time.Location) string {
	switch {
	case sameDay(t, now, loc):
		return "сегодня, " + HmIn(t, loc)
	case sameDay(t.AddDate(0, 0, 1), now, loc):
		return "вчера, " + HmIn(t, loc)
	}
	return DayLabelIn(t, loc) + ", " + HmIn(t, loc)
}

// DueText is a term: today — the time; nearer than three days — the day and the time; later — the day; in Moscow.
func DueText(t, now time.Time) string { return DueTextIn(t, now, Moscow) }

// DueTextIn is DueText in the zone loc.
func DueTextIn(t, now time.Time, loc *time.Location) string {
	if sameDay(t, now, loc) {
		return HmIn(t, loc)
	}
	out := DayLabelIn(t, loc)
	if t.Sub(now) < 3*24*time.Hour {
		out += ", " + HmIn(t, loc)
	}
	return out
}

func days(d int) string { return strconv.Itoa(d) + " " + Plural(d, "день", "дня", "дней") }

// Dur is a duration in the working time: «48 мин», «3 ч 40 мин», «9 раб. дней». A calendar without all seven days
// gives «раб.»; nil counts a day as 24 hours.
func Dur(mins float64, cal *Calendar) string {
	m := int(math.Max(0, math.Round(mins)))
	perDay := 1440
	if cal != nil {
		perDay = cal.To - cal.From
	}
	switch {
	case m < 60:
		return strconv.Itoa(m) + " мин"
	case m < perDay:
		return hoursMins(m)
	}
	d := m / perDay
	prefix := ""
	if cal != nil && len(cal.Days) < 7 {
		prefix = "раб. "
	}
	return strconv.Itoa(d) + " " + prefix + Plural(d, "день", "дня", "дней")
}

func hoursMins(m int) string {
	out := strconv.Itoa(m/60) + " ч"
	if mm := m % 60; mm != 0 {
		out += " " + strconv.Itoa(mm) + " мин"
	}
	return out
}

// Span is a calendar duration (an overdue term): «5 мин», «2 ч 5 мин», «2 дня».
func Span(mins float64) string {
	m := int(math.Round(mins))
	switch {
	case m < 60:
		return strconv.Itoa(m) + " мин"
	case m < 1440:
		return hoursMins(m)
	}
	return days(m / 1440)
}

// TemplateVars are the substitutions of a reply template.
type TemplateVars struct {
	Name  string // the first word is used
	Key   string
	Until string // the term of the head (SlaHead.Until), e.g. «до 11:00» or «был до 10:00»
}

// FillTemplate puts {имя}, {номер} and {срок} into a template: the first occurrence of each, as String.replace of the
// prototype.
func FillTemplate(text string, v TemplateVars) string {
	first, _, _ := strings.Cut(v.Name, " ")
	until := "в течение рабочего дня"
	if v.Until != "" {
		until = strings.TrimPrefix(v.Until, "был ")
	}
	text = strings.Replace(text, "{имя}", first, 1)
	text = strings.Replace(text, "{номер}", v.Key, 1)
	return strings.Replace(text, "{срок}", until, 1)
}

// MaskPhone is the phone of a client as every answer shows it (FB-05): the last two digits.
func MaskPhone(p string) string {
	var digits []rune
	for _, r := range p {
		if r >= '0' && r <= '9' {
			digits = append(digits, r)
		}
	}
	if len(digits) < 4 {
		return "•••"
	}
	return "+7 ••• •••-••-" + string(digits[len(digits)-2:])
}
