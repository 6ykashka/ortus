package vehicles

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W2.42: shared command helpers of the modules (Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// TextNotFound is the 404 of a vehicle (examples-w252.mjs listVehicleAssignments/not_found): a vehicle outside the
// scope, of another organization and a missing one alike (AC-01, AC-02).
const TextNotFound = "Машина не найдена."

// assignmentColumns are the columns the scope of fleet.vehicles.read filters the periods of a vehicle on (alias a): a
// period in a company outside the scope is left out of the history.
var assignmentColumns = authz.Columns{Unit: "a.unit_id"}

// Assignment is a period of fleet.vehicle_assignments (tenant 0016): the vehicle belonged to Unit over [From, To).
type Assignment struct {
	ID, Vehicle, Unit uuid.UUID
	UnitName          string
	From              time.Time
	To                *time.Time // nil: the current company of the vehicle
	Reason            *string
	By                *uuid.UUID // the person who moved the vehicle; nil for the period of the registration
}

// DTO is the VehicleAssignment of the contract.
func (a Assignment) DTO() fleetapi.VehicleAssignment {
	out := fleetapi.VehicleAssignment{
		Id: a.ID, VehicleId: a.Vehicle, OrgUnitId: a.Unit, ValidFrom: a.From.UTC(), Reason: a.Reason, AssignedByMemberId: a.By,
	}
	if a.UnitName != "" {
		name := a.UnitName
		out.OrgUnitName = &name
	}
	if a.To != nil {
		to := a.To.UTC()
		out.ValidTo = &to
	}
	return out
}

func scanAssignment(row pgx.Row) (Assignment, error) {
	var a Assignment
	err := row.Scan(&a.ID, &a.Vehicle, &a.Unit, &a.UnitName, &a.From, &a.To, &a.Reason, &a.By)
	return a, err
}

const (
	// visibleSQL finds the vehicle $1 that is not archived in the scope of fleet.vehicles.read over its company.
	visibleSQL = `select v.id from fleet.vehicles v where v.id = $1 and v.archived_at is null and {{scope}}`
	// historySQL pages the periods of the vehicle $1 in the scope of fleet.vehicles.read over their companies, newest
	// first: $2, $3 — the keyset position or null, $4 — the page size.
	historySQL = `select a.id, a.vehicle_id, a.unit_id, u.name, a.valid_from, a.valid_to, a.reason, a.assigned_by
  from fleet.vehicle_assignments a
  join org.units u on u.id = a.unit_id
 where a.vehicle_id = $1 and {{scope}}
   and ($2::timestamptz is null or (a.valid_from, a.id) < ($2::timestamptz, $3::uuid))
 order by a.valid_from desc, a.id desc
 limit $4`
)

// historyPage is the checked page of listVehicleAssignments.
type historyPage struct {
	limit   int
	afterAt *time.Time
	afterID *uuid.UUID
}

func parseHistoryPage(p fleetapi.ListVehicleAssignmentsParams) (historyPage, error) {
	var out historyPage
	var err error
	if out.limit, err = kit.PageLimit(p.Limit); err != nil {
		return historyPage{}, err
	}
	if p.Cursor == nil {
		return out, nil
	}
	keys, err := kit.DecodeCursor(*p.Cursor, 2)
	if err != nil {
		return historyPage{}, err
	}
	at, err := time.Parse(time.RFC3339Nano, keys[0])
	if err != nil {
		return historyPage{}, problem.Wrap(problem.CodeMalformedRequest, err)
	}
	id, err := uuid.Parse(keys[1])
	if err != nil {
		return historyPage{}, problem.Wrap(problem.CodeMalformedRequest, err)
	}
	out.afterAt, out.afterID = &at, &id
	return out, nil
}

// ListVehicleAssignments implements fleetapi.StrictServerInterface: the periods of a vehicle the actor sees
// (fleet.vehicles.read over its current company), newest first. A vehicle outside the scope, an archived one and a
// missing one are one 404; the periods in companies outside the scope of the actor are left out — the answer never
// names a company the actor cannot see (the owner sees all of them).
func (s *Server) ListVehicleAssignments(ctx context.Context, req fleetapi.ListVehicleAssignmentsRequestObject) (fleetapi.ListVehicleAssignmentsResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	page, err := parseHistoryPage(req.Params)
	if err != nil {
		return nil, err
	}
	c, err := s.conn(ctx, tc)
	if err != nil {
		return nil, err
	}
	err = c.One(ctx, ActionRead, Columns, func(r pgx.Row) error { var id uuid.UUID; return r.Scan(&id) }, visibleSQL, req.VehicleId)
	if err != nil {
		return nil, dbError(notFound(err))
	}
	rows, err := c.Query(ctx, ActionRead, assignmentColumns, historySQL, req.VehicleId, page.afterAt, page.afterID, page.limit+1)
	if err != nil {
		return nil, dbError(err)
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Assignment, error) { return scanAssignment(r) })
	if err != nil {
		return nil, dbError(err)
	}
	body := fleetapi.VehicleAssignmentPage{Items: make([]fleetapi.VehicleAssignment, 0, min(len(list), page.limit))}
	if len(list) > page.limit {
		last := list[page.limit-1]
		next := kit.EncodeCursor(last.From.UTC().Format(time.RFC3339Nano), last.ID.String())
		body.NextCursor = &next
		list = list[:page.limit]
	}
	for _, a := range list {
		body.Items = append(body.Items, a.DTO())
	}
	return fleetapi.ListVehicleAssignments200JSONResponse{
		Body: body, Headers: fleetapi.ListVehicleAssignments200ResponseHeaders{CacheControl: noStore(), XRequestId: rid(ctx)},
	}, nil
}

// UnitAtSQL is the SQL expression of the company the vehicle of the expression vehicle belonged to at the instant of
// the expression at («кто владел машиной на дату», модель данных 2): the first period that ends after the instant —
// the period of the instant, or the first period when the instant comes before the registration. A module whose rows
// are dated (an inspection, a defect, a reservation) filters them with it in place of the current company:
// authz.Columns{Unit: vehicles.UnitAtSQL("i.vehicle_id", "i.submitted_at")}; reports group by it.
func UnitAtSQL(vehicle, at string) string {
	return `(select a.unit_id from fleet.vehicle_assignments a where a.vehicle_id = ` + vehicle +
		` and (a.valid_to is null or ` + at + ` < a.valid_to) order by a.valid_from limit 1)`
}

// UnitAt returns the company vehicle belonged to at the instant at through q (UnitAtSQL); a vehicle without periods
// (a missing one) is 404 not_found.
func UnitAt(ctx context.Context, q Querier, vehicle uuid.UUID, at time.Time) (uuid.UUID, error) {
	var unit *uuid.UUID
	if err := q.QueryRow(ctx, `select `+UnitAtSQL("$1::uuid", "$2::timestamptz"), vehicle, at).Scan(&unit); err != nil {
		return uuid.Nil, err
	}
	if unit == nil {
		return uuid.Nil, problem.New(problem.CodeNotFound, TextNotFound)
	}
	return *unit, nil
}

// notFound gives a not_found error the text of a missing vehicle; other errors pass unchanged.
func notFound(err error) error {
	if problem.Is(err, problem.CodeNotFound) {
		return problem.New(problem.CodeNotFound, TextNotFound)
	}
	return err
}

// errNoOpenPeriod is a vehicle without its open period: tenant 0016 keeps one for every vehicle (Q-W2.52-20 — an
// open period can only be lost by a delete, which nothing does).
var errNoOpenPeriod = errors.New("vehicles: the vehicle has no open period of fleet.vehicle_assignments")
