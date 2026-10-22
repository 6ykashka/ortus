package files

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Pools reaches tenant DBs (tenantctx.Pools).
type Pools interface {
	For(ctx context.Context, tenantID uuid.UUID) (*pgxpool.Pool, error)
}

// Authorizer is the evaluator of W1.04 (authz.Evaluator).
type Authorizer interface {
	Permit(ctx context.Context, tc tenantctx.TenantContext, action string, r authz.Resource) error
	ScopeQuery(ctx context.Context, tc tenantctx.TenantContext, action string, c authz.Columns, argStart int) (authz.Predicate, error)
}

// Closed are the ids a Hider closes to a subject.
type Closed struct {
	// Hidden are closed entirely: the parents whose rows compare with HiddenPlaceholder leave them out.
	Hidden []uuid.UUID
	// Continued are left only to finish a started work: the parents of new work on them (ContinuedPlaceholder) are out.
	Continued []uuid.UUID
}

// Hider names the objects closed to the subject of tc whatever his grants say (W2.57, AC-06, D09: cmd/api wires the
// driver pool — the trips of the transfers of a temporary driver outside his grant, and the trips in their
// continuation).
type Hider interface {
	Closed(ctx context.Context, tc tenantctx.TenantContext) (Closed, error)
}

// Service implements the operations of the module. Every statement goes to the tenant DB of the request only
// (AC-02); rows of parents are read through their kind (Parents) and checked with the evaluator.
type Service struct {
	Pools   Pools
	Authz   Authorizer
	Store   storage.Store // nil: storage not configured — uploads and downloads answer dependency_unavailable
	Parents *Parents
	Hidden  Hider            // nil: nothing is hidden
	Now     func() time.Time // nil: time.Now (sessions use the wall clock, never APP_FIXED_NOW)
}

// closed returns the ids the Hider closes to the subject of tc (never nil slices: an empty uuid[] keeps every
// parent). Only a kind that compares with a placeholder asks it (ParentKind.hides): it reads the DB.
func (s *Service) closed(ctx context.Context, tc tenantctx.TenantContext) (Closed, error) {
	c := Closed{}
	if s.Hidden != nil {
		var err error
		if c, err = s.Hidden.Closed(ctx, tc); err != nil {
			return Closed{}, err
		}
	}
	if c.Hidden == nil {
		c.Hidden = []uuid.UUID{}
	}
	if c.Continued == nil {
		c.Continued = []uuid.UUID{}
	}
	return c, nil
}

// closedIDs reads the ids the Hider closes to the subject at most once per request: the parent of a file and its
// shares compare with the same ids.
type closedIDs struct {
	s  *Service
	tc tenantctx.TenantContext
	c  *Closed
}

func (s *Service) closedIDs(tc tenantctx.TenantContext) *closedIDs { return &closedIDs{s: s, tc: tc} }

func (o *closedIDs) get(ctx context.Context) (Closed, error) {
	if o.c == nil {
		c, err := o.s.closed(ctx, o.tc)
		if err != nil {
			return Closed{}, err
		}
		o.c = &c
	}
	return *o.c, nil
}

// placeholders binds the placeholders sc uses to parameters after args: the uuid[] expressions for scope.expand
// (empty when unused) and the args with the closed ids.
func placeholders(sc scope, c Closed, args []any) (hidden, continued string, out []any) {
	if sc.uses(HiddenPlaceholder) {
		args = append(args, c.Hidden)
		hidden = "$" + strconv.Itoa(len(args)) + "::uuid[]"
	}
	if sc.uses(ContinuedPlaceholder) {
		args = append(args, c.Continued)
		continued = "$" + strconv.Itoa(len(args)) + "::uuid[]"
	}
	return hidden, continued, args
}

// Actions of the module (api/permissions.yaml, core.files).
const (
	actionRead   = "files.read"
	actionUpload = "files.upload"
)

// gone is the detail of a session that is missing, foreign, expired or aborted (getUploadSession/not_found).
const gone = "Загрузка не найдена или истекла."

