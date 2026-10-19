// Package vehicles is the fleet of a tenant (W2.02, S2-01, S2-02): vehicles of org units (fleet.vehicles), their
// derived status and their selection for an interval (listVehicles), and the registration of a vehicle
// (createVehicle). W2.42 (модель данных 2): the company history of a vehicle (fleet.vehicle_assignments, tenant 0016 —
// listVehicleAssignments), its move to another company (moveVehicle) and «кто владел машиной на дату» for the scope
// predicates and the reports of other modules (UnitAt, UnitAtSQL).
//
// The status is never stored: it is derived at the moment of the read from the service state, blocking defects
// (fleet.defects), the trip that holds the vehicle (fleet.trips) and its live holds (sched.reservations), as analysis
// 03 §17.3 maps the states of the prototype. Reads go through scopeddb with the scope of fleet.vehicles.read over the
// unit of the vehicle; the command authorizes the unit with the evaluator and writes in one transaction with the audit
// and the stored outcome (modules/org/kit).
package vehicles

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/domain/fleetrules"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W2.02: shared command helpers of the modules (ETag, cursor, Tx, Audit, Complete; Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/scopeddb"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Actions of the catalog (api/permissions.yaml).
const (
	ActionRead      = "fleet.vehicles.read"
	ActionManage    = "fleet.vehicles.manage"
	actionUnitsRead = "org_units.read"
)

// TargetVehicle is the audit target type of a vehicle.
const TargetVehicle = "fleet.vehicle"

// Columns are the columns the scope predicate filters vehicles on (alias v): the unit, and the vehicle itself for a
// grant of the kind resource (W2.57, Q-W2.07-1: the vehicle reserved for the trip of a temporary driver of the pool).
var Columns = authz.Columns{Unit: "v.unit_id", Objects: map[string]string{authz.KindResource: "v.id"}}

// Server implements the vehicle operations of the tag Fleet.
type Server struct {
	Pools kit.Pools
	Authz kit.Authorizer
	Now   func() time.Time // the clock of the application (APP_FIXED_NOW outside prod); nil: time.Now
}

func (s *Server) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// Querier is a pool or the transaction of a command.
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Body types of the table (fleet.vehicles.body_type: reefer is refrigerated of the contract).
const (
	bodyVan     = "van"
	bodyBox     = "box"
	bodyFlatbed = "flatbed"
	bodyReefer  = "reefer"
	bodyTent    = "tent"
)

var (
	bodyToDB = map[string]string{
		string(fleetapi.VehicleBodyTypeVan): bodyVan, string(fleetapi.VehicleBodyTypeBox): bodyBox,
		string(fleetapi.VehicleBodyTypeFlatbed): bodyFlatbed, string(fleetapi.VehicleBodyTypeRefrigerated): bodyReefer,
		string(fleetapi.VehicleBodyTypeTent): bodyTent,
	}
	bodyFromDB = map[string]fleetapi.VehicleBodyType{
		bodyVan: fleetapi.VehicleBodyTypeVan, bodyBox: fleetapi.VehicleBodyTypeBox, bodyFlatbed: fleetapi.VehicleBodyTypeFlatbed,
		bodyReefer: fleetapi.VehicleBodyTypeRefrigerated, bodyTent: fleetapi.VehicleBodyTypeTent,
	}
	// bodyLabels are the body names of the prototype the rules of W2.01 print (mock-data.js).
	bodyLabels = map[string]string{
		bodyVan: "Фургон", bodyBox: "Фургон", bodyFlatbed: "Борт", bodyReefer: "Рефрижератор", bodyTent: "Тент",
	}
)

// BodyToDB returns the body_type of a body type of the contract.
func BodyToDB(body string) (string, bool) {
	v, ok := bodyToDB[body]
	return v, ok
}

// Row is a vehicle with the state it is in at the moment of the read.
type Row struct {
	ID, Unit                     uuid.UUID
	TimeZone                     string // of the unit
	Plate, Name, Body            string
	PayloadKg, VolumeM3, LengthM string // exact decimals of the contract (kg, m³, m)
	WidthM, HeightM              string
	TempMin, TempMax             *string
	OdometerKm                   string
	Depot                        *string
	Revision                     int64
	CreatedAt                    time.Time
	Since                        *time.Time // the start of the current company period after a move (W2.42); nil before
	State                        State
	payloadF, volumeF, lengthF   float64 // the same as floats, for the rules of W2.01
	tempMinF, tempMaxF           *float64
	odometerF                    float64
}

