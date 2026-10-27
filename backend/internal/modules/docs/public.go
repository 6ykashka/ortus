package docs

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	dapi "github.com/ortus/ortus-crm/backend/internal/api/docs"
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// PublicSession is a document opened by an external link (DocPublicSession): view only, a watermark, no download
// unless the link allows it.
type PublicSession struct {
	Config    dapi.DocSessionConfig
	ExpiresAt time.Time
	Kind      string
	Title     string
	Version   int
	Watermark string
}

// errPinWrong rolls back the transaction of an opening with a wrong PIN; the failure is written on its own.
var errPinWrong = errors.New("docs: wrong PIN")

// linkRow is a row of docs.links of a guest.
type linkRow struct {
	id, doc  uuid.UUID
	level    string
	expires  time.Time
	pinHash  *string
	mark     bool
	download bool
	revoked  *time.Time
}

// OpenLink opens a document by an external link (openDocLink): the token names the tenant through the control index,
// the tenant row is the source of truth; an unknown token is 404, a revoked or expired one 410 public_token_expired,
// a wrong PIN 403, too many wrong PINs 429. Every opening is journaled (docs.link.opened.v1).
func (s *Service) OpenLink(ctx context.Context, token, pin string) (PublicSession, error) {
	var out PublicSession
	idx, err := s.findLink(ctx, tokenDigest(token))
	if err != nil {
		return out, err
	}
	pool, err := s.Pools.For(ctx, idx.Tenant)
	if err != nil {
		return out, notFound("")
	}
	err = s.inTx(ctx, pool, tenantctx.TenantContext{TenantID: idx.Tenant}, pgx.TxOptions{}, func(r *req) error {
		l, err := r.guestLink(ctx, idx)
		if err != nil {
			return err
		}
		if l.pinHash != nil {
			if err := r.checkPIN(ctx, l, pin); err != nil {
				return err
			}
		}
		if out, err = r.publicSession(ctx, l); err != nil {
			return err
		}
		return r.opened(ctx, l)
	})
	if errors.Is(err, errPinWrong) {
		// the failed attempt is counted outside the rolled back transaction
		_ = s.countWrongPIN(ctx, pool, idx.ID)
		return out, forbidden("Неверный PIN")
	}
	return out, err
}

// findLink reads the control index by the digest of the token: unknown — 404, revoked or expired — 410.
func (s *Service) findLink(ctx context.Context, digest string) (Link, error) {
	if s.Links == nil {
		return Link{}, notFound("")
	}
	idx, ok, err := s.Links.Find(ctx, digest)
	switch {
	case err != nil:
		return Link{}, problem.Wrap(problem.CodeDependencyUnavailable, err)
	case !ok:
		return Link{}, notFound("")
	case idx.Revoked || !s.now().Before(idx.Expires):
		return Link{}, problem.New(codeTokenGone, "")
	}
	return idx, nil
}

// guestLink reads and locks the link of the index in the tenant: the tenant row decides (revoked, expired).
func (r *req) guestLink(ctx context.Context, idx Link) (linkRow, error) {
	var l linkRow
	err := r.tx.QueryRow(ctx, `select id, document_id, level, expires_at, pin_hash, watermark, download, revoked_at from docs.links
		where id = $1 and token_digest = $2 for update`, idx.ID, idx.Digest).Scan(&l.id, &l.doc, &l.level, &l.expires, &l.pinHash, &l.mark, &l.download, &l.revoked)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return l, notFound("")
	case err != nil:
		return l, fmt.Errorf("docs: link: %w", err)
	case l.revoked != nil || !r.now.Before(l.expires):
		return l, problem.New(codeTokenGone, "")
	}
	return l, nil
}

// opened journals an opening of a link: the row of openings, the event and the audit.
func (r *req) opened(ctx context.Context, l linkRow) error {
	if _, err := r.tx.Exec(ctx, `insert into docs.link_opens (link_id, opened_at) values ($1, $2)`, l.id, r.now); err != nil {
		return fmt.Errorf("docs: link open: %w", err)
	}
	if _, err := r.publishService(ctx, "docs.link.opened", aggDocument, l.doc, map[string]any{keyLinkID: l.id}); err != nil {
		return err
	}
	e := audit.Event{ActorKind: audit.ActorService, Action: "docs.link.open", TargetType: aggDocument, TargetID: l.doc, Result: audit.OK,
		RequestID: "docs-" + uuid.NewString(), Sensitivity: audit.Sensitive, Diff: map[string]any{"details": "Внешняя ссылка открыта", keyLinkID: l.id}}
	return audit.Record(ctx, r.tx, e)
}

