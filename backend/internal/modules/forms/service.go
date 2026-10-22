package forms

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Pools reaches the database of a tenant (tenantctx.Pools: sentinel-checked, never a fallback database).
type Pools interface {
	For(ctx context.Context, tenantID uuid.UUID) (*pgxpool.Pool, error)
}

// Membership is the membership of a person in the control DB: its status and an active owner binding.
type Membership struct {
	Status string
	Owner  bool
}

// Directory reads the memberships of the people of a tenant from the control DB, by person profile id.
type Directory interface {
	Memberships(ctx context.Context, tenantID uuid.UUID) (map[uuid.UUID]Membership, error)
}

// Tasks is the port of the module of tasks (W4.11): the task of a rule «Создать задачу», created in the transaction
// of the caller on behalf of the author of the rule (Q-W4.05-27).
type Tasks interface {
	// CreateFormTask creates the task t in tx; a refusal of the module (the project is gone, the author may not create
	// tasks there) is TaskResult.Refused, not an error.
	CreateFormTask(ctx context.Context, tx pgx.Tx, tenant uuid.UUID, t FormTask) (TaskResult, error)
	// MayCreate reports whether member (owner — the owner of the business) may create tasks in project.
	MayCreate(ctx context.Context, tx pgx.Tx, tenant, member uuid.UUID, owner bool, project uuid.UUID) (bool, error)
	// Keys are the numbers («LOG-101») of the tasks ids for the journal of a response.
	Keys(ctx context.Context, tx pgx.Tx, tenant uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]string, error)
}

// FormTask is the task of a rule: the project, the author of the rule (and whether he owns the business), the
// assignee, the title, the description (the answers and the response) and the response it comes from.
type FormTask struct {
	Project, Author, Assignee uuid.UUID
	AuthorOwner               bool
	AuthorName                string
	Title, Description        string
	Response                  uuid.UUID
	Origin                    string // «Ответ R-1012 формы «…»» — the line of the history of the task
}

// TaskResult is the task created («LOG-101», the status, the assignee) or the cause of a refusal.
type TaskResult struct {
	ID                    uuid.UUID
	Key, Status, Assigned string
	Refused               string
}

// Knowledge is the port of the knowledge base (W4.31): its pages and tables as a member sees them, and the row or the
// record of the action «Сохранить в Базу знаний» written in the transaction of the caller (Q-W4.05-27).
type Knowledge interface {
	// Nodes are the nodes ids as viewer sees them (missing ones are absent).
	Nodes(ctx context.Context, tx pgx.Tx, tenant uuid.UUID, viewer Viewer, ids []uuid.UUID) (map[uuid.UUID]KBNode, error)
	// Write writes rec on behalf of its author; a refusal (the page or the table is gone, no right) is
	// KBResult.Refused, not an error.
	Write(ctx context.Context, tx pgx.Tx, tenant uuid.UUID, rec KBRecord) (KBResult, error)
}

// Viewer is a member as the knowledge base checks him.
type Viewer struct {
	Member uuid.UUID
	Owner  bool
}

// KBNode is a node of the knowledge base for the forms: its title, whether the viewer sees it, whether every active
// member sees it (the confirmation «Понимаю: записи увидят все сотрудники…»), and its tables.
type KBNode struct {
	ID           uuid.UUID
	Title        string
	Visible      bool
	AllEmployees bool
	Tables       []KBTable
}

// KBTable is a table of a page with the ids of its columns.
type KBTable struct {
	ID      uuid.UUID
	Title   string
	Columns []uuid.UUID
}

// KBRecord is a row (Table set) or a record of a page written for a response.
type KBRecord struct {
	Author     Viewer
	AuthorName string
	Node       uuid.UUID
	Table      uuid.UUID // uuid.Nil — a record on the page
	Bottom     bool      // «В конец»
	Head       string
	Lines      []KBLine
	Cells      map[uuid.UUID]string
	Form       uuid.UUID
	Response   string
	Version    int
	At         time.Time
}

// KBLine is a line of a record.
type KBLine struct{ Name, Value string }

// KBResult is the text of the journal («Строка в таблице «…» · страница «…»») or the cause of a refusal.
type KBResult struct {
	Text, Refused string
}

