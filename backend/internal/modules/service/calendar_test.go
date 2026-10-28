package service

import (
	"testing"
	"time"
)

// msk is the clock of the prototype, Europe/Moscow without DST.
var msk = time.FixedZone("MSK", 3*60*60)

// at is a Moscow moment of 2026: at(day, month, hour, minute).
func at(d, mo, h, mi int) time.Time { return time.Date(2026, time.Month(mo), d, h, mi, 0, 0, msk) }

var (
	calSpa = Calendar{Days: []int{0, 1, 2, 3, 4, 5, 6}, From: 600, To: 1260, Label: "ежедневно 10:00–21:00"}
	calRep = Calendar{Days: []int{0, 1, 2, 3, 4}, From: 540, To: 1140, Label: "пн–пт 9:00–19:00"}
	calLog = Calendar{Days: []int{0, 1, 2, 3, 4, 5, 6}, From: 480, To: 1200, Label: "ежедневно 8:00–20:00"}
)

func TestSeedCalendarsAreTheCALOfThePrototype(t *testing.T) {
	t.Parallel()
	if len(SeedCalendars()) != 3 {
		t.Fatal("want three calendars of the seed")
	}
	for name, want := range map[string]Calendar{"spa": calSpa, "rep": calRep, "log": calLog} {
		got := SeedCalendars()[name]
		if got.From != want.From || got.To != want.To || got.Label != want.Label || len(got.Days) != len(want.Days) {
			t.Errorf("%s: %+v, want %+v", name, got, want)
		}
	}
}

func TestWeekdayAndDayStartFollowTheZoneOfTheCalendar(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		at   time.Time
		want int
	}{{at(1, 10, 12, 0), 3}, {at(4, 10, 12, 0), 6}, {at(5, 10, 0, 0), 0}} {
		if got := calSpa.weekday(c.at); got != c.want {
			t.Errorf("weekday(%v) = %d, want %d", c.at, got, c.want)
		}
	}
	for _, c := range []struct{ at, want time.Time }{
		{at(1, 10, 16, 24), at(1, 10, 0, 0)}, {at(2, 10, 0, 30), at(2, 10, 0, 0)}, {at(1, 10, 23, 59), at(1, 10, 0, 0)},
	} {
		if got := calSpa.dayStart(c.at); !got.Equal(c.want) {
			t.Errorf("dayStart(%v) = %v, want %v", c.at, got, c.want)
		}
	}
}

func TestIsWorkDayCountsDaysAndHolidays(t *testing.T) {
	t.Parallel()
	hol := calRep
	hol.Holidays = []string{"2026-10-05"}
	for _, c := range []struct {
		cal  Calendar
		at   time.Time
		want bool
	}{
		{calRep, at(3, 10, 12, 0), false}, {calRep, at(5, 10, 12, 0), true}, {hol, at(5, 10, 12, 0), false}, {hol, at(6, 10, 12, 0), true},
	} {
		if got := c.cal.isWorkDay(c.at); got != c.want {
			t.Errorf("isWorkDay(%v) = %v, want %v", c.at, got, c.want)
		}
	}
}

func TestAddWorkMinutes(t *testing.T) {
	t.Parallel()
	hol := calRep
	hol.Holidays = []string{"2026-10-05"}
	samara := calSpa
	samara.Zone = time.FixedZone("SAMT", 4*60*60)
	for _, c := range []struct {
		name  string
		start time.Time
		mins  int
		cal   Calendar
		want  time.Time
	}{
		{"inside a day", at(1, 10, 16, 24), 120, calSpa, at(1, 10, 18, 24)},
		{"carried to the next morning", at(1, 10, 20, 0), 120, calSpa, at(2, 10, 11, 0)},
		{"before the opening", at(1, 10, 7, 0), 30, calRep, at(1, 10, 9, 30)},
		{"after the closing", at(1, 10, 19, 30), 30, calRep, at(2, 10, 9, 30)},
		{"friday to monday", at(2, 10, 18, 0), 120, calRep, at(5, 10, 10, 0)},
		{"saturday start", at(3, 10, 12, 0), 30, calRep, at(5, 10, 9, 30)},
		{"exactly to the closing", at(1, 10, 18, 0), 60, calRep, at(1, 10, 19, 0)},
		{"zero minutes", at(1, 10, 12, 0), 0, calRep, at(1, 10, 12, 0)},
		{"several days", at(1, 10, 16, 24), 1320, calSpa, at(3, 10, 16, 24)},
		{"holiday is skipped", at(2, 10, 18, 0), 120, hol, at(6, 10, 10, 0)},
		{"another zone: 10:00 Samara", time.Date(2026, 10, 1, 6, 0, 0, 0, time.UTC), 60, samara, time.Date(2026, 10, 1, 7, 0, 0, 0, time.UTC)},
		{"another zone: next day", time.Date(2026, 10, 1, 16, 30, 0, 0, time.UTC), 60, samara, time.Date(2026, 10, 2, 6, 30, 0, 0, time.UTC)},
	} {
		if got := c.cal.AddWorkMinutes(c.start, c.mins); !got.Equal(c.want) {
			t.Errorf("%s: %v, want %v", c.name, got, c.want)
		}
	}
}

func TestAddWorkMinutesOfACalendarWithoutWorkDaysEndsAfter500Days(t *testing.T) {
	t.Parallel()
	none := Calendar{From: 600, To: 1260}
	start := at(1, 10, 12, 0)
	got := none.AddWorkMinutes(start, 30)
	if want := none.dayStart(start).AddDate(0, 0, 500); !got.Equal(want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestWorkBetween(t *testing.T) {
	t.Parallel()
	hol := calRep
	hol.Holidays = []string{"2026-10-05"}
	for _, c := range []struct {
		name string
		a, b time.Time
		cal  Calendar
		want int
	}{
		{"inside a day", at(1, 10, 16, 24), at(1, 10, 18, 24), calSpa, 120},
		{"over the night", at(1, 10, 20, 0), at(2, 10, 11, 0), calSpa, 120},
		{"friday to monday", at(2, 10, 18, 0), at(5, 10, 10, 0), calRep, 120},
		{"b before a", at(2, 10, 12, 0), at(1, 10, 12, 0), calRep, 0},
		{"equal", at(1, 10, 12, 0), at(1, 10, 12, 0), calRep, 0},
		{"weekend only", at(3, 10, 8, 0), at(4, 10, 20, 0), calRep, 0},
		{"a whole day", at(1, 10, 0, 0), at(2, 10, 0, 0), calRep, 600},
		{"holiday is not counted", at(2, 10, 18, 0), at(6, 10, 10, 0), hol, 120},
		{"holiday before monday", at(2, 10, 18, 0), at(5, 10, 10, 0), hol, 60},
		{"rounds to the minute", at(1, 10, 12, 0), at(1, 10, 12, 0).Add(90 * time.Second), calRep, 2},
	} {
		if got := c.cal.WorkBetween(c.a, c.b); got != c.want {
			t.Errorf("%s: %d, want %d", c.name, got, c.want)
		}
	}
}

func TestWorkBetweenAgreesWithAddWorkMinutes(t *testing.T) {
	t.Parallel()
	a := at(1, 10, 16, 24)
	for _, cal := range []Calendar{calSpa, calRep, calLog} {
		for _, n := range []int{1, 59, 120, 660, 1320, 6000} {
			if got := cal.WorkBetween(a, cal.AddWorkMinutes(a, n)); got != n {
				t.Errorf("%s: WorkBetween(a, add(a, %d)) = %d", cal.Label, n, got)
			}
		}
	}
}
