package service

import (
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
)

func demoID(proto string) uuid.UUID {
	return uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:t-alta:"+proto))
}

// demoSource is the demo data as the queues read it.
func demoSource() (Source, DemoSet) {
	d := Demo(demoID)
	s := Source{Calendars: map[uuid.UUID]Calendar{}, Ratings: d.Ratings}
	for _, x := range d.Directions {
		s.Calendars[x.ID] = x.Calendar
	}
	for i := range d.Requests {
		s.Requests = append(s.Requests, &d.Requests[i].Request)
	}
	return s, d
}

func keysOf(s Source, q QueueQuery) []string {
	rows, _ := s.Queue(q)
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.Request.Key)
	}
	return out
}

var owner = demoID("m-owner")

func base(queue string) QueueQuery { return QueueQuery{Queue: queue, Me: owner, Now: DemoBase} }

func TestQueuesAreEightWithLabelsAndTones(t *testing.T) {
	t.Parallel()
	var got [][4]string
	for _, q := range Queues() {
		got = append(got, [4]string{q.Key, q.Label, q.Icon, q.Tone})
	}
	same(t, "queues", got, [][4]string{
		{"open", "Открытые", "inbox", ""}, {"noreply", "Без ответа", "mark_email_unread", ""}, {"mine", "Мои", "person", ""},
		{"risk", "Срок под угрозой", "schedule", "warn"}, {"late", "Срок нарушен", "error", "danger"},
		{"wait", "Ждут клиента", "hourglass_top", ""}, {"low", "Низкие оценки", "sentiment_dissatisfied", ""},
		{"done", "Решено и закрыто", "task_alt", ""},
	})
}

func TestCountsOnTheDemoAtTheBase(t *testing.T) {
	t.Parallel()
	s, _ := demoSource()
	same(t, "all", s.Counts(uuid.Nil, owner, DemoBase), map[string]int{"open": 7, "noreply": 4, "mine": 2, "risk": 0, "late": 1, "wait": 1, "low": 2, "done": 1})
	same(t, "grz", s.Counts(demoID("d-grz"), owner, DemoBase), map[string]int{"open": 2, "noreply": 1, "mine": 0, "risk": 0, "late": 1, "wait": 1, "low": 1, "done": 0})
	later := s.Counts(uuid.Nil, owner, DemoBase.Add(26*time.Minute))
	eq(t, "risk at 16:50", later["risk"], 1)
	eq(t, "late at 16:50", later["late"], 1)
}

func TestDirectionCountsDoNotDependOnTheSelectedDirection(t *testing.T) {
	t.Parallel()
	s, _ := demoSource()
	want := map[uuid.UUID]int{demoID("d-mas"): 2, demoID("d-kos"): 1, demoID("d-otd"): 2, demoID("d-grz"): 2}
	same(t, "by direction", s.DirectionCounts(), want)
}

func TestOpenQueueIsSortedByTheMainTerm(t *testing.T) {
	t.Parallel()
	s, _ := demoSource()
	same(t, "open", keysOf(s, base("open")), []string{"ГРЗ-57", "МАС-41", "МАС-40", "КОС-6", "ОТД-12", "ОТД-11", "ГРЗ-55"})
	rows, _ := s.Queue(base("open"))
	eq(t, "late", rows[0].Head.State+":"+rows[0].Head.Text, "late:просрочен на 1 ч 10 мин")
	eq(t, "norm", rows[1].Head.State+":"+rows[1].Head.Label+":"+rows[1].Head.Text, "norm:Первый ответ:осталось 48 мин")
	eq(t, "repairs", rows[4].Head.Text, "осталось 9 раб. дней")
	eq(t, "pause", rows[6].Head.State+":"+rows[6].Head.Until, "pause:по закону до 26 октября")
}

