package inspections

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/scopeddb"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// inspectionColumns are the columns the scope of fleet.inspections.read filters inspections on: the unit of the
// vehicle and the «own» people — the author and the driver of the trip.
var inspectionColumns = authz.Columns{Unit: "v.unit_id", Persons: []string{"i.submitted_by", "t.driver_person_id"}}

const inspectionSelect = `
select i.id, i.checklist_version_id, i.vehicle_id, i.submitted_by, i.kind, i.state, i.odometer_km::text, i.answers,
       coalesce(i.client_captured_at, i.submitted_at), i.submitted_at, i.revision, i.trip_id, i.attempt, i.comment,
       exists (select 1 from fleet.defects x where x.inspection_id = i.id and x.state = 'confirmed_out_of_service')
  from fleet.inspections i
  join fleet.vehicles v on v.id = i.vehicle_id
  join fleet.trips t on t.id = i.trip_id`

func scanInspection(row pgx.Row) (fleetapi.Inspection, error) {
	var (
		out       fleetapi.Inspection
		kind      string
		state     string
		odometer  string
		raw       []byte
		trip      uuid.UUID
		attempt   int64
		comment   *string
		confirmed bool
	)
	if err := row.Scan(&out.Id, &out.ChecklistVersionId, &out.VehicleId, &out.MemberId, &kind, &state, &odometer, &raw,
		&out.CapturedAt, &out.SubmittedAt, &out.Revision, &trip, &attempt, &comment, &confirmed); err != nil {
		return fleetapi.Inspection{}, err
	}
	var a answers
	if err := json.Unmarshal(raw, &a); err != nil {
		return fleetapi.Inspection{}, fmt.Errorf("inspections: answers: %w", err)
	}
	out.Kind, out.Status = fleetapi.InspectionKind(kind), inspectionStatus(state, confirmed)
	out.OdometerKm = odometer
	if a.OdometerKm != "" {
		out.OdometerKm = a.OdometerKm
	}
	if a.FuelPercent != nil {
		out.FuelPercent = *a.FuelPercent
	}
	out.Checks, out.Photos = a.Checks, a.Photos
	if out.Checks == nil {
		out.Checks = []fleetapi.InspectionCheck{}
	}
	if out.Photos == nil {
		out.Photos = []fleetapi.InspectionPhoto{}
	}
	out.TripId, out.Attempt, out.Comment = &trip, &attempt, comment
	out.CapturedAt, out.SubmittedAt = out.CapturedAt.UTC(), out.SubmittedAt.UTC()
	return out, nil
}

// loadInspection reads inspection id with its defects in q (the transaction of a command that already checked
// access).
func loadInspection(ctx context.Context, q querier, id uuid.UUID) (fleetapi.Inspection, error) {
	out, err := scanInspection(q.QueryRow(ctx, inspectionSelect+` where i.id = $1`, id))
	if err != nil {
		return fleetapi.Inspection{}, fmt.Errorf("inspections: read back: %w", err)
	}
	list := []fleetapi.Inspection{out}
	if err := attachDefects(ctx, q, list); err != nil {
		return fleetapi.Inspection{}, err
	}
	return list[0], nil
}

// attachDefects fills Inspection.defects of list (one query).
func attachDefects(ctx context.Context, q querier, list []fleetapi.Inspection) error {
	if len(list) == 0 {
		return nil
	}
	ids := make([]uuid.UUID, 0, len(list))
	at := map[uuid.UUID]int{}
	for i := range list {
		ids = append(ids, list[i].Id)
		at[list[i].Id] = i
		empty := []fleetapi.InspectionDefect{}
		list[i].Defects = &empty
	}
	rows, err := q.Query(ctx, defectSelect+` where d.inspection_id = any($1::uuid[]) order by d.created_at, d.id`, uuidStrings(ids))
	if err != nil {
		return fmt.Errorf("inspections: defects: %w", err)
	}
	defects, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (fleetapi.InspectionDefect, error) { return scanDefect(row) })
	if err != nil {
		return fmt.Errorf("inspections: defects: %w", err)
	}
	for _, d := range defects {
		i := at[d.InspectionId]
		*list[i].Defects = append(*list[i].Defects, d)
	}
	return nil
}

// Inspection returns an inspection the subject reads (getInspection): fleet.inspections.read over the unit of its
// vehicle or as its author or the driver of its trip. Invisible, foreign and missing ids are one 404 (AC-01).
func (s *Service) Inspection(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (fleetapi.Inspection, error) {
	pool, err := s.pool(ctx, tc)
	if err != nil {
		return fleetapi.Inspection{}, err
	}
	conn, err := scopeddb.For(ctx, s.Pools, s.Authz, tc)
	if err != nil {
		return fleetapi.Inspection{}, err
	}
	var out fleetapi.Inspection
	err = conn.One(ctx, actionRead, inspectionColumns, func(row pgx.Row) error {
		var err error
		out, err = scanInspection(row)
		return err
	}, inspectionSelect+` where i.id = $1 and `+scopeddb.Placeholder, id)
	if err != nil {
		return fleetapi.Inspection{}, err
	}
	list := []fleetapi.Inspection{out}
	if err := attachDefects(ctx, pool, list); err != nil {
		return fleetapi.Inspection{}, err
	}
	return list[0], nil
}

// Inspections lists the inspections the subject reads, oldest first (listInspections); the scope filters before
// pagination, the cursor is bound to the tenant and the subject.
func (s *Service) Inspections(ctx context.Context, tc tenantctx.TenantContext, q PageQuery) (fleetapi.InspectionPage, error) {
	limit, err := pageLimit(q.Limit)
	if err != nil {
		return fleetapi.InspectionPage{}, err
	}
	bind := binding(tc.TenantID.String(), tc.PersonID.String(), "inspections")
	var at any
	after := uuid.Nil
	if q.Cursor != "" {
		t, id, err := decodeCursor(q.Cursor, bind)
		if err != nil {
			return fleetapi.InspectionPage{}, err
		}
		at, after = t, id
	}
	pool, err := s.pool(ctx, tc)
	if err != nil {
		return fleetapi.InspectionPage{}, err
	}
	conn, err := scopeddb.For(ctx, s.Pools, s.Authz, tc)
	if err != nil {
		return fleetapi.InspectionPage{}, err
	}
	rows, err := conn.Query(ctx, actionRead, inspectionColumns, inspectionSelect+`
	 where ($1::timestamptz is null or (i.submitted_at, i.id) > ($1::timestamptz, $2::uuid))
	   and `+scopeddb.Placeholder+`
	 order by i.submitted_at, i.id
	 limit $3`, at, after, limit+1)
	if err != nil {
		return fleetapi.InspectionPage{}, fmt.Errorf("inspections: list: %w", err)
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (fleetapi.Inspection, error) { return scanInspection(row) })
	if err != nil {
		return fleetapi.InspectionPage{}, fmt.Errorf("inspections: list: %w", err)
	}
	page := fleetapi.InspectionPage{Items: items}
	if len(items) > limit {
		page.Items = items[:limit]
		last := page.Items[limit-1]
		next := encodeCursor(last.SubmittedAt, last.Id, bind)
		page.NextCursor = &next
	}
	if err := attachDefects(ctx, pool, page.Items); err != nil {
		return fleetapi.InspectionPage{}, err
	}
	return page, nil
}
