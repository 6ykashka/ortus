package inspections

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// activeTrips are the states in which a trip holds its vehicle: its driver sees the vehicle as «own».
const activeTrips = `('assigned','inspection','defect_review','on_route','returning','submitted','rework')`

// vehicleSQL reads the scope of a vehicle: its unit and the drivers of its active trips.
const vehicleSQL = `
select v.unit_id,
       coalesce(array_agg(t.driver_person_id::text) filter (where t.driver_person_id is not null), '{}')
  from fleet.vehicles v
  left join fleet.trips t on t.vehicle_id = v.id and t.state in ` + activeTrips + `
 where v.id = $1 and v.archived_at is null
 group by v.unit_id`

const currentChecklistSQL = `
select id, version, items, required_photo_roles, definition from fleet.checklist_versions
 where kind = $1 order by version desc limit 1`

const publishChecklistSQL = `
insert into fleet.checklist_versions (id, kind, version, items, required_photo_roles, definition)
values ($1, $2, $3, $4, $5, $6) on conflict do nothing`

// Checklist returns the current checklist of kind for a visible vehicle (getInspectionChecklist, S2-04): the
// vehicle is visible with fleet.inspections.read over its unit or as the vehicle of an own active trip; a vehicle
// seen (fleet.vehicles.read) without the inspection right is 403, an invisible one 404 like a missing id (AC-01).
func (s *Service) Checklist(ctx context.Context, tc tenantctx.TenantContext, vehicleID uuid.UUID, kind string) (fleetapi.InspectionChecklist, error) {
	if kind != kindDeparture && kind != kindReturn {
		return fleetapi.InspectionChecklist{}, invalid("Вид осмотра — выезд или сдача.")
	}
	pool, err := s.pool(ctx, tc)
	if err != nil {
		return fleetapi.InspectionChecklist{}, err
	}
	var (
		unit    uuid.UUID
		drivers []string
	)
	err = pool.QueryRow(ctx, vehicleSQL, vehicleID).Scan(&unit, &drivers)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return fleetapi.InspectionChecklist{}, problem.New(problem.CodeNotFound, "")
	case err != nil:
		return fleetapi.InspectionChecklist{}, fmt.Errorf("inspections: vehicle: %w", err)
	}
	res := authz.Resource{Unit: unit, ReadAction: actionVehiclesRead}
	for _, d := range drivers {
		if id, err := uuid.Parse(d); err == nil {
			res.Persons = append(res.Persons, id)
		}
	}
	if err := s.Authz.Permit(ctx, tc, actionRead, res); err != nil {
		return fleetapi.InspectionChecklist{}, err
	}
	c, err := currentChecklist(ctx, pool, kind)
	if err != nil {
		return fleetapi.InspectionChecklist{}, err
	}
	return checklistDTO(c), nil
}

// currentChecklist returns the latest version of kind, publishing the built-in version 1 when the tenant has none:
// with its definition (W2.45) and, for the screens of stage 2 and the writers of tenant 0002, its items and roles.
func currentChecklist(ctx context.Context, q querier, kind string) (checklist, error) {
	c, found, err := latestChecklist(ctx, q, kind)
	if err != nil || found {
		return c, err
	}
	b := builtinChecklist(kind)
	items, err := json.Marshal(b.Items)
	if err != nil {
		return checklist{}, fmt.Errorf("inspections: checklist items: %w", err)
	}
	def, err := json.Marshal(checklistDefinition(b))
	if err != nil {
		return checklist{}, fmt.Errorf("inspections: checklist definition: %w", err)
	}
	roles := make([]string, 0, len(b.Roles))
	for _, r := range b.Roles {
		stored, _ := storedRole(r)
		roles = append(roles, stored)
	}
	if _, err := q.Exec(ctx, publishChecklistSQL, b.ID, kind, b.Version, items, roles, def); err != nil {
		return checklist{}, fmt.Errorf("inspections: publish checklist: %w", err)
	}
	c, found, err = latestChecklist(ctx, q, kind)
	if err == nil && !found {
		err = errors.New("inspections: the checklist was not published")
	}
	return c, err
}

func latestChecklist(ctx context.Context, q querier, kind string) (checklist, bool, error) {
	var (
		c          = checklist{Kind: kind}
		items, def []byte
		roles      []string
	)
	err := q.QueryRow(ctx, currentChecklistSQL, kind).Scan(&c.ID, &c.Version, &items, &roles, &def)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return checklist{}, false, nil
	case err != nil:
		return checklist{}, false, fmt.Errorf("inspections: checklist: %w", err)
	}
	if c, err = readVersion(c, items, roles, def); err != nil {
		return checklist{}, false, err
	}
	return c, true, nil
}

// checklistDTO is InspectionChecklist of a version: items and requiredPhotoRoles (the source of the screens of stage
// 2) as read from the definition, and the definition itself when it is a checklist form.
func checklistDTO(c checklist) fleetapi.InspectionChecklist {
	out := fleetapi.InspectionChecklist{
		VersionId: c.ID, Kind: fleetapi.InspectionChecklistKind(c.Kind), Definition: c.Definition,
		Items:              make([]fleetapi.InspectionChecklistItem, 0, len(c.Items)),
		RequiredPhotoRoles: make([]fleetapi.InspectionChecklistRequiredPhotoRoles, 0, len(c.Roles)),
	}
	for _, it := range c.Items {
		out.Items = append(out.Items, fleetapi.InspectionChecklistItem{
			Key: it.Key, Label: it.Label, Required: it.Required, FailureBlocksRelease: it.FailureBlocksRelease,
		})
	}
	for _, r := range c.Roles {
		out.RequiredPhotoRoles = append(out.RequiredPhotoRoles, fleetapi.InspectionChecklistRequiredPhotoRoles(r))
	}
	return out
}