// Objects is the port of the CRM objects of the answers and of the responses (fleet, tasks): the options a member may
// choose and the objects he sees.
type Objects interface {
	// Options are the objects of kind (vehicle, trip, task, object) tc sees whose label contains q.
	Options(ctx context.Context, tc tenantctx.TenantContext, kind, q string) ([]fapi.FormFieldOption, error)
	// Labels are the labels of the objects of refs tc sees (an invisible or a missing one is absent).
	Labels(ctx context.Context, tc tenantctx.TenantContext, refs []fapi.ObjectRef) (map[fapi.ObjectRef]string, error)
	// Missing are the trips of refs with no row in the tenant of tc, whoever sees them (the other refs are never
	// missing): a response about such a trip is read as MSW reads it (req.sees).
	Missing(ctx context.Context, tc tenantctx.TenantContext, refs []fapi.ObjectRef) ([]fapi.ObjectRef, error)
}

// Purge is what «Хранить ответы» deletes outside the module with the responses (Q-W4.00-forms-22, D-26), in the
// transaction of the deletion: the rows and the records the action «Сохранить в Базу знаний» wrote for them
// (knowledge/forms_port.go) and the files of their answers (files/forms_port.go); cmd/worker adapts both.
type Purge interface {
	// FormRecords deletes in tx the rows and the records of the knowledge base written for the responses numbers
	// («R-0988») of form and returns how many.
	FormRecords(ctx context.Context, tx pgx.Tx, form uuid.UUID, numbers []string) (int, error)
	// FormFiles releases in tx the files ids of the answers of form (the parent forms/form); after, run once tx is
	// committed, removes their bytes from the object storage.
	FormFiles(ctx context.Context, tx pgx.Tx, tenant, form uuid.UUID, ids []uuid.UUID) (after func(context.Context) error, err error)
}

// Keys are the keys of the public links (FORMS_PUBLIC_LINK_KEY by version, Q-W4.05-19) and the current version.
type Keys struct {
	Current int
	ByVer   map[int][]byte
}

func (k Keys) current() ([]byte, int, bool) {
	b, ok := k.ByVer[k.Current]
	return b, k.Current, ok && len(b) >= 32
}

