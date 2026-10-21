package pool

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Access is what the transfers of a subject leave him on a trip they put him on (W2.57, Q-W2.07-1 «только рейс»; AC-06,
// D09). The modules of the trip see the driver of a trip as «own» (scope self) whatever made him its driver — his home
// role in scope self too (Q-W2.07-10); the overlay of the pool narrows such a trip to the state of its transfer.
type Access int

const (
	// AccessBase: no transfer of the subject has this trip, or its grant is active — the modules of the trip decide.
	AccessBase Access = iota
	// AccessContinuation: the grant is closing (after the window or a revocation of a started trip) — only the
	// continuation of the trip (Continues), everything else of it answers 404.
	AccessContinuation
	// AccessNone: the grant is scheduled or ended — the trip and its objects answer 404 to the subject (AC-06).
	AccessNone
)

func (a Access) String() string {
	switch a {
	case AccessBase:
		return "base"
	case AccessContinuation:
		return "continuation"
	case AccessNone:
		return "none"
	case AccessPrepare:
		return "prepare"
	}
	return fmt.Sprintf("Access(%d)", int(a))
}

// accessOf is the access a settled grant leaves the driver (no grant — the modules of the trip decide); a scheduled
// grant of a transfer that prepares its trip (S2-20, prepareSQL) leaves the preparation (AccessPrepare, Q-W2.71-3).
func accessOf(st Settled, prepare bool) Access {
	switch st.Grant {
	case fleetapi.TemporaryDriverGrantStateActive:
		return AccessBase
	case fleetapi.TemporaryDriverGrantStateClosing:
		return AccessContinuation
	case fleetapi.TemporaryDriverGrantStateScheduled:
		if prepare {
			return AccessPrepare
		}
		return AccessNone
	case fleetapi.TemporaryDriverGrantStateEnded:
		return AccessNone
	}
	return AccessBase
}

// Object is a kind of object of the tag Fleet that belongs to a trip.
type Object int

// Objects whose trip the overlay resolves.
const (
	ObjectInspection Object = iota
	ObjectExpense
	ObjectReservation
	ObjectDefect
)

// objectTripSQL reads the trip of an object of each kind ($1 — its id); a reservation is a bundle (its id or the id of
// one of its rows) held for a trip.
var objectTripSQL = map[Object]string{
	ObjectInspection:  `select trip_id from fleet.inspections where id = $1`,
	ObjectExpense:     `select trip_id from fleet.expenses where id = $1`,
	ObjectReservation: `select source_id from sched.reservations where (id = $1 or bundle_id = $1) and source_type = 'fleet.trip' limit 1`,
	ObjectDefect:      `select trip_id from fleet.defects where id = $1`,
}

// guarded reports whether the overlay narrows the trips of the subject of tc: a member with a person (the owner and a
// context without a person are never temporary drivers).
func guarded(tc tenantctx.TenantContext) bool {
	return !tc.Owner && tc.PersonID != uuid.Nil && tc.TenantID != uuid.Nil
}

// db is the tenant DB of tc.
func (s *Service) db(ctx context.Context, tc tenantctx.TenantContext) (*pgxpool.Pool, error) {
	db, err := s.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return db, nil
}

// TripAccess returns what the transfers of the subject of tc leave him on trip at the clock of the service: the
// latest transfer of the subject with a grant for the trip, settled at now (Settle); none — AccessBase.
func (s *Service) TripAccess(ctx context.Context, tc tenantctx.TenantContext, trip uuid.UUID) (Access, error) {
	if !guarded(tc) {
		return AccessBase, nil
	}
	db, err := s.db(ctx, tc)
	if err != nil {
		return AccessBase, err
	}
	x, err := scanTransfer(db.QueryRow(ctx, `select `+transferCols+transferFrom+`
		 where p.person_id = $1 and x.trip_id = $2 and x.assignment_id is not null
		 order by x.created_at desc, x.id desc limit 1`, tc.PersonID, trip))
	switch {
	case errNoRows(err):
		return AccessBase, nil
	case err != nil:
		return AccessBase, problem.Wrap(problem.CodeDependencyUnavailable, fmt.Errorf("pool: access to %s: %w", trip, err))
	}
	return accessOf(Settle(x.input(), s.now()), x.prepare), nil
}

// TripOf returns the trip of object id of kind o (uuid.Nil: no such object or no trip).
func (s *Service) TripOf(ctx context.Context, tc tenantctx.TenantContext, o Object, id uuid.UUID) (uuid.UUID, error) {
	q, ok := objectTripSQL[o]
	if !ok || tc.TenantID == uuid.Nil {
		return uuid.Nil, nil
	}
	db, err := s.db(ctx, tc)
	if err != nil {
		return uuid.Nil, err
	}
	var trip *uuid.UUID
	err = db.QueryRow(ctx, q, id).Scan(&trip)
	switch {
	case errNoRows(err), err == nil && trip == nil:
		return uuid.Nil, nil
	case err != nil:
		return uuid.Nil, problem.Wrap(problem.CodeDependencyUnavailable, fmt.Errorf("pool: trip of %s: %w", id, err))
	}
	return *trip, nil
}

// HiddenTrips returns the trips the transfers of the subject of tc close to him now (AccessNone; the preparation of an
// S2-20 trip before its window, AccessPrepare, opens no data of it): «Данные» leave them
// out (cmd/api poolTrips); the lists of the tag read TripAccesses (a reservation of a continued trip is out too).
func (s *Service) HiddenTrips(ctx context.Context, tc tenantctx.TenantContext) (map[uuid.UUID]bool, error) {
	all, err := s.TripAccesses(ctx, tc)
	if err != nil {
		return nil, err
	}
	out := map[uuid.UUID]bool{}
	for id, a := range all {
		if a == AccessNone || a == AccessPrepare {
			out[id] = true
		}
	}
	return out, nil
}

// TripAccesses returns the trips the transfers of the subject of tc narrow now with what they leave him: AccessNone or
// AccessContinuation (a trip at AccessBase has no entry). A trip of an earlier transfer and of a later one is decided
// by the later one. The files close every parent of a closed trip and the reservation of a continued one (W2.57).
func (s *Service) TripAccesses(ctx context.Context, tc tenantctx.TenantContext) (map[uuid.UUID]Access, error) {
	out := map[uuid.UUID]Access{}
	if !guarded(tc) {
		return out, nil
	}
	db, err := s.db(ctx, tc)
	if err != nil {
		return nil, err
	}
	rows, err := db.Query(ctx, `select `+transferCols+transferFrom+`
		 where p.person_id = $1 and x.trip_id is not null and x.assignment_id is not null
		 order by x.created_at, x.id`, tc.PersonID)
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (transfer, error) { return scanTransfer(r) })
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	now := s.now()
	for _, x := range list {
		out[*x.trip] = accessOf(Settle(x.input(), now), x.prepare)
	}
	for id, a := range out {
		if a == AccessBase {
			delete(out, id)
		}
	}
	return out, nil
}
