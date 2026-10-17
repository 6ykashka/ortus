package review

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Actions of the module (api/permissions.yaml, fleet).
const (
	actionTripsRead     = "fleet.trips.read"
	actionTripsReview   = "fleet.trips.review"
	actionExpenseReview = "fleet.expenses.review"
)

// Audit and outbox names of the module.
const (
	targetTrip          = "fleet.trip"
	targetExpense       = "fleet.expense"
	eventTripReviewed   = "fleet.trip.reviewed.v1"
	eventExpenseChecked = "fleet.expense.reviewed.v1"
	noticeAccepted      = "fleet.trip.accepted"
	noticeRework        = "fleet.trip.rework_requested"
)

// States of fleet.trips.state the module looks at.
const (
	stateSubmitted = "submitted"
	stateRework    = "rework"
	stateAccepted  = "accepted"
)

// fieldDecision is the decision in the audit diff and the event payload.
const fieldDecision = "decision"

// noteMaintenance is the status note of a vehicle accepted with maintenance (the mock W2.00: «нужен ремонт»).
const noteMaintenance = "нужен ремонт"

// statuses is Trip.status of the 0.1 Trip of a started trip (as W2.05 fleet/trips).
var statuses = map[string]fleetapi.TripStatus{
	"on_route":     fleetapi.TripStatusInProgress,
	"returning":    fleetapi.TripStatusInProgress,
	stateRework:    fleetapi.TripStatusInProgress,
	stateSubmitted: fleetapi.TripStatusReturnedPendingReview,
	stateAccepted:  fleetapi.TripStatusApproved,
}

// tripRow is a trip a command locked.
type tripRow struct {
	id, unit             uuid.UUID
	number, state        string
	vehicle, driver, ret *uuid.UUID
	revision             int64
}

const lockTripSQL = `
select id, number, unit_id, state, vehicle_id, driver_person_id, return_inspection_id, revision
  from fleet.trips where id = $1 for update`

// lockTrip reads and locks trip id; missing — 404.
func lockTrip(ctx context.Context, tx pgx.Tx, id uuid.UUID) (tripRow, error) {
	var t tripRow
	err := tx.QueryRow(ctx, lockTripSQL, id).Scan(&t.id, &t.number, &t.unit, &t.state, &t.vehicle, &t.driver, &t.ret, &t.revision)
	if errNoRows(err) {
		return tripRow{}, problem.New(problem.CodeNotFound, textTripNotFound)
	}
	if err != nil {
		return tripRow{}, fmt.Errorf("review: trip: %w", err)
	}
	return t, nil
}

func same(p *uuid.UUID, id uuid.UUID) bool { return p != nil && *p == id }

// authorize checks action of the subject on the locked trip t: invisible (fleet.trips.read over its unit or as its
// driver; a member with the driver function — only his trips) is 404, visible without the right — 403; the driver of
// the trip never decides on his own shift (ownText).
func (s *Service) authorize(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, t tripRow, action, ownText string) error {
	only, err := driverOnly(ctx, tx, tc, s.now())
	if err != nil {
		return err
	}
	if only && !same(t.driver, tc.PersonID) {
		return problem.New(problem.CodeNotFound, textTripNotFound)
	}
	var persons []uuid.UUID
	if t.driver != nil {
		persons = []uuid.UUID{*t.driver}
	}
	err = s.Authz.Permit(ctx, tc, action, authz.Resource{Unit: t.unit, Persons: persons, ReadAction: actionTripsRead})
	if problem.Is(err, problem.CodeNotFound) {
		return problem.New(problem.CodeNotFound, textTripNotFound)
	}
	if err != nil {
		return err
	}
	if same(t.driver, tc.PersonID) {
		return problem.New(problem.CodeForbiddenAction, ownText)
	}
	return nil
}

// driverOnly reports whether the subject is a member with the work function «Водитель» now.
func driverOnly(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, now time.Time) (bool, error) {
	if tc.Owner || tc.PersonID == uuid.Nil {
		return false, nil
	}
	var yes bool
	err := tx.QueryRow(ctx, `select exists (select 1 from people.work_profiles
		 where person_id = $1 and function = 'driver' and valid @> $2::timestamptz)`, tc.PersonID, now).Scan(&yes)
	if err != nil {
		return false, fmt.Errorf("review: work functions: %w", err)
	}
	return yes, nil
}

// checkRevision compares If-Match with the current revision: missing — 428; anything but the strong ETag — 412.
func checkRevision(ifMatch string, current int64) error {
	v := strings.TrimSpace(ifMatch)
	switch {
	case v == "":
		return problem.New(codeRevisionRequired, "")
	case v != etag(current):
		return problem.New(codeRevisionMismatch, textStale)
	}
	return nil
}

