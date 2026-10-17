package inspections

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
	"github.com/jackc/pgx/v5/pgconn"
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

// Authorizer is the evaluator of W1.04 (*authz.Evaluator): decisions on an object and scope predicates of reads.
type Authorizer interface {
	Permit(ctx context.Context, tc tenantctx.TenantContext, action string, r authz.Resource) error
	ScopeQuery(ctx context.Context, tc tenantctx.TenantContext, action string, c authz.Columns, argStart int) (authz.Predicate, error)
}

var _ Authorizer = (*authz.Evaluator)(nil)

// Service implements the inspection operations of the tag Fleet. Every statement goes to the tenant DB of the
// request only (AC-02).
type Service struct {
	Pools      Pools
	Authz      Authorizer
	Recipients inbox.Recipients // the membership of a person (control DB) for the notifications; nil: none sent
	Audience   inbox.Audience   // the check of a recipient when a notification is enqueued (W1.10); nil: none sent
	Now        func() time.Time // the clock of the application (APP_FIXED_NOW outside prod); nil: time.Now
}

// PageQuery is a page of a list.
type PageQuery struct {
	Cursor string
	Limit  int // 0: the default page
}

// DefectQuery are the parameters of listInspectionDefects.
type DefectQuery struct {
	PageQuery
	States    []string
	VehicleID uuid.UUID // uuid.Nil: any
	TripID    uuid.UUID // uuid.Nil: any
}

// Actions of the module (api/permissions.yaml, fleet).
const (
	actionRead         = "fleet.inspections.read"
	actionSubmit       = "fleet.inspections.submit"
	actionReview       = "fleet.inspections.review"
	actionTripsRead    = "fleet.trips.read"
	actionVehiclesRead = "fleet.vehicles.read"
)

// holdTTL is the hold a trip gets back when a defect is allowed (reservationTtlMinutes, 14 §3 п. 4).
const holdTTL = 30 * time.Minute

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

// querier is what a pool and a transaction share.
type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// inTx runs fn in one transaction of pool; an error or a panic of fn rolls it back.
func inTx(ctx context.Context, pool *pgxpool.Pool, fn func(pgx.Tx) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }() // after Commit — a no-op
	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return nil
}

// complete stores the outcome of a command in tx when it runs under an Idempotency-Key (10 §3.5): the body is
// encoded like the generated strict server does. Outside the guard there is nothing to store; a lost lease rolls the
// command back (409 idempotency_in_progress, retryable).
func complete(ctx context.Context, tx pgx.Tx, status int, tag string, body any) error {
	if _, ok := idem.FromContext(ctx); !ok {
		return nil
	}
	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(body); err != nil {
		return fmt.Errorf("inspections: outcome: %w", err)
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

// within returns the evaluator and the audience of s reading through tx (authz.TxSource): a command holds one
// connection of the tenant DB at most. A command that holds a row lock and waits for a second connection of the pool
// deadlocks with the commands that hold the rest of the pool waiting for that row (kit.Within of W1.06).
func (s *Service) within(tx pgx.Tx) (Authorizer, inbox.Audience) {
	ev, ok := s.Authz.(*authz.Evaluator)
	if !ok {
		return s.Authz, s.Audience
	}
	cp := *ev
	src := authz.TxSource{Q: tx}
	cp.Source = src
	if ev.Units != nil {
		cp.Units = src
	}
	aud := s.Audience
	if _, ok := aud.(inbox.AuthzAudience); ok {
		aud = inbox.AuthzAudience{E: &cp}
	}
	return &cp, aud
}

// inTx is s with the evaluator and the audience of tx (within).
func (s *Service) inTx(tx pgx.Tx) *Service {
	cp := *s
	cp.Authz, cp.Audience = s.within(tx)
	return &cp
}

// hidden reports whether a denial means «the subject does not see the object».
func hidden(err error) bool {
	return problem.Is(err, problem.CodeNotFound) || problem.Is(err, problem.CodeForbiddenAction) ||
		problem.Is(err, authz.CodeFunctionBlocked)
}

// persons returns the non-nil people of ids (the «own» people of a resource).
func persons(ids ...*uuid.UUID) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		if id != nil && *id != uuid.Nil {
			out = append(out, *id)
		}
	}
	return out
}

// pageLimit is the page size of a list (0 — the default page).
func pageLimit(n int) (int, error) {
	switch {
	case n == 0:
		return defaultPageLimit, nil
	case n < 1 || n > maxPageLimit:
		return 0, problem.New(problem.CodeMalformedRequest, "Размер страницы — от 1 до 200.")
	}
	return n, nil
}

// uuidStrings returns ids as text for a uuid[] parameter.
func uuidStrings(ids []uuid.UUID) []string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		out = append(out, id.String())
	}
	return out
}

// orNil is NULL for the zero UUID.
func orNil(id uuid.UUID) any {
	if id == uuid.Nil {
		return nil
	}
	return id
}
