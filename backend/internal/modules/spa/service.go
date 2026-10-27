package spa

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/modules/inventory" //nolint:depguard // W5.20: the stock core of the same stage (the consumption port, Q-W5.20-2)
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
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

// Stock is the consumption port of the warehouse: the issue of the materials of a visit in the transaction of the
// completion (*inventory.Service). Q-W5.20-2: the port is the package of the stock itself until a registry of ports exists.
type Stock interface {
	Consume(ctx context.Context, tx pgx.Tx, ev inventory.Authorizer, tc tenantctx.TenantContext, c inventory.Consumption) (uuid.UUID, error)
}

var _ Stock = (*inventory.Service)(nil)

// VisitOffer is what a completed visit proposes to the cash desks: money for the visit by the fact (CASH-03).
type VisitOffer struct {
	AppointmentID uuid.UUID
	Title         string
	AmountMinor   int64
}

// CashOffers is the output port to the proposals of the cash desks (cash.Service.Offer behind an adapter in cmd/api).
// An offer repeated is dropped by the cash desk (key «visit:<id>»). Nil: the visit proposes nothing.
type CashOffers interface {
	OfferVisit(ctx context.Context, tx pgx.Tx, o VisitOffer) error
}

// Service implements the tag Spa. Every statement goes to the tenant DB of the request only (AC-02).
type Service struct {
	Pools  Pools
	Authz  Authorizer
	Stock  Stock
	Offers CashOffers       // nil: no proposal to the cash desks
	Now    func() time.Time // the clock of the application (APP_FIXED_NOW outside prod); nil: time.Now
}

// PageQuery is a page of a list.
type PageQuery struct {
	Cursor string
	Limit  int // 0: the default page
}

// AppointmentQuery are the parameters of listAppointments.
type AppointmentQuery struct {
	PageQuery
	Status       string // "": every status
	From, To     *time.Time
	Practitioner *uuid.UUID
}

// Actions of the module (api/permissions.yaml).
const (
	actServicesRead   = "spa.services.read"
	actServicesManage = "spa.services.manage"
	actApptRead       = "spa.appointments.read"
	actApptCreate     = "spa.appointments.create"
	actApptPerform    = "spa.appointments.perform"
	actApptComplete   = "spa.appointments.complete"
)

// Page sizes (common/parameters.yaml Limit).
const (
	defaultPageLimit = 50
	maxPageLimit     = 200
)

// Problem codes of the module (api/errors.yaml).
const (
	codeValidation       = "validation_failed"
	codeInvalidTransit   = "invalid_transition"
	codeUnavailable      = "resources_unavailable"
	codeIdemInProgress   = "idempotency_in_progress"
	codeRevisionRequired = "revision_required"
	codeRevisionMismatch = "revision_mismatch"
)

// Reasons of invalid_transition (api/errors.yaml): the cause of a refusal inside the code.
const (
	ReasonNotInStatus       = "not_in_status"
	ReasonInsufficientStock = "insufficient_stock"
	ReasonLotExpired        = "lot_expired"
)

// Targets of audit rows and aggregates of events.
const (
	targetService     = "spa.service"
	targetAppointment = "spa.appointment"
	moduleKey         = "spa"
	typeAppointment   = "appointment"
	defaultCurrency   = "RUB"
)

// RefusalError is a refusal whose Problem carries more than a code and a detail: the reason of a 409 invalid_transition,
// the field of a 422 validation_failed or the fields of a 409 resources_unavailable. The strict server writes it as the
// typed answer of the operation.
type RefusalError struct {
	Code   string
	Detail string
	Reason string
	Field  string
	Fields []string // resources_unavailable: the fields of the request that are taken
}

func (f *RefusalError) Error() string { return f.Code + ": " + f.Detail }

func invalid(field, detail string) *RefusalError {
	return &RefusalError{Code: codeValidation, Detail: detail, Field: field}
}

func conflict(reason, detail string) *RefusalError {
	return &RefusalError{Code: codeInvalidTransit, Detail: detail, Reason: reason}
}

func unavailable(detail string, fields ...string) *RefusalError {
	return &RefusalError{Code: codeUnavailable, Detail: detail, Fields: fields}
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
		return fmt.Errorf("spa: outcome: %w", err)
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

func recordAudit(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, action, target string, id, unit uuid.UUID, reason string, diff map[string]any) error {
	err := audit.Record(ctx, tx, audit.Event{ActorKind: audit.ActorPerson, ActorID: tc.PersonID, Action: action, TargetType: target,
		TargetID: id, UnitID: unit, Result: audit.OK, Reason: reason, RequestID: requestID(ctx), Diff: diff})
	if err != nil {
		return fmt.Errorf("spa: audit: %w", err)
	}
	return nil
}

func tenant(ctx context.Context) (tenantctx.TenantContext, error) {
	tc, ok := tenantctx.FromContext(ctx)
	if !ok {
		return tenantctx.TenantContext{}, problem.New(problem.CodeNotFound, "")
	}
	return tc, nil
}

// isUnique reports whether err is a violation of a unique index.
func isUnique(err error) bool {
	pe, ok := errors.AsType[*pgconn.PgError](err)
	return ok && pe.Code == "23505"
}

// isOverlap reports whether err is the exclusion of overlapping reservations (reservations_no_overlap).
func isOverlap(err error) bool {
	pe, ok := errors.AsType[*pgconn.PgError](err)
	return ok && pe.Code == "23P01"
}

// etag is the strong ETag of a revision, "rev-<n>" as the other modules (Q-W2.41-1).
func etag(revision int64) string { return `"rev-` + strconv.FormatInt(revision, 10) + `"` }

// revisionOf reads the revision of an If-Match: «rev-<n>» with or without quotes.
func revisionOf(ifMatch string) (int64, bool) {
	v := strings.TrimSpace(ifMatch)
	v = strings.TrimPrefix(v, "W/")
	v = strings.Trim(v, `"`)
	n, ok := strings.CutPrefix(v, "rev-")
	if !ok {
		return 0, false
	}
	rev, err := strconv.ParseInt(n, 10, 64)
	return rev, err == nil && rev > 0
}

const textStale = "Данные изменились. Обновите страницу и повторите."

// checkRevision compares the If-Match with the revision of the object: none — 428, another — 412.
func checkRevision(ifMatch string, revision int64) error {
	want, ok := revisionOf(ifMatch)
	switch {
	case strings.TrimSpace(ifMatch) == "":
		return problem.New(codeRevisionRequired, "")
	case !ok || want != revision:
		return problem.New(codeRevisionMismatch, textStale)
	}
	return nil
}

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

// pageOf reads the size and the offset of a page.
func pageOf(q PageQuery) (limit, off int, err error) {
	if limit, err = limitOf(q); err != nil {
		return 0, 0, err
	}
	off, err = decodeCursor(q.Cursor)
	return limit, off, err
}
