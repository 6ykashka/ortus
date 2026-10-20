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

// settleCase is one story of the settlement: a transfer x at now and what Settle must return.
type settleCase struct {
	name string
	x    Transfer
	now  time.Time
	want Settled
}

var (
	settleDriver = uuid.MustParse("00000000-0000-4000-8000-0000000000d1")
	settleOther  = uuid.MustParse("00000000-0000-4000-8000-0000000000d2")
	settleCar    = uuid.MustParse("00000000-0000-4000-8000-0000000000c1")
	settleWindow = win(14, 18)
)

func settleTrip(state string, by uuid.UUID) *TripState { return &TripState{State: state, Driver: by} }

func settleApproved(tr *TripState, upper *time.Time) Transfer {
	return Transfer{Status: StatusApproved, Period: settleWindow, Revision: 2, Person: settleDriver, Trip: tr, Grant: true,
		GrantUpper: upper}
}

// settleRevoked is a revoked transfer: the revocation of a trip not started revoked its assignment (upper — the
// moment), of a started one left it open (upper nil, live).
func settleRevoked(tr *TripState, at time.Time, upper *time.Time) Transfer {
	return Transfer{Status: StatusRevoked, Period: settleWindow, Revision: 3, Person: settleDriver, Trip: tr, Grant: true,
		GrantUpper: upper, GrantLive: upper == nil, CompletedAt: &at}
}

// Досчёт времени запроса и назначения (Q-W2.51-4, Q-W2.51-15; MSW settlePool, grantStateAt, endOf). W2.57 (Q-W2.07-1):
// рейс начат с on_route; приёмка, отмена и снятие водителя гасят назначение сразу и в окне; отзыв начатого рейса
// оставляет только продолжение (closing, D09); просрочка — closing рейса, который ещё не сдан.
func TestSettle(t *testing.T) {
	t.Parallel()
	end := settleWindow.End
	for _, c := range [][]settleCase{settleRequests(end), settleWindowCases(end), settleClosedTrips(end), settleRevocations()} {
		for _, s := range c {
			if got := Settle(s.x, s.now); !sameSettled(got, s.want) {
				t.Errorf("%s:\n got  %s\n want %s", s.name, got, s.want)
			}
		}
	}
}

func settleRequests(end time.Time) []settleCase {
	open := Transfer{Status: StatusRequested, Period: settleWindow, Revision: 1, Person: settleDriver}
	return []settleCase{
		{"открытый запрос до начала окна", open, at(13, 59), Settled{Status: StatusRequested, Revision: 1}},
		{"открытый запрос к началу окна истекает", open, at(14, 0), Settled{Status: StatusExpired, Revision: 2, Changed: true}},
		{"отклонённый не меняется", Transfer{Status: StatusRejected, Period: settleWindow, Revision: 2, Person: settleDriver},
			at(19, 0), Settled{Status: StatusRejected, Revision: 2}},
		{"одобрен, до окна — scheduled", settleApproved(settleTrip(tripPlanned, settleDriver), &end), at(13, 0),
			Settled{Status: StatusApproved, Grant: fleetapi.TemporaryDriverGrantStateScheduled, Revision: 2, GrantUntil: &end,
				VehicleUntil: &end}},
		{"без рейса к концу окна — completed", settleApproved(nil, &end), at(18, 30),
			Settled{Status: StatusCompleted, Grant: fleetapi.TemporaryDriverGrantStateEnded, CompletedAt: &end, Revision: 3,
				Changed: true, GrantUntil: &end, EndedAt: &end, VehicleUntil: &end}},
	}
}

