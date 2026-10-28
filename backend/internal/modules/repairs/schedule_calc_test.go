package repairs

import (
	"testing"
	"time"
)

// The control numbers of the object «ЖК Речной · квартира 42» (docs/plan/v2/analysis/dor/repair.md §2.6, the library of
// W6.10: cpm.test.ts): D0 = 05.10.2026 (Monday), the holiday 04.11 (day 30), the due date by the contract 27.11 (day 53),
// by the plan 01.12 (day 57), +2 working days.
var (
	d0       = dayOf(time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC))
	calObj42 = newWorkCal([]int16{1, 2, 3, 4, 5}, []time.Time{time.Date(2026, 11, 4, 0, 0, 0, 0, time.UTC)})
)

// obj42 is the model of the prototype: s1 is done, s2 has begun on day 7; s2 lasts s2dur days.
func obj42(s2dur int) ([]calcStage, []calcLink) {
	stages := []calcStage{
		{id: "s1", dur: 5, actual: new(d0), done: true},
		{id: "s2", dur: s2dur, actual: new(d0 + 7)},
		{id: "s3", dur: 10}, {id: "s4", dur: 2}, {id: "s5", dur: 12}, {id: "s6", dur: 5}, {id: "s7", dur: 3}, {id: "s8", dur: 2},
		{id: "s9", dur: 1}, {id: "s10", dur: 1},
	}
	links := []calcLink{
		{"s1", "s2", 0}, {"s2", "s3", -3}, {"s3", "s4", 0}, {"s3", "s5", 5}, {"s4", "s6", 3}, {"s4", "s7", 10}, {"s5", "s7", 0},
		{"s5", "s8", 0}, {"s6", "s9", 0}, {"s7", "s9", 0}, {"s8", "s9", 0}, {"s9", "s10", 0},
	}
	return stages, links
}

func TestWorkCalendar(t *testing.T) {
	t.Parallel()
	c := calObj42
	cases := []struct {
		name      string
		got, want int
	}{
		{"D0 is a Monday", isoWeekday(d0), 1},
		{"a Saturday moves to Monday", c.fw(d0 + 5), d0 + 7},
		{"a holiday moves to the next working day", c.fw(d0 + 30), d0 + 31},
		{"back from a Sunday to Friday", c.pw(d0 + 6), d0 + 4},
		{"five days from Monday end on Friday", c.addW(d0, 5), d0 + 4},
		{"a stage of one day ends where it starts", c.addW(d0+3, 1), d0 + 3},
		{"six days run into the next week", c.addW(d0, 6), d0 + 7},
		{"the first day of a stage of three ending on Monday", c.subW(d0+7, 3), d0 + 3},
		{"two working days after Friday", c.shW(d0+4, 2), d0 + 8},
		{"working days of a week", c.wdIn(d0-1, d0+6), 5},
		{"the holiday is not counted", c.wdIn(d0+28, d0+32), 3},
	}
	for _, tc := range cases {
		if tc.got != tc.want {
			t.Errorf("%s: %d, want %d", tc.name, tc.got, tc.want)
		}
	}
}

func TestWorkCalendarWithoutWeekdays(t *testing.T) {
	t.Parallel()
	c := newWorkCal(nil, nil)
	if !c.isW(d0) || c.isW(d0+5) {
		t.Fatal("an empty calendar must fall back to Monday–Friday")
	}
}

func TestScheduleControlNumbers(t *testing.T) { //nolint:gocyclo // one scenario: the control numbers of the prototype in a row
	t.Parallel()
	stages, links := obj42(8)
	base, baseFin, ok, err := calObj42.schedule(d0, stages, links)
	if err != nil || !ok {
		t.Fatalf("base: %v %v", ok, err)
	}
	if baseFin-d0 != 53 || base["s10"].end-d0 != 53 {
		t.Errorf("due by the contract: day %d, want 53 (27.11)", baseFin-d0)
	}
	stages, links = obj42(10)
	cur, fin, _, err := calObj42.schedule(d0, stages, links)
	if err != nil {
		t.Fatal(err)
	}
	if fin-d0 != 57 {
		t.Errorf("forecast: day %d, want 57 (01.12)", fin-d0)
	}
	if got := calObj42.wdIn(baseFin, fin); got != 2 {
		t.Errorf("delay %d working days, want 2", got)
	}
	if cur["s2"].start != d0+7 {
		t.Errorf("a stage that has begun keeps its start: day %d, want 7", cur["s2"].start-d0)
	}
	var crit []string
	for _, s := range stages {
		if !s.done && cur[s.id].slack == 0 {
			crit = append(crit, s.id)
		}
	}
	if want := []string{"s2", "s3", "s5", "s7", "s9", "s10"}; !equal(crit, want) {
		t.Errorf("critical path %v, want %v", crit, want)
	}
	for id, want := range map[string]int{"s8": 1, "s4": 5, "s6": 9} {
		if cur[id].slack != want {
			t.Errorf("slack of %s: %d, want %d", id, cur[id].slack, want)
		}
	}
	if cur["s7"].bind != "s5" || cur["s3"].bind != "s2" {
		t.Errorf("binding predecessors: s7 %q, s3 %q", cur["s7"].bind, cur["s3"].bind)
	}
}

