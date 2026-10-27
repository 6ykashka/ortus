package spa

import (
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// The booking of a visit is the bundle of the scheduling core (sched.bookings and sched.reservations, tenant 0001, 0021):
// one booking per visit, one confirmed reservation per resource over the window of the visit with the buffers of the
// service as the occupied range. The resources are locked in the order of their ids (the order of sched.Hold and of the
// calendar), so concurrent bookings of one resource queue instead of deadlocking, and the exclusion constraint
// reservations_no_overlap remains the last word (Q-W5.20-3: the module writes these two tables itself, as the calendar
// does, because sched.Hold knows neither buffers nor bookings).

const (
	sourceBooking  = "sched.booking"
	defaultDayFrom = 8 * time.Hour
	defaultDayTo   = 20 * time.Hour
	defaultZone    = "Europe/Moscow"
)

// Resources of a visit: the practitioner (the person profile), the room and the equipment (sched.resources ids).
type resources struct {
	practitioner uuid.UUID
	room         uuid.UUID
	equipment    []uuid.UUID
}

// fieldOf names the field of the request a resource id came from.
func (r resources) fieldOf(i int) string {
	switch i {
	case 0:
		return "practitionerMemberId"
	case 1:
		return "roomId"
	}
	return fmt.Sprintf("equipmentIds[%d]", i-2)
}

// all lists the resources in the order of the fields: practitioner, room, equipment.
func (r resources) all(practitionerResource uuid.UUID) []uuid.UUID {
	return append([]uuid.UUID{practitionerResource, r.room}, r.equipment...)
}

// booking is what a visit asks of the scheduling core.
type bookingRequest struct {
	id        uuid.UUID // the id of the booking (the bundle)
	visit     uuid.UUID // the id of the visit (the source of the booking)
	unit      uuid.UUID
	title     string
	window    Span
	occupied  Span
	zone      string
	before    int64
	after     int64
	createdBy uuid.UUID
	now       time.Time
	res       resources
}

// practitionerResource makes sure the practitioner has a resource of the scheduling core and returns its id.
func practitionerResource(ctx context.Context, tx pgx.Tx, person uuid.UUID) (uuid.UUID, error) {
	var home uuid.UUID
	if err := tx.QueryRow(ctx, `select home_unit_id from people.person_profiles where id = $1`, person).Scan(&home); err != nil {
		return uuid.Nil, fmt.Errorf("spa: practitioner: %w", err)
	}
	if _, err := tx.Exec(ctx, `insert into sched.resources (kind, ref_id, home_unit_id) values ('person', $1, $2) on conflict (kind, ref_id) do nothing`,
		person, home); err != nil {
		return uuid.Nil, fmt.Errorf("spa: practitioner resource: %w", err)
	}
	var id uuid.UUID
	if err := tx.QueryRow(ctx, `select id from sched.resources where kind = 'person' and ref_id = $1`, person).Scan(&id); err != nil {
		return uuid.Nil, fmt.Errorf("spa: practitioner resource: %w", err)
	}
	return id, nil
}

// lockResources locks the resources in the order of their ids and expires the holds that ended.
func lockResources(ctx context.Context, tx pgx.Tx, ids []uuid.UUID, now time.Time) error {
	if _, err := tx.Exec(ctx, `select id from sched.resources where id = any($1) order by id for update`, ids); err != nil {
		return fmt.Errorf("spa: lock resources: %w", err)
	}
	if _, err := tx.Exec(ctx, `update sched.reservations set state = 'expired', revision = revision + 1
		 where resource_id = any($1) and state = 'hold' and hold_expires_at <= $2 and offer_group_id is null`, ids, now); err != nil {
		return fmt.Errorf("spa: expire holds: %w", err)
	}
	return nil
}

// workdayOf reads the working day of the resources (CAL-05) and refuses a visit whose occupied range leaves it: the
// zone is the zone of the resource, else of its unit.
func checkWorkdays(ctx context.Context, tx pgx.Tx, ids []uuid.UUID, fields resources, occupied Span) error {
	rows, err := tx.Query(ctx, `select r.id, coalesce(r.time_zone, u.time_zone), to_char(r.workday_start, 'HH24:MI'), to_char(r.workday_end, 'HH24:MI')
		  from sched.resources r join org.units u on u.id = r.home_unit_id where r.id = any($1)`, ids)
	if err != nil {
		return fmt.Errorf("spa: workdays: %w", err)
	}
	defer rows.Close()
	days := map[uuid.UUID]Workday{}
	for rows.Next() {
		var (
			id           uuid.UUID
			zone         string
			from, until  string
			start, finis time.Duration
		)
		if err := rows.Scan(&id, &zone, &from, &until); err != nil {
			return fmt.Errorf("spa: workdays: %w", err)
		}
		if start, err = clockOf(from); err != nil {
			return err
		}
		if finis, err = clockOf(until); err != nil {
			return err
		}
		days[id] = Workday{Start: start, End: finis, Loc: location(zone)}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("spa: workdays: %w", err)
	}
	for i, id := range ids {
		d, ok := days[id]
		if !ok {
			d = Workday{Start: defaultDayFrom, End: defaultDayTo, Loc: location(defaultZone)}
		}
		if !d.Holds(occupied) {
			return invalid("startsAt", textOutsideWorkday+" ("+fields.fieldOf(i)+")")
		}
	}
	return nil
}

const textOutsideWorkday = "Время вместе с подготовкой и уборкой вне рабочего дня ресурса."

// clockOf reads «HH:MM» as the offset from midnight.
func clockOf(s string) (time.Duration, error) {
	var h, m int
	if _, err := fmt.Sscanf(s, "%d:%d", &h, &m); err != nil {
		return 0, fmt.Errorf("spa: clock %q: %w", s, err)
	}
	return time.Duration(h)*time.Hour + time.Duration(m)*time.Minute, nil
}

// location loads an IANA zone; an unknown name falls back to Europe/Moscow (the pilot is in Moscow).
func location(name string) *time.Location {
	if loc, err := time.LoadLocation(name); err == nil && name != "" {
		return loc
	}
	loc, err := time.LoadLocation(defaultZone)
	if err != nil {
		return time.UTC
	}
	return loc
}

// busy returns the fields of the request whose resource is held by another bundle over the occupied range.
func busy(ctx context.Context, tx pgx.Tx, ids []uuid.UUID, fields resources, own uuid.UUID, occupied Span, now time.Time) ([]string, error) {
	rows, err := tx.Query(ctx, `select distinct x.resource_id from sched.reservations x
		 where x.resource_id = any($1) and x.bundle_id <> $2 and x.occupied && tstzrange($3, $4, '[)')
		   and (x.state in ('confirmed', 'consumed') or (x.state = 'hold' and x.hold_expires_at > $5))`, ids, own, occupied.From, occupied.To, now)
	if err != nil {
		return nil, fmt.Errorf("spa: busy: %w", err)
	}
	defer rows.Close()
	taken := map[uuid.UUID]bool{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("spa: busy: %w", err)
		}
		taken[id] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("spa: busy: %w", err)
	}
	var out []string
	for i, id := range ids {
		if taken[id] {
			out = append(out, fields.fieldOf(i))
		}
	}
	return out, nil
}