func TestOtherQueues(t *testing.T) {
	t.Parallel()
	s, _ := demoSource()
	for queue, want := range map[string][]string{
		"noreply": {"ГРЗ-57", "МАС-41", "МАС-40", "КОС-6"}, "mine": {"ОТД-12", "ОТД-11"}, "late": {"ГРЗ-57"}, "risk": {},
		"wait": {"ГРЗ-55"}, "done": {"МАС-39"}, "zzz": {"ГРЗ-57", "МАС-41", "МАС-40", "КОС-6", "ОТД-12", "ОТД-11", "ГРЗ-55"},
	} {
		same(t, queue, keysOf(s, base(queue)), want)
	}
}

func TestLowQueueHasRatingsAndNoRows(t *testing.T) {
	t.Parallel()
	s, d := demoSource()
	rows, ratings := s.Queue(base("low"))
	eq(t, "rows", len(rows), 0)
	eq(t, "ratings", len(ratings), 2)
	q := base("low")
	q.Direction = demoID("d-grz")
	_, ratings = s.Queue(q)
	eq(t, "grz ratings", len(ratings), 1)
	eq(t, "grz rating", ratings[0].Comment, d.Ratings[1].Comment)
	s.Ratings[0].Status = "seen"
	_, ratings = s.Queue(base("low"))
	eq(t, "seen is not in the queue", len(ratings), 1)
}

func TestQueueFilters(t *testing.T) {
	t.Parallel()
	s, _ := demoSource()
	f := func(mut func(*QueueQuery)) []string {
		q := base("open")
		mut(&q)
		return keysOf(s, q)
	}
	same(t, "direction", f(func(q *QueueQuery) { q.Direction = demoID("d-otd") }), []string{"ОТД-12", "ОТД-11"})
	same(t, "kind", f(func(q *QueueQuery) { q.Kind = "cargo" }), []string{"ГРЗ-57", "ГРЗ-55"})
	same(t, "channel", f(func(q *QueueQuery) { q.Channel = "phone" }), []string{"ГРЗ-55"})
	same(t, "kind and channel", f(func(q *QueueQuery) { q.Kind, q.Channel = "cargo", "bot" }), []string{"ГРЗ-57"})
}

func TestQueueSearch(t *testing.T) {
	t.Parallel()
	s, _ := demoSource()
	for needle, want := range map[string][]string{
		"  мас-41 ": {"МАС-41"}, "ЛАВКА": {"ГРЗ-57"}, "ламинат": {"ОТД-11"}, "лаврова": {"МАС-40"}, "+7 916": {},
	} {
		q := base("open")
		q.Q = needle
		same(t, needle, keysOf(s, q), want)
	}
	s.Requests[0].OldKeys = []string{"МАС-5"}
	q := base("open")
	q.Q = "мас-5"
	same(t, "old key", keysOf(s, q), []string{"ГРЗ-57"})
}

func TestTakeable(t *testing.T) {
	t.Parallel()
	s, _ := demoSource()
	vera := demoID("m-kotelnikova")
	team := []uuid.UUID{owner, vera}
	r57, r55, r39 := s.Requests[0], s.Requests[5], s.Requests[7]
	eq(t, "free", Takeable(r57, team, owner, true), true)
	eq(t, "no right", Takeable(r57, team, owner, false), false)
	eq(t, "not in the team", Takeable(r57, team, demoID("m-kotova"), true), false)
	eq(t, "has an assignee", Takeable(r55, team, owner, true), false)
	eq(t, "resolved", Takeable(r39, team, owner, true), false)
}

func TestDemoHasFourDirectionsTypesRequestsAndRatings(t *testing.T) {
	t.Parallel()
	_, d := demoSource()
	eq(t, "directions", len(d.Directions), 4)
	eq(t, "types", len(d.Types), 21)
	eq(t, "templates", len(d.Templates), 4)
	eq(t, "requests", len(d.Requests), 8)
	eq(t, "ratings (two open, one spent)", len(d.Ratings), 3)
	keys := []string{}
	for _, r := range d.Requests {
		keys = append(keys, r.Key)
	}
	slices.Sort(keys)
	same(t, "keys", keys, []string{"ГРЗ-55", "ГРЗ-57", "КОС-6", "МАС-39", "МАС-40", "МАС-41", "ОТД-11", "ОТД-12"})
	eq(t, "about", d.Requests[1].About, demoID("m-morozova"))
}
