//go:build integration

package calendar

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Roles of the calendar given to the actors of the fixtures (the fixture roles of W1.04 carry no calendar action):
//   - a.manager-msk1, a.manager-msk2 — calCalendar on their firm: read, reschedule, slots;
//   - a.region-msk — calRead on the region Москва: read and slots, no reschedule;
//   - ab.member — calTherapist on self: the massage therapist of the prototype (its resource «Анна Морозова»).
var (
	calManage    = []string{"calendar.bookings.read", "calendar.bookings.manage", "calendar.availability.read"}
	calRead      = []string{"calendar.bookings.read", "calendar.availability.read"}
	calTherapist = []string{"calendar.bookings.read", "calendar.bookings.manage", "calendar.availability.read", "spa.appointments.read"}
)

// grantsSince is the start of the assignments of the tests (the fixtures run on 01.10.2026).
const grantsSince = "2026-09-01 00:00+03"

func grantCalendar(ctx context.Context) error {
	owner := person("a.owner")
	roles := map[string][]string{"cal-manage": calManage, "cal-read": calRead, "cal-therapist": calTherapist}
	ids := map[string]uuid.UUID{}
	for name, actions := range roles {
		id := uuid.New()
		ids[name] = id
		if _, err := superA.Exec(ctx, `insert into access.roles (id, name, kind) values ($1, $2, 'custom')`, id, name); err != nil {
			return err
		}
		if _, err := superA.Exec(ctx, `insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`,
			id, actions, owner); err != nil {
			return err
		}
	}
	grants := []struct {
		actor, role, scope string
		unit               uuid.UUID
	}{
		{"a.manager-msk1", "cal-manage", "unit", unit("msk1")},
		{"a.manager-msk2", "cal-manage", "unit", unit("msk2")},
		{"a.region-msk", "cal-read", "unit", unit("msk")},
		{"ab.member", "cal-therapist", "self", uuid.Nil},
	}
	for _, g := range grants {
		var scopeRef *uuid.UUID
		if g.unit != uuid.Nil {
			scopeRef = &g.unit
		}
		if _, err := superA.Exec(ctx, `insert into access.role_assignments (principal_kind, principal_id, role_id, role_version,
			scope_kind, scope_ref, include_descendants, valid, granted_by)
			values ('person', $1, $2, 1, $3, $4, $5, tstzrange($6::timestamptz, null), $7)`,
			person(g.actor), ids[g.role], g.scope, scopeRef, g.unit != uuid.Nil, grantsSince, owner); err != nil {
			return fmt.Errorf("grant %s: %w", g.actor, err)
		}
	}
	return nil
}

// addPerson adds a person profile (a specialist of a test day) with its home unit.
func addPerson(ctx context.Context, name string, home uuid.UUID) (uuid.UUID, error) {
	id := uuid.New()
	_, err := superA.Exec(ctx, `insert into people.person_profiles (id, full_name, home_unit_id) values ($1, $2, $3)`, id, name, home)
	return id, err
}

// res is a resource of a test: kind of sched.resources, the source object (vehicle, person), the home unit, the label.
type res struct {
	kind   string
	ref    uuid.UUID // uuid.Nil: a room or equipment
	home   uuid.UUID
	label  string // "": the label of the source
	active bool
}

func addResource(ctx context.Context, r res) (uuid.UUID, error) {
	id := uuid.New()
	var refID *uuid.UUID
	if r.ref != uuid.Nil {
		refID = &r.ref
	}
	var label *string
	if r.label != "" {
		label = &r.label
	}
	_, err := superA.Exec(ctx, `insert into sched.resources (id, kind, ref_id, home_unit_id, label, active)
		values ($1, $2, $3, $4, $5, $6)`, id, r.kind, refID, r.home, label, r.active)
	return id, err
}

// bk is a booking of a test: a row of sched.bookings with its confirmed reservations (released when cancelled).
type bk struct {
	unit           uuid.UUID
	title, kind    string // source_kind
	module, entity string // relatedObject: source_module, source_type
	start, end     time.Time
	prep, clean    int
	resources      []uuid.UUID
	cancelled      bool
	created        time.Time
}

func addBooking(ctx context.Context, b bk) (uuid.UUID, error) {
	id := uuid.New()
	var module, entity *string
	var source *uuid.UUID
	if b.module != "" {
		s := uuid.New()
		module, entity, source = &b.module, &b.entity, &s
	}
	status := "confirmed"
	if b.cancelled {
		status = "cancelled"
	}
	err := pgx.BeginFunc(ctx, superA, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `insert into sched.bookings (id, org_unit_id, title, source_kind, source_module, source_type,
			source_id, during, time_zone, prep_minutes, cleanup_minutes, status, created_by, created_at)
			values ($1, $2, $3, $4, $5, $6, $7, tstzrange($8, $9, '[)'), 'Europe/Moscow', $10, $11, $12, $13, $14)`,
			id, b.unit, b.title, b.kind, module, entity, source, b.start, b.end, b.prep, b.clean, status,
			person("a.owner"), b.created); err != nil {
			return fmt.Errorf("booking %s: %w", b.title, err)
		}
		state := "confirmed"
		if b.cancelled {
			state = "released"
		}
		occ := occupiedOf(b.start, b.end, b.prep, b.clean)
		for _, r := range b.resources {
			if _, err := tx.Exec(ctx, `insert into sched.reservations (resource_id, bundle_id, during, occupied, state,
				source_type, source_id, created_by, created_at)
				values ($1, $2, tstzrange($3, $4, '[)'), tstzrange($5, $6, '[)'), $7, 'sched.booking', $2, $8, $9)`,
				r, id, b.start, b.end, occ.from, occ.to, state, person("a.owner"), b.created); err != nil {
				return fmt.Errorf("booking %s: reservation: %w", b.title, err)
			}
		}
		return nil
	})
	return id, err
}