// Review is the decision of the manager on a submitted shift (reviewTrip, S2-10). Accepted (approve or
// maintenance_required): the trip is accepted, the claimed expenses are confirmed (Q-W2.21-5) and the vehicle is
// released — no active trip holds it any more, its odometer takes the return inspection, the consumed reservation of
// the trip ends now, with maintenance it is «Недоступна · нужен ремонт». Rework: the trip goes back to the driver by
// sections, the vehicle stays held. Each decision is a round of fleet.trip_reviews with the audit row, the outbox event
// and the notification of the driver; earnings are a separate command (modules/finance, Q-55).
func (s *Service) Review(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b fleetapi.TripReview) (fleetapi.Trip, error) {
	if err := checkReview(&b); err != nil {
		return fleetapi.Trip{}, err
	}
	var out fleetapi.Trip
	err := s.inTx(ctx, tc, func(s *Service, tx pgx.Tx) error {
		t, err := lockTrip(ctx, tx, id)
		if err != nil {
			return err
		}
		if err := s.authorize(ctx, tx, tc, t, actionTripsReview, textOwnShift); err != nil {
			return err
		}
		if err := checkRevision(ifMatch, t.revision); err != nil {
			return err
		}
		if t.state != stateSubmitted {
			return problem.New(codeInvalidTransition, textProcessed)
		}
		if out, err = s.decide(ctx, tx, tc, t, b); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusOK, etag(out.Revision), out)
	})
	return out, err
}

const insertReviewSQL = `
insert into fleet.trip_reviews (trip_id, attempt, decision, comment, steps, reviewed_by, reviewed_at)
select $1, coalesce(max(attempt), 0) + 1, $2, $3, $4, $5, $6 from fleet.trip_reviews where trip_id = $1
returning attempt`

// decide writes the round of the review of the locked submitted trip t and applies it.
func (s *Service) decide(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, t tripRow, b fleetapi.TripReview) (fleetapi.Trip, error) {
	now := s.now()
	steps := []string{}
	if b.Steps != nil {
		for _, st := range *b.Steps {
			steps = append(steps, string(st))
		}
	}
	var comment *string
	if !blank(b.Comment) {
		c := strings.TrimSpace(*b.Comment)
		comment = &c
	}
	var attempt int64
	if err := tx.QueryRow(ctx, insertReviewSQL, t.id, string(b.Decision), comment, steps, tc.PersonID, now).Scan(&attempt); err != nil {
		return fleetapi.Trip{}, fmt.Errorf("review: round: %w", err)
	}
	confirmed := int64(0)
	if b.Decision == fleetapi.TripReviewDecisionRework {
		if _, err := tx.Exec(ctx, `update fleet.trips set state = 'rework', revision = revision + 1 where id = $1`, t.id); err != nil {
			return fleetapi.Trip{}, fmt.Errorf("review: rework: %w", err)
		}
	} else {
		var err error
		if confirmed, err = accept(ctx, tx, tc, t, b.Decision == fleetapi.TripReviewDecisionMaintenanceRequired, now); err != nil {
			return fleetapi.Trip{}, err
		}
	}
	out, err := readTrip(ctx, tx, t.id)
	if err != nil {
		return fleetapi.Trip{}, err
	}
	diff := map[string]any{fieldDecision: b.Decision, "attempt": attempt, "steps": steps, "confirmedExpenses": confirmed}
	if comment != nil {
		diff["comment"] = *comment
	}
	ev, err := record(ctx, tx, tc, audit.Event{Action: "fleet.trip.review", TargetType: targetTrip, TargetID: t.id, UnitID: t.unit, Diff: diff},
		events.Event{Type: eventTripReviewed, Aggregate: targetTrip, AggregateID: t.id, Payload: map[string]any{
			"tripId": t.id, "unitId": t.unit, "number": t.number, fieldDecision: b.Decision, "attempt": attempt, "steps": steps}})
	if err != nil {
		return fleetapi.Trip{}, err
	}
	kind, severity := noticeAccepted, inbox.SeverityInfo
	title := acceptedTitle(t.number, b.Decision == fleetapi.TripReviewDecisionMaintenanceRequired)
	if b.Decision == fleetapi.TripReviewDecisionRework {
		kind, severity, title = noticeRework, inbox.SeverityWarning, reworkTitle(t.number, *comment)
	}
	return out, s.notifyDriver(ctx, tx, tc.TenantID, t, ev, kind, severity, title)
}

