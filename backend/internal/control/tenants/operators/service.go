package operators

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ortus/ortus-crm/backend/internal/control/subscriptions"
	"github.com/ortus/ortus-crm/backend/internal/control/tenants"
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
)

// Service runs the operator commands over the control DB (role ortus_api: DML; platform_audit only SELECT and
// INSERT). A command reads the operator and locks the tenant row (SELECT … FOR UPDATE, the lock order of the
// subscription store of W1.08) in one transaction, checks the role, If-Match and the transition, changes the rows and
// writes platform_audit in the same transaction; a refusal by role is recorded as denied in its own statement.
type Service struct {
	Control *sql.DB
	Now     func() time.Time // the clock of the application (APP_FIXED_NOW outside prod); nil: time.Now
}

var _ Commands = (*Service)(nil)

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

// execer adapts a database/sql transaction or pool to audit.Execer.
type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

type auditExec struct{ db execer }

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

// queryer is a *sql.DB or *sql.Tx.
type queryer interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

type operator struct {
	account uuid.UUID
	role    string
}

// lookupOperator finds the active operator of an account; anyone else is ErrNotOperator.
func lookupOperator(ctx context.Context, q queryer, account uuid.UUID) (operator, error) {
	op := operator{account: account}
	err := q.QueryRowContext(ctx, `select role from platform_operators where account_id = $1 and status = 'active'`, account).Scan(&op.role)
	if errors.Is(err, sql.ErrNoRows) {
		return operator{}, ErrNotOperator
	}
	if err != nil {
		return operator{}, fmt.Errorf("operators: operator: %w", err)
	}
	return op, nil
}

// tenantRow is the locked row of a tenant.
type tenantRow struct {
	id          uuid.UUID
	name, state string
	revision    int64
	changedAt   time.Time
}

// lockTenant locks the row of a tenant for the command; a missing one is tenants.ErrUnknownTenant.
func lockTenant(ctx context.Context, tx *sql.Tx, id uuid.UUID) (tenantRow, error) {
	r := tenantRow{id: id}
	err := tx.QueryRowContext(ctx, `select display_name, state::text, revision, state_changed_at from tenants where id = $1 for update`, id).
		Scan(&r.name, &r.state, &r.revision, &r.changedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return tenantRow{}, fmt.Errorf("%w: %s", tenants.ErrUnknownTenant, id)
	}
	if err != nil {
		return tenantRow{}, fmt.Errorf("operators: lock tenant %s: %w", id, err)
	}
	r.changedAt = r.changedAt.UTC()
	return r, nil
}

// event is a platform_audit record of op; details are stored as strings (PlatformAuditEvent.details).
func (op operator) event(action, targetType string, target uuid.UUID, reason, requestID string, details map[string]string) audit.PlatformEvent {
	d := make(map[string]any, len(details))
	for k, v := range details {
		d[k] = v
	}
	return audit.PlatformEvent{
		ActorKind: audit.PlatformOperator, ActorID: op.account, Action: action, TargetType: targetType, TargetID: target,
		Reason: strings.TrimSpace(reason), Result: audit.OK, RequestID: requestID, Details: d,
	}
}

// deny records a command refused by the role of the operator (NFR-05: denied attempts are audited) and returns
// ErrForbidden.
func (s *Service) deny(ctx context.Context, op operator, action, targetType string, target uuid.UUID, reason, requestID, permission string) error {
	e := op.event(action, targetType, target, reason, requestID, map[string]string{"permission": permission})
	e.Result = audit.Denied
	if err := audit.RecordPlatform(ctx, auditExec{s.Control}, e); err != nil {
		return errors.Join(ErrForbidden, err)
	}
	return ErrForbidden
}

// requestIDOf is the request id of a command: the given one, else the one of ctx (X-Request-Id), else a new run id
// (a command outside HTTP): platform_audit.request_id is required.
func requestIDOf(ctx context.Context, given string) string {
	if given != "" {
		return given
	}
	if id := requestid.FromContext(ctx); id != "" {
		return id
	}
	return tenants.NewRunID("operator")
}

