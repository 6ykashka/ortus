//go:build integration

package calendar

import (
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	calendarapi "github.com/ortus/ortus-crm/backend/internal/api/calendar"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: the clock of the suites
)

func names(page calendarapi.CalendarResourcePage) []string {
	out := []string{}
	for _, r := range page.Items {
		out = append(out, r.Name)
	}
	return out
}

func titles(page calendarapi.BookingPage) []string {
	out := []string{}
	for _, b := range page.Items {
		out = append(out, b.Title)
	}
	return out
}

func lock(b calendarapi.Booking) string {
	if b.RescheduleLock == nil {
		return ""
	}
	return string(*b.RescheduleLock)
}

func locks(page calendarapi.BookingPage) map[string]string {
	out := map[string]string{}
	for _, b := range page.Items {
		out[b.Title] = lock(b)
	}
	return out
}

func resourceIDs(b calendarapi.Booking) []uuid.UUID {
	out := []uuid.UUID{}
	for _, r := range b.Resources {
		out = append(out, r.ResourceId)
	}
	return out
}

func code(err error) string {
	if fe, ok := asFields(err); ok {
		return fe.code
	}
	return problemCode(err)
}

func detail(err error) string {
	if fe, ok := asFields(err); ok {
		return fe.detail
	}
	if e, ok := errors.AsType[*problem.Error](err); ok {
		return e.Detail
	}
	return ""
}

func inUnit(u uuid.UUID) ResourceQuery { return ResourceQuery{OrgUnit: &u} }

// listCalendarResources: the rows of the calendar by kind and label; vehicles only with «Логистика» and
// fleet.vehicles.read; an inactive resource only while it holds a future booking.
func TestResourcesOfOwner(t *testing.T) {
	t.Parallel()
	ctx, owner := t.Context(), as(t, "a.owner")
	page, err := service(spaOnly).Resources(ctx, owner, inUnit(unit("msk1")))
	require.NoError(t, err)
	assert.Equal(t, []string{"Анна Морозова · массажист", "Водитель Москва-1", "Кабинет № 2", "Кабинет № 3", "Кабинет № 8",
		"Стол с подогревом"}, names(page), "no vehicle without «Логистика»; Кабинет № 9 is inactive and free")
	page, err = service(withFleet).Resources(ctx, owner, inUnit(unit("msk1")))
	require.NoError(t, err)
	require.Equal(t, "ИЗ-101", page.Items[0].Name, "the vehicle first, its label from the plate")
	van := page.Items[0]
	assert.Equal(t, calendarapi.CalendarResourceKindVehicle, van.Kind)
	require.NotNil(t, van.Object)
	assert.Equal(t, calendarapi.ObjectRef{ModuleKey: "fleet", EntityType: "vehicle", EntityId: ref("vehicle:a.msk1")}, *van.Object)
	assert.Equal(t, unit("msk1"), van.OrgUnitId)
	assert.Equal(t, "Europe/Moscow", van.TimeZone)
	assert.Equal(t, calendarapi.CalendarWorkday{Start: "08:00", End: "20:00"}, van.Workday)
	anna := page.Items[1]
	assert.Equal(t, calendarapi.CalendarResourceKindMember, anna.Kind)
	assert.Equal(t, calendarapi.ObjectRef{ModuleKey: "core", EntityType: "member", EntityId: person("ab.member")}, *anna.Object)
	room8 := page.Items[5]
	assert.Equal(t, "Кабинет № 8", room8.Name)
	assert.False(t, room8.Active)
	assert.Nil(t, room8.Object)
	kind := "room"
	page, err = service(withFleet).Resources(ctx, owner, ResourceQuery{Kind: &kind, OrgUnit: new(unit("msk"))})
	require.NoError(t, err)
	assert.Subset(t, names(page), []string{"Кабинет № 2", "Кабинет № 3", "Кабинет № 8", "Переговорная Москвы-2"},
		"the region with its firms")
	for _, r := range page.Items {
		assert.Equal(t, calendarapi.CalendarResourceKindRoom, r.Kind, r.Name)
	}
}

