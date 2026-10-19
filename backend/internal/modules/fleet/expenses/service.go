// Package expenses is the expenses of a trip (W2.05, S2-08): the driver records fuel, a wash, parking, a toll road,
// tire service or another cost of his started trip (createTripExpense — a category of the tenant catalogue seeded
// with the six of the answer of the product owner of 17.10 to D-12, W2.41 categories.go; «прочее» needs a comment;
// fines are not driver expenses); the trip card and the shift review read them (listTripExpenses, getTripExpense). An
// expense is not a payment and not an earning (LOG-08, LOG-10); its review is W2.06.
//
// Access follows the trip: fleet.expenses.read or fleet.expenses.create over the unit of the trip or as its driver
// (the visibility of the trip — fleet.trips.read); a member with the work function «Водитель» reaches only his trips.
package expenses

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

// Authorizer is the evaluator of W1.04 (*authz.Evaluator).
type Authorizer interface {
	Permit(ctx context.Context, tc tenantctx.TenantContext, action string, r authz.Resource) error
	ScopeQuery(ctx context.Context, tc tenantctx.TenantContext, action string, c authz.Columns, argStart int) (authz.Predicate, error)
}

var _ Authorizer = (*authz.Evaluator)(nil)

// Service implements the expense operations of the tag Fleet. Every statement goes to the tenant DB of the request
// only (AC-02).
type Service struct {
	Pools Pools
	Authz Authorizer
	Now   func() time.Time // the clock of the application (APP_FIXED_NOW outside prod); nil: time.Now
}

// PageQuery is a page of a list.
type PageQuery struct {
	Cursor string
	Limit  int // 0: the default page
}

// Actions of the module (api/permissions.yaml).
const (
	actionRead      = "fleet.expenses.read"
	actionCreate    = "fleet.expenses.create"
	actionTripsRead = "fleet.trips.read"
)

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

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

// evaluator is the evaluator of s reading through q (authz.TxSource): a command holds one connection at most.
func (s *Service) evaluator(q authz.Querier) Authorizer {
	ev, ok := s.Authz.(*authz.Evaluator)
	if !ok {
		return s.Authz
	}
	cp := *ev
	src := authz.TxSource{Q: q}
	cp.Source = src
	if ev.Units != nil {
		cp.Units = src
	}
	return &cp
}

// trip is the trip of an expense command or read.
type trip struct {
	id, unit uuid.UUID
	number   string
	state    string
	driver   *uuid.UUID
	zone     *time.Location
}

const tripSQL = `
select t.id, t.unit_id, t.number, t.state, t.driver_person_id, u.time_zone
  from fleet.trips t join org.units u on u.id = t.unit_id where t.id = $1`

// readTrip reads trip id through q (lock: for update, the commands of one trip go one by one) and checks action of
// the subject on it: invisible — 404, visible without the right — 403; a member with the driver function reaches only
// his trips.
func (s *Service) readTrip(ctx context.Context, q pgx.Tx, ev Authorizer, tc tenantctx.TenantContext, id uuid.UUID, action string, lock bool) (trip, error) {
	sql := tripSQL
	if lock {
		sql += ` for update of t`
	}
	var (
		t    trip
		zone string
	)
	err := q.QueryRow(ctx, sql, id).Scan(&t.id, &t.unit, &t.number, &t.state, &t.driver, &zone)
	if errors.Is(err, pgx.ErrNoRows) {
		return trip{}, problem.New(problem.CodeNotFound, textTripNotFound)
	}
	if err != nil {
		return trip{}, fmt.Errorf("expenses: trip: %w", err)
	}
	if t.zone, err = time.LoadLocation(zone); err != nil {
		t.zone = time.UTC
	}
	own, err := driverOnly(ctx, q, tc, s.now())
	if err != nil {
		return trip{}, err
	}
	if own && (t.driver == nil || *t.driver != tc.PersonID) {
		return trip{}, problem.New(problem.CodeNotFound, textTripNotFound)
	}
	var persons []uuid.UUID
	if t.driver != nil {
		persons = []uuid.UUID{*t.driver}
	}
	err = ev.Permit(ctx, tc, action, authz.Resource{Unit: t.unit, Persons: persons, ReadAction: actionTripsRead})
	if problem.Is(err, problem.CodeNotFound) {
		return trip{}, problem.New(problem.CodeNotFound, textTripNotFound)
	}
	return t, err
}

// driverOnly reports whether the subject is a member with the work function «Водитель» now.
func driverOnly(ctx context.Context, q pgx.Tx, tc tenantctx.TenantContext, now time.Time) (bool, error) {
	if tc.Owner || tc.PersonID == uuid.Nil {
		return false, nil
	}
	var yes bool
	err := q.QueryRow(ctx, `select exists (select 1 from people.work_profiles
		 where person_id = $1 and function = 'driver' and valid @> $2::timestamptz)`, tc.PersonID, now).Scan(&yes)
	if err != nil {
		return false, fmt.Errorf("expenses: work functions: %w", err)
	}
	return yes, nil
}

// inTx runs fn in one transaction of the tenant DB of tc; an error or a panic of fn rolls it back.
func (s *Service) inTx(ctx context.Context, tc tenantctx.TenantContext, fn func(pgx.Tx) error) error {
	pool, err := s.pool(ctx, tc)
	if err != nil {
		return err
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }() // after Commit — a no-op
	if err := fn(tx); err != nil {
		return dbError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return nil
}

func dbError(err error) error {
	if _, ok := errors.AsType[*problem.Error](err); ok {
		return err
	}
	return problem.Wrap(problem.CodeDependencyUnavailable, err)
}

// complete stores the outcome of a command under an Idempotency-Key (10 §3.5); outside the guard — nothing.
func complete(ctx context.Context, tx pgx.Tx, status int, tag string, body any) error {
	if _, ok := idem.FromContext(ctx); !ok {
		return nil
	}
	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(body); err != nil {
		return fmt.Errorf("expenses: outcome: %w", err)
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

func requestID(ctx context.Context) string {
	if id := requestid.FromContext(ctx); id != "" {
		return id
	}
	return "job-" + uuid.NewString()
}
