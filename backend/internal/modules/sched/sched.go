// Package sched is the scheduling core of a tenant (A-06, design/docs/10-data-model.md): resources
// (sched.resources — a vehicle, a person, a room, an equipment item) and their reservations (sched.reservations).
// A bundle of resources is held together in one transaction or not at all: a vehicle with its driver (W2.02), later a
// room with a therapist. The database refuses overlapping holds itself (EXCLUDE reservations_no_overlap over the
// occupied range of a resource for hold, confirmed and consumed rows), so concurrent holds of one interval give exactly
// one success (AC-03).
//
// The functions take the transaction of a command (pgx.Tx): the caller authorizes, writes its own rows, the audit and
// the idempotent outcome in the same transaction. A failed Hold leaves the transaction aborted — roll it back.
package sched

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Kind is the kind of a resource (sched.resources.kind).
type Kind string

// Kinds of resources.
const (
	KindVehicle   Kind = "vehicle"
	KindPerson    Kind = "person"
	KindRoom      Kind = "room"
	KindEquipment Kind = "equipment"
)

var kinds = []Kind{KindVehicle, KindPerson, KindRoom, KindEquipment}

// States of a reservation row (sched.reservations.state).
const (
	StateHold      = "hold"
	StateConfirmed = "confirmed"
	StateConsumed  = "consumed"
	StateReleased  = "released"
	StateExpired   = "expired"
)

// Claim is one resource of a bundle: its kind, the id of the object (a vehicle, a person profile) and the org unit it
// belongs to (sched.resources.home_unit_id).
type Claim struct {
	Kind Kind
	Ref  uuid.UUID
	Home uuid.UUID
}

// Window is the half-open interval [Start, End) of a reservation.
type Window struct {
	Start, End time.Time
}

// Valid reports whether the window is a non-empty interval.
func (w Window) Valid() bool { return !w.Start.IsZero() && w.Start.Before(w.End) }

// HoldRequest is a bundle to hold.
type HoldRequest struct {
	// Bundle is the id of the bundle: the reservation of the API. The row of the first claim (the vehicle of a
	// reservation) takes it as its own id, so the reservation is found by that row too (sched.reservations.id: the
	// inspections of W2.04, the parent fleet.reservation of the files of W1.09); a new hold needs a new bundle.
	Bundle     uuid.UUID
	Claims     []Claim // resources in the order the caller reports conflicts in; the first one carries the bundle id
	Window     Window
	ExpiresAt  time.Time // end of the hold: after it the rows stop blocking and read as expired
	SourceType string    // what the hold is for: fleet.trip, fleet.reservation
	SourceID   uuid.UUID
	CreatedBy  uuid.UUID // person of the actor
	Now        time.Time // the clock of the application: holds that ended by it are expired first
	// Replaces is the bundle this hold takes the place of (the earlier hold of a trip); uuid.Nil: none. Its live rows
	// are released inside Hold, after the resources of both bundles are locked.
	Replaces uuid.UUID
}

// Errors of the package.
var (
	ErrInvalid = errors.New("sched: invalid request")
	ErrOverlap = errors.New("sched: the interval of a resource is taken")
	ErrNotHeld = errors.New("sched: the bundle holds nothing")
	ErrExpired = errors.New("sched: the hold of the bundle has expired")
)

// OverlapError names the claim whose interval is taken; errors.Is(err, ErrOverlap).
type OverlapError struct {
	Index int // index of the claim in HoldRequest.Claims
	Claim Claim
}

func (e *OverlapError) Error() string {
	return "sched: the interval of " + string(e.Claim.Kind) + " " + e.Claim.Ref.String() + " is taken"
}

// Is makes errors.Is(err, ErrOverlap) true.
func (e *OverlapError) Is(target error) bool { return target == ErrOverlap }

// codeExclusionViolation is the SQLSTATE of a violated EXCLUDE constraint (reservations_no_overlap).
const codeExclusionViolation = "23P01"

