package files

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/scopeddb"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Page sizes of listFiles (components/common/parameters.yaml#/Limit).
const (
	defaultLimit = 50
	maxLimit     = 200
)

// visibleSQL keeps files that exist for their readers: checked or in check, or uploads whose session is live.
// Files of aborted and expired sessions are gone.
const visibleSQL = `(f.state in ('scanning','ready','rejected') or s.state in ('issued','uploaded'))`

const fileSQL = `select f.id, f.state, f.purpose, f.owner_type, f.owner_id, f.declared_mime, f.bytes,
                        encode(f.sha256, 'hex'), f.created_at, f.object_key
                   from files.objects f left join files.upload_sessions s on s.file_id = f.id
                  where f.id = $1 and ` + visibleSQL

// fileRow is a file with its storage key.
type fileRow struct {
	File
	state, objectKey string
}

func scanFile(row pgx.Row, extra ...any) (fileRow, error) {
	var (
		r                  fileRow
		purpose, ownerType string
		declared           string
		size               *int64
	)
	dest := append([]any{&r.ID, &r.state, &purpose, &ownerType, &r.Owner.ID, &declared, &size, &r.SHA256, &r.CreatedAt}, extra...)
	if err := row.Scan(dest...); err != nil {
		return fileRow{}, err
	}
	r.Purpose = Purpose(purpose)
	r.Owner.Module, r.Owner.Entity, _ = strings.Cut(ownerType, ".")
	r.ContentType, r.FileName = DecodeMIME(declared)
	if size != nil {
		r.SizeBytes = *size
	}
	r.Status = APIStatus(r.state)
	r.CreatedAt = r.CreatedAt.UTC()
	return r, nil
}

// file returns a file the actor may read: its parent is visible and files.read covers it (FILE-03), or a share of
// the parent kind opens the file to him (W2.79). A missing file, a file of another tenant and a file of an invisible
// parent are one not_found (AC-01, AC-02).
func (s *Service) file(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (fileRow, error) {
	pool, err := s.pool(ctx, tc)
	if err != nil {
		return fileRow{}, err
	}
	var key string
	r, err := scanFile(pool.QueryRow(ctx, fileSQL, id), &key)
	r.objectKey = key
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return fileRow{}, problem.New(codeNotFound, "")
	case err != nil:
		return fileRow{}, fmt.Errorf("files: file: %w", err)
	}
	kind, ok := s.kindOf(r.Owner.Kind())
	if !ok { // a parent kind nobody registered: fail closed
		return fileRow{}, problem.New(codeNotFound, "")
	}
	ids := s.closedIDs(tc)
	p, found, err := s.parent(ctx, pool, ids, kind, r.Owner.ID)
	if err != nil {
		return fileRow{}, err
	}
	var denied error = problem.New(codeNotFound, "")
	if found {
		denied = s.permitOnParent(ctx, tc, kind, p, actionRead)
	}
	if denied != nil {
		if !hidden(denied) { // a failure of the check, not a denial: a share does not mask it
			return fileRow{}, denied
		}
		// The parent does not let the subject read the file: a share may (the answer stays the parent's otherwise).
		sp, ok, err := s.shared(ctx, pool, ids, kind, r.Owner.ID, r.ID)
		switch {
		case err != nil:
			return fileRow{}, err
		case !ok:
			return fileRow{}, denied
		}
		p = sp
	}
	if p.title != nil {
		r.OwnerTitle = *p.title
	}
	return r, nil
}

