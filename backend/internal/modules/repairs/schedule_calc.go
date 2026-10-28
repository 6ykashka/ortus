package repairs

import (
	"errors"
	"slices"
	"time"
)

// The calculation of the schedule of an object (W6.14): the forward and the backward pass over the stages and the links
// «end → start» on the work calendar, the slack and the critical path. It is the port of the library of W6.10/W6.17
// (frontend/packages/domain/src/lib/schedule/{calendar,cpm}.ts, design/Ремонт и стройка.dc.html:936–997): the server
// computes the forecast, the client only shows it. A day is an integer — the days since 1970-01-01 (UTC), so a date and
// a day convert both ways without a zone.

const secondsPerDay = 86_400

// dayOf is the day number of a date (the time of day and the zone are dropped).
func dayOf(t time.Time) int {
	y, m, d := t.Date()
	return int(time.Date(y, m, d, 0, 0, 0, 0, time.UTC).Unix() / secondsPerDay)
}

// dateOf is the date (UTC midnight) of a day number.
func dateOf(day int) time.Time { return time.Unix(int64(day)*secondsPerDay, 0).UTC() }

// workCal is the work calendar: the working days of the week (ISO 1 = Monday … 7 = Sunday) and the holidays.
type workCal struct {
	week     [8]bool
	holidays map[int]bool
}

// newWorkCal builds the calendar; without any working weekday it falls back to Monday–Friday (a calendar with no
// working day would make every search for one endless).
func newWorkCal(workdays []int16, holidays []time.Time) *workCal {
	c := &workCal{holidays: map[int]bool{}}
	for _, d := range workdays {
		if d >= 1 && d <= 7 {
			c.week[d] = true
		}
	}
	if !slices.Contains(c.week[:], true) {
		for d := 1; d <= 5; d++ {
			c.week[d] = true
		}
	}
	for _, h := range holidays {
		c.holidays[dayOf(h)] = true
	}
	return c
}

// isoWeekday is the ISO weekday of a day: 1 = Monday … 7 = Sunday (1970-01-01 was a Thursday).
func isoWeekday(day int) int { return ((day+3)%7+7)%7 + 1 }

func (c *workCal) isW(day int) bool { return c.week[isoWeekday(day)] && !c.holidays[day] }

// fw is the nearest working day forward, d itself included; pw — backward.
func (c *workCal) fw(day int) int {
	for !c.isW(day) {
		day++
	}
	return day
}

func (c *workCal) pw(day int) int {
	for !c.isW(day) {
		day--
	}
	return day
}

// addW is the last day of a stage that starts at s and takes n working days.
func (c *workCal) addW(s, n int) int {
	for d, k := s, 1; ; {
		if k >= n {
			return d
		}
		d++
		if c.isW(d) {
			k++
		}
	}
}

// subW is the first day of a stage that ends at e and takes n working days.
func (c *workCal) subW(e, n int) int {
	for d, k := e, 1; ; {
		if k >= n {
			return d
		}
		d--
		if c.isW(d) {
			k++
		}
	}
}

// shW is the day n working days after d.
func (c *workCal) shW(d, n int) int {
	for ; n > 0; n-- {
		d++
		for !c.isW(d) {
			d++
		}
	}
	return d
}

// wdIn counts the working days after a up to b inclusive.
func (c *workCal) wdIn(a, b int) int {
	n := 0
	for d := a + 1; d <= b; d++ {
		if c.isW(d) {
			n++
		}
	}
	return n
}

// calcStage is a stage as the calculation sees it: the duration and the offset of the current plan, the actual start
// of a stage that has begun (it does not move) and whether it is done (it leaves the critical path).
type calcStage struct {
	id       string
	dur, off int
	actual   *int
	done     bool
}

// calcLink is the link «end of from → start of to» with a pause (lag > 0) or an advance (lag < 0) in calendar days.
type calcLink struct {
	from, to string
	lag      int
}

// timing is the calculated stage: es the early start, bind the predecessor that sets it, lf/ls the late finish and
// start, slack the working days between the end and the late finish (0 — the critical path).
type timing struct {
	es, start, end, lf, ls, slack int
	bind                          string
}