// command is what every command shares: the operator, the target tenant, If-Match, the audit identity.
type command struct {
	tenant, actor      uuid.UUID
	ifMatch            string
	reason, requestID  string
	action, targetType string
	permission         string
}

// locked is a command inside its transaction after the checks of role and tenant.
type locked struct {
	tx   *sql.Tx
	op   operator
	row  tenantRow
	want int64 // revision of If-Match
	bad  bool  // If-Match names no revision: never current
}

// open runs the shared checks of a command in their order (brief §10 item 8): If-Match present (428) → operator
// (404) → role (403, audited as denied) → tenant (404). The revision is compared by the caller (tenant or
// subscription). The caller rolls back unless it commits.
func (s *Service) open(ctx context.Context, c command) (locked, error) {
	want, etagErr := ParseETag(c.ifMatch)
	if errors.Is(etagErr, ErrRevisionRequired) {
		return locked{}, etagErr
	}
	tx, err := s.Control.BeginTx(ctx, nil)
	if err != nil {
		return locked{}, fmt.Errorf("operators: begin: %w", err)
	}
	op, err := lookupOperator(ctx, tx, c.actor)
	if err != nil {
		_ = tx.Rollback()
		return locked{}, err
	}
	if !Allowed(op.role, c.permission) {
		_ = tx.Rollback()
		return locked{}, s.deny(ctx, op, c.action, c.targetType, c.tenant, c.reason, c.requestID, c.permission)
	}
	row, err := lockTenant(ctx, tx, c.tenant)
	if err != nil {
		_ = tx.Rollback()
		return locked{}, err
	}
	return locked{tx: tx, op: op, row: row, want: want, bad: etagErr != nil}, nil
}

// current reports whether If-Match names revision.
func (l locked) current(revision int64) bool { return !l.bad && l.want == revision }

// writeTenant stores the name and the state of next (one revision); a change of state records its reason and time.
func writeTenant(ctx context.Context, tx *sql.Tx, row, next tenantRow, reason string, now time.Time) error {
	stateChanged := next.state != row.state
	if _, err := tx.ExecContext(ctx, `update tenants
   set display_name = $2,
       state = $3::tenant_state,
       state_reason = case when $4 then nullif($5, '') else state_reason end,
       state_changed_at = case when $4 then $6 else state_changed_at end,
       revision = revision + 1
 where id = $1`, row.id, next.name, next.state, stateChanged, strings.TrimSpace(reason), now); err != nil {
		return fmt.Errorf("operators: update tenant %s: %w", row.id, err)
	}
	return nil
}

// finish writes the audit record of a tenant command, reads the card and commits.
func finish(ctx context.Context, l locked, e *audit.PlatformEvent) (tenants.Tenant, error) {
	if e != nil {
		if err := audit.RecordPlatform(ctx, auditExec{l.tx}, *e); err != nil {
			return tenants.Tenant{}, err
		}
	}
	tn, err := tenants.GetTenant(ctx, l.tx, l.row.id)
	if err != nil {
		return tenants.Tenant{}, err
	}
	if err := l.tx.Commit(); err != nil {
		return tenants.Tenant{}, fmt.Errorf("operators: commit: %w", err)
	}
	return tn, nil
}

// changeState runs a command that moves the tenant from row.state to the state decide returns.
func (s *Service) changeState(ctx context.Context, c StatusChange, action string,
	decide func(ctx context.Context, tx *sql.Tx, row tenantRow, actor uuid.UUID, reason string, now time.Time) (string, error),
) (tenants.Tenant, error) {
	if err := c.Validate(); err != nil {
		return tenants.Tenant{}, err
	}
	reqID := requestIDOf(ctx, c.RequestID)
	l, err := s.open(ctx, command{
		tenant: c.TenantID, actor: c.ActorID, ifMatch: c.IfMatch, reason: c.Reason, requestID: reqID, action: action,
		targetType: TargetTenant, permission: PermTenantsManage,
	})
	if err != nil {
		return tenants.Tenant{}, err
	}
	defer func() { _ = l.tx.Rollback() }() // no-op after Commit
	if !l.current(l.row.revision) {
		return tenants.Tenant{}, ErrRevisionMismatch
	}
	now := s.now()
	to, err := decide(ctx, l.tx, l.row, c.ActorID, c.Reason, now)
	if err != nil {
		return tenants.Tenant{}, err
	}
	next := l.row
	next.state = to
	if err := writeTenant(ctx, l.tx, l.row, next, c.Reason, now); err != nil {
		return tenants.Tenant{}, err
	}
	e := l.op.event(action, TargetTenant, c.TenantID, c.Reason, reqID, map[string]string{"fromStatus": l.row.state, "toStatus": to})
	return finish(ctx, l, &e)
}

