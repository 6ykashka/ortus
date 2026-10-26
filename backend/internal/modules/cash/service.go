// Package cash is the server of the tag Cash (W5.31, contract 0.12.0-stage5, tenant 0040–0042): cash accounts of the
// org units (a drawer with shifts, a terminal, an advance of an employee, a safe, a bank account), the append-only
// journal with reversals, shifts reconciled with the Z report and the terminal, transfers «in transit», proposals of
// the modules, advances with receipts, limits of roles and the approval requests over them.
//
// The money moves only in one transaction with the journal row: the balance of an account (cash.accounts.balance_minor)
// changes by the direction and the amount of an operation, a physical account never goes below zero
// (insufficient_funds). A command is whole or not at all (PD-60): a failed step rolls the transaction back. The journal
// is never edited — a mistake is a storno, a link to a source is a row of its own. The KKT is not connected: the receipt
// is entered by hand (the number of the fiscal document and the shift of the KKT).
//
// Access follows the account: the scope «account» (a terminal lies in the area of its drawer), the unit of the account
// and «self» for the holder of an advance. The balance and the expected sums of a shift are shown only with
// cash.balance.read (the holder sees his own advance); limits of roles come from a LimitSource.
package cash

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
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

// Querier is a connection or a transaction of the tenant DB.
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Who is a subject whose limits are asked.
type Who struct {
	Person uuid.UUID
	Owner  bool
}

// LimitSource gives the limits «limit: amount» of the roles of a subject over an account. Role limits have no storage
// in the schema of stage 5 yet (the editor of roles is W5.33), so the default source knows none: an owner and, for now,
// every role act without a limit. A source reads through q, the transaction of the command.
type LimitSource interface {
	Limits(ctx context.Context, q Querier, who Who, accountID uuid.UUID) (Limits, error)
}

// Unlimited is the default LimitSource: nobody has a limit (Q-W5.31-1).
type Unlimited struct{}

// Limits implements LimitSource.
func (Unlimited) Limits(context.Context, Querier, Who, uuid.UUID) (Limits, error) {
	return Limits{}, nil
}

// Service implements the operations of the tag Cash. Every statement goes to the tenant DB of the request only (AC-02).
type Service struct {
	Pools  Pools
	Authz  Authorizer
	Now    func() time.Time // the clock of the application (APP_FIXED_NOW outside prod); nil: time.Now
	Limits LimitSource      // nil: Unlimited
}

// Actions of the module (api/permissions.yaml).
const (
	actionRead        = "cash.read"
	actionBalance     = "cash.balance.read"
	actionPost        = "cash.post"
	actionProposals   = "cash.proposals.post"
	actionShift       = "cash.shift.operate"
	actionRefund      = "cash.refund"
	actionTransfer    = "cash.transfer"
	actionIssue       = "cash.advance.issue"
	actionApprove     = "cash.approve"
	actionReconcile   = "cash.reconcile"
	actionReverse     = "cash.reverse"
	actionPayroll     = "cash.payroll.post"
	actionReports     = "cash.reports.finance"
	actionManage      = "cash.accounts.manage"
	actionPeriodClose = "cash.period.close"
	actionSelf        = "cash.advance.self"
	actionExport      = "cash.export"
)

// accountActions are the actions that make up the rights of the actor over an account (CashAccountMy.rights).
var accountActions = []string{actionRead, actionBalance, actionPost, actionProposals, actionShift, actionRefund,
	actionTransfer, actionIssue, actionApprove, actionReconcile, actionReverse, actionPayroll, actionManage,
	actionSelf, actionExport}

// Audit and outbox names of the module.
const (
	targetAccount  = "cash.account"
	targetOp       = "cash.operation"
	targetShift    = "cash.shift"
	targetTransfer = "cash.transfer"
	targetReceipt  = "cash.advance_receipt"
	targetApproval = "cash.approval"
	targetProposal = "cash.proposal"
)

// Page sizes (common/parameters.yaml Limit).
const (
	defaultPageLimit = 50
	maxPageLimit     = 200
)

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

