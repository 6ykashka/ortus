//go:build integration

package spa_test

import (
	"sync"
	"testing"

	"github.com/google/uuid"

	api "github.com/ortus/ortus-crm/backend/internal/api/spa"
	"github.com/ortus/ortus-crm/backend/internal/modules/spa" //nolint:depguard // the package under test
)

// A visit holds the practitioner, the room and the equipment for the window grown by the buffers of the service, as one
// booking of the calendar; the next visit may start when the cleaning of the room ends and not a minute earlier.
func TestBookingHoldsAllResourcesWithBuffers(t *testing.T) { //nolint:gocyclo // one scenario of one booking
	t.Parallel()
	ctx, own, d := t.Context(), owner(t), day()
	room, lamp := resource(t, "room", unit("msk1")), resource(t, "equipment", unit("msk1"))
	svc := treatment(t, own, nil)

	a := book(t, own, booking(svc, person("a.driver-msk1"), room, []uuid.UUID{lamp}, clock(d, 10, 0)))
	if a.Status != api.AppointmentStatusConfirmed || a.Revision != 1 || a.ServiceRevision != 1 ||
		!a.Window.StartsAt.Equal(clock(d, 10, 0)) || !a.Window.EndsAt.Equal(clock(d, 11, 0)) || a.Window.TimeZone != "Europe/Moscow" {
		t.Fatalf("appointment: %+v", a)
	}
	if n := superInt(t, `select count(*) from sched.reservations where bundle_id = $1 and state = 'confirmed'`, a.BookingId); n != 3 {
		t.Fatalf("reservations of the booking: %d, want practitioner + room + equipment", n)
	}
	if n := superInt(t, `select count(*) from sched.reservations where bundle_id = $1 and occupied = tstzrange($2, $3, '[)') and during = tstzrange($4, $5, '[)')`,
		a.BookingId, clock(d, 9, 55), clock(d, 11, 15), clock(d, 10, 0), clock(d, 11, 0)); n != 3 {
		t.Fatalf("occupied is the window ± buffers for every resource: %d of 3", n)
	}
	var kind string
	var prep, cleanup int
	if err := superA.QueryRow(t.Context(), `select source_kind, prep_minutes, cleanup_minutes from sched.bookings where id = $1`, a.BookingId).
		Scan(&kind, &prep, &cleanup); err != nil || kind != "appointment" || prep != 5 || cleanup != 15 {
		t.Fatalf("booking: %s %d %d %v", kind, prep, cleanup, err)
	}

	// Another practitioner in the same room: the cleaning still holds the room until 11:15.
	other := person("a.manager-msk2")
	_, err := e.svc.CreateAppointment(ctx, own, booking(svc, other, room, nil, clock(d, 11, 10)))
	f := wantRefusal(t, err, "resources_unavailable", "", "")
	if len(f.Fields) != 1 || f.Fields[0] != "roomId" {
		t.Fatalf("taken fields: %v, want only roomId", f.Fields)
	}
	// The same practitioner in another room, the equipment is free: the practitioner is the busy one.
	_, err = e.svc.CreateAppointment(ctx, own, booking(svc, person("a.driver-msk1"), resource(t, "room", unit("msk1")), []uuid.UUID{lamp}, clock(d, 10, 30)))
	f = wantRefusal(t, err, "resources_unavailable", "", "")
	if len(f.Fields) != 2 || f.Fields[0] != "practitionerMemberId" || f.Fields[1] != "equipmentIds[0]" {
		t.Fatalf("taken fields: %v", f.Fields)
	}
	// Nothing of the refused requests is left.
	if n := superInt(t, `select count(*) from spa.appointments where service_id = $1`, svc.Id); n != 1 {
		t.Fatalf("appointments after refusals: %d", n)
	}
	// At 11:15 sharp the room is free.
	book(t, own, booking(svc, other, room, nil, clock(d, 11, 20))) // preparation 11:15
}

