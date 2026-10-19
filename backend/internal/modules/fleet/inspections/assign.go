package inspections

import (
	"context"
	"errors"
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

// maxAssignNote is the limit of DefectAssignment.comment.
const maxAssignNote = 2000

// eventAssigned is the outbox event of an assignment (identifiers and the deadline, no personal data).
const eventAssigned = "fleet.defect.assigned.v1"

// aggregateDefect is the aggregate of the events and the target type of the audit of a defect; keyVehicleID is the
// key of the vehicle in the payloads of the events of the module.
const (
	aggregateDefect = "fleet.defect"
	keyVehicleID    = "vehicleId"
)

// Texts of the answers of assignInspectionDefect (the MSW of W2.52, fleet/inspections.ts).
const (
	detailUnknownAssignee = "Сотрудник не найден."
	detailPastDue         = "Срок решения уже прошёл."
	detailAssignNote      = "Комментарий — не длиннее 2000 символов."
)

// validateAssignment checks the body of assignInspectionDefect: the deadline is not before now (the clock of the
// application; a missing one is the zero time, in the past), the comment fits its limit.
func validateAssignment(b fleetapi.DefectAssignment, now time.Time) error {
	switch {
	case b.DueAt.Before(now):
		return invalid(detailPastDue)
	case b.Comment != nil && tooLong(*b.Comment, maxAssignNote):
		return invalid(detailAssignNote)
	}
	return nil
}

// assignedTitle is the notification of the assignee: «Вам назначен дефект: {машина} {номер} — {зона}».
func assignedTitle(name, plate, zone string) string {
	vehicle := strings.TrimSpace(name + " " + plate)
	return "Вам назначен дефект: " + vehicle + " — " + zone
}

// liveProfileSQL: the assignee is a person of the tenant DB that is not archived.
const liveProfileSQL = `select exists (select 1 from people.person_profiles where id = $1 and archived_at is null)`

const assignSQL = `
update fleet.defects set assignee_id = $2, due_at = $3, assigned_by = $4, assigned_at = $5, revision = revision + 1
 where id = $1`

// Assign sets the assignee and the deadline of a blocking defect in the queue (assignInspectionDefect, D-29 комплекта,
// W2.46): the fields of a task the defect keeps until step 4.1 makes it a link to a task. The order of the answers is
// the one of Decide — an invisible defect 404, a visible one without fleet.inspections.review 403, a defect that is
// not in_review 409 «Дефект уже решён.» (before If-Match), If-Match 428/412; then the body: a deadline in the past
// 422, an assignee who is unknown, archived, without an active membership or without fleet.inspections.review over
// the company of the vehicle — one and the same 422 «Сотрудник не найден.». Re-assignment replaces both fields. The
// assignment is audited, published (fleet.defect.assigned.v1) and told to the assignee unless he assigns himself.
func (s *Service) Assign(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b fleetapi.DefectAssignment) (fleetapi.InspectionDefect, error) {
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
		now := s.now()
		if err := validateAssignment(b, now); err != nil {
			return err
		}
		if err := s.checkAssignee(ctx, tx, tc, b.AssigneeMemberId, d.unit); err != nil {
			return err
		}
		prev, err := previousAssignment(ctx, tx, d.id)
		if err != nil {
			return err
		}
		due := b.DueAt.UTC()
		if _, err := tx.Exec(ctx, assignSQL, d.id, b.AssigneeMemberId, due, tc.PersonID, now); err != nil {
			return fmt.Errorf("inspections: assign: %w", err)
		}
		if out, err = scanDefect(tx.QueryRow(ctx, defectSelect+` where d.id = $1`, id)); err != nil {
			return fmt.Errorf("inspections: read back: %w", err)
		}
		if err := s.recordAssignment(ctx, tx, tc, d, prev, b, out); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusOK, etag(out.Revision), out)
	})
	return out, err
}