func TestResourcesByScope(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	page, err := service(withFleet).Resources(ctx, as(t, "a.manager-msk2"), ResourceQuery{})
	require.NoError(t, err)
	assert.Equal(t, []string{"Переговорная Москвы-2"}, names(page), "Москва-2 only")
	page, err = service(withFleet).Resources(ctx, as(t, "a.manager-msk1"), ResourceQuery{})
	require.NoError(t, err)
	assert.Equal(t, []string{"ИЗ-101", "Анна Морозова · массажист", "Водитель Москва-1", "Кабинет № 2", "Кабинет № 3",
		"Кабинет № 8", "Стол с подогревом"}, names(page))
	// Self: the own resource and the resources booked together with it in live bookings not finished before today.
	page, err = service(withFleet).Resources(ctx, as(t, "ab.member"), ResourceQuery{})
	require.NoError(t, err)
	assert.Equal(t, []string{"Анна Морозова · массажист", "Кабинет № 2", "Стол с подогревом"}, names(page))
}

func TestResourcesPages(t *testing.T) {
	t.Parallel()
	ctx, owner := t.Context(), as(t, "a.owner")
	q := inUnit(unit("msk1"))
	q.Limit = new(4)
	first, err := service(spaOnly).Resources(ctx, owner, q)
	require.NoError(t, err)
	require.Len(t, first.Items, 4)
	require.NotNil(t, first.NextCursor)
	q.Cursor = first.NextCursor
	second, err := service(spaOnly).Resources(ctx, owner, q)
	require.NoError(t, err)
	assert.Equal(t, []string{"Кабинет № 8", "Стол с подогревом"}, names(second))
	assert.Nil(t, second.NextCursor)
	_, err = service(spaOnly).Resources(ctx, owner, ResourceQuery{Cursor: first.NextCursor})
	assert.Equal(t, problem.CodeMalformedRequest, code(err), "a cursor of other filters")
	kind := "person"
	_, err = service(spaOnly).Resources(ctx, owner, ResourceQuery{Kind: &kind})
	assert.Equal(t, problem.CodeMalformedRequest, code(err))
}

// listCalendarBookings of the day: the visits and the break with the buffers; the trip and the maintenance only with
// «Логистика»; rescheduleLock for the member.
func TestBookingsOfDay(t *testing.T) {
	t.Parallel()
	ctx, owner := t.Context(), as(t, "a.owner")
	page, err := service(spaOnly).Bookings(ctx, owner, BookingQuery{})
	require.NoError(t, err)
	assert.Equal(t, []string{"Встреча Москвы-2", "Классический массаж · Мария К.", "SPA-ритуал · Ольга Р.", "Перерыв",
		"Массаж спины · Екатерина Л.", "Совместная встреча"}, titles(page))
	a2 := page.Items[2]
	assert.Equal(t, shared.a2, a2.Id)
	assert.Equal(t, int64(1), a2.Revision)
	assert.Equal(t, calendarapi.Confirmed, a2.Status)
	assert.Equal(t, 15, *a2.PrepMinutes)
	assert.Equal(t, 15, *a2.CleanupMinutes)
	assert.True(t, a2.Window.StartsAt.Equal(at(1, 11, 30)))
	assert.Equal(t, "Europe/Moscow", a2.Window.TimeZone)
	assert.True(t, a2.Occupied.StartsAt.Equal(at(1, 11, 15)) && a2.Occupied.EndsAt.Equal(at(1, 13, 15)))
	assert.Equal(t, calendarapi.Appointment, *a2.SourceKind)
	assert.Equal(t, "spa", a2.RelatedObject.ModuleKey)
	assert.Equal(t, []uuid.UUID{shared.anna, shared.room2, shared.table}, resourceIDs(a2))
	assert.Equal(t, calendarapi.ResourceSelectionKindMember, a2.Resources[0].Kind)
	assert.Equal(t, map[string]string{"Встреча Москвы-2": "", "Классический массаж · Мария К.": "", "SPA-ритуал · Ольга Р.": "",
		"Перерыв": "specialist_schedule", "Массаж спины · Екатерина Л.": "", "Совместная встреча": ""}, locks(page))

	page, err = service(withFleet).Bookings(ctx, owner, BookingQuery{})
	require.NoError(t, err)
	assert.Equal(t, []string{"Плановое ТО", "Рейс TR-1", "Встреча Москвы-2", "Классический массаж · Мария К.",
		"SPA-ритуал · Ольга Р.", "Перерыв", "Массаж спины · Екатерина Л.", "Совместная встреча"}, titles(page))
	trip, to := page.Items[1], page.Items[0]
	assert.Equal(t, sharedTrip, trip.Id)
	assert.Equal(t, calendarapi.Trip, *trip.SourceKind)
	assert.Equal(t, "source_module", lock(trip))
	assert.Equal(t, calendarapi.ObjectRef{ModuleKey: "fleet", EntityType: "trip", EntityId: tripOf(t)}, *trip.RelatedObject)
	assert.Equal(t, []uuid.UUID{sharedDriver}, resourceIDs(trip))
	assert.Equal(t, "vehicle_card", lock(to))
	assert.Equal(t, calendarapi.Maintenance, *to.SourceKind)
}

