package inspections

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/scopeddb"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// defectColumns are the columns the scope of fleet.inspections.read filters defects on: the unit of the vehicle and
// the «own» people — the reporter, the author of the inspection, the driver of the trip.
var defectColumns = authz.Columns{Unit: "v.unit_id", Persons: []string{"d.reported_by", "i.submitted_by", "t.driver_person_id"}}

// queueColumns are the columns of the queue of fleet.inspections.review: the unit of the vehicle only (x-scope
// responsible-manager-or-owner — territorial grants).
var queueColumns = authz.Columns{Unit: "v.unit_id"}

const defectSelect = `
select d.id, d.vehicle_id, d.inspection_id, d.trip_id, d.zone, d.description, d.severity, d.state, d.created_at,
       coalesce(d.reported_by, i.submitted_by), d.decision, d.decision_comment, d.resolved_by, d.resolved_at, d.revision,
       t.number, v.display_name, v.plate, p.full_name,
       d.assignee_id, a.full_name, d.due_at, d.assigned_by, d.assigned_at
  from fleet.defects d
  join fleet.vehicles v on v.id = d.vehicle_id
  join fleet.inspections i on i.id = d.inspection_id
  left join fleet.trips t on t.id = d.trip_id
  left join people.person_profiles p on p.id = t.driver_person_id
  left join people.person_profiles a on a.id = d.assignee_id`

var defectStates = []string{stateOpen, stateInReview, stateResolved, stateConfirmed}

func scanDefect(row pgx.Row) (fleetapi.InspectionDefect, error) {
	var (
		d                  fleetapi.InspectionDefect
		severity, state    string
		decision           *string
		decidedBy          *uuid.UUID
		decidedAt          *time.Time
		number, name, full *string
		plate              string
		dueAt, assignedAt  *time.Time
	)
	if err := row.Scan(&d.Id, &d.VehicleId, &d.InspectionId, &d.TripId, &d.Zone, &d.Description, &severity, &state,
		&d.ReportedAt, &d.ReportedByMemberId, &decision, &d.DecisionComment, &decidedBy, &decidedAt, &d.Revision,
		&number, &name, &plate, &full,
		&d.AssigneeMemberId, &d.AssigneeDisplayName, &dueAt, &d.AssignedByMemberId, &assignedAt); err != nil {
		return fleetapi.InspectionDefect{}, err
	}
	// The fields of a task (D-29 комплекта, W2.46): the assignee, the deadline, who assigned and when.
	d.DueAt, d.AssignedAt = utc(dueAt), utc(assignedAt)
	d.Severity, d.State = fleetapi.InspectionDefectSeverity(severity), fleetapi.InspectionDefectState(state)
	d.ReportedAt = d.ReportedAt.UTC()
	if decision != nil { // resolved_by and resolved_at without a decision: fixed by a repair, not by the queue
		v := fleetapi.InspectionDefectDecision(*decision)
		d.Decision, d.DecidedByMemberId = &v, decidedBy
		if decidedAt != nil {
			at := decidedAt.UTC()
			d.DecidedAt = &at
		}
	}
	d.TripNumber, d.VehicleDisplayName, d.RegistrationNumber, d.DriverDisplayName = number, name, &plate, full
	return d, nil
}

// utc is t in UTC (nil stays nil).
func utc(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	u := t.UTC()
	return &u
}

// Defect returns a defect the subject reads (getInspectionDefect): the driver sees the defects of his inspections,
// the manager — of the vehicles of his units. Invisible and missing defects are the same 404 (AC-01).
func (s *Service) Defect(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (fleetapi.InspectionDefect, error) {
	conn, err := scopeddb.For(ctx, s.Pools, s.Authz, tc)
	if err != nil {
		return fleetapi.InspectionDefect{}, err
	}
	var out fleetapi.InspectionDefect
	err = conn.One(ctx, actionRead, defectColumns, func(row pgx.Row) error {
		var err error
		out, err = scanDefect(row)
		return err
	}, defectSelect+` where d.id = $1 and `+scopeddb.Placeholder, id)
	return out, err
}

// Defects lists the defects of the review scope of the subject, oldest first (listInspectionDefects, S2-17): the
// queue is state=in_review. The scope and the filters apply before pagination.
func (s *Service) Defects(ctx context.Context, tc tenantctx.TenantContext, q DefectQuery) (fleetapi.InspectionDefectPage, error) {
	for _, st := range q.States {
		if !slices.Contains(defectStates, st) {
			return fleetapi.InspectionDefectPage{}, problem.New(problem.CodeMalformedRequest, "Неизвестное состояние дефекта.")
		}
	}
	limit, err := pageLimit(q.Limit)
	if err != nil {
		return fleetapi.InspectionDefectPage{}, err
	}
	states := slices.Sorted(slices.Values(q.States))
	bind := binding(tc.TenantID.String(), tc.PersonID.String(), "defects", strings.Join(states, ","), q.VehicleID.String(), q.TripID.String())
	var (
		filter any
		at     any
	)
	if len(states) > 0 {
		filter = states
	}
	after := uuid.Nil
	if q.Cursor != "" {
		t, id, err := decodeCursor(q.Cursor, bind)
		if err != nil {
			return fleetapi.InspectionDefectPage{}, err
		}
		at, after = t, id
	}
	conn, err := scopeddb.For(ctx, s.Pools, s.Authz, tc)
	if err != nil {
		return fleetapi.InspectionDefectPage{}, err
	}
	rows, err := conn.Query(ctx, actionReview, queueColumns, defectSelect+`
	 where ($1::text[] is null or d.state = any($1::text[]))
	   and ($2::uuid is null or d.vehicle_id = $2::uuid)
	   and ($3::uuid is null or d.trip_id = $3::uuid)
	   and ($4::timestamptz is null or (d.created_at, d.id) > ($4::timestamptz, $5::uuid))
	   and `+scopeddb.Placeholder+`
	 order by d.created_at, d.id
	 limit $6`, filter, orNil(q.VehicleID), orNil(q.TripID), at, after, limit+1)
	if err != nil {
		return fleetapi.InspectionDefectPage{}, fmt.Errorf("inspections: defects: %w", err)
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (fleetapi.InspectionDefect, error) { return scanDefect(row) })
	if err != nil {
		return fleetapi.InspectionDefectPage{}, fmt.Errorf("inspections: defects: %w", err)
	}
	page := fleetapi.InspectionDefectPage{Items: items}
	if len(items) > limit {
		page.Items = items[:limit]
		last := page.Items[limit-1]
		next := encodeCursor(last.ReportedAt, last.Id, bind)
		page.NextCursor = &next
	}
	return page, nil
}