func settleWindowCases(end time.Time) []settleCase {
	withCar := &TripState{State: tripAssigned, Driver: settleDriver, Vehicle: settleCar}
	return []settleCase{
		{"одобрен, в окне — active", settleApproved(settleTrip(tripPlanned, settleDriver), &end), at(15, 0),
			Settled{Status: StatusApproved, Grant: fleetapi.TemporaryDriverGrantStateActive, Revision: 2, GrantUntil: &end,
				VehicleUntil: &end}},
		{"у рейса машина — в окне она открыта до конца окна", settleApproved(withCar, &end), at(15, 0),
			Settled{Status: StatusApproved, Grant: fleetapi.TemporaryDriverGrantStateActive, Revision: 2, GrantUntil: &end,
				Vehicle: settleCar, VehicleUntil: &end}},
		{"осмотр перед выездом — рейс не начат, грант до конца окна", settleApproved(settleTrip("inspection", settleDriver), &end),
			at(15, 0), Settled{Status: StatusApproved, Grant: fleetapi.TemporaryDriverGrantStateActive, Revision: 2,
				GrantUntil: &end, VehicleUntil: &end}},
		{"рейс начат — грант открыт до приёмки", settleApproved(settleTrip("on_route", settleDriver), &end), at(15, 0),
			Settled{Status: StatusApproved, Grant: fleetapi.TemporaryDriverGrantStateActive, Revision: 2, GrantChange: true,
				VehicleUntil: &end}},
		{"рейс вернули в план — грант снова до конца окна", settleApproved(settleTrip(tripPlanned, settleDriver), nil), at(15, 0),
			Settled{Status: StatusApproved, Grant: fleetapi.TemporaryDriverGrantStateActive, Revision: 2, GrantUntil: &end,
				GrantChange: true, VehicleUntil: &end}},
		{"начатый рейс после окна — closing, просрочка", settleApproved(settleTrip("on_route", settleDriver), nil), at(19, 0),
			Settled{Status: StatusApproved, Grant: fleetapi.TemporaryDriverGrantStateClosing, Revision: 2, Overdue: true,
				VehicleUntil: &end}},
		{"сданный рейс после окна — closing без просрочки", settleApproved(settleTrip("submitted", settleDriver), nil), at(19, 0),
			Settled{Status: StatusApproved, Grant: fleetapi.TemporaryDriverGrantStateClosing, Revision: 2, VehicleUntil: &end}},
		{"доработка после окна — closing, просрочка", settleApproved(settleTrip("rework", settleDriver), nil), at(20, 0),
			Settled{Status: StatusApproved, Grant: fleetapi.TemporaryDriverGrantStateClosing, Revision: 2, Overdue: true,
				VehicleUntil: &end}},
		{"машина начатого рейса после окна закрыта концом окна",
			settleApproved(&TripState{State: "returning", Driver: settleDriver, Vehicle: settleCar}, nil), at(19, 0),
			Settled{Status: StatusApproved, Grant: fleetapi.TemporaryDriverGrantStateClosing, Revision: 2, Overdue: true,
				VehicleUntil: &end}},
		{"не начатый рейс к концу окна — completed, водитель снят", settleApproved(settleTrip(tripAssigned, settleDriver), &end),
			at(18, 0), Settled{Status: StatusCompleted, Grant: fleetapi.TemporaryDriverGrantStateEnded, CompletedAt: &end,
				Revision: 3, Changed: true, GrantUntil: &end, EndedAt: &end, Unassign: true, VehicleUntil: &end}},
		{"осмотр перед выездом к концу окна — completed, бронь держит водителя",
			settleApproved(settleTrip("defect_review", settleDriver), &end), at(18, 0),
			Settled{Status: StatusCompleted, Grant: fleetapi.TemporaryDriverGrantStateEnded, CompletedAt: &end, Revision: 3,
				Changed: true, GrantUntil: &end, EndedAt: &end, VehicleUntil: &end}},
		{"рейс у другого водителя после окна — completed концом окна", settleApproved(settleTrip("on_route", settleOther), &end),
			at(18, 0), Settled{Status: StatusCompleted, Grant: fleetapi.TemporaryDriverGrantStateEnded, CompletedAt: &end,
				Revision: 3, Changed: true, GrantUntil: &end, EndedAt: &end, VehicleUntil: &end}},
	}
}