func tripOf(t *testing.T) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	require.NoError(t, superA.QueryRow(t.Context(), `select id from fleet.trips where number = 'TR-1'`).Scan(&id))
	return id
}

func TestBookingsWeekAndFilters(t *testing.T) {
	t.Parallel()
	ctx, owner := t.Context(), as(t, "a.owner")
	from, to := at(1, 0, 0), at(8, 0, 0)
	page, err := service(spaOnly).Bookings(ctx, owner, BookingQuery{From: &from, To: &to, OrgUnit: new(unit("msk1"))})
	require.NoError(t, err)
	assert.Equal(t, []string{"Классический массаж · Мария К.", "SPA-ритуал · Ольга Р.", "Перерыв", "Массаж спины · Екатерина Л.",
		"Совместная встреча", "Уборка кабинета № 8", "На следующей неделе"}, titles(page))
	kind := "equipment"
	page, err = service(spaOnly).Bookings(ctx, owner, BookingQuery{Kind: &kind})
	require.NoError(t, err)
	assert.Equal(t, []string{"SPA-ритуал · Ольга Р."}, titles(page))
	page, err = service(spaOnly).Bookings(ctx, owner, BookingQuery{Resource: &sharedRoom3})
	require.NoError(t, err)
	assert.Equal(t, []string{"Совместная встреча"}, titles(page), "the cancelled booking is never listed")
	page, err = service(spaOnly).Bookings(ctx, owner, BookingQuery{OrgUnit: new(unit("msk2"))})
	require.NoError(t, err)
	assert.Equal(t, []string{"Встреча Москвы-2", "Совместная встреча"}, titles(page), "a resource of the unit")
	long := at(8, 0, 1)
	_, err = service(spaOnly).Bookings(ctx, owner, BookingQuery{From: &from, To: &long})
	fe, ok := asFields(err)
	require.True(t, ok, "%v", err)
	assert.Equal(t, "Период не длиннее 7 дней.", fe.detail)
	q := BookingQuery{Limit: new(2)}
	first, err := service(spaOnly).Bookings(ctx, owner, q)
	require.NoError(t, err)
	require.NotNil(t, first.NextCursor)
	q.Cursor = first.NextCursor
	second, err := service(spaOnly).Bookings(ctx, owner, q)
	require.NoError(t, err)
	assert.Equal(t, []string{"SPA-ритуал · Ольга Р.", "Перерыв"}, titles(second))
}

func TestBookingsByScope(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	// A manager of Москва-1 without spa.appointments.read: the visits are hidden, their resources stay busy.
	page, err := service(withFleet).Bookings(ctx, as(t, "a.manager-msk1"), BookingQuery{})
	require.NoError(t, err)
	assert.Equal(t, []string{"Плановое ТО", "Рейс TR-1", "Перерыв", "Совместная встреча"}, titles(page))
	joint := page.Items[3]
	assert.Equal(t, []uuid.UUID{sharedRoom3}, resourceIDs(joint), "the room of Москва-2 is hidden from the manager")
	assert.Equal(t, "permission", lock(joint), "the calendar never moves a resource it does not show")
	assert.Equal(t, "specialist_schedule", lock(page.Items[2]))
	// Москва-2: its meeting and the joint booking through its room, which it may not move.
	page, err = service(withFleet).Bookings(ctx, as(t, "a.manager-msk2"), BookingQuery{})
	require.NoError(t, err)
	assert.Equal(t, []string{"Встреча Москвы-2", "Совместная встреча"}, titles(page))
	assert.Equal(t, map[string]string{"Встреча Москвы-2": "", "Совместная встреча": "permission"}, locks(page))
	// The region reads without calendar.bookings.manage: every booking is locked with permission.
	page, err = service(spaOnly).Bookings(ctx, as(t, "a.region-msk"), BookingQuery{})
	require.NoError(t, err)
	for _, b := range page.Items {
		assert.Equal(t, "permission", lock(b), b.Title)
	}
	// The massage therapist (self): the bookings of its resource only; the visits are its own to move, not the break.
	page, err = service(withFleet).Bookings(ctx, as(t, "ab.member"), BookingQuery{})
	require.NoError(t, err)
	assert.Equal(t, []string{"Классический массаж · Мария К.", "SPA-ритуал · Ольга Р.", "Перерыв", "Массаж спины · Екатерина Л."},
		titles(page))
	assert.Equal(t, map[string]string{"Классический массаж · Мария К.": "", "SPA-ритуал · Ольга Р.": "",
		"Перерыв": "specialist_schedule", "Массаж спины · Екатерина Л.": ""}, locks(page))
}

