package service

import (
	"math"
	"sort"
	"strconv"
	"time"
)

const (
	day         = 24 * time.Hour
	targetFirst = "first"
	targetRes   = "resolve"
	targetLegal = stateLegal
)

// Timer is one goal of a request (service.sla_timers): Goal is the goal in working minutes (for the legal term — in
// minutes of the calendar days), Due the end of the term, Stopped the moment the goal was met.
type Timer struct {
	Goal    int
	Due     time.Time
	Stopped *time.Time
}

// SLA are the timers of a request: the first reply, the resolution and the legal term.
type SLA struct{ First, Resolve, Legal *Timer }

// TypeGoals are the goals of a type of requests: working minutes of the first reply and of the resolution, calendar
// days of the legal term.
type TypeGoals struct{ First, Resolve, Legal *int }

// IsOpen reports whether a request in status is open.
func IsOpen(status string) bool { return status != StatusResolved && status != StatusClosed }

// SLAFor are the timers of a new request of a type at the moment at.
func SLAFor(cal Calendar, ty TypeGoals, at time.Time) SLA {
	var s SLA
	if ty.First != nil && *ty.First > 0 {
		s.First = &Timer{Goal: *ty.First, Due: cal.AddWorkMinutes(at, *ty.First)}
	}
	if ty.Resolve != nil && *ty.Resolve > 0 {
		s.Resolve = &Timer{Goal: *ty.Resolve, Due: cal.AddWorkMinutes(at, *ty.Resolve)}
	}
	if ty.Legal != nil && *ty.Legal > 0 {
		s.Legal = &Timer{Goal: *ty.Legal * 1440, Due: at.AddDate(0, 0, *ty.Legal)}
	}
	return s
}

// ResumeTimers takes a request off «ждём клиента»: the first reply and the resolution that are not stopped move by the
// idle time in working minutes; the legal term never stops. It returns the idle minutes (0 without a pause).
func ResumeTimers(s *SLA, cal Calendar, pausedAt *time.Time, now time.Time) int {
	if pausedAt == nil {
		return 0
	}
	mins := cal.WorkBetween(*pausedAt, now)
	for _, t := range []*Timer{s.First, s.Resolve} {
		if t != nil && t.Stopped == nil {
			t.Due = cal.AddWorkMinutes(t.Due, mins)
		}
	}
	return mins
}

// SLARequest is what the terms of a request are counted from.
type SLARequest struct {
	Status     string
	At         time.Time
	SLA        SLA
	Outcome    string
	ResolvedAt *time.Time
}

// SLAItem is the state of one goal for the screen: done, pause, late, risk, norm or legal.
type SLAItem struct {
	Key, Label, State, Text, Until string
	Over                           float64 // late: minutes over the term
	Left                           float64 // risk, norm, legal: minutes left
}

// SLAHead is the main term of a request: Rank orders the queue (less is more urgent).
type SLAHead struct {
	SLAItem
	Rank float64
}

var targetLabels = map[string]string{targetFirst: "Первый ответ", targetRes: "Решение", targetLegal: "Ответ по закону"}

// SLAOf are the goals of a request for the screen: the first reply, the resolution and the legal term.
func SLAOf(r SLARequest, cal Calendar, now time.Time) []SLAItem {
	var out []SLAItem
	paused := r.Status == StatusWait
	for _, p := range []struct {
		key string
		t   *Timer
	}{{targetFirst, r.SLA.First}, {targetRes, r.SLA.Resolve}, {targetLegal, r.SLA.Legal}} {
		if p.t != nil {
			out = append(out, itemOf(p.key, *p.t, r, cal, now, paused))
		}
	}
	return out
}

func itemOf(key string, x Timer, r SLARequest, cal Calendar, now time.Time, paused bool) SLAItem {
	it := SLAItem{Key: key, Label: targetLabels[key]}
	legal := key == targetLegal
	loc := cal.loc()
	switch {
	case x.Stopped != nil:
		it.State, it.Text, it.Until = stateDone, "выполнено", "в срок"
		if key == targetFirst {
			it.Text = "ответ за " + Dur(float64(cal.WorkBetween(r.At, *x.Stopped)), &cal)
		}
		if x.Stopped.After(x.Due) {
			it.Until = "с нарушением срока"
		}
	case paused && !legal:
		it.State, it.Text, it.Until = statePause, "на паузе", "ждём клиента"
	case now.After(x.Due):
		it.State, it.Over = stateLate, now.Sub(x.Due).Minutes()
		it.Text, it.Until = "просрочен на "+Span(it.Over), "был до "+DueTextIn(x.Due, now, loc)
	default:
		it.fill(x, legal, cal, now)
	}
	return it
}

