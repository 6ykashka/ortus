package routes

import (
	"context"
	"errors"
	"maps"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W2.03: shared command helpers of the modules (Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// numberPrefix is the prefix of a trip number (Р-208 of the prototype); the counter of core.counters numbers them.
const (
	numberPrefix = "Р-"
	counterTrips = "fleet.trips"
)

// CreateTripPlan implements fleetapi.StrictServerInterface: a planned trip in a unit of the area of
// fleet.routes.manage with the number of core.counters, its cargo, its stops with the load per leg checked (checkCreate)
// and an optional driver — an active person in the area of the actor with the work function «Водитель» at the start of
// the window, not busy in an overlapping trip (409 resources_unavailable). The legal entity of the trip is the one of
// its company by default. Writes the audit row and fleet.trip.planned.v1.
func (s *Server) CreateTripPlan(ctx context.Context, req fleetapi.CreateTripPlanRequestObject) (fleetapi.CreateTripPlanResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	in, err := checkCreate(req.Body)
	if err != nil {
		return nil, err
	}
	now := s.now()
	var out fleetapi.TripPlan
	err = kit.Tx(ctx, s.Pools, tc.TenantID, func(tx pgx.Tx) error {
		c := command{tx: tx, ev: s.within(tx, now), tc: tc, now: now}
		var err error
		out, err = c.plan(ctx, in)
		return err
	})
	if err != nil {
		return nil, dbError(err)
	}
	tag, replayed := kit.ETag(out.Revision), false
	return fleetapi.CreateTripPlan201JSONResponse{
		Body: out,
		Headers: fleetapi.CreateTripPlan201ResponseHeaders{
			CacheControl: noStore(), ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid(ctx),
		},
	}, nil
}

// command is one command of the module in its transaction.
type command struct {
	tx  pgx.Tx
	ev  *authz.Evaluator
	tc  tenantctx.TenantContext
	now time.Time
}

func (c command) plan(ctx context.Context, in planInput) (fleetapi.TripPlan, error) {
	if err := c.unit(ctx, in.unit); err != nil {
		return fleetapi.TripPlan{}, err
	}
	if in.driver != nil {
		if err := c.driver(ctx, *in.driver, in); err != nil {
			return fleetapi.TripPlan{}, err
		}
	}
	legal, err := c.legalEntity(ctx, in.unit)
	if err != nil {
		return fleetapi.TripPlan{}, err
	}
	number, err := c.number(ctx)
	if err != nil {
		return fleetapi.TripPlan{}, err
	}
	id, err := c.insert(ctx, in, number, legal)
	if err != nil {
		return fleetapi.TripPlan{}, err
	}
	diff := map[string]any{"number": number, "title": in.title, "startsAt": in.window.Start, "endsAt": in.window.End}
	if in.driver != nil {
		diff["driverMemberId"] = *in.driver
	}
	if err := kit.Audit(ctx, c.tx, audit.Event{
		Action: "fleet.trip.plan", TargetType: targetTrip, TargetID: id, UnitID: in.unit, Diff: diff,
	}); err != nil {
		return fleetapi.TripPlan{}, err
	}
	payload := map[string]any{"tripId": id, "unitId": in.unit}
	maps.Copy(payload, diff)
	if _, err := events.Publish(ctx, c.tx, events.Event{
		Type: eventPlanned, Aggregate: targetTrip, AggregateID: id, Payload: payload,
	}); err != nil {
		return fleetapi.TripPlan{}, err
	}
	out, err := Plan(ctx, c.tx, id)
	if err != nil {
		return fleetapi.TripPlan{}, err
	}
	return out, kit.Complete(ctx, c.tx, http.StatusCreated, kit.ETag(out.Revision), out)
}

// unit checks the unit of the trip under a share lock (an archive in progress waits): a unit the actor cannot see
// (org_units.read) answers like a missing one (422, as createVehicle), a visible one without fleet.routes.manage is 403.
func (c command) unit(ctx context.Context, unit uuid.UUID) error {
	var found uuid.UUID
	err := c.tx.QueryRow(ctx, `select id from org.units where id = $1 and archived_at is null for share`, unit).Scan(&found)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return kit.Invalid(textUnit)
	case err != nil:
		return err
	}
	err = c.ev.Permit(ctx, c.tc, ActionManage, authz.Resource{Unit: unit, ReadAction: actionUnitsRead})
	if problem.Is(err, problem.CodeNotFound) {
		return kit.Invalid(textUnit)
	}
	return err
}

// driver checks the driver of the trip: a person of the tenant — the actor itself, or a person whose home unit is in
// the area of fleet.routes.manage of the actor and visible to it (members.read) — with the work function «Водитель» at
// the start of the window; anything else is the same 422 (AC-01, AC-02). The row of the person is locked (for no key
// update: the foreign keys of other trips still share it), so two plans of one driver queue and the second sees the
// first trip: an overlapping trip that is neither accepted nor cancelled is 409 resources_unavailable.
func (c command) driver(ctx context.Context, person uuid.UUID, in planInput) error {
	var (
		home   uuid.UUID
		driver bool
	)
	err := c.tx.QueryRow(ctx, `select p.home_unit_id, exists (select 1 from people.work_profiles w
		 where w.person_id = p.id and w.function = $2 and w.valid @> $3::timestamptz)
		  from people.person_profiles p where p.id = $1 and p.archived_at is null for no key update of p`,
		person, functionDriver, in.window.Start).Scan(&home, &driver)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return kit.Invalid(textDriver)
	case err != nil:
		return err
	}
	if person != c.tc.PersonID {
		r := authz.Resource{Unit: home, Persons: []uuid.UUID{person}, ReadAction: actionMembersRead}
		err := c.ev.Permit(ctx, c.tc, ActionManage, r)
		switch {
		case problem.Is(err, problem.CodeNotFound), problem.Is(err, problem.CodeForbiddenAction):
			return kit.Invalid(textDriver)
		case err != nil:
			return err
		}
	}
	if !driver {
		return kit.Invalid(textDriver)
	}
	var busy bool
	if err := c.tx.QueryRow(ctx, `select exists (select 1 from fleet.trips where driver_person_id = $1
		 and state not in ('accepted', 'cancelled') and planned && tstzrange($2, $3, '[)'))`,
		person, in.window.Start, in.window.End).Scan(&busy); err != nil {
		return err
	}
	if busy {
		return problem.New(codeUnavailable, textDriverBusy)
	}
	return nil
}