// addHold adds a bundle of logistics (sched.reservations without a booking row): source fleet.trip (trip) or
// fleet.reservation, state hold until expires (nil — confirmed).
func addHold(ctx context.Context, source string, trip uuid.UUID, start, end time.Time, expires *time.Time, resources ...uuid.UUID) (uuid.UUID, error) {
	bundle := uuid.New()
	sourceID := bundle
	if trip != uuid.Nil {
		sourceID = trip
	}
	state := "confirmed"
	if expires != nil {
		state = "hold"
	}
	for i, r := range resources {
		row := uuid.New()
		if i == 0 {
			row = bundle
		}
		if _, err := superA.Exec(ctx, `insert into sched.reservations (id, resource_id, bundle_id, during, occupied, state,
			hold_expires_at, source_type, source_id, created_by)
			values ($1, $2, $3, tstzrange($4, $5, '[)'), tstzrange($4, $5, '[)'), $6, $7, $8, $9, $10)`,
			row, r, bundle, start, end, state, expires, source, sourceID, person("a.owner")); err != nil {
			return uuid.Nil, err
		}
	}
	return bundle, nil
}

// day is the calendar of the prototype day (extra-data.js 14.10) on resources of its own.
type day struct {
	unit               uuid.UUID
	anna, room2, table uuid.UUID // the specialist of the day, Кабинет № 2, Стол с подогревом
	a1, a2, a3, br     uuid.UUID // the visits and the break of the prototype
}

// prototypeDay writes the visits and the break of the prototype on day dd of October in unit u for the specialist
// therapist (a person): Классический массаж 10:00–11:00 (+15), SPA-ритуал 11:30–13:00 (15 + 15, with the table),
// Перерыв 13:15–14:00, Массаж спины 14:00–14:45 (+15) — created in the order of the seed (a1, a2, a3, br).
func prototypeDay(ctx context.Context, dd int, u, therapist uuid.UUID) (day, error) {
	d := day{unit: u}
	var err error
	if d.anna, err = addResource(ctx, res{kind: kindPerson, ref: therapist, home: u, label: "Анна Морозова · массажист", active: true}); err != nil {
		return d, err
	}
	if d.room2, err = addResource(ctx, res{kind: kindRoom, home: u, label: "Кабинет № 2", active: true}); err != nil {
		return d, err
	}
	if d.table, err = addResource(ctx, res{kind: kindEquipment, home: u, label: "Стол с подогревом", active: true}); err != nil {
		return d, err
	}
	created := at(dd, 0, 0).AddDate(0, 0, -7)
	visit := func(title string, sh, sm, eh, em, prep, clean int, rs ...uuid.UUID) (uuid.UUID, error) {
		created = created.Add(time.Second)
		return addBooking(ctx, bk{unit: u, title: title, kind: "appointment", module: "spa", entity: "appointment",
			start: at(dd, sh, sm), end: at(dd, eh, em), prep: prep, clean: clean, resources: rs, created: created})
	}
	if d.a1, err = visit("Классический массаж · Мария К.", 10, 0, 11, 0, 0, 15, d.anna, d.room2); err != nil {
		return d, err
	}
	if d.a2, err = visit("SPA-ритуал · Ольга Р.", 11, 30, 13, 0, 15, 15, d.anna, d.room2, d.table); err != nil {
		return d, err
	}
	if d.a3, err = visit("Массаж спины · Екатерина Л.", 14, 0, 14, 45, 0, 15, d.anna, d.room2); err != nil {
		return d, err
	}
	d.br, err = addBooking(ctx, bk{unit: u, title: "Перерыв", kind: "break", start: at(dd, 13, 15), end: at(dd, 14, 0),
		resources: []uuid.UUID{d.anna}, created: created.Add(time.Second)})
	return d, err
}

// The shared calendar of 01.10.2026 (the day of the fixtures' clock) in tenant A beyond the prototype day of the
// massage therapist ab.member in Москва-1.
var (
	sharedVan, sharedDriver, sharedRoom3, sharedMsk2Room, sharedInactive, sharedHidden uuid.UUID
	sharedTrip, sharedTO, sharedMsk2, sharedJoint, sharedCancelled, sharedNextWeek     uuid.UUID
	sharedTomorrow                                                                     uuid.UUID
)

