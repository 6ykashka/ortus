package vehicles

import (
	"context"
	"regexp"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W2.02: shared command helpers of the modules (Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// Texts of the answers (the mock W2.00, vehicles.ts).
const (
	textBothBounds = "Укажите обе границы интервала доступности или ни одной."
	textBounds     = "Проверьте интервал доступности: окончание должно быть позже начала."
)

// quantityRE is Quantity of the contract (common/schemas.yaml): the strict server does not check patterns.
var quantityRE = regexp.MustCompile(`^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$`)

// listSQL pages the vehicles the actor sees by (created_at, id) — the order they were registered in: $2 — the unit
// filter (its subtree) or null, $3 — body_type or null, $4 — the minimal payload or null, $5, $6 — the interval the
// vehicle must be free in or null, $7, $8 — the keyset position or null, $9 — the page size.
const listSQL = selectSQL + `
 where v.archived_at is null and {{scope}}
   and ($2::uuid is null or v.unit_id in (select descendant_id from org.unit_closure where ancestor_id = $2))
   and ($3::text is null or v.body_type = $3)
   and ($4::text is null or v.payload_kg >= $4::text::numeric)
   and ($5::timestamptz is null or (
         v.service_state = 'ok'
     and not exists (select 1 from fleet.defects d where d.vehicle_id = v.id and d.severity = 'blocking'
                       and d.state in ('open', 'in_review', 'confirmed_out_of_service'))
     and not exists (select 1 from fleet.trips t where t.vehicle_id = v.id
                       and t.state in ('on_route', 'returning', 'submitted', 'rework')
                       and not (t.state in ('returning', 'submitted', 'rework') and t.return_inspection_id is not null
                            and exists (select 1 from fleet.driver_transfers x where x.trip_id = t.id
                                         and x.home_vehicle_id = v.id and x.vehicle_decision = 'approved')))
     and not exists (select 1 from sched.resources s join sched.reservations r on r.resource_id = s.id
                      where s.kind = 'vehicle' and s.ref_id = v.id and r.occupied && tstzrange($5, $6, '[)')
                        and (r.state in ('confirmed', 'consumed') or (r.state = 'hold' and (r.hold_expires_at > $1 or r.offer_group_id is not null))))))
   and ($7::timestamptz is null or (v.created_at, v.id) > ($7::timestamptz, $8::uuid))
 order by v.created_at, v.id
 limit $9`

// filters are the checked query parameters of listVehicles.
type filters struct {
	unit             *uuid.UUID
	body, minPayload *string
	from, until      *time.Time
	afterAt          *time.Time
	afterID          *string
	limit            int
}

func parseFilters(p fleetapi.ListVehiclesParams) (filters, error) {
	f := filters{unit: p.OrgUnitId, minPayload: p.MinPayloadKg, from: p.AvailableFrom, until: p.AvailableUntil}
	var err error
	if f.limit, err = kit.PageLimit(p.Limit); err != nil {
		return filters{}, err
	}
	if p.BodyType != nil {
		body, ok := BodyToDB(string(*p.BodyType))
		if !ok {
			return filters{}, problem.New(problem.CodeMalformedRequest, "bodyType")
		}
		f.body = &body
	}
	if f.minPayload != nil && !quantityRE.MatchString(*f.minPayload) {
		return filters{}, problem.New(problem.CodeMalformedRequest, "minPayloadKg")
	}
	switch {
	case (f.from == nil) != (f.until == nil):
		return filters{}, kit.Invalid(textBothBounds)
	case f.from != nil && !f.from.Before(*f.until):
		return filters{}, kit.Invalid(textBounds)
	}
	if p.Cursor != nil {
		keys, err := kit.DecodeCursor(*p.Cursor, 2)
		if err != nil {
			return filters{}, err
		}
		at, err := time.Parse(time.RFC3339Nano, keys[0])
		if err != nil {
			return filters{}, problem.Wrap(problem.CodeMalformedRequest, err)
		}
		if _, err := uuid.Parse(keys[1]); err != nil {
			return filters{}, problem.Wrap(problem.CodeMalformedRequest, err)
		}
		f.afterAt, f.afterID = &at, &keys[1]
	}
	return f, nil
}

// ListVehicles implements fleetapi.StrictServerInterface: the vehicles in the scope of fleet.vehicles.read (the
// predicate comes before the pagination); orgUnitId only narrows the list to a subtree, never widens it. With an
// interval, only the vehicles free in it: in service, without a blocking defect, not on a trip and without a live
// hold or a reservation crossing it. The list is advisory; reserveVehicle decides.
func (s *Server) ListVehicles(ctx context.Context, req fleetapi.ListVehiclesRequestObject) (fleetapi.ListVehiclesResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	f, err := parseFilters(req.Params)
	if err != nil {
		return nil, err
	}
	c, err := s.conn(ctx, tc)
	if err != nil {
		return nil, err
	}
	rows, err := c.Query(ctx, ActionRead, Columns, listSQL, s.now(), f.unit, f.body, f.minPayload, f.from, f.until,
		f.afterAt, f.afterID, f.limit+1)
	if err != nil {
		return nil, dbError(err)
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Row, error) { return scanRow(r) })
	if err != nil {
		return nil, dbError(err)
	}
	page := fleetapi.VehiclePage{Items: make([]fleetapi.Vehicle, 0, min(len(list), f.limit))}
	if len(list) > f.limit {
		last := list[f.limit-1]
		next := kit.EncodeCursor(last.CreatedAt.UTC().Format(time.RFC3339Nano), last.ID.String())
		page.NextCursor = &next
		list = list[:f.limit]
	}
	for _, r := range list {
		page.Items = append(page.Items, r.DTO())
	}
	return fleetapi.ListVehicles200JSONResponse{
		Body: page, Headers: fleetapi.ListVehicles200ResponseHeaders{CacheControl: noStore(), XRequestId: rid(ctx)},
	}, nil
}
