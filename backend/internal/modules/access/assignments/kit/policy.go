package kit

import (
	"context"
	"slices"
	"strconv"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/realtime"
)

// Events of the module (design/docs/12-errors-and-events.md «Доменные события»); access.policy.bumped.v1 is
// realtime.EventPolicyBumped of W1.07.
const (
	EventAssignmentGranted = "access.assignment.granted.v1"
	EventAssignmentRevoked = "access.assignment.revoked.v1"
	EventOwnerChanged      = "access.owner.changed.v1"
	AggregateAssignment    = "access.assignment"
	AggregateOwner         = "access.owner"
)

// BumpPolicy increments access.policy_state.policy_version (any change of roles, assignments, groups with roles
// or owners) and publishes access.policy.bumped.v1 in tx through realtime.BumpPolicy of W1.07, the format its relay
// reads: persons are the people whose rights changed (their sessions get context.changed; empty — every member).
// It returns the new version.
func BumpPolicy(ctx context.Context, tx pgx.Tx, tenant uuid.UUID, persons []uuid.UUID, reason string) (int64, error) {
	v, err := realtime.BumpPolicy(ctx, tx, tenant, Distinct(persons), reason)
	return v, Store("policy version", err)
}

// LockPolicy takes the row of access.policy_state for the rest of tx (a tenant DB without one gets it with version 0).
// Every command of the module that checks before it writes — separation of duties (D-10), the live assignments of a
// role or a group — takes it before it reads what it checks: such commands go one by one, their checks see what the
// previous one committed (no write skew under read committed). The only locks taken before it are those of the
// people a command gives rights to (LockPeople, InPeopleTx): the work function commands of W1.05 lock the person
// and raise policy_version only after their own check, so the people come first in both.
func LockPolicy(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `insert into access.policy_state as s (singleton, policy_version) values (true, 0)
		on conflict (singleton) do update set policy_version = s.policy_version`)
	return Store("lock policy", err)
}

// Distinct returns ids without repeats, sorted (a stable payload).
func Distinct(ids []uuid.UUID) []uuid.UUID {
	out := slices.Clone(ids)
	slices.SortFunc(out, func(a, b uuid.UUID) int { return slices.Compare(a[:], b[:]) })
	return slices.Compact(out)
}

// Holders returns the people that hold a not revoked assignment of role, directly or through a live group.
func Holders(ctx context.Context, q DB, role uuid.UUID) ([]uuid.UUID, error) {
	rows, err := q.Query(ctx, `select ra.principal_id from access.role_assignments ra
		 where ra.role_id = $1 and ra.state <> 'revoked' and ra.principal_kind = 'person'
		union
		select gm.person_id from access.role_assignments ra
		  join access.groups g on g.id = ra.principal_id and g.archived_at is null
		  join access.group_members gm on gm.group_id = ra.principal_id
		 where ra.role_id = $1 and ra.state <> 'revoked' and ra.principal_kind = 'group'
		order by 1`, role)
	if err != nil {
		return nil, Store("role holders", err)
	}
	out, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	return out, Store("role holders", err)
}

// PolicyVersion reads the policy version of the tenant DB as the contract shows it (decimal string).
func PolicyVersion(ctx context.Context, q DB) (string, error) {
	var v int64
	err := q.QueryRow(ctx, `select coalesce((select policy_version from access.policy_state), 0)`).Scan(&v)
	if err != nil {
		return "", Store("policy version", err)
	}
	return strconv.FormatInt(v, 10), nil
}

// Publish writes a domain event into the outbox in tx.
func Publish(ctx context.Context, tx pgx.Tx, typ, aggregate string, id uuid.UUID, payload any) error {
	_, err := events.Publish(ctx, tx, events.Event{Type: typ, Aggregate: aggregate, AggregateID: id, Payload: payload})
	return Store(typ, err)
}

// Change is an audit record of a change of access made by the person of the request.
type Change struct {
	Action      string // access.<entity>.<verb>
	TargetType  string // access.role, access.assignment, access.group, access.owner
	TargetID    uuid.UUID
	UnitID      uuid.UUID
	Sensitivity string // "" — audit.Sensitive: every change of access is sensitive
	Reason      string
	Diff        map[string]any
}

// Audit records c in audit.events in tx (S1-23).
func Audit(ctx context.Context, tx pgx.Tx, c Change) error {
	e := audit.ForRequest(ctx)
	e.Action, e.TargetType, e.TargetID, e.UnitID, e.Reason, e.Diff = c.Action, c.TargetType, c.TargetID, c.UnitID, c.Reason, c.Diff
	e.Sensitivity = c.Sensitivity
	if e.Sensitivity == "" {
		e.Sensitivity = audit.Sensitive
	}
	return Store("audit "+c.Action, audit.Record(ctx, tx, e))
}
