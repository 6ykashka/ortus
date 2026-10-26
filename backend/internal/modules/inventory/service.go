package inventory

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

// Service implements the tag Inventory. Every statement goes to the tenant DB of the request only (AC-02).
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

// BalanceQuery are the parameters of listInventoryBalances.
type BalanceQuery struct {
	PageQuery
	WarehouseID  *uuid.UUID
	ItemID       *uuid.UUID
	BelowMinimum *bool
}

// ReservationQuery are the parameters of listInventoryReservations.
type ReservationQuery struct {
	PageQuery
	WarehouseID *uuid.UUID
	Status      string // "": every status
}

// Actions of the module (api/permissions.yaml).
const (
	actItemsRead         = "inventory.items.read"
	actItemsManage       = "inventory.items.manage"
	actWarehousesManage  = "inventory.warehouses.manage"
	actMovementsRead     = "inventory.movements.read"
	actMovementsPost     = "inventory.movements.post"
	actConsumptionChange = "inventory.consumption.override"
	kindWarehouse        = authz.KindWarehouse
)

// Page sizes (common/parameters.yaml Limit).
const (
	defaultPageLimit = 50
	maxPageLimit     = 200
)

// Problem codes of the module (api/errors.yaml).
const (
	codeValidation        = "validation_failed"
	codeInvalidTransition = "invalid_transition"
	codeIdemInProgress    = "idempotency_in_progress"
	codeRevisionRequired  = "revision_required"
	codeRevisionMismatch  = "revision_mismatch"
)

// Kinds of movements and directions of adjustments (InventoryMovementCreate), and a key of audit and event payloads.
const (
	kindReceipt    = "receipt"
	kindIssue      = "issue"
	kindTransfer   = "transfer"
	kindAdjustment = "adjustment"
	kindReversal   = "reversal"
	dirIncrease    = "increase"
	dirDecrease    = "decrease"
	keyWarehouse   = "warehouseId"
)

// alloc sets *p to a new T and returns it: a field of a type of the runtime of the generator (openapi_types.Date) is
// set without naming it — depguard keeps that runtime out of internal/modules.
func alloc[T any](p **T) *T {
	*p = new(T)
	return *p
}

// dateField is the time of a date field of the generated types (openapi_types.Date embeds time.Time), nil for nil,
// cut to the day.
func dateField[D ~struct{ time.Time }](d *D) *time.Time {
	if d == nil {
		return nil
	}
	t := dateOf(struct{ time.Time }(*d).Time)
	return &t
}

// Reasons of invalid_transition (api/errors.yaml, W5.00).
const (
	ReasonInsufficientStock    = "insufficient_stock"
	ReasonLotExpired           = "lot_expired"
	ReasonReservationNotActive = "reservation_not_active"
)

// RefusalError is a refusal whose Problem carries more than a code and a detail: the reason of a 409 invalid_transition
// or the field of a 422 validation_failed. The strict server writes it as the typed answer of the operation.
type RefusalError struct {
	Code   string
	Detail string
	Reason string
	Field  string
}

func (f *RefusalError) Error() string { return f.Code + ": " + f.Detail }

func invalid(field, detail string) *RefusalError {
	return &RefusalError{Code: codeValidation, Detail: detail, Field: field}
}

func conflict(reason, detail string) *RefusalError {
	return &RefusalError{Code: codeInvalidTransition, Detail: detail, Reason: reason}
}

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

// inTx runs fn in one transaction of the tenant DB of tc; an error or a panic of fn rolls it back.
func (s *Service) inTx(ctx context.Context, tc tenantctx.TenantContext, fn func(pgx.Tx, Authorizer) error) error {
	pool, err := s.pool(ctx, tc)
	if err != nil {
		return err
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }() // after Commit a no-op
	if err := fn(tx, s.evaluator(tx)); err != nil {
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
	if _, ok := errors.AsType[*RefusalError](err); ok {
		return err
	}
	return problem.Wrap(problem.CodeDependencyUnavailable, err)
}

// complete stores the outcome of a command under an Idempotency-Key (10 §3.5); outside the guard nothing.
func complete(ctx context.Context, tx pgx.Tx, status int, tag string, body any) error {
	if _, ok := idem.FromContext(ctx); !ok {
		return nil
	}
	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(body); err != nil {
		return fmt.Errorf("inventory: outcome: %w", err)
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

// etag is the strong ETag of a revision, "rev-<n>" as the other modules (Q-W2.41-1).
func etag(revision int64) string { return `"rev-` + strconv.FormatInt(revision, 10) + `"` }

// limitOf validates the page size.
func limitOf(q PageQuery) (int, error) {
	switch {
	case q.Limit == 0:
		return defaultPageLimit, nil
	case q.Limit < 1 || q.Limit > maxPageLimit:
		return 0, problem.New(problem.CodeMalformedRequest, "Размер страницы — от 1 до 200.")
	}
	return q.Limit, nil
}

// offsetCursor is the position of a page: the number of rows already returned of an ordered list (the lists of the
// module are short and ordered by stable keys).
type offsetCursor struct {
	Off int `json:"o"`
}

func encodeCursor(off int) string {
	b, _ := json.Marshal(offsetCursor{Off: off}) // a plain struct always marshals
	return base64.RawURLEncoding.EncodeToString(b)
}

func decodeCursor(raw string) (int, error) {
	if raw == "" {
		return 0, nil
	}
	var c offsetCursor
	b, err := base64.RawURLEncoding.DecodeString(raw)
	if err == nil {
		err = json.Unmarshal(b, &c)
	}
	if err != nil || c.Off < 0 {
		return 0, problem.New(problem.CodeMalformedRequest, "Курсор не подходит к запросу.")
	}
	return c.Off, nil
}

// paged cuts rows (limit+1 fetched from offset) to a page and the cursor of the next one.
func paged[T any](rows []T, off, limit int) ([]T, *string) {
	if len(rows) <= limit {
		return rows, nil
	}
	next := encodeCursor(off + limit)
	return rows[:limit], &next
}
