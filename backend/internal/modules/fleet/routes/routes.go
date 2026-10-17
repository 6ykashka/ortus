// Package routes is the trip planning of the logist (W2.03, S2-13): a planned trip with its cargo, stops and load per
// leg (createTripPlan), its projection TripPlan from planning to acceptance (getTripPlan, listTripPlans) and the
// assignment of a compatible vehicle (assignTripVehicle) — a hold of the vehicle, with the driver of the trip, for the
// window of the trip (sched.Hold) in place of the earlier hold of the trip.
//
// A TripPlan is one row of fleet.trips in any TripState with its stops (fleet.trip_stops), its hold
// (sched.reservations of reservation_bundle_id), its inspections, the blocking defect in review and the latest review
// (fleet.trip_reviews). Reads go through scopeddb with the scope of fleet.trips.read over the unit of the trip and its
// driver; a member with an active work function «Водитель» sees only the trips it drives (D22). Commands check access
// with the evaluator over their own transaction (authz.TxSource, W1.47) and take their locks in one order: their own
// rows first (the trip, the person of the driver), the resources of sched.Hold next, the rows of the trip last.
package routes

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W2.03: shared command helpers of the modules (ETag, cursor, Tx, Audit, Complete; Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/scopeddb"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Actions of the catalog (api/permissions.yaml).
const (
	ActionManage      = "fleet.routes.manage"
	ActionTripsRead   = "fleet.trips.read"
	actionUnitsRead   = "org_units.read"
	actionMembersRead = "members.read"
	actionVehicleRead = "fleet.vehicles.read"
)

// Audit targets and outbox events.
const (
	targetTrip        = "fleet.trip"
	targetReservation = "fleet.reservation"
	sourceTrip        = "fleet.trip" // sched.reservations.source_type of the hold of a trip (as reservations.SourceTrip)
	eventPlanned      = "fleet.trip.planned.v1"
	eventHeld         = "fleet.reservation.held.v1"
	eventReleased     = "fleet.reservation.released.v1"
)

// Problem codes of the tag Fleet (api/errors.yaml).
const (
	codeOverlap      = "reservation_overlap"
	codeUnavailable  = "resources_unavailable"
	codeIncompatible = "vehicle_incompatible"
)

// functionDriver is the work function of a driver (people.work_profiles.function).
const functionDriver = "driver"

// DefaultTTL is how long the hold of an assignment lasts when the settings of the module say nothing (as the
// reservations of W2.02: LogisticsSettings.reservationTtlMinutes, 30 by default).
const DefaultTTL = 30 * time.Minute

// Columns are the columns the scope predicate filters trips on: the unit of the trip and its driver («own»).
var Columns = authz.Columns{Unit: "t.unit_id", Persons: []string{"t.driver_person_id"}}

// Server implements the trip planning operations of the tag Fleet.
type Server struct {
	Pools     kit.Pools
	Evaluator *authz.Evaluator
	Now       func() time.Time // the clock of the application (APP_FIXED_NOW outside prod); nil: time.Now
}

func (s *Server) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// within is the evaluator of a command over its transaction q (W1.47): the subject, the modules and the unit tree are
// read through q, never through another connection of the pool, and the clock is frozen at the start of the command.
func (s *Server) within(q authz.Querier, at time.Time) *authz.Evaluator {
	cp := *s.Evaluator
	src := authz.TxSource{Q: q}
	cp.Now = func() time.Time { return at }
	cp.Source = src
	if s.Evaluator.Units != nil {
		cp.Units = src
	}
	return &cp
}

func (s *Server) conn(ctx context.Context, tc tenantctx.TenantContext) (*scopeddb.Conn, error) {
	c, err := scopeddb.For(ctx, s.Pools, s.Evaluator, tc)
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return c, nil
}

// Querier is a pool or the transaction of a command.
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// ttl is how long a hold lasts: reservationTtlMinutes of the settings of the module (5…120), else DefaultTTL — the
// rule of the reservations of W2.02.
func ttl(ctx context.Context, q Querier) (time.Duration, error) {
	var raw []byte
	err := q.QueryRow(ctx, `select settings from modules.installations
		 where module_key in ('fleet', 'logistics') order by module_key = 'fleet' desc limit 1`).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return DefaultTTL, nil
	}
	if err != nil {
		return 0, err
	}
	var settings struct {
		TTL *int `json:"reservationTtlMinutes"`
	}
	_ = json.Unmarshal(raw, &settings) // settings the module registry did not write fall back to the default
	if settings.TTL == nil || *settings.TTL < 5 || *settings.TTL > 120 {
		return DefaultTTL, nil
	}
	return time.Duration(*settings.TTL) * time.Minute, nil
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
