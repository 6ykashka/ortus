package docs

import (
	"context"
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	dapi "github.com/ortus/ortus-crm/backend/internal/api/docs"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// An external link of a document (docs.links, documents.md §3.1 and Q-W4.00-documents-4): the term is at most 30 days
// (DOC-06), the PIN is on by default, the watermark is on, downloads are off. The token is not stored but derived —
// base64url without padding of HMAC-SHA256(DOCS_LINK_KEY, «ortus.docs.link.v1» 0x00 tenant id 0x00 link id); the
// databases keep its digest «sha256:» + hex SHA-256 (the control index and the tenant) and the PIN only as a hash.
const (
	linkLabel   = "ortus.docs.link.v1"
	linkMaxDays = 30
	linkDefault = 14 * 24 * time.Hour
	pinDigits   = 6
	pinTries    = 5                // wrong PINs in pinWindow lock the link
	pinWindow   = 15 * time.Minute // the window of the count of wrong PINs
	pinRounds   = 120_000
)

// Link is a row of the control index of external links (public_doc_links).
type Link struct {
	Digest     string
	Tenant     uuid.UUID
	Document   uuid.UUID
	ID         uuid.UUID
	KeyVersion int
	Expires    time.Time
	Revoked    bool
}

// Links is the control index of external links: token digest → tenant, document, link (control 0011).
type Links interface {
	Issue(ctx context.Context, l Link) error
	Drop(ctx context.Context, digest string) error
	Revoke(ctx context.Context, digest string, at time.Time) error
	// Find returns the link of a working tenant by the digest of the token; false — none (404 for a guest).
	Find(ctx context.Context, digest string) (Link, bool, error)
}

var (
	processKey     []byte
	processKeyOnce sync.Once
)

// linkKey is the key of tokens and PINs: the secret of the module, or a random key of the process (tests).
func (s *Service) linkKey() []byte {
	if s.Secrets != nil {
		if k := s.Secrets.LinkKey(); len(k) >= 32 {
			return k
		}
	}
	processKeyOnce.Do(func() {
		processKey = make([]byte, 32)
		_, _ = rand.Read(processKey)
	})
	return processKey
}

// linkToken derives the token of the link of tenant.
func linkToken(key []byte, tenant, link uuid.UUID) string {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(linkLabel + "\x00" + tenant.String() + "\x00" + link.String()))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

// tokenDigest is the digest of a token (docs.links.token_digest, public_doc_links.token_digest).
func tokenDigest(token string) string {
	sum := sha256.Sum256([]byte(token))
	return "sha256:" + hex.EncodeToString(sum[:])
}

// newPIN is a random PIN of pinDigits digits.
func newPIN() (string, error) {
	limit := new(big.Int).Exp(big.NewInt(10), big.NewInt(pinDigits), nil)
	n, err := rand.Int(rand.Reader, limit)
	if err != nil {
		return "", fmt.Errorf("docs: pin: %w", err)
	}
	return fmt.Sprintf("%0*d", pinDigits, n.Int64()), nil
}

// hashPIN is the stored form of a PIN of a link: PBKDF2-HMAC-SHA256 with a salt of the link id and a pepper of the
// key of the module («pbkdf2-sha256$rounds$hex»).
func hashPIN(key []byte, link uuid.UUID, pin string) (string, error) {
	salt := append(append([]byte{}, link[:]...), key[:16]...)
	h, err := pbkdf2.Key(sha256.New, pin, salt, pinRounds, 32)
	if err != nil {
		return "", fmt.Errorf("docs: pin hash: %w", err)
	}
	return fmt.Sprintf("pbkdf2-sha256$%d$%s", pinRounds, hex.EncodeToString(h)), nil
}

// checkPIN compares a PIN with the stored hash in constant time.
func checkPIN(key []byte, link uuid.UUID, pin, stored string) bool {
	got, err := hashPIN(key, link, pin)
	return err == nil && subtle.ConstantTimeCompare([]byte(got), []byte(stored)) == 1
}

// linkStatus is the state of a link at now.
func linkStatus(revoked *time.Time, expires, now time.Time) dapi.DocExternalLinkStatus {
	switch {
	case revoked != nil:
		return dapi.DocExternalLinkStatusRevoked
	case !now.Before(expires):
		return dapi.DocExternalLinkStatusExpired
	}
	return dapi.DocExternalLinkStatusActive
}

// links reads the links of a document (or only the link one) with the count and the last moment of the openings.
func (r *req) links(ctx context.Context, doc, one uuid.UUID) ([]dapi.DocExternalLink, error) {
	rows, err := r.tx.Query(ctx, `select l.id, l.level, l.expires_at, l.pin_hash is not null, l.watermark, l.download,
		coalesce(l.created_by, `+nilUUID+`), l.created_at, l.revoked_at,
		(select count(*) from docs.link_opens o where o.link_id = l.id and not o.pin_failed),
		(select max(o.opened_at) from docs.link_opens o where o.link_id = l.id and not o.pin_failed)
		from docs.links l where l.document_id = $1 and ($2::uuid is null or l.id = $2) order by l.created_at, l.id`, doc, nullID(one))
	if err != nil {
		return nil, fmt.Errorf("docs: links: %w", err)
	}
	defer rows.Close()
	out := []dapi.DocExternalLink{}
	for rows.Next() {
		var (
			l       dapi.DocExternalLink
			by      uuid.UUID
			revoked *time.Time
			count   int64
			last    *time.Time
		)
		if err := rows.Scan(&l.Id, &l.Level, &l.ExpiresAt, &l.Pin, &l.Watermark, &l.Download, &by, &l.CreatedAt, &revoked, &count, &last); err != nil {
			return nil, fmt.Errorf("docs: links: %w", err)
		}
		l.ExpiresAt, l.CreatedAt, l.CreatedBy = instant(l.ExpiresAt), instant(l.CreatedAt), r.memberRef(by)
		l.OpenCount, l.Status = count, linkStatus(revoked, l.ExpiresAt, r.now)
		if last != nil {
			t := instant(*last)
			l.LastOpenedAt = &t
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// CreateLink issues an external link (createDocLink): the token and the PIN are shown once. Only the owner of the
// business holds docs.share_external by the templates (Q-W4.00-documents-4).
func (s *Service) CreateLink(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, b dapi.DocExternalLinkCreate) (dapi.DocExternalLinkCreated, error) {
	var (
		out    dapi.DocExternalLinkCreated
		digest string
	)
	if s.Links == nil {
		return out, errNoLinks
	}
	err := s.runOn(ctx, tc, true, onDoc(id), func(r *req) error {
		d, rt, err := r.doc(id)
		if err != nil {
			return err
		}
		if err := linkable(d, rt); err != nil {
			return err
		}
		if err := checkLinkInput(b, r.now); err != nil {
			return err
		}
		link := s.newID()
		key := s.linkKey()
		token := linkToken(key, tc.TenantID, link)
		digest = tokenDigest(token)
		download, watermark, withPIN := boolOr(b.Download, false), boolOr(b.Watermark, true), boolOr(b.Pin, true)
		pin, pinHash, err := newLinkPIN(key, link, withPIN)
		if err != nil {
			return err
		}
		expires := b.ExpiresAt.UTC()
		if err := s.Links.Issue(ctx, Link{Digest: digest, Tenant: tc.TenantID, Document: id, ID: link, KeyVersion: 1, Expires: expires}); err != nil {
			return err
		}
		if _, err := r.tx.Exec(ctx, `insert into docs.links (id, document_id, level, expires_at, pin_hash, watermark, download, token_digest,
			key_version, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9)`,
			link, id, string(b.Level), expires, pinHash, watermark, download, digest, r.me.id); err != nil {
			return fmt.Errorf("docs: link: %w", err)
		}
		if err := r.record(ctx, "docs.link.create", id, "Выдана внешняя ссылка до "+expires.In(moscow).Format("02.01.2006"), true,
			map[string]any{keyLinkID: link, "expiresAt": expires, "pin": withPIN, "watermark": watermark, "download": download}); err != nil {
			return err
		}
		items, err := r.links(ctx, id, link)
		if err != nil || len(items) != 1 {
			return fmt.Errorf("docs: link: read back: %w", err)
		}
		out = dapi.DocExternalLinkCreated{Link: items[0], Token: token, Pin: pin, Url: s.publicURL(token)}
		return nil
	})
	if err != nil && digest != "" {
		_ = s.Links.Drop(context.WithoutCancel(ctx), digest) // the tenant row is gone: so is the index row
	}
	return out, err
}

// linkable checks that a document may be given by an external link: by the owner of the business only, live, without
// personal data.
func linkable(d *document, rt rights) error {
	switch {
	case !rt.shareExternal:
		return forbidden(textExternalOwner)
	case d.status == statusArchived:
		return locked(textLocked)
	case d.sens == sensPDN:
		return failed("Документ с персональными данными не отдают по внешней ссылке")
	}
	return nil
}

// newLinkPIN makes the PIN of a link and its stored hash; without a PIN both are nil.
func newLinkPIN(key []byte, link uuid.UUID, with bool) (pin, hash *string, err error) {
	if !with {
		return nil, nil, nil
	}
	p, err := newPIN()
	if err != nil {
		return nil, nil, err
	}
	h, err := hashPIN(key, link, p)
	if err != nil {
		return nil, nil, err
	}
	return &p, &h, nil
}

// errNoLinks: the control index of external links is not wired.
var errNoLinks = errors.New("docs: the index of external links is not configured")

func boolOr(p *bool, def bool) bool {
	if p == nil {
		return def
	}
	return *p
}

// publicURL is the path a guest opens (the page is served by the web application next to the API).
func (s *Service) publicURL(token string) string {
	return strings.TrimRight(s.PublicBase, "/") + "/p/docs/" + token
}

// checkLinkInput checks the term and the level of a new link: view only in the first version, the term from now to
// 30 days (DOC-06).
func checkLinkInput(b dapi.DocExternalLinkCreate, now time.Time) error {
	if b.Level != dapi.DocExternalLinkCreateLevelView {
		return invalid("level", "В первой версии ссылка только читает")
	}
	switch exp := b.ExpiresAt.UTC(); {
	case !exp.After(now):
		return invalid("expiresAt", "Срок ссылки уже прошёл")
	case exp.After(now.Add(linkMaxDays * 24 * time.Hour)):
		return invalid("expiresAt", "Ссылка действует не больше 30 дней")
	}
	return nil
}

// RevokeLink revokes an external link (revokeDocLink): it stops working at once, the journal of openings stays.
func (s *Service) RevokeLink(ctx context.Context, tc tenantctx.TenantContext, doc, link uuid.UUID) (dapi.DocExternalLink, error) {
	var out dapi.DocExternalLink
	if s.Links == nil {
		return out, errNoLinks
	}
	var digest string
	err := s.runOn(ctx, tc, true, onDoc(doc), func(r *req) error {
		_, rt, err := r.doc(doc)
		if err != nil {
			return err
		}
		if !rt.shareExternal {
			return forbidden(textExternalOwner)
		}
		err = r.tx.QueryRow(ctx, `update docs.links set revoked_at = coalesce(revoked_at, $3) where id = $1 and document_id = $2
			returning token_digest`, link, doc, r.now).Scan(&digest)
		if errors.Is(err, pgx.ErrNoRows) {
			return notFound(textLinkNotFound)
		}
		if err != nil {
			return fmt.Errorf("docs: revoke link: %w", err)
		}
		if err := r.record(ctx, "docs.link.revoke", doc, "Внешняя ссылка отозвана", true, map[string]any{keyLinkID: link}); err != nil {
			return err
		}
		items, err := r.links(ctx, doc, link)
		if err != nil || len(items) != 1 {
			return fmt.Errorf("docs: revoke link: read back: %w", err)
		}
		out = items[0]
		return nil
	})
	if err == nil {
		err = s.Links.Revoke(ctx, digest, s.now())
	}
	return out, err
}