func settleClosedTrips(end time.Time) []settleCase {
	accepted := func(h, m int) *TripState {
		return &TripState{State: tripAccepted, Driver: settleDriver, AcceptedAt: new(at(h, m))}
	}
	return []settleCase{
		{"принят в окне — completed моментом приёмки сразу", settleApproved(accepted(16, 0), nil), at(16, 30),
			Settled{Status: StatusCompleted, Grant: fleetapi.TemporaryDriverGrantStateEnded, CompletedAt: new(at(16, 0)),
				Revision: 3, Changed: true, GrantUntil: new(at(16, 0)), GrantChange: true, EndedAt: new(at(16, 0)),
				VehicleUntil: new(at(16, 0))}},
		{"принят после окна — completedAt = приёмка", settleApproved(accepted(19, 30), nil), at(19, 31),
			Settled{Status: StatusCompleted, Grant: fleetapi.TemporaryDriverGrantStateEnded, CompletedAt: new(at(19, 30)),
				Revision: 3, Changed: true, GrantUntil: new(at(19, 30)), GrantChange: true, EndedAt: new(at(19, 30)),
				VehicleUntil: &end}},
		{"отменён в окне — закрыт моментом досчёта", settleApproved(settleTrip(tripCancelled, settleDriver), &end), at(15, 0),
			Settled{Status: StatusCompleted, Grant: fleetapi.TemporaryDriverGrantStateEnded, CompletedAt: new(at(15, 0)),
				Revision: 3, Changed: true, GrantUntil: new(at(15, 0)), GrantChange: true, EndedAt: new(at(15, 0)),
				VehicleUntil: new(at(15, 0))}},
		{"отменён после окна — закрыт моментом досчёта", settleApproved(settleTrip(tripCancelled, settleDriver), nil), at(19, 0),
			Settled{Status: StatusCompleted, Grant: fleetapi.TemporaryDriverGrantStateEnded, CompletedAt: new(at(19, 0)),
				Revision: 3, Changed: true, GrantUntil: new(at(19, 0)), GrantChange: true, EndedAt: new(at(19, 0)),
				VehicleUntil: &end}},
		{"водителя сняли с рейса в окне — completed моментом досчёта (Q-W2.07-14)",
			settleApproved(settleTrip(tripAssigned, settleOther), &end), at(15, 0),
			Settled{Status: StatusCompleted, Grant: fleetapi.TemporaryDriverGrantStateEnded, CompletedAt: new(at(15, 0)),
				Revision: 3, Changed: true, GrantUntil: new(at(15, 0)), GrantChange: true, EndedAt: new(at(15, 0)),
				VehicleUntil: new(at(15, 0))}},
		{"водителя сняли до окна — грант пуст (граница — начало окна)", settleApproved(&TripState{State: tripPlanned}, &end),
			at(12, 0), Settled{Status: StatusCompleted, Grant: fleetapi.TemporaryDriverGrantStateEnded, CompletedAt: new(at(12, 0)),
				Revision: 3, Changed: true, GrantUntil: new(at(14, 0)), GrantChange: true, EndedAt: new(at(12, 0)),
				VehicleUntil: new(at(14, 0))}},
	}
}

