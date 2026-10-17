package trips

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
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

// Service implements the trip operations of the tag Fleet. Every statement goes to the tenant DB of the request
// only (AC-02).
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

// PlanQuery are the parameters of listTripPlans.
type PlanQuery struct {
	Cursor string
	Limit  int      // 0: the default page
	States []string // TripState values; empty: any
	Unit   uuid.UUID
	Driver uuid.UUID // person of the driver; uuid.Nil: any
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

// inTx is s with the evaluator and the audience reading through tx (authz.TxSource, as W2.02 and W2.04): a command
// holds one connection of the tenant DB at most, so parallel commands on a small pool queue instead of deadlocking.
func (s *Service) inTx(tx pgx.Tx) *Service {
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
	if err == nil {
		return nil
	}
	if _, ok := errors.AsType[*problem.Error](err); ok {
		return err
	}
	return problem.Wrap(problem.CodeDependencyUnavailable, err)
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

// driverOnly reports whether the subject is a member with the work function «Водитель» now: such a member sees and
// drives only the trips where he is the driver, whatever fleet.trips.read grants him (TripPlan, D22 of the prototype).
func driverOnly(ctx context.Context, q querier, tc tenantctx.TenantContext, now time.Time) (bool, error) {
	if tc.Owner || tc.PersonID == uuid.Nil {
		return false, nil
	}
	var yes bool
	err := q.QueryRow(ctx, `select exists (select 1 from people.work_profiles
		 where person_id = $1 and function = 'driver' and valid @> $2::timestamptz)`, tc.PersonID, now).Scan(&yes)
	if err != nil {
		return false, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return yes, nil
}