// fill is the state of a goal that is not met, not paused and not overdue.
func (it *SLAItem) fill(x Timer, legal bool, cal Calendar, now time.Time) {
	var left float64
	var risk bool
	if legal {
		d := max(0, int(math.Ceil(x.Due.Sub(now).Seconds()/day.Seconds())))
		left, risk = float64(d)*1440, d <= 2
		it.Text = "осталось " + strconv.Itoa(d) + " " + Plural(d, "день", "дня", "дней")
	} else {
		m := cal.WorkBetween(now, x.Due)
		left, risk = float64(m), float64(m) <= math.Max(20, float64(x.Goal)*0.25)
		it.Text = "осталось " + Dur(float64(m), &cal)
	}
	it.State, it.Left = stateNorm, left
	if risk {
		it.State = stateRisk
	} else if legal {
		it.State = stateLegal
	}
	it.Until = "до " + DueTextIn(x.Due, now, cal.loc())
}

func isActive(s string) bool { return s == stateRisk || s == stateNorm || s == stateLegal }

// SLAHeadOf is the main term of a request for the row of the queue.
func SLAHeadOf(r SLARequest, cal Calendar, now time.Time) SLAHead {
	if !IsOpen(r.Status) {
		text := r.Outcome
		if text == "" {
			text = "решено"
		}
		var at float64
		if r.ResolvedAt != nil {
			at = float64(r.ResolvedAt.UnixMilli())
		}
		return SLAHead{SLAItem: SLAItem{State: stateDone, Label: "Готово", Text: text}, Rank: 2e12 - at/1e3}
	}
	all := SLAOf(r, cal, now)
	if len(all) == 0 {
		return SLAHead{SLAItem: SLAItem{State: "none", Label: "Срок", Text: "без срока"}, Rank: 1e12}
	}
	if late := mostLate(all); late != nil {
		return SLAHead{SLAItem: *late, Rank: -late.Over}
	}
	var act []SLAItem
	for _, x := range all {
		if isActive(x.State) {
			act = append(act, x)
		}
	}
	if r.Status == StatusWait || len(act) == 0 {
		until := "срок стоит"
		for _, x := range all {
			if x.Key == targetLegal && x.State != stateDone {
				until = "по закону " + x.Until
			}
		}
		return SLAHead{SLAItem: SLAItem{State: statePause, Label: "Пауза", Text: "ждём клиента", Until: until}, Rank: 9e11}
	}
	f := pickHead(act)
	return SLAHead{SLAItem: f, Rank: f.Left}
}

// mostLate is the overdue goal with the biggest delay (the first of equals).
func mostLate(all []SLAItem) *SLAItem {
	var best *SLAItem
	for i := range all {
		if all[i].State == stateLate && (best == nil || all[i].Over > best.Over) {
			best = &all[i]
		}
	}
	return best
}

// pickHead is the first reply if it runs, else the goal with the least left.
func pickHead(act []SLAItem) SLAItem {
	for _, x := range act {
		if x.Key == targetFirst {
			return x
		}
	}
	sort.SliceStable(act, func(i, j int) bool { return act[i].Left < act[j].Left })
	return act[0]
}

// stopAll stops the timers that run: the request is resolved.
func stopAll(s *SLA, at time.Time) {
	for _, t := range []*Timer{s.First, s.Resolve, s.Legal} {
		if t != nil && t.Stopped == nil {
			t.Stopped = new(at)
		}
	}
}

// restart sets the resolution and the legal term running again: a resolved request came back to work.
func (s *SLA) restart() {
	for _, t := range []*Timer{s.Resolve, s.Legal} {
		if t != nil {
			t.Stopped = nil
		}
	}
}
