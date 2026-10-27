package docs

import (
	"context"
	"encoding/base64"
	"errors"
	"slices"
	"strconv"
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

// Service answers the operations of the tags Docs and PublicDocs.
type Service struct {
	Pools       Pools
	Memberships Memberships      // nil: every person with a membership is an active member, none is an owner
	Relations   Relations        // nil: no objects of repairs (until stage 6)
	Recipients  inbox.Recipients // nil: no notifications
	Audience    inbox.Audience
	Engine      Engine    // the document server behind the adapter (D-32); nil: none, the document opens for viewing
	Blobs       Blobs     // object storage of the files of versions; nil: the bytes of files are not reachable
	Processor   Processor // the programs of the jobs (OCRmyPDF, qpdf, converter); nil: the jobs fail with a hint
	Secrets     Secrets   // the key of the tokens and PINs of external links; nil: a random key per process
	Links       Links     // the control index of external links (control 0011); nil: external links are off
	PublicBase  string    // the origin of the public pages (PUBLIC_BASE_URL); "" — the links are relative
	CallbackURL string    // the absolute URL of docServerCallback the document server calls; "" — derived from PublicBase
	Now         func() time.Time
	NewID       func() uuid.UUID // nil: uuid.New (tests fix ids)
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

func (s *Service) newID() uuid.UUID {
	if s.NewID != nil {
		return s.NewID()
	}
	return uuid.New()
}

// req is one operation of a member: its transaction, the snapshot of the documents, the member and the instant.
type req struct {
	s   *Service
	tc  tenantctx.TenantContext
	tx  pgx.Tx
	w   *world
	me  *member
	now time.Time
}

// probe is the object of the path of an operation: a missing one (another organization's or none) answers 404 with
// the text of the operation before the snapshot is loaded — as fast as an unknown one (AC-01); a hidden one goes on
// to the snapshot and answers the same 404 there.
type probe struct {
	query string // a constant query of the existence of $1
	id    uuid.UUID
	text  string
}

func onDoc(id uuid.UUID) probe {
	return probe{query: `select exists (select 1 from docs.documents where id = $1)`, id: id, text: textDocNotFound}
}

func onFolder(id uuid.UUID) probe {
	return probe{query: `select exists (select 1 from docs.folders where id = $1)`, id: id, text: textFolderNotFound}
}

func onJob(id uuid.UUID) probe {
	return probe{query: `select exists (select 1 from docs.jobs where id = $1)`, id: id, text: textJobNotFound}
}

// run runs fn in one transaction of the tenant DB of tc (read only unless write) over the snapshot.
func (s *Service) run(ctx context.Context, tc tenantctx.TenantContext, write bool, fn func(*req) error) error {
	return s.runOn(ctx, tc, write, probe{}, fn)
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
		w, err := load(ctx, r.tx, tc.TenantID, r.now, s.Memberships, s.Relations)
		if err != nil {
			return err
		}
		r.w = w
		r.me = w.actor(tc)
		return fn(r)
	})
}

// inTx runs fn in one transaction of pool; an error rolls it back, a Problem error keeps its code and anything else
// is dependency_unavailable.
func (s *Service) inTx(ctx context.Context, pool *pgxpool.Pool, tc tenantctx.TenantContext, opts pgx.TxOptions, fn func(*req) error) error {
	tx, err := pool.BeginTx(ctx, opts)
	if err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }() // after Commit — a no-op
	r := &req{s: s, tc: tc, tx: tx, now: s.now()}
	if err := fn(r); err != nil {
		return dependency(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return dependency(err)
	}
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

// dependency keeps a Problem error (with or without violations) and reports anything else as dependency_unavailable
// (the cause stays in the log).
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
	codeValidation  = "validation_failed"
	codeRevision    = "revision_mismatch"
	codeLocked      = "document_locked"
	codeDelegation  = "delegation_exceeds_grant"
	codeQuota       = "quota_exceeded"
	codeTooLarge    = "payload_too_large"
	codeTransition  = "invalid_transition"
	codeJobRunning  = "job_in_progress"
	codeFileLocked  = "file_password_protected"
	codeFunction    = "function_blocked"
	codeTokenGone   = "public_token_expired" //nolint:gosec // G101: an error code of the contract, not a credential
	codeRateLimited = "rate_limited"
	codeConflict    = "conflict"
	codeUnauth      = "session_expired"
)

// fieldsError is a validation_failed with its violation (the field and its code).
type fieldsError struct {
	detail, field, code string
}

func (e *fieldsError) Error() string { return codeValidation + ": " + e.field + ": " + e.detail }

// Unwrap is the Problem of the error without its violation.
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
func locked(detail string) error    { return problem.New(codeLocked, detail) }

