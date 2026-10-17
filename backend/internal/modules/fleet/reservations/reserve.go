package reservations

import (
	"context"
	"encoding/json"
	"errors"
	"maps"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/domain/fleetrules"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/vehicles" //nolint:depguard // W2.02: the reservations hold the vehicles of the same module
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit"        //nolint:depguard // W2.02: shared command helpers of the modules (Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/modules/sched"          //nolint:depguard // W2.02: the scheduling core of the same work stream
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Texts of the answers (the mock W2.00, vehicles.ts; the screens «Моя смена», «Автомобили»).
const (
	textWindow          = "Проверьте интервал брони."
	textWindowPast      = "Время брони уже прошло. Выберите другое окно."
	textTimeZone        = "Неизвестный часовой пояс брони."
	textRoute           = "Маршрут не найден."
	textDriverUnknown   = "Водитель не найден."
	textNotADriver      = "Сотрудник не работает водителем в это время."
	textTripDriver      = "Бронь оформляется на водителя рейса."
	textTripStarted     = "Рейс уже в работе: бронь не нужна."
	textTripPeriod      = "Окно брони должно лежать в окне рейса."
	textTripNotFound    = "Рейс не найден."
	textVehicleTaken    = "Машина уже недоступна. Обновите список."
	textDriverBusy      = "Водитель уже занят в это время."
	textIncompatiblePre = "Машина не подходит рейсу: "
)

// Function of a person that reserves for itself only (people.work_profiles.function).
const functionDriver = "driver"

// States of a trip a reservation can be made for.
const (
	tripPlanned  = "planned"
	tripAssigned = vehicles.TripAssigned
)

// SQLSTATE of a unique violation (trips_active_vehicle_uq: the vehicle is in another active trip).
const codeUniqueViolation = "23505"

// reserveInput is a checked ReservationCreate.
type reserveInput struct {
	vehicle, driver uuid.UUID
	trip            *uuid.UUID
	window          sched.Window
	zone            string
}

func checkReserve(b *fleetapi.ReservationCreate, now time.Time) (reserveInput, error) {
	if b == nil {
		return reserveInput{}, problem.New(problem.CodeMalformedRequest, "")
	}
	in := reserveInput{
		vehicle: b.VehicleId, driver: b.DriverMemberId, trip: b.TripId,
		window: sched.Window{Start: b.Window.StartsAt.UTC(), End: b.Window.EndsAt.UTC()}, zone: b.Window.TimeZone,
	}
	switch {
	case b.RouteId != nil:
		return reserveInput{}, kit.Invalid(textRoute) // no routes before W2.03 (brief W2.02 §10 item 2)
	case !in.window.Valid():
		return reserveInput{}, kit.Invalid(textWindow)
	case !in.window.End.After(now):
		return reserveInput{}, kit.Invalid(textWindowPast)
	}
	if _, err := time.LoadLocation(in.zone); err != nil || in.zone == "" || strings.EqualFold(in.zone, "local") {
		return reserveInput{}, kit.Invalid(textTimeZone)
	}
	return in, nil
}

// ReserveVehicle implements fleetapi.StrictServerInterface: an atomic hold of the vehicle and the driver for the
// window (sched.Hold), until now + reservationTtlMinutes. A driver reserves for itself only; the vehicle must be
// visible (fleet.vehicles.read), the reservation allowed over its unit or the driver (fleet.reservations.create).
// With tripId: the trip of the driver, planned or assigned, its window around the window of the hold and its cargo
// fitting the vehicle (409 vehicle_incompatible with the reasons of fleetrules.Compat); the trip goes to inspection
// with the hold. A taken interval of the vehicle is 409 reservation_overlap, of the driver — resources_unavailable.
func (s *Server) ReserveVehicle(ctx context.Context, req fleetapi.ReserveVehicleRequestObject) (fleetapi.ReserveVehicleResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	now := s.now()
	in, err := checkReserve(req.Body, now)
	if err != nil {
		return nil, err
	}
	var out fleetapi.Reservation
	err = kit.Tx(ctx, s.Pools, tc.TenantID, func(tx pgx.Tx) error {
		c := command{s: s, tx: tx, ev: s.within(tx), tc: tc, now: now}
		var err error
		out, err = c.reserve(ctx, in)
		return err
	})
	if err != nil {
		return nil, dbError(err)
	}
	tag, replayed := kit.ETag(out.Revision), false
	return fleetapi.ReserveVehicle201JSONResponse{
		Body: out,
		Headers: fleetapi.ReserveVehicle201ResponseHeaders{
			CacheControl: noStore(), ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid(ctx),
		},
	}, nil
}

// command is one reservation command in its transaction.
type command struct {
	s   *Server
	tx  pgx.Tx
	ev  *authz.Evaluator
	tc  tenantctx.TenantContext
	now time.Time
}

func (c command) reserve(ctx context.Context, in reserveInput) (fleetapi.Reservation, error) {
	if err := c.selfOnly(ctx, in.driver); err != nil {
		return fleetapi.Reservation{}, err
	}
	v, err := vehicles.Get(ctx, c.tx, in.vehicle, c.now)
	if err != nil {
		return fleetapi.Reservation{}, err
	}
	if err := c.ev.Permit(ctx, c.tc, vehicles.ActionRead, authz.Resource{Unit: v.Unit}); err != nil {
		return fleetapi.Reservation{}, err
	}
	r := authz.Resource{Unit: v.Unit, Persons: []uuid.UUID{in.driver}, ReadAction: vehicles.ActionRead}
	if err := c.ev.Permit(ctx, c.tc, ActionCreate, r); err != nil {
		return fleetapi.Reservation{}, err
	}
	driverHome, err := c.driver(ctx, in.driver, in.window.Start)
	if err != nil {
		return fleetapi.Reservation{}, err
	}
	var t *trip
	if in.trip != nil {
		if t, err = c.trip(ctx, *in.trip, in, v); err != nil {
			return fleetapi.Reservation{}, err
		}
	}
	if !v.Available() {
		return fleetapi.Reservation{}, problem.New(codeOverlap, textVehicleTaken)
	}
	ttl, err := c.ttl(ctx)
	if err != nil {
		return fleetapi.Reservation{}, err
	}
	b := bundle{
		ID: uuid.New(), Vehicle: v.ID, Driver: in.driver, Unit: v.Unit, Zone: v.TimeZone,
		Start: in.window.Start, End: in.window.End, State: sched.StateHold, Source: SourceReservation,
		Revision: 1, CreatedBy: c.tc.PersonID,
	}
	expires := c.now.Add(ttl)
	b.Expires, b.SourceID = &expires, b.ID
	if t != nil {
		b.Source, b.SourceID = SourceTrip, t.id
	}
	if err := c.hold(ctx, b, driverHome, t); err != nil {
		return fleetapi.Reservation{}, err
	}
	out := b.dto(c.now)
	if err := c.record(ctx, b, out); err != nil {
		return fleetapi.Reservation{}, err
	}
	return out, kit.Complete(ctx, c.tx, http.StatusCreated, kit.ETag(out.Revision), out)
}

// selfOnly refuses a member with the work function «Водитель» a reservation for another driver (ReservationCreate:
// «Driver self-service can only reserve for their own memberId»; the mock answers forbidden_action). It is checked
// first: the answer tells nothing about the vehicle.
func (c command) selfOnly(ctx context.Context, driver uuid.UUID) error {
	if c.tc.Owner || driver == c.tc.PersonID {
		return nil
	}
	var isDriver bool
	if err := c.tx.QueryRow(ctx, `select exists (select 1 from people.work_profiles
		 where person_id = $1 and function = $2 and valid @> $3::timestamptz)`,
		c.tc.PersonID, functionDriver, c.now).Scan(&isDriver); err != nil {
		return err
	}
	if isDriver {
		return problem.New(problem.CodeForbiddenAction, "")
	}
	return nil
}

// driver checks the driver of the reservation: a person of the tenant in the area of the actor — the actor itself, or
// a person whose home unit is under fleet.reservations.create of the actor (brief §10 item 3) — with the function
// «Водитель» at the start of the window; it returns the home unit of the person (sched.resources.home_unit_id). A
// person the actor cannot see (members.read over the home unit) answers like one that does not exist, before its work
// function is looked at (AC-01); a person it sees outside the area of the right is 403.
func (c command) driver(ctx context.Context, person uuid.UUID, at time.Time) (uuid.UUID, error) {
	var (
		home   uuid.UUID
		driver bool
	)
	err := c.tx.QueryRow(ctx, `select p.home_unit_id, exists (select 1 from people.work_profiles w
		 where w.person_id = p.id and w.function = $2 and w.valid @> $3::timestamptz)
		  from people.person_profiles p where p.id = $1 and p.archived_at is null`, person, functionDriver, at).
		Scan(&home, &driver)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return uuid.Nil, kit.Invalid(textDriverUnknown)
	case err != nil:
		return uuid.Nil, err
	}
	if person != c.tc.PersonID {
		r := authz.Resource{Unit: home, Persons: []uuid.UUID{person}, ReadAction: actionMembersRead}
		err := c.ev.Permit(ctx, c.tc, ActionCreate, r)
		switch {
		case problem.Is(err, problem.CodeNotFound):
			return uuid.Nil, kit.Invalid(textDriverUnknown)
		case err != nil:
			return uuid.Nil, err
		}
	}
	if !driver {
		return uuid.Nil, kit.Invalid(textNotADriver)
	}
	return home, nil
}