// A longer plastering (s3: 10 → 12 days) moves the hand over to 04.12 (day 60 of the library: the pauses in calendar days
// run over a weekend), five working days after the contract.
func TestScheduleMoveControl(t *testing.T) {
	t.Parallel()
	stages, links := obj42(10)
	stages[2].dur = 12
	_, fin, _, err := calObj42.schedule(d0, stages, links)
	if err != nil {
		t.Fatal(err)
	}
	if fin-d0 != 60 || calObj42.wdIn(d0+53, fin) != 5 {
		t.Errorf("forecast day %d, delay %d; want 60 and 5", fin-d0, calObj42.wdIn(d0+53, fin))
	}
}

func TestDurationOfAndPlural(t *testing.T) {
	t.Parallel()
	rate := func(v float64) *float64 { return &v }
	for _, tc := range []struct {
		volume float64
		rate   *float64
		want   int
	}{{46.8, rate(12), 4}, {114.6, rate(10), 12}, {120, rate(12), 10}, {0, rate(10), 1}, {50, nil, 1}, {1000, rate(1), 30}, {0.5, rate(10), 1}} {
		if got := durationOf(tc.volume, tc.rate); got != tc.want {
			t.Errorf("durationOf(%v, rate): %d, want %d", tc.volume, got, tc.want)
		}
	}
	for n, want := range map[int]string{1: "1 раб. день", 2: "2 раб. дня", 5: "5 раб. дней", 11: "11 раб. дней", 21: "21 раб. день", 22: "22 раб. дня", 112: "112 раб. дней"} {
		if got := wdn(n); got != want {
			t.Errorf("wdn(%d) = %q, want %q", n, got, want)
		}
	}
}
func TestScheduleOffsetAndLag(t *testing.T) {
	t.Parallel()
	stages := []calcStage{{id: "a", dur: 2}, {id: "b", dur: 2, off: 2}}
	links := []calcLink{{"a", "b", 0}}
	got, fin, _, err := calObj42.schedule(d0, stages, links)
	if err != nil {
		t.Fatal(err)
	}
	// a: Mon–Tue; b starts on Wednesday and waits two working days: Friday–Monday.
	if got["b"].start != d0+4 || fin != d0+7 {
		t.Errorf("offset: b starts on day %d, ends on %d; want 4 and 7", got["b"].start-d0, fin-d0)
	}
	links[0].lag = 3 // a pause of three calendar days after Tuesday: Saturday → Monday
	got, _, _, _ = calObj42.schedule(d0, stages, links)
	if got["b"].es != d0+7 {
		t.Errorf("pause: early start day %d, want 7", got["b"].es-d0)
	}
}

func TestScheduleEdges(t *testing.T) {
	t.Parallel()
	if _, _, ok, err := calObj42.schedule(d0, nil, nil); ok || err != nil {
		t.Errorf("no stages: %v %v, want no forecast and no error", ok, err)
	}
	cyc := []calcStage{{id: "a", dur: 1}, {id: "b", dur: 1}}
	if _, _, _, err := calObj42.schedule(d0, cyc, []calcLink{{"a", "b", 0}, {"b", "a", 0}}); err == nil {
		t.Error("a cycle of links must be an error")
	}
	if _, _, _, err := calObj42.schedule(d0, cyc, []calcLink{{"a", "zz", 0}}); err == nil {
		t.Error("a link to an unknown stage must be an error")
	}
	// the order of the input is kept when it is valid; a follower given first is put after its predecessor
	rev := []calcStage{{id: "b", dur: 1}, {id: "a", dur: 1}}
	got, _, _, err := calObj42.schedule(d0, rev, []calcLink{{"a", "b", 0}})
	if err != nil || got["b"].start <= got["a"].start {
		t.Errorf("a follower given first: %v, b %v a %v", err, got["b"], got["a"])
	}
}

func TestDefaultHolidays(t *testing.T) {
	t.Parallel()
	c := newWorkCal([]int16{1, 2, 3, 4, 5}, defaultHolidays(time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)))
	if c.isW(d0 + 30) {
		t.Error("04.11 must be a holiday")
	}
	if !c.isW(d0 + 31) {
		t.Error("05.11 is a working day")
	}
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
