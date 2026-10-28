package service

import (
	"fmt"
	"testing"
	"time"
)

var (
	slaAt   = at(1, 10, 15, 12)
	slaType = TypeGoals{First: new(120), Resolve: new(1320), Legal: new(10)}
)

func TestSLAForCountsGoalsFromTheType(t *testing.T) {
	t.Parallel()
	s := SLAFor(calSpa, slaType, slaAt)
	eq(t, "first goal", s.First.Goal, 120)
	sameTime(t, "first due", s.First.Due, at(1, 10, 17, 12))
	eq(t, "first stopped", s.First.Stopped == nil, true)
	eq(t, "resolve goal", s.Resolve.Goal, 1320)
	sameTime(t, "resolve due", s.Resolve.Due, at(3, 10, 15, 12))
	eq(t, "legal goal", s.Legal.Goal, 10*1440)
	sameTime(t, "legal due", s.Legal.Due, slaAt.AddDate(0, 0, 10))
	e := SLAFor(calSpa, TypeGoals{}, slaAt)
	eq(t, "no goals", e.First == nil && e.Resolve == nil && e.Legal == nil, true)
}

func fresh(status string) SLARequest {
	return SLARequest{Status: status, At: slaAt, SLA: SLAFor(calSpa, slaType, slaAt)}
}

func TestSLAOfNormal(t *testing.T) {
	t.Parallel()
	got := SLAOf(fresh("new"), calSpa, at(1, 10, 16, 24))
	eq(t, "items", len(got), 3)
	same(t, "first", got[0], SLAItem{Key: "first", Label: "Первый ответ", State: "norm", Text: "осталось 48 мин", Until: "до 17:12", Left: 48})
	same(t, "resolve", got[1], SLAItem{Key: "resolve", Label: "Решение", State: "norm", Text: "осталось 1 день", Until: "до 3 октября, 15:12", Left: 1248})
	same(t, "legal", got[2], SLAItem{Key: "legal", Label: "Ответ по закону", State: "legal", Text: "осталось 10 дней", Until: "до 11 октября", Left: 14400})
}

func TestSLAOfRiskIsAtMostAQuarterOrTwentyMinutes(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		now   time.Time
		state string
		left  float64
	}{{at(1, 10, 16, 50), "risk", 22}, {at(1, 10, 16, 42), "risk", 30}, {at(1, 10, 16, 41), "norm", 31}} {
		got := SLAOf(fresh("new"), calSpa, c.now)[0]
		eq(t, "state", got.State, c.state)
		eq(t, "left", got.Left, c.left)
	}
	short := fresh("new")
	short.SLA = SLAFor(calSpa, TypeGoals{First: new(60)}, slaAt)
	got := SLAOf(short, calSpa, at(1, 10, 15, 52))[0]
	eq(t, "20 left", fmt.Sprintf("%s:%.0f", got.State, got.Left), "risk:20")
	got = SLAOf(short, calSpa, at(1, 10, 15, 51))[0]
	eq(t, "21 left", fmt.Sprintf("%s:%.0f", got.State, got.Left), "norm:21")
}

func TestSLAOfLate(t *testing.T) {
	t.Parallel()
	got := SLAOf(fresh("new"), calSpa, at(1, 10, 18, 0))[0]
	same(t, "late", got, SLAItem{Key: "first", Label: "Первый ответ", State: "late", Text: "просрочен на 48 мин", Until: "был до 17:12", Over: 48})
}

func TestSLAOfLegalTerm(t *testing.T) {
	t.Parallel()
	due := slaAt.AddDate(0, 0, 10)
	risk := SLAOf(fresh("new"), calSpa, due.Add(-36*time.Hour))[2]
	same(t, "risk", risk, SLAItem{Key: "legal", Label: "Ответ по закону", State: "risk", Text: "осталось 2 дня", Until: "до 11 октября, 15:12", Left: 2880})
	late := SLAOf(fresh("new"), calSpa, due.Add(48*time.Hour+5*time.Minute))[2]
	eq(t, "late state", late.State, "late")
	eq(t, "late text", late.Text, "просрочен на 2 дня")
	eq(t, "late until", late.Until, "был до 11 октября, 15:12")
}

func TestSLAOfWaitPausesTheFirstAndTheResolveButNotTheLaw(t *testing.T) {
	t.Parallel()
	got := SLAOf(fresh("wait"), calSpa, at(1, 10, 16, 24))
	eq(t, "first", got[0].State, "pause")
	eq(t, "resolve", got[1].State, "pause")
	eq(t, "legal", got[2].State, "legal")
	eq(t, "text", got[0].Text, "на паузе")
	eq(t, "until", got[0].Until, "ждём клиента")
}

func TestSLAOfStopped(t *testing.T) {
	t.Parallel()
	r := fresh("new")
	r.SLA.First.Stopped = new(at(1, 10, 15, 40))
	r.SLA.Resolve.Stopped = new(at(3, 10, 16, 0))
	got := SLAOf(r, calSpa, at(4, 10, 12, 0))
	same(t, "first", got[0], SLAItem{Key: "first", Label: "Первый ответ", State: "done", Text: "ответ за 28 мин", Until: "в срок"})
	same(t, "resolve", got[1], SLAItem{Key: "resolve", Label: "Решение", State: "done", Text: "выполнено", Until: "с нарушением срока"})
	eq(t, "no goals", len(SLAOf(SLARequest{Status: "new", At: slaAt}, calSpa, at(1, 10, 16, 0))), 0)
}

