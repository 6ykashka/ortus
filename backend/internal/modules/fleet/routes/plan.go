package routes

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// Texts of the answers (the mock W2.00, trips.ts).
const (
	textUnit         = "Подразделение не найдено."
	textDriver       = "Проверьте водителя: нужен действующий сотрудник с функцией «Водитель»."
	textDriverBusy   = "Водитель уже занят в это время."
	textTripNotFound = "Рейс не найден."
)

// planSelect reads trips as TripPlan; the caller adds the conditions. The window of a trip is shown in the time zone of
// its unit (fleet.trips keeps no zone, as sched.reservations: Q-W2.02-1). The hold is the row of the vehicle of the
// bundle (its id is the bundle, W2.02): a released one is no reservation of the trip any more. The blocking defect is
// the one in review of the departure of a trip in defect_review; acceptedAt is the review time of an accepted trip.
const planSelect = `select t.id, t.number, coalesce(t.title, t.number), t.unit_id, t.state, lower(t.planned), upper(t.planned),
       u.time_zone, trim_scale(t.distance_km)::text, coalesce(t.cargo_description, ''),
       trim_scale(t.cargo_weight_kg)::text, trim_scale(t.cargo_volume_m3)::text,
       trim_scale(coalesce(t.cargo_length_mm, 0) / 1000.0)::text, trim_scale(t.cargo_temp_min_c)::text,
       trim_scale(t.cargo_temp_max_c)::text, t.driver_person_id, p.full_name, t.vehicle_id,
       case when h.state <> 'released' then t.reservation_bundle_id end,
       case when h.state = 'hold' then h.hold_expires_at end, t.departure_inspection_id, t.return_inspection_id,
       (select d.id from fleet.defects d
         where t.state = 'defect_review' and d.inspection_id = t.departure_inspection_id and d.severity = 'blocking'
           and d.state = 'in_review'
         order by d.created_at, d.id limit 1),
       t.started_at, t.route_completed_at, t.returned_at, case when t.state = 'accepted' then t.reviewed_at end,
       t.legal_entity_id, t.revision
  from fleet.trips t
  join org.units u on u.id = t.unit_id
  left join people.person_profiles p on p.id = t.driver_person_id
  left join sched.reservations h on h.id = t.reservation_bundle_id`

// The details of the trips $1: their stops and their latest review; %s is the scope of a read (" and {{scope}}") or
// nothing for a command that authorized the trip.
const (
	stopsSQL = `select s.trip_id, s.seq, s.op, s.address, lower(s.time_window), trim_scale(s.weight_kg)::text,
       trim_scale(s.volume_m3)::text, s.contact, s.navigation_address
  from fleet.trip_stops s join fleet.trips t on t.id = s.trip_id
 where s.trip_id = any($1)%s
 order by s.trip_id, s.seq`
	reviewsSQL = `select distinct on (r.trip_id) r.trip_id, r.attempt, r.decision, r.comment, r.steps, r.reviewed_by,
       r.reviewed_at
  from fleet.trip_reviews r join fleet.trips t on t.id = r.trip_id
 where r.trip_id = any($1)%s
 order by r.trip_id, r.attempt desc`
)

func scanPlan(row pgx.Row) (fleetapi.TripPlan, error) {
	var (
		p                      fleetapi.TripPlan
		state                  string
		lengthM                string
		bundle, defect         *uuid.UUID
		accepted               *time.Time
		hold, routed, returned *time.Time
	)
	err := row.Scan(&p.Id, &p.Number, &p.Title, &p.OrgUnitId, &state, &p.PlannedWindow.StartsAt, &p.PlannedWindow.EndsAt,
		&p.PlannedWindow.TimeZone, &p.DistanceKm, &p.Cargo.Description, &p.Cargo.WeightKg, &p.Cargo.VolumeM3, &lengthM,
		&p.Cargo.TemperatureMinC, &p.Cargo.TemperatureMaxC, &p.DriverMemberId, &p.DriverDisplayName, &p.VehicleId, &bundle,
		&hold, &p.DepartureInspectionId, &p.ReturnInspectionId, &defect, &p.StartedAt, &routed, &returned, &accepted,
		&p.LegalEntityId, &p.Revision)
	if err != nil {
		return fleetapi.TripPlan{}, err
	}
	p.State, p.Cargo.LengthM, p.ReservationId, p.BlockingDefectId = fleetapi.TripState(state), lengthM, bundle, defect
	p.PlannedWindow.StartsAt, p.PlannedWindow.EndsAt = p.PlannedWindow.StartsAt.UTC(), p.PlannedWindow.EndsAt.UTC()
	p.HoldExpiresAt, p.StartedAt, p.RouteCompletedAt, p.ReturnedAt, p.AcceptedAt = utc(hold), utc(p.StartedAt), utc(routed),
		utc(returned), utc(accepted)
	p.Stops = []fleetapi.TripStop{}
	return p, nil
}