// trip is the planned trip of a reservation.
type trip struct {
	id     uuid.UUID
	prior  *uuid.UUID // the hold the trip had (an assignment of the logist or an earlier reservation)
	number string
}

// tripRow is the row of a trip a reservation is checked against.
type tripRow struct {
	trip
	unit               uuid.UUID
	state              string
	driver             *uuid.UUID
	from, until        time.Time
	weightKg, volumeM3 float64
	lengthM            float64
	tempMin, tempMax   *float64
}

// trip checks the trip of the reservation under a lock of its row: visible to the actor (fleet.trips.read), of the
// driver of the reservation, not started yet, its window around the window of the hold, its cargo fitting the vehicle.
func (c command) trip(ctx context.Context, id uuid.UUID, in reserveInput, v vehicles.Row) (*trip, error) {
	t, err := c.visibleTrip(ctx, id)
	if err != nil {
		return nil, err
	}
	switch {
	case t.driver == nil || *t.driver != in.driver:
		return nil, kit.Invalid(textTripDriver)
	case t.state != tripPlanned && t.state != tripAssigned:
		return nil, problem.New(kit.CodeInvalidTransition, textTripStarted)
	case in.window.Start.Before(t.from) || in.window.End.After(t.until):
		return nil, kit.Invalid(textTripPeriod)
	}
	cargo := fleetrules.Cargo{WeightT: t.weightKg / 1000, VolumeM3: t.volumeM3, LengthM: t.lengthM}
	if t.tempMin != nil && t.tempMax != nil {
		cargo.Temp = &fleetrules.TempRange{*t.tempMin, *t.tempMax}
	}
	if fit := fleetrules.Compat(v.Rules(), fleetrules.Trip{ID: t.id.String(), Cargo: cargo}); !fit.Fit {
		return nil, problem.New(codeIncompatible, textIncompatiblePre+strings.Join(fit.Reasons, "; "))
	}
	return &t.trip, nil
}