// Service answers the operations of the tags Forms and PublicForms.
type Service struct {
	Pools     Pools
	Directory Directory        // nil: the requesting member is the only active member known
	Tasks     Tasks            // nil: a rule «Создать задачу» fails («Задачи» не подключены)
	Knowledge Knowledge        // nil: a rule «в БЗ» fails, the pages are unknown
	Objects   Objects          // nil: no CRM objects
	Links     Links            // nil: no public links
	Uploads   Uploads          // nil: no uploads of guests
	Purge     Purge            // nil: Retain deletes nothing (never a response without its rows of the knowledge base and files)
	Keys      Keys             // the keys of the public links
	Audience  inbox.Audience   // the audience of the notifications; nil — none
	Now       func() time.Time // the clock of the application (APP_FIXED_NOW outside prod); nil: time.Now
	Random    func([]byte)     // the random part of a nonce; nil: crypto/rand
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

// Problem codes of the contract (api/errors.yaml) the module answers.
const (
	codeValidation = "validation_failed"
	codeTransition = "invalid_transition"
	codeRevision   = "revision_mismatch"
	codeForbidden  = problem.CodeForbiddenAction
	codeNotFound   = problem.CodeNotFound
	codeModule     = "module_not_installed"
	codeExpired    = "public_token_expired"
	codeNonceUsed  = "nonce_used"
)

// Reasons of invalid_transition (api/errors.yaml, W4.05).
const (
	reasonDraftFlow    = "form_draft_flow"
	reasonNotPublished = "form_not_published"
	reasonNoChanges    = "form_no_changes"
	reasonClosed       = "form_closed"
	reasonAnswered     = "form_already_answered"
	reasonGroupFull    = "form_group_not_empty"
	reasonRuleDisabled = "form_rule_disabled"
	reasonRuleDeleted  = "form_rule_deleted"
	reasonNoResponses  = "form_no_responses"
	reasonVersion      = "form_version_changed"
)

// failure is a refusal whose Problem carries more than a code and a detail: the violations of a 422 validation_failed
// or the reason of a 409. The strict server writes it as the typed 422 or 409 of the operation.
type failure struct {
	code, detail, reason string
	violations           []violation
}

func (f *failure) Error() string { return f.code + ": " + f.detail }

// codeInvalid is the code of a violation of a field without its own.
const codeInvalid = "invalid"

// invalid is 422 validation_failed with one violation of field (code invalid unless given).
func invalid(field, message string, code ...string) *failure {
	c := codeInvalid
	if len(code) > 0 {
		c = code[0]
	}
	return &failure{code: codeValidation, detail: message, violations: []violation{{field, c, message}}}
}

// invalidAll is 422 validation_failed with violations; detail — the first message unless given.
func invalidAll(vs []violation, detail string) *failure {
	if detail == "" && len(vs) > 0 {
		detail = vs[0].message
	}
	return &failure{code: codeValidation, detail: detail, violations: vs}
}

// conflict is 409 invalid_transition with a reason and the text.
func conflict(reason, detail string) *failure {
	return &failure{code: codeTransition, detail: detail, reason: reason}
}

func forbidden(detail string) error { return problem.New(codeForbidden, detail) }
func notFound(detail string) error  { return problem.New(codeNotFound, detail) }

func asFailure(err error) (*failure, bool) { return errors.AsType[*failure](err) }

// dependency keeps a failure or a Problem error and reports anything else as dependency_unavailable.
func dependency(err error) error {
	if err == nil {
		return nil
	}
	if _, ok := asFailure(err); ok {
		return err
	}
	if _, ok := errors.AsType[*problem.Error](err); ok {
		return err
	}
	return problem.Wrap(problem.CodeDependencyUnavailable, err)
}

// orMissing is err, or 404 «Форма не найдена» for an acting version that is not there.
func orMissing(err error) error {
	if err != nil {
		return dependency(err)
	}
	return notFound(textFormNotFound)
}

// store wraps a failure of a statement of the module.
func store(what string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("forms: %s: %w", what, err)
}

func noRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// pool is the pool of the tenant of tc.
func (s *Service) pool(ctx context.Context, tenant uuid.UUID) (*pgxpool.Pool, error) {
	if tenant == uuid.Nil {
		return nil, notFound("")
	}
	p, err := s.Pools.For(ctx, tenant)
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return p, nil
}

// run runs fn in one transaction of the tenant DB of tc (read only unless write) with the request of the member; an
// error rolls it back, a failure or a Problem error keeps its code, anything else is dependency_unavailable.
func (s *Service) run(ctx context.Context, tc tenantctx.TenantContext, write bool, fn func(*req) error) error {
	pool, err := s.pool(ctx, tc.TenantID)
	if err != nil {
		return err
	}
	opts := pgx.TxOptions{AccessMode: pgx.ReadOnly, IsoLevel: pgx.RepeatableRead}
	if write {
		opts = pgx.TxOptions{}
	}
	tx, err := pool.BeginTx(ctx, opts)
	if err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }() // after Commit — a no-op
	r := &req{s: s, tc: tc, tx: tx, now: s.now()}
	if err := fn(r); err != nil {
		r.rollback(ctx)
		return dependency(err)
	}
	if err := tx.Commit(ctx); err != nil {
		r.rollback(ctx)
		return dependency(err)
	}
	return nil
}

// rollback undoes what the request wrote outside its transaction (the index of a public link).
func (r *req) rollback(ctx context.Context) {
	for _, u := range r.undo {
		u(context.WithoutCancel(ctx))
	}
}

// probe answers 404 with text before the transaction when the form id does not exist in the tenant — as fast as an
// unknown id of another organization (AC-01); a hidden form answers the same 404 inside.
func (s *Service) probe(ctx context.Context, tenant, id uuid.UUID) error {
	pool, err := s.pool(ctx, tenant)
	if err != nil {
		return err
	}
	var found bool
	if err := pool.QueryRow(ctx, `select exists (select 1 from forms.forms where id = $1)`, id).Scan(&found); err != nil {
		return dependency(err)
	}
	if !found {
		return notFound(textFormNotFound)
	}
	return nil
}

// runOn is run of an operation on the form id of its path.
func (s *Service) runOn(ctx context.Context, tc tenantctx.TenantContext, write bool, id uuid.UUID, fn func(*req) error) error {
	if err := s.probe(ctx, tc.TenantID, id); err != nil {
		return err
	}
	return s.run(ctx, tc, write, fn)
}
