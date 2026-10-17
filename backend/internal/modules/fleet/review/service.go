// Package review is the acceptance of a shift by the manager (W2.06, S2-10, S2-11): reviewTrip accepts a submitted
// shift, sends it back for rework by sections or accepts it with the vehicle sent to maintenance; reviewTripExpense
// approves or rejects one expense of the trip before the acceptance. The vehicle is released only when the shift is
// accepted: its status is derived from the state of the trip (W2.02), its odometer takes the return inspection and the
// consumed reservation of the trip ends at the acceptance. Earnings are not touched: the manager sets them by a
// separate command of the tag Earnings (modules/finance, Q-55).
//
// Access follows the trip: fleet.trips.review or fleet.expenses.review over the unit of the trip (the owner — any);
// an invisible trip is 404, a visible one without the right — 403; the driver of the trip never accepts his own shift
// or his own expenses (403).
package review

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/idem"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Pools reaches tenant DBs (tenantctx.Pools: sentinel-checked, never a fallback database).
type Pools interface {
	For(ctx context.Context, tenantID uuid.UUID) (*pgxpool.Pool, error)
}

// Authorizer is the evaluator of W1.04 (*authz.Evaluator).
type Authorizer interface {
	Permit(ctx context.Context, tc tenantctx.TenantContext, action string, r authz.Resource) error
}

var _ Authorizer = (*authz.Evaluator)(nil)

// Service implements reviewTrip and reviewTripExpense. Every statement goes to the tenant DB of the request only
// (AC-02).
type Service struct {
	Pools      Pools
	Authz      Authorizer
	Recipients inbox.Recipients // the membership of a person (control DB) for the notifications; nil: none sent
	Audience   inbox.Audience   // the check of a recipient when a notification is enqueued (W1.10); nil: none sent
	Now        func() time.Time // the clock of the application (APP_FIXED_NOW outside prod); nil: time.Now
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

// inTx runs fn in one transaction of the tenant DB of tc with the evaluator and the audience reading through it
// (authz.TxSource, as W2.04 and W2.05): a command holds one connection at most. An error or a panic rolls it back.
func (s *Service) inTx(ctx context.Context, tc tenantctx.TenantContext, fn func(s *Service, tx pgx.Tx) error) error {
	if tc.TenantID == uuid.Nil {
		return problem.New(problem.CodeNotFound, "")
	}
	pool, err := s.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }() // after Commit — a no-op
	if err := fn(s.through(tx), tx); err != nil {
		return dbError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return nil
}

// through is s with the evaluator and the audience reading through tx.
func (s *Service) through(tx pgx.Tx) *Service {
	cp := *s
	ev, ok := s.Authz.(*authz.Evaluator)
	if !ok {
		return &cp
	}
	e := *ev
	src := authz.TxSource{Q: tx}
	e.Source = src
	if ev.Units != nil {
		e.Units = src
	}
	cp.Authz = &e
	if _, ok := s.Audience.(inbox.AuthzAudience); ok {
		cp.Audience = inbox.AuthzAudience{E: &e}
	}
	return &cp
}

// dbError keeps Problem errors and hides everything else behind dependency_unavailable.
func dbError(err error) error {
	if _, ok := errors.AsType[*problem.Error](err); ok {
		return err
	}
	return problem.Wrap(problem.CodeDependencyUnavailable, err)
}

func errNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// complete stores the outcome of a command under an Idempotency-Key (10 §3.5); outside the guard — nothing. A lost
// lease rolls the command back (409 idempotency_in_progress, retryable).
func complete(ctx context.Context, tx pgx.Tx, status int, tag string, body any) error {
	if _, ok := idem.FromContext(ctx); !ok {
		return nil
	}
	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(body); err != nil {
		return fmt.Errorf("review: outcome: %w", err)
	}
	h := http.Header{"Content-Type": {"application/json"}}
	h.Set("ETag", tag)
	err := idem.CompleteInTx(ctx, tx, status, h, buf.Bytes())
	switch {
	case errors.Is(err, idem.ErrLeaseLost):
		return problem.Wrap(codeIdemInProgress, err)
	case err != nil:
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return nil
}

// requestID is the request id of ctx; a call outside an HTTP request gets a generated one (audit needs it).
func requestID(ctx context.Context) string {
	if id := requestid.FromContext(ctx); id != "" {
		return id
	}
	return "job-" + uuid.NewString()
}
