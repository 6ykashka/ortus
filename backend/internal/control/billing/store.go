package billing

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ortus/ortus-crm/backend/internal/control/subscriptions"
	"github.com/ortus/ortus-crm/backend/internal/control/tenants/operators"
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
)

// Errors of the store.
var (
	ErrNotFound    = errors.New("billing: not found")
	ErrForbidden   = errors.New("billing: the role of the operator does not allow the command")
	ErrNotOperator = errors.New("billing: not an active platform operator")
	ErrBadCursor   = errors.New("billing: malformed cursor")

	errNoVersion = errors.New("billing: the price book has no version in force")
)

// Problem codes of the refusals (api/errors.yaml).
const (
	CodeValidationFailed  = "validation_failed"
	CodeInvalidTransition = "invalid_transition"
	CodeRequestPending    = "request_pending"
	CodeTierBelowUsage    = "tier_below_usage"
)

// RefusalError is a refused command with its Problem code (409 or 422), the detail shown to the user and the field
// violations.
type RefusalError struct {
	Code, Detail string
	Violations   []Violation
}

func (r *RefusalError) Error() string {
	parts := []string{"billing: " + r.Code, r.Detail}
	for _, v := range r.Violations {
		parts = append(parts, v.Field+": "+v.Message)
	}
	return strings.Join(parts, "; ")
}

func refuse(code, detail string, violations ...Violation) *RefusalError {
	return &RefusalError{Code: code, Detail: detail, Violations: violations}
}

// Store is the billing of the control DB (role ortus_api: DML; platform_audit — SELECT and INSERT). Every command
// runs in one transaction under the lock of the tenant row (the lock order of the subscription store) and writes its
// platform_audit row in the same transaction; a command an operator role does not allow is recorded as denied.
type Store struct {
	DB   *sql.DB
	Subs subscriptions.Store // the subscription of W1.08 (Locked, ChangePlan, Current); its clock is Now
	Now  func() time.Time    // the clock of the application (APP_FIXED_NOW outside prod); nil — time.Now
}

func (s Store) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

// queryer is a *sql.DB or *sql.Tx.
type queryer interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// auditExec adapts a database/sql transaction or pool to audit.Execer.
type auditExec struct{ db queryer }

func (a auditExec) Exec(ctx context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	res, err := a.db.ExecContext(ctx, query, args...)
	if err != nil {
		return pgconn.CommandTag{}, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return pgconn.CommandTag{}, err
	}
	return pgconn.NewCommandTag("INSERT 0 " + strconv.FormatInt(n, 10)), nil
}

// requestIDOf is the request id of a command: the given one, else the one of ctx, else a run id of the billing
// (platform_audit.request_id is required).
func requestIDOf(ctx context.Context, given string) string {
	if given != "" {
		return given
	}
	if id := requestid.FromContext(ctx); id != "" {
		return id
	}
	return "billing:" + uuid.NewString()
}

// operator is the active platform operator of an account.
type operator struct {
	id, account uuid.UUID
	role, name  string
}

func lookupOperator(ctx context.Context, q queryer, account uuid.UUID) (operator, error) {
	op := operator{account: account}
	err := q.QueryRowContext(ctx, `select o.id, o.role, a.display_name from platform_operators o join accounts a on a.id = o.account_id
 where o.account_id = $1 and o.status = 'active'`, account).Scan(&op.id, &op.role, &op.name)
	if errors.Is(err, sql.ErrNoRows) {
		return operator{}, ErrNotOperator
	}
	if err != nil {
		return operator{}, fmt.Errorf("billing: operator: %w", err)
	}
	return op, nil
}

// event is a platform_audit row of an actor (operator, owner or system) with string details.
func event(kind string, actor uuid.UUID, action, targetType string, target uuid.UUID, reason, reqID string, details map[string]string) audit.PlatformEvent {
	d := make(map[string]any, len(details))
	for k, v := range details {
		d[k] = v
	}
	return audit.PlatformEvent{
		ActorKind: kind, ActorID: actor, Action: action, TargetType: targetType, TargetID: target,
		Reason: strings.TrimSpace(reason), Result: audit.OK, RequestID: reqID, Details: d,
	}
}

// authorize checks the role of the operator of account for permission; a refusal is recorded as denied (NFR-05) and
// returned as ErrForbidden.
func (s Store) authorize(ctx context.Context, account uuid.UUID, permission, action, targetType string, target uuid.UUID, reqID string) (operator, error) {
	op, err := lookupOperator(ctx, s.DB, account)
	if err != nil {
		return operator{}, err
	}
	if operators.Allowed(op.role, permission) {
		return op, nil
	}
	e := event(audit.PlatformOperator, account, action, targetType, target, "", reqID, map[string]string{"permission": permission})
	e.Result = audit.Denied
	if err := audit.RecordPlatform(ctx, auditExec{s.DB}, e); err != nil {
		return operator{}, errors.Join(ErrForbidden, err)
	}
	return operator{}, ErrForbidden
}

// lockTenant locks the row of a tenant (the lock order of the subscription store); a missing one is ErrNotFound.
func lockTenant(ctx context.Context, tx *sql.Tx, id uuid.UUID) error {
	var ok bool
	err := tx.QueryRowContext(ctx, `select true from tenants where id = $1 for update`, id).Scan(&ok)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("billing: lock tenant: %w", err)
	}
	return nil
}

// tenantExists reports whether a tenant exists (the tenantId filters of the operator lists); ErrNotFound.
func tenantExists(ctx context.Context, q queryer, id uuid.UUID) error {
	var ok bool
	if err := q.QueryRowContext(ctx, `select exists (select 1 from tenants where id = $1)`, id).Scan(&ok); err != nil {
		return fmt.Errorf("billing: tenant: %w", err)
	}
	if !ok {
		return ErrNotFound
	}
	return nil
}

// subscriptionError maps an unknown tenant of the subscription store to ErrNotFound.
func subscriptionError(err error) error {
	if errors.Is(err, subscriptions.ErrUnknownTenant) {
		return ErrNotFound
	}
	return err
}

// idsOf reads the single uuid column of rows and closes them.
func idsOf(rows *sql.Rows) ([]uuid.UUID, error) {
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