// Ticket is the answer of initiateUpload (UploadTicket).
type Ticket struct {
	UploadID, FileID uuid.UUID
	URL              string
	ContentType      string
	SHA256           string
	ExpiresAt        time.Time
	MaxBytes         int64
}

// Session is an upload session of the actor (UploadSession).
type Session struct {
	ID, FileID       uuid.UUID
	State            string
	Purpose          Purpose
	Owner            Ref
	SizeBytes        int64
	ReservedBytes    int64
	TicketExpiresAt  time.Time
	SessionExpiresAt time.Time
	CreatedAt        time.Time
	FileStatus       string
}

// File is a file with its parent (File, FileListItem).
type File struct {
	ID          uuid.UUID
	FileName    string
	ContentType string
	SizeBytes   int64
	SHA256      string
	Status      string
	CreatedAt   time.Time
	Purpose     Purpose
	Owner       Ref
	OwnerTitle  string
	Duplicate   *Duplicate // completeUpload, getFile: earlier files of the tenant with the same bytes (W2.43)
}

// Duplicate is the warning of earlier files of the tenant with the same sha256 (FileDuplicateWarning, W2.43): what
// they are is never disclosed — they may be outside the scope of the actor.
type Duplicate struct {
	FirstSeenAt   time.Time
	PreviousCount int64
	SameOwner     bool
}

// Download is a short-lived URL of a ready file (DownloadTicket).
type Download struct {
	FileID    uuid.UUID
	URL       string
	ExpiresAt time.Time
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

func (s *Service) pool(ctx context.Context, tc tenantctx.TenantContext) (*pgxpool.Pool, error) {
	if tc.TenantID == uuid.Nil {
		return nil, problem.New(codeNotFound, "")
	}
	return s.Pools.For(ctx, tc.TenantID)
}

// store returns the object storage or dependency_unavailable when it is not configured.
func (s *Service) store() (storage.Store, error) {
	if s.Store == nil {
		return nil, problem.Wrap(codeDependency, errors.New("files: object storage is not configured (S3_ENDPOINT)"))
	}
	return s.Store, nil
}

// querier is what a pool and a transaction share.
type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// parentColumns are the columns of the scope row of a parent (ParentKind.Rows) aliased p.
var parentColumns = authz.Columns{
	Unit:    "p.unit_id",
	Objects: map[string]string{authz.KindProject: "p.project_id"},
	Persons: []string{"p.person_a", "p.person_b"},
}

// parentRow is the scope row of a parent.
type parentRow struct {
	unit, project, personA, personB *uuid.UUID
	title                           *string
}

// resource is the authz resource of the parent; read is the action that makes it visible.
func (p parentRow) resource(read string) authz.Resource {
	r := authz.Resource{ReadAction: read}
	if p.unit != nil {
		r.Unit = *p.unit
	}
	if p.project != nil {
		r.Objects = map[string]uuid.UUID{authz.KindProject: *p.project}
	}
	for _, id := range []*uuid.UUID{p.personA, p.personB} {
		if id != nil {
			r.Persons = append(r.Persons, *id)
		}
	}
	return r
}

// kindOf returns the registered kind of an owner_type («module.entity»).
func (s *Service) kindOf(ownerType string) (ParentKind, bool) {
	module, entity, ok := strings.Cut(ownerType, ".")
	if !ok || s.Parents == nil {
		return ParentKind{}, false
	}
	return s.Parents.Kind(module, entity)
}

// parent reads the scope row of a parent for the subject of tc — for the file it holds (nil: an upload, no file yet);
// ok is false when the parent does not exist in this tenant or the Hider closes it, or that file, to the subject.
func (s *Service) parent(ctx context.Context, q querier, ids *closedIDs, kind ParentKind, id uuid.UUID, file *uuid.UUID) (parentRow, bool, error) {
	return scopeRow(ctx, q, ids, kind.Key(), kind.own(), id, file)
}

// scopeRow reads the scope row sc selects for the parent id and the file (FilePlaceholder: the file read through the
// parent, for the parent itself and for a share alike; nil — null, an upload) for the subject of tc; ok is false when
// there is no row.
func scopeRow(ctx context.Context, q querier, ids *closedIDs, key string, sc scope, id uuid.UUID, file *uuid.UUID) (parentRow, bool, error) {
	args, fileExpr := []any{id}, ""
	if sc.uses(FilePlaceholder) {
		args = append(args, file)
		fileExpr = "$2::uuid"
	}
	var hidden, continued string
	if sc.hides() {
		closed, err := ids.get(ctx)
		if err != nil {
			return parentRow{}, false, err
		}
		hidden, continued, args = placeholders(sc, closed, args)
	}
	var p parentRow
	err := q.QueryRow(ctx, sc.expand("$1", fileExpr, hidden, continued), args...).
		Scan(&p.unit, &p.project, &p.personA, &p.personB, &p.title)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return parentRow{}, false, nil
	case err != nil:
		return parentRow{}, false, fmt.Errorf("files: parent %s: %w", key, err)
	}
	return p, true, nil
}

