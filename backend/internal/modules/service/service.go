// Package service is the server of the tags Service and PublicService (W7.31, contract 0.12.0-stage7, tenant 0062,
// control 0011): the requests of the clients of a business — complaints, claims, questions, ideas, thanks, warranty
// and cargo cases — in the directions (МАС, КОС, ОТД, ГРЗ), each a service project of «Задачи».
//
// The terms are counted in the working minutes of the calendar of the direction (the first reply, the resolution) and
// in calendar days (the legal term, never paused); «Ждёт клиента» pauses the first two. The right is asked with the
// direction as the object (PD-53): the project of the direction is the scope «project»; a direction the member does not
// see and a complaint about the member are 404 like a missing id. A command is whole or not at all (PD-60): a failed
// step rolls the transaction back. A phone of a client leaves the module as a mask; the whole number — only by
// revealServiceClientPhone (service.clients.contacts) with an audit record, or to the author of a request by a call.
//
// The client has no account: the personal link carries a token the server does not keep (sha256:hex in the tenant
// and in the control index public_service_tokens), the page of a direction is found by its slug (public_service_slugs).
package service

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
	ScopeQuery(ctx context.Context, tc tenantctx.TenantContext, action string, c authz.Columns, argStart int) (authz.Predicate, error)
}

var _ Authorizer = (*authz.Evaluator)(nil)

// Querier is a connection or a transaction of the tenant DB.
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Member is a person of the business as the control DB knows him: whether he works now and owns the business.
type Member struct{ Active, Owner bool }

// Directory reads the memberships of the people of a tenant from the control DB.
type Directory interface {
	Memberships(ctx context.Context, tenantID uuid.UUID) (map[uuid.UUID]Member, error)
}

// Service implements the operations of the tags Service and PublicService. Every statement goes to the tenant DB of
// the request only (AC-02); the public operations find it by the index of the control DB.
type Service struct {
	Pools     Pools
	Authz     Authorizer
	Directory Directory      // nil: nobody owns the business (tests of the pure rules)
	Tasks     TaskPort       // nil: «＋ Задача» and the creation of a direction answer 503
	Projects  ProjectPort    // nil: a direction is created over a project given by the caller of the port
	Cash      CashPort       // nil: a refund is a record in the request only (Q-W4.00-service-6)
	Audience  inbox.Audience // nil: no notifications
	Index     Index          // the control index of the portal (tokens, slugs); nil: the portal answers 503
	Now       func() time.Time
}

// Actions of the module (api/permissions.yaml).
const (
	actRead         = "service.requests.read"
	actCreate       = "service.requests.create"
	actReply        = "service.requests.reply"
	actResolve      = "service.requests.resolve"
	actManage       = "service.directions.manage"
	actContacts     = "service.clients.contacts"
	actCompensation = "service.compensation.manage"
	actReports      = "service.reports.read"
	actStaff        = "service.reports.staff"
)

// Codes of the Problem (api/errors.yaml).
const (
	codeValidation       = "validation_failed"
	codeTransition       = "invalid_transition"
	codeForbidden        = problem.CodeForbiddenAction
	codeNotFound         = problem.CodeNotFound
	codeMismatch         = "revision_mismatch"
	codeRequired         = "revision_required"
	codeOutOfScope       = "service_assignee_out_of_scope"
	codeExpired          = "public_token_expired"
	codeIdemInProgress   = "idempotency_in_progress"
	codeConflict         = "conflict"
	codeUnavailable      = problem.CodeDependencyUnavailable
	codeTooLarge         = "payload_too_large"
	textStale            = "Запись изменилась: обновите страницу и повторите."
	textRequestNotFound  = "Обращение не найдено"
	textDirectionMissing = "Направление не найдено"
)

