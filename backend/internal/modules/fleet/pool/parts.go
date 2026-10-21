package pool

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/reservations" //nolint:depguard // W2.72: the reservations of an offer of the same module
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// partsSQL reads the vehicles of the requests $1 with the fate of their reservation in the offer of the request.
const partsSQL = `select x.id, v.id, coalesce(v.display_name, v.plate), v.plate, v.unit_id, u.name,
       r.bundle_id, r.state, r.hold_expires_at, r.chosen_at, r.released_at, r.release_reason, r.choose_until
  from fleet.driver_transfers x
  join fleet.vehicles v on v.id = x.host_vehicle_id or v.id = x.home_vehicle_id
  join org.units u on u.id = v.unit_id
  left join lateral (select o.bundle_id, o.state, o.hold_expires_at, o.chosen_at, o.released_at, o.release_reason,
                            o.choose_until
                       from sched.reservations o join sched.resources s on s.id = o.resource_id and s.kind = 'vehicle'
                      where x.offer_group_id is not null and o.offer_group_id = x.offer_group_id and s.ref_id = v.id
                      order by o.created_at desc limit 1) r on true
 where x.id = any($1::uuid[])`

// attachParts reads the vehicles of the requests with a vehicle mode of list (DriverTransfer.vehicle: 1b, 1f).
func attachParts(ctx context.Context, q pgx.Tx, list []*transfer, now time.Time) error {
	at := map[uuid.UUID]*transfer{}
	ids := []uuid.UUID{}
	for _, x := range list {
		if x.mode != nil {
			at[x.id] = x
			ids = append(ids, x.id)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	rows, err := q.Query(ctx, partsSQL, ids)
	if err != nil {
		return fmt.Errorf("pool: vehicles of the requests: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			id, vehicle, unit uuid.UUID
			p                 fleetapi.TransferVehicle
			unitName          string
			bundle            *uuid.UUID
			state, reason     *string
			expires, until    *time.Time
		)
		if err := rows.Scan(&id, &vehicle, &p.DisplayName, &p.RegistrationNumber, &unit, &unitName, &bundle, &state, &expires,
			&p.ChosenAt, &p.ReleasedAt, &reason, &until); err != nil {
			return fmt.Errorf("pool: vehicles of the requests: %w", err)
		}
		p.VehicleId, p.OrgUnitId, p.OrgUnitName, p.ReservationId = vehicle, unit, &unitName, bundle
		if state != nil {
			s := fleetapi.TransferVehicleReservationState(reservations.State(*state, expires, true, now))
			p.ReservationState = &s
		}
		if reason != nil {
			r := fleetapi.TransferVehicleReleaseReason(*reason)
			p.ReleaseReason = &r
		}
		p.ChosenAt, p.ReleasedAt = utc(p.ChosenAt), utc(p.ReleasedAt)
		x := at[id]
		if x.parts == nil {
			x.parts = map[uuid.UUID]fleetapi.TransferVehicle{}
		}
		x.parts[vehicle] = p
		if until != nil {
			x.chooseUntil = until
		}
	}
	return rows.Err()
}

// vehicleDTO is DriverTransfer.vehicle of x (nil — a request without a vehicle mode, 0.6.2).
func (x transfer) vehicleDTO() *fleetapi.DriverTransferVehicle {
	if x.mode == nil {
		return nil
	}
	out := &fleetapi.DriverTransferVehicle{Mode: fleetapi.DriverTransferVehicleMode(*x.mode), OfferGroupId: x.group,
		ChooseUntil: utc(x.chooseUntil)}
	if x.decision != nil {
		d := fleetapi.DriverTransferVehicleHomeDecision(*x.decision)
		out.HomeDecision = &d
	}
	if x.host != nil {
		if p, ok := x.parts[*x.host]; ok {
			out.HostVehicle = &p
		}
	}
	if x.home != nil {
		if p, ok := x.parts[*x.home]; ok {
			out.HomeVehicle = &p
		}
	}
	return out
}

// usualCard is the usual vehicle of publication p in the catalog (PoolUsualVehicle, rules 1–2): model, plate, body and
// dimensions; with trip t — its fit to the cargo and whether it is free for the window. A vehicle no longer of the
// home company or archived is not shown.
func (c *cmd) usualCard(ctx context.Context, p publication, t *tripCargo) (*fleetapi.PoolUsualVehicle, error) {
	v, ok, err := c.usualOf(ctx, p)
	if err != nil || !ok {
		return nil, err
	}
	d := v.DTO()
	out := &fleetapi.PoolUsualVehicle{VehicleId: v.ID, DisplayName: v.Name, RegistrationNumber: v.Plate,
		BodyType: fleetapi.PoolUsualVehicleBodyType(d.BodyType), Capacity: d.Capacity, TemperatureMinC: d.TemperatureMinC,
		TemperatureMaxC: d.TemperatureMaxC}
	if t == nil {
		return out, nil
	}
	reasons, free, err := fitOf(ctx, c.tx, v, *t, c.now)
	if err != nil {
		return nil, err
	}
	out.Fit, out.FreeForWindow = &fleetapi.VehicleFit{Ok: len(reasons) == 0, Reasons: reasons}, &free
	return out, nil
}

// catalogTrip reads the trip of listAvailableDrivers?tripId: visible to the actor (fleet.trips.read over its unit or
// its driver), else 404 «Рейс не найден.».
func (c *cmd) catalogTrip(ctx context.Context, id uuid.UUID) (*tripCargo, error) {
	notFound := problem.New(problem.CodeNotFound, textTripNotFound)
	t, err := loadTripCargo(ctx, c.tx, id, false)
	if err != nil {
		return nil, err
	}
	var persons []uuid.UUID
	if t.driver != nil {
		persons = []uuid.UUID{*t.driver}
	}
	if err := c.ev.Permit(ctx, c.tc, actionTripsRead, authz.Resource{Unit: t.unit, Persons: persons}); err != nil {
		if problem.Is(err, problem.CodeNotFound) || problem.Is(err, problem.CodeForbiddenAction) {
			return nil, notFound
		}
		return nil, err
	}
	return &t, nil
}