// Suspend runs suspendPlatformTenant: trial, active, grace or read_only → suspended (PLAT-02). A tenant without a
// subscription row gets its derived subscription stored first (Q-W1.08-13), so resuming knows its state and the
// lifecycle of W1.08 keeps counting its period during the suspension.
func (s *Service) Suspend(ctx context.Context, c StatusChange) (tenants.Tenant, error) {
	return s.changeState(ctx, c, ActionSuspended, func(ctx context.Context, tx *sql.Tx, row tenantRow, actor uuid.UUID, reason string, now time.Time) (string, error) {
		to, err := SuspendTo(row.state)
		if err != nil {
			return "", fmt.Errorf("%w: suspend from %s", err, row.state)
		}
		return to, materialize(ctx, tx, row, actor, reason, now)
	})
}

// Resume runs resumePlatformTenant: a suspended tenant returns to the state of its subscription (Q-W1.00-3).
func (s *Service) Resume(ctx context.Context, c StatusChange) (tenants.Tenant, error) {
	return s.changeState(ctx, c, ActionResumed, func(ctx context.Context, tx *sql.Tx, row tenantRow, _ uuid.UUID, _ string, _ time.Time) (string, error) {
		if row.state != StateSuspended {
			return "", fmt.Errorf("%w: resume from %s", ErrInvalidTransition, row.state)
		}
		return resumeState(ctx, tx, row)
	})
}

// resumeState is the state a suspended tenant resumes into: by its stored subscription; without one (suspended
// before W1.48), the state before its last suspension (details.fromStatus), else active.
func resumeState(ctx context.Context, tx *sql.Tx, row tenantRow) (string, error) {
	r, ok, err := storedRow(ctx, tx, row.id, false)
	if err != nil {
		return "", err
	}
	if ok {
		return ResumeTo(row.state, statusOf[r.state])
	}
	var from sql.NullString
	err = tx.QueryRowContext(ctx, `select details->>'fromStatus' from platform_audit
 where action = $1 and target_type = $2 and target_id = $3 and result = 'ok' order by id desc limit 1`,
		ActionSuspended, TargetTenant, row.id).Scan(&from)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("operators: last suspension of %s: %w", row.id, err)
	}
	if from.Valid && slices.Contains(suspendable, from.String) {
		return from.String, nil
	}
	return StateActive, nil
}

// Rename runs updatePlatformTenant: the name changes (one revision, tenant.renamed); the same name changes nothing
// and writes no audit.
func (s *Service) Rename(ctx context.Context, c Rename) (tenants.Tenant, error) {
	if err := c.Validate(); err != nil {
		return tenants.Tenant{}, err
	}
	reason := ""
	if c.Reason != nil {
		reason = *c.Reason
	}
	reqID := requestIDOf(ctx, c.RequestID)
	l, err := s.open(ctx, command{
		tenant: c.TenantID, actor: c.ActorID, ifMatch: c.IfMatch, reason: reason, requestID: reqID, action: ActionRenamed,
		targetType: TargetTenant, permission: PermTenantsManage,
	})
	if err != nil {
		return tenants.Tenant{}, err
	}
	defer func() { _ = l.tx.Rollback() }()
	if !l.current(l.row.revision) {
		return tenants.Tenant{}, ErrRevisionMismatch
	}
	name := strings.TrimSpace(c.Name)
	if name == l.row.name {
		return finish(ctx, l, nil)
	}
	next := l.row
	next.name = name
	if err := writeTenant(ctx, l.tx, l.row, next, reason, s.now()); err != nil {
		return tenants.Tenant{}, err
	}
	e := l.op.event(ActionRenamed, TargetTenant, c.TenantID, reason, reqID, map[string]string{"from": l.row.name, "to": name})
	return finish(ctx, l, &e)
}