// Audit and outbox names of the module.
const (
	targetRequest   = "service.request"
	targetDirection = "service.direction"
	targetRating    = "service.rating"

	evCreated      = "service.request.created.v1"
	evReplied      = "service.request.replied.v1"
	evResolved     = "service.request.resolved.v1"
	evReopened     = "service.request.reopened.v1"
	evClosed       = "service.request.closed.v1"
	evAssigned     = "service.request.assigned.v1"
	evMoved        = "service.request.moved.v1"
	evWarning      = "service.request.sla_warning.v1"
	evBreached     = "service.request.sla_breached.v1"
	evEscalated    = "service.request.sla_escalated.v1"
	evCompensation = "service.compensation.proposed.v1"
	evConclusion   = "service.conclusion.shared.v1"
	evSurvey       = "service.survey.answered.v1"
	evDirection    = "service.direction.published.v1"
	aggRequest     = "service.request"
	aggDirection   = "service.direction"
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

func (s *Service) pool(ctx context.Context, tenantID uuid.UUID) (*pgxpool.Pool, error) {
	if tenantID == uuid.Nil {
		return nil, problem.New(codeNotFound, "")
	}
	p, err := s.Pools.For(ctx, tenantID)
	if err != nil {
		return nil, problem.Wrap(codeUnavailable, err)
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

// req is one request of the module: the actor, the transaction of the tenant DB and the evaluator over it.
type req struct {
	s    *Service
	tc   tenantctx.TenantContext
	tx   pgx.Tx
	ev   Authorizer
	now  time.Time
	undo []func(context.Context)
}

// run runs fn in one transaction of the tenant DB of tc; an error or a panic of fn rolls it back.
func (s *Service) run(ctx context.Context, tc tenantctx.TenantContext, fn func(*req) error) error {
	pool, err := s.pool(ctx, tc.TenantID)
	if err != nil {
		return err
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return problem.Wrap(codeUnavailable, err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }() // after Commit — a no-op
	r := &req{s: s, tc: tc, tx: tx, ev: s.evaluator(tx), now: s.now()}
	if err := fn(r); err != nil {
		for _, u := range r.undo {
			u(context.WithoutCancel(ctx))
		}
		return dbError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		for _, u := range r.undo {
			u(context.WithoutCancel(ctx))
		}
		return problem.Wrap(codeUnavailable, err)
	}
	return nil
}

func dbError(err error) error {
	if _, ok := errors.AsType[*problem.Error](err); ok {
		return err
	}
	return problem.Wrap(codeUnavailable, err)
}

func store(what string, err error) error {
	if err == nil {
		return nil
	}
	if _, ok := errors.AsType[*problem.Error](err); ok {
		return err
	}
	return fmt.Errorf("service: %s: %w", what, err)
}

func noRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// pgCode returns the SQLSTATE and the constraint of a database error.
func pgCode(err error) (code, constraint string) {
	if pe, ok := errors.AsType[*pgconn.PgError](err); ok {
		return pe.Code, pe.ConstraintName
	}
	return "", ""
}

const pgUnique = "23505"

func invalid(detail string) *problem.Error { return problem.New(codeValidation, detail) }

func notFound(detail string) *problem.Error { return problem.New(codeNotFound, detail) }

func forbidden(detail string) *problem.Error { return problem.New(codeForbidden, detail) }

func conflict(detail string) *problem.Error { return problem.New(codeTransition, detail) }

// complete stores the outcome of a command under an Idempotency-Key (10 §3.5); outside the guard — nothing.
func complete(ctx context.Context, tx pgx.Tx, status int, tag string, body any) error {
	if _, ok := idem.FromContext(ctx); !ok {
		return nil
	}
	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(body); err != nil {
		return fmt.Errorf("service: outcome: %w", err)
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
		return problem.Wrap(codeUnavailable, err)
	}
	return nil
}

func requestID(ctx context.Context) string {
	if id := requestid.FromContext(ctx); id != "" {
		return id
	}
	return "job-" + uuid.NewString()
}

// etag is the strong ETag of a revision, `"rev-N"` as the contract shows it.
func etag(revision int64) string { return `"rev-` + strconv.FormatInt(revision, 10) + `"` }

// checkRevision compares If-Match with the current revision: missing — 428; anything but the strong ETag — 412.
func checkRevision(ifMatch string, current int64) error {
	switch v := ifMatch; {
	case v == "":
		return problem.New(codeRequired, "")
	case v != etag(current):
		return problem.New(codeMismatch, textStale)
	}
	return nil
}

// record writes the audit row of a command: no restricted field, no free text.
func (r *req) record(ctx context.Context, action, target string, id uuid.UUID, sensitivity string, diff map[string]any) error {
	e := audit.Event{ActorKind: audit.ActorPerson, ActorID: r.tc.PersonID, Action: action, TargetType: target, TargetID: id,
		Sensitivity: sensitivity, Result: audit.OK, RequestID: requestID(ctx), Diff: diff}
	if r.tc.PersonID == uuid.Nil {
		e.ActorKind = audit.ActorService
	}
	if err := audit.Record(ctx, r.tx, e); err != nil {
		return fmt.Errorf("service: audit: %w", err)
	}
	return nil
}

// publish writes an event of the module to the outbox of the transaction.
func (r *req) publish(ctx context.Context, typ, aggregate string, id uuid.UUID, payload map[string]any) (uuid.UUID, error) {
	ev, err := events.Publish(ctx, r.tx, events.Event{Type: typ, Aggregate: aggregate, AggregateID: id, Payload: payload})
	if err != nil {
		return uuid.Nil, fmt.Errorf("service: event: %w", err)
	}
	return ev, nil
}

// notify queues a notification to a person in the transaction (inbox.Enqueue checks the recipient); without an
// Audience nothing is queued. A notice carries no phone and no text of a client.
func (r *req) notify(ctx context.Context, to uuid.UUID, n inbox.Notice) error {
	if r.s.Audience == nil || to == uuid.Nil {
		return nil
	}
	tc := tenantctx.TenantContext{TenantID: r.tc.TenantID, PersonID: to}
	if _, _, err := inbox.Enqueue(ctx, r.tx, r.s.Audience, tc, n); err != nil {
		return store("notice "+n.Kind, err)
	}
	return nil
}

// cursor is the position after the last row of a page.
type cursor struct {
	N int `json:"n"`
}

func encodeCursor(n int) string {
	b, _ := json.Marshal(cursor{N: n}) // plain fields always marshal
	return base64.RawURLEncoding.EncodeToString(b)
}

func decodeCursor(raw string) (int, error) {
	var c cursor
	b, err := base64.RawURLEncoding.DecodeString(raw)
	if err == nil {
		err = json.Unmarshal(b, &c)
	}
	if err != nil || c.N < 0 {
		return 0, problem.New(problem.CodeMalformedRequest, "Курсор не подходит к запросу.")
	}
	return c.N, nil
}

// PageQuery is a page of a list.
type PageQuery struct {
	Cursor string
	Limit  int // 0: the default page
}

// window resolves the offset and the size of the page.
func (q PageQuery) window() (offset, limit int, err error) {
	switch l := q.Limit; {
	case l == 0:
		limit = defaultPageLimit
	case l < 1 || l > maxPageLimit:
		return 0, 0, problem.New(problem.CodeMalformedRequest, "Размер страницы — от 1 до 200.")
	default:
		limit = l
	}
	if q.Cursor != "" {
		if offset, err = decodeCursor(q.Cursor); err != nil {
			return 0, 0, err
		}
	}
	return offset, limit, nil
}

// pageOf cuts the page [offset, offset+limit) out of n items and returns the cursor of the next one ("" — the last).
func pageOf(offset, limit, n int) (from, to int, next *string) {
	from = min(offset, n)
	to = min(from+limit, n)
	if to < n {
		c := encodeCursor(to)
		next = &c
	}
	return from, to, next
}
