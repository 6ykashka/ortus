// Package reservations is the reservation of a vehicle with its driver (W2.02, S2-03, AC-03): an atomic hold of both
// resources for a window (sched.Hold) that blocks overlaps until holdExpiresAt (reservationTtlMinutes of the module
// settings, 30 by default), optionally for a planned trip whose cargo the vehicle must fit (fleetrules.Compat), its
// reading and its release.
//
// A reservation of the API is a bundle of sched.reservations: the row of the vehicle and the row of the driver share
// bundle_id (Reservation.id). Reads go through scopeddb with the scope of fleet.reservations.read: the unit of the
// vehicle, or «own» — the driver of the bundle and its author. Commands check access with the evaluator over their
// own transaction (authz.TxSource, W1.47): every command holds one connection of the tenant DB at most, so 100
// parallel reservations on a pool of 4 queue instead of deadlocking.
package reservations

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W2.02: shared command helpers of the modules (ETag, cursor, Tx, Audit, Complete; Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/modules/sched"   //nolint:depguard // W2.02: the scheduling core the reservations hold through (same work stream)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/scopeddb"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Actions of the catalog (api/permissions.yaml).
const (
	ActionRead      = "fleet.reservations.read"
	ActionCreate    = "fleet.reservations.create"
	ActionManage    = "fleet.reservations.manage"
	actionTripsRead = "fleet.trips.read"
	// actionMembersRead makes a person visible (people: the home unit of the person profile).
	actionMembersRead = "members.read"
)

// Sources of the holds of the module (sched.reservations.source_type).
const (
	SourceReservation = "fleet.reservation" // a hold without a trip: source_id = bundle_id
	SourceTrip        = "fleet.trip"        // a hold of a planned trip: source_id = the trip
)

// Audit and outbox names.
const (
	targetReservation = "fleet.reservation"
	eventHeld         = "fleet.reservation.held.v1"
	eventReleased     = "fleet.reservation.released.v1"
)

// Problem codes of the tag Fleet (api/errors.yaml).
const (
	codeOverlap      = "reservation_overlap"
	codeUnavailable  = "resources_unavailable"
	codeIncompatible = "vehicle_incompatible"
)

// DefaultTTL is how long a hold lasts when the settings of the module say nothing (LogisticsSettings default).
const DefaultTTL = 30 * time.Minute

// columns are the columns the scope predicate filters reservations on: the unit of the vehicle and the «own» people
// — the driver of the bundle, its author and (W2.72, S2-20) the driver it is offered to.
var columns = authz.Columns{Unit: "v.unit_id", Persons: []string{"p.ref_id", "rv.created_by", "rv.offered_to"}}

// Server implements the reservation operations of the tag Fleet.
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

// within is the evaluator of a command over its transaction q (W1.47, kit.Within of the access model): the subject,
// the modules and the unit tree are read through q, never through another connection of the pool, and the clock is
// frozen at the start of the command.
func (s *Server) within(q authz.Querier) *authz.Evaluator {
	cp := *s.Evaluator
	src := authz.TxSource{Q: q}
	at := s.now()
	cp.Now = func() time.Time { return at }
	cp.Source = src
	if s.Evaluator.Units != nil {
		cp.Units = src
	}
	return &cp
}

// bundle is a reservation: the row of the vehicle and the row of the driver of one bundle. The hold of an assignment
// of the logist to a trip without a driver (assignTripVehicle, W2.03) has the row of the vehicle only: Driver is
// uuid.Nil (Q-W2.53-3).
type bundle struct {
	ID, Vehicle, Driver, Unit uuid.UUID
	Zone                      string
	Start, End                time.Time
	State                     string
	Expires                   *time.Time
	Source                    string
	SourceID                  uuid.UUID
	Revision                  int64
	CreatedBy                 uuid.UUID
	CreatedAt                 time.Time
	offer                     offerCols
}

// offerCols are the columns of a reservation of an offer (W2.72, S2-20, tenant 0023): the group, the driver who
// chooses, the kind of the vehicle, the deadline of the choice, the choice and the release.
type offerCols struct {
	group, to                 *uuid.UUID
	kind, reason              *string
	until, chosen, releasedAt *time.Time
}

// selectSQL reads the reservations of the module — bundles of a vehicle (the row whose id is the bundle) with their
// driver, if any (a hold of an assignment of the logist to a trip without a driver has none: Q-W2.53-3); the caller
// adds conditions.
const selectSQL = `select rv.bundle_id, s.ref_id, p.ref_id, v.unit_id, u.time_zone, lower(rv.during), upper(rv.during),
       rv.state, rv.hold_expires_at, rv.source_type, rv.source_id, greatest(rv.revision, rp.revision), rv.created_by,
       rv.created_at, rv.offer_group_id, rv.offered_to, rv.offer_kind, rv.release_reason, rv.choose_until, rv.chosen_at,
       rv.released_at
  from sched.reservations rv
  join sched.resources s on s.id = rv.resource_id and s.kind = 'vehicle'
  join fleet.vehicles v on v.id = s.ref_id
  join org.units u on u.id = v.unit_id
  left join (sched.reservations rp join sched.resources p on p.id = rp.resource_id and p.kind = 'person')
         on rp.bundle_id = rv.bundle_id and rp.id <> rv.id
 where rv.source_type in ('fleet.reservation', 'fleet.trip')`

func scanBundle(row pgx.Row) (bundle, error) {
	var (
		b      bundle
		driver *uuid.UUID
	)
	o := &b.offer
	err := row.Scan(&b.ID, &b.Vehicle, &driver, &b.Unit, &b.Zone, &b.Start, &b.End, &b.State, &b.Expires, &b.Source,
		&b.SourceID, &b.Revision, &b.CreatedBy, &b.CreatedAt, &o.group, &o.to, &o.kind, &o.reason, &o.until, &o.chosen,
		&o.releasedAt)
	switch {
	case driver != nil:
		b.Driver = *driver
	case o.to != nil: // a reservation of an offer holds the vehicle only: its driver is the one it is offered to
		b.Driver = *o.to
	}
	return b, err
}

// lockSQL locks the rows of a bundle in the order of their ids.
const lockSQL = `select id from sched.reservations where bundle_id = $1 order by id for update`

// readBundle reads the reservation id through q without a scope (the caller authorizes it); lock takes its rows for
// the command first. No such reservation is 404 not_found.
func readBundle(ctx context.Context, q pgx.Tx, id uuid.UUID, lock bool) (bundle, error) {
	if lock {
		if _, err := q.Exec(ctx, lockSQL, id); err != nil {
			return bundle{}, err
		}
	}
	b, err := scanBundle(q.QueryRow(ctx, selectSQL+` and rv.bundle_id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return bundle{}, problem.New(problem.CodeNotFound, "")
	}
	return b, err
}

// states maps the state a row reads as (sched.Effective) to Reservation.state. A confirmed row outside an offer is the
// hold a blocking defect keeps while the manager decides (W2.04): it reads as held, as before 0.6.3-stage2.
var states = map[string]fleetapi.ReservationState{
	sched.StateHold: fleetapi.ReservationStateHeld, sched.StateConfirmed: fleetapi.ReservationStateHeld,
	sched.StateConsumed: fleetapi.ReservationStateConsumed, sched.StateReleased: fleetapi.ReservationStateReleased,
	sched.StateExpired: fleetapi.ReservationStateExpired,
}

// State is Reservation.state of a row in state with the end of its hold at now: a hold whose end came reads as
// expired. A reservation of an offer (S2-20, W2.71 0.6.3-stage2) reads as it is — confirmed of its own, a hold until
// the choice or the scheduler at the deadline settles the offer (Q-W2.71-14).
func State(state string, expires *time.Time, offer bool, now time.Time) fleetapi.ReservationState {
	switch {
	case offer && state == sched.StateConfirmed:
		return fleetapi.ReservationStateConfirmed
	case offer:
		return states[state]
	}
	return states[sched.Effective(state, expires, now)]
}

// dto is the Reservation of the contract at now: a hold whose end came reads as expired; a confirmed reservation of
// an offer holds its vehicle until the end of its window (holdExpiresAt = window.endsAt, 0.6.3-stage2).
func (b bundle) dto(now time.Time) fleetapi.Reservation {
	expires := b.Start
	if b.Expires != nil {
		expires = *b.Expires
	}
	if b.State == sched.StateConfirmed && b.offer.group != nil {
		expires = b.End
	}
	o := b.offer
	out := fleetapi.Reservation{
		Id: b.ID, VehicleId: b.Vehicle, DriverMemberId: b.Driver,
		Window:        fleetapi.TimeWindow{StartsAt: b.Start.UTC(), EndsAt: b.End.UTC(), TimeZone: b.Zone},
		State:         State(b.State, b.Expires, o.group != nil, now),
		HoldExpiresAt: expires.UTC(), Revision: b.Revision,
		OfferGroupId: o.group, OfferedToMemberId: o.to, ChooseUntil: utc(o.until), ChosenAt: utc(o.chosen),
		ReleasedAt: utc(o.releasedAt),
	}
	if o.kind != nil {
		k := fleetapi.ReservationOfferKind(*o.kind)
		out.OfferKind = &k
	}
	if o.reason != nil {
		r := fleetapi.ReservationReleaseReason(*o.reason)
		out.ReleaseReason = &r
	}
	if b.Source == SourceTrip {
		trip := b.SourceID
		out.TripId = &trip
	}
	return out
}

func utc(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	u := t.UTC()
	return &u
}

// resource is what access to the reservation is decided on: the unit of the vehicle and its «own» people — the
// driver, if any (the one it is offered to), and the author.
func (b bundle) resource(read string) authz.Resource {
	persons := []uuid.UUID{b.CreatedBy}
	if b.Driver != uuid.Nil {
		persons = append(persons, b.Driver)
	}
	return authz.Resource{Unit: b.Unit, Persons: persons, ReadAction: read}
}

// Load reads reservation id through q without a scope (the caller authorized it) as the Reservation of the contract
// at now; a missing one is 404 «Бронь не найдена.».
func Load(ctx context.Context, q pgx.Tx, id uuid.UUID, now time.Time) (fleetapi.Reservation, error) {
	b, err := readBundle(ctx, q, id, false)
	if err != nil {
		return fleetapi.Reservation{}, notFound(err)
	}
	return b.dto(now), nil
}

func (s *Server) conn(ctx context.Context, tc tenantctx.TenantContext) (*scopeddb.Conn, error) {
	c, err := scopeddb.For(ctx, s.Pools, s.Evaluator, tc)
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

// textNotFound is the 404 of a reservation (the mock W2.00, reservationOr404): a foreign and a missing one alike.
const textNotFound = "Бронь не найдена."

// notFound gives a not_found error the text of a missing reservation; other errors pass unchanged.
func notFound(err error) error {
	if problem.Is(err, problem.CodeNotFound) {
		return problem.New(problem.CodeNotFound, textNotFound)
	}
	return err
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
