package calendar

import (
	"context"
	"fmt"
	"slices"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	calendarapi "github.com/ortus/ortus-crm/backend/internal/api/calendar"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
)

// view is the calendar through the eyes of the member of a request (the descriptions of listCalendarResources and
// listCalendarBookings; MSW calendar/state.ts viewOf): the resources it sees through action (calendar.bookings.read,
// for the slots calendar.availability.read) and the decisions on bookings.
type view struct {
	r       *request
	action  string
	all     []*resource
	byID    map[uuid.UUID]*resource
	zones   map[uuid.UUID]string // org unit → time zone
	visible map[uuid.UUID]bool   // the rows of listCalendarResources: the scope, the own resource and its companions
	anchor  map[uuid.UUID]bool   // the resources whose bookings the member reads: the scope and the own resource
	own     map[uuid.UUID]bool   // the own resource of the member (a person resource of its person) in self
	units   map[string]map[uuid.UUID]bool
	selves  map[string]bool
}

// newView loads the resources and decides which of them the member sees through action.
func (r *request) newView(ctx context.Context, action string) (*view, error) {
	v := &view{r: r, action: action, byID: map[uuid.UUID]*resource{}, zones: map[uuid.UUID]string{},
		visible: map[uuid.UUID]bool{}, anchor: map[uuid.UUID]bool{}, own: map[uuid.UUID]bool{},
		units: map[string]map[uuid.UUID]bool{}, selves: map[string]bool{}}
	var err error
	if v.all, err = loadResources(ctx, r.tx, r.now); err != nil {
		return nil, err
	}
	slices.SortFunc(v.all, lessResource)
	for _, res := range v.all {
		v.byID[res.id] = res
	}
	if err := v.loadZones(ctx); err != nil {
		return nil, err
	}
	scope, err := v.unitsOf(ctx, action)
	if err != nil {
		return nil, err
	}
	companions, err := v.ownResources(ctx)
	if err != nil {
		return nil, err
	}
	vehicles, err := v.vehicles(ctx)
	if err != nil {
		return nil, err
	}
	for _, res := range v.all {
		if res.kind == kindVehicle && !vehicles[res.id] {
			continue
		}
		v.anchor[res.id] = scope[res.unit] || v.own[res.id]
		v.visible[res.id] = v.anchor[res.id] || companions[res.id]
	}
	return v, nil
}

func (v *view) loadZones(ctx context.Context) error {
	rows, err := v.r.tx.Query(ctx, `select id, time_zone from org.units`)
	if err != nil {
		return fmt.Errorf("calendar: units: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			id   uuid.UUID
			zone string
		)
		if err := rows.Scan(&id, &zone); err != nil {
			return fmt.Errorf("calendar: units: %w", err)
		}
		v.zones[id] = zone
	}
	return rows.Err()
}