func TestGetBooking(t *testing.T) {
	t.Parallel()
	ctx, owner := t.Context(), as(t, "a.owner")
	b, err := service(spaOnly).Booking(ctx, owner, shared.a2)
	require.NoError(t, err)
	assert.Equal(t, "SPA-ритуал · Ольга Р.", b.Title)
	_, err = service(spaOnly).Booking(ctx, owner, sharedTrip)
	assert.Equal(t, problem.CodeNotFound, code(err), "a trip without «Логистика» is not disclosed")
	assert.Equal(t, "Бронь не найдена.", detail(err))
	_, err = service(spaOnly).Booking(ctx, owner, sharedCancelled)
	assert.Equal(t, problem.CodeNotFound, code(err))
	_, err = service(spaOnly).Booking(ctx, owner, uuid.New())
	assert.Equal(t, problem.CodeNotFound, code(err))
	_, err = service(spaOnly).Booking(ctx, as(t, "a.manager-msk2"), shared.a1)
	assert.Equal(t, problem.CodeNotFound, code(err), "a booking of another firm answers like a missing one")
	trip, err := service(withFleet).Booking(ctx, owner, sharedTrip)
	require.NoError(t, err)
	assert.Equal(t, "Рейс TR-1", trip.Title)
}

// The lock of the prototype: a trip, a maintenance and a break are never moved in the calendar (409 with the text of
// the prototype); a member without the right — 403; a booking out of sight — 404. Nothing changes.
func TestUpdateLocked(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	move := func(tc tenantctx.TenantContext, m Modules, id uuid.UUID, rs ...uuid.UUID) error {
		sel := make([]calendarapi.ResourceSelection, 0, len(rs))
		for _, r := range rs {
			sel = append(sel, calendarapi.ResourceSelection{Kind: calendarapi.ResourceSelectionKindRoom, ResourceId: r})
		}
		_, err := service(m).Update(ctx, tc, id, etag(1), calendarapi.BookingPatch{Action: calendarapi.Reschedule,
			Window: &calendarapi.TimeWindow{StartsAt: at(1, 15, 0), EndsAt: at(1, 16, 0), TimeZone: "Europe/Moscow"}, Resources: &sel})
		return err
	}
	owner := as(t, "a.owner")
	cases := []struct {
		name, code, detail string
		err                error
	}{
		{"break", codeInvalidTransition, "Перерыв меняется в графике специалиста.", move(owner, spaOnly, shared.br, shared.anna)},
		{"trip", codeInvalidTransition, "Время рейса меняется в рабочем месте логиста — календарь вызывает команду исходного модуля.",
			move(owner, withFleet, sharedTrip, sharedDriver)},
		{"maintenance", codeInvalidTransition, "Недоступность машины задаётся в карточке машины.", move(owner, withFleet, sharedTO, sharedVan)},
		{"no right", problem.CodeForbiddenAction, "", move(as(t, "a.region-msk"), spaOnly, sharedMsk2, sharedMsk2Room)},
		{"hidden resource", problem.CodeForbiddenAction, "", move(as(t, "a.manager-msk1"), spaOnly, sharedJoint, sharedRoom3)},
		{"out of sight", problem.CodeNotFound, "Бронь не найдена.", move(as(t, "a.manager-msk2"), spaOnly, shared.a1, shared.room2)},
	}
	for _, c := range cases {
		assert.Equal(t, c.code, code(c.err), c.name)
		assert.Equal(t, c.detail, detail(c.err), c.name)
	}
	b, err := service(spaOnly).Booking(ctx, owner, shared.br)
	require.NoError(t, err)
	assert.Equal(t, int64(1), b.Revision)
}

