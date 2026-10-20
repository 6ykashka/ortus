package calendar

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The day of the prototype (extra-data.js 14.10): 1 October 2026 in Moscow, the workday 08:00–20:00.
var moscow = mustZone("Europe/Moscow")

func mustZone(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		panic(err)
	}
	return loc
}

// msk is «01.10.2026 HH:MM» in Moscow.
func msk(hh, mm int) time.Time { return time.Date(2026, 10, 1, hh, mm, 0, 0, moscow) }

func TestKinds(t *testing.T) {
	t.Parallel()
	for db, api := range map[string]string{"vehicle": "vehicle", "person": "member", "room": "room", "equipment": "equipment"} {
		assert.Equal(t, api, apiKind(db))
		back, ok := dbKind(api)
		assert.True(t, ok)
		assert.Equal(t, db, back)
	}
	_, ok := dbKind("person")
	assert.False(t, ok, "the contract names a person resource member")
	assert.Less(t, kindRank("vehicle"), kindRank("person"))
	assert.Less(t, kindRank("person"), kindRank("room"))
	assert.Less(t, kindRank("room"), kindRank("equipment"))
}

func TestOccupiedSpan(t *testing.T) {
	t.Parallel()
	// SPA-ритуал · Ольга Р.: 11:30–13:00, подготовка и уборка по 15 минут (busySpan эталона).
	occ := occupiedOf(msk(11, 30), msk(13, 0), 15, 15)
	assert.Equal(t, span{msk(11, 15), msk(13, 15)}, occ)
	assert.True(t, occ.overlaps(span{msk(13, 0), msk(14, 0)}))
	assert.False(t, occ.overlaps(span{msk(13, 15), msk(14, 0)}), "half-open: the end touches the next start")
	assert.False(t, occ.overlaps(span{msk(10, 0), msk(11, 15)}))
}

func TestClock(t *testing.T) {
	t.Parallel()
	d, err := parseClock("08:00")
	require.NoError(t, err)
	assert.Equal(t, 8*time.Hour, d)
	d, err = parseClock("20:00:00")
	require.NoError(t, err)
	assert.Equal(t, 20*time.Hour, d)
	_, err = parseClock("8")
	require.Error(t, err)
	assert.Equal(t, "08:00", formatClock(8*time.Hour))
	assert.Equal(t, "19:45", formatClock(19*time.Hour+45*time.Minute))
}

func TestWorkday(t *testing.T) {
	t.Parallel()
	w := workday{start: 8 * time.Hour, end: 20 * time.Hour, loc: moscow}
	day := w.on(msk(13, 0))
	assert.Equal(t, span{msk(8, 0), msk(20, 0)}, day)
	assert.True(t, w.holds(span{msk(8, 0), msk(9, 15)}))
	assert.True(t, w.holds(span{msk(18, 45), msk(20, 0)}))
	assert.False(t, w.holds(span{msk(19, 30), msk(20, 45)}), "«Время вне рабочего дня ресурса.»")
	assert.False(t, w.holds(span{msk(7, 45), msk(9, 0)}))
	// The workday of a resource is in its own zone: 08:00 in Samara is 07:00 in Moscow.
	samara := workday{start: 8 * time.Hour, end: 20 * time.Hour, loc: mustZone("Europe/Samara")}
	got := samara.on(msk(12, 0))
	assert.Equal(t, span{msk(7, 0).UTC(), msk(19, 0).UTC()}, span{got.from.UTC(), got.to.UTC()})
}

func TestNameOrder(t *testing.T) {
	t.Parallel()
	// listCalendarResources: машины эталона по подписи — кириллица раньше латиницы (localeCompare 'ru' MSW).
	names := []string{"Mercedes Sprinter · Т 771 ЕХ", "ГАЗон Next · Е 905 НА", "ГАЗель Next · А 412 МР"}
	sortNames(names)
	assert.Equal(t, []string{"ГАЗель Next · А 412 МР", "ГАЗон Next · Е 905 НА", "Mercedes Sprinter · Т 771 ЕХ"}, names)
	names = []string{"Кабинет № 3", "кабинет № 2", "Анна Морозова · массажист", "Ёлка", "Елена"}
	sortNames(names)
	assert.Equal(t, []string{"Анна Морозова · массажист", "Елена", "Ёлка", "кабинет № 2", "Кабинет № 3"}, names)
}