// sharedDay writes the shared calendar:
//   - resources of Москва-1: the vehicle of the fixtures (ИЗ-101), the driver a.driver-msk1, the therapist, Кабинет № 2
//     and № 3, the table, an inactive room with a booking tomorrow (listed) and an inactive one without (not listed);
//     of Москва-2: a meeting room;
//   - bookings: a trip of logistics on the driver 09:00–13:00 (a projection, trip TR-1), the maintenance of the
//     vehicle 08:00–20:00, the prototype day of the therapist, a meeting of Москва-2 09:30–10:30, a joint booking of
//     Кабинет № 3 and the room of Москва-2 16:00–17:00, a cancelled booking, one tomorrow and one next week.
func sharedDay(ctx context.Context) (day, error) {
	msk1, msk2 := unit("msk1"), unit("msk2")
	d, err := prototypeDay(ctx, 1, msk1, person("ab.member"))
	if err != nil {
		return d, err
	}
	steps := []func() error{
		func() (err error) {
			sharedVan, err = addResource(ctx, res{kind: kindVehicle, ref: ref("vehicle:a.msk1"), home: msk1, active: true})
			return err
		},
		func() (err error) {
			sharedDriver, err = addResource(ctx, res{kind: kindPerson, ref: person("a.driver-msk1"), home: msk1, active: true})
			return err
		},
		func() (err error) {
			sharedRoom3, err = addResource(ctx, res{kind: kindRoom, home: msk1, label: "Кабинет № 3", active: true})
			return err
		},
		func() (err error) {
			sharedMsk2Room, err = addResource(ctx, res{kind: kindRoom, home: msk2, label: "Переговорная Москвы-2", active: true})
			return err
		},
		func() (err error) {
			sharedInactive, err = addResource(ctx, res{kind: kindRoom, home: msk1, label: "Кабинет № 8", active: false})
			return err
		},
		func() (err error) {
			sharedHidden, err = addResource(ctx, res{kind: kindRoom, home: msk1, label: "Кабинет № 9", active: false})
			return err
		},
		func() error {
			trip := uuid.New()
			if _, err := superA.Exec(ctx, `insert into fleet.trips (id, number, unit_id, state, driver_person_id, planned)
				values ($1, 'TR-1', $2, 'planned', $3, tstzrange($4, $5, '[)'))`,
				trip, msk1, person("a.driver-msk1"), at(1, 9, 0), at(1, 13, 0)); err != nil {
				return err
			}
			var err error
			sharedTrip, err = addHold(ctx, "fleet.trip", trip, at(1, 9, 0), at(1, 13, 0), nil, sharedDriver)
			return err
		},
		func() (err error) {
			sharedTO, err = addBooking(ctx, bk{unit: msk1, title: "Плановое ТО", kind: "maintenance", module: "fleet",
				entity: "vehicle", start: at(1, 8, 0), end: at(1, 20, 0), resources: []uuid.UUID{sharedVan}, created: at(1, 0, 0)})
			return err
		},
		func() (err error) {
			sharedMsk2, err = addBooking(ctx, bk{unit: msk2, title: "Встреча Москвы-2", kind: "manual", start: at(1, 9, 30),
				end: at(1, 10, 30), resources: []uuid.UUID{sharedMsk2Room}, created: at(1, 0, 1)})
			return err
		},
		func() (err error) {
			sharedJoint, err = addBooking(ctx, bk{unit: msk1, title: "Совместная встреча", kind: "manual", start: at(1, 16, 0),
				end: at(1, 17, 0), resources: []uuid.UUID{sharedRoom3, sharedMsk2Room}, created: at(1, 0, 2)})
			return err
		},
		func() (err error) {
			sharedCancelled, err = addBooking(ctx, bk{unit: msk1, title: "Отменённая", kind: "manual", start: at(1, 17, 0),
				end: at(1, 18, 0), resources: []uuid.UUID{sharedRoom3}, cancelled: true, created: at(1, 0, 3)})
			return err
		},
		func() (err error) {
			sharedTomorrow, err = addBooking(ctx, bk{unit: msk1, title: "Уборка кабинета № 8", kind: "manual", start: at(2, 9, 0),
				end: at(2, 10, 0), resources: []uuid.UUID{sharedInactive}, created: at(1, 0, 4)})
			return err
		},
		func() (err error) {
			sharedNextWeek, err = addBooking(ctx, bk{unit: msk1, title: "На следующей неделе", kind: "manual", start: at(6, 10, 0),
				end: at(6, 11, 0), resources: []uuid.UUID{sharedRoom3}, created: at(1, 0, 5)})
			return err
		},
	}
	for _, step := range steps {
		if err := step(); err != nil {
			return d, err
		}
	}
	return d, nil
}

// freshDay is a prototype day on day dd of Москва-3 for a new specialist: the tests that reschedule work on it.
func freshDay(ctx context.Context, dd int) (day, error) {
	u := unit("msk3")
	p, err := addPerson(ctx, "Специалист "+uuid.NewString()[:8], u)
	if err != nil {
		return day{}, err
	}
	return prototypeDay(ctx, dd, u, p)
}
