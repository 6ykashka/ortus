package service

import (
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	api "github.com/ortus/ortus-crm/backend/internal/api/service"
)

var (
	keyRE   = regexp.MustCompile(`^[A-ZА-ЯЁ][A-ZА-ЯЁ0-9]{1,5}$`)
	typeRE  = regexp.MustCompile(`^[a-z][a-z0-9_-]{1,49}$`)
	colorRE = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
	timeRE  = regexp.MustCompile(`^([01][0-9]|2[0-3]):[0-5][0-9]$`)
)

// TitleOf is the title of a request: the first sentence of the text, up to 80 characters (titleOf of the prototype).
func TitleOf(text string) string {
	s := strings.TrimSpace(text)
	if i := strings.IndexAny(s, ".!?\n"); i >= 0 {
		s = s[:i]
	}
	s = strings.TrimSpace(s)
	if r := []rune(s); len(r) > 80 {
		return string(r[:77]) + "…"
	}
	return s
}

// CheckCall checks the body of a request by a call in the order of the prototype: the name, the phone, the text.
func CheckCall(name, phone, text string) error {
	switch {
	case utf8.RuneCountInString(strings.TrimSpace(name)) < 2:
		return invalid("Укажите имя клиента")
	case len(digitsOf(phone)) < 10:
		return invalid("Телефон — не меньше 10 цифр")
	case utf8.RuneCountInString(strings.TrimSpace(text)) < 5:
		return invalid("Опишите, что случилось")
	}
	return nil
}

// CheckReplyText returns the trimmed text of a reply or a note (two characters at least).
func CheckReplyText(text string, note bool) (string, error) {
	t := strings.TrimSpace(text)
	if utf8.RuneCountInString(t) >= 2 {
		return t, nil
	}
	if note {
		return "", invalid("Напишите текст заметки")
	}
	return "", invalid("Напишите текст ответа")
}

// CheckOutcome checks the outcome of a resolution: a complaint about an employee has two outcomes of its own.
func CheckOutcome(about bool, outcome string) error {
	if !slices.Contains(Outcomes(about), outcome) {
		return invalid("Выберите итог решения")
	}
	return nil
}

// CheckTaskTitle returns the trimmed topic of a task (three characters at least).
func CheckTaskTitle(title string) (string, error) {
	t := strings.TrimSpace(title)
	if utf8.RuneCountInString(t) < 3 {
		return "", invalid("Тема задачи — не короче 3 символов")
	}
	return t, nil
}

// CheckConclusion returns the trimmed conclusion for an employee (five characters at least).
func CheckConclusion(text string) (string, error) {
	t := strings.TrimSpace(text)
	if utf8.RuneCountInString(t) < 5 {
		return "", invalid("Напишите вывод для сотрудника")
	}
	return t, nil
}

// CheckPriority checks a priority.
func CheckPriority(p string) error {
	if PriorityLabel(p) == "" {
		return invalid("Неизвестный приоритет")
	}
	return nil
}

// CheckKey returns the key of a direction in capitals: 2–6 letters or digits, the first a letter (as the key of a
// project of «Задачи»).
func CheckKey(raw string) (string, error) {
	k := strings.ToUpper(strings.TrimSpace(raw))
	if !keyRE.MatchString(k) {
		return "", invalid("Ключ — от 2 до 6 заглавных букв или цифр, первая — буква")
	}
	return k, nil
}

func runes(s string) int { return utf8.RuneCountInString(strings.TrimSpace(s)) }

// badLen reports whether the trimmed s is shorter than lo or longer than hi characters.
func badLen(s string, lo, hi int) bool { n := runes(s); return n < lo || n > hi }

// minutesOf is «HH:MM» in minutes from midnight.
func minutesOf(s string) (int, bool) {
	if !timeRE.MatchString(s) {
		return 0, false
	}
	h, _ := strconv.Atoi(s[:2])
	m, _ := strconv.Atoi(s[3:])
	return h*60 + m, true
}

// CalendarOf checks the working time of a body and returns the calendar.
func CalendarOf(c api.ServiceWorkCalendar) (Calendar, error) {
	days := make([]int, 0, len(c.Days))
	for _, d := range c.Days {
		if d < 1 || d > 7 || slices.Contains(days, int(d)-1) {
			return Calendar{}, invalid("Рабочие дни — числа от 1 до 7 без повторов")
		}
		days = append(days, int(d)-1)
	}
	from, ok1 := minutesOf(c.From)
	to, ok2 := minutesOf(c.To)
	switch {
	case len(days) == 0:
		return Calendar{}, invalid("Укажите рабочие дни")
	case !ok1 || !ok2 || from >= to:
		return Calendar{}, invalid("Рабочее время — «ЧЧ:ММ», начало раньше конца")
	}
	zone := c.TimeZone
	if zone == "" {
		zone = "Europe/Moscow"
	}
	if _, err := time.LoadLocation(zone); err != nil {
		return Calendar{}, invalid("Неизвестный часовой пояс")
	}
	slices.Sort(days)
	cal := Calendar{Days: days, From: from, To: to, Zone: LoadZone(zone)}
	if c.Label != nil {
		cal.Label = *c.Label
	}
	return cal, nil
}

// CheckBody checks the body of a draft of a direction (1d, 2c).
func CheckBody(b api.ServiceDirectionBody) error {
	switch {
	case badLen(b.Name, 2, 80):
		return invalid("Название — от 2 до 80 символов")
	case !colorRE.MatchString(b.Color):
		return invalid("Цвет — «#RRGGBB»")
	case len(b.Types) == 0 || len(b.Types) > 60:
		return invalid("Нужен хотя бы один тип обращения (не больше 60)")
	}
	if _, err := CalendarOf(b.Calendar); err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, t := range b.Types {
		if err := checkType(t.Id, string(t.Kind), t.Name, string(t.Priority), t.FirstMinutes, t.ResolveMinutes, t.LegalDays); err != nil {
			return err
		}
		if seen[t.Id] {
			return invalid("Тип «" + t.Id + "» указан дважды")
		}
		seen[t.Id] = true
	}
	return checkTemplates(b)
}

func checkType(id, kind, name, priority string, first, resolve, legal *int64) error {
	switch {
	case !typeRE.MatchString(id):
		return invalid("Код типа — латиница, цифры, «-» и «_», от 2 до 50 знаков")
	case !slices.Contains(Kinds(), kind):
		return invalid("Неизвестный вид обращения")
	case badLen(name, 2, 80):
		return invalid("Название типа — от 2 до 80 символов")
	case PriorityLabel(priority) == "":
		return invalid("Неизвестный приоритет")
	}
	for _, g := range []*int64{first, resolve, legal} {
		if g != nil && *g < 1 {
			return invalid("Срок — не меньше 1")
		}
	}
	return nil
}

func checkTemplates(b api.ServiceDirectionBody) error {
	if b.Templates == nil {
		return nil
	}
	if len(*b.Templates) > 20 {
		return invalid("Шаблонов ответа — не больше 20")
	}
	for _, t := range *b.Templates {
		if n := runes(t.Name); n < 1 || n > 80 {
			return invalid("Название шаблона — от 1 до 80 символов")
		}
		if n := runes(t.Text); n < 1 || n > 2000 {
			return invalid("Текст шаблона — от 1 до 2000 символов")
		}
	}
	return nil
}
