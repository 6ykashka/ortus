package routes

import (
	"context"
	"errors"
	"maps"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/domain/fleetrules"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/vehicles" //nolint:depguard // W2.03: a trip holds a vehicle of the same module (W2.02)
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit"        //nolint:depguard // W2.03: shared command helpers of the modules (Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/modules/sched"          //nolint:depguard // W2.03: the scheduling core the trips hold their vehicles through (W2.02)
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// Texts of the answers of assignTripVehicle (the mock W2.00, trips.ts; «Рабочее место логиста» W2.20).
const (
	textVehicleNotFound = "Машина не найдена."
	textNotPlanned      = "Машину можно назначить только запланированному рейсу."
	textIncompatiblePre = "Нельзя назначить: "
	textVehicleTaken    = "Машину только что забронировали. Обновите список."
	textReplaced        = "Заменена новой бронью рейса."
)

// States of a trip a vehicle can be assigned to (TripState).
const (
	tripPlanned  = "planned"
	tripAssigned = "assigned"
)

// AssignTripVehicle implements fleetapi.StrictServerInterface: «Назначить на рейс» of the logist. The trip is planned or
// assigned (else 409 invalid_transition), If-Match is its revision; the vehicle is visible (fleet.vehicles.read),
// fits the cargo (fleetrules.Compat: 409 vehicle_incompatible «Нельзя назначить: …») and is free for the window of the
// trip. One transaction holds the vehicle — with the driver of the trip, if any — for the window (sched.Hold, source
// fleet.trip) in place of the earlier hold of the trip, and moves the trip to assigned. A taken vehicle is 409
// reservation_overlap, a taken driver 409 resources_unavailable.
//
// The locks go in the order of W2.02 (reserveVehicle after its fix of the review): the row of the trip, then the
// resources of the new and the replaced bundle (sched.Hold, which releases the replaced rows under them), then the row
// of the trip is written. Nothing of sched.reservations is written before sched.Hold locked the resources.
func (s *Server) AssignTripVehicle(ctx context.Context, req fleetapi.AssignTripVehicleRequestObject) (fleetapi.AssignTripVehicleResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	now := s.now()
	var out fleetapi.TripPlan
	err = kit.Tx(ctx, s.Pools, tc.TenantID, func(tx pgx.Tx) error {
		c := command{tx: tx, ev: s.within(tx, now), tc: tc, now: now}
		var err error
		out, err = c.assign(ctx, req.TripId, req.Body.VehicleId, req.Params.IfMatch)
		return err
	})
	if err != nil {
		return nil, dbError(err)
	}
	tag, replayed := kit.ETag(out.Revision), false
	return fleetapi.AssignTripVehicle200JSONResponse{
		Body: out,
		Headers: fleetapi.AssignTripVehicle200ResponseHeaders{
			CacheControl: noStore(), ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid(ctx),
		},
	}, nil
}

// tripRow is the row of a trip a vehicle is assigned to.
type tripRow struct {
	id, unit                    uuid.UUID
	number, state               string
	driver, prior               *uuid.UUID
	from, until                 time.Time
	weightKg, volumeM3, lengthM float64
	tempMin, tempMax            *float64
	revision                    int64
}

// rules is the trip as the rules of W2.01 see it: its cargo in tonnes and metres.
func (t tripRow) rules() fleetrules.Trip {
	cargo := fleetrules.Cargo{WeightT: t.weightKg / 1000, VolumeM3: t.volumeM3, LengthM: t.lengthM}
	if t.tempMin != nil && t.tempMax != nil {
		cargo.Temp = &fleetrules.TempRange{*t.tempMin, *t.tempMax}
	}
	return fleetrules.Trip{ID: t.id.String(), Cargo: cargo}
}

func (c command) assign(ctx context.Context, tripID, vehicleID uuid.UUID, ifMatch string) (fleetapi.TripPlan, error) {
	t, err := c.lockTrip(ctx, tripID)
	if err != nil {
		return fleetapi.TripPlan{}, err
	}
	if err := kit.CheckRevision(ifMatch, t.revision); err != nil {
		return fleetapi.TripPlan{}, err
	}
	if t.state != tripPlanned && t.state != tripAssigned {
		return fleetapi.TripPlan{}, kit.Conflict(textNotPlanned)
	}
	v, err := c.vehicle(ctx, vehicleID)
	if err != nil {
		return fleetapi.TripPlan{}, err
	}
	if fit := fleetrules.Compat(v.Rules(), t.rules()); !fit.Fit {
		return fleetapi.TripPlan{}, problem.New(codeIncompatible, textIncompatiblePre+strings.Join(misfits(fit), "; "))
	}
	if err := c.free(ctx, v, t); err != nil {
		return fleetapi.TripPlan{}, err
	}
	b, err := c.hold(ctx, t, v)
	if err != nil {
		return fleetapi.TripPlan{}, err
	}
	out, err := Plan(ctx, c.tx, t.id)
	if err != nil {
		return fleetapi.TripPlan{}, err
	}
	if err := c.recordHold(ctx, b); err != nil {
		return fleetapi.TripPlan{}, err
	}
	return out, kit.Complete(ctx, c.tx, http.StatusOK, kit.ETag(out.Revision), out)
}

// lockTrip reads and locks the trip id: a trip the actor cannot see (fleet.trips.read over its unit or its driver) is
// 404 like a missing one, a visible one without fleet.routes.manage over its unit is 403.
func (c command) lockTrip(ctx context.Context, id uuid.UUID) (tripRow, error) {
	var t tripRow
	err := c.tx.QueryRow(ctx, `select t.id, t.number, t.unit_id, t.state, t.driver_person_id, t.reservation_bundle_id,
		       lower(t.planned), upper(t.planned), t.cargo_weight_kg::float8, t.cargo_volume_m3::float8,
		       (coalesce(t.cargo_length_mm, 0) / 1000.0)::float8, t.cargo_temp_min_c::float8, t.cargo_temp_max_c::float8,
		       t.revision
		  from fleet.trips t where t.id = $1 for update`, id).
		Scan(&t.id, &t.number, &t.unit, &t.state, &t.driver, &t.prior, &t.from, &t.until, &t.weightKg, &t.volumeM3,
			&t.lengthM, &t.tempMin, &t.tempMax, &t.revision)
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
	err = c.ev.Permit(ctx, c.tc, ActionManage, authz.Resource{Unit: t.unit, Persons: persons, ReadAction: ActionTripsRead})
	if problem.Is(err, problem.CodeNotFound) {
		return tripRow{}, problem.New(problem.CodeNotFound, textTripNotFound)
	}
	return t, err
}

// vehicle reads the vehicle id with its state at the clock of the command; a vehicle the actor cannot see
// (fleet.vehicles.read over its unit) is 404 like a missing one.
func (c command) vehicle(ctx context.Context, id uuid.UUID) (vehicles.Row, error) {
	v, err := vehicles.Get(ctx, c.tx, id, c.now)
	if problem.Is(err, problem.CodeNotFound) {
		return vehicles.Row{}, problem.New(problem.CodeNotFound, textVehicleNotFound)
	}
	if err != nil {
		return vehicles.Row{}, err
	}
	err = c.ev.Permit(ctx, c.tc, actionVehicleRead, authz.Resource{Unit: v.Unit})
	if problem.Is(err, problem.CodeNotFound) || problem.Is(err, problem.CodeForbiddenAction) {
		return vehicles.Row{}, problem.New(problem.CodeNotFound, textVehicleNotFound)
	}
	return v, err
}

// misfits are the reasons of the failed measures of fit (payload, volume, length, temperature), without the
// availability: a busy vehicle is reservation_overlap, not incompatible.
func misfits(fit fleetrules.CompatResult) []string {
	var out []string
	for _, ch := range fit.Checks {
		if ch.OK || ch.Key == fleetrules.CheckAvail {
			continue
		}
		r := ch.Label + ": " + ch.Value
		if ch.Need != "" {
			r += ", нужно " + ch.Need
		}
		out = append(out, r)
	}
	return out
}

// free refuses a vehicle that cannot take the trip: out of service, with a blocking defect or on another trip now
// (vehicles.Row.Available), or kept for an overlapping window by another trip after its hold ended (the hold blocks
// overlaps until holdExpiresAt only; the trip keeps its vehicle until the driver reserves or the trip is cancelled).
// Overlapping live holds are refused by sched.Hold itself.
func (c command) free(ctx context.Context, v vehicles.Row, t tripRow) error {
	if !v.Available() {
		return problem.New(codeOverlap, textVehicleTaken)
	}
	var kept bool
	if err := c.tx.QueryRow(ctx, `select exists (select 1 from fleet.trips
		 where vehicle_id = $1 and id <> $2 and planned && tstzrange($3, $4, '[)')
		   and state in ('assigned', 'inspection', 'defect_review', 'on_route', 'returning', 'submitted', 'rework'))`,
		v.ID, t.id, t.from, t.until).Scan(&kept); err != nil {
		return err
	}
	if kept {
		return problem.New(codeOverlap, textVehicleTaken)
	}
	return nil
}

// assignment is the hold an assignment took.
type assignment struct {
	bundle, vehicle, unit uuid.UUID
	driver                *uuid.UUID
	trip                  tripRow
	expires               time.Time
	replaced              *liveHold
}

// hold holds the vehicle (and the driver of the trip) for the window of the trip in place of the earlier hold of the
// trip and writes the trip: assigned, with the vehicle and the bundle.
func (c command) hold(ctx context.Context, t tripRow, v vehicles.Row) (assignment, error) {
	life, err := ttl(ctx, c.tx)
	if err != nil {
		return assignment{}, err
	}
	a := assignment{bundle: uuid.New(), vehicle: v.ID, unit: v.Unit, driver: t.driver, trip: t, expires: c.now.Add(life)}
	var replaces uuid.UUID
	if t.prior != nil {
		replaces = *t.prior
		if a.replaced, err = c.live(ctx, replaces); err != nil {
			return assignment{}, err
		}
	}
	claims := []sched.Claim{{Kind: sched.KindVehicle, Ref: v.ID, Home: v.Unit}}
	if t.driver != nil {
		var home uuid.UUID
		if err := c.tx.QueryRow(ctx, `select home_unit_id from people.person_profiles where id = $1`, *t.driver).
			Scan(&home); err != nil {
			return assignment{}, err
		}
		claims = append(claims, sched.Claim{Kind: sched.KindPerson, Ref: *t.driver, Home: home})
	}
	err = sched.Hold(ctx, c.tx, sched.HoldRequest{
		Bundle: a.bundle, Claims: claims, Window: sched.Window{Start: t.from, End: t.until}, ExpiresAt: a.expires,
		SourceType: sourceTrip, SourceID: t.id, CreatedBy: c.tc.PersonID, Now: c.now, Replaces: replaces,
	})
	if oe, ok := errors.AsType[*sched.OverlapError](err); ok {
		if oe.Claim.Kind == sched.KindPerson {
			return assignment{}, problem.New(codeUnavailable, textDriverBusy)
		}
		return assignment{}, problem.New(codeOverlap, textVehicleTaken)
	}
	if err != nil {
		return assignment{}, err
	}
	_, err = c.tx.Exec(ctx, `update fleet.trips set vehicle_id = $2, reservation_bundle_id = $3, state = 'assigned',
		revision = revision + 1 where id = $1`, t.id, v.ID, a.bundle)
	return a, err
}

// liveHold is the vehicle row of a live hold (a hold before its end, or a confirmed reservation).
type liveHold struct {
	bundle, vehicle, unit uuid.UUID
}

// live reads the vehicle row of bundle when it is live at the clock of the command (nil: ended, released, or none). It
// writes nothing: it runs under the lock of the trip, before sched.Hold locks the resources, and sched.Hold releases
// exactly the rows live at the same instant.
func (c command) live(ctx context.Context, bundle uuid.UUID) (*liveHold, error) {
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
	return &h, nil
}

// recordHold writes the journal of the assignment: the audit row and fleet.reservation.held.v1 of the new hold (no
// restricted field: AC-05) and, for the live hold it took the place of, the release with its successor — as
// releaseReservation and reserveVehicle of W2.02 write them.
func (c command) recordHold(ctx context.Context, a assignment) error {
	diff := map[string]any{
		"vehicleId": a.vehicle, "tripId": a.trip.id, "startsAt": a.trip.from, "endsAt": a.trip.until,
		"holdExpiresAt": a.expires,
	}
	if a.driver != nil {
		diff["driverMemberId"] = *a.driver
	}
	if a.trip.prior != nil {
		diff["replaces"] = *a.trip.prior
	}
	if err := kit.Audit(ctx, c.tx, audit.Event{
		Action: "fleet.reservation.hold", TargetType: targetReservation, TargetID: a.bundle, UnitID: a.unit, Diff: diff,
	}); err != nil {
		return err
	}
	payload := map[string]any{"reservationId": a.bundle, "unitId": a.unit}
	maps.Copy(payload, diff)
	if _, err := events.Publish(ctx, c.tx, events.Event{
		Type: eventHeld, Aggregate: targetReservation, AggregateID: a.bundle, Payload: payload,
	}); err != nil {
		return err
	}
	if a.replaced == nil {
		return nil
	}
	h := a.replaced
	if err := kit.Audit(ctx, c.tx, audit.Event{
		Action: "fleet.reservation.release", TargetType: targetReservation, TargetID: h.bundle, UnitID: h.unit,
		Reason: textReplaced, Diff: map[string]any{"replacedBy": a.bundle},
	}); err != nil {
		return err
	}
	_, err := events.Publish(ctx, c.tx, events.Event{
		Type: eventReleased, Aggregate: targetReservation, AggregateID: h.bundle,
		Payload: map[string]any{"reservationId": h.bundle, "vehicleId": h.vehicle, "unitId": h.unit, "replacedBy": a.bundle},
	})
	return err
}
