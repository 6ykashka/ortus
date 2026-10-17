package trips

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/sched" //nolint:depguard // W2.05: the start consumes the hold of the scheduling core (W2.02)
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Audit and outbox names of the module.
const (
	targetTrip     = "fleet.trip"
	eventStarted   = "fleet.trip.started.v1"
	eventCompleted = "fleet.trip.route_completed.v1"
	eventSubmitted = "fleet.trip.submitted.v1"
)

// SQLSTATE of a unique violation (trips_active_driver_uq: the driver is on another trip).
const codeUniqueViolation = "23505"

const lockInspectionSQL = `
select id, trip_id, vehicle_id, kind, state,
       coalesce(nullif(answers->>'odometerKm', '')::numeric, odometer_km)::float8, submitted_at
  from fleet.inspections where id = $1 for update`

const reservationTripSQL = `select source_id from sched.reservations where id = $1 and source_type = 'fleet.trip'`

const lockTripSQL = `
select id, number, unit_id, state, vehicle_id, driver_person_id, reservation_bundle_id, departure_inspection_id,
       return_inspection_id, revision
  from fleet.trips where id = $1 for update`

// blockingSQL reports an open blocking defect of the trip or of its vehicle (defects_blocking_open_idx, AC-04).
const blockingSQL = `
select exists (select 1 from fleet.defects
 where severity = 'blocking' and state in ('open', 'in_review') and (trip_id = $1 or vehicle_id = $2))`

// legalEntitySQL is the legal entity of the company of a unit by default: the nearest unit up the tree (itself
// first) that has one; the oldest one of that unit (answer of 17.10, data model item 1).
const legalEntitySQL = `
select ule.legal_entity_id
  from org.unit_closure c
  join org.unit_legal_entities ule on ule.unit_id = c.ancestor_id
  join org.legal_entities le on le.id = ule.legal_entity_id
 where c.descendant_id = $1
 order by c.depth, le.created_at, le.id
 limit 1`

const startSQL = `
update fleet.trips
   set state = 'on_route', started_at = $2, legal_entity_id = coalesce(legal_entity_id, $3), revision = revision + 1
 where id = $1`

// lockInspection reads and locks inspection id (nil: none). It is the first lock of the start and of the return
// (the order of Q-W2.04-18: inspection → trip → reservation → vehicle).
func lockInspection(ctx context.Context, q querier, id uuid.UUID) (*inspRow, error) {
	var i inspRow
	err := q.QueryRow(ctx, lockInspectionSQL, id).Scan(&i.id, &i.trip, &i.vehicle, &i.kind, &i.state, &i.odometer, &i.submittedAt)
	if errNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("trips: inspection: %w", err)
	}
	return &i, nil
}

// lockTrip reads and locks trip id; missing — 404 with detail.
func lockTrip(ctx context.Context, q querier, id uuid.UUID, detail string) (tripRow, error) {
	var t tripRow
	err := q.QueryRow(ctx, lockTripSQL, id).Scan(&t.id, &t.number, &t.unit, &t.state, &t.vehicle, &t.driver, &t.bundle,
		&t.departure, &t.ret, &t.revision)
	if errNoRows(err) {
		return tripRow{}, problem.New(problem.CodeNotFound, detail)
	}
	if err != nil {
		return tripRow{}, fmt.Errorf("trips: trip: %w", err)
	}
	return t, nil
}

// authorize checks action of the subject on the locked trip t: invisible (fleet.trips.read over its unit or as its
// driver; a member with the driver function — only his trips) is 404 with detail, visible without the right — 403;
// only the driver of the trip (or the owner) drives it (driverText).
func (s *Service) authorize(ctx context.Context, q querier, tc tenantctx.TenantContext, t tripRow, action, detail, driverText string) error {
	own, err := driverOnly(ctx, q, tc, s.now())
	if err != nil {
		return err
	}
	if own && !same(t.driver, tc.PersonID) {
		return problem.New(problem.CodeNotFound, detail)
	}
	err = s.Authz.Permit(ctx, tc, action, authz.Resource{Unit: t.unit, Persons: persons(t.driver), ReadAction: actionRead})
	if problem.Is(err, problem.CodeNotFound) {
		return problem.New(problem.CodeNotFound, detail)
	}
	if err != nil {
		return err
	}
	if !tc.Owner && !same(t.driver, tc.PersonID) {
		return problem.New(problem.CodeForbiddenAction, driverText)
	}
	return nil
}

// Start starts a trip by its reservation and departure inspection (startTrip, S2-06): one online transaction
// (D-09 — no offline start) consumes the live hold (sched.Consume), checks that the inspection is the latest departure
// inspection of the trip and that no blocking defect is open (AC-04), moves the trip on the route with the legal
// entity of its company and writes the audit row, the outbox event and the notification of the managers. Two starts
// of one reservation queue on the locks: one succeeds, the other is 409.
func (s *Service) Start(ctx context.Context, tc tenantctx.TenantContext, b fleetapi.TripStart) (fleetapi.Trip, error) {
	if err := checkStart(&b); err != nil {
		return fleetapi.Trip{}, err
	}
	pool, err := s.pool(ctx, tc)
	if err != nil {
		return fleetapi.Trip{}, err
	}
	var out fleetapi.Trip
	err = inTx(ctx, pool, func(tx pgx.Tx) error {
		s := s.inTx(tx)
		insp, err := lockInspection(ctx, tx, b.DepartureInspectionId)
		if err != nil {
			return err
		}
		var tripID uuid.UUID
		if err := tx.QueryRow(ctx, reservationTripSQL, b.ReservationId).Scan(&tripID); errNoRows(err) {
			return problem.New(problem.CodeNotFound, textReservationNotFound)
		} else if err != nil {
			return fmt.Errorf("trips: reservation: %w", err)
		}
		t, err := lockTrip(ctx, tx, tripID, textReservationNotFound)
		if err != nil {
			return err
		}
		if err := s.authorize(ctx, tx, tc, t, actionStart, textReservationNotFound, textDriverOnlyStart); err != nil {
			return err
		}
		if out, err = s.start(ctx, tx, tc, t, b.ReservationId, insp); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusCreated, etag(out.Revision), out)
	})
	return out, dbError(err)
}