var errCycle = errors.New("repairs: the schedule has a cycle of links")

// order puts the predecessors before their followers keeping the order of the stages where it is valid. A link to an
// unknown stage or a cycle is an error (the links are written by the server, so it is a programming error).
func order(stages []calcStage, links []calcLink) ([]calcStage, error) {
	known := map[string]bool{}
	for _, s := range stages {
		known[s.id] = true
	}
	for _, l := range links {
		if !known[l.from] || !known[l.to] {
			return nil, errCycle
		}
	}
	placed := map[string]bool{}
	rest := slices.Clone(stages)
	out := make([]calcStage, 0, len(stages))
	for len(rest) > 0 {
		i := slices.IndexFunc(rest, func(s calcStage) bool {
			return !slices.ContainsFunc(links, func(l calcLink) bool { return l.to == s.id && !placed[l.from] })
		})
		if i < 0 {
			return nil, errCycle
		}
		placed[rest[i].id] = true
		out = append(out, rest[i])
		rest = slices.Delete(rest, i, i+1)
	}
	return out, nil
}

// schedule calculates all the stages from the first working day on or after start. fin is the end of the last stage
// (the forecast of the hand over); there is none without stages.
func (c *workCal) schedule(start int, stages []calcStage, links []calcLink) (map[string]*timing, int, bool, error) {
	ordered, err := order(stages, links)
	if err != nil {
		return nil, 0, false, err
	}
	res := c.forward(start, ordered, links)
	fin, has := 0, false
	for _, st := range ordered {
		if !slices.ContainsFunc(links, func(l calcLink) bool { return l.from == st.id }) {
			fin, has = max(fin, res[st.id].end), true
		}
	}
	c.backward(fin, ordered, links, res)
	return res, fin, has, nil
}

// forward is the forward pass: the early start after the predecessors, the start (fixed for a stage that has begun) and
// the end of every stage in the order of the passes.
func (c *workCal) forward(start int, ordered []calcStage, links []calcLink) map[string]*timing {
	res := make(map[string]*timing, len(ordered))
	for _, st := range ordered {
		es, bind := c.fw(start), ""
		for _, l := range links {
			if l.to != st.id {
				continue
			}
			if v := c.fw(res[l.from].end + 1 + l.lag); bind == "" || v > es {
				es, bind = v, l.from
			}
		}
		begin := c.shW(es, st.off)
		if st.actual != nil {
			begin = *st.actual
		}
		res[st.id] = &timing{es: es, bind: bind, start: begin, end: c.addW(begin, st.dur)}
	}
	return res
}

// backward is the backward pass: the late finish and start from the followers (fin for a stage without them) and the
// slack of every stage.
func (c *workCal) backward(fin int, ordered []calcStage, links []calcLink, res map[string]*timing) {
	for _, st := range slices.Backward(ordered) {
		r := res[st.id]
		r.lf = fin
		hasNext := false
		for _, l := range links {
			if l.from != st.id {
				continue
			}
			if v := c.pw(res[l.to].ls - 1 - l.lag); !hasNext || v < r.lf {
				r.lf, hasNext = v, true
			}
		}
		r.ls = c.subW(r.lf, st.dur)
		r.slack = c.wdIn(r.end, r.lf)
	}
}

// holidaysRU are the fixed-date public holidays of Russia the calendar falls back to when the tenant has no calendar of
// its region (the transfers of days off are not known to the code; the tenant fixes them in repairs.work_calendars).
var holidaysRU = []struct{ month, day int }{
	{1, 1}, {1, 2}, {1, 3}, {1, 4}, {1, 5}, {1, 6}, {1, 7}, {1, 8}, {2, 23}, {3, 8}, {5, 1}, {5, 9}, {6, 12}, {11, 4},
}

// defaultHolidays are the fixed holidays of the years around from.
func defaultHolidays(from time.Time) []time.Time {
	var out []time.Time
	for y := from.Year() - 1; y <= from.Year()+2; y++ {
		for _, h := range holidaysRU {
			out = append(out, time.Date(y, time.Month(h.month), h.day, 0, 0, 0, 0, time.UTC))
		}
	}
	return out
}