func TestSLAHeadOfFinishedAndEmpty(t *testing.T) {
	t.Parallel()
	now := at(1, 10, 16, 24)
	resolved := fresh("resolved")
	resolved.Outcome, resolved.ResolvedAt = "Устранено", new(time.UnixMilli(5e12))
	same(t, "resolved", SLAHeadOf(resolved, calSpa, now), SLAHead{SLAItem: SLAItem{State: "done", Label: "Готово", Text: "Устранено"}, Rank: 2e12 - 5e12/1e3})
	eq(t, "closed", SLAHeadOf(fresh("closed"), calSpa, now).Text, "решено")
	same(t, "none", SLAHeadOf(SLARequest{Status: "new", At: slaAt}, calSpa, now),
		SLAHead{SLAItem: SLAItem{State: "none", Label: "Срок", Text: "без срока"}, Rank: 1e12})
}

func TestSLAHeadOfRunning(t *testing.T) {
	t.Parallel()
	now := at(1, 10, 16, 24)
	h := SLAHeadOf(fresh("new"), calSpa, at(1, 10, 18, 0))
	eq(t, "late", h.Key+h.State, "firstlate")
	eq(t, "late rank", h.Rank, -48.0)
	h = SLAHeadOf(fresh("new"), calSpa, now)
	eq(t, "first", h.Key+h.State, "firstnorm")
	eq(t, "first rank", h.Rank, 48.0)
	given := fresh("new")
	given.SLA.First.Stopped = new(at(1, 10, 15, 40))
	h = SLAHeadOf(given, calSpa, now)
	eq(t, "after the first", h.Key, "resolve")
	eq(t, "after the first rank", h.Rank, 1248.0)
}

func TestSLAHeadOfPause(t *testing.T) {
	t.Parallel()
	now := at(1, 10, 16, 24)
	same(t, "wait", SLAHeadOf(fresh("wait"), calSpa, now),
		SLAHead{SLAItem: SLAItem{State: "pause", Label: "Пауза", Text: "ждём клиента", Until: "по закону до 11 октября"}, Rank: 9e11})
	noLaw := fresh("wait")
	noLaw.SLA = SLAFor(calSpa, TypeGoals{First: new(120), Resolve: new(1320)}, slaAt)
	eq(t, "no law", SLAHeadOf(noLaw, calSpa, now).Until, "срок стоит")
	allDone := fresh("new")
	allDone.SLA = SLAFor(calSpa, TypeGoals{First: new(120)}, slaAt)
	allDone.SLA.First.Stopped = new(at(1, 10, 15, 40))
	h := SLAHeadOf(allDone, calSpa, now)
	eq(t, "all done", h.State+":"+h.Until, "pause:срок стоит")
}

func TestSLAHeadOrdersTheQueue(t *testing.T) {
	t.Parallel()
	now := at(1, 10, 18, 0)
	later := at(1, 10, 17, 0)
	rows := map[string]SLARequest{
		"done": {Status: "resolved", At: slaAt, ResolvedAt: new(time.UnixMilli(1e12))},
		"none": {Status: "new", At: slaAt},
		"wait": fresh("wait"),
		"norm": {Status: "new", At: later, SLA: SLAFor(calSpa, slaType, later)},
		"late": fresh("new"),
	}
	rank := func(k string) float64 { return SLAHeadOf(rows[k], calSpa, now).Rank }
	for _, pair := range [][2]string{{"late", "norm"}, {"norm", "wait"}, {"wait", "none"}, {"none", "done"}} {
		eq(t, pair[0]+" before "+pair[1], rank(pair[0]) < rank(pair[1]), true)
	}
}

func TestResumeShiftsTheTimersByTheIdleWorkMinutes(t *testing.T) {
	t.Parallel()
	s := SLAFor(calSpa, slaType, slaAt)
	legal := s.Legal.Due
	eq(t, "idle", ResumeTimers(&s, calSpa, new(at(1, 10, 12, 0)), at(1, 10, 15, 0)), 180)
	sameTime(t, "first", s.First.Due, at(1, 10, 20, 12))
	sameTime(t, "law", s.Legal.Due, legal)
}

func TestResumeLeavesAStoppedTimerAndAFreeRequest(t *testing.T) {
	t.Parallel()
	stopped := SLAFor(calSpa, slaType, slaAt)
	stopped.First.Stopped = new(at(1, 10, 15, 40))
	due := stopped.First.Due
	ResumeTimers(&stopped, calSpa, new(at(1, 10, 12, 0)), at(1, 10, 15, 0))
	sameTime(t, "stopped", stopped.First.Due, due)
	free := SLAFor(calSpa, slaType, slaAt)
	eq(t, "no pause", ResumeTimers(&free, calSpa, nil, at(1, 10, 15, 0)), 0)
	sameTime(t, "resolve", free.Resolve.Due, at(3, 10, 15, 12))
}

func TestIsOpen(t *testing.T) {
	t.Parallel()
	for st, want := range map[string]bool{"new": true, "work": true, "wait": true, "resolved": false, "closed": false} {
		eq(t, st, IsOpen(st), want)
	}
}
