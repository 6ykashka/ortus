package trips

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/scopeddb"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Actions of the module (api/permissions.yaml, fleet).
const (
	actionRead   = "fleet.trips.read"
	actionStart  = "fleet.trips.start"
	actionReturn = "fleet.trips.return"
	actionReview = "fleet.trips.review"
)

// Page sizes (common/parameters.yaml Limit).
const (
	defaultPageLimit = 50
	maxPageLimit     = 200
)

// planColumns are the columns the scope of fleet.trips.read filters trips on: the unit of the trip and its «own»
// person — the driver.
var planColumns = authz.Columns{Unit: "t.unit_id", Persons: []string{"t.driver_person_id"}}

// allStates are the values of TripState.
var allStates = []string{"planned", "assigned", stateInspection, stateDefectReview, stateOnRoute, stateReturning,
	stateSubmitted, stateRework, stateAccepted, "cancelled"}

// startedStates are the states of a trip with a 0.1 Trip.
var startedStates = []string{stateOnRoute, stateReturning, stateSubmitted, stateRework, stateAccepted}

// planSelect reads the TripPlan projection of fleet.trips (contract 0.5.0-stage2, Q-45) as the TripPlan of W2.03
// (fleet/routes plan.go); the caller adds conditions. The reservation is the bundle of the trip until its hold is
// released (the row of the vehicle carries the id of the bundle, W2.02), the hold is shown while that row is a hold;
// the blocking defect is the one in review of the departure of a trip in defect_review; acceptedAt is the review of an
// accepted trip.
const planSelect = `
select t.id, t.number, coalesce(t.title, t.number), t.unit_id, u.time_zone, t.state, lower(t.planned), upper(t.planned),
       trim_scale(t.distance_km)::text, coalesce(t.cargo_description, ''), trim_scale(t.cargo_weight_kg)::text,
       trim_scale(t.cargo_volume_m3)::text, coalesce(trim_scale(t.cargo_length_mm / 1000.0)::text, '0'),
       trim_scale(t.cargo_temp_min_c)::text, trim_scale(t.cargo_temp_max_c)::text,
       t.driver_person_id, p.full_name, t.vehicle_id, case when h.state <> 'released' then t.reservation_bundle_id end,
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

func scanPlan(row pgx.Row) (fleetapi.TripPlan, error) {
	var (
		p                  fleetapi.TripPlan
		state              string
		tempMin, tempMax   *string
		started, completed *time.Time
		returned, accepted *time.Time
		hold               *time.Time
	)
	err := row.Scan(&p.Id, &p.Number, &p.Title, &p.OrgUnitId, &p.PlannedWindow.TimeZone, &state,
		&p.PlannedWindow.StartsAt, &p.PlannedWindow.EndsAt, &p.DistanceKm, &p.Cargo.Description, &p.Cargo.WeightKg,
		&p.Cargo.VolumeM3, &p.Cargo.LengthM, &tempMin, &tempMax, &p.DriverMemberId, &p.DriverDisplayName, &p.VehicleId,
		&p.ReservationId, &hold, &p.DepartureInspectionId, &p.ReturnInspectionId, &p.BlockingDefectId, &started,
		&completed, &returned, &accepted, &p.LegalEntityId, &p.Revision)
	if err != nil {
		return fleetapi.TripPlan{}, err
	}
	p.State = fleetapi.TripState(state)
	p.PlannedWindow.StartsAt, p.PlannedWindow.EndsAt = p.PlannedWindow.StartsAt.UTC(), p.PlannedWindow.EndsAt.UTC()
	if tempMin != nil && tempMax != nil {
		p.Cargo.TemperatureMinC, p.Cargo.TemperatureMaxC = tempMin, tempMax
	}
	p.HoldExpiresAt, p.StartedAt, p.RouteCompletedAt = utc(hold), utc(started), utc(completed)
	p.ReturnedAt, p.AcceptedAt = utc(returned), utc(accepted)
	p.Stops = []fleetapi.TripStop{}
	return p, nil
}

func utc(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	u := t.UTC()
	return &u
}

func idStrings(list []fleetapi.TripPlan) []string {
	out := make([]string, 0, len(list))
	for _, p := range list {
		out = append(out, p.Id.String())
	}
	return out
}

const stopsSQL = `
select trip_id, seq, op, address, lower(time_window), trim_scale(weight_kg)::text, trim_scale(volume_m3)::text, contact
  from fleet.trip_stops where trip_id = any($1::uuid[]) order by trip_id, seq`

const reviewsSQL = `
select distinct on (trip_id) trip_id, attempt, decision, comment, steps, reviewed_by, reviewed_at
  from fleet.trip_reviews where trip_id = any($1::uuid[]) order by trip_id, attempt desc`

// attach fills the stops and the latest review of list (two queries for the page).
func attach(ctx context.Context, q querier, list []fleetapi.TripPlan) error {
	if len(list) == 0 {
		return nil
	}
	at := make(map[uuid.UUID]int, len(list))
	for i := range list {
		at[list[i].Id] = i
	}
	ids := idStrings(list)
	rows, err := q.Query(ctx, stopsSQL, ids)
	if err != nil {
		return fmt.Errorf("trips: stops: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			trip uuid.UUID
			s    fleetapi.TripStop
			op   string
		)
		if err := rows.Scan(&trip, &s.Sequence, &op, &s.Address, &s.PlannedAt, &s.WeightKg, &s.VolumeM3, &s.Contact); err != nil {
			return fmt.Errorf("trips: stops: %w", err)
		}
		s.Op, s.PlannedAt = fleetapi.TripStopOp(op), utc(s.PlannedAt)
		list[at[trip]].Stops = append(list[at[trip]].Stops, s)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("trips: stops: %w", err)
	}
	rows.Close()
	rrows, err := q.Query(ctx, reviewsSQL, ids)
	if err != nil {
		return fmt.Errorf("trips: reviews: %w", err)
	}
	defer rrows.Close()
	for rrows.Next() {
		var (
			trip     uuid.UUID
			r        fleetapi.TripReviewSummary
			decision string
			steps    []string
		)
		if err := rrows.Scan(&trip, &r.Attempt, &decision, &r.Comment, &steps, &r.ReviewerMemberId, &r.ReviewedAt); err != nil {
			return fmt.Errorf("trips: reviews: %w", err)
		}
		r.Decision, r.ReviewedAt = fleetapi.TripReviewSummaryDecision(decision), r.ReviewedAt.UTC()
		if len(steps) > 0 {
			out := make([]fleetapi.ReworkStep, 0, len(steps))
			for _, s := range steps {
				out = append(out, fleetapi.ReworkStep(s))
			}
			r.Steps = &out
		}
		list[at[trip]].LastReview = &r
	}
	if err := rrows.Err(); err != nil {
		return fmt.Errorf("trips: reviews: %w", err)
	}
	return nil
}

// loadPlan reads trip id in q (the transaction of a command that already checked access).
func loadPlan(ctx context.Context, q querier, id uuid.UUID) (fleetapi.TripPlan, error) {
	p, err := scanPlan(q.QueryRow(ctx, planSelect+` where t.id = $1`, id))
	if err != nil {
		return fleetapi.TripPlan{}, fmt.Errorf("trips: read back: %w", err)
	}
	list := []fleetapi.TripPlan{p}
	if err := attach(ctx, q, list); err != nil {
		return fleetapi.TripPlan{}, err
	}
	return list[0], nil
}

// ownDriver is the person a driver-only subject is limited to (driverOnly); nil — no such limit.
func (s *Service) ownDriver(ctx context.Context, q querier, tc tenantctx.TenantContext) (any, error) {
	only, err := driverOnly(ctx, q, tc, s.now())
	if err != nil || !only {
		return nil, err
	}
	return tc.PersonID, nil
}

// Plan returns a trip the subject reads (getTripPlan): fleet.trips.read over its unit or as its driver; a member
// with the driver function reads only his trips. Invisible, foreign and missing ids are one 404 (AC-01).
func (s *Service) Plan(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (fleetapi.TripPlan, error) {
	pool, err := s.pool(ctx, tc)
	if err != nil {
		return fleetapi.TripPlan{}, err
	}
	conn, err := scopeddb.For(ctx, s.Pools, s.Authz, tc)
	if err != nil {
		return fleetapi.TripPlan{}, dbError(err)
	}
	own, err := s.ownDriver(ctx, pool, tc)
	if err != nil {
		return fleetapi.TripPlan{}, err
	}
	var out fleetapi.TripPlan
	err = conn.One(ctx, actionRead, planColumns, func(row pgx.Row) error {
		var err error
		out, err = scanPlan(row)
		return err
	}, planSelect+` where t.id = $1 and ($2::uuid is null or t.driver_person_id = $2::uuid) and `+scopeddb.Placeholder, id, own)
	if problem.Is(err, problem.CodeNotFound) {
		return fleetapi.TripPlan{}, problem.New(problem.CodeNotFound, textTripNotFound)
	}
	if err != nil {
		return fleetapi.TripPlan{}, dbError(err)
	}
	list := []fleetapi.TripPlan{out}
	if err := attach(ctx, pool, list); err != nil {
		return fleetapi.TripPlan{}, dbError(err)
	}
	return list[0], nil
}

// cursor is the keyset position after the last item of a page: the start of the window, the number, the id.
type cursor struct {
	At     time.Time `json:"t"`
	Number string    `json:"n"`
	ID     uuid.UUID `json:"i"`
}

func encodeCursor(p fleetapi.TripPlan) string {
	b, _ := json.Marshal(cursor{At: p.PlannedWindow.StartsAt, Number: p.Number, ID: p.Id}) // plain fields always marshal
	return base64.RawURLEncoding.EncodeToString(b)
}

func decodeCursor(raw string) (cursor, error) {
	var c cursor
	b, err := base64.RawURLEncoding.DecodeString(raw)
	if err == nil {
		err = json.Unmarshal(b, &c)
	}
	if err != nil || c.ID == uuid.Nil {
		return cursor{}, problem.New(problem.CodeMalformedRequest, "Курсор не подходит к запросу.")
	}
	return c, nil
}

func pageLimit(n int) (int, error) {
	switch {
	case n == 0:
		return defaultPageLimit, nil
	case n < 1 || n > maxPageLimit:
		return 0, problem.New(problem.CodeMalformedRequest, "Размер страницы — от 1 до 200.")
	}
	return n, nil
}

func orNil(id uuid.UUID) any {
	if id == uuid.Nil {
		return nil
	}
	return id
}

const plansSQL = planSelect + `
 where ($1::text[] is null or t.state = any($1::text[]))
   and ($2::uuid is null or t.unit_id in (select descendant_id from org.unit_closure where ancestor_id = $2::uuid))
   and ($3::uuid is null or t.driver_person_id = $3::uuid)
   and ($4::uuid is null or t.driver_person_id = $4::uuid)
   and ($5::timestamptz is null or (lower(t.planned), t.number, t.id) > ($5::timestamptz, $6::text, $7::uuid))
   and ` + scopeddb.Placeholder + `
 order by lower(t.planned), t.number, t.id
 limit $8`

// planArgs are the checked parameters of listTripPlans.
type planArgs struct {
	limit  int
	states any // []string; nil — any state
	at     any // time.Time of the cursor; nil — the first page
	number string
	after  uuid.UUID
}

func (q PlanQuery) args() (planArgs, error) {
	limit, err := pageLimit(q.Limit)
	if err != nil {
		return planArgs{}, err
	}
	a := planArgs{limit: limit}
	for _, st := range q.States {
		if !slices.Contains(allStates, st) {
			return planArgs{}, problem.New(problem.CodeMalformedRequest, "Неизвестное состояние рейса.")
		}
	}
	if len(q.States) > 0 {
		a.states = q.States
	}
	if q.Cursor != "" {
		c, err := decodeCursor(q.Cursor)
		if err != nil {
			return planArgs{}, err
		}
		a.at, a.number, a.after = c.At, c.Number, c.ID
	}
	return a, nil
}

// Plans lists the trips the subject reads (listTripPlans): the scope filters before pagination, a member with the
// driver function sees only his trips; order — the start of the planned window, then the number.
func (s *Service) Plans(ctx context.Context, tc tenantctx.TenantContext, q PlanQuery) (fleetapi.TripPlanPage, error) {
	a, err := q.args()
	if err != nil {
		return fleetapi.TripPlanPage{}, err
	}
	pool, err := s.pool(ctx, tc)
	if err != nil {
		return fleetapi.TripPlanPage{}, err
	}
	conn, err := scopeddb.For(ctx, s.Pools, s.Authz, tc)
	if err != nil {
		return fleetapi.TripPlanPage{}, dbError(err)
	}
	own, err := s.ownDriver(ctx, pool, tc)
	if err != nil {
		return fleetapi.TripPlanPage{}, err
	}
	rows, err := conn.Query(ctx, actionRead, planColumns, plansSQL, a.states, orNil(q.Unit), orNil(q.Driver), own, a.at,
		a.number, a.after, a.limit+1)
	if err != nil {
		return fleetapi.TripPlanPage{}, dbError(err)
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (fleetapi.TripPlan, error) { return scanPlan(row) })
	if err != nil {
		return fleetapi.TripPlanPage{}, dbError(err)
	}
	page := fleetapi.TripPlanPage{Items: items}
	if len(items) > a.limit {
		page.Items = items[:a.limit]
		next := encodeCursor(page.Items[a.limit-1])
		page.NextCursor = &next
	}
	if err := attach(ctx, pool, page.Items); err != nil {
		return fleetapi.TripPlanPage{}, dbError(err)
	}
	return page, nil
}

// Trip returns the 0.1 Trip of a started trip the subject reads (getTrip); before the start — 404.
func (s *Service) Trip(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (fleetapi.Trip, error) {
	p, err := s.Plan(ctx, tc, id)
	if err != nil {
		return fleetapi.Trip{}, err
	}
	t, ok := tripOf(p)
	if !ok {
		return fleetapi.Trip{}, problem.New(problem.CodeNotFound, textNotStarted)
	}
	return t, nil
}

// Trips lists the started trips the subject reads (listTrips), in the order of listTripPlans.
func (s *Service) Trips(ctx context.Context, tc tenantctx.TenantContext, q PageQuery) (fleetapi.TripPage, error) {
	p, err := s.Plans(ctx, tc, PlanQuery{Cursor: q.Cursor, Limit: q.Limit, States: startedStates})
	if err != nil {
		return fleetapi.TripPage{}, err
	}
	out := fleetapi.TripPage{Items: make([]fleetapi.Trip, 0, len(p.Items)), NextCursor: p.NextCursor}
	for _, it := range p.Items {
		if t, ok := tripOf(it); ok {
			out.Items = append(out.Items, t)
		}
	}
	return out, nil
}

// errNoRows tells a missing row from a failed query.
func errNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }
