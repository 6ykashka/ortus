package pool

import (
	"testing"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
)

// Правила пула (W2.51, контракт 0.6.0-stage2; MSW pool-rules.ts — образец): окно, выбор публикации, состояние
// публикации, псевдоним, досчёт времени запроса и временного назначения (Q-W2.51-4, Q-W2.51-13, Q-W2.51-15).

var day = time.Date(2026, time.October, 1, 0, 0, 0, 0, time.UTC)

// at is 01.10.2026 at h:m UTC.
func at(h, m int) time.Time {
	return day.Add(time.Duration(h)*time.Hour + time.Duration(m)*time.Minute)
}

func win(h1, h2 int) Window { return Window{Start: at(h1, 0), End: at(h2, 0)} }

func TestWindow(t *testing.T) {
	t.Parallel()
	free := win(10, 16)
	for _, c := range []struct {
		name                    string
		w                       Window
		valid, within, overlaps bool
	}{
		{"внутри", win(11, 15), true, true, true},
		{"совпадает", win(10, 16), true, true, true},
		{"начинается раньше", win(9, 12), true, false, true},
		{"кончается позже", win(15, 17), true, false, true},
		{"вплотную после", win(16, 18), true, false, false},
		{"пустое", Window{Start: at(12, 0), End: at(12, 0)}, false, false, false},
		{"наоборот", Window{Start: at(13, 0), End: at(12, 0)}, false, false, false},
	} {
		if got := c.w.Valid(); got != c.valid {
			t.Errorf("%s: Valid = %v, want %v", c.name, got, c.valid)
		}
		if got := c.w.Within(free); got != c.within {
			t.Errorf("%s: Within = %v, want %v", c.name, got, c.within)
		}
		if got := c.w.Overlaps(free); got != c.overlaps {
			t.Errorf("%s: Overlaps = %v, want %v", c.name, got, c.overlaps)
		}
	}
}

// Q-W2.51-13 (вариант А): без publicationId — публикация, чьё окно содержит окно запроса, иначе пересекающаяся,
// иначе любая; раньше начало свободного окна, затем меньший id.
func TestChoosePublication(t *testing.T) {
	t.Parallel()
	a := uuid.MustParse("00000000-0000-4000-8000-00000000000a")
	b := uuid.MustParse("00000000-0000-4000-8000-00000000000b")
	c := uuid.MustParse("00000000-0000-4000-8000-00000000000c")
	morning := Candidate{ID: c, Free: win(6, 10)}
	noon := Candidate{ID: b, Free: win(11, 15)}
	noonToo := Candidate{ID: a, Free: win(11, 14)}
	evening := Candidate{ID: a, Free: win(16, 20)}
	for _, tc := range []struct {
		name   string
		active []Candidate
		w      Window
		want   uuid.UUID
		ok     bool
	}{
		{"содержит", []Candidate{evening, noon, morning}, win(12, 13), b, true},
		{"содержат две — раньше начало, затем меньший id", []Candidate{noon, noonToo}, win(12, 13), a, true},
		{"только пересекает", []Candidate{evening, morning}, win(9, 11), c, true},
		{"ни одна не пересекает — любая, раньше начало", []Candidate{evening, noon}, win(21, 22), b, true},
		{"нет активных", nil, win(12, 13), uuid.Nil, false},
	} {
		got, ok := ChoosePublication(tc.active, tc.w)
		if ok != tc.ok || got.ID != tc.want {
			t.Errorf("%s: %v %v, want %v %v", tc.name, got.ID, ok, tc.want, tc.ok)
		}
	}
}

