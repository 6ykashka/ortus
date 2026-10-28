package service

import (
	"math"
	"slices"
	"time"
)

// Moscow is the zone of the directions by default (Q-W4.00-service-10): UTC+3 without DST.
var Moscow = time.FixedZone("MSK", 3*60*60)

// maxDays is the limit of the days a walk over a calendar takes: a calendar without work days does not hang.
const maxDays = 500

// Calendar is the working time of a direction (service.js 19.10 CAL, service.calendars of tenant 0062): the SLA goals
// are counted in its working minutes. Days are the days of the week, 0 is Monday; From and To are minutes from midnight
// of the zone; Holidays are dates «YYYY-MM-DD» of the zone that count as days off.
type Calendar struct {
	Days     []int
	From, To int
	Label    string
	Zone     *time.Location // nil: Moscow
	Holidays []string
}

// Keys of the calendars of the seed.
const (
	keySpa = "spa"
	keyRep = "rep"
	keyLog = "log"
)

// SeedCalendars are the calendars of the seed (CAL of service.js): the salon, the repairs and the logistics.
func SeedCalendars() map[string]Calendar {
	return map[string]Calendar{
		keySpa: {Days: []int{0, 1, 2, 3, 4, 5, 6}, From: 600, To: 1260, Label: "ежедневно 10:00–21:00"},
		keyRep: {Days: []int{0, 1, 2, 3, 4}, From: 540, To: 1140, Label: "пн–пт 9:00–19:00"},
		keyLog: {Days: []int{0, 1, 2, 3, 4, 5, 6}, From: 480, To: 1200, Label: "ежедневно 8:00–20:00"},
	}
}

// LoadZone returns the zone of a name of the IANA registry; an unknown or empty name is Moscow.
func LoadZone(name string) *time.Location {
	switch name {
	case "", "Europe/Moscow":
		return Moscow
	case "Europe/Samara":
		return time.FixedZone("SAMT", 4*60*60)
	}
	if loc, err := time.LoadLocation(name); err == nil {
		return loc
	}
	return Moscow
}

func (c Calendar) loc() *time.Location {
	if c.Zone != nil {
		return c.Zone
	}
	return Moscow
}

// weekday is the day of the week of t in the zone of the calendar: 0 is Monday.
func (c Calendar) weekday(t time.Time) int { return (int(t.In(c.loc()).Weekday()) + 6) % 7 }

// dayStart is the midnight of the day of t in the zone of the calendar.
func (c Calendar) dayStart(t time.Time) time.Time {
	y, m, d := t.In(c.loc()).Date()
	return time.Date(y, m, d, 0, 0, 0, 0, c.loc())
}

// isWorkDay reports whether the day of t is a work day: its weekday is in Days and its date is not a holiday.
func (c Calendar) isWorkDay(t time.Time) bool {
	return slices.Contains(c.Days, c.weekday(t)) && !slices.Contains(c.Holidays, t.In(c.loc()).Format(time.DateOnly))
}

// AddWorkMinutes is the end of a term: start plus mins working minutes of the calendar.
func (c Calendar) AddWorkMinutes(start time.Time, mins int) time.Time {
	t, left := start, time.Duration(mins)*time.Minute
	for range maxDays {
		d0 := c.dayStart(t)
		open, closing := d0.Add(time.Duration(c.From)*time.Minute), d0.Add(time.Duration(c.To)*time.Minute)
		if c.isWorkDay(d0) && t.Before(closing) {
			s := t
			if open.After(s) {
				s = open
			}
			avail := closing.Sub(s)
			if avail >= left {
				return s.Add(left)
			}
			left -= avail
		}
		t = d0.AddDate(0, 0, 1)
	}
	return t
}

// WorkBetween is the working minutes from a to b, rounded to a minute.
func (c Calendar) WorkBetween(a, b time.Time) int {
	if !b.After(a) {
		return 0
	}
	t, sum := a, time.Duration(0)
	for range maxDays {
		if !t.Before(b) {
			break
		}
		d0 := c.dayStart(t)
		if c.isWorkDay(d0) {
			s, e := t, b
			if open := d0.Add(time.Duration(c.From) * time.Minute); open.After(s) {
				s = open
			}
			if closing := d0.Add(time.Duration(c.To) * time.Minute); closing.Before(e) {
				e = closing
			}
			if e.After(s) {
				sum += e.Sub(s)
			}
		}
		t = d0.AddDate(0, 0, 1)
	}
	return int(math.Round(sum.Minutes()))
}
