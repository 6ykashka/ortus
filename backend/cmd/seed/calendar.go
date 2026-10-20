package main

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Calendar part of the seed (W4.40, CAL-01…05): the resources and the bookings of calendarSeed of the domain W0.12
// (extra-data.js 14.10:4–23) with the ids of PD-30 — the MSW adapter of W4.06 builds the same ids (seedUuid of the
// tenant), so the calendar shows the same rows in mock and on the stand.
//
//   - «Альта»: the vehicles v1, v6, v4 and the driver Илья Васильев of «Север Логистик», the salon — Анна Морозова,
//     Кабинет № 2 и № 3, Стол с подогревом — in «Москва» (the org structure of «Альта» has no salon, Q-W4.06-3 as
//     MSW); the maintenance of ГАЗон, three visits and the break. The trip Р-208 is not a booking of the seed: its
//     driver reserves the vehicle on the stand (W2.02), and the calendar shows that hold (the projection of W4.40);
//     a booking of the driver written here would take his time from the reservation of logistics.
//   - «Лотос»: the salon at «Лотос · Арбат» and the bookings on it, without the vehicles, the driver and the trip of
//     «Альта» (PD-27: the leak of the prototype is not repeated).
//
// The prototype lives on 01.10.2026; the stand runs on the real clock, so the bookings take the hours of the
// prototype on the day of the run of the seed (Moscow). A booking already in the database is left as it is.

// calResource is a resource of the seed: the kind of sched.resources, the label of the prototype, the unit and the
// source — the vehicle or the member proto ("" for a room and equipment).
type calResource struct {
	proto, kind, label, unit, ref string
}

// calBooking is a booking of the seed: its source kind, the source object proto ("" — a break), the resources, the
// local hours of the prototype and the buffers in minutes.
type calBooking struct {
	proto, title, kind, source string
	resources                  []string
	from, until                string
	prep, cleanup              int
}

type calendarData struct {
	resources []calResource
	bookings  []calBooking
}

// Resources and bookings of the prototype (calendarSeed, extra-data.js 14.10).
const (
	resVan     = "res-v4"
	resAnna    = "res-am"
	resRoom2   = "res-room2"
	resTable   = "res-table"
	kindAppt   = "appointment"
	kindVeh    = "vehicle"
	moduleSpa  = "spa"
	vasiliev   = "m-vasiliev"
	twoPM      = "14:00" // the end of the break and the start of «Массаж спины»
	salonLotos = "f-lotos-arb"
)

func salon(unit, member string) []calResource {
	return []calResource{
		{resAnna, "person", "Анна Морозова · массажист", unit, member},
		{resRoom2, "room", "Кабинет № 2", unit, ""},
		{"res-room3", "room", "Кабинет № 3", unit, ""},
		{resTable, "equipment", "Стол с подогревом", unit, ""},
	}
}

// visits are the visits and the break of Анна Морозова of the prototype day, in the order of the seed.
func visits() []calBooking {
	return []calBooking{
		{"b-a1", "Классический массаж · Мария К.", kindAppt, "ap-1", []string{resAnna, resRoom2}, "10:00", "11:00", 0, 15},
		{"b-a2", "SPA-ритуал · Ольга Р.", kindAppt, "ap-2", []string{resAnna, resRoom2, resTable}, "11:30", "13:00", 15, 15},
		{"b-a3", "Массаж спины · Екатерина Л.", kindAppt, "ap-3", []string{resAnna, resRoom2}, twoPM, "14:45", 0, 15},
		{"b-br", "Перерыв", "break", "", []string{resAnna}, "13:15", twoPM, 0, 0},
	}
}

// calendarSeeds are the calendars of the tenants.
var calendarSeeds = map[string]calendarData{
	protoAlta: {
		resources: append([]calResource{
			{"res-v1", kindVeh, "ГАЗель Next · А 412 МР", homeAlta, "v1"},
			{"res-v6", kindVeh, "Mercedes Sprinter · Т 771 ЕХ", homeAlta, "v6"},
			{resVan, kindVeh, "ГАЗон Next · Е 905 НА", homeAlta, "v4"},
			{"res-iv", "person", "Илья Васильев · водитель", homeAlta, vasiliev},
		}, salon(regionMsk, memberMoroz)...),
		bookings: append([]calBooking{
			{"b-to", "Плановое ТО", "maintenance", "v4", []string{resVan}, "08:00", "20:00", 0, 0},
		}, visits()...),
	},
	protoLotos: {resources: salon(salonLotos, memberMoroz), bookings: visits()},
}

// calendarDay is the start of the day of now in Moscow — the day of the bookings of the seed.
func calendarDay(now time.Time) time.Time {
	l := now.In(msk)
	return time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, msk)
}

