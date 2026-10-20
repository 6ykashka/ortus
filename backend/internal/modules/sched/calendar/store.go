package calendar

import (
	"cmp"
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// resource is a row of sched.resources as the calendar shows it.
type resource struct {
	id     uuid.UUID
	kind   string     // kind of sched.resources
	ref    *uuid.UUID // the vehicle or the person; nil for a room and equipment
	unit   uuid.UUID  // the org unit: of the vehicle for a vehicle, the home unit of the row otherwise
	name   string
	zone   string
	day    workday
	active bool
	future bool // holds a live reservation that ends after now
}

// resourcesSQL reads every resource of the tenant ($1 — now): the label of the row or of its source («{model} ·
// {plate}», the full name), the zone of the row or of its unit, the workday and whether it holds a live reservation
// that ends after now.
const resourcesSQL = `
select r.id, r.kind, r.ref_id, u.id,
       coalesce(r.label, case r.kind when 'vehicle' then concat_ws(' · ', v.display_name, v.plate) when 'person' then p.full_name end, ''),
       coalesce(r.time_zone, u.time_zone), to_char(r.workday_start, 'HH24:MI'), to_char(r.workday_end, 'HH24:MI'), r.active,
       exists (select 1 from sched.reservations x where x.resource_id = r.id and upper(x.occupied) > $1 and ` + liveX + `)
  from sched.resources r
  left join fleet.vehicles v on r.kind = 'vehicle' and v.id = r.ref_id
  left join people.person_profiles p on r.kind = 'person' and p.id = r.ref_id
  join org.units u on u.id = coalesce(v.unit_id, r.home_unit_id)`

// liveX is the condition of a reservation row x that holds its resource at $1: confirmed, consumed, or a hold before
// its end (an ended hold reads as expired, sched.Effective).
const liveX = `(x.state in ('confirmed', 'consumed') or (x.state = 'hold' and x.hold_expires_at > $1))`

func loadResources(ctx context.Context, tx pgx.Tx, now time.Time) ([]*resource, error) {
	rows, err := tx.Query(ctx, resourcesSQL, now)
	if err != nil {
		return nil, fmt.Errorf("calendar: resources: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (*resource, error) {
		var (
			r          resource
			start, end string
		)
		if err := row.Scan(&r.id, &r.kind, &r.ref, &r.unit, &r.name, &r.zone, &start, &end, &r.active, &r.future); err != nil {
			return nil, err
		}
		r.day.loc = location(r.zone)
		var err error
		if r.day.start, err = parseClock(start); err != nil {
			return nil, err
		}
		if r.day.end, err = parseClock(end); err != nil {
			return nil, err
		}
		return &r, nil
	})
	if err != nil {
		return nil, fmt.Errorf("calendar: resources: %w", err)
	}
	return out, nil
}

// lessResource is the order of resources: by kind (vehicle, member, room, equipment), then label, then id.
func lessResource(a, b *resource) int {
	if c := cmp.Compare(kindRank(a.kind), kindRank(b.kind)); c != 0 {
		return c
	}
	if nameLess(a.name, b.name) {
		return -1
	}
	if nameLess(b.name, a.name) {
		return 1
	}
	return slices.Compare(a.id[:], b.id[:])
}

// Sources of the holds of logistics (fleet/reservations: sched.reservations.source_type).
const (
	sourceTrip        = "fleet.trip"
	sourceReservation = "fleet.reservation"
)

// booking is a booking of the calendar: a row of sched.bookings or a projection of a bundle of logistics.
type booking struct {
	id             uuid.UUID
	unit           uuid.UUID
	title          string
	sourceKind     string // appointment, trip, maintenance, break, manual
	module, entity string // relatedObject; "" — none
	entityID       uuid.UUID
	start, end     time.Time
	occupied       span
	zone           string
	prep, cleanup  int
	status         string
	revision       int64
	created        time.Time
	resources      []uuid.UUID // the resources it holds now, in the order of lessResource
	hold           string      // a projection: the source of the bundle (fleet.trip, fleet.reservation); "" — a booking
	author         uuid.UUID   // a projection: who made the hold
	tripUnit       uuid.UUID   // a booking of a trip: the unit and the driver of the trip
	tripDriver     *uuid.UUID
	tripNumber     string
	tripKnown      bool
}

const (
	statusConfirmed = "confirmed"
	statusCancelled = "cancelled"
	kindTrip        = "trip"
	kindMaintenance = "maintenance"
	kindAppointment = "appointment"
	kindBreak       = "break"
)

// bookingsSQL reads bookings of sched.bookings with the resources they hold at $1; the caller adds the condition.
const bookingsSQL = `
select b.id, b.org_unit_id, b.title, b.source_kind, coalesce(b.source_module, ''), coalesce(b.source_type, ''), b.source_id,
       lower(b.during), upper(b.during), b.time_zone, b.prep_minutes, b.cleanup_minutes, b.status, b.revision, b.created_at,
       array(select x.resource_id from sched.reservations x where x.bundle_id = b.id and ` + liveX + `)
  from sched.bookings b`

// holdsSQL reads the bundles of logistics without a booking row that hold their resources at $1 (the projection of
// W4.40): the window of the bundle is the union of its rows; the caller adds the condition on x.
const holdsSQL = `
select x.bundle_id, min(x.source_type), (array_agg(x.source_id))[1], min(lower(x.during)), max(upper(x.during)),
       min(lower(x.occupied)), max(upper(x.occupied)), max(x.revision), min(x.created_at), array_agg(x.resource_id),
       (array_agg(x.created_by))[1]
  from sched.reservations x
 where x.source_type in ('fleet.trip', 'fleet.reservation') and ` + liveX + `
   and not exists (select 1 from sched.bookings b where b.id = x.bundle_id)`

// bookingWhere selects the bookings: by ids, or overlapping a window (with the buffers; at most 240 minutes each).
type bookingWhere struct {
	ids    []uuid.UUID
	window *span
	lock   bool // lock the rows of sched.bookings for the command
}

// loadBookings reads the bookings and the projections of w at now; the projections of trips get their trip.
func (r *request) loadBookings(ctx context.Context, w bookingWhere) ([]*booking, error) {
	cond, args := "", []any{r.now}
	switch {
	case w.window != nil:
		cond = ` where b.status = 'confirmed' and b.during && tstzrange($2::timestamptz - interval '240 minutes', $3::timestamptz + interval '240 minutes', '[)')`
		args = append(args, w.window.from, w.window.to)
	default:
		cond = ` where b.id = any($2)`
		args = append(args, w.ids)
	}
	if w.lock {
		cond += ` order by b.id for update of b`
	}
	rows, err := r.tx.Query(ctx, bookingsSQL+cond, args...)
	if err != nil {
		return nil, fmt.Errorf("calendar: bookings: %w", err)
	}
	out, err := pgx.CollectRows(rows, scanBooking)
	if err != nil {
		return nil, fmt.Errorf("calendar: bookings: %w", err)
	}
	holds, err := r.loadHolds(ctx, w)
	if err != nil {
		return nil, err
	}
	out = append(out, holds...)
	return out, r.loadTrips(ctx, out)
}

func scanBooking(row pgx.CollectableRow) (*booking, error) {
	var (
		b        booking
		sourceID *uuid.UUID
	)
	if err := row.Scan(&b.id, &b.unit, &b.title, &b.sourceKind, &b.module, &b.entity, &sourceID, &b.start, &b.end, &b.zone,
		&b.prep, &b.cleanup, &b.status, &b.revision, &b.created, &b.resources); err != nil {
		return nil, err
	}
	if sourceID != nil {
		b.entityID = *sourceID
	} else {
		b.module, b.entity = "", ""
	}
	b.occupied = occupiedOf(b.start, b.end, b.prep, b.cleanup)
	return &b, nil
}

func (r *request) loadHolds(ctx context.Context, w bookingWhere) ([]*booking, error) {
	cond, args := "", []any{r.now}
	if w.window != nil {
		cond = ` and x.occupied && tstzrange($2, $3, '[)')`
		args = append(args, w.window.from, w.window.to)
	} else {
		cond = ` and x.bundle_id = any($2)`
		args = append(args, w.ids)
	}
	rows, err := r.tx.Query(ctx, holdsSQL+cond+` group by x.bundle_id`, args...)
	if err != nil {
		return nil, fmt.Errorf("calendar: holds: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (*booking, error) {
		b := booking{status: statusConfirmed, sourceKind: kindTrip}
		var source uuid.UUID
		if err := row.Scan(&b.id, &b.hold, &source, &b.start, &b.end, &b.occupied.from, &b.occupied.to, &b.revision, &b.created,
			&b.resources, &b.author); err != nil {
			return nil, err
		}
		b.prep = minutes(b.occupied.from, b.start)
		b.cleanup = minutes(b.end, b.occupied.to)
		if b.hold == sourceTrip {
			b.module, b.entity, b.entityID = moduleFleet, kindTrip, source
		}
		return &b, nil
	})
	if err != nil {
		return nil, fmt.Errorf("calendar: holds: %w", err)
	}
	return out, nil
}

// minutes is the whole minutes from a to b, never below zero.
func minutes(a, b time.Time) int { return max(0, int(b.Sub(a)/time.Minute)) }

// loadTrips reads the trips of the bookings of a trip (fleet.trips): the unit and the driver decide whether the member
// reads it (fleet.trips.read), the number names a projection.
func (r *request) loadTrips(ctx context.Context, bs []*booking) error {
	var ids []uuid.UUID
	for _, b := range bs {
		if b.module == moduleFleet && b.entity == kindTrip {
			ids = append(ids, b.entityID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	rows, err := r.tx.Query(ctx, `select id, number, unit_id, driver_person_id from fleet.trips where id = any($1)`, ids)
	if err != nil {
		return fmt.Errorf("calendar: trips: %w", err)
	}
	type trip struct {
		number string
		unit   uuid.UUID
		driver *uuid.UUID
	}
	trips := map[uuid.UUID]trip{}
	for rows.Next() {
		var (
			id uuid.UUID
			t  trip
		)
		if err := rows.Scan(&id, &t.number, &t.unit, &t.driver); err != nil {
			rows.Close()
			return fmt.Errorf("calendar: trips: %w", err)
		}
		trips[id] = t
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("calendar: trips: %w", err)
	}
	for _, b := range bs {
		if t, ok := trips[b.entityID]; ok && b.module == moduleFleet && b.entity == kindTrip {
			b.tripKnown, b.tripUnit, b.tripDriver, b.tripNumber = true, t.unit, t.driver, t.number
		}
	}
	return nil
}