func (r HoldRequest) validate() error {
	switch {
	case r.Bundle == uuid.Nil, r.SourceType == "", r.SourceID == uuid.Nil, len(r.Claims) == 0:
		return fmt.Errorf("%w: bundle, source and claims are required", ErrInvalid)
	case !r.Window.Valid():
		return fmt.Errorf("%w: empty window", ErrInvalid)
	case !r.ExpiresAt.After(r.Now):
		return fmt.Errorf("%w: the hold ends before it starts", ErrInvalid)
	case r.Replaces == r.Bundle:
		return fmt.Errorf("%w: a bundle cannot replace itself", ErrInvalid)
	}
	seen := map[Claim]bool{}
	for _, c := range r.Claims {
		switch {
		case !slices.Contains(kinds, c.Kind), c.Ref == uuid.Nil, c.Home == uuid.Nil:
			return fmt.Errorf("%w: claim %s %s", ErrInvalid, c.Kind, c.Ref)
		case seen[Claim{Kind: c.Kind, Ref: c.Ref}]:
			return fmt.Errorf("%w: claim %s %s twice", ErrInvalid, c.Kind, c.Ref)
		}
		seen[Claim{Kind: c.Kind, Ref: c.Ref}] = true
	}
	return nil
}

// Hold holds every claim of r for its window in tx. The resources are created when new and locked in a fixed order
// (by id) together with the resources of r.Replaces, so concurrent holds of shared resources queue instead of
// deadlocking; then the live rows of r.Replaces are released, holds of the claimed resources that ended by r.Now
// become expired and the rows are inserted in the order of r.Claims. The first taken interval is an *OverlapError
// with the index of its claim, and tx is aborted.
//
// Order of locks for a caller (W2.02, W2.03): its own rows first (a trip: select … for update), then Hold. A row of
// sched.reservations is never written before Hold locked the resources: a parallel hold of the same resource waits in
// its insert for such a row, while holding the resource, and the two would deadlock (40P01).
func Hold(ctx context.Context, tx pgx.Tx, r HoldRequest) error {
	if err := r.validate(); err != nil {
		return err
	}
	ids, err := lock(ctx, tx, r.Claims, r.Replaces)
	if err != nil {
		return err
	}
	if r.Replaces != uuid.Nil {
		if _, err := transition(ctx, tx, r.Replaces, r.Now, StateReleased); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `update sched.reservations set state = 'expired', revision = revision + 1
		 where resource_id = any($1) and state = 'hold' and hold_expires_at <= $2`, ids, r.Now); err != nil {
		return fmt.Errorf("sched: expire holds: %w", err)
	}
	for i, c := range r.Claims {
		row := uuid.New()
		if i == 0 {
			row = r.Bundle // the row of the first claim is found by the id of the bundle (HoldRequest.Bundle)
		}
		_, err := tx.Exec(ctx, `insert into sched.reservations
			(id, resource_id, bundle_id, during, occupied, state, hold_expires_at, source_type, source_id, created_by)
			values ($9, $1, $2, tstzrange($3, $4, '[)'), tstzrange($3, $4, '[)'), 'hold', $5, $6, $7, $8)`,
			ids[i], r.Bundle, r.Window.Start, r.Window.End, r.ExpiresAt, r.SourceType, r.SourceID, r.CreatedBy, row)
		if pe, ok := errors.AsType[*pgconn.PgError](err); ok && pe.Code == codeExclusionViolation {
			return &OverlapError{Index: i, Claim: c}
		}
		if err != nil {
			return fmt.Errorf("sched: hold %s %s: %w", c.Kind, c.Ref, err)
		}
	}
	return nil
}

// The resources lock locks: those of the claims ($1 kinds, $2 refs) and, when a bundle is replaced, those of its rows
// ($3).
const (
	lockClaimsSQL = `select id, kind, ref_id from sched.resources
	 where (kind, ref_id) in (select * from unnest($1::text[], $2::uuid[]))`
	lockReplacedSQL = `
	    or id in (select resource_id from sched.reservations where bundle_id = $3)`
)