// checkAssignee requires the assignee to be a live person of the tenant with an active membership whose
// fleet.inspections.review reaches the unit of the vehicle now (the owner passes). Every miss is the same 422: the
// answer never tells an unknown person from one without the right or outside the scope.
func (s *Service) checkAssignee(ctx context.Context, tx querier, tc tenantctx.TenantContext, person, unit uuid.UUID) error {
	unknown := invalid(detailUnknownAssignee)
	if person == uuid.Nil {
		return unknown
	}
	var live bool
	if err := tx.QueryRow(ctx, liveProfileSQL, person).Scan(&live); err != nil {
		return fmt.Errorf("inspections: assignee: %w", err)
	}
	if !live {
		return unknown
	}
	if s.Recipients == nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, errors.New("inspections: no memberships to check the assignee"))
	}
	who, err := s.Recipients.Recipient(ctx, tc.TenantID, person)
	switch {
	case errors.Is(err, inbox.ErrNoRecipient):
		return unknown
	case err != nil:
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	if err := s.Authz.Permit(ctx, who, actionReview, authz.Resource{Unit: unit}); err != nil {
		if hidden(err) {
			return unknown
		}
		return err
	}
	return nil
}

// assignment is what the defect held before a re-assignment (for the audit diff).
type assignment struct {
	assignee *uuid.UUID
	due      *time.Time
}

func previousAssignment(ctx context.Context, tx querier, id uuid.UUID) (assignment, error) {
	var a assignment
	if err := tx.QueryRow(ctx, `select assignee_id, due_at from fleet.defects where id = $1`, id).Scan(&a.assignee, &a.due); err != nil {
		return assignment{}, fmt.Errorf("inspections: previous assignment: %w", err)
	}
	return a, nil
}

// recordAssignment writes the audit row, fleet.defect.assigned.v1 and the notification of the assignee (none when
// the actor assigns himself). The comment of the assignment has no column (tenant 0017): it goes to the assignee as
// the body of the notification; the audit keeps only whether there was one.
func (s *Service) recordAssignment(ctx context.Context, tx querier, tc tenantctx.TenantContext, d decision, prev assignment, b fleetapi.DefectAssignment, out fleetapi.InspectionDefect) error {
	comment := ""
	if b.Comment != nil {
		comment = strings.TrimSpace(*b.Comment)
	}
	diff := map[string]any{"assignee": b.AssigneeMemberId, "dueAt": b.DueAt.UTC(), "comment": comment != ""}
	if prev.assignee != nil {
		diff["previousAssignee"] = *prev.assignee
	}
	if prev.due != nil {
		diff["previousDueAt"] = prev.due.UTC()
	}
	if err := audit.Record(ctx, tx, audit.Event{
		ActorKind: audit.ActorPerson, ActorID: tc.PersonID, Action: "fleet.defect.assign", TargetType: aggregateDefect,
		TargetID: d.id, UnitID: d.unit, Result: audit.OK, RequestID: requestID(ctx), Diff: diff,
	}); err != nil {
		return err
	}
	payload := map[string]any{"defectId": d.id, keyVehicleID: d.vehicle, "assigneeMemberId": b.AssigneeMemberId, "dueAt": b.DueAt.UTC()}
	if d.trip != nil {
		payload["tripId"] = *d.trip
	}
	ev, err := events.Publish(ctx, tx, events.Event{Type: eventAssigned, Aggregate: aggregateDefect, AggregateID: d.id, Payload: payload})
	if err != nil || b.AssigneeMemberId == tc.PersonID {
		return err
	}
	name, plate := "", ""
	if out.VehicleDisplayName != nil {
		name = *out.VehicleDisplayName
	}
	if out.RegistrationNumber != nil {
		plate = *out.RegistrationNumber
	}
	return s.notifyAssignee(ctx, tx, tc.TenantID, b.AssigneeMemberId, d, ev, assignedTitle(name, plate, out.Zone), comment)
}