// shared returns the scope row of the first share of kind that opens file of the parent id to the subject of tc:
// its read action and files.read cover the row. ok is false when no share does; a denial of a share is not an error.
func (s *Service) shared(ctx context.Context, q querier, ids *closedIDs, kind ParentKind, id, file uuid.UUID) (parentRow, bool, error) {
	tc := ids.tc
	for _, sc := range kind.shares() {
		p, found, err := scopeRow(ctx, q, ids, kind.Key(), sc, id, &file)
		if err != nil {
			return parentRow{}, false, err
		}
		if !found {
			continue
		}
		res := p.resource(sc.read)
		err = s.Authz.Permit(ctx, tc, sc.read, res)
		if err == nil {
			err = s.Authz.Permit(ctx, tc, actionRead, res)
		}
		switch {
		case err == nil:
			return p, true, nil
		case !hidden(err):
			return parentRow{}, false, err
		}
	}
	return parentRow{}, false, nil
}

// hidden reports whether a denial means «the subject does not see the object».
func hidden(err error) bool {
	return problem.Is(err, codeNotFound) || problem.Is(err, codeForbidden) || problem.Is(err, codeFunctionDeny)
}

// permitOnParent checks action on a parent: an invisible parent is not_found (the file does not exist for the
// subject, its parent is never revealed — AC-01), a visible one without action is 403 forbidden_action.
func (s *Service) permitOnParent(ctx context.Context, tc tenantctx.TenantContext, kind ParentKind, p parentRow, action string) error {
	res := p.resource(kind.ReadAction)
	if err := s.Authz.Permit(ctx, tc, kind.ReadAction, res); err != nil {
		if hidden(err) {
			return problem.New(codeNotFound, "")
		}
		return err
	}
	return s.Authz.Permit(ctx, tc, action, res)
}

// permitUpload checks files.upload on the parent of owner (initiateUpload, and again in completeUpload): an unknown
// kind, a missing or an invisible parent is not_found, a visible one without files.upload is 403.
func (s *Service) permitUpload(ctx context.Context, q querier, tc tenantctx.TenantContext, owner Ref) error {
	kind, ok := s.Parents.Kind(owner.Module, owner.Entity)
	if !ok {
		return problem.New(codeNotFound, "")
	}
	p, found, err := s.parent(ctx, q, s.closedIDs(tc), kind, owner.ID, nil)
	switch {
	case err != nil:
		return err
	case !found:
		return problem.New(codeNotFound, "")
	}
	return s.permitOnParent(ctx, tc, kind, p, actionUpload)
}

// inTx runs fn in one transaction of pool.
func inTx(ctx context.Context, pool *pgxpool.Pool, fn func(pgx.Tx) error) error {
	return pgx.BeginFunc(ctx, pool, fn)
}

// orNil is a NULL for an empty string.
func orNil(s string) any {
	if s == "" {
		return nil
	}
	return s
}