// selectSQL reads vehicles with their state at $1 (the clock of the application) and the start of their current
// company period when they were moved (Vehicle.orgUnitSince: only after a move — a closed period exists, Q-W2.52-6);
// the caller adds the conditions.
const selectSQL = `select v.id, v.unit_id, u.time_zone, v.plate, coalesce(v.display_name, v.plate), v.body_type,
       trim_scale(v.payload_kg)::text, trim_scale(v.volume_m3)::text, trim_scale(v.cargo_length_mm / 1000.0)::text,
       coalesce(trim_scale(v.cargo_width_mm / 1000.0)::text, '0'), coalesce(trim_scale(v.cargo_height_mm / 1000.0)::text, '0'),
       trim_scale(v.temp_min_c)::text, trim_scale(v.temp_max_c)::text, trim_scale(v.odometer_km)::text,
       v.payload_kg::float8, v.volume_m3::float8, (v.cargo_length_mm / 1000.0)::float8,
       v.temp_min_c::float8, v.temp_max_c::float8, v.odometer_km::float8,
       v.depot, v.revision, v.created_at, v.service_state, coalesce(v.service_note, ''),
       coalesce((select d.state from fleet.defects d
                  where d.vehicle_id = v.id and d.severity = 'blocking'
                    and d.state in ('open', 'in_review', 'confirmed_out_of_service')
                  order by case d.state when 'confirmed_out_of_service' then 0 when 'in_review' then 1 else 2 end
                  limit 1), ''),
       tr.id, coalesce(tr.state, ''), h.id is not null, h.trip_id,
       (select a.valid_from from fleet.vehicle_assignments a
         where a.vehicle_id = v.id and a.valid_to is null
           and exists (select 1 from fleet.vehicle_assignments p where p.vehicle_id = v.id and p.valid_to is not null))
  from fleet.vehicles v
  join org.units u on u.id = v.unit_id
  left join lateral (select t.id, t.state from fleet.trips t
                      where t.vehicle_id = v.id
                        and t.state in ('assigned', 'inspection', 'defect_review', 'on_route', 'returning', 'submitted', 'rework')
                      order by case t.state when 'on_route' then 0 when 'returning' then 0 when 'submitted' then 1
                                            when 'rework' then 1 else 2 end, t.created_at desc
                      limit 1) tr on true
  left join lateral (select r.id, case when r.source_type = 'fleet.trip' then r.source_id end as trip_id
                       from sched.resources s join sched.reservations r on r.resource_id = s.id
                      where s.kind = 'vehicle' and s.ref_id = v.id and upper(r.occupied) > $1
                        and (r.state = 'confirmed' or (r.state = 'hold' and r.hold_expires_at > $1))
                      order by lower(r.occupied), r.id
                      limit 1) h on true`

func scanRow(row pgx.Row) (Row, error) {
	var r Row
	err := row.Scan(&r.ID, &r.Unit, &r.TimeZone, &r.Plate, &r.Name, &r.Body,
		&r.PayloadKg, &r.VolumeM3, &r.LengthM, &r.WidthM, &r.HeightM, &r.TempMin, &r.TempMax, &r.OdometerKm,
		&r.payloadF, &r.volumeF, &r.lengthF, &r.tempMinF, &r.tempMaxF, &r.odometerF,
		&r.Depot, &r.Revision, &r.CreatedAt, &r.State.Service, &r.State.ServiceNote, &r.State.Defect,
		&r.State.TripID, &r.State.TripState, &r.State.Held, &r.State.HoldTripID, &r.Since)
	return r, err
}