const textBusy = "Время занято: освободите ресурсы или выберите другое время."

// reserve books the resources of a visit as one bundle: the resources are locked, the workday and the occupancy are
// checked, then the booking and one confirmed reservation per resource are written. A taken resource is a
// resources_unavailable that names the fields of the request.
func reserve(ctx context.Context, tx pgx.Tx, b bookingRequest) error {
	prac, err := practitionerResource(ctx, tx, b.res.practitioner)
	if err != nil {
		return err
	}
	ids := b.res.all(prac)
	if err := lockResources(ctx, tx, ids, b.now); err != nil {
		return err
	}
	if err := checkWorkdays(ctx, tx, ids, b.res, b.occupied); err != nil {
		return err
	}
	if taken, err := busy(ctx, tx, ids, b.res, b.id, b.occupied, b.now); err != nil {
		return err
	} else if len(taken) > 0 {
		return unavailable(textBusy, taken...)
	}
	if _, err := tx.Exec(ctx, `insert into sched.bookings (id, org_unit_id, title, source_kind, source_module, source_type, source_id, during,
		   time_zone, prep_minutes, cleanup_minutes, created_by, created_at, updated_at)
		 values ($1, $2, $3, 'appointment', $4, $5, $6, tstzrange($7, $8, '[)'), $9, $10, $11, $12, $13, $13)`,
		b.id, b.unit, b.title, moduleKey, typeAppointment, b.visit, b.window.From, b.window.To, b.zone, b.before, b.after, b.createdBy, b.now); err != nil {
		return fmt.Errorf("spa: insert booking: %w", err)
	}
	return insertReservations(ctx, tx, b, ids)
}

