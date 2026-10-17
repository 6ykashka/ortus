package inspections

import (
	"context"
	"errors"
	"fmt"
	"net/http"
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

// decision is a defect locked for a decision with what the decision changes.
type decision struct {
	id         uuid.UUID
	state      string
	revision   int64
	inspection uuid.UUID
	vehicle    uuid.UUID
	unit       uuid.UUID
	reporter   *uuid.UUID
	trip       *uuid.UUID
	tripState  *string
	number     *string
	driver     *uuid.UUID
}

// lockInspectionSQL locks the inspection of the defect ($1) before the defect is read: the decisions on the defects of
// one inspection run one after another, so the last one sees the others decided (READ COMMITTED: every later
// statement reads what the previous decision committed) and approves the inspection and moves the trip.
const lockInspectionSQL = `
select i.id from fleet.inspections i
 where i.id = (select d.inspection_id from fleet.defects d where d.id = $1)
   for update of i`

const lockDefectSQL = `
select d.id, d.state, d.revision, d.inspection_id, d.vehicle_id, v.unit_id, coalesce(d.reported_by, i.submitted_by),
       d.trip_id, t.state, t.number, t.driver_person_id
  from fleet.defects d
  join fleet.vehicles v on v.id = d.vehicle_id
  join fleet.inspections i on i.id = d.inspection_id
  left join fleet.trips t on t.id = d.trip_id
 where d.id = $1
   for update of d`

// Decide applies the decision of the responsible manager or the owner to a blocking defect in the queue
// (decideInspectionDefect, S2-17): allow_departure resolves it and returns the trip to the departure with the vehicle
// held again; confirm_out_of_service keeps the vehicle out of service, releases the reservation and returns the trip
// to planning. A defect that is not in_review — 409 «Дефект уже решён.» (checked before If-Match: another manager
// decided). The decision is audited, published and told to the driver.
func (s *Service) Decide(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b fleetapi.DefectDecision) (fleetapi.InspectionDefect, error) {
	pool, err := s.pool(ctx, tc)
	if err != nil {
		return fleetapi.InspectionDefect{}, err
	}
	var out fleetapi.InspectionDefect
	err = inTx(ctx, pool, func(tx pgx.Tx) error {
		s := s.inTx(tx)
		d, err := s.lockDefect(ctx, tx, tc, id)
		if err != nil {
			return err
		}
		switch {
		case d.state != stateInReview:
			return problem.New(codeInvalidTransition, detailDecided)
		case checkRevision(ifMatch, d.revision) != nil:
			return checkRevision(ifMatch, d.revision)
		}
		if err := validateDecision(b); err != nil {
			return err
		}
		if err := s.apply(ctx, tx, tc, d, b); err != nil {
			return err
		}
		if out, err = scanDefect(tx.QueryRow(ctx, defectSelect+` where d.id = $1`, id)); err != nil {
			return fmt.Errorf("inspections: read back: %w", err)
		}
		return complete(ctx, tx, http.StatusOK, etag(out.Revision), out)
	})
	return out, err
}

// lockDefect locks the inspection of the defect, then the defect, and checks the subject: an invisible defect
// (fleet.inspections.read) is 404, a visible one without fleet.inspections.review over the unit of its vehicle is 403.
func (s *Service) lockDefect(ctx context.Context, tx querier, tc tenantctx.TenantContext, id uuid.UUID) (decision, error) {
	var d decision
	err := tx.QueryRow(ctx, lockInspectionSQL, id).Scan(&d.inspection)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return decision{}, problem.New(problem.CodeNotFound, "")
	case err != nil:
		return decision{}, fmt.Errorf("inspections: lock inspection: %w", err)
	}
	err = tx.QueryRow(ctx, lockDefectSQL, id).Scan(&d.id, &d.state, &d.revision, &d.inspection, &d.vehicle, &d.unit,
		&d.reporter, &d.trip, &d.tripState, &d.number, &d.driver)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return decision{}, problem.New(problem.CodeNotFound, "")
	case err != nil:
		return decision{}, fmt.Errorf("inspections: defect: %w", err)
	}
	if err := s.Authz.Permit(ctx, tc, actionRead, authz.Resource{Unit: d.unit, Persons: persons(d.reporter, d.driver)}); err != nil {
		return decision{}, err
	}
	if err := s.Authz.Permit(ctx, tc, actionReview, authz.Resource{Unit: d.unit}); err != nil {
		if hidden(err) {
			return decision{}, problem.New(problem.CodeForbiddenAction, "")
		}
		return decision{}, err
	}
	return d, nil
}

const decideSQL = `
update fleet.defects set state = $2, decision = $3, decision_comment = $4, resolved_by = $5, resolved_at = $6,
       revision = revision + 1
 where id = $1`

// apply writes the decision and its effects, the audit row, the event and the notification of the driver.
func (s *Service) apply(ctx context.Context, tx querier, tc tenantctx.TenantContext, d decision, b fleetapi.DefectDecision) error {
	now := s.now()
	state := stateResolved
	if b.Decision == decisionConfirm {
		state = stateConfirmed
	}
	var comment any
	if b.Comment != nil && !blank(*b.Comment) {
		comment = *b.Comment
	}
	if _, err := tx.Exec(ctx, decideSQL, d.id, state, string(b.Decision), comment, tc.PersonID, now); err != nil {
		return fmt.Errorf("inspections: decide: %w", err)
	}
	var err error
	if b.Decision == decisionConfirm {
		err = confirm(ctx, tx, d)
	} else {
		err = allow(ctx, tx, d, now)
	}
	if err != nil {
		return err
	}
	if err := audit.Record(ctx, tx, audit.Event{
		ActorKind: audit.ActorPerson, ActorID: tc.PersonID, Action: "fleet.defect.decide", TargetType: "fleet.defect",
		TargetID: d.id, UnitID: d.unit, Result: audit.OK, RequestID: requestID(ctx),
		Diff: map[string]any{"decision": string(b.Decision), "from": d.state, "to": state},
	}); err != nil {
		return err
	}
	return s.publishDecision(ctx, tx, tc.TenantID, d, string(b.Decision))
}