// visibleTrip reads and locks the trip id; a trip the actor cannot see (fleet.trips.read over its unit or its driver)
// answers like a missing one.
func (c command) visibleTrip(ctx context.Context, id uuid.UUID) (tripRow, error) {
	var t tripRow
	err := c.tx.QueryRow(ctx, `select t.id, t.number, t.unit_id, t.state, t.driver_person_id, t.reservation_bundle_id,
		       lower(t.planned), upper(t.planned), t.cargo_weight_kg::float8, t.cargo_volume_m3::float8,
		       (coalesce(t.cargo_length_mm, 0) / 1000.0)::float8, t.cargo_temp_min_c::float8, t.cargo_temp_max_c::float8
		  from fleet.trips t where t.id = $1 for update`, id).
		Scan(&t.id, &t.number, &t.unit, &t.state, &t.driver, &t.prior, &t.from, &t.until, &t.weightKg, &t.volumeM3,
			&t.lengthM, &t.tempMin, &t.tempMax)
	if errors.Is(err, pgx.ErrNoRows) {
		return tripRow{}, problem.New(problem.CodeNotFound, textTripNotFound)
	}
	if err != nil {
		return tripRow{}, err
	}
	var persons []uuid.UUID
	if t.driver != nil {
		persons = []uuid.UUID{*t.driver}
	}
	err = c.ev.Permit(ctx, c.tc, actionTripsRead, authz.Resource{Unit: t.unit, Persons: persons})
	if problem.Is(err, problem.CodeNotFound) {
		return tripRow{}, problem.New(problem.CodeNotFound, textTripNotFound)
	}
	return t, err
}