const (
	acceptSQL = `update fleet.trips set state = 'accepted', reviewed_at = $2, reviewed_by = $3, revision = revision + 1
	 where id = $1`
	confirmExpensesSQL = `update fleet.expenses set state = 'verified', reviewed_by = $2, reviewed_at = $3, revision = revision + 1
	 where trip_id = $1 and state = 'claimed'`
	// releaseVehicleSQL: the odometer of the vehicle takes the return inspection (never decreases); with maintenance
	// the vehicle is out of service until the repair («Недоступна · нужен ремонт»).
	releaseVehicleSQL = `
update fleet.vehicles v
   set odometer_km = greatest(v.odometer_km, coalesce((select coalesce(nullif(i.answers->>'odometerKm', '')::numeric, i.odometer_km)
                                                          from fleet.inspections i where i.id = $2), v.odometer_km)),
       service_state = case when $3 then 'maintenance' else v.service_state end,
       service_note = case when $3 then $4 else v.service_note end,
       revision = v.revision + 1
 where v.id = $1`
	// endReservationSQL ends the consumed reservation of the trip (the vehicle and the driver of the bundle) at the
	// acceptance: the rest of the planned interval is free for a new hold (reservations_no_overlap).
	endReservationSQL = `
update sched.reservations
   set during = tstzrange(lower(during), $2), occupied = tstzrange(lower(occupied), $2), revision = revision + 1
 where source_type = 'fleet.trip' and source_id = $1 and state = 'consumed' and lower(during) < $2 and upper(occupied) > $2`
)

// accept accepts the locked trip t: the trip, its waiting expenses, its vehicle and its reservation. It returns the
// number of the confirmed expenses.
func accept(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, t tripRow, maintenance bool, now time.Time) (int64, error) {
	if _, err := tx.Exec(ctx, acceptSQL, t.id, now, tc.PersonID); err != nil {
		return 0, fmt.Errorf("review: accept: %w", err)
	}
	tag, err := tx.Exec(ctx, confirmExpensesSQL, t.id, tc.PersonID, now)
	if err != nil {
		return 0, fmt.Errorf("review: confirm expenses: %w", err)
	}
	if t.vehicle != nil {
		if _, err := tx.Exec(ctx, releaseVehicleSQL, *t.vehicle, t.ret, maintenance, noteMaintenance); err != nil {
			return 0, fmt.Errorf("review: release vehicle: %w", err)
		}
	}
	if _, err := tx.Exec(ctx, endReservationSQL, t.id, now); err != nil {
		return 0, fmt.Errorf("review: end reservation: %w", err)
	}
	return tag.RowsAffected(), nil
}

const tripSQL = `
select id, vehicle_id, driver_person_id, unit_id, departure_inspection_id, return_inspection_id, state, started_at,
       returned_at, revision
  from fleet.trips where id = $1`

// readTrip reads the 0.1 Trip of a started trip in the transaction of a command that checked access.
func readTrip(ctx context.Context, tx pgx.Tx, id uuid.UUID) (fleetapi.Trip, error) {
	var (
		out                        fleetapi.Trip
		vehicle, driver, departure *uuid.UUID
		state                      string
		started                    *time.Time
	)
	if err := tx.QueryRow(ctx, tripSQL, id).Scan(&out.Id, &vehicle, &driver, &out.OrgUnitId, &departure, &out.ReturnInspectionId,
		&state, &started, &out.ReturnedAt, &out.Revision); err != nil {
		return fleetapi.Trip{}, fmt.Errorf("review: read back: %w", err)
	}
	status, ok := statuses[state]
	if !ok || vehicle == nil || driver == nil || departure == nil || started == nil {
		return fleetapi.Trip{}, fmt.Errorf("review: trip %s has no 0.1 projection", id)
	}
	out.VehicleId, out.DriverMemberId, out.DepartureInspectionId, out.Status = *vehicle, *driver, *departure, status
	out.StartedAt = started.UTC()
	if out.ReturnedAt != nil {
		r := out.ReturnedAt.UTC()
		out.ReturnedAt = &r
	}
	return out, nil
}

// record writes the audit row and the outbox event of a command (no restricted field: AC-05).
func record(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, a audit.Event, e events.Event) (uuid.UUID, error) {
	a.ActorKind, a.ActorID, a.Result, a.RequestID = audit.ActorPerson, tc.PersonID, audit.OK, requestID(ctx)
	if err := audit.Record(ctx, tx, a); err != nil {
		return uuid.Nil, fmt.Errorf("review: audit %s: %w", a.Action, err)
	}
	id, err := events.Publish(ctx, tx, e)
	if err != nil {
		return uuid.Nil, fmt.Errorf("review: event %s: %w", e.Type, err)
	}
	return id, nil
}