// File returns a file the actor may open (getFile) with the warning of earlier files of the tenant with the same
// bytes (W2.43).
func (s *Service) File(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (File, error) {
	r, err := s.file(ctx, tc, id)
	if err != nil {
		return File{}, err
	}
	pool, err := s.pool(ctx, tc)
	if err != nil {
		return File{}, err
	}
	if r.Duplicate, err = duplicateOf(ctx, pool, r.ID); err != nil {
		return File{}, err
	}
	return r.File, nil
}

// Download issues a short-lived URL of a ready file after the same checks as File, on every request: a revoked
// role gets no new URL (FILE-03, AC-10); issued URLs live DownloadTTL.
func (s *Service) Download(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (Download, error) {
	r, err := s.file(ctx, tc, id)
	if err != nil {
		return Download{}, err
	}
	switch r.state {
	case "ready":
	case "rejected":
		return Download{}, problem.New(codeNotReady, "Файл не прошёл проверку и недоступен.")
	default:
		return Download{}, problem.New(codeNotReady, "Файл ещё проверяется и недоступен для скачивания.")
	}
	st, err := s.store()
	if err != nil {
		return Download{}, err
	}
	url, err := st.PresignGet(r.objectKey, r.FileName, DownloadTTL)
	if err != nil {
		return Download{}, problem.Wrap(codeDependency, err)
	}
	return Download{FileID: r.ID, URL: url, ExpiresAt: s.now().Add(DownloadTTL)}, nil
}

// ListQuery are the parameters of listFiles.
type ListQuery struct {
	Status  string
	Purpose string
	Cursor  string
	Limit   int
}

// Page is a page of listFiles.
type Page struct {
	Items []File
	Next  string
}

// cursor is the position after the last item of a page, bound to the tenant, the subject and the filters.
type cursor struct {
	At   time.Time `json:"t"`
	ID   uuid.UUID `json:"i"`
	Bind string    `json:"b"`
}

func binding(tc tenantctx.TenantContext, q ListQuery) string {
	sum := sha256.Sum256([]byte(tc.TenantID.String() + "|" + tc.PersonID.String() + "|" + q.Status + "|" + q.Purpose))
	return hex.EncodeToString(sum[:8])
}

func (c cursor) encode() string {
	b, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(b)
}

func decodeCursor(raw, bind string) (cursor, error) {
	var c cursor
	b, err := base64.RawURLEncoding.DecodeString(raw)
	if err == nil {
		err = json.Unmarshal(b, &c)
	}
	if err != nil || c.Bind != bind || c.ID == uuid.Nil {
		return cursor{}, problem.New(codeMalformed, "Курсор не подходит к запросу.")
	}
	return c, nil
}

// listParams checks the filters and the page size.
func listParams(q ListQuery) (states []string, limit int, err error) {
	limit = q.Limit
	switch {
	case limit == 0:
		limit = defaultLimit
	case limit < 1 || limit > maxLimit:
		return nil, 0, invalid("Размер страницы — от 1 до 200.")
	}
	if q.Status != "" {
		if states = dbStates(q.Status); len(states) == 0 {
			return nil, 0, invalid("Неизвестный статус файла.")
		}
	}
	if _, ok := allowedMIME[Purpose(q.Purpose)]; q.Purpose != "" && !ok {
		return nil, 0, invalid("Неизвестное назначение файла.")
	}
	return states, limit, nil
}

// List returns the files the actor may open, newest first (listFiles, S1-21): files.read over the parent (scope
// predicate) and the read action of the parent kind — both before pagination, so an invisible parent is absent.
func (s *Service) List(ctx context.Context, tc tenantctx.TenantContext, q ListQuery) (Page, error) {
	states, limit, err := listParams(q)
	if err != nil {
		return Page{}, err
	}
	bind := binding(tc, q)
	args := []any{nil, orNil(q.Purpose), nil, nil, limit + 1}
	if states != nil {
		args[0] = states
	}
	if q.Cursor != "" {
		c, err := decodeCursor(q.Cursor, bind)
		if err != nil {
			return Page{}, err
		}
		args[2], args[3] = c.At, c.ID
	}
	union, parents, args, err := s.parentScope(ctx, tc, args)
	if err != nil || union == "" {
		return Page{Items: []File{}}, err
	}
	conn, err := scopeddb.For(ctx, s.Pools, s.Authz, tc)
	if err != nil {
		return Page{}, err
	}
	// One scope row per file: the first that a scope reading it and files.read cover (the parent or a share).
	sql := `select f.id, f.state, f.purpose, f.owner_type, f.owner_id, f.declared_mime, f.bytes, encode(f.sha256, 'hex'),
	               f.created_at, p.title
	          from files.objects f
	          left join files.upload_sessions s on s.file_id = f.id
	          join lateral (select p.* from (` + union + `) p
	                         where (` + parents + `) and ` + scopeddb.Placeholder + `
	                         order by p.via limit 1) p on true
	         where ` + visibleSQL + `
	           and ($1::text[] is null or f.state = any($1::text[]))
	           and ($2::text is null or f.purpose = $2::text)
	           and ($3::timestamptz is null or (f.created_at, f.id) < ($3::timestamptz, $4::uuid))
	         order by f.created_at desc, f.id desc
	         limit $5`
	rows, err := conn.Query(ctx, actionRead, parentColumns, sql, args...)
	if err != nil {
		return Page{}, fmt.Errorf("files: list: %w", err)
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (File, error) {
		var title *string
		r, err := scanFile(row, &title)
		if title != nil {
			r.OwnerTitle = *title
		}
		return r.File, err
	})
	if err != nil {
		return Page{}, fmt.Errorf("files: list: %w", err)
	}
	page := Page{Items: items}
	if len(items) > limit {
		page.Items = items[:limit]
		last := page.Items[limit-1]
		page.Next = cursor{At: last.CreatedAt, ID: last.ID, Bind: bind}.encode()
	}
	return page, nil
}

// closedParams are the parameters of the placeholders of the closed ids in one statement of parentScope, each bound
// once (the ids read once, on the first scope that compares with them).
type closedParams struct {
	closed            *Closed
	hidden, continued string
}

// bind appends to args the closed ids sc compares with and that are not bound yet.
func (b *closedParams) bind(ctx context.Context, s *Service, tc tenantctx.TenantContext, sc scope, args []any) ([]any, error) {
	if sc.hides() && b.closed == nil {
		c, err := s.closed(ctx, tc)
		if err != nil {
			return nil, err
		}
		b.closed = &c
	}
	if sc.uses(HiddenPlaceholder) && b.hidden == "" {
		args = append(args, b.closed.Hidden)
		b.hidden = "$" + strconv.Itoa(len(args)) + "::uuid[]"
	}
	if sc.uses(ContinuedPlaceholder) && b.continued == "" {
		args = append(args, b.closed.Continued)
		b.continued = "$" + strconv.Itoa(len(args)) + "::uuid[]"
	}
	return args, nil
}

// parentScope builds the lateral union of the scope rows of every registered parent kind and of its shares, each
// row marked with its scope (column via), and the OR of «the subject reads this row» per scope (the read action of the
// scope over the same columns). Scopes the subject reads nowhere are left out; none at all — no file is visible
// (union ""). The ids the Hider closes to the subject are one uuid[] parameter per placeholder, read once and only when
// a scope of the statement compares with it: their parents have no row, so their files are absent before the
// pagination.
func (s *Service) parentScope(ctx context.Context, tc tenantctx.TenantContext, args []any) (union, preds string, out []any, err error) {
	if s.Parents == nil {
		return "", "", args, nil
	}
	var (
		b             closedParams
		unions, parts []string
	)
	for _, key := range s.Parents.Keys() {
		module, entity, _ := strings.Cut(key, ".")
		kind, _ := s.Parents.Kind(module, entity)
		lit := "'" + key + "'" // a registered key: [a-z0-9_-] and one dot (NewParents)
		for _, sc := range kind.scopes() {
			p, err := s.Authz.ScopeQuery(ctx, tc, sc.read, parentColumns, len(args))
			if err != nil {
				return "", "", nil, err
			}
			if p.SQL == "false" {
				continue
			}
			if args, err = b.bind(ctx, s, tc, sc, append(args, p.Args...)); err != nil {
				return "", "", nil, err
			}
			via := strconv.Itoa(len(parts))
			unions = append(unions, "select q.*, "+via+" as via from ("+sc.expand("f.owner_id", "f.id", b.hidden, b.continued)+
				") q where f.owner_type = "+lit)
			parts = append(parts, "(p.via = "+via+" and "+p.SQL+")")
		}
	}
	if len(unions) == 0 {
		return "", "", args, nil
	}
	return strings.Join(unions, " union all "), strings.Join(parts, " or "), args, nil
}