// ttl is how long a hold lasts: reservationTtlMinutes of the settings of the module (5…120), else DefaultTTL.
func (c command) ttl(ctx context.Context) (time.Duration, error) {
	var raw []byte
	err := c.tx.QueryRow(ctx, `select settings from modules.installations
		 where module_key in ('fleet', 'logistics') order by module_key = 'fleet' desc limit 1`).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return DefaultTTL, nil
	}
	if err != nil {
		return 0, err
	}
	var settings struct {
		TTL *int `json:"reservationTtlMinutes"`
	}
	_ = json.Unmarshal(raw, &settings) // settings the module registry did not write fall back to the default
	if settings.TTL == nil || *settings.TTL < 5 || *settings.TTL > 120 {
		return DefaultTTL, nil
	}
	return time.Duration(*settings.TTL) * time.Minute, nil
}

// hold holds the vehicle and the driver in place of the earlier hold of the trip and moves the trip to inspection.
// The locks go in one order: the trip (visibleTrip), the resources of both holds (sched.Hold), only then the rows of
// the earlier hold — released inside sched.Hold, never before it (a parallel reservation of the vehicle waits for
// those rows while holding the vehicle).
func (c command) hold(ctx context.Context, b bundle, driverHome uuid.UUID, t *trip) error {
	var replaces uuid.UUID
	if t != nil && t.prior != nil {
		replaces = *t.prior
	}
	replaced, err := c.live(ctx, replaces)
	if err != nil {
		return err
	}
	err = sched.Hold(ctx, c.tx, sched.HoldRequest{
		Bundle: b.ID,
		Claims: []sched.Claim{
			{Kind: sched.KindVehicle, Ref: b.Vehicle, Home: b.Unit},
			{Kind: sched.KindPerson, Ref: b.Driver, Home: driverHome},
		},
		Window: sched.Window{Start: b.Start, End: b.End}, ExpiresAt: *b.Expires,
		SourceType: b.Source, SourceID: b.SourceID, CreatedBy: b.CreatedBy, Now: c.now, Replaces: replaces,
	})
	if oe, ok := errors.AsType[*sched.OverlapError](err); ok {
		if oe.Claim.Kind == sched.KindPerson {
			return problem.New(codeUnavailable, textDriverBusy)
		}
		return problem.New(codeOverlap, textVehicleTaken)
	}
	if err != nil || t == nil {
		return err
	}
	_, err = c.tx.Exec(ctx, `update fleet.trips set vehicle_id = $2, reservation_bundle_id = $3, state = 'inspection',
		revision = revision + 1 where id = $1`, t.id, b.Vehicle, b.ID)
	if pe, ok := errors.AsType[*pgconn.PgError](err); ok && pe.Code == codeUniqueViolation {
		return problem.New(codeOverlap, textVehicleTaken) // the vehicle is in another active trip
	}
	if err != nil {
		return err
	}
	for _, h := range replaced {
		if err := c.recordReplaced(ctx, h, b.ID); err != nil {
			return err
		}
	}
	return nil
}