func TestPublicationState(t *testing.T) {
	t.Parallel()
	free := win(10, 16)
	for _, c := range []struct {
		name      string
		withdrawn bool
		now       time.Time
		want      fleetapi.DriverPoolPublicationState
	}{
		{"до окна", false, at(8, 0), fleetapi.DriverPoolPublicationStateActive},
		{"в окне", false, at(15, 59), fleetapi.DriverPoolPublicationStateActive},
		{"окно кончилось", false, at(16, 0), fleetapi.DriverPoolPublicationStateExpired},
		{"снята", true, at(11, 0), fleetapi.DriverPoolPublicationStateWithdrawn},
		{"снята и кончилась", true, at(17, 0), fleetapi.DriverPoolPublicationStateWithdrawn},
	} {
		if got := PublicationState(free, c.withdrawn, c.now); got != c.want {
			t.Errorf("%s: %s, want %s", c.name, got, c.want)
		}
	}
}

// Псевдоним пула — следующий номер после всех номеров организации (MSW nextLabel).
func TestNextLabel(t *testing.T) {
	t.Parallel()
	for max, want := range map[int]string{0: "Водитель #1", 117: "Водитель #118"} {
		if got := NextLabel(max); got != want {
			t.Errorf("NextLabel(%d) = %q, want %q", max, got, want)
		}
	}
}

// Досчёт времени запроса и назначения (Q-W2.51-4, Q-W2.51-15; MSW settlePool, grantStateAt, endOf).
func TestSettle(t *testing.T) {
	t.Parallel()
	driver := uuid.New()
	other := uuid.New()
	period := win(14, 18)
	trip := func(state string, by uuid.UUID) *TripState { return &TripState{State: state, Driver: by} }
	approved := func(tr *TripState, upper *time.Time) Transfer {
		return Transfer{Status: StatusApproved, Period: period, Revision: 2, Person: driver, Trip: tr, Grant: true, GrantUpper: upper}
	}
	end := period.End
	for _, c := range []struct {
		name string
		x    Transfer
		now  time.Time
		want Settled
	}{
		{"открытый запрос до начала окна", Transfer{Status: StatusRequested, Period: period, Revision: 1, Person: driver}, at(13, 59),
			Settled{Status: StatusRequested, Revision: 1}},
		{"открытый запрос к началу окна истекает", Transfer{Status: StatusRequested, Period: period, Revision: 1, Person: driver}, at(14, 0),
			Settled{Status: StatusExpired, Revision: 2, Changed: true}},
		{"отклонённый не меняется", Transfer{Status: StatusRejected, Period: period, Revision: 2, Person: driver}, at(19, 0),
			Settled{Status: StatusRejected, Revision: 2}},
		{"одобрен, до окна — scheduled", approved(trip(tripPlanned, driver), &end), at(13, 0),
			Settled{Status: StatusApproved, Grant: fleetapi.TemporaryDriverGrantStateScheduled, Revision: 2, GrantUntil: &end}},
		{"одобрен, в окне — active", approved(trip(tripPlanned, driver), &end), at(15, 0),
			Settled{Status: StatusApproved, Grant: fleetapi.TemporaryDriverGrantStateActive, Revision: 2, GrantUntil: &end}},
		{"рейс начат — грант открыт до приёмки", approved(trip("on_route", driver), &end), at(15, 0),
			Settled{Status: StatusApproved, Grant: fleetapi.TemporaryDriverGrantStateActive, Revision: 2, GrantChange: true}},
		{"начатый рейс после окна — closing", approved(trip("submitted", driver), nil), at(19, 0),
			Settled{Status: StatusApproved, Grant: fleetapi.TemporaryDriverGrantStateClosing, Revision: 2}},
		{"доработка после окна — closing", approved(trip("rework", driver), nil), at(20, 0),
			Settled{Status: StatusApproved, Grant: fleetapi.TemporaryDriverGrantStateClosing, Revision: 2}},
		{"рейс вернули в план — грант снова до конца окна", approved(trip(tripPlanned, driver), nil), at(15, 0),
			Settled{Status: StatusApproved, Grant: fleetapi.TemporaryDriverGrantStateActive, Revision: 2, GrantUntil: &end, GrantChange: true}},
		{"не начатый рейс к концу окна — completed, водитель снят", approved(trip(tripAssigned, driver), &end), at(18, 0),
			Settled{Status: StatusCompleted, Grant: fleetapi.TemporaryDriverGrantStateEnded, CompletedAt: &end, Revision: 3,
				Changed: true, GrantUntil: &end, Unassign: true}},
		{"без рейса к концу окна — completed", approved(nil, &end), at(18, 30),
			Settled{Status: StatusCompleted, Grant: fleetapi.TemporaryDriverGrantStateEnded, CompletedAt: &end, Revision: 3,
				Changed: true, GrantUntil: &end}},
		{"рейс у другого водителя — не держит назначение", approved(trip("on_route", other), &end), at(18, 0),
			Settled{Status: StatusCompleted, Grant: fleetapi.TemporaryDriverGrantStateEnded, CompletedAt: &end, Revision: 3,
				Changed: true, GrantUntil: &end}},
		{"принят в окне — грант закрыт приёмкой, назначение до конца окна",
			approved(&TripState{State: tripAccepted, Driver: driver, AcceptedAt: new(at(16, 0))}, nil), at(16, 30),
			Settled{Status: StatusApproved, Grant: fleetapi.TemporaryDriverGrantStateActive, Revision: 2, GrantUntil: new(at(16, 0)), GrantChange: true}},
		{"принят после окна — completedAt = приёмка",
			approved(&TripState{State: tripAccepted, Driver: driver, AcceptedAt: new(at(19, 30))}, nil), at(19, 31),
			Settled{Status: StatusCompleted, Grant: fleetapi.TemporaryDriverGrantStateEnded, CompletedAt: new(at(19, 30)), Revision: 3,
				Changed: true, GrantUntil: new(at(19, 30)), GrantChange: true}},
		{"отменён после окна — закрыт моментом досчёта", approved(trip(tripCancelled, driver), nil), at(19, 0),
			Settled{Status: StatusCompleted, Grant: fleetapi.TemporaryDriverGrantStateEnded, CompletedAt: new(at(19, 0)), Revision: 3,
				Changed: true, GrantUntil: new(at(19, 0)), GrantChange: true}},
		{"отозван — ended", Transfer{Status: StatusRevoked, Period: period, Revision: 3, Person: driver, Grant: true, CompletedAt: new(at(15, 0))}, at(16, 0),
			Settled{Status: StatusRevoked, Grant: fleetapi.TemporaryDriverGrantStateEnded, CompletedAt: new(at(15, 0)), Revision: 3}},
	} {
		got := Settle(c.x, c.now)
		if !sameSettled(got, c.want) {
			t.Errorf("%s:\n got  %s\n want %s", c.name, got, c.want)
		}
	}
}