func insertReservations(ctx context.Context, tx pgx.Tx, b bookingRequest, ids []uuid.UUID) error {
	for i, id := range ids {
		_, err := tx.Exec(ctx, `insert into sched.reservations (resource_id, bundle_id, during, occupied, state, source_type, source_id, created_by, created_at)
			 values ($1, $2, tstzrange($3, $4, '[)'), tstzrange($5, $6, '[)'), 'confirmed', $7, $2, $8, $9)`,
			id, b.id, b.window.From, b.window.To, b.occupied.From, b.occupied.To, sourceBooking, b.createdBy, b.now)
		if isOverlap(err) {
			return unavailable(textBusy, b.res.fieldOf(i))
		}
		if err != nil {
			return fmt.Errorf("spa: insert reservation: %w", err)
		}
	}
	return nil
}

// moveBooking moves the booking of a visit to the new window and resources: the resources of both sets are locked
// together, the live reservations of the booking are released and the new ones are written.
func moveBooking(ctx context.Context, tx pgx.Tx, b bookingRequest, oldIDs []uuid.UUID) error {
	prac, err := practitionerResource(ctx, tx, b.res.practitioner)
	if err != nil {
		return err
	}
	ids := b.res.all(prac)
	locked := slices.Clone(ids)
	for _, id := range oldIDs {
		if !slices.Contains(locked, id) {
			locked = append(locked, id)
		}
	}
	if err := lockResources(ctx, tx, locked, b.now); err != nil {
		return err
	}
	if err := checkWorkdays(ctx, tx, ids, b.res, b.occupied); err != nil {
		return err
	}
	if taken, err := busy(ctx, tx, ids, b.res, b.id, b.occupied, b.now); err != nil {
		return err
	} else if len(taken) > 0 {
		return unavailable(textBusy, taken...)
	}
	if _, err := tx.Exec(ctx, `update sched.reservations set state = 'released', revision = revision + 1 where bundle_id = $1 and state = 'confirmed'`, b.id); err != nil {
		return fmt.Errorf("spa: release reservations: %w", err)
	}
	if _, err := tx.Exec(ctx, `update sched.bookings set during = tstzrange($2, $3, '[)'), time_zone = $4, revision = revision + 1, updated_at = $5 where id = $1`,
		b.id, b.window.From, b.window.To, b.zone, b.now); err != nil {
		return fmt.Errorf("spa: move booking: %w", err)
	}
	return insertReservations(ctx, tx, b, ids)
}

// bookingResources reads the resource ids the live reservations of the booking hold.
func bookingResources(ctx context.Context, tx pgx.Tx, booking uuid.UUID) ([]uuid.UUID, error) {
	rows, err := tx.Query(ctx, `select resource_id from sched.reservations where bundle_id = $1 and state = 'confirmed'`, booking)
	if err != nil {
		return nil, fmt.Errorf("spa: booking resources: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
}

// releaseBooking cancels the booking of a visit and frees its resources at once.
func releaseBooking(ctx context.Context, tx pgx.Tx, booking uuid.UUID, reason string, now time.Time) error {
	if _, err := tx.Exec(ctx, `update sched.bookings set status = 'cancelled', cancel_reason = $2, revision = revision + 1, updated_at = $3 where id = $1`,
		booking, reason, now); err != nil {
		return fmt.Errorf("spa: cancel booking: %w", err)
	}
	if _, err := tx.Exec(ctx, `update sched.reservations set state = 'released', revision = revision + 1
		 where bundle_id = $1 and state in ('hold', 'confirmed', 'consumed')`, booking); err != nil {
		return fmt.Errorf("spa: release reservations: %w", err)
	}
	return nil
}
