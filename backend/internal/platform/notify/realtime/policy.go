package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ortus/ortus-crm/backend/internal/platform/events"
)

// EventPolicyBumped is the outbox event of a change of roles, assignments, groups or modules
// (12-errors-and-events: «closing realtime subscriptions»).
const EventPolicyBumped = "access.policy.bumped.v1"

// PolicyBumped is the payload of EventPolicyBumped: ids only.
type PolicyBumped struct {
	PolicyVersion int64       `json:"policyVersion"`
	PersonIDs     []uuid.UUID `json:"personIds,omitempty"` // affected people; empty — every member
	Reason        string      `json:"reason,omitempty"`    // the command, e.g. access.assignment.revoked
}

// bumpSQL increments the singleton row, creating it in a tenant DB that has none yet.
const bumpSQL = `
insert into access.policy_state as s (singleton, policy_version) values (true, 1)
on conflict (singleton) do update set policy_version = s.policy_version + 1
returning policy_version`

// BumpPolicy increments access.policy_state.policy_version and publishes EventPolicyBumped through db, the
// transaction of the change; it returns the new version. Every command that changes roles, assignments, groups or
// installed modules calls it: the next permission check sees the new version (PolicyCache), and the worker turns
// the event into context.changed for the affected people.
func BumpPolicy(ctx context.Context, db events.DB, tenantID uuid.UUID, persons []uuid.UUID, reason string) (int64, error) {
	if tenantID == uuid.Nil {
		return 0, errors.New("realtime: bump policy: no tenant")
	}
	var v int64
	if err := db.QueryRow(ctx, bumpSQL).Scan(&v); err != nil {
		return 0, fmt.Errorf("realtime: bump policy: %w", err)
	}
	_, err := events.Publish(ctx, db, events.Event{
		Type: EventPolicyBumped, Aggregate: "access.policy", AggregateID: tenantID,
		Payload: PolicyBumped{PolicyVersion: v, PersonIDs: persons, Reason: reason},
	})
	if err != nil {
		return 0, err
	}
	return v, nil
}

// Querier reads the control DB.
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Relay is the outbox consumer of cmd/worker that turns tenant events into hints: people of the tenant → accounts
// of the memberships of that tenant (control DB) → Notifier.
type Relay struct {
	Control  Querier
	Notifier Notifier
	Log      *slog.Logger // nil: slog.Default()
}

func (r Relay) log() *slog.Logger {
	if r.Log != nil {
		return r.Log
	}
	return slog.Default()
}

// Register adds the handlers of the relay to reg (EventPolicyBumped → context.changed).
func (r Relay) Register(reg *events.Registry) {
	reg.Handle(EventPolicyBumped, r.policyBumped)
}

func (r Relay) policyBumped(ctx context.Context, m events.Message) error {
	var p PolicyBumped
	if err := json.Unmarshal(m.Payload, &p); err != nil {
		return fmt.Errorf("realtime: %s payload: %w", m.Type, err)
	}
	return r.HintPersons(ctx, m.TenantID, p.PersonIDs, TypeContextChanged)
}

// Accounts of a tenant: of the given people in any state but invited (a suspended or ended member must learn that
// the context changed), or every active member.
const (
	accountsOfPersonsSQL = `
select distinct account_id from memberships
 where tenant_id = $1 and person_profile_id = any($2) and status <> 'invited'
 order by 1`
	accountsOfTenantSQL = `
select account_id from memberships where tenant_id = $1 and status = 'active' order by 1`
)

// HintPersons notifies typ to the accounts of persons in tenantID (every active member when persons is empty).
// People are resolved within tenantID only: a person id of another tenant never addresses its accounts.
// W1.10 calls it with TypeNotificationsChanged for the recipient of a notification.
func (r Relay) HintPersons(ctx context.Context, tenantID uuid.UUID, persons []uuid.UUID, typ string) error {
	if tenantID == uuid.Nil {
		return fmt.Errorf("%w: no tenant", ErrInvalidHint)
	}
	var (
		rows pgx.Rows
		err  error
	)
	if len(persons) == 0 {
		rows, err = r.Control.Query(ctx, accountsOfTenantSQL, tenantID)
	} else {
		rows, err = r.Control.Query(ctx, accountsOfPersonsSQL, tenantID, persons)
	}
	if err != nil {
		return fmt.Errorf("realtime: accounts: %w", err)
	}
	accounts, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return fmt.Errorf("realtime: accounts: %w", err)
	}
	if len(accounts) == 0 {
		r.log().DebugContext(ctx, "realtime: hint without accounts", slog.String("tenant_id", tenantID.String()),
			slog.String("type", typ))
		return nil
	}
	return r.Notifier.Publish(ctx, Hint{Type: typ, TenantID: tenantID, Accounts: accounts})
}