// countWrongPIN writes a failed attempt of the PIN of a link.
func (s *Service) countWrongPIN(ctx context.Context, pool *pgxpool.Pool, link uuid.UUID) error {
	_, err := pool.Exec(context.WithoutCancel(ctx), `insert into docs.link_opens (link_id, opened_at, pin_failed) values ($1, $2, true)`, link, s.now())
	return err
}

// checkPIN checks the PIN of a guest against the link: too many wrong attempts lock the link for the window (429).
func (r *req) checkPIN(ctx context.Context, l linkRow, pin string) error {
	var failedTries int
	if err := r.tx.QueryRow(ctx, `select count(*) from docs.link_opens where link_id = $1 and pin_failed and opened_at > $2`,
		l.id, r.now.Add(-pinWindow)).Scan(&failedTries); err != nil {
		return fmt.Errorf("docs: pin tries: %w", err)
	}
	if failedTries >= pinTries {
		return problem.New(codeRateLimited, "Слишком много попыток: подождите 15 минут")
	}
	if pin == "" || !checkPIN(r.s.linkKey(), l.id, pin, *l.pinHash) {
		return errPinWrong
	}
	return nil
}

// publicSession builds the view-only configuration of a guest for the current version of the document.
func (r *req) publicSession(ctx context.Context, l linkRow) (PublicSession, error) {
	var (
		d  document
		st string
	)
	err := r.tx.QueryRow(ctx, `select id, kind, title, current_version, status, sensitivity from docs.documents where id = $1`, l.doc).
		Scan(&d.id, &d.kind, &d.title, &d.version, &st, &d.sens)
	if errors.Is(err, pgx.ErrNoRows) || st == statusArchived || d.sens == sensPDN {
		return PublicSession{}, problem.New(codeTokenGone, "")
	}
	if err != nil {
		return PublicSession{}, fmt.Errorf("docs: public document: %w", err)
	}
	d.status = st
	mark := ""
	if l.mark {
		mark = "Только для просмотра · ссылка действует до " + l.expires.In(moscow).Format("02.01.2006")
	}
	cfg := dapi.DocSessionConfig{
		DocumentKey: engineKey(r.tc.TenantID, d.id, d.version), Version: int64(d.version), Mode: dapi.DocSessionConfigModeView,
		Engine: dapi.DocSessionConfigEngineNone, User: dapi.DocMemberRef{DisplayName: "Гость", MemberId: l.id}, ExpiresAt: instant(l.expires),
		ProtectedRanges: []dapi.DocProtectedRange{},
	}
	perms := Permissions{Download: l.download, Print: l.download}
	fileURL, ext, err := r.fileLink(ctx, &d, d.version)
	if err != nil {
		return PublicSession{}, err
	}
	if fileURL != "" {
		cfg.FileUrl = &fileURL
	}
	if eng := r.s.Engine; eng != nil && eng.Configured() {
		sc, err := eng.Session(SessionRequest{Key: cfg.DocumentKey, Title: d.title, Kind: d.kind, Extension: ext, FileURL: fileURL,
			CallbackURL: r.s.callbackURL(), UserID: l.id, UserName: "Гость", Mode: modeView, Perms: perms, Watermark: mark, Expires: minTime(r.now.Add(sessionTTL), l.expires)})
		if err != nil {
			return PublicSession{}, problem.Wrap(problem.CodeDependencyUnavailable, err)
		}
		cfg.Engine, cfg.EditorAvailable = dapi.DocSessionConfigEngine(sc.Engine), true
		cfg.EditorUrl, cfg.Token = &sc.EditorURL, &sc.Token
	} else {
		hint := hintNoEdit
		cfg.Hint = &hint
	}
	cfg.Permissions = permissionsDTO(perms)
	return PublicSession{Config: cfg, ExpiresAt: l.expires, Kind: d.kind, Title: d.title, Version: d.version, Watermark: mark}, nil
}

func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}
