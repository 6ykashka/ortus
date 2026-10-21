package knowledge

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Pools reaches the database of a tenant (tenantctx.Pools: sentinel-checked, never a fallback database).
type Pools interface {
	For(ctx context.Context, tenantID uuid.UUID) (*pgxpool.Pool, error)
}

// Service answers the operations of the tag Knowledge.
type Service struct {
	Pools       Pools
	Memberships Memberships      // nil: every person with a membership is an active member, none is an owner
	Relations   Relations        // nil: no objects of repairs (until stage 6, Q-W4.04-1)
	Recipients  inbox.Recipients // nil: no notifications
	Audience    inbox.Audience
	Now         func() time.Time // the clock of the application (APP_FIXED_NOW outside prod); nil: time.Now
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

// req is one operation of a member: its transaction, the snapshot of the knowledge base, the member and the instant.
type req struct {
	s   *Service
	tc  tenantctx.TenantContext
	tx  pgx.Tx
	w   *world
	me  *member
	now time.Time
	wr  writer
}

// run runs fn in one transaction of the tenant DB of tc (read only unless write) over the snapshot of the knowledge
// base; an error rolls it back, a Problem error keeps its code and anything else is dependency_unavailable.
func (s *Service) run(ctx context.Context, tc tenantctx.TenantContext, write bool, fn func(*req) error) error {
	return s.runOn(ctx, tc, write, probe{}, fn)
}

// probe is the object of the path of an operation: a missing one (another organization's or none) answers 404 with
// the text of the operation before the snapshot of the organization is loaded — as fast as an unknown one (AC-01);
// a hidden one goes on to the snapshot and answers the same 404 there.
type probe struct {
	query string // a constant query of the existence of $1
	id    uuid.UUID
	text  string
}

func onNode(id uuid.UUID) probe {
	return probe{query: `select exists (select 1 from kb.nodes where id = $1)`, id: id, text: textNodeNotFound}
}

func onSpace(id uuid.UUID) probe {
	return probe{query: `select exists (select 1 from kb.spaces where id = $1)`, id: id, text: textSpaceNotFound}
}

func onRequest(id uuid.UUID) probe {
	return probe{query: `select exists (select 1 from kb.requests where id = $1)`, id: id, text: textRequestNotFound}
}

func onRule(id uuid.UUID) probe {
	return probe{query: `select exists (select 1 from kb.rules where id = $1)`, id: id, text: textRuleNotFound}
}

// runOn is run of an operation on the object p of its path.
func (s *Service) runOn(ctx context.Context, tc tenantctx.TenantContext, write bool, p probe, fn func(*req) error) error {
	if tc.TenantID == uuid.Nil {
		return problem.New(problem.CodeNotFound, "")
	}
	pool, err := s.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	// One round trip before the transaction: an object deleted after it answers the same 404 inside.
	if p.query != "" {
		var found bool
		if err := pool.QueryRow(ctx, p.query, p.id).Scan(&found); err != nil {
			return dependency(err)
		}
		if !found {
			return notFound(p.text)
		}
	}
	opts := pgx.TxOptions{AccessMode: pgx.ReadOnly, IsoLevel: pgx.RepeatableRead}
	if write {
		opts = pgx.TxOptions{}
	}
	return s.inTx(ctx, pool, tc, opts, func(r *req) error {
		if err := r.load(ctx); err != nil {
			return err
		}
		r.me = r.w.actor(tc)
		return fn(r)
	})
}

// inTx runs fn in one transaction of pool with the request of tc at the clock of the application (the snapshot is
// not loaded yet); an error rolls it back, a Problem error keeps its code and anything else is dependency_unavailable.
func (s *Service) inTx(ctx context.Context, pool *pgxpool.Pool, tc tenantctx.TenantContext, opts pgx.TxOptions, fn func(*req) error) error {
	tx, err := pool.BeginTx(ctx, opts)
	if err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }() // after Commit — a no-op
	r := &req{s: s, tc: tc, tx: tx, now: s.now()}
	r.wr = writer{ex: func(ctx context.Context, sql string, args ...any) error {
		_, err := tx.Exec(ctx, sql, args...)
		return err
	}}
	if err := fn(r); err != nil {
		return dependency(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return dependency(err)
	}
	return nil
}

// load reads the snapshot of the knowledge base of the tenant of r in its transaction.
func (r *req) load(ctx context.Context) error {
	w, err := load(ctx, r.tx, r.tc.TenantID, r.now, r.s.Memberships, r.s.Relations)
	if err != nil {
		return err
	}
	r.w = w
	return nil
}

// actor is the member of tc: a member with the tenant context of the gateway is active, and owner is the binding of
// the context (the control DB decides it).
func (w *world) actor(tc tenantctx.TenantContext) *member {
	m := w.member[tc.PersonID]
	if m == nil {
		m = &member{id: tc.PersonID, name: w.names[tc.PersonID]}
		w.addMember(m)
	}
	m.status, m.owner = memberActive, tc.Owner
	return m
}

// dependency keeps a Problem error (with or without violations) and reports anything else as
// dependency_unavailable (the cause stays in the log).
func dependency(err error) error {
	if _, ok := errors.AsType[*fieldsError](err); ok {
		return err
	}
	if _, ok := errors.AsType[*problem.Error](err); ok {
		return err
	}
	return problem.Wrap(problem.CodeDependencyUnavailable, err)
}

// Problem codes of the contract (api/errors.yaml) the module answers.
const (
	codeValidation = "validation_failed"
	codeConflict   = "revision_mismatch"
	codePending    = "request_pending"
	codeDelegation = "delegation_exceeds_grant"
)

// fieldsError is a validation_failed with its violations (the field and its code).
type fieldsError struct {
	detail, field, code string
}

func (e *fieldsError) Error() string { return codeValidation + ": " + e.field + ": " + e.detail }

// Unwrap is the Problem of the error without its violations (an operation that does not answer them still answers
// 422 with the detail).
func (e *fieldsError) Unwrap() error { return problem.New(codeValidation, e.detail) }

// invalid is a validation_failed of field with its message (code invalid unless given).
func invalid(field, message string, code ...string) error {
	c := "invalid"
	if len(code) > 0 {
		c = code[0]
	}
	return &fieldsError{detail: message, field: field, code: c}
}

func failed(detail string) error    { return problem.New(codeValidation, detail) }
func forbidden(detail string) error { return problem.New(problem.CodeForbiddenAction, detail) }
func notFound(detail string) error  { return problem.New(problem.CodeNotFound, detail) }

// Texts of the answers (the reference and the domain W4.30).
const (
	textNodeNotFound    = "Страница не найдена или недоступна"
	textSpaceNotFound   = "Пространство не найдено"
	textRequestNotFound = "Запрос не найден или уже решён"
	textRuleNotFound    = "Правило не найдено"
	textLeadOnly        = "Это может руководитель пространства или владелец бизнеса"
	textArchiveRight    = "Архивировать может редактор или руководитель пространства"
	textDepth           = "Не больше шести уровней вложенности"
	textCreateSpace     = "Создавать пространства может владелец бизнеса или роль с правом «База знаний · Настраивать»"
	textDelegation      = "Нельзя выдать больше, чем есть у вас: нет права назначать эту роль в этой области."
)

// unique reports whether err is a violation of the unique index name.
func unique(err error, name string) bool {
	pe, ok := errors.AsType[*pgconn.PgError](err)
	return ok && pe.Code == "23505" && (name == "" || pe.ConstraintName == name)
}

// node returns the node id the member sees, 404 «Страница не найдена или недоступна» otherwise (a missing, foreign,
// hidden, archived for a reader or finance node for the driver — the same answer).
func (r *req) node(id uuid.UUID) (*node, error) {
	n := r.w.nodeOf(id)
	if n == nil || !r.w.access(r.me, n).view {
		return nil, notFound(textNodeNotFound)
	}
	return n, nil
}

// space returns the space id the member sees, 404 «Пространство не найдено» otherwise.
func (r *req) space(id uuid.UUID) (*space, error) {
	sp := r.w.space[id]
	if sp == nil || !r.w.spaceVisible(r.me, sp) {
		return nil, notFound(textSpaceNotFound)
	}
	return sp, nil
}

// lead requires the member to lead sp (the lead of the space or the owner of the business).
func (r *req) lead(sp *space) error {
	if !r.w.spaceMy(r.me, sp).lead {
		return forbidden(textLeadOnly)
	}
	return nil
}

// acc is the access of the member to n.
func (r *req) acc(n *node) access { return r.w.access(r.me, n) }
