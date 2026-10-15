// Package scopeddb is how tenant modules read and change rows of their tenant DB: every statement carries the
// scope predicate of the evaluator (scopeQuery, W1.04) in place of {{scope}}, before pagination and aggregation
// (design/docs/14-engineering.md:111 «каждый запрос tenant-модуля принимает предикат scopeQuery; ревью отклоняет
// запросы без него»). A statement without exactly one {{scope}} is refused, so the predicate cannot be forgotten.
//
// A foreign object and an object that does not exist go through the same statement and give the same no-row
// answer (One → not_found): AC-01 «404, время ответа не различается заметно».
package scopeddb

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Placeholder marks where the scope predicate goes in a statement.
const Placeholder = "{{scope}}"

// ErrNoScope is returned for a statement without exactly one Placeholder.
var ErrNoScope = errors.New("scopeddb: the statement must contain exactly one " + Placeholder)

// Scoper builds scope predicates (authz.Evaluator).
type Scoper interface {
	ScopeQuery(ctx context.Context, tc tenantctx.TenantContext, action string, c authz.Columns, argStart int) (authz.Predicate, error)
}

// Pools reaches tenant DBs (tenantctx.Pools).
type Pools interface {
	For(ctx context.Context, tenantID uuid.UUID) (*pgxpool.Pool, error)
}

// querier is what a pool and a transaction share.
type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Conn is the tenant DB of one request, scoped to its subject.
type Conn struct {
	pool   *pgxpool.Pool // nil inside InTx
	q      querier
	scoper Scoper
	tc     tenantctx.TenantContext
}

// For returns the scoped connection of the tenant of tc (the pool of its tenant only: AC-02).
func For(ctx context.Context, pools Pools, scoper Scoper, tc tenantctx.TenantContext) (*Conn, error) {
	pool, err := pools.For(ctx, tc.TenantID)
	if err != nil {
		return nil, err
	}
	return &Conn{pool: pool, q: pool, scoper: scoper, tc: tc}, nil
}

// build puts the scope predicate of action over cols in place of {{scope}}; its arguments follow args.
func (c *Conn) build(ctx context.Context, action string, cols authz.Columns, sql string, args []any) (string, []any, error) {
	if strings.Count(sql, Placeholder) != 1 {
		return "", nil, ErrNoScope
	}
	p, err := c.scoper.ScopeQuery(ctx, c.tc, action, cols, len(args))
	if err != nil {
		return "", nil, err
	}
	return strings.Replace(sql, Placeholder, "("+p.SQL+")", 1), slices.Concat(args, p.Args), nil
}

// Query runs sql with the scope of action over cols in place of {{scope}}; args are numbered before the
// predicate's.
func (c *Conn) Query(ctx context.Context, action string, cols authz.Columns, sql string, args ...any) (pgx.Rows, error) {
	sql, all, err := c.build(ctx, action, cols, sql, args)
	if err != nil {
		return nil, err
	}
	return c.q.Query(ctx, sql, all...)
}

// QueryRow is Query for one row.
func (c *Conn) QueryRow(ctx context.Context, action string, cols authz.Columns, sql string, args ...any) pgx.Row {
	sql, all, err := c.build(ctx, action, cols, sql, args)
	if err != nil {
		return errRow{err}
	}
	return c.q.QueryRow(ctx, sql, all...)
}

// Exec runs a statement (an update or a delete limited by the scope of action).
func (c *Conn) Exec(ctx context.Context, action string, cols authz.Columns, sql string, args ...any) (pgconn.CommandTag, error) {
	sql, all, err := c.build(ctx, action, cols, sql, args)
	if err != nil {
		return pgconn.CommandTag{}, err
	}
	return c.q.Exec(ctx, sql, all...)
}

// One scans the single row of a scoped query; no row is not_found — the same for a foreign and a missing id.
func (c *Conn) One(ctx context.Context, action string, cols authz.Columns, scan func(pgx.Row) error, sql string, args ...any) error {
	err := scan(c.QueryRow(ctx, action, cols, sql, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		return problem.New(problem.CodeNotFound, "")
	}
	return err
}

// InTx runs fn in one transaction of the tenant DB with the same scope; an error or a panic of fn rolls it back
// and returns the connection to the pool.
func (c *Conn) InTx(ctx context.Context, fn func(*Conn) error) error {
	if c.pool == nil {
		return errors.New("scopeddb: nested transaction")
	}
	tx, err := c.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("scopeddb: begin: %w", err)
	}
	// After Commit the rollback is a no-op (pgx.ErrTxClosed); it also runs when fn panics.
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := fn(&Conn{q: tx, scoper: c.scoper, tc: c.tc}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// errRow is a row whose Scan returns err.
type errRow struct{ err error }

func (r errRow) Scan(...any) error { return r.err }