// reschedule moves a visit of d to hh:mm with its duration (60 min for a1) and resources.
func reschedule(t *testing.T, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, start, end time.Time, rs ...calendarapi.ResourceSelection) (calendarapi.Booking, error) {
	t.Helper()
	return service(spaOnly).Update(t.Context(), tc, id, ifMatch, calendarapi.BookingPatch{Action: calendarapi.Reschedule,
		Window: &calendarapi.TimeWindow{StartsAt: start.UTC(), EndsAt: end.UTC(), TimeZone: "Europe/Moscow"}, Resources: &rs})
}

func (d day) massage() []calendarapi.ResourceSelection {
	return []calendarapi.ResourceSelection{
		{Kind: calendarapi.ResourceSelectionKindMember, ResourceId: d.anna},
		{Kind: calendarapi.ResourceSelectionKindRoom, ResourceId: d.room2},
	}
}

type row struct {
	state      string
	start, end time.Time
	from, to   time.Time
}

func reservations(t *testing.T, bundle uuid.UUID) map[uuid.UUID]row {
	t.Helper()
	rs, err := superA.Query(t.Context(), `select resource_id, state, lower(during), upper(during), lower(occupied), upper(occupied)
		from sched.reservations where bundle_id = $1`, bundle)
	require.NoError(t, err)
	defer rs.Close()
	out := map[uuid.UUID]row{}
	for rs.Next() {
		var (
			id uuid.UUID
			r  row
		)
		require.NoError(t, rs.Scan(&id, &r.state, &r.start, &r.end, &r.from, &r.to))
		out[id] = r
	}
	require.NoError(t, rs.Err())
	return out
}