// start runs the start of the locked trip t the subject may start.
func (s *Service) start(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, t tripRow, reservation uuid.UUID, insp *inspRow) (fleetapi.Trip, error) {
	var vehicle uuid.UUID
	if t.vehicle != nil {
		vehicle = *t.vehicle
	}
	var blocking bool
	if err := tx.QueryRow(ctx, blockingSQL, t.id, vehicle).Scan(&blocking); err != nil {
		return fleetapi.Trip{}, fmt.Errorf("trips: blocking defects: %w", err)
	}
	if err := t.startable(reservation, insp, blocking); err != nil {
		return fleetapi.Trip{}, err
	}
	now := s.now()
	if err := consume(ctx, tx, t, reservation, now); err != nil {
		return fleetapi.Trip{}, err
	}
	plan, err := loadPlan(ctx, tx, t.id)
	if err != nil {
		return fleetapi.Trip{}, err
	}
	out, ok := tripOf(plan)
	if !ok {
		return fleetapi.Trip{}, fmt.Errorf("trips: trip %s did not start", t.id)
	}
	diff := map[string]any{"reservationId": reservation, "departureInspectionId": insp.id, "vehicleId": vehicle,
		"startedAt": now}
	ev, err := record(ctx, tx, tc, t, "fleet.trip.start", eventStarted, diff)
	if err != nil {
		return fleetapi.Trip{}, err
	}
	name, _, err := vehicleName(ctx, tx, vehicle)
	if err != nil {
		return fleetapi.Trip{}, err
	}
	return out, s.notifyManagers(ctx, tx, tc.TenantID, t, ev, noticeStarted, startedTitle(t.number, name))
}

// consume turns the hold of the reservation into the trip on the route: the live hold is consumed (an ended one is
// 409 reservation_expired), the trip takes the legal entity of its company when it has none, a driver already on
// another trip is 409 resources_unavailable (trips_active_driver_uq).
func consume(ctx context.Context, tx pgx.Tx, t tripRow, reservation uuid.UUID, now time.Time) error {
	_, err := sched.Consume(ctx, tx, reservation, now)
	switch {
	case errors.Is(err, sched.ErrExpired):
		return problem.New(codeExpired, textExpired)
	case errors.Is(err, sched.ErrNotHeld):
		return problem.New(codeInvalidTransition, textReservationUsed)
	case err != nil:
		return err
	}
	var entity *uuid.UUID
	if err := tx.QueryRow(ctx, legalEntitySQL, t.unit).Scan(&entity); err != nil && !errNoRows(err) {
		return fmt.Errorf("trips: legal entity: %w", err)
	}
	if _, err := tx.Exec(ctx, startSQL, t.id, now, entity); err != nil {
		if pe, ok := errors.AsType[*pgconn.PgError](err); ok && pe.Code == codeUniqueViolation {
			return problem.New(codeUnavailable, textDriverBusy)
		}
		return fmt.Errorf("trips: start: %w", err)
	}
	return nil
}

// record writes the audit row and the outbox event of a command on trip t (no restricted field: AC-05).
func record(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, t tripRow, action, event string, diff map[string]any) (uuid.UUID, error) {
	if err := audit.Record(ctx, tx, audit.Event{ActorKind: audit.ActorPerson, ActorID: tc.PersonID, Action: action,
		TargetType: targetTrip, TargetID: t.id, UnitID: t.unit, Result: audit.OK, RequestID: requestID(ctx), Diff: diff}); err != nil {
		return uuid.Nil, fmt.Errorf("trips: audit %s: %w", action, err)
	}
	payload := map[string]any{"tripId": t.id, "unitId": t.unit, "number": t.number}
	maps.Copy(payload, diff)
	id, err := events.Publish(ctx, tx, events.Event{Type: event, Aggregate: targetTrip, AggregateID: t.id, Payload: payload})
	if err != nil {
		return uuid.Nil, fmt.Errorf("trips: event %s: %w", event, err)
	}
	return id, nil
}

// vehicleName reads the name and the plate of a vehicle for the notifications.
func vehicleName(ctx context.Context, q querier, id uuid.UUID) (name, plate string, err error) {
	err = q.QueryRow(ctx, `select coalesce(display_name, ''), plate from fleet.vehicles where id = $1`, id).Scan(&name, &plate)
	if errNoRows(err) {
		return "", "", nil
	}
	if err != nil {
		return "", "", fmt.Errorf("trips: vehicle: %w", err)
	}
	return name, plate, nil
}
