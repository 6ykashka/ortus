package accounts

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ortus/ortus-crm/backend/internal/control/tenants/operators"
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
)

// DefaultDomain is the e-mail domain of the operators (realm ortus-operators, MSW OPERATOR_DOMAIN).
const DefaultDomain = "ortus.example"

// Problem codes of the refusals (api/errors.yaml).
const (
	codeValidationFailed  = "validation_failed"
	codeInvalidTransition = "invalid_transition"
	codeLastOwnerRequired = "last_owner_required"
)

// Bounds of the contract: reason 5–500 characters after trim.
const (
	reasonMin = 5
	reasonMax = 500
)

// Service is the catalogue of accounts and the operators of the platform over the control DB (role ortus_api: DML;
// platform_audit — SELECT and INSERT). Every command checks the role of the operator (a refusal is audited as denied),
// runs in one transaction under the lock of the rows it changes and writes its platform_audit row there.
type Service struct {
	Control *sql.DB
	Domain  string           // the e-mail domain of the operators; "" — DefaultDomain
	Now     func() time.Time // the clock of the application; nil — time.Now
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

func (s *Service) domain() string {
	if s.Domain != "" {
		return strings.ToLower(s.Domain)
	}
	return DefaultDomain
}

func refuse(code, detail string, violations ...Violation) *RefusalError {
	return &RefusalError{Code: code, Detail: detail, Violations: violations}
}

func runes(s string) int { return utf8.RuneCountInString(strings.TrimSpace(s)) }

// validReason reports whether a reason has 5–500 characters after trim.
func validReason(s string) bool { n := runes(s); return n >= reasonMin && n <= reasonMax }

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

// requestIDOf is the request id of a command: the given one, else the one of ctx, else a run id.
func requestIDOf(ctx context.Context, given string) string {
	if given != "" {
		return given
	}
	if id := requestid.FromContext(ctx); id != "" {
		return id
	}
	return "accounts:" + uuid.NewString()
}

// actor is the active operator of a command.
type actor struct {
	op, account uuid.UUID
	role        string
}

// event is a platform_audit row of the operator a with string details.
func (a actor) event(action, targetType string, target uuid.UUID, reason, reqID string, details map[string]string) audit.PlatformEvent {
	d := make(map[string]any, len(details))
	for k, v := range details {
		d[k] = v
	}
	return audit.PlatformEvent{
		ActorKind: audit.PlatformOperator, ActorID: a.account, Action: action, TargetType: targetType, TargetID: target,
		Reason: strings.TrimSpace(reason), Result: audit.OK, RequestID: reqID, Details: d,
	}
}

// authorize finds the active operator of account and checks its role for permission; a refusal is recorded as denied
// (NFR-05) and returned as ErrForbidden; a non-operator is ErrNotFound (the gateway answers 404 to them).
func (s *Service) authorize(ctx context.Context, account uuid.UUID, permission, action, targetType string, target uuid.UUID, reqID string) (actor, error) {
	a := actor{account: account}
	err := s.Control.QueryRowContext(ctx, `select id, role from platform_operators where account_id = $1 and status = 'active'`, account).
		Scan(&a.op, &a.role)
	if errors.Is(err, sql.ErrNoRows) {
		return actor{}, ErrNotFound
	}
	if err != nil {
		return actor{}, fmt.Errorf("accounts: operator: %w", err)
	}
	if operators.Allowed(a.role, permission) {
		return a, nil
	}
	e := a.event(action, targetType, target, "", reqID, map[string]string{"permission": permission})
	e.Result = audit.Denied
	if err := audit.RecordPlatform(ctx, auditExec{s.Control}, e); err != nil {
		return actor{}, errors.Join(ErrForbidden, err)
	}
	return actor{}, ErrForbidden
}

// recordAudit writes e in tx.
func recordAudit(ctx context.Context, tx *sql.Tx, e audit.PlatformEvent) error {
	return audit.RecordPlatform(ctx, auditExec{tx}, e)
}

// revokeSessions ends the live BFF sessions of an account at once (a lock of sign-in, a disabled operator).
func revokeSessions(ctx context.Context, tx *sql.Tx, account uuid.UUID, now time.Time) error {
	if _, err := tx.ExecContext(ctx, `update auth_sessions set revoked_at = $2 where account_id = $1 and revoked_at is null`, account, now); err != nil {
		return fmt.Errorf("accounts: revoke sessions: %w", err)
	}
	return nil
}