// calendarClock is the moment of the local time label «HH:MM» of the prototype on day.
func calendarClock(day time.Time, label string) time.Time {
	t, err := time.ParseInLocation("15:04", label, msk)
	if err != nil {
		panic("seed: time label " + label) // the labels are constants of this file
	}
	return day.Add(time.Duration(t.Hour())*time.Hour + time.Duration(t.Minute())*time.Minute)
}

// writeCalendar writes the calendar of td for the run of the seed now.
func writeCalendar(ctx context.Context, tx *sql.Tx, td tenantData) error {
	return writeCalendarAt(ctx, tx, td, time.Now())
}

// writeCalendarAt writes the resources and the bookings of td on the day of now; a second run changes nothing.
func writeCalendarAt(ctx context.Context, tx *sql.Tx, td tenantData, now time.Time) error {
	c, ok := calendarSeeds[td.tenant.proto]
	if !ok {
		return nil
	}
	id := func(proto string) uuid.UUID { return seedID(td.tenant.proto, proto) }
	resources := map[string]uuid.UUID{}
	units := map[string]string{}
	for _, r := range c.resources {
		rid, err := writeCalendarResource(ctx, tx, td, r)
		if err != nil {
			return err
		}
		resources[r.proto], units[r.proto] = rid, r.unit
	}
	day, owner := calendarDay(now), id(memberOwner)
	for i, b := range c.bookings {
		from, until := calendarClock(day, b.from), calendarClock(day, b.until)
		var module, entity, source any
		switch b.kind {
		case kindAppt:
			module, entity, source = moduleSpa, kindAppt, id(b.source)
		case "maintenance":
			module, entity, source = "fleet", kindVeh, id(b.source)
		}
		bid := id(b.proto)
		res, err := tx.ExecContext(ctx, `insert into sched.bookings (id, org_unit_id, title, source_kind, source_module,
			source_type, source_id, during, time_zone, prep_minutes, cleanup_minutes, created_by, created_at)
			values ($1, $2, $3, $4, $5, $6, $7, tstzrange($8, $9, '[)'), $10, $11, $12, $13, $14)
			on conflict (id) do nothing`,
			bid, td.unitID(units[b.resources[0]]), b.title, b.kind, module, entity, source, from, until, tzMoscow,
			b.prep, b.cleanup, owner, fleetRegistered.Add(time.Duration(i)*time.Second))
		if err != nil {
			return fmt.Errorf("booking %s: %w", b.proto, err)
		}
		n, err := res.RowsAffected()
		if err != nil {
			return fmt.Errorf("booking %s: %w", b.proto, err)
		}
		if n == 0 {
			continue // written by an earlier run: left as it is
		}
		occFrom, occTo := from.Add(-time.Duration(b.prep)*time.Minute), until.Add(time.Duration(b.cleanup)*time.Minute)
		for _, r := range b.resources {
			if _, err := tx.ExecContext(ctx, `insert into sched.reservations (id, resource_id, bundle_id, during, occupied,
				state, source_type, source_id, created_by, created_at)
				values ($1, $2, $3, tstzrange($4, $5, '[)'), tstzrange($6, $7, '[)'), 'confirmed', 'sched.booking', $3, $8, $9)
				on conflict (id) do nothing`,
				id("reservation:"+b.proto+":"+r), resources[r], bid, from, until, occFrom, occTo, owner,
				fleetRegistered.Add(time.Duration(i)*time.Second)); err != nil {
				return fmt.Errorf("booking %s: reservation of %s: %w", b.proto, r, err)
			}
		}
	}
	return nil
}

// writeCalendarResource writes a resource and returns its id: a vehicle or a person already registered by a hold of
// logistics (unique kind and source) keeps its row, and the seed writes nothing over it.
func writeCalendarResource(ctx context.Context, tx *sql.Tx, td tenantData, r calResource) (uuid.UUID, error) {
	rid := seedID(td.tenant.proto, r.proto)
	var ref any
	if r.ref != "" {
		ref = seedID(td.tenant.proto, r.ref)
	}
	if _, err := tx.ExecContext(ctx, `insert into sched.resources (id, kind, ref_id, home_unit_id, label)
		values ($1, $2, $3, $4, $5) on conflict do nothing`, rid, r.kind, ref, td.unitID(r.unit), r.label); err != nil {
		return uuid.Nil, fmt.Errorf("resource %s: %w", r.proto, err)
	}
	if ref == nil {
		return rid, nil
	}
	err := tx.QueryRowContext(ctx, `select id from sched.resources where kind = $1 and ref_id = $2`, r.kind, ref).Scan(&rid)
	if err != nil {
		return uuid.Nil, fmt.Errorf("resource %s: %w", r.proto, err)
	}
	return rid, nil
}
