// Package finance is the earnings of a driver for a trip (W2.06, S2-12, AC-05) — a separate route of the manager:
// getTripEarnings, listTripEarnings, setTripEarnings over finance.earnings (tenant 0002). An accepted trip with a
// driver has earnings: until the manager writes them it is the draft of 0 ₽ at revision 1 the contract promises
// («Earnings record with zero amount/revision 1 is created with trip»); setTripEarnings with its If-Match writes the
// amount (revision + 1). The acceptance does not set an amount (Q-55, the setting of 18.10: the manager creates the
// earnings by a separate command after the acceptance).
//
// The minimal ledger (S2-12) is the audit: every write is a row finance.earnings.set of sensitivity restricted with the
// amount before and after and the calculation note; the note of the earnings is the one of its latest write.
//
// Access: fleet.earnings.read / fleet.earnings.manage over the unit of the trip, never as its «own» person — a driver
// does not see even his own earnings; the work function «Водитель» closes them (403 function_blocked, D-10,
// ADR-0011) — the evaluator does, and the module checks it again (fail-closed). Nothing here leaves the tag: no
// event, no notification carries an amount.
package finance

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
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Pools reaches tenant DBs (tenantctx.Pools: sentinel-checked, never a fallback database).
type Pools interface {
	For(ctx context.Context, tenantID uuid.UUID) (*pgxpool.Pool, error)
}

// Authorizer is the evaluator of W1.04 (*authz.Evaluator): decisions on an object and scope predicates of reads.
type Authorizer interface {
	Permit(ctx context.Context, tc tenantctx.TenantContext, action string, r authz.Resource) error
	ScopeQuery(ctx context.Context, tc tenantctx.TenantContext, action string, c authz.Columns, argStart int) (authz.Predicate, error)
}

var _ Authorizer = (*authz.Evaluator)(nil)

// Service implements the tag Earnings. Every statement goes to the tenant DB of the request only (AC-02).
type Service struct {
	Pools Pools
	Authz Authorizer
	Now   func() time.Time // the clock of the application (APP_FIXED_NOW outside prod); nil: time.Now
}

// ListQuery are the parameters of listTripEarnings.
type ListQuery struct {
	Cursor string
	Limit  int       // 0: the default page
	Unit   uuid.UUID // the unit with its descendants; uuid.Nil: any
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

// pool returns the tenant DB of tc; a context without a tenant has no data (404).
func (s *Service) pool(ctx context.Context, tc tenantctx.TenantContext) (*pgxpool.Pool, error) {
	if tc.TenantID == uuid.Nil {
		return nil, problem.New(problem.CodeNotFound, "")
	}
	p, err := s.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return p, nil
}

// through is the evaluator of s reading through tx (authz.TxSource): a command holds one connection at most.
func (s *Service) through(tx pgx.Tx) Authorizer {
	ev, ok := s.Authz.(*authz.Evaluator)
	if !ok {
		return s.Authz
	}
	cp := *ev
	src := authz.TxSource{Q: tx}
	cp.Source = src
	if ev.Units != nil {
		cp.Units = src
	}
	return &cp
}

// dbError keeps Problem errors and hides everything else behind dependency_unavailable.
func dbError(err error) error {
	if err == nil {
		return nil
	}
	if _, ok := errors.AsType[*problem.Error](err); ok {
		return err
	}
	return problem.Wrap(problem.CodeDependencyUnavailable, err)
}

func errNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// complete stores the outcome of a command under an Idempotency-Key (10 §3.5); outside the guard — nothing.
func complete(ctx context.Context, tx pgx.Tx, status int, tag string, body any) error {
	if _, ok := idem.FromContext(ctx); !ok {
		return nil
	}
	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(body); err != nil {
		return fmt.Errorf("finance: outcome: %w", err)
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
