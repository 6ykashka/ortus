package branding

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ortus/ortus-crm/backend/internal/control/tenants/operators"
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
)

// ActionUpdated is the audit action of a saved version (actor owner, target the tenant).
const ActionUpdated = "branding.updated"

// Service is the branding over the control DB (role ortus_api) and the public object storage of its files. A version
// is immutable: a save inserts version + 1 under the lock of the tenant row, renames the tenant in the same
// transaction and writes platform_audit from the owner.
type Service struct {
	Control *sql.DB
	Blobs   Blobs            // nil — uploads and public files answer ErrNoStorage
	Now     func() time.Time // the clock of the application; nil — time.Now
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

// queryer is a *sql.DB or *sql.Tx.
type queryer interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

type termJSON struct {
	One    string `json:"one"`
	Plural string `json:"plural"`
	Few    string `json:"few"`
	Many   string `json:"many"`
}

type menuItemJSON struct {
	Label  string `json:"label,omitempty"`
	Icon   string `json:"icon,omitempty"`
	Hidden bool   `json:"hidden,omitempty"`
}

type menuJSON struct {
	Items map[string]menuItemJSON `json:"items"`
	Order []string                `json:"order"`
}

// standard is the standard Ortus branding of a tenant without a saved version (version 1, Q-W4.07-5).
func standard(name string) Branding {
	return Branding{
		Version: 1, DisplayName: name, AccentHex: DefaultAccent, AccentUsed: DefaultAccent, Terms: map[string]Term{},
		Menu: Menu{Items: map[string]MenuItem{}, Order: []string{}}, PoweredBy: true,
	}
}

const currentSQL = `
select t.display_name, v.version, v.short_name, v.accent_hex, v.accent_used, v.logo_file, v.mark_file, v.terms::text, v.menu::text,
       v.powered_by, v.created_at, a.id, a.display_name
  from tenants t
  left join tenant_branding_current v on v.tenant_id = t.id
  left join memberships m on m.id = v.created_by
  left join accounts a on a.id = coalesce(v.created_by_account, m.account_id)
 where t.id = $1`

// current reads the branding in force of a tenant in q (the name is tenants.display_name); ErrNotFound.
func current(ctx context.Context, q queryer, tenantID uuid.UUID) (Branding, error) {
	var (
		name        string
		version     sql.NullInt64
		short       sql.NullString
		hex, used   sql.NullString
		logo, mark  uuid.NullUUID
		terms, menu sql.NullString
		powered     sql.NullBool
		at          sql.NullTime
		authorID    uuid.NullUUID
		author      sql.NullString
	)
	err := q.QueryRowContext(ctx, currentSQL, tenantID).Scan(&name, &version, &short, &hex, &used, &logo, &mark, &terms, &menu, &powered, &at,
		&authorID, &author)
	if errors.Is(err, sql.ErrNoRows) {
		return Branding{}, ErrNotFound
	}
	if err != nil {
		return Branding{}, fmt.Errorf("branding: read: %w", err)
	}
	b := standard(name)
	if !version.Valid {
		return b, nil
	}
	b.Version, b.AccentHex, b.AccentUsed, b.PoweredBy = int(version.Int64), hex.String, used.String, powered.Bool
	if short.Valid {
		b.ShortName = &short.String
	}
	if b.Terms, b.Menu, err = decodeLists(terms.String, menu.String); err != nil {
		return Branding{}, err
	}
	b.UpdatedAt = new(at.Time.UTC())
	b.UpdatedBy = &AccountRef{DisplayName: author.String}
	if authorID.Valid {
		b.UpdatedBy.AccountID = new(authorID.UUID)
	}
	if b.Logo, err = assetOf(ctx, q, logo); err != nil {
		return Branding{}, err
	}
	if b.Mark, err = assetOf(ctx, q, mark); err != nil {
		return Branding{}, err
	}
	return b, nil
}

// decodeLists decodes the terms and the menu of a version.
func decodeLists(terms, menu string) (map[string]Term, Menu, error) {
	var tj map[string]termJSON
	if err := json.Unmarshal([]byte(terms), &tj); err != nil {
		return nil, Menu{}, fmt.Errorf("branding: terms: %w", err)
	}
	out := make(map[string]Term, len(tj))
	for k, t := range tj {
		out[k] = Term(t)
	}
	var mj menuJSON
	if err := json.Unmarshal([]byte(menu), &mj); err != nil {
		return nil, Menu{}, fmt.Errorf("branding: menu: %w", err)
	}
	m := Menu{Items: make(map[string]MenuItem, len(mj.Items)), Order: mj.Order}
	for id, it := range mj.Items {
		m.Items[id] = MenuItem(it)
	}
	if m.Order == nil {
		m.Order = []string{}
	}
	return out, m, nil
}

// encodeLists encodes the terms and the menu of a version.
func encodeLists(terms map[string]Term, menu Menu) (string, string, error) {
	tj := make(map[string]termJSON, len(terms))
	for k, t := range terms {
		tj[k] = termJSON(t)
	}
	mj := menuJSON{Items: make(map[string]menuItemJSON, len(menu.Items)), Order: menu.Order}
	for id, it := range menu.Items {
		mj.Items[id] = menuItemJSON(it)
	}
	ts, err := json.Marshal(tj)
	if err != nil {
		return "", "", fmt.Errorf("branding: terms: %w", err)
	}
	ms, err := json.Marshal(mj)
	if err != nil {
		return "", "", fmt.Errorf("branding: menu: %w", err)
	}
	return string(ts), string(ms), nil
}

// Current is the branding of a tenant in force (getTenantBranding); an unknown tenant is ErrNotFound.
func (s *Service) Current(ctx context.Context, tenantID uuid.UUID) (Branding, error) {
	return current(ctx, s.Control, tenantID)
}

// Update saves the branding as version + 1 (updateTenantBranding): If-Match of the version in force (428 / 412), the
// checks (422), the files of this tenant of the right kind (422); the accent is corrected for contrast; the tenant is
// renamed in the same transaction; branding.updated is audited from the owner.
func (s *Service) Update(ctx context.Context, u Update) (Branding, error) {
	want, err := operators.ParseETag(u.IfMatch)
	if errors.Is(err, operators.ErrRevisionRequired) {
		return Branding{}, ErrRevisionRequired
	}
	if err != nil {
		return Branding{}, ErrRevisionMismatch
	}
	if r := checkUpdate(u); r != nil {
		return Branding{}, r
	}
	u = normalized(u)
	tx, err := s.Control.BeginTx(ctx, nil)
	if err != nil {
		return Branding{}, fmt.Errorf("branding: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var name string
	var version int64
	err = tx.QueryRowContext(ctx, `select t.display_name, coalesce((select max(version) from tenant_branding_versions where tenant_id = t.id), 1)
  from tenants t where t.id = $1 for update of t`, u.Owner.TenantID).Scan(&name, &version)
	if errors.Is(err, sql.ErrNoRows) {
		return Branding{}, ErrNotFound
	}
	if err != nil {
		return Branding{}, fmt.Errorf("branding: lock tenant: %w", err)
	}
	if version != want {
		return Branding{}, ErrRevisionMismatch
	}
	if err := checkFiles(ctx, tx, u); err != nil {
		return Branding{}, err
	}
	if err := s.insert(ctx, tx, u, int(version)+1, name); err != nil {
		return Branding{}, err
	}
	b, err := current(ctx, tx, u.Owner.TenantID)
	if err != nil {
		return Branding{}, err
	}
	if err := tx.Commit(); err != nil {
		return Branding{}, fmt.Errorf("branding: commit: %w", err)
	}
	return b, nil
}

// checkFiles: the logo and the sign are files of this tenant of their kind.
func checkFiles(ctx context.Context, tx *sql.Tx, u Update) error {
	for _, f := range []struct {
		id         *uuid.UUID
		kind, name string
	}{{u.LogoAssetID, KindLogo, "logoAssetId"}, {u.MarkAssetID, KindMark, "markAssetId"}} {
		if f.id == nil {
			continue
		}
		var ok bool
		if err := tx.QueryRowContext(ctx, `select exists (select 1 from branding_assets where id = $1 and tenant_id = $2 and kind = $3)`,
			*f.id, u.Owner.TenantID, f.kind).Scan(&ok); err != nil {
			return fmt.Errorf("branding: file: %w", err)
		}
		if !ok {
			return refusal(f.name, "unknown", "Файл не найден: загрузите его снова")
		}
	}
	return nil
}

// insert writes version of u, renames the tenant when the name changed and audits the save.
func (s *Service) insert(ctx context.Context, tx *sql.Tx, u Update, version int, name string) error {
	terms, menu, err := encodeLists(u.Terms, u.Menu)
	if err != nil {
		return err
	}
	now := s.now()
	if _, err := tx.ExecContext(ctx, `insert into tenant_branding_versions (tenant_id, version, display_name, short_name, accent_hex, accent_used,
  logo_file, mark_file, terms, menu, powered_by, created_by, created_by_account, created_at)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14)`,
		u.Owner.TenantID, version, u.DisplayName, u.ShortName, u.AccentHex, FixAccent(u.AccentHex), u.LogoAssetID, u.MarkAssetID, terms, menu,
		u.PoweredBy, u.Owner.MembershipID, u.Owner.AccountID, now); err != nil {
		return fmt.Errorf("branding: insert version: %w", err)
	}
	if u.DisplayName != name {
		if _, err := tx.ExecContext(ctx, `update tenants set display_name = $2, revision = revision + 1 where id = $1`, u.Owner.TenantID, u.DisplayName); err != nil {
			return fmt.Errorf("branding: rename: %w", err)
		}
	}
	reqID := u.RequestID
	if reqID == "" {
		reqID = requestid.FromContext(ctx)
	}
	if reqID == "" {
		reqID = "branding:" + uuid.NewString()
	}
	return audit.RecordPlatform(ctx, auditExec{tx}, audit.PlatformEvent{
		ActorKind: audit.PlatformOwner, ActorID: u.Owner.AccountID, Action: ActionUpdated, TargetType: "tenant", TargetID: u.Owner.TenantID,
		Result: audit.OK, RequestID: reqID, Details: map[string]any{"version": strconv.Itoa(version)},
	})
}

// auditExec adapts a database/sql transaction to audit.Execer.
type auditExec struct{ db queryer }

func (a auditExec) Exec(ctx context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	res, err := a.db.ExecContext(ctx, query, args...)
	if err != nil {
		return pgconn.CommandTag{}, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return pgconn.CommandTag{}, err
	}
	return pgconn.NewCommandTag("INSERT 0 " + strconv.FormatInt(n, 10)), nil
}

// Marks are the signs of tenants for the operator lists: the short name, the applied accent and the address of the
// sign file; a tenant without a saved version has the standard accent; an unknown one is left out.
func (s *Service) Marks(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]Mark, error) {
	rows, err := s.Control.QueryContext(ctx, `select t.id, coalesce(v.short_name, ''), coalesce(v.accent_used, $2), coalesce(ma.content_type, ''),
       coalesce(encode(ma.sha256, 'hex'), '')
  from tenants t
  left join tenant_branding_current v on v.tenant_id = t.id
  left join branding_assets ma on ma.id = v.mark_file
 where t.id = any($1)`, ids, DefaultAccent)
	if err != nil {
		return nil, fmt.Errorf("branding: marks: %w", err)
	}
	defer rows.Close()
	out := make(map[uuid.UUID]Mark, len(ids))
	for rows.Next() {
		var (
			id                uuid.UUID
			m                 Mark
			contentType, hash string
		)
		if err := rows.Scan(&id, &m.ShortName, &m.AccentUsed, &contentType, &hash); err != nil {
			return nil, fmt.Errorf("branding: marks: %w", err)
		}
		if hash != "" {
			m.MarkURL = publicURL(hash, contentType)
		}
		out[id] = m
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("branding: marks: %w", err)
	}
	return out, nil
}

// Public opens a public file of the branding by its address «<sha256>.<ext>»: the stored content type and the bytes;
// an unknown address is ErrNotFound.
func (s *Service) Public(ctx context.Context, file string) (string, io.ReadCloser, error) {
	hash, contentType, ok := parsePublic(file)
	if !ok {
		return "", nil, ErrNotFound
	}
	var key string
	err := s.Control.QueryRowContext(ctx, `select storage_key from branding_assets where sha256 = decode($1, 'hex') and content_type = $2
 order by created_at limit 1`, hash, contentType).Scan(&key)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil, ErrNotFound
	}
	if err != nil {
		return "", nil, fmt.Errorf("branding: public file: %w", err)
	}
	if s.Blobs == nil {
		return "", nil, ErrNoStorage
	}
	body, err := s.Blobs.Open(ctx, key)
	if err != nil {
		return "", nil, fmt.Errorf("branding: open %s: %w", file, err)
	}
	return contentType, body, nil
}