// ExtendTrial runs extendPlatformTrial (PLAT-05, Q-W1.00-6): the subscription becomes trialing until NextTrialEnd,
// its trial entitlements are derived again (manual ones are kept) under the next revision, and a tenant that
// follows its subscription returns to trial; a suspended one stays suspended.
func (s *Service) ExtendTrial(ctx context.Context, c TrialExtension) (subscriptions.Subscription, error) {
	if err := c.Validate(); err != nil {
		return subscriptions.Subscription{}, err
	}
	reqID := requestIDOf(ctx, c.RequestID)
	l, err := s.open(ctx, command{
		tenant: c.TenantID, actor: c.ActorID, ifMatch: c.IfMatch, reason: c.Reason, requestID: reqID, action: ActionTrialExtended,
		targetType: TargetSubscription, permission: PermBillingManage,
	})
	if err != nil {
		return subscriptions.Subscription{}, err
	}
	defer func() { _ = l.tx.Rollback() }() // no-op after Commit
	now := s.now()
	cur, stored, err := loadSubscription(ctx, l.tx, l.row, now)
	if err != nil {
		return subscriptions.Subscription{}, err
	}
	if !l.current(cur.Revision) {
		return subscriptions.Subscription{}, ErrRevisionMismatch
	}
	if err := CanExtendTrial(l.row.state, cur); err != nil {
		return subscriptions.Subscription{}, fmt.Errorf("%w: extend trial of %s (%s)", err, l.row.state, cur.Status)
	}
	next, err := extend(ctx, l, cur, stored, c, now)
	if err != nil {
		return subscriptions.Subscription{}, err
	}
	e := l.op.event(ActionTrialExtended, TargetSubscription, c.TenantID, c.Reason, reqID, map[string]string{
		"days": strconv.Itoa(c.Days), "trialEndsAt": next.TrialEndsAt.Format(time.RFC3339), "fromStatus": cur.Status, "toStatus": next.Status,
	})
	if err := audit.RecordPlatform(ctx, auditExec{l.tx}, e); err != nil {
		return subscriptions.Subscription{}, err
	}
	if err := l.tx.Commit(); err != nil {
		return subscriptions.Subscription{}, fmt.Errorf("operators: commit: %w", err)
	}
	return next, nil
}

// extend writes the extended trial of cur in the transaction of l: the subscription row, its entitlements and the
// state of a tenant that follows its subscription.
func extend(ctx context.Context, l locked, cur subscriptions.Subscription, stored subRow, c TrialExtension, now time.Time) (subscriptions.Subscription, error) {
	history, err := planHistory(ctx, l.tx, c.TenantID)
	if err != nil {
		return subscriptions.Subscription{}, err
	}
	end := NextTrialEnd(cur, now, c.Days)
	next := subscriptions.Subscription{
		TenantID: c.TenantID, PlanKey: cur.PlanKey, Status: subscriptions.StatusTrialing, TrialEndsAt: &end,
		Entitlements: trialEntitlements(cur, history), Revision: cur.Revision + 1, Stored: true,
	}
	since := now // a new trial after grace or read_only starts now: the expired one is not stretched back
	if cur.Status == subscriptions.StatusTrialing {
		since = stored.since
	}
	if err := writeSubscription(ctx, l.tx, stored, next, since, c.Reason, c.ActorID, now); err != nil {
		return subscriptions.Subscription{}, err
	}
	if !followed[l.row.state] || l.row.state == StateTrial {
		return next, nil
	}
	trial := l.row
	trial.state = StateTrial
	return next, writeTenant(ctx, l.tx, l.row, trial, c.Reason, now)
}