func TestBookingValidation(t *testing.T) {
	t.Parallel()
	ctx, own, d := t.Context(), owner(t), day()
	room := resource(t, "room", unit("msk1"))
	svc := treatment(t, own, nil)
	prac := person("a.driver-msk1")

	cases := []struct {
		name  string
		edit  func(*api.AppointmentCreate)
		field string
	}{
		{"unknown service", func(b *api.AppointmentCreate) { b.ServiceId = uuid.New() }, "serviceId"},
		{"unknown room", func(b *api.AppointmentCreate) { b.RoomId = uuid.New() }, "roomId"},
		{"an equipment item is not a room", func(b *api.AppointmentCreate) { b.RoomId = resource(t, "equipment", unit("msk1")) }, "roomId"},
		{"a room of another unit", func(b *api.AppointmentCreate) { b.RoomId = resource(t, "room", unit("msk2")) }, "roomId"},
		{"unknown practitioner", func(b *api.AppointmentCreate) { b.PractitionerMemberId = uuid.New() }, "practitionerMemberId"},
		{"equipment the service does not need is still equipment", func(b *api.AppointmentCreate) { b.EquipmentIds = []uuid.UUID{uuid.New()} }, "equipmentIds[0]"},
		{"time zone", func(b *api.AppointmentCreate) { b.TimeZone = "Mars/Base" }, "timeZone"},
		{"before the working day", func(b *api.AppointmentCreate) { b.StartsAt = clock(d, 8, 0) }, "startsAt"},  // the preparation starts at 07:55
		{"after the working day", func(b *api.AppointmentCreate) { b.StartsAt = clock(d, 19, 30) }, "startsAt"}, // the cleaning ends at 20:45
		{"unit", func(b *api.AppointmentCreate) { b.OrgUnitId = unit("msk2") }, "orgUnitId"},
	}
	for _, c := range cases {
		b := booking(svc, prac, room, nil, clock(d, 12, 0))
		c.edit(&b)
		_, err := e.svc.CreateAppointment(ctx, own, b)
		wantRefusal(t, err, "validation_failed", "", c.field)
		_ = c.name
	}
	// The equipment the service needs must be booked with the visit.
	needs := treatment(t, own, []uuid.UUID{resource(t, "equipment", unit("msk1"))})
	_, err := e.svc.CreateAppointment(ctx, own, booking(needs, prac, room, nil, clock(d, 12, 0)))
	wantRefusal(t, err, "validation_failed", "", "equipmentIds")
	if n := superInt(t, `select count(*) from spa.appointments where service_id = $1`, svc.Id); n != 0 {
		t.Fatalf("appointments after refusals: %d", n)
	}
}