// Texts of the answers (the reference, documents.md and the prototype).
const (
	textDocNotFound      = "Документ недоступен"
	textFolderNotFound   = "Папка не найдена"
	textJobNotFound      = "Задание не найдено"
	textCommentNotFound  = "Комментарий не найден"
	textVersionNotFound  = "Версия не найдена"
	textLinkNotFound     = "Ссылка не найдена"
	textWordNotFound     = "Слово не найдено"
	textLocked           = "Документ закрыт для правки: он на маршруте или подписан"
	textNeedEdit         = "Нужен уровень «Правит»"
	textNeedShare        = "Делиться может владелец документа или тот, кто управляет доступом"
	textSameFolder       = "Документ уже в этой папке"
	textNoCreateInFolder = "Нет права создавать документы в этой папке"
	textExternalOwner    = "Внешние ссылки выдаёт владелец бизнеса"
	textResolveRight     = "Закрыть обсуждение может автор комментария или тот, кто правит"
	textFoldersRight     = "Папками управляет владелец бизнеса или роль с правом «Документы · Папки»"
)

// unique reports whether err is a violation of the unique index name.
func unique(err error, name string) bool {
	pe, ok := errors.AsType[*pgconn.PgError](err)
	return ok && pe.Code == "23505" && (name == "" || pe.ConstraintName == name)
}

// etag is the strong validator of a revision.
func etag(rev int64) string { return `"rev-` + strconv.FormatInt(rev, 10) + `"` }

// Page is the cursor and the limit of a list.
type Page struct {
	Cursor *string
	Limit  *int
}

const (
	defaultLimit = 50
	maxLimit     = 200
)

// paginate returns the page of ids after the cursor (the last id of the previous page) and the next cursor.
func paginate(ids []uuid.UUID, p Page) (from, to int, next *string, err error) {
	limit := defaultLimit
	if p.Limit != nil {
		limit = min(max(*p.Limit, 1), maxLimit)
	}
	if p.Cursor != nil && *p.Cursor != "" {
		raw, derr := base64.RawURLEncoding.DecodeString(*p.Cursor)
		id, perr := uuid.FromBytes(raw)
		i := slices.Index(ids, id)
		if derr != nil || perr != nil || i < 0 {
			return 0, 0, nil, problem.New(problem.CodeMalformedRequest, "")
		}
		from = i + 1
	}
	to = min(from+limit, len(ids))
	if to < len(ids) {
		c := base64.RawURLEncoding.EncodeToString(ids[to-1][:])
		next = &c
	}
	return from, to, next, nil
}

// clip is s cut to n characters.
func clip(s string, n int) string {
	rs := []rune(s)
	if len(rs) <= n {
		return s
	}
	return string(rs[:n-1]) + "…"
}

// nullID is NULL for uuid.Nil (nullable references).
func nullID(id uuid.UUID) any {
	if id == uuid.Nil {
		return nil
	}
	return id
}

// doc returns the document id the member sees, 404 «Документ недоступен» otherwise (a missing, foreign, hidden
// document or a finance one for the function driver — the same answer, AC-01).
func (r *req) doc(id uuid.UUID) (*document, rights, error) {
	d := r.w.docs[id]
	if d == nil {
		return nil, rights{}, notFound(textDocNotFound)
	}
	rt := r.w.rightsFor(r.me, d)
	if rt.fn {
		return nil, rights{}, problem.New(codeFunction, "Финансовые документы закрыты для функции «Водитель»")
	}
	if !rt.view {
		return nil, rights{}, notFound(textDocNotFound)
	}
	return d, rt, nil
}

// folder returns the folder id the member sees, 404 otherwise.
func (r *req) folder(id uuid.UUID) (*folder, access, error) {
	f := r.w.folders[id]
	if f == nil {
		return nil, access{}, notFound(textFolderNotFound)
	}
	a := r.w.accessToFolder(r.me, f)
	if a.level == levelNone && !r.w.folderVisible(r.me, f) {
		return nil, access{}, notFound(textFolderNotFound)
	}
	return f, a, nil
}

// folderVisible reports whether m sees f: by its own access or through a document or a subfolder it opens.
func (w *world) folderVisible(m *member, f *folder) bool {
	if w.accessToFolder(m, f).level > 0 {
		return true
	}
	for _, d := range w.docs {
		if w.inFolder(d.folder, f.id) && w.accessToDoc(m, d).level > 0 {
			return true
		}
	}
	return false
}

// inFolder reports whether the folder id is the folder top or lies under it.
func (w *world) inFolder(id, top uuid.UUID) bool {
	return slices.ContainsFunc(w.path(w.folders[id]), func(f *folder) bool { return f.id == top })
}