func (s *Service) limits() LimitSource {
	if s.Limits != nil {
		return s.Limits
	}
	return Unlimited{}
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

// pgCode returns the SQLSTATE and the constraint of a database error.
func pgCode(err error) (code, constraint string) {
	if pe, ok := errors.AsType[*pgconn.PgError](err); ok {
		return pe.Code, pe.ConstraintName
	}
	return "", ""
}

// complete stores the outcome of a command under an Idempotency-Key (10 §3.5); outside the guard — nothing.
func complete(ctx context.Context, tx pgx.Tx, status int, tag string, body any) error {
	if _, ok := idem.FromContext(ctx); !ok {
		return nil
	}
	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(body); err != nil {
		return fmt.Errorf("cash: outcome: %w", err)
	}
	h := http.Header{"Content-Type": {"application/json"}}
	if tag != "" {
		h.Set("ETag", tag)
	}
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

// etag is the strong ETag of a revision, `"rev-N"` as the contract shows it (the mock of the adapter sends and reads the same).
func etag(revision int64) string { return `"rev-` + strconv.FormatInt(revision, 10) + `"` }

// checkRevision compares If-Match with the current revision: missing — 428; anything but the strong ETag — 412.
func checkRevision(ifMatch string, current int64) error {
	switch v := ifMatch; {
	case v == "":
		return problem.New(codeRevisionRequired, "")
	case v != etag(current):
		return problem.New(codeRevisionMismatch, textStale)
	}
	return nil
}

// record writes the audit row of a command: no restricted field, no free text.
func record(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, action, target string, id uuid.UUID, unit *uuid.UUID, reason string, diff map[string]any) error {
	e := audit.Event{ActorKind: audit.ActorPerson, ActorID: tc.PersonID, Action: action, TargetType: target, TargetID: id,
		Result: audit.OK, RequestID: requestID(ctx), Reason: reason, Diff: diff}
	if unit != nil {
		e.UnitID = *unit
	}
	if err := audit.Record(ctx, tx, e); err != nil {
		return fmt.Errorf("cash: audit: %w", err)
	}
	return nil
}

// publish writes an event of the module to the outbox of the transaction.
func publish(ctx context.Context, tx pgx.Tx, typ, aggregate string, id uuid.UUID, payload map[string]any) error {
	if _, err := events.Publish(ctx, tx, events.Event{Type: typ, Aggregate: aggregate, AggregateID: id, Payload: payload}); err != nil {
		return fmt.Errorf("cash: event: %w", err)
	}
	return nil
}

// cursor is the keyset position after the last row of a page.
type cursor struct {
	At time.Time `json:"t"`
	ID uuid.UUID `json:"i"`
}

func encodeCursor(at time.Time, id uuid.UUID) string {
	b, _ := json.Marshal(cursor{At: at.UTC(), ID: id}) // plain fields always marshal
	return base64.RawURLEncoding.EncodeToString(b)
}

func decodeCursor(raw string) (cursor, error) {
	var c cursor
	b, err := base64.RawURLEncoding.DecodeString(raw)
	if err == nil {
		err = json.Unmarshal(b, &c)
	}
	if err != nil || c.ID == uuid.Nil {
		return cursor{}, problem.New(problem.CodeMalformedRequest, "Курсор не подходит к запросу.")
	}
	return c, nil
}

// PageQuery is a page of a list.
type PageQuery struct {
	Cursor string
	Limit  int // 0: the default page
}

// size resolves the page size of q.
func (q PageQuery) size() (int, error) {
	switch limit := q.Limit; {
	case limit == 0:
		return defaultPageLimit, nil
	case limit < 1 || limit > maxPageLimit:
		return 0, problem.New(problem.CodeMalformedRequest, "Размер страницы — от 1 до 200.")
	default:
		return limit, nil
	}
}

// page resolves the page size and the keyset position of q.
func (q PageQuery) page() (limit int, at any, after uuid.UUID, err error) {
	if limit, err = q.size(); err != nil {
		return 0, nil, uuid.Nil, err
	}
	if q.Cursor != "" {
		c, err := decodeCursor(q.Cursor)
		if err != nil {
			return 0, nil, uuid.Nil, err
		}
		return limit, c.At, c.ID, nil
	}
	return limit, nil, uuid.Nil, nil
}

func trimCurrency(c string) string {
	for len(c) > 0 && c[len(c)-1] == ' ' {
		c = c[:len(c)-1]
	}
	return c
}