// unitsOf is the set of org units where the member holds action through a grant of the tenant or of a unit (the owner
// — every unit): the scope predicate of the evaluator over the units of the tenant.
func (v *view) unitsOf(ctx context.Context, action string) (map[uuid.UUID]bool, error) {
	if got, ok := v.units[action]; ok {
		return got, nil
	}
	rows, err := v.r.scoped(ctx, action, authz.Columns{Unit: "u.id"}, `select u.id from org.units u where {{scope}}`)
	if err != nil {
		return nil, fmt.Errorf("calendar: scope of %s: %w", action, err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return nil, fmt.Errorf("calendar: scope of %s: %w", action, err)
	}
	out := make(map[uuid.UUID]bool, len(ids))
	for _, id := range ids {
		out[id] = true
	}
	v.units[action] = out
	return out, nil
}

// self reports whether the member holds action in the scope self (objects «own» to it): the predicate over a column
// of people is not «false» (a grant of the tenant gives «true» too and is covered by unitsOf anyway).
func (v *view) self(ctx context.Context, action string) (bool, error) {
	if got, ok := v.selves[action]; ok {
		return got, nil
	}
	p, err := v.r.ev.ScopeQuery(ctx, v.r.tc, action, authz.Columns{Persons: []string{"p"}}, 0)
	if err != nil {
		return false, fmt.Errorf("calendar: self of %s: %w", action, err)
	}
	v.selves[action] = p.SQL != "false" && v.r.tc.PersonID != uuid.Nil
	return v.selves[action], nil
}

// ownResources fills the own resources of a member holding the action of the view in self and returns the resources
// booked together with them.
func (v *view) ownResources(ctx context.Context) (map[uuid.UUID]bool, error) {
	self, err := v.self(ctx, v.action)
	if err != nil || !self {
		return map[uuid.UUID]bool{}, err
	}
	for _, res := range v.all {
		if res.kind == kindPerson && res.ref != nil && *res.ref == v.r.tc.PersonID {
			v.own[res.id] = true
		}
	}
	return v.companions(ctx)
}

// companions are the resources booked together with the own resources in live bundles that do not end before the
// current day of the organization: a cancelled or a past booking does not widen «own».
func (v *view) companions(ctx context.Context) (map[uuid.UUID]bool, error) {
	out := map[uuid.UUID]bool{}
	if len(v.own) == 0 {
		return out, nil
	}
	loc, err := v.r.zoneOf(ctx)
	if err != nil {
		return nil, err
	}
	own := make([]uuid.UUID, 0, len(v.own))
	for id := range v.own {
		own = append(own, id)
	}
	rows, err := v.r.tx.Query(ctx, `select distinct y.resource_id
		  from sched.reservations x join sched.reservations y on y.bundle_id = x.bundle_id
		 where x.resource_id = any($2) and upper(x.occupied) > $3 and `+liveX+`
		   and (y.state in ('confirmed', 'consumed') or (y.state = 'hold' and y.hold_expires_at > $1))`,
		v.r.now, own, midnight(v.r.now, loc))
	if err != nil {
		return nil, fmt.Errorf("calendar: own resources: %w", err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return nil, fmt.Errorf("calendar: own resources: %w", err)
	}
	for _, id := range ids {
		out[id] = true
	}
	return out, nil
}

// vehicles is the set of the vehicle resources the member may see: the module fleet is active and fleet.vehicles.read
// covers the unit of the vehicle (a grant of the tenant or of a unit). The scope resource (the vehicle of the trip of a
// temporary driver, W2.57) is not asked: that role has no calendar, and a scope column of the kind resource outside the
// vehicles would open more with it (fleet/pool TestVehicleGrantOpensOnlyTheVehicle).
func (v *view) vehicles(ctx context.Context) (map[uuid.UUID]bool, error) {
	out := map[uuid.UUID]bool{}
	if !v.r.active(moduleFleet) {
		return out, nil
	}
	var ids, units []uuid.UUID
	for _, res := range v.all {
		if res.kind == kindVehicle && res.ref != nil {
			ids, units = append(ids, res.id), append(units, res.unit)
		}
	}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := v.r.scoped(ctx, actionVehiclesRead, authz.Columns{Unit: "x.u"},
		"select x.id from unnest($1::uuid[], $2::uuid[]) as x(id, u) where {{scope}}", ids, units)
	if err != nil {
		return nil, fmt.Errorf("calendar: vehicles: %w", err)
	}
	seen, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return nil, fmt.Errorf("calendar: vehicles: %w", err)
	}
	for _, id := range seen {
		out[id] = true
	}
	return out, nil
}

// complete fills what a booking takes from its resources: their order (lessResource) and, for a projection of
// logistics, the unit, the zone and the title.
func (v *view) complete(b *booking) {
	slices.SortFunc(b.resources, func(x, y uuid.UUID) int {
		rx, ry := v.byID[x], v.byID[y]
		switch {
		case rx == nil && ry == nil:
			return slices.Compare(x[:], y[:])
		case rx == nil:
			return 1
		case ry == nil:
			return -1
		}
		return lessResource(rx, ry)
	})
	if b.hold == "" {
		return
	}
	switch {
	case b.tripKnown:
		b.unit = b.tripUnit
	default:
		for _, id := range b.resources {
			if res := v.byID[id]; res != nil && (b.unit == uuid.Nil || res.kind == kindVehicle) {
				b.unit = res.unit
			}
		}
	}
	b.zone = v.zones[b.unit]
	if b.zone == "" {
		b.zone = defaultZone
	}
	b.title = textHoldTitle
	if b.tripKnown {
		b.title = "Рейс " + b.tripNumber
	}
}

// textHoldTitle names a hold of a vehicle without a trip (a reservation of a driver, W2.02): the prototype has no
// such block.
const textHoldTitle = "Бронь машины"

// persons are the people of the person resources of b (its «own» people for the scope self).
func (v *view) persons(b *booking) []uuid.UUID {
	var out []uuid.UUID
	for _, id := range b.resources {
		if res := v.byID[id]; res != nil && res.kind == kindPerson && res.ref != nil {
			out = append(out, *res.ref)
		}
	}
	return out
}

// holdsOwn reports whether b holds the own resource of the member.
func (v *view) holdsOwn(b *booking) bool {
	return slices.ContainsFunc(b.resources, func(id uuid.UUID) bool { return v.own[id] })
}

// allows reports whether the member holds action over unit, or in self when it is one of persons.
func (v *view) allows(ctx context.Context, action string, unit uuid.UUID, persons ...uuid.UUID) (bool, error) {
	units, err := v.unitsOf(ctx, action)
	if err != nil || units[unit] {
		return units[unit], err
	}
	self, err := v.self(ctx, action)
	if err != nil || !self {
		return false, err
	}
	return slices.Contains(persons, v.r.tc.PersonID), nil
}

// canRead reports whether the member reads b: a confirmed booking on a resource it sees through its scope or the own
// one, whose object it may read (a trip — fleet.trips.read with the module fleet active; a hold of a driver —
// fleet.reservations.read; a maintenance — the vehicle is seen; a visit — spa.appointments.read with SPA active).
func (v *view) canRead(ctx context.Context, b *booking) (bool, error) {
	if b.status != statusConfirmed || !slices.ContainsFunc(b.resources, func(id uuid.UUID) bool { return v.anchor[id] }) {
		return false, nil
	}
	switch {
	case b.hold == sourceReservation:
		if !v.r.active(moduleFleet) {
			return false, nil
		}
		return v.allows(ctx, actionHoldsRead, b.unit, append(v.persons(b), b.author)...)
	case b.module == moduleFleet && b.entity == kindTrip:
		if !v.r.active(moduleFleet) || !b.tripKnown {
			return false, nil
		}
		var driver []uuid.UUID
		if b.tripDriver != nil {
			driver = append(driver, *b.tripDriver)
		}
		return v.allows(ctx, actionTripsRead, b.tripUnit, driver...)
	case b.sourceKind == kindMaintenance:
		return !slices.ContainsFunc(b.resources, func(id uuid.UUID) bool { return !v.visible[id] }), nil
	case b.sourceKind == kindAppointment:
		if !v.r.active(moduleSpa) {
			return false, nil
		}
		return v.allows(ctx, actionAppointments, b.unit, v.persons(b)...)
	}
	return true, nil
}

// lockOf is Booking.rescheduleLock for the member (calVM lockText of the prototype): permission without
// calendar.bookings.manage over the booking (its unit, or self — it holds the own resource) or with a resource hidden
// from the member; then the source: a trip, a maintenance, a break. "" — the member may reschedule it here.
func (v *view) lockOf(ctx context.Context, b *booking) (string, error) {
	units, err := v.unitsOf(ctx, actionManage)
	if err != nil {
		return "", err
	}
	may := units[b.unit]
	if !may && v.holdsOwn(b) {
		if may, err = v.self(ctx, actionManage); err != nil {
			return "", err
		}
	}
	if !may || slices.ContainsFunc(b.resources, func(id uuid.UUID) bool { return !v.visible[id] }) {
		return string(calendarapi.Permission), nil
	}
	switch b.sourceKind {
	case kindTrip:
		return string(calendarapi.SourceModule), nil
	case kindMaintenance:
		return string(calendarapi.VehicleCard), nil
	case kindBreak:
		return string(calendarapi.SpecialistSchedule), nil
	}
	return "", nil
}

// lockTexts are the texts of the locks of the prototype (calVM lockText) — the 409 of a reschedule.
var lockTexts = map[string]string{
	string(calendarapi.SourceModule):       "Время рейса меняется в рабочем месте логиста — календарь вызывает команду исходного модуля.",
	string(calendarapi.SpecialistSchedule): "Перерыв меняется в графике специалиста.",
	string(calendarapi.VehicleCard):        "Недоступность машины задаётся в карточке машины.",
}

// dto is the Booking of the contract for the member: only its visible resources, the lock computed for it.
func (v *view) dto(ctx context.Context, b *booking) (calendarapi.Booking, error) {
	lock, err := v.lockOf(ctx, b)
	if err != nil {
		return calendarapi.Booking{}, err
	}
	return v.dtoWith(b, lock), nil
}

func (v *view) dtoWith(b *booking, lock string) calendarapi.Booking {
	sel := []calendarapi.ResourceSelection{}
	for _, id := range b.resources {
		if res := v.byID[id]; res != nil && v.visible[id] {
			sel = append(sel, calendarapi.ResourceSelection{Kind: calendarapi.ResourceSelectionKind(apiKind(res.kind)), ResourceId: id})
		}
	}
	prep, cleanup := b.prep, b.cleanup
	kind := calendarapi.BookingSourceKind(b.sourceKind)
	out := calendarapi.Booking{
		Id: b.id, OrgUnitId: b.unit, Title: b.title, Resources: sel, Status: calendarapi.BookingStatus(b.status),
		Revision: b.revision, PrepMinutes: &prep, CleanupMinutes: &cleanup, SourceKind: &kind,
		Window:   calendarapi.TimeWindow{StartsAt: b.start.UTC(), EndsAt: b.end.UTC(), TimeZone: b.zone},
		Occupied: &calendarapi.TimeWindow{StartsAt: b.occupied.from.UTC(), EndsAt: b.occupied.to.UTC(), TimeZone: b.zone},
	}
	if b.module != "" {
		out.RelatedObject = &calendarapi.ObjectRef{ModuleKey: b.module, EntityType: b.entity, EntityId: b.entityID}
	}
	if lock != "" {
		l := calendarapi.BookingRescheduleLock(lock)
		out.RescheduleLock = &l
	}
	return out
}

// resourceDTO is the CalendarResource of the contract.
func (v *view) resourceDTO(res *resource) calendarapi.CalendarResource {
	out := calendarapi.CalendarResource{
		Id: res.id, Kind: calendarapi.CalendarResourceKind(apiKind(res.kind)), Name: res.name, OrgUnitId: res.unit,
		TimeZone: res.zone, Active: res.active,
		Workday: calendarapi.CalendarWorkday{Start: formatClock(res.day.start), End: formatClock(res.day.end)},
	}
	if res.ref != nil {
		switch res.kind {
		case kindVehicle:
			out.Object = &calendarapi.ObjectRef{ModuleKey: moduleFleet, EntityType: kindVehicle, EntityId: *res.ref}
		case kindPerson:
			out.Object = &calendarapi.ObjectRef{ModuleKey: "core", EntityType: apiMember, EntityId: *res.ref}
		}
	}
	return out
}