// Six requests for one room at one time: the database serializes them and exactly one visit is booked (AC-03).
func TestBookingRaceOneWinner(t *testing.T) {
	t.Parallel()
	own, d := owner(t), day()
	room := resource(t, "room", unit("msk1"))
	svc := treatment(t, own, nil)
	pracs := []string{"a.driver-msk1", "a.driver-msk2", "a.manager-msk2", "a.owner", "a.project-lead", "a.driver-earnings"}

	var (
		wg      sync.WaitGroup
		mu      sync.Mutex
		success int
		refused int
	)
	for _, p := range pracs {
		wg.Go(func() {
			_, err := e.svc.CreateAppointment(t.Context(), own, booking(svc, person(p), room, nil, clock(d, 14, 0)))
			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				success++
			} else if f, ok := asRefusal(err); ok && f.Code == "resources_unavailable" {
				refused++
			} else {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
	wg.Wait()
	if success != 1 || refused != len(pracs)-1 {
		t.Fatalf("success=%d refused=%d, want 1 and %d", success, refused, len(pracs)-1)
	}
	if n := superInt(t, `select count(*) from spa.appointments where service_id = $1`, svc.Id); n != 1 {
		t.Fatalf("appointments: %d", n)
	}
}

func asRefusal(err error) (*spa.RefusalError, bool) {
	f, ok := err.(*spa.RefusalError) //nolint:errorlint // the service returns the refusal itself
	return f, ok
}

// A move re-reserves every resource with the buffers: the old interval is free afterwards, a conflict leaves the visit
// where it was, and it needs the revision.
func TestReschedule(t *testing.T) { //nolint:gocyclo // one scenario of one visit
	t.Parallel()
	ctx, own, d := t.Context(), owner(t), day()
	room, lamp := resource(t, "room", unit("msk1")), resource(t, "equipment", unit("msk1"))
	svc := treatment(t, own, nil)
	prac, other := person("a.driver-msk1"), person("a.manager-msk2")

	a := book(t, own, booking(svc, prac, room, []uuid.UUID{lamp}, clock(d, 10, 0)))
	blocker := book(t, own, booking(svc, other, room, nil, clock(d, 13, 0))) // the room from 12:55 to 14:15

	_, err := e.svc.Reschedule(ctx, own, a.Id, "", api.AppointmentReschedule{StartsAt: clock(d, 16, 0), TimeZone: "Europe/Moscow"})
	wantProblem(t, err, "revision_required")
	_, err = e.svc.Reschedule(ctx, own, a.Id, `"rev-7"`, api.AppointmentReschedule{StartsAt: clock(d, 16, 0), TimeZone: "Europe/Moscow"})
	wantProblem(t, err, "revision_mismatch")

	_, err = e.svc.Reschedule(ctx, own, a.Id, tag(a), api.AppointmentReschedule{StartsAt: clock(d, 13, 30), TimeZone: "Europe/Moscow"})
	f := wantRefusal(t, err, "resources_unavailable", "", "")
	if len(f.Fields) == 0 || f.Fields[0] != "roomId" {
		t.Fatalf("taken fields: %v", f.Fields)
	}
	still := must(e.svc.GetAppointment(ctx, own, a.Id))
	if !still.Window.StartsAt.Equal(clock(d, 10, 0)) || still.Revision != 1 {
		t.Fatalf("a refused move changed the visit: %+v", still)
	}

	moved := must(e.svc.Reschedule(ctx, own, a.Id, tag(a), api.AppointmentReschedule{StartsAt: clock(d, 16, 0), TimeZone: "Europe/Moscow"}))
	if !moved.Window.StartsAt.Equal(clock(d, 16, 0)) || !moved.Window.EndsAt.Equal(clock(d, 17, 0)) || moved.Revision != 2 || moved.BookingId != a.BookingId {
		t.Fatalf("moved: %+v", moved)
	}
	if n := superInt(t, `select count(*) from sched.reservations where bundle_id = $1 and state = 'confirmed' and occupied = tstzrange($2, $3, '[)')`,
		a.BookingId, clock(d, 15, 55), clock(d, 17, 15)); n != 3 {
		t.Fatalf("reservations at the new time: %d of 3", n)
	}
	if n := superInt(t, `select count(*) from sched.reservations where bundle_id = $1 and state = 'confirmed'`, a.BookingId); n != 3 {
		t.Fatalf("live reservations after the move: %d (the old ones must be released)", n)
	}
	book(t, own, booking(svc, other, room, nil, clock(d, 10, 0))) // the old time is free for another visit

	// Another room and another practitioner on the same move.
	room2 := resource(t, "room", unit("msk1"))
	again := must(e.svc.Reschedule(ctx, own, a.Id, tag(moved), api.AppointmentReschedule{
		StartsAt: clock(d, 18, 0), TimeZone: "Europe/Moscow", RoomId: &room2, PractitionerMemberId: &other}))
	if again.RoomId != room2 || again.PractitionerMemberId != other || len(again.EquipmentIds) != 1 {
		t.Fatalf("again: %+v", again)
	}
	_ = blocker
}

// Cancelling frees the resources at once; a visit is cancelled once, and only while it is confirmed.
func TestCancel(t *testing.T) {
	t.Parallel()
	ctx, own, d := t.Context(), owner(t), day()
	room := resource(t, "room", unit("msk1"))
	svc := treatment(t, own, nil)
	prac := person("a.driver-msk1")

	a := book(t, own, booking(svc, prac, room, nil, clock(d, 10, 0)))
	_, err := e.svc.Cancel(ctx, own, a.Id, tag(a), api.AppointmentCancel{Reason: "  "})
	wantRefusal(t, err, "validation_failed", "", "reason")
	_, err = e.svc.Cancel(ctx, own, a.Id, "", api.AppointmentCancel{Reason: "перенос"})
	wantProblem(t, err, "revision_required")

	c := must(e.svc.Cancel(ctx, own, a.Id, tag(a), api.AppointmentCancel{Reason: "клиент заболел"}))
	if c.Status != api.AppointmentStatusCancelled || c.Revision != 2 {
		t.Fatalf("cancelled: %+v", c)
	}
	if n := superInt(t, `select count(*) from sched.reservations where bundle_id = $1 and state in ('hold', 'confirmed', 'consumed')`, a.BookingId); n != 0 {
		t.Fatalf("live reservations after the cancel: %d", n)
	}
	var st string
	if err := superA.QueryRow(ctx, `select status from sched.bookings where id = $1`, a.BookingId).Scan(&st); err != nil || st != "cancelled" {
		t.Fatalf("booking: %s %v", st, err)
	}
	_, err = e.svc.Cancel(ctx, own, a.Id, tag(c), api.AppointmentCancel{Reason: "ещё раз"})
	wantRefusal(t, err, "invalid_transition", spa.ReasonNotInStatus, "")
	_, err = e.svc.Reschedule(ctx, own, a.Id, tag(c), api.AppointmentReschedule{StartsAt: clock(d, 12, 0), TimeZone: "Europe/Moscow"})
	wantRefusal(t, err, "invalid_transition", spa.ReasonNotInStatus, "")

	book(t, own, booking(svc, prac, room, nil, clock(d, 10, 0))) // the same slot is free again

	n := book(t, own, booking(svc, prac, room, nil, clock(d, 15, 0)))
	ns := must(e.svc.Cancel(ctx, own, n.Id, tag(n), api.AppointmentCancel{Reason: "не пришла", NoShow: new(true)}))
	if ns.Status != api.AppointmentStatusNoShow {
		t.Fatalf("no show: %+v", ns)
	}
}

// The practitioner with the grant «self» works with his own visits only; the unit grant sees all of them; another
// tenant sees none. A visit of a colleague is as missing (404).
func TestAppointmentScope(t *testing.T) {
	t.Parallel()
	ctx, own, d := t.Context(), owner(t), day()
	room := resource(t, "room", unit("msk1"))
	svc := treatment(t, own, nil)
	mine, theirs := person("a.driver-msk1"), person("a.manager-msk2")
	grant(t, "a.driver-msk1", "self", nil, "spa.appointments.read", "spa.appointments.create", "spa.appointments.perform")
	me := as(t, "a.driver-msk1", "a")

	own1 := book(t, own, booking(svc, mine, room, nil, clock(d, 9, 0)))
	other := book(t, own, booking(svc, theirs, room, nil, clock(d, 12, 0)))

	page := must(e.svc.ListAppointments(ctx, me, spa.AppointmentQuery{PageQuery: spa.PageQuery{Limit: 200}}))
	if len(page.Items) == 0 {
		t.Fatal("the practitioner sees no visits")
	}
	for _, a := range page.Items {
		if a.PractitionerMemberId != mine {
			t.Fatalf("a visit of a colleague in the list: %+v", a)
		}
	}
	must(e.svc.GetAppointment(ctx, me, own1.Id))
	_, err := e.svc.GetAppointment(ctx, me, other.Id)
	wantProblem(t, err, "not_found")
	_, err = e.svc.Cancel(ctx, me, other.Id, tag(other), api.AppointmentCancel{Reason: "чужой"})
	wantProblem(t, err, "not_found")

	// He books himself, not a colleague (a booking for a colleague is outside his scope).
	book(t, me, booking(svc, mine, room, nil, clock(d, 15, 0)))
	_, err = e.svc.CreateAppointment(ctx, me, booking(svc, theirs, room, nil, clock(d, 17, 0)))
	wantProblem(t, err, "not_found")

	// The list of all with the filter of a colleague is empty for him, full for the owner.
	if p := must(e.svc.ListAppointments(ctx, me, spa.AppointmentQuery{Practitioner: &theirs})); len(p.Items) != 0 {
		t.Fatalf("visits of a colleague: %+v", p.Items)
	}
	if p := must(e.svc.ListAppointments(ctx, own, spa.AppointmentQuery{Practitioner: &theirs, PageQuery: spa.PageQuery{Limit: 200}})); len(p.Items) == 0 {
		t.Fatal("the owner sees no visits of a colleague")
	}

	b := as(t, "b.owner", "b")
	_, err = e.svc.GetAppointment(ctx, b, own1.Id)
	wantProblem(t, err, "not_found")
	if p := must(e.svc.ListAppointments(ctx, b, spa.AppointmentQuery{})); len(p.Items) != 0 {
		t.Fatalf("visits of tenant B: %+v", p.Items)
	}
}

func TestListAppointmentsFilters(t *testing.T) {
	t.Parallel()
	ctx, own, d := t.Context(), owner(t), day()
	room := resource(t, "room", unit("msk1"))
	svc := treatment(t, own, nil)
	prac := person("a.driver-msk1")
	morning := book(t, own, booking(svc, prac, room, nil, clock(d, 9, 0)))
	evening := book(t, own, booking(svc, prac, room, nil, clock(d, 17, 0)))
	must(e.svc.Cancel(ctx, own, evening.Id, tag(evening), api.AppointmentCancel{Reason: "x"}))

	list := func(q spa.AppointmentQuery) []api.Appointment {
		q.Limit = 200
		q.Practitioner = &prac
		return must(e.svc.ListAppointments(ctx, own, q)).Items
	}
	from, to := clock(d, 0, 0), clock(d, 23, 59)
	if got := list(spa.AppointmentQuery{From: &from, To: &to}); len(got) != 2 || got[0].Id != morning.Id {
		t.Fatalf("a day: %+v", got) // ordered by the start
	}
	if got := list(spa.AppointmentQuery{From: &from, To: &to, Status: "cancelled"}); len(got) != 1 || got[0].Id != evening.Id {
		t.Fatalf("cancelled: %+v", got)
	}
	noon := clock(d, 12, 0)
	if got := list(spa.AppointmentQuery{From: &noon, To: &to}); len(got) != 1 || got[0].Id != evening.Id {
		t.Fatalf("after noon: %+v", got)
	}
	page := must(e.svc.ListAppointments(ctx, own, spa.AppointmentQuery{PageQuery: spa.PageQuery{Limit: 1}, From: &from, To: &to, Practitioner: &prac}))
	if len(page.Items) != 1 || page.NextCursor == nil {
		t.Fatalf("first page: %+v", page)
	}
	next := must(e.svc.ListAppointments(ctx, own, spa.AppointmentQuery{PageQuery: spa.PageQuery{Limit: 1, Cursor: *page.NextCursor}, From: &from, To: &to, Practitioner: &prac}))
	if len(next.Items) != 1 || next.Items[0].Id == page.Items[0].Id || next.NextCursor != nil {
		t.Fatalf("second page: %+v", next)
	}
}

// The calendar owns the booking: a move made there (updateCalendarBooking) changes the window the visit shows, the list
// by period and the order follow it (Q-W5.20-6).
func TestWindowFollowsTheBooking(t *testing.T) {
	t.Parallel()
	ctx, own, d := t.Context(), owner(t), day()
	svc := treatment(t, own, nil)
	prac := person("a.driver-msk1")
	a := book(t, own, booking(svc, prac, resource(t, "room", unit("msk1")), nil, clock(d, 10, 0)))

	superExec(t, `update sched.bookings set during = tstzrange($2, $3, '[)'), time_zone = 'Europe/Samara' where id = $1`, a.BookingId, clock(d, 15, 0), clock(d, 16, 0))
	got := must(e.svc.GetAppointment(ctx, own, a.Id))
	if !got.Window.StartsAt.Equal(clock(d, 15, 0)) || !got.Window.EndsAt.Equal(clock(d, 16, 0)) || got.Window.TimeZone != "Europe/Samara" {
		t.Fatalf("window after the move in the calendar: %+v", got.Window)
	}
	from, to := clock(d, 14, 30), clock(d, 17, 0)
	page := must(e.svc.ListAppointments(ctx, own, spa.AppointmentQuery{From: &from, To: &to, Practitioner: &prac, PageQuery: spa.PageQuery{Limit: 200}}))
	if len(page.Items) != 1 || page.Items[0].Id != a.Id {
		t.Fatalf("the visit is not found at its new time: %+v", page.Items)
	}
}
