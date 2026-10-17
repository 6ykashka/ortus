package routes

import (
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W2.03: shared command helpers of the modules (Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/scopeddb"
)

// scoped is the scope of a read of the details (stopsSQL, reviewsSQL).
const scoped = " and {{scope}}"

// ownOnly keeps the trips of a member with an active work function «Водитель» to those it drives ($a — the person of
// the actor, $b — the clock), whatever its grants say (listTripPlans: «even with a wider fleet.trips.read grant», D22).
const ownOnly = `(t.driver_person_id = %[1]s or not exists (select 1 from people.work_profiles w
       where w.person_id = %[1]s and w.function = 'driver' and w.valid @> %[2]s::timestamptz))`

// getSQL reads the trip $1 for the actor $2 at $3.
var getSQL = planSelect + `
 where t.id = $1 and {{scope}} and ` + own("$2", "$3")

// listSQL pages the trips the actor $1 sees at $2 by the start of the window, the number and the id: $3 — the unit
// filter (its subtree) or null, $4 — the states or null, $5 — the driver or null, $6…$8 — the keyset position or
// null, $9 — the page size.
var listSQL = planSelect + `
 where {{scope}} and ` + own("$1", "$2") + `
   and ($3::uuid is null or t.unit_id in (select descendant_id from org.unit_closure where ancestor_id = $3))
   and ($4::text[] is null or t.state = any($4))
   and ($5::uuid is null or t.driver_person_id = $5)
   and ($6::timestamptz is null or (lower(t.planned), t.number, t.id) > ($6::timestamptz, $7::text, $8::uuid))
 order by lower(t.planned), t.number, t.id
 limit $9`

func own(person, at string) string {
	return fmt.Sprintf(ownOnly, person, at)
}

// scopedQuery runs the statements of the details through c with the scope of fleet.trips.read.
func scopedQuery(c *scopeddb.Conn) query {
	return func(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
		return c.Query(ctx, ActionTripsRead, Columns, sql, args...)
	}
}

// tripStates are the states of the contract (TripState).
var tripStates = []fleetapi.TripState{
	"planned", "assigned", "inspection", "defect_review", "on_route", "returning", "submitted", "rework", "accepted",
	"cancelled",
}

// GetTripPlan implements fleetapi.StrictServerInterface: one trip in any state with its cargo, stops, hold,
// inspections, blocking defect and latest review. A trip outside the scope of fleet.trips.read (its unit or its
// driver), or of another driver for a member with the function «Водитель», is 404 like a missing one (AC-01).
func (s *Server) GetTripPlan(ctx context.Context, req fleetapi.GetTripPlanRequestObject) (fleetapi.GetTripPlanResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	c, err := s.conn(ctx, tc)
	if err != nil {
		return nil, err
	}
	var p fleetapi.TripPlan
	err = c.One(ctx, ActionTripsRead, Columns, func(row pgx.Row) error {
		var err error
		p, err = scanPlan(row)
		return err
	}, getSQL, req.TripId, tc.PersonID, s.now())
	if problem.Is(err, problem.CodeNotFound) {
		return nil, problem.New(problem.CodeNotFound, textTripNotFound)
	}
	if err != nil {
		return nil, dbError(err)
	}
	plans := []fleetapi.TripPlan{p}
	if err := details(ctx, scopedQuery(c), scoped, plans); err != nil {
		return nil, dbError(err)
	}
	tag := kit.ETag(p.Revision)
	return fleetapi.GetTripPlan200JSONResponse{
		Body:    plans[0],
		Headers: fleetapi.GetTripPlan200ResponseHeaders{CacheControl: noStore(), ETag: &tag, XRequestId: rid(ctx)},
	}, nil
}

// listFilters are the checked query parameters of listTripPlans.
type listFilters struct {
	unit, driver *uuid.UUID
	states       []string
	afterAt      *time.Time
	afterNumber  *string
	afterID      *uuid.UUID
	limit        int
}

func parseList(p fleetapi.ListTripPlansParams) (listFilters, error) {
	f := listFilters{unit: p.OrgUnitId, driver: p.DriverMemberId}
	var err error
	if f.limit, err = kit.PageLimit(p.Limit); err != nil {
		return listFilters{}, err
	}
	if p.State != nil && len(*p.State) > 0 {
		for _, st := range *p.State {
			if !slices.Contains(tripStates, st) {
				return listFilters{}, problem.New(problem.CodeMalformedRequest, "state")
			}
			f.states = append(f.states, string(st))
		}
	}
	if p.Cursor != nil {
		keys, err := kit.DecodeCursor(*p.Cursor, 3)
		if err != nil {
			return listFilters{}, err
		}
		at, err := time.Parse(time.RFC3339Nano, keys[0])
		if err != nil {
			return listFilters{}, problem.Wrap(problem.CodeMalformedRequest, err)
		}
		id, err := uuid.Parse(keys[2])
		if err != nil {
			return listFilters{}, problem.Wrap(problem.CodeMalformedRequest, err)
		}
		f.afterAt, f.afterNumber, f.afterID = &at, &keys[1], &id
	}
	return f, nil
}

// ListTripPlans implements fleetapi.StrictServerInterface: the trips of the logist workplace, the review queue and the
// driver screen in any state, filtered by the scope of fleet.trips.read before the pagination; a member with the
// function «Водитель» gets the trips it drives only. orgUnitId only narrows the list to a subtree.
func (s *Server) ListTripPlans(ctx context.Context, req fleetapi.ListTripPlansRequestObject) (fleetapi.ListTripPlansResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	f, err := parseList(req.Params)
	if err != nil {
		return nil, err
	}
	c, err := s.conn(ctx, tc)
	if err != nil {
		return nil, err
	}
	rows, err := c.Query(ctx, ActionTripsRead, Columns, listSQL, tc.PersonID, s.now(), f.unit, f.states, f.driver,
		f.afterAt, f.afterNumber, f.afterID, f.limit+1)
	if err != nil {
		return nil, dbError(err)
	}
	plans, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (fleetapi.TripPlan, error) { return scanPlan(r) })
	if err != nil {
		return nil, dbError(err)
	}
	page := fleetapi.TripPlanPage{Items: plans}
	if len(plans) > f.limit {
		last := plans[f.limit-1]
		next := kit.EncodeCursor(last.PlannedWindow.StartsAt.Format(time.RFC3339Nano), last.Number, last.Id.String())
		page.NextCursor, page.Items = &next, plans[:f.limit]
	}
	if err := details(ctx, scopedQuery(c), scoped, page.Items); err != nil {
		return nil, dbError(err)
	}
	return fleetapi.ListTripPlans200JSONResponse{
		Body: page, Headers: fleetapi.ListTripPlans200ResponseHeaders{CacheControl: noStore(), XRequestId: rid(ctx)},
	}, nil
}