// The reschedule of the prototype on a day of its own (moveBooking): 08:00 — free with the cleanup; 11:00 and 13:00 —
// the conflict of the prototype, nothing changes; 19:30 — out of the workday; If-Match; the cancel frees the slot.
func TestRescheduleOfPrototype(t *testing.T) {
	t.Parallel()
	ctx, owner := t.Context(), as(t, "a.owner")
	d, err := freshDay(ctx, 5)
	require.NoError(t, err)

	moved, err := reschedule(t, owner, d.a1, `"rev-1"`, at(5, 8, 0), at(5, 9, 0), d.massage()...)
	require.NoError(t, err)
	assert.Equal(t, int64(2), moved.Revision)
	assert.True(t, moved.Window.StartsAt.Equal(at(5, 8, 0)))
	assert.True(t, moved.Occupied.EndsAt.Equal(at(5, 9, 15)))
	for id, r := range reservations(t, d.a1) {
		assert.Equal(t, "confirmed", r.state, id)
		assert.True(t, r.start.Equal(at(5, 8, 0)) && r.end.Equal(at(5, 9, 0)) && r.to.Equal(at(5, 9, 15)))
	}
	var diff string
	require.NoError(t, superA.QueryRow(ctx, `select diff::text from audit.events
		where action = 'calendar.booking.rescheduled' and target_id = $1`, d.a1).Scan(&diff))
	assert.Contains(t, diff, "2026-10-05T07:00:00Z", "the old window")
	assert.Contains(t, diff, "2026-10-05T05:00:00Z", "the new window")

	_, err = reschedule(t, owner, d.a1, `"rev-2"`, at(5, 11, 0), at(5, 12, 0), d.massage()...)
	fe, ok := asFields(err)
	require.True(t, ok, "%v", err)
	assert.Equal(t, codeResourcesUnavailable, fe.code)
	assert.Equal(t, "Конфликт ресурсов: Анна Морозова · массажист занят («SPA-ритуал · Ольга Р.»); "+
		"Кабинет № 2 занят («SPA-ритуал · Ольга Р.»)", fe.detail)

	_, err = reschedule(t, owner, d.a1, `"rev-2"`, at(5, 13, 0), at(5, 14, 0), d.massage()...)
	fe, ok = asFields(err)
	require.True(t, ok, "%v", err)
	assert.Equal(t, "Конфликт ресурсов: Анна Морозова · массажист занят («SPA-ритуал · Ольга Р.»); "+
		"Кабинет № 2 занят («SPA-ритуал · Ольга Р.»); Анна Морозова · массажист занят («Массаж спины · Екатерина Л.»); "+
		"Кабинет № 2 занят («Массаж спины · Екатерина Л.»); Анна Морозова · массажист занят («Перерыв»)", fe.detail)
	fields := []string{}
	for _, v := range fe.violations {
		fields = append(fields, v.Field+" "+v.Code)
	}
	assert.Equal(t, []string{"resources[0] busy", "resources[1] busy", "resources[0] busy", "resources[1] busy", "resources[0] busy"}, fields)

	_, err = reschedule(t, owner, d.a1, `"rev-2"`, at(5, 19, 30), at(5, 20, 30), d.massage()...)
	assert.Equal(t, codeValidation, code(err))
	assert.Equal(t, "Время вне рабочего дня ресурса.", detail(err))
	_, err = reschedule(t, owner, d.a1, "", at(5, 8, 15), at(5, 9, 15), d.massage()...)
	assert.Equal(t, codeRevisionRequired, code(err))
	_, err = reschedule(t, owner, d.a1, `"rev-1"`, at(5, 8, 15), at(5, 9, 15), d.massage()...)
	assert.Equal(t, codeRevisionMismatch, code(err))
	_, err = reschedule(t, owner, d.a1, `"rev-2"`, at(5, 9, 0), at(5, 8, 0), d.massage()...)
	assert.Equal(t, codeValidation, code(err))
	_, err = reschedule(t, owner, d.a1, `"rev-2"`, at(5, 8, 15), at(5, 9, 15), calendarapi.ResourceSelection{
		Kind: calendarapi.ResourceSelectionKindRoom, ResourceId: d.anna})
	fe, ok = asFields(err)
	require.True(t, ok, "%v", err)
	assert.Equal(t, "resources[0]", fe.violations[0].Field, "the kind does not match the resource")

	b, err := service(spaOnly).Booking(ctx, owner, d.a1)
	require.NoError(t, err)
	assert.Equal(t, int64(2), b.Revision, "the failed reschedules changed nothing")

	cancelled, err := service(spaOnly).Update(ctx, owner, d.a3, `"rev-1"`, calendarapi.BookingPatch{Action: calendarapi.Cancel,
		Reason: new("Клиент перенёс")})
	require.NoError(t, err)
	assert.Equal(t, calendarapi.Cancelled, cancelled.Status)
	assert.Equal(t, int64(2), cancelled.Revision)
	for _, r := range reservations(t, d.a3) {
		assert.Equal(t, "released", r.state)
	}
	_, err = service(spaOnly).Booking(ctx, owner, d.a3)
	assert.Equal(t, problem.CodeNotFound, code(err))
	// 14:00–15:00 (+15) is free once Массаж спины is cancelled; the break ends at 14:00.
	_, err = reschedule(t, owner, d.a1, `"rev-2"`, at(5, 14, 0), at(5, 15, 0), d.massage()...)
	require.NoError(t, err)
}

// The reschedule keeps or changes the resources: a removed one is released, an added one is held, both in the same
// transaction.
func TestRescheduleChangesResources(t *testing.T) {
	t.Parallel()
	ctx, owner := t.Context(), as(t, "a.owner")
	d, err := freshDay(ctx, 6)
	require.NoError(t, err)
	room4, err := addResource(ctx, res{kind: kindRoom, home: d.unit, label: "Кабинет № 4", active: true})
	require.NoError(t, err)
	moved, err := reschedule(t, owner, d.a1, `"rev-1"`, at(6, 16, 0), at(6, 17, 0),
		calendarapi.ResourceSelection{Kind: calendarapi.ResourceSelectionKindMember, ResourceId: d.anna},
		calendarapi.ResourceSelection{Kind: calendarapi.ResourceSelectionKindRoom, ResourceId: room4})
	require.NoError(t, err)
	assert.Equal(t, []uuid.UUID{d.anna, room4}, resourceIDs(moved))
	rows := reservations(t, d.a1)
	assert.Equal(t, "released", rows[d.room2].state)
	assert.Equal(t, "confirmed", rows[room4].state)
	assert.True(t, rows[room4].start.Equal(at(6, 16, 0)) && rows[room4].to.Equal(at(6, 17, 15)))
	assert.Equal(t, "confirmed", rows[d.anna].state)
}

