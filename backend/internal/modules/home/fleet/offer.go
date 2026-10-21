package fleet

// W2.72 (S2-20 «Машина для временного водителя», 1g; docs/29 «"Требует решения" у логиста»; контракт DecisionItem.kind
// 0.6.3-stage2): two cards of the logist of the trip company — «водитель ещё не выбрал машину» while the choice of an
// offer is open and its deadline is less than 15 minutes away, and «нет машины» when the home company approved only the
// driver of a request with a vehicle (or the vehicle was taken off) and the trip has no live reservation. They never
// meet for one trip: a trip with an open offer holds its vehicles.

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	homeapi "github.com/ortus/ortus-crm/backend/internal/api/home"
	"github.com/ortus/ortus-crm/backend/internal/platform/scopeddb"
)

// Kinds of the cards of S2-20 (api/openapi/components/home/schemas.yaml DecisionItem.kind).
const (
	KindVehicleChoicePending = "fleet.vehicle_choice_pending"
	KindTripWithoutVehicle   = "fleet.trip_without_vehicle"
)

// ChoicePending is how long before the deadline of the choice the open offer becomes a card (docs/29: «за 15 минут до
// срока»).
const ChoicePending = 15 * time.Minute

// choicesSQL reads the open offers of the trips of the planning scope whose deadline comes within ChoicePending of $2:
// the reservation of the vehicle of the trip company («Оставить …»), both vehicles, the driver and his company.
const choicesSQL = `
select t.id, t.number, coalesce(p.full_name, ''), coalesce(x.name, ''), h.choose_until, h.bundle_id,
       coalesce(hv.display_name, hv.plate) || ' · ' || hv.plate, coalesce(mv.display_name, mv.plate) || ' · ' || mv.plate
  from fleet.trips t
  join lateral (select r.bundle_id, r.offer_group_id, r.choose_until, s.ref_id
                  from sched.reservations r join sched.resources s on s.id = r.resource_id and s.kind = 'vehicle'
                 where r.source_type = 'fleet.trip' and r.source_id = t.id and r.offer_kind = 'host' and r.state = 'hold'
                   and r.choose_until is not null
                 order by r.created_at desc limit 1) h on true
  join lateral (select s.ref_id
                  from sched.reservations r join sched.resources s on s.id = r.resource_id and s.kind = 'vehicle'
                 where r.offer_group_id = h.offer_group_id and r.offer_kind = 'usual' and r.state = 'hold'
                 limit 1) m on true
  join fleet.vehicles hv on hv.id = h.ref_id
  join fleet.vehicles mv on mv.id = m.ref_id
  left join people.person_profiles p on p.id = t.driver_person_id
  left join lateral (select u.name from fleet.driver_transfers d join org.units u on u.id = d.source_unit_id
                      where d.trip_id = t.id and d.state = 'approved'
                      order by d.created_at desc limit 1) x on true
 where t.state in ('planned', 'assigned') and h.choose_until > $2 and h.choose_until <= $2 + $3::interval
   and not exists (select 1 from sched.reservations o
                    where o.offer_group_id = h.offer_group_id and o.state in ('confirmed', 'consumed'))
   and ` + scopeddb.Placeholder + `
 order by h.choose_until, t.number, t.id
 limit $1`

// withoutVehicleSQL reads the trips of the planning scope of an approved request with a vehicle (S2-20) that wait for
// a vehicle at $2: planned, driven by the driver of the request, no live reservation.
const withoutVehicleSQL = `
select t.id, t.number, coalesce(p.full_name, ''), u.name, lower(t.planned)
  from fleet.driver_transfers d
  join fleet.pool_publications pp on pp.id = d.publication_id
  join fleet.trips t on t.id = d.trip_id
  join org.units u on u.id = d.source_unit_id
  left join people.person_profiles p on p.id = t.driver_person_id
 where d.state = 'approved' and d.vehicle_mode is not null and upper(d.period) > $2
   and t.state = 'planned' and t.vehicle_id is null and t.driver_person_id = pp.person_id
   and not exists (select 1 from sched.reservations r where r.source_type = 'fleet.trip' and r.source_id = t.id
                    and (r.state = 'confirmed' or (r.state = 'hold' and (r.hold_expires_at > $2 or r.offer_group_id is not null))))
   and ` + scopeddb.Placeholder + `
 order by lower(t.planned), t.number, t.id
 limit $1`

// vehicleCards are the cards of S2-20 of the planning scope at now: the open choices, then the trips without a vehicle.
func vehicleCards(ctx context.Context, conn *scopeddb.Conn, now time.Time) ([]homeapi.DecisionItem, error) {
	choices, err := query(ctx, conn, choicesSQL, func(row pgx.CollectableRow) (homeapi.DecisionItem, error) {
		var (
			id, reservation          uuid.UUID
			number, driver, unit     string
			until                    time.Time
			hostVehicle, homeVehicle string
		)
		if err := row.Scan(&id, &number, &driver, &unit, &until, &reservation, &hostVehicle, &homeVehicle); err != nil {
			return homeapi.DecisionItem{}, err
		}
		return homeapi.DecisionItem{
			Key: KindVehicleChoicePending + ":" + id.String(), Kind: KindVehicleChoicePending, ModuleKey: ModuleKey,
			Tone: homeapi.Warn, Object: tripRef(id),
			Params: map[string]string{paramTrip: number, paramDriver: driver, "homeOrgUnitName": unit,
				"chooseUntil": until.UTC().Format(time.RFC3339), "hostVehicle": hostVehicle, "homeVehicle": homeVehicle,
				"reservationId": reservation.String()},
		}, nil
	}, maxPerKind, now, fmt.Sprintf("%d seconds", int(ChoicePending.Seconds())))
	if err != nil {
		return nil, err
	}
	bare, err := query(ctx, conn, withoutVehicleSQL, func(row pgx.CollectableRow) (homeapi.DecisionItem, error) {
		var (
			id                   uuid.UUID
			number, driver, unit string
			starts               time.Time
		)
		if err := row.Scan(&id, &number, &driver, &unit, &starts); err != nil {
			return homeapi.DecisionItem{}, err
		}
		return homeapi.DecisionItem{
			Key: KindTripWithoutVehicle + ":" + id.String(), Kind: KindTripWithoutVehicle, ModuleKey: ModuleKey,
			Tone: homeapi.Danger, Object: tripRef(id),
			Params: map[string]string{paramTrip: number, paramDriver: driver, "homeOrgUnitName": unit,
				"startsAt": starts.UTC().Format(time.RFC3339)},
		}, nil
	}, maxPerKind, now)
	if err != nil {
		return nil, err
	}
	return append(choices, bare...), nil
}

// query runs a query of the planning scope (fleet.routes.manage over the unit of the trip) with args and scans every
// row with scan.
func query(ctx context.Context, conn *scopeddb.Conn, sql string, scan func(pgx.CollectableRow) (homeapi.DecisionItem, error),
	args ...any) ([]homeapi.DecisionItem, error) {
	rows, err := conn.Query(ctx, actionPlan, tripColumns, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("home/fleet: %s: %w", actionPlan, err)
	}
	items, err := pgx.CollectRows(rows, scan)
	if err != nil {
		return nil, fmt.Errorf("home/fleet: %s: %w", actionPlan, err)
	}
	return items, nil
}