// Get reads a vehicle that is not archived by id through q, without a scope: the caller authorizes it (Permit with
// Resource{Unit: row.Unit}). No such vehicle is 404 not_found.
func Get(ctx context.Context, q Querier, id uuid.UUID, now time.Time) (Row, error) {
	r, err := scanRow(q.QueryRow(ctx, selectSQL+` where v.id = $2 and v.archived_at is null`, now, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Row{}, problem.New(problem.CodeNotFound, "")
	}
	return r, err
}

// DTO is the Vehicle of the contract.
func (r Row) DTO() fleetapi.Vehicle {
	status, note, heldBy := r.State.Status()
	out := fleetapi.Vehicle{
		Id: r.ID, OrgUnitId: r.Unit, RegistrationNumber: r.Plate, DisplayName: r.Name, BodyType: bodyFromDB[r.Body],
		Capacity: fleetapi.VehicleCapacity{
			PayloadKg: r.PayloadKg, VolumeM3: r.VolumeM3, CargoLengthM: r.LengthM, CargoWidthM: r.WidthM, CargoHeightM: r.HeightM,
		},
		TemperatureMinC: r.TempMin, TemperatureMaxC: r.TempMax, Equipment: []fleetapi.VehicleEquipment{},
		Status: status, OdometerKm: r.OdometerKm, Revision: r.Revision, HeldByTripId: heldBy, Depot: r.Depot,
	}
	if r.TempMin != nil && r.TempMax != nil {
		out.Equipment = append(out.Equipment, fleetapi.VehicleEquipmentRefrigerator)
	}
	if note != "" {
		out.StatusNote = &note
	}
	if r.Since != nil {
		since := r.Since.UTC()
		out.OrgUnitSince = &since
	}
	return out
}

// Rules is the vehicle as the rules of W2.01 (fleetrules.Compat) see it: tonnes, metres and the state of the
// prototype; heldBy is the trip of its hold.
func (r Row) Rules() fleetrules.Vehicle {
	status, note, heldBy := r.State.Status()
	v := fleetrules.Vehicle{
		ID: r.ID.String(), Unit: r.Unit.String(), Model: r.Name, Plate: r.Plate, Body: bodyLabels[r.Body],
		PayloadT: r.payloadF / 1000, VolumeM3: r.volumeF, LengthM: r.lengthF, Odometer: r.odometerF,
		State: ruleStates[status], Note: note,
	}
	if r.Depot != nil {
		v.Depot = *r.Depot
	}
	if r.tempMinF != nil && r.tempMaxF != nil {
		v.Temp = &fleetrules.TempRange{*r.tempMinF, *r.tempMaxF}
	}
	if heldBy != nil {
		id := heldBy.String()
		v.HeldBy = &id
	}
	return v
}

// Available reports whether the vehicle may be held now: in service, without a blocking defect, not on a trip that
// keeps it (on the route or waiting for the acceptance). Its free intervals are the business of sched.
func (r Row) Available() bool {
	status, _, _ := r.State.Status()
	return status == fleetapi.VehicleStatusAvailable || status == fleetapi.VehicleStatusReserved
}

// within is the authorizer of a command over its transaction q (W1.47): an evaluator of the platform reads the
// subject, the modules and the unit tree through q, never through another connection of the pool, with the clock
// frozen at the start of the command. Another Authorizer (a test double) is used as it is.
func (s *Server) within(q authz.Querier) kit.Authorizer {
	ev, ok := s.Authz.(*authz.Evaluator)
	if !ok || ev == nil {
		return s.Authz
	}
	cp := *ev
	src := authz.TxSource{Q: q}
	at := s.now()
	cp.Now = func() time.Time { return at }
	cp.Source = src
	if ev.Units != nil {
		cp.Units = src
	}
	return &cp
}

func (s *Server) conn(ctx context.Context, tc tenantctx.TenantContext) (*scopeddb.Conn, error) {
	c, err := scopeddb.For(ctx, s.Pools, s.Authz, tc)
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return c, nil
}

// rid returns the X-Request-Id of the response.
func rid(ctx context.Context) *string {
	id := requestid.FromContext(ctx)
	return &id
}

func noStore() *string {
	v := kit.NoStore
	return &v
}

// dbError keeps Problem errors and hides everything else behind dependency_unavailable.
func dbError(err error) error {
	if err == nil {
		return nil
	}
	if _, ok := errors.AsType[*problem.Error](err); ok {
		return err
	}
	return problem.Wrap(problem.CodeDependencyUnavailable, err)
}