func utc(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	v := t.UTC()
	return &v
}

// query runs a statement of the details: through scopeddb for a read, through the transaction for a command.
type query func(ctx context.Context, sql string, args ...any) (pgx.Rows, error)

// details fills the stops and the latest review of plans.
func details(ctx context.Context, q query, scope string, plans []fleetapi.TripPlan) error {
	if len(plans) == 0 {
		return nil
	}
	ids := make([]uuid.UUID, len(plans))
	at := make(map[uuid.UUID]int, len(plans))
	for i, p := range plans {
		ids[i], at[p.Id] = p.Id, i
	}
	rows, err := q(ctx, fmt.Sprintf(stopsSQL, scope), ids)
	if err != nil {
		return err
	}
	if err := forEach(rows, func(r pgx.CollectableRow) error {
		var (
			trip uuid.UUID
			s    fleetapi.TripStop
			op   string
		)
		if err := r.Scan(&trip, &s.Sequence, &op, &s.Address, &s.PlannedAt, &s.WeightKg, &s.VolumeM3, &s.Contact,
			&s.NavigationAddress); err != nil {
			return err
		}
		s.Op, s.PlannedAt = fleetapi.TripStopOp(op), utc(s.PlannedAt)
		plans[at[trip]].Stops = append(plans[at[trip]].Stops, s)
		return nil
	}); err != nil {
		return err
	}
	if rows, err = q(ctx, fmt.Sprintf(reviewsSQL, scope), ids); err != nil {
		return err
	}
	return forEach(rows, func(r pgx.CollectableRow) error {
		var (
			trip     uuid.UUID
			v        fleetapi.TripReviewSummary
			decision string
			steps    []string
		)
		if err := r.Scan(&trip, &v.Attempt, &decision, &v.Comment, &steps, &v.ReviewerMemberId, &v.ReviewedAt); err != nil {
			return err
		}
		v.Decision, v.ReviewedAt = fleetapi.TripReviewSummaryDecision(decision), v.ReviewedAt.UTC()
		if len(steps) > 0 {
			list := make([]fleetapi.ReworkStep, len(steps))
			for i, s := range steps {
				list[i] = fleetapi.ReworkStep(s)
			}
			v.Steps = &list
		}
		plans[at[trip]].LastReview = &v
		return nil
	})
}

func forEach(rows pgx.Rows, fn func(pgx.CollectableRow) error) error {
	_, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (struct{}, error) { return struct{}{}, fn(r) })
	return err
}

// Plan reads the trip id through q without a scope (the caller authorizes it) as the TripPlan of the contract: the
// answer of a command of the trip (W2.03, W2.05). No such trip is 404 «Рейс не найден.».
func Plan(ctx context.Context, q Querier, id uuid.UUID) (fleetapi.TripPlan, error) {
	p, err := scanPlan(q.QueryRow(ctx, planSelect+` where t.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return fleetapi.TripPlan{}, problem.New(problem.CodeNotFound, textTripNotFound)
	}
	if err != nil {
		return fleetapi.TripPlan{}, err
	}
	plans := []fleetapi.TripPlan{p}
	if err := details(ctx, q.Query, "", plans); err != nil {
		return fleetapi.TripPlan{}, err
	}
	return plans[0], nil
}