func sameTime(a, b *time.Time) bool { return (a == nil) == (b == nil) && (a == nil || a.Equal(*b)) }

func sameSettled(a, b Settled) bool {
	return a.Status == b.Status && a.Grant == b.Grant && a.Revision == b.Revision && a.Changed == b.Changed &&
		a.GrantChange == b.GrantChange && a.Unassign == b.Unassign && sameTime(a.CompletedAt, b.CompletedAt) &&
		sameTime(a.GrantUntil, b.GrantUntil)
}

// Курсор привязан к фильтрам и участнику: чужой курсор — 400 (DriverTransferPage, DriverPoolPublicationPage).
func TestCursor(t *testing.T) {
	t.Parallel()
	c := encodeCursor("f1", "2026-10-01T10:00:00Z", "id-1")
	keys, err := decodeCursor(c, "f1", 2)
	if err != nil || len(keys) != 2 || keys[0] != "2026-10-01T10:00:00Z" || keys[1] != "id-1" {
		t.Fatalf("decode: %v %v", keys, err)
	}
	if _, err := decodeCursor(c, "f2", 2); err == nil {
		t.Fatal("a cursor of other filters: no error")
	}
	if _, err := decodeCursor("%%%", "f1", 2); err == nil {
		t.Fatal("a malformed cursor: no error")
	}
}