// tripReviewed is the guard of a trip move by a decision: the trip still waits for the review of this inspection
// (W2.02 may have released it, a confirmed fault may have sent it back to planning and another attempt begun).
const tripReviewed = ` and state = 'defect_review' and departure_inspection_id = $2`

// allow: the defect is not critical. When no other defect of the inspection waits and none is confirmed (a confirmed
// fault keeps the inspection rejected and the trip in planning), the inspection is approved and a trip in
// defect_review goes back to the departure: its reservation is held again for holdTTL, the note of the vehicle is
// cleared.
func allow(ctx context.Context, tx querier, d decision, now time.Time) error {
	var pending bool
	if err := tx.QueryRow(ctx, `select exists (select 1 from fleet.defects where inspection_id = $1 and state in ($2, $3))`,
		d.inspection, stateInReview, stateConfirmed).Scan(&pending); err != nil {
		return fmt.Errorf("inspections: other defects: %w", err)
	}
	if pending {
		return nil
	}
	if _, err := tx.Exec(ctx, `update fleet.inspections set state = 'approved', revision = revision + 1 where id = $1 and state = 'blocked'`,
		d.inspection); err != nil {
		return fmt.Errorf("inspections: approve: %w", err)
	}
	if d.trip == nil || d.tripState == nil || *d.tripState != "defect_review" {
		return nil
	}
	moved, err := tx.Exec(ctx, `update fleet.trips set state = 'inspection', revision = revision + 1 where id = $1`+tripReviewed,
		*d.trip, d.inspection)
	if err != nil {
		return fmt.Errorf("inspections: trip back to departure: %w", err)
	}
	if moved.RowsAffected() == 0 {
		return nil
	}
	// The confirmed reservation already holds the interval (reservations_no_overlap counts hold and confirmed alike):
	// turning it back into a hold cannot collide with another one.
	if _, err := tx.Exec(ctx, `update sched.reservations set state = 'hold', hold_expires_at = $2, revision = revision + 1
	                            where source_type = 'fleet.trip' and source_id = $1 and state = 'confirmed'`, *d.trip, now.Add(holdTTL)); err != nil {
		return fmt.Errorf("inspections: hold again: %w", err)
	}
	if _, err := tx.Exec(ctx, `update fleet.vehicles set service_note = null, revision = revision + 1 where id = $1 and service_note = $2`,
		d.vehicle, noteBlocked); err != nil {
		return fmt.Errorf("inspections: vehicle note: %w", err)
	}
	return nil
}

// confirm: the fault is confirmed. The vehicle stays out of service («неисправность подтверждена»); a trip in
// defect_review loses the vehicle and its reservation and goes back to planning (the departure is done again with
// another vehicle, attempt + 1).
func confirm(ctx context.Context, tx querier, d decision) error {
	if _, err := tx.Exec(ctx, `update fleet.inspections set revision = revision + 1 where id = $1`, d.inspection); err != nil {
		return fmt.Errorf("inspections: reject: %w", err)
	}
	if _, err := tx.Exec(ctx, `update fleet.vehicles set service_state = 'out_of_service', service_note = $2, revision = revision + 1
	                            where id = $1`, d.vehicle, noteConfirmed); err != nil {
		return fmt.Errorf("inspections: out of service: %w", err)
	}
	if d.trip == nil || d.tripState == nil || *d.tripState != "defect_review" {
		return nil
	}
	moved, err := tx.Exec(ctx, `update fleet.trips set state = 'planned', vehicle_id = null, departure_inspection_id = null,
	                                  revision = revision + 1 where id = $1`+tripReviewed, *d.trip, d.inspection)
	if err != nil {
		return fmt.Errorf("inspections: trip back to planning: %w", err)
	}
	if moved.RowsAffected() == 0 {
		return nil
	}
	if _, err := tx.Exec(ctx, `update sched.reservations set state = 'released', revision = revision + 1
	                            where source_type = 'fleet.trip' and source_id = $1 and state in ('hold','confirmed')`, *d.trip); err != nil {
		return fmt.Errorf("inspections: release: %w", err)
	}
	return nil
}

// publishDecision writes fleet.defect.decided.v1 and tells the driver of the trip (api.js decideDefect).
func (s *Service) publishDecision(ctx context.Context, tx querier, tenant uuid.UUID, d decision, dec string) error {
	payload := map[string]any{"defectId": d.id, "decision": dec, "vehicleId": d.vehicle}
	if d.trip != nil {
		payload["tripId"] = *d.trip
	}
	ev, err := events.Publish(ctx, tx, events.Event{Type: eventDecided, Aggregate: "fleet.defect", AggregateID: d.id, Payload: payload})
	if err != nil || d.trip == nil {
		return err
	}
	severity, title := inbox.SeverityInfo, allowTitle
	if dec == decisionConfirm {
		number := ""
		if d.number != nil {
			number = *d.number
		}
		severity, title = inbox.SeverityWarning, confirmTitle(number)
	}
	return s.notifyDriver(ctx, tx, tenant, d.driver, *d.trip, ev, severity, title)
}