// lock creates the resources of claims that do not exist yet and locks all of them, with the resources of the rows
// of the bundle replaces (uuid.Nil: none), in the order of their ids; it returns the ids of claims in their order.
func lock(ctx context.Context, tx pgx.Tx, claims []Claim, replaces uuid.UUID) ([]uuid.UUID, error) {
	kindsOf, refs, homes := make([]string, len(claims)), make([]uuid.UUID, len(claims)), make([]uuid.UUID, len(claims))
	for i, c := range claims {
		kindsOf[i], refs[i], homes[i] = string(c.Kind), c.Ref, c.Home
	}
	if _, err := tx.Exec(ctx, `insert into sched.resources (kind, ref_id, home_unit_id)
		select * from unnest($1::text[], $2::uuid[], $3::uuid[]) on conflict (kind, ref_id) do nothing`,
		kindsOf, refs, homes); err != nil {
		return nil, fmt.Errorf("sched: resources: %w", err)
	}
	// Without a replaced bundle the lock reads the resources only: sched.reservations has no index on bundle_id yet,
	// and the OR would scan the reservations on every hold.
	sql, args := lockClaimsSQL, []any{kindsOf, refs}
	if replaces != uuid.Nil {
		sql, args = lockClaimsSQL+lockReplacedSQL, append(args, replaces)
	}
	rows, err := tx.Query(ctx, sql+` order by id for update`, args...)
	if err != nil {
		return nil, fmt.Errorf("sched: lock resources: %w", err)
	}
	type resource struct {
		id   uuid.UUID
		kind Kind
		ref  uuid.UUID
	}
	locked, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (resource, error) {
		var v resource
		err := r.Scan(&v.id, &v.kind, &v.ref)
		return v, err
	})
	if err != nil {
		return nil, fmt.Errorf("sched: lock resources: %w", err)
	}
	ids := make([]uuid.UUID, len(claims))
	for i, c := range claims {
		j := slices.IndexFunc(locked, func(v resource) bool { return v.kind == c.Kind && v.ref == c.Ref })
		if j < 0 {
			return nil, fmt.Errorf("sched: resource %s %s was not created", c.Kind, c.Ref)
		}
		ids[i] = locked[j].id
	}
	return ids, nil
}

// Release releases the live hold of bundle (a hold before its end, or a confirmed reservation) and returns its new
// revision; ErrNotHeld when the bundle holds nothing live at now.
func Release(ctx context.Context, tx pgx.Tx, bundle uuid.UUID, now time.Time) (int64, error) {
	rev, err := transition(ctx, tx, bundle, now, StateReleased)
	if err != nil {
		return 0, err
	}
	if rev == 0 {
		return 0, ErrNotHeld
	}
	return rev, nil
}

// Consume turns the live hold of bundle into a consumed reservation (trip start, W2.05) and returns its new revision:
// ErrExpired when the hold ended before now, ErrNotHeld when the bundle holds nothing.
func Consume(ctx context.Context, tx pgx.Tx, bundle uuid.UUID, now time.Time) (int64, error) {
	rev, err := transition(ctx, tx, bundle, now, StateConsumed)
	if err != nil || rev > 0 {
		return rev, err
	}
	var ended bool
	if err := tx.QueryRow(ctx, `select exists (select 1 from sched.reservations
		 where bundle_id = $1 and state = 'hold' and hold_expires_at <= $2)`, bundle, now).Scan(&ended); err != nil {
		return 0, fmt.Errorf("sched: consume: %w", err)
	}
	if ended {
		return 0, ErrExpired
	}
	return 0, ErrNotHeld
}

// transition moves the live rows of bundle to state and returns the new revision (0: no live row).
func transition(ctx context.Context, tx pgx.Tx, bundle uuid.UUID, now time.Time, state string) (int64, error) {
	rows, err := tx.Query(ctx, `update sched.reservations set state = $3, revision = revision + 1
		 where bundle_id = $1 and (state = 'confirmed' or (state = 'hold' and hold_expires_at > $2))
		 returning revision`, bundle, now, state)
	if err != nil {
		return 0, fmt.Errorf("sched: %s: %w", state, err)
	}
	revs, err := pgx.CollectRows(rows, pgx.RowTo[int64])
	if err != nil {
		return 0, fmt.Errorf("sched: %s: %w", state, err)
	}
	if len(revs) == 0 {
		return 0, nil
	}
	return slices.Max(revs), nil
}

// Effective is the state a row reads as at now: a hold whose end came is expired, whatever the row still says (the
// next Hold of its resource writes that down).
func Effective(state string, holdExpiresAt *time.Time, now time.Time) string {
	if state == StateHold && holdExpiresAt != nil && !holdExpiresAt.After(now) {
		return StateExpired
	}
	return state
}