// textReplaced is the reason of the release of a hold a reservation of its trip took the place of.
const textReplaced = "Заменена новой бронью рейса."

// liveHold is the vehicle row of a live hold (a hold before its end, or a confirmed reservation).
type liveHold struct {
	bundle, vehicle, unit uuid.UUID
}

// live reads the vehicle row of bundle when it is live at the clock of the command (none: uuid.Nil, ended or a
// bundle without a vehicle). It writes nothing: it runs under the lock of the trip, before sched.Hold locks the
// resources, and sched.Hold releases exactly the rows live at the same instant.
func (c command) live(ctx context.Context, bundle uuid.UUID) ([]liveHold, error) {
	if bundle == uuid.Nil {
		return nil, nil
	}
	h := liveHold{bundle: bundle}
	err := c.tx.QueryRow(ctx, `select s.ref_id, s.home_unit_id
		  from sched.reservations r join sched.resources s on s.id = r.resource_id and s.kind = 'vehicle'
		 where r.bundle_id = $1 and (r.state = 'confirmed' or (r.state = 'hold' and r.hold_expires_at > $2))
		 limit 1`, bundle, c.now).Scan(&h.vehicle, &h.unit)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return []liveHold{h}, nil
}

// recordReplaced writes the release of the hold h that the reservation by took the place of, as releaseReservation
// does: the audit with the reason and the outbox event with the successor (the journal of the reservation, W2.03).
func (c command) recordReplaced(ctx context.Context, h liveHold, by uuid.UUID) error {
	if err := kit.Audit(ctx, c.tx, audit.Event{
		Action: "fleet.reservation.release", TargetType: targetReservation, TargetID: h.bundle, UnitID: h.unit,
		Reason: textReplaced, Diff: map[string]any{"replacedBy": by},
	}); err != nil {
		return err
	}
	_, err := events.Publish(ctx, c.tx, events.Event{
		Type: eventReleased, Aggregate: targetReservation, AggregateID: h.bundle,
		Payload: map[string]any{"reservationId": h.bundle, "vehicleId": h.vehicle, "unitId": h.unit, "replacedBy": by},
	})
	return err
}

// record writes the audit row and the outbox event of a new hold (no restricted field: AC-05).
func (c command) record(ctx context.Context, b bundle, out fleetapi.Reservation) error {
	diff := map[string]any{
		"vehicleId": b.Vehicle, "driverMemberId": b.Driver, "startsAt": b.Start, "endsAt": b.End,
		"holdExpiresAt": out.HoldExpiresAt,
	}
	if out.TripId != nil {
		diff["tripId"] = *out.TripId
	}
	if err := kit.Audit(ctx, c.tx, audit.Event{
		Action: "fleet.reservation.hold", TargetType: targetReservation, TargetID: b.ID, UnitID: b.Unit, Diff: diff,
	}); err != nil {
		return err
	}
	payload := map[string]any{"reservationId": b.ID, "unitId": b.Unit}
	maps.Copy(payload, diff)
	_, err := events.Publish(ctx, c.tx, events.Event{
		Type: eventHeld, Aggregate: targetReservation, AggregateID: b.ID, Payload: payload,
	})
	return err
}