// A live hold of logistics makes a resource busy and is never named without the right to read it; an expired hold
// does not, and the reschedule writes it down as expired.
func TestRescheduleAgainstHolds(t *testing.T) {
	t.Parallel()
	ctx, owner := t.Context(), as(t, "a.owner")
	d, err := freshDay(ctx, 7)
	require.NoError(t, err)
	live := at(7, 23, 0)
	_, err = addHold(ctx, "fleet.reservation", uuid.Nil, at(7, 16, 0), at(7, 17, 0), &live, d.room2)
	require.NoError(t, err)
	_, err = reschedule(t, owner, d.a1, `"rev-1"`, at(7, 16, 0), at(7, 17, 0), d.massage()...)
	assert.Equal(t, codeResourcesUnavailable, code(err))
	assert.Equal(t, "Конфликт ресурсов: Кабинет № 2 занят", detail(err))
	ended := harness.Now().Add(-time.Minute)
	expired, err := addHold(ctx, "fleet.reservation", uuid.Nil, at(7, 18, 0), at(7, 19, 0), &ended, d.room2)
	require.NoError(t, err)
	_, err = reschedule(t, owner, d.a1, `"rev-1"`, at(7, 18, 0), at(7, 19, 0), d.massage()...)
	require.NoError(t, err)
	assert.Equal(t, "expired", reservations(t, expired)[d.room2].state)
}

// Two reschedules of different bookings onto one free interval of a shared resource: exactly one succeeds, the
// other gets the conflict (the resources are locked in the order of their ids).
func TestRescheduleConcurrent(t *testing.T) {
	t.Parallel()
	ctx, owner := t.Context(), as(t, "a.owner")
	room, err := addResource(ctx, res{kind: kindRoom, home: unit("msk3"), label: "Кабинет гонки", active: true})
	require.NoError(t, err)
	var ids []uuid.UUID
	for i, h := range []int{8, 11} {
		id, err := addBooking(ctx, bk{unit: unit("msk3"), title: "Встреча", kind: "manual", start: at(9, h, 0), end: at(9, h+1, 0),
			resources: []uuid.UUID{room}, created: at(1, 1, i)})
		require.NoError(t, err)
		ids = append(ids, id)
	}
	errs := make([]error, len(ids))
	var wg sync.WaitGroup
	for i, id := range ids {
		wg.Go(func() {
			_, errs[i] = reschedule(t, owner, id, `"rev-1"`, at(9, 15, 0), at(9, 16, 0),
				calendarapi.ResourceSelection{Kind: calendarapi.ResourceSelectionKindRoom, ResourceId: room})
		})
	}
	wg.Wait()
	ok, busy := 0, 0
	for _, err := range errs {
		switch {
		case err == nil:
			ok++
		case code(err) == codeResourcesUnavailable:
			busy++
		default:
			t.Errorf("unexpected: %v", err)
		}
	}
	assert.Equal(t, 1, ok)
	assert.Equal(t, 1, busy)
}

// The massage therapist moves its own visit; the reschedule of a booking of its resource needs no unit grant.
func TestRescheduleSelf(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	id, err := addBooking(ctx, bk{unit: unit("msk1"), title: "Личная запись", kind: "manual", start: at(10, 10, 0),
		end: at(10, 11, 0), resources: []uuid.UUID{shared.anna}, created: at(1, 2, 0)})
	require.NoError(t, err)
	moved, err := reschedule(t, as(t, "ab.member"), id, `"rev-1"`, at(10, 12, 0), at(10, 13, 0),
		calendarapi.ResourceSelection{Kind: calendarapi.ResourceSelectionKindMember, ResourceId: shared.anna})
	require.NoError(t, err)
	assert.Equal(t, int64(2), moved.Revision)
	_, err = reschedule(t, as(t, "a.manager-msk2"), id, `"rev-2"`, at(10, 14, 0), at(10, 15, 0),
		calendarapi.ResourceSelection{Kind: calendarapi.ResourceSelectionKindMember, ResourceId: shared.anna})
	assert.Equal(t, problem.CodeNotFound, code(err))
}

func slotStarts(r calendarapi.AvailabilityResult) []time.Time {
	out := []time.Time{}
	for _, s := range r.Slots {
		out = append(out, s.Window.StartsAt.In(moscow))
	}
	return out
}