func settleRevocations() []settleCase {
	revokedAt := at(15, 0)
	return []settleCase{
		{"отозван, рейс не начат — ended", settleRevoked(settleTrip(tripAssigned, uuid.Nil), revokedAt, &revokedAt), at(16, 0),
			Settled{Status: StatusRevoked, Grant: fleetapi.TemporaryDriverGrantStateEnded, CompletedAt: &revokedAt, Revision: 3,
				GrantUntil: &revokedAt, EndedAt: &revokedAt, VehicleUntil: &revokedAt}},
		{"отозван без рейса — ended", settleRevoked(nil, revokedAt, &revokedAt), at(16, 0),
			Settled{Status: StatusRevoked, Grant: fleetapi.TemporaryDriverGrantStateEnded, CompletedAt: &revokedAt, Revision: 3,
				GrantUntil: &revokedAt, EndedAt: &revokedAt, VehicleUntil: &revokedAt}},
		{"отозван начатый рейс — продолжение (closing), просрочка",
			settleRevoked(settleTrip("on_route", settleDriver), revokedAt, nil), at(16, 0),
			Settled{Status: StatusRevoked, Grant: fleetapi.TemporaryDriverGrantStateClosing, CompletedAt: &revokedAt, Revision: 3,
				Overdue: true, VehicleUntil: &revokedAt}},
		{"отозван сданный рейс — продолжение без просрочки", settleRevoked(settleTrip("submitted", settleDriver), revokedAt, nil),
			at(19, 0), Settled{Status: StatusRevoked, Grant: fleetapi.TemporaryDriverGrantStateClosing, CompletedAt: &revokedAt,
				Revision: 3, VehicleUntil: &revokedAt}},
		{"продолжение отозванного кончилось приёмкой — ended моментом приёмки",
			settleRevoked(&TripState{State: tripAccepted, Driver: settleDriver, AcceptedAt: new(at(17, 0))}, revokedAt, nil),
			at(17, 30), Settled{Status: StatusRevoked, Grant: fleetapi.TemporaryDriverGrantStateEnded, CompletedAt: &revokedAt,
				Revision: 3, GrantUntil: new(at(17, 0)), GrantChange: true, EndedAt: new(at(17, 0)), VehicleUntil: &revokedAt}},
		{"продолжение отозванного: водителя сняли — ended моментом досчёта",
			settleRevoked(settleTrip("returning", settleOther), revokedAt, nil), at(17, 30),
			Settled{Status: StatusRevoked, Grant: fleetapi.TemporaryDriverGrantStateEnded, CompletedAt: &revokedAt, Revision: 3,
				GrantUntil: new(at(17, 30)), GrantChange: true, EndedAt: new(at(17, 30)), VehicleUntil: &revokedAt}},
		{"продолжение отозванного закрыто приёмкой (записано) — ended моментом приёмки",
			Transfer{Status: StatusRevoked, Period: settleWindow, Revision: 3, Person: settleDriver, Grant: true, GrantLive: true,
				GrantUpper: new(at(17, 0)), CompletedAt: &revokedAt, Trip: &TripState{State: tripAccepted, Driver: settleDriver}},
			at(18, 0), Settled{Status: StatusRevoked, Grant: fleetapi.TemporaryDriverGrantStateEnded, CompletedAt: &revokedAt,
				Revision: 3, GrantUntil: new(at(17, 0)), EndedAt: new(at(17, 0)), VehicleUntil: &revokedAt}},
		{"отозван до начала окна — назначение пусто, ended моментом отзыва",
			Transfer{Status: StatusRevoked, Period: settleWindow, Revision: 3, Person: settleDriver, Grant: true,
				CompletedAt: new(at(12, 0))}, at(16, 0),
			Settled{Status: StatusRevoked, Grant: fleetapi.TemporaryDriverGrantStateEnded, CompletedAt: new(at(12, 0)),
				Revision: 3, EndedAt: new(at(12, 0)), VehicleUntil: new(at(12, 0))}},
		{"завершён — ended, ничего не пишет", Transfer{Status: StatusCompleted, Period: settleWindow, Revision: 3,
			Person: settleDriver, Grant: true, GrantUpper: new(at(18, 0)), CompletedAt: new(at(18, 0))}, at(19, 0),
			Settled{Status: StatusCompleted, Grant: fleetapi.TemporaryDriverGrantStateEnded, CompletedAt: new(at(18, 0)),
				Revision: 3, GrantUntil: new(at(18, 0)), EndedAt: new(at(18, 0)), VehicleUntil: new(at(18, 0))}},
	}
}

func sameTime(a, b *time.Time) bool { return (a == nil) == (b == nil) && (a == nil || a.Equal(*b)) }

func sameSettled(a, b Settled) bool {
	return a.Status == b.Status && a.Grant == b.Grant && a.Revision == b.Revision && a.Changed == b.Changed &&
		a.GrantChange == b.GrantChange && a.Unassign == b.Unassign && sameTime(a.CompletedAt, b.CompletedAt) &&
		sameTime(a.GrantUntil, b.GrantUntil) && a.Overdue == b.Overdue && sameTime(a.EndedAt, b.EndedAt) &&
		a.Vehicle == b.Vehicle && sameTime(a.VehicleUntil, b.VehicleUntil)
}