func sortNames(names []string) {
	for i := 1; i < len(names); i++ {
		for j := i; j > 0 && nameLess(names[j], names[j-1]); j-- {
			names[j], names[j-1] = names[j-1], names[j]
		}
	}
}

func TestListWindow(t *testing.T) {
	t.Parallel()
	day := span{msk(0, 0), msk(0, 0).AddDate(0, 0, 1)}
	from, to := msk(0, 0), msk(0, 0).AddDate(0, 0, 7)
	cases := []struct {
		name     string
		from, to *time.Time
		want     span
		field    string
		message  string
	}{
		{name: "day of the organization", want: day},
		{name: "week", from: &from, to: &to, want: span{from, to}},
		{name: "only from", from: &from, field: "to", message: "Укажите начало и конец периода."},
		{name: "only to", to: &to, field: "from", message: "Укажите начало и конец периода."},
		{name: "reversed", from: &to, to: &from, field: "to", message: "Конец периода раньше начала."},
		{name: "longer than a week", from: &from, to: new(to.Add(time.Minute)), field: "to", message: "Период не длиннее 7 дней."},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			got, err := listWindow(c.from, c.to, msk(10, 30), moscow)
			if c.field == "" {
				require.NoError(t, err)
				assert.Equal(t, c.want, got)
				return
			}
			fe, ok := asFields(err)
			require.True(t, ok, "%v", err)
			assert.Equal(t, codeValidation, fe.code)
			assert.Equal(t, c.message, fe.detail)
			require.Len(t, fe.violations, 1)
			assert.Equal(t, c.field, fe.violations[0].Field)
		})
	}
}

func TestETag(t *testing.T) {
	t.Parallel()
	assert.Equal(t, `"rev-1"`, etag(1))
	require.NoError(t, checkRevision(`"rev-3"`, 3))
	assert.Equal(t, codeRevisionRequired, problemCode(checkRevision("", 3)))
	assert.Equal(t, codeRevisionMismatch, problemCode(checkRevision(`"rev-2"`, 3)))
	assert.Equal(t, codeRevisionMismatch, problemCode(checkRevision("*", 3)))
}

// The reschedule of «Классический массаж · Мария К.» (Анна Морозова + Кабинет № 2) — bookingConflicts of the
// prototype (models.js:395): an item per pair «other booking × shared resource», the other bookings in the order of
// creation, within one the resources in its own order; the title only when the member reads the other booking.
func TestConflictText(t *testing.T) {
	t.Parallel()
	anna, room2 := uuid.New(), uuid.New()
	moved := []uuid.UUID{anna, room2}
	names := map[uuid.UUID]string{anna: "Анна Морозова · массажист", room2: "Кабинет № 2"}
	others := []clash{
		{title: "SPA-ритуал · Ольга Р.", readable: true, resources: []uuid.UUID{anna, room2, uuid.New()}},
		{title: "Массаж спины · Екатерина Л.", readable: true, resources: []uuid.UUID{anna, room2}},
		{title: "Перерыв", readable: true, resources: []uuid.UUID{anna}},
		{title: "Чужая бронь", readable: false, resources: []uuid.UUID{room2}},
	}
	e := conflicts(moved, names, others)
	require.NotNil(t, e)
	assert.Equal(t, codeResourcesUnavailable, e.code)
	assert.Equal(t, "Конфликт ресурсов: Анна Морозова · массажист занят («SPA-ритуал · Ольга Р.»); "+
		"Кабинет № 2 занят («SPA-ритуал · Ольга Р.»); Анна Морозова · массажист занят («Массаж спины · Екатерина Л.»); "+
		"Кабинет № 2 занят («Массаж спины · Екатерина Л.»); Анна Морозова · массажист занят («Перерыв»); Кабинет № 2 занят",
		e.detail)
	fields := make([]string, 0, len(e.violations))
	for _, v := range e.violations {
		assert.Equal(t, "busy", v.Code)
		fields = append(fields, v.Field)
	}
	assert.Equal(t, []string{"resources[0]", "resources[1]", "resources[0]", "resources[1]", "resources[0]", "resources[1]"}, fields)
	assert.Equal(t, "Кабинет № 2 занят", e.violations[5].Message)
	assert.Nil(t, conflicts(moved, names, nil))
}

