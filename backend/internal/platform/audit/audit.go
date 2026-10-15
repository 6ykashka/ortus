// Package audit writes the audit trail (W1.01, S1-23, NFR-05): changes of access, owners, subscriptions and
// sensitive exports. A tenant change is recorded in audit.events of its tenant DB in the transaction of the change;
// a platform change in platform_audit of the control DB. Both tables are insert-only for the runtime roles
// (backend/migrations/roles/grants.sql, Q-W0.06-3).
package audit

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"regexp"
	"slices"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Actor kinds of audit.events.
const (
	ActorPerson  = "person"
	ActorService = "service"
	ActorSupport = "support"
)

// Actor kinds of platform_audit.
const (
	PlatformOperator = "operator"
	PlatformOwner    = "owner"
	PlatformSystem   = "system"
)

// Sensitivity of an audit.events record.
const (
	Normal     = "normal"
	Sensitive  = "sensitive"
	Restricted = "restricted"
)

// Results of an audited action.
const (
	OK     = "ok"
	Denied = "denied"
	Failed = "failed"
)

// RedactedValue replaces a restricted field in a diff.
const RedactedValue = "[restricted]"

// ErrInvalid marks an event the schema would reject or that misses a required field.
var ErrInvalid = errors.New("audit: invalid event")

// Execer is a pgx connection, pool or transaction.
type Execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Event is a record of audit.events. Zero UUIDs are stored as null.
type Event struct {
	ActorKind   string
	ActorID     uuid.UUID
	Action      string // <domain>.<entity>.<verb>: access.assignment.create
	TargetType  string
	TargetID    uuid.UUID
	UnitID      uuid.UUID
	Sensitivity string // "" = Normal
	Reason      string
	Result      string
	RequestID   string // "" = the request id of ctx
	Diff        map[string]any
}

// PlatformEvent is a record of platform_audit.
type PlatformEvent struct {
	ActorKind  string
	ActorID    uuid.UUID
	Action     string
	TargetType string
	TargetID   uuid.UUID
	Reason     string
	Result     string
	RequestID  string
	Details    map[string]any
}

var (
	actionRE = regexp.MustCompile(`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`)
	targetRE = regexp.MustCompile(`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$`)
	results  = []string{OK, Denied, Failed}
)

// ForRequest returns an event of the person of the request (TenantContext) with its request id and result ok.
// Without a TenantContext the actor is the service (a job of the worker).
func ForRequest(ctx context.Context) Event {
	e := Event{ActorKind: ActorService, Sensitivity: Normal, Result: OK, RequestID: requestid.FromContext(ctx)}
	if tc, ok := tenantctx.FromContext(ctx); ok {
		e.ActorKind, e.ActorID = ActorPerson, tc.PersonID
	}
	return e
}

func invalid(format string, a ...any) error {
	return fmt.Errorf("%w: "+format, append([]any{ErrInvalid}, a...)...)
}

// common checks the fields shared by both tables.
func common(action, target, result, reqID string) error {
	switch {
	case !actionRE.MatchString(action):
		return invalid("action %q: want <domain>.<entity>.<verb> in lower case", action)
	case !targetRE.MatchString(target):
		return invalid("target type %q", target)
	case !slices.Contains(results, result):
		return invalid("result %q: want ok, denied or failed", result)
	case reqID == "":
		return invalid("no request id")
	}
	return nil
}

// nullable returns nil for the zero UUID: the columns are nullable references.
func nullable(id uuid.UUID) any {
	if id == uuid.Nil {
		return nil
	}
	return id
}

func nullableText(s string) any {
	if s == "" {
		return nil
	}
	return s
}

const insertSQL = `
insert into audit.events (actor_kind, actor_id, action, target_type, target_id, unit_id, sensitivity, reason,
                          result, request_id, diff)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`

// Record inserts e into audit.events through db (the transaction of the change). The request id defaults to the
// one of ctx; the sensitivity to normal. Restricted fields must be redacted by the caller (Redact).
func Record(ctx context.Context, db Execer, e Event) error {
	if e.RequestID == "" {
		e.RequestID = requestid.FromContext(ctx)
	}
	if e.Sensitivity == "" {
		e.Sensitivity = Normal
	}
	if err := common(e.Action, e.TargetType, e.Result, e.RequestID); err != nil {
		return err
	}
	switch {
	case !slices.Contains([]string{ActorPerson, ActorService, ActorSupport}, e.ActorKind):
		return invalid("actor kind %q", e.ActorKind)
	case e.ActorKind != ActorService && e.ActorID == uuid.Nil:
		return invalid("actor %s without id", e.ActorKind)
	case !slices.Contains([]string{Normal, Sensitive, Restricted}, e.Sensitivity):
		return invalid("sensitivity %q", e.Sensitivity)
	}
	var diff any
	if e.Diff != nil {
		diff = e.Diff
	}
	_, err := db.Exec(ctx, insertSQL, e.ActorKind, nullable(e.ActorID), e.Action, e.TargetType, nullable(e.TargetID),
		nullable(e.UnitID), e.Sensitivity, nullableText(e.Reason), e.Result, e.RequestID, diff)
	if err != nil {
		return fmt.Errorf("audit: record %s: %w", e.Action, err)
	}
	return nil
}

const insertPlatformSQL = `
insert into platform_audit (actor_kind, actor_id, action, target_type, target_id, reason, result, request_id, details)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`

// RecordPlatform inserts e into platform_audit of the control DB (suspension, trial extension, subscriptions…).
func RecordPlatform(ctx context.Context, db Execer, e PlatformEvent) error {
	if e.RequestID == "" {
		e.RequestID = requestid.FromContext(ctx)
	}
	if err := common(e.Action, e.TargetType, e.Result, e.RequestID); err != nil {
		return err
	}
	switch {
	case !slices.Contains([]string{PlatformOperator, PlatformOwner, PlatformSystem}, e.ActorKind):
		return invalid("platform actor kind %q", e.ActorKind)
	case e.ActorKind != PlatformSystem && e.ActorID == uuid.Nil:
		return invalid("actor %s without id", e.ActorKind)
	}
	details := e.Details
	if details == nil {
		details = map[string]any{}
	}
	_, err := db.Exec(ctx, insertPlatformSQL, e.ActorKind, nullable(e.ActorID), e.Action, e.TargetType,
		nullable(e.TargetID), nullableText(e.Reason), e.Result, e.RequestID, details)
	if err != nil {
		return fmt.Errorf("audit: record platform %s: %w", e.Action, err)
	}
	return nil
}

// Redact returns a copy of diff with the restricted fields replaced by RedactedValue ("restricted-поля
// редактируются по field policy", tenant 0001). Absent fields are not added.
func Redact(diff map[string]any, restricted ...string) map[string]any {
	if diff == nil {
		return nil
	}
	out := maps.Clone(diff)
	for _, f := range restricted {
		if _, ok := out[f]; ok {
			out[f] = RedactedValue
		}
	}
	return out
}