// findCalendarAvailability: the free slots for all resources of a booking without itself (freeSlots of the prototype).
func TestAvailability(t *testing.T) {
	t.Parallel()
	ctx, owner := t.Context(), as(t, "a.owner")
	q := calendarapi.AvailabilityQuery{
		OrgUnitId: unit("msk1"), Window: calendarapi.TimeWindow{StartsAt: at(1, 8, 0), EndsAt: at(1, 20, 0), TimeZone: "Europe/Moscow"},
		DurationMinutes: 60, StepMinutes: 15, CleanupMinutes: new(15), PrepMinutes: new(0), MaxSlots: new(3),
		ExcludeBookingId: &shared.a1,
		Requirements: []calendarapi.ResourceRequirement{
			{Kind: calendarapi.ResourceRequirementKindMember, RequiredCount: 1, ResourceIds: []uuid.UUID{shared.anna}},
			{Kind: calendarapi.ResourceRequirementKindRoom, RequiredCount: 1, ResourceIds: []uuid.UUID{shared.room2}},
		},
	}
	r, err := service(spaOnly).Availability(ctx, owner, q)
	require.NoError(t, err)
	assert.Equal(t, []time.Time{at(1, 8, 0), at(1, 8, 15), at(1, 8, 30)}, slotStarts(r))
	assert.Equal(t, slotToken(shared.a1, at(1, 8, 0)), r.Slots[0].AvailabilityToken)
	assert.True(t, r.CalculatedAt.Equal(harness.Now()))
	assert.True(t, r.Slots[0].TokenExpiresAt.Equal(harness.Now().Add(5*time.Minute)))
	assert.Equal(t, shared.anna, r.Slots[0].Resources[0].ResourceId)

	spa := q
	spa.ExcludeBookingId, spa.DurationMinutes, spa.PrepMinutes = &shared.a2, 90, new(15)
	spa.Requirements = []calendarapi.ResourceRequirement{q.Requirements[0], q.Requirements[1], {
		Kind: calendarapi.ResourceRequirementKindEquipment, RequiredCount: 1, ResourceIds: []uuid.UUID{shared.table}}}
	r, err = service(spaOnly).Availability(ctx, owner, spa)
	require.NoError(t, err)
	assert.Equal(t, []time.Time{at(1, 8, 15), at(1, 15, 15), at(1, 15, 30)}, slotStarts(r))

	missing := q
	missing.ExcludeBookingId = new(uuid.New())
	_, err = service(spaOnly).Availability(ctx, owner, missing)
	assert.Equal(t, problem.CodeNotFound, code(err))
	assert.Equal(t, "Бронь не найдена.", detail(err))
	foreignUnit := q
	foreignUnit.OrgUnitId = uuid.New()
	_, err = service(spaOnly).Availability(ctx, owner, foreignUnit)
	assert.Equal(t, problem.CodeNotFound, code(err))
	assert.Equal(t, "Подразделение не найдено.", detail(err))
	hidden := q
	hidden.ExcludeBookingId = nil
	hidden.Requirements = []calendarapi.ResourceRequirement{{Kind: calendarapi.ResourceRequirementKindRoom, RequiredCount: 1,
		ResourceIds: []uuid.UUID{sharedMsk2Room}}}
	_, err = service(spaOnly).Availability(ctx, as(t, "a.manager-msk1"), hidden)
	fe, ok := asFields(err)
	require.True(t, ok, "%v", err)
	assert.Equal(t, "requirements[0].resourceIds[0]", fe.violations[0].Field)
}

// A driver sees the busy time of its own resource (calendar.availability.read in self) — the trip of logistics
// included — but no booking.
func TestAvailabilityOfDriver(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	q := calendarapi.AvailabilityQuery{
		OrgUnitId: unit("msk1"), Window: calendarapi.TimeWindow{StartsAt: at(1, 8, 0), EndsAt: at(1, 20, 0), TimeZone: "Europe/Moscow"},
		DurationMinutes: 60, StepMinutes: 15, MaxSlots: new(3),
		Requirements: []calendarapi.ResourceRequirement{
			{Kind: calendarapi.ResourceRequirementKindMember, RequiredCount: 1, ResourceIds: []uuid.UUID{sharedDriver}},
		},
	}
	r, err := service(withFleet).Availability(ctx, as(t, "a.driver-msk1"), q)
	require.NoError(t, err)
	assert.Equal(t, []time.Time{at(1, 8, 0), at(1, 13, 0), at(1, 13, 15)}, slotStarts(r))
}