// freeSlots of the prototype over the seed day: the busy windows of Анна Морозова, Кабинет № 2 and the table.
func TestFreeSlots(t *testing.T) {
	t.Parallel()
	anna, room2, table := uuid.New(), uuid.New(), uuid.New()
	day := workday{start: 8 * time.Hour, end: 20 * time.Hour, loc: moscow}
	type busyRow struct {
		res  []uuid.UUID
		occ  span
		name string
	}
	rows := []busyRow{
		{[]uuid.UUID{anna, room2}, span{msk(10, 0), msk(11, 15)}, "b-a1"},
		{[]uuid.UUID{anna, room2, table}, span{msk(11, 15), msk(13, 15)}, "b-a2"},
		{[]uuid.UUID{anna, room2}, span{msk(14, 0), msk(15, 0)}, "b-a3"},
		{[]uuid.UUID{anna}, span{msk(13, 15), msk(14, 0)}, "b-br"},
	}
	busy := func(except string) func(uuid.UUID, span) bool {
		return func(id uuid.UUID, occ span) bool {
			for _, r := range rows {
				if r.name == except {
					continue
				}
				for _, x := range r.res {
					if x == id && r.occ.overlaps(occ) {
						return true
					}
				}
			}
			return false
		}
	}
	starts := func(slots []slot) []time.Time {
		out := make([]time.Time, 0, len(slots))
		for _, s := range slots {
			out = append(out, s.start)
		}
		return out
	}
	groups := []slotGroup{
		{kind: "person", count: 1, resources: []slotResource{{id: anna, kind: "person", day: day}}},
		{kind: "room", count: 1, resources: []slotResource{{id: room2, kind: "room", day: day}}},
	}
	// «Классический массаж» (60 мин, уборка 15) без себя: 08:00, 08:15, 08:30.
	q := slotQuery{
		window: span{msk(8, 0), msk(20, 0)}, loc: moscow, duration: time.Hour, step: 15 * time.Minute,
		cleanup: 15 * time.Minute, max: 3, current: new(msk(10, 0)),
	}
	got := freeSlots(q, groups, busy("b-a1"))
	assert.Equal(t, []time.Time{msk(8, 0), msk(8, 15), msk(8, 30)}, starts(got))
	assert.Equal(t, []uuid.UUID{anna, room2}, []uuid.UUID{got[0].resources[0].id, got[0].resources[1].id})
	// «SPA-ритуал» (90 мин, подготовка и уборка по 15, стол) без себя: 08:15, 15:15, 15:30 эталона.
	q.duration, q.prep, q.current = 90*time.Minute, 15*time.Minute, new(msk(11, 30))
	withTable := []slotGroup{groups[0], groups[1], {kind: "equipment", count: 1,
		resources: []slotResource{{id: table, kind: "equipment", day: day}}}}
	assert.Equal(t, []time.Time{msk(8, 15), msk(15, 15), msk(15, 30)}, starts(freeSlots(q, withTable, busy("b-a2"))))
	// The current start is skipped even when free; a narrower window bounds the slots.
	q = slotQuery{window: span{msk(16, 0), msk(17, 0)}, loc: moscow, duration: 30 * time.Minute,
		step: 15 * time.Minute, max: 20, current: new(msk(16, 15))}
	assert.Equal(t, []time.Time{msk(16, 0), msk(16, 30)}, starts(freeSlots(q, groups, busy(""))))
	// Two candidates of a group: the first free one is picked.
	room3 := uuid.New()
	two := []slotGroup{{kind: "room", count: 1, resources: []slotResource{
		{id: room2, kind: "room", day: day}, {id: room3, kind: "room", day: day},
	}}}
	q = slotQuery{window: span{msk(10, 0), msk(11, 0)}, loc: moscow, duration: time.Hour, step: 15 * time.Minute, max: 1}
	got = freeSlots(q, two, busy(""))
	require.Len(t, got, 1)
	assert.Equal(t, room3, got[0].resources[0].id)
}

func TestSlotToken(t *testing.T) {
	t.Parallel()
	// The token of MSW: base64 of «a.<booking>.<start>» without padding (example findCalendarAvailability/reschedule).
	id := uuid.MustParse("3b8b9c80-10c9-50b9-8e4f-ecfe3f0ec3b1")
	assert.Equal(t, "YS4zYjhiOWM4MC0xMGM5LTUwYjktOGU0Zi1lY2ZlM2YwZWMzYjEuMjAyNi0xMC0wMVQwNTowMDowMFo",
		slotToken(id, msk(8, 0)))
	assert.Equal(t, "YS4tLjIwMjYtMTAtMDFUMDU6MDA6MDBa", slotToken(uuid.Nil, msk(8, 0)))
}