// legalEntity is the legal entity of the company of unit (answer of the product owner 17.10: by default, no UI in stage
// 2): the nearest unit up the tree with legal entities; none, or several at the nearest unit, — none.
func (c command) legalEntity(ctx context.Context, unit uuid.UUID) (*uuid.UUID, error) {
	var (
		le uuid.UUID
		n  int
	)
	err := c.tx.QueryRow(ctx, `select min(le.legal_entity_id::text)::uuid, count(*)
		  from org.unit_closure uc join org.unit_legal_entities le on le.unit_id = uc.ancestor_id
		 where uc.descendant_id = $1
		 group by uc.depth order by uc.depth limit 1`, unit).Scan(&le, &n)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return nil, nil
	case err != nil:
		return nil, err
	case n != 1:
		return nil, nil
	}
	return &le, nil
}

// number takes the next trip number of core.counters, never below the largest number of the trips written without the
// counter (a seed, an import) plus one. The row of the counter serializes concurrent plans.
func (c command) number(ctx context.Context) (string, error) {
	var n int64
	err := c.tx.QueryRow(ctx, `insert into core.counters (name, value)
		values ($1, (select coalesce(max(substring(number from '([0-9]{1,15})$')::bigint), 0) from fleet.trips) + 1)
		on conflict (name) do update set value = greatest(core.counters.value, excluded.value - 1) + 1
		returning value`, counterTrips).Scan(&n)
	if err != nil {
		return "", err
	}
	return numberPrefix + strconv.FormatInt(n, 10), nil
}

// insert writes the trip and its stops.
func (c command) insert(ctx context.Context, in planInput, number string, legal *uuid.UUID) (uuid.UUID, error) {
	var tempMin, tempMax, distance *string
	if in.cargo.tempMin != nil {
		lo, hi := decimal(*in.cargo.tempMin, 1), decimal(*in.cargo.tempMax, 1)
		tempMin, tempMax = &lo, &hi
	}
	if in.distance != nil {
		d := decimal(*in.distance, 1)
		distance = &d
	}
	var id uuid.UUID
	err := c.tx.QueryRow(ctx, `insert into fleet.trips (number, unit_id, state, driver_person_id, planned, cargo_weight_kg,
		cargo_volume_m3, cargo_length_mm, cargo_temp_min_c, cargo_temp_max_c, title, cargo_description, distance_km,
		legal_entity_id)
		values ($1, $2, 'planned', $3, tstzrange($4, $5, '[)'), $6::numeric, $7::numeric, $8, $9::numeric, $10::numeric,
		        $11, $12, $13::numeric, $14)
		returning id`,
		number, in.unit, in.driver, in.window.Start, in.window.End, decimal(in.cargo.weight, 1),
		decimal(in.cargo.volume, 2), in.cargo.lengthMM, tempMin, tempMax, in.title, in.cargo.description, distance,
		legal).Scan(&id)
	if err != nil {
		return uuid.Nil, err
	}
	n := len(in.stops)
	seqs, ops, addresses := make([]int32, n), make([]string, n), make([]string, n)
	ats, weights, volumes, contacts := make([]*time.Time, n), make([]string, n), make([]string, n), make([]*string, n)
	for i, s := range in.stops {
		seqs[i], ops[i], addresses[i], ats[i] = int32(s.seq), s.op, s.address, s.at //nolint:gosec // 1…100 (checkStops)
		weights[i], volumes[i], contacts[i] = decimal(s.weight, 1), decimal(s.volume, 2), s.contact
	}
	_, err = c.tx.Exec(ctx, `insert into fleet.trip_stops (trip_id, seq, op, address, time_window, weight_kg, volume_m3, contact)
		select $1, s.seq, s.op, s.address, case when s.at is null then null else tstzrange(s.at, s.at, '[]') end,
		       s.w::numeric, s.v::numeric, s.contact
		  from unnest($2::int[], $3::text[], $4::text[], $5::timestamptz[], $6::text[], $7::text[], $8::text[])
		       as s(seq, op, address, at, w, v, contact)`,
		id, seqs, ops, addresses, ats, weights, volumes, contacts)
	return id, err
}