// Продолжение начатого рейса после окна или отзыва (D09, бриф W2.57 §2 п. 4): только сдача, осмотр сдачи, расходы и
// фото этого рейса и чтение их; новые рейсы, бронь, старт, осмотр выезда и решения менеджера — нет.
func TestContinues(t *testing.T) {
	t.Parallel()
	allowed := []string{"getTrip", "getTripPlan", "finishTripRoute", "returnTrip", "getInspection", "getInspectionDefect",
		"listTripExpenses", "createTripExpense", "getTripExpense"}
	for _, op := range allowed {
		if !Continues(op, "") {
			t.Errorf("%s: refused in the continuation, want allowed (D09)", op)
		}
	}
	for _, op := range []string{"startTrip", "reserveVehicle", "getReservation", "releaseReservation", "assignTripVehicle",
		"reviewTrip", "reviewInspection", "reviewTripExpense", "decideInspectionDefect", "assignInspectionDefect", "unknown"} {
		if Continues(op, "") {
			t.Errorf("%s: allowed in the continuation, want 404 (new work, D09)", op)
		}
	}
	if !Continues("submitInspection", kindReturn) || Continues("submitInspection", kindDeparture) {
		t.Error("submitInspection: only the return inspection continues the trip")
	}
}

// Продление (решение extend): новый конец позже нынешнего и сейчас, внутри свободного окна публикации; начало окна не
// двигается.
func TestExtension(t *testing.T) {
	t.Parallel()
	period, free := win(14, 18), win(13, 20)
	for _, c := range []struct {
		name  string
		until time.Time
		now   time.Time
		text  string
	}{
		{"до 19:00", at(19, 0), at(12, 0), ""},
		{"в closing — после конца окна", at(20, 0), at(18, 30), ""},
		{"не позже нынешнего конца", at(18, 0), at(12, 0), textWindow},
		{"раньше нынешнего конца", at(17, 0), at(12, 0), textWindow},
		{"уже прошло", at(19, 0), at(19, 30), textWindowPast},
		{"вне свободного окна", at(21, 0), at(12, 0), textOutside},
	} {
		got, err := Extension(period, free, c.until, c.now)
		switch {
		case c.text == "" && (err != nil || got != (Window{Start: period.Start, End: c.until})):
			t.Errorf("%s: %v %v, want [%v, %v)", c.name, got, err, period.Start, c.until)
		case c.text != "" && (err == nil || err.Error() != c.text):
			t.Errorf("%s: %v, want %q", c.name, err, c.text)
		}
	}
}

// Роль «Временный водитель» (решение Q-W2.07-1): действия рейса, без задач, базы знаний, календаря, начислений, создания
// и снятия броней; машина — в области resource. Совпадение с api/permissions.yaml — cmd/api TestTemporaryDriverTemplate.
// W2.71 (0.6.3-stage2, S2-20): + fleet.reservations.choose — выбор из предложенных броней своего рейса.
func TestTemporaryDriverActions(t *testing.T) {
	t.Parallel()
	if len(TemporaryDriverActions) != 13 {
		t.Fatalf("%d actions %v, want 13", len(TemporaryDriverActions), TemporaryDriverActions)
	}
	for _, a := range TemporaryDriverActions {
		for _, banned := range []string{"tasks.", "knowledge.", "calendar.", "fleet.earnings.", "fleet.reservations.create",
			"fleet.reservations.manage", "fleet.driver_transfers."} {
			if len(a) >= len(banned) && a[:len(banned)] == banned {
				t.Errorf("%s in the role «Временный водитель»", a)
			}
		}
	}
	if len(TemporaryDriverResourceActions) != 1 || TemporaryDriverResourceActions[0] != "fleet.vehicles.read" {
		t.Errorf("resource actions %v, want [fleet.vehicles.read]", TemporaryDriverResourceActions)
	}
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
