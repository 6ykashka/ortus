package kit

import (
	"context"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/scopeddb"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Scoped reads rows under the scope predicate of an action in place of {{scope}}: scopeddb.Conn outside a command,
// TxScope inside the transaction of a command (the response of a command is read in its transaction, so that its
// outcome is stored with the effect — Complete).
type Scoped interface {
	Query(ctx context.Context, action string, cols authz.Columns, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, action string, cols authz.Columns, sql string, args ...any) pgx.Row
}

var _ Scoped = (*scopeddb.Conn)(nil)

// TxScope is Scoped over a transaction, with the same rule as scopeddb: exactly one {{scope}}, its arguments after
// those of the statement.
type TxScope struct {
	Tx pgx.Tx
	Ev *authz.Evaluator
	TC tenantctx.TenantContext
}

func (s TxScope) build(ctx context.Context, action string, cols authz.Columns, sql string, args []any) (string, []any, error) {
	if strings.Count(sql, scopeddb.Placeholder) != 1 {
		return "", nil, scopeddb.ErrNoScope
	}
	p, err := s.Ev.ScopeQuery(ctx, s.TC, action, cols, len(args))
	if err != nil {
		return "", nil, err
	}
	return strings.Replace(sql, scopeddb.Placeholder, "("+p.SQL+")", 1), slices.Concat(args, p.Args), nil
}

// Query implements Scoped.
func (s TxScope) Query(ctx context.Context, action string, cols authz.Columns, sql string, args ...any) (pgx.Rows, error) {
	q, all, err := s.build(ctx, action, cols, sql, args)
	if err != nil {
		return nil, err
	}
	return s.Tx.Query(ctx, q, all...)
}

// QueryRow implements Scoped.
func (s TxScope) QueryRow(ctx context.Context, action string, cols authz.Columns, sql string, args ...any) pgx.Row {
	q, all, err := s.build(ctx, action, cols, sql, args)
	if err != nil {
		return errRow{err}
	}
	return s.Tx.QueryRow(ctx, q, all...)
}

type errRow struct{ err error }

func (r errRow) Scan(...any) error { return r.err }
