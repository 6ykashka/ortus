// Package kit is what the access module of W1.06 shares between its parts (roles, assignments, groups, explain):
// dependencies of the handlers, the tenant of a request, transactions, problems, revisions and cursors, the scope of
// the contract ↔ the scope of the tenant DB, delegation (AUTH-08), separation of duties (AUTH-05, D-10), the policy
// version with its audit record and outbox event.
package kit

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/scopeddb"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// FreshSignIn is how recent the sign-in of an owner command must be (AUTH-08, Q-W0.08-3).
const FreshSignIn = 10 * time.Minute

// Deps are the dependencies of the access handlers (cmd/api builds them).
type Deps struct {
	Pools     scopeddb.Pools   // tenant DBs (tenantctx.Pools: sentinel-checked, never a fallback database)
	Evaluator *authz.Evaluator // the evaluator of W1.04
	Control   *pgxpool.Pool    // control DB as ortus_api: owner_bindings, memberships, accounts, tenants
	Now       func() time.Time // the clock of the application (APP_FIXED_NOW outside prod); nil: time.Now
	// AuthTime returns when the account of the request signed in at its provider; nil: session.IssuedAt.
	AuthTime func(ctx context.Context) (time.Time, bool)
	// SessionNow is the clock of the sessions (the wall clock: sessions are not issued on APP_FIXED_NOW); nil: time.Now.
	SessionNow func() time.Time
	// Log receives what needs manual repair (the control and the tenant DB out of step); nil: slog.Default().
	Log *slog.Logger
}

func (d Deps) log() *slog.Logger {
	if d.Log != nil {
		return d.Log
	}
	return slog.Default()
}

// Clock returns «now» of the application.
func (d Deps) Clock() time.Time {
	if d.Now != nil {
		return d.Now()
	}
	return time.Now()
}

func (d Deps) sessionNow() time.Time {
	if d.SessionNow != nil {
		return d.SessionNow()
	}
	return time.Now()
}

// Tenant returns the TenantContext the gateway put in ctx; without one the request never passed the gateway.
func Tenant(ctx context.Context) (tenantctx.TenantContext, error) {
	tc, ok := tenantctx.FromContext(ctx)
	if !ok {
		return tenantctx.TenantContext{}, problem.New(problem.CodeNotFound, "")
	}
	return tc, nil
}

// Pool returns the tenant DB of tc.
func (d Deps) Pool(ctx context.Context, tc tenantctx.TenantContext) (*pgxpool.Pool, error) {
	pool, err := d.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return nil, Unavailable(err)
	}
	return pool, nil
}

// Scoped returns the tenant DB of tc with the scope predicates of the evaluator (scopeddb).
func (d Deps) Scoped(ctx context.Context, tc tenantctx.TenantContext, ev *authz.Evaluator) (*scopeddb.Conn, error) {
	c, err := scopeddb.For(ctx, d.Pools, ev, tc)
	if err != nil {
		return nil, Unavailable(err)
	}
	return c, nil
}

// InTx runs fn in one transaction of the tenant DB of tc; an error or a panic of fn rolls it back.
func (d Deps) InTx(ctx context.Context, tc tenantctx.TenantContext, fn func(pgx.Tx) error) error {
	pool, err := d.Pool(ctx, tc)
	if err != nil {
		return err
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return Unavailable(err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }() // no-op after Commit
	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return Unavailable(err)
	}
	return nil
}

// InPolicyTx is InTx with LockPolicy first: the transaction of a command that checks the access model before it
// changes it.
func (d Deps) InPolicyTx(ctx context.Context, tc tenantctx.TenantContext, fn func(pgx.Tx) error) error {
	return d.InTx(ctx, tc, func(tx pgx.Tx) error {
		if err := LockPolicy(ctx, tx); err != nil {
			return err
		}
		return fn(tx)
	})
}

// InPeopleTx is InPolicyTx for a command that may give rights to people (D-10): it locks the people returned by the
// people func (LockPeople) before the policy row. createWorkProfile and updateWorkProfile of W1.05 lock the person (or its work
// function), check the earnings and only then raise policy_version (UPDATE access.policy_state): taken in the same
// order here, the locks make either command wait for the other one to commit before its check, never one check
// pass the uncommitted write of the other (write skew), and never a deadlock. people runs in the transaction before
// any lock; the checks of fn lock again what they check (Separation, RoleHeldByDriver), which costs nothing for the
// people already locked.
func (d Deps) InPeopleTx(ctx context.Context, tc tenantctx.TenantContext, people func(q DB) ([]uuid.UUID, error), fn func(pgx.Tx) error) error {
	return d.InTx(ctx, tc, func(tx pgx.Tx) error {
		ids, err := people(tx)
		if err != nil {
			return err
		}
		if err := LockPeople(ctx, tx, ids); err != nil {
			return err
		}
		if err := LockPolicy(ctx, tx); err != nil {
			return err
		}
		return fn(tx)
	})
}

// Fresh requires a sign-in not older than FreshSignIn (transferOwnership, revokeOwnership): otherwise 401
// session_expired, and the client signs in again and repeats the command.
func (d Deps) Fresh(ctx context.Context) error {
	at, ok := time.Time{}, false
	if d.AuthTime != nil {
		at, ok = d.AuthTime(ctx)
	} else if s, found := session.FromContext(ctx); found {
		at, ok = s.IssuedAt, true
	}
	if !ok || at.IsZero() || d.sessionNow().Sub(at) > FreshSignIn {
		return problem.New(problem.CodeSessionExpired, "Подтвердите вход: войдите снова и повторите действие.")
	}
	return nil
}

// Problem codes of the module (api/errors.yaml).
const (
	CodeValidation         = "validation_failed"
	CodeInvalidTransition  = "invalid_transition"
	CodeSeparationOfDuties = "separation_of_duties_conflict"
	CodeDelegation         = "delegation_exceeds_grant"
	CodeLastOwner          = "last_owner_required"
	CodeRevisionMismatch   = "revision_mismatch"
	CodeInProgress         = "idempotency_in_progress"
)

// Validation is 422 validation_failed with a user-facing detail.
func Validation(detail string) error { return problem.New(CodeValidation, detail) }

// Conflict is a 409 of code with a user-facing detail.
func Conflict(code, detail string) error { return problem.New(code, detail) }

// NotFound is 404 not_found: the same for a foreign and a missing id (AC-01).
func NotFound() error { return problem.New(problem.CodeNotFound, "") }

// Forbidden is 403 forbidden_action.
func Forbidden() error { return problem.New(problem.CodeForbiddenAction, "") }

// Unavailable is 503 dependency_unavailable that keeps err for the log; a problem error passes as it is.
func Unavailable(err error) error {
	if _, ok := errors.AsType[*problem.Error](err); ok {
		return err
	}
	return problem.Wrap(problem.CodeDependencyUnavailable, err)
}

// Store wraps a database error of what into dependency_unavailable.
func Store(what string, err error) error {
	if err == nil {
		return nil
	}
	return Unavailable(fmt.Errorf("%s: %w", what, err))
}

// Denied reports whether err is a refusal of the evaluator (403 forbidden_action or function_blocked, 404) rather
// than a failure.
func Denied(err error) bool {
	return problem.Is(err, problem.CodeForbiddenAction) || problem.Is(err, problem.CodeNotFound) ||
		problem.Is(err, authz.CodeFunctionBlocked)
}
