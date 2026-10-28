package repairs

import (
	"context"
	"log/slog"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Link is a line of the control index of the links of the cabinet (public_client_links, control 0010): the digest of
// the token names the tenant, the object and the link; the line of the tenant (repairs.client_links) decides.
type Link struct {
	Digest     string
	Tenant     uuid.UUID
	Project    uuid.UUID
	ID         uuid.UUID
	KeyVersion int
	Revoked    bool
}

// Links is the control index of the links of the cabinet.
type Links interface {
	Issue(ctx context.Context, l Link) error
	Drop(ctx context.Context, digest string) error
	Revoke(ctx context.Context, digest string, at time.Time) error
	// Find returns the line of the digest of a token; false — there is none (404 for a guest).
	Find(ctx context.Context, digest string) (Link, bool, error)
}

// LinkSender delivers the address of the cabinet to the phone of the client. It is optional: the port of the codes of
// the signatures may implement it (the stub LogCodes writes to the log of the server); without it the link is issued
// and not sent.
type LinkSender interface {
	SendClientLink(ctx context.Context, phone, url string) error
}

// ControlDB is a pool of the control DB (role ortus_api).
type ControlDB interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// PGLinks is the control index over the control DB.
type PGLinks struct{ DB ControlDB }

var _ Links = PGLinks{}

// Issue implements Links.
func (p PGLinks) Issue(ctx context.Context, l Link) error {
	_, err := p.DB.Exec(ctx, `insert into public_client_links (token_digest, tenant_id, project_id, link_id, key_version) values ($1, $2, $3, $4, $5)`,
		l.Digest, l.Tenant, l.Project, l.ID, l.KeyVersion)
	return store("link index", err)
}

// Drop implements Links.
func (p PGLinks) Drop(ctx context.Context, digest string) error {
	_, err := p.DB.Exec(ctx, `delete from public_client_links where token_digest = $1`, digest)
	return store("drop link index", err)
}

// Revoke implements Links.
func (p PGLinks) Revoke(ctx context.Context, digest string, at time.Time) error {
	_, err := p.DB.Exec(ctx, `update public_client_links set revoked_at = $2 where token_digest = $1 and revoked_at is null`, digest, at)
	return store("revoke link index", err)
}

// Find implements Links.
func (p PGLinks) Find(ctx context.Context, digest string) (Link, bool, error) {
	var (
		l       Link
		revoked *time.Time
	)
	err := p.DB.QueryRow(ctx, `select token_digest, tenant_id, project_id, link_id, key_version, revoked_at from public_client_links where token_digest = $1`,
		digest).Scan(&l.Digest, &l.Tenant, &l.Project, &l.ID, &l.KeyVersion, &revoked)
	if noRows(err) {
		return Link{}, false, nil
	}
	if err != nil {
		return Link{}, false, store("find link index", err)
	}
	l.Revoked = revoked != nil
	return l, true, nil
}

// Texts of the link and the cabinet.
const (
	textNeedClientLink = "Нужно право «Управлять ссылкой кабинета заказчика»."
	textLinkNone       = "Действующей ссылки нет."
	textCabinetClosed  = "Объект сдан: кабинет закрыт."
	textLinkGone       = "Ссылка недействительна: обратитесь в компанию за новой."
	textLinkUnknown    = "Ссылка не найдена."

	codeTokenGone = "public_token_expired" //nolint:gosec // G101: an error code of the contract, not a credential
	keyVersion    = 1
	evLinkIssued  = "client_link.issued"
	evLinkRevoked = "client_link.revoked"
)

// clientLinkRow is a line of repairs.client_links.
type clientLinkRow struct {
	id, project          uuid.UUID
	digest               string
	sentTo               *string
	issuedAt             time.Time
	expiresAt, revokedAt *time.Time
}

func linkOut(l *clientLinkRow, handedOver bool, now time.Time) rapi.ClientLink {
	if l == nil {
		return rapi.ClientLink{}
	}
	out := rapi.ClientLink{Active: l.revokedAt == nil && (l.expiresAt == nil || l.expiresAt.After(now)) && !handedOver, ExpiresAt: l.expiresAt, RevokedAt: l.revokedAt}
	if l.sentTo != nil {
		out.SentTo, out.SentAt = l.sentTo, new(l.issuedAt)
	}
	return out
}

// lastLink is the latest link of the object: the active one first, else the latest revoked.
func (r *req) lastLink(ctx context.Context, project uuid.UUID) (*clientLinkRow, error) {
	l := &clientLinkRow{project: project}
	err := r.tx.QueryRow(ctx, `select id, token_digest, sent_to, issued_at, expires_at, revoked_at from repairs.client_links where project_id = $1
		order by (revoked_at is null) desc, issued_at desc, id limit 1`, project).Scan(&l.id, &l.digest, &l.sentTo, &l.issuedAt, &l.expiresAt, &l.revokedAt)
	if noRows(err) {
		return nil, nil
	}
	return l, store("client link", err)
}

// ClientLink answers getClientLink.
func (s *Service) ClientLink(ctx context.Context, tc tenantctx.TenantContext, project uuid.UUID) (rapi.ClientLink, error) {
	var out rapi.ClientLink
	err := s.run(ctx, tc, false, func(r *req) error {
		p, err := r.visibleProject(ctx, project, false)
		if err != nil {
			return err
		}
		if err := r.need(ctx, p, actClientLink, textNeedClientLink); err != nil {
			return err
		}
		l, err := r.lastLink(ctx, p.id)
		out = linkOut(l, p.status == statusHandedOver, r.now)
		return err
	})
	return out, err
}

// IssueClientLink answers issueClientLink: a new link replaces the active one (its address stops working), the token is
// shown once and kept only as a digest — in the line of the tenant and in the control index (the index first, the
// line of the tenant second; a failed second step takes the first back). The address goes to the phone of the client
// when the delivery is there.
func (s *Service) IssueClientLink(ctx context.Context, tc tenantctx.TenantContext, project uuid.UUID) (rapi.ClientLinkIssued, error) {
	var (
		out     rapi.ClientLinkIssued
		old     []string
		indexed string
	)
	if s.Links == nil {
		return out, problem.New(problem.CodeDependencyUnavailable, "")
	}
	token, err := newClientToken()
	if err != nil {
		return out, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	digest, id := clientDigest(token), uuid.New()
	err = s.run(ctx, tc, true, func(r *req) error {
		p, err := r.visibleProject(ctx, project, true)
		if err != nil {
			return err
		}
		if err := r.need(ctx, p, actClientLink, textNeedClientLink); err != nil {
			return err
		}
		if p.status == statusHandedOver {
			return conflict(reasonHandedOver, textCabinetClosed)
		}
		if old, err = r.revokeLinks(ctx, p.id); err != nil {
			return err
		}
		if err := s.Links.Issue(ctx, Link{Digest: digest, Tenant: tc.TenantID, Project: p.id, ID: id, KeyVersion: keyVersion}); err != nil {
			return problem.Wrap(problem.CodeDependencyUnavailable, err)
		}
		indexed = digest
		url := clientURL(s.PublicBase, token)
		sentTo := s.sendLink(ctx, p, url)
		if _, err := r.tx.Exec(ctx, `insert into repairs.client_links (id, project_id, token_digest, key_version, sent_to, issued_by, issued_at)
			values ($1, $2, $3, $4, $5, $6, $7)`, id, p.id, digest, keyVersion, sentTo, nullUUID(r.me()), r.now); err != nil {
			return store("issue client link", err)
		}
		if err := r.event(ctx, p.id, evLinkIssued, "выпустил(а) ссылку кабинета заказчика"); err != nil {
			return err
		}
		l, err := r.lastLink(ctx, p.id)
		out = rapi.ClientLinkIssued{Link: linkOut(l, false, r.now), Url: url}
		return err
	})
	if err != nil {
		if indexed != "" {
			s.logIndex("take the new line of the index back", s.Links.Drop(context.WithoutCancel(ctx), indexed))
		}
		return rapi.ClientLinkIssued{}, err
	}
	s.revokeIndex(ctx, old)
	return out, nil
}

// sendLink delivers the address to the phone of the client: the masked phone it went to, nil — it did not go. A failed
// delivery does not fail the issue: the manager passes the address on himself.
func (s *Service) sendLink(ctx context.Context, p *projectRow, url string) *string {
	sender, ok := s.Codes.(LinkSender)
	if !ok || p.clientPhone == nil || *p.clientPhone == "" {
		return nil
	}
	if err := sender.SendClientLink(ctx, *p.clientPhone, url); err != nil {
		slog.WarnContext(ctx, "repairs: the link of the cabinet was not delivered", "project", p.id, "error", err)
		return nil
	}
	return new(maskPhone(*p.clientPhone))
}

// revokeLinks revokes the active links of the object in the line of the tenant and returns their digests.
func (r *req) revokeLinks(ctx context.Context, project uuid.UUID) ([]string, error) {
	rows, err := r.tx.Query(ctx, `update repairs.client_links set revoked_at = $2 where project_id = $1 and revoked_at is null returning token_digest`, project, r.now)
	if err != nil {
		return nil, store("revoke client links", err)
	}
	out, err := pgx.CollectRows(rows, pgx.RowTo[string])
	return out, store("revoke client links", err)
}

// revokeIndex marks the digests revoked in the control index. The line of the tenant is the source of truth: a failure
// here leaves a line that is already dead for the guest, so it is logged and not returned.
func (s *Service) revokeIndex(ctx context.Context, digests []string) {
	if s.Links == nil {
		return
	}
	for _, d := range digests {
		s.logIndex("revoke the line of the index", s.Links.Revoke(context.WithoutCancel(ctx), d, s.now()))
	}
}

func (s *Service) logIndex(what string, err error) {
	if err != nil {
		slog.Warn("repairs: control index of the links of the cabinet: "+what, "error", err)
	}
}

// RevokeClientLink answers revokeClientLink: the address stops working at once.
func (s *Service) RevokeClientLink(ctx context.Context, tc tenantctx.TenantContext, project uuid.UUID) error {
	var revoked []string
	err := s.run(ctx, tc, true, func(r *req) error {
		p, err := r.visibleProject(ctx, project, true)
		if err != nil {
			return err
		}
		if err := r.need(ctx, p, actClientLink, textNeedClientLink); err != nil {
			return err
		}
		if revoked, err = r.revokeLinks(ctx, p.id); err != nil {
			return err
		}
		if len(revoked) == 0 {
			return notFound(textLinkNone)
		}
		return r.event(ctx, p.id, evLinkRevoked, "отозвал(а) ссылку кабинета заказчика")
	})
	if err == nil {
		s.revokeIndex(ctx, revoked)
	}
	return err
}

func nullUUID(id uuid.UUID) *uuid.UUID {
	if id == uuid.Nil {
		return nil
	}
	return &id
}

// ---- the public route of the client ----

// guestTenant resolves the token of the cabinet: the control index names the tenant (an unknown token is 404, a
// revoked line 410); the line of the tenant is checked in the transaction of the operation (guestProject).
func (s *Service) guestTenant(ctx context.Context, token string) (tenantctx.TenantContext, Link, error) {
	if s.Links == nil || token == "" {
		return tenantctx.TenantContext{}, Link{}, notFound(textLinkUnknown)
	}
	l, ok, err := s.Links.Find(ctx, clientDigest(token))
	switch {
	case err != nil:
		return tenantctx.TenantContext{}, Link{}, problem.Wrap(problem.CodeDependencyUnavailable, err)
	case !ok:
		return tenantctx.TenantContext{}, Link{}, notFound(textLinkUnknown)
	case l.Revoked:
		return tenantctx.TenantContext{}, Link{}, problem.New(codeTokenGone, textLinkGone)
	}
	return tenantctx.TenantContext{TenantID: l.Tenant}, l, nil
}

// guestProject checks the line of the tenant of the link and returns the object: a revoked, an expired or a missing
// link, a handed over object — 410.
func (r *req) guestProject(ctx context.Context, l Link) (*projectRow, error) {
	var revoked, expires *time.Time
	err := r.tx.QueryRow(ctx, `select revoked_at, expires_at from repairs.client_links where id = $1 and token_digest = $2 and project_id = $3`,
		l.ID, l.Digest, l.Project).Scan(&revoked, &expires)
	if noRows(err) {
		return nil, problem.New(codeTokenGone, textLinkGone)
	}
	if err != nil {
		return nil, store("guest link", err)
	}
	if revoked != nil || (expires != nil && !expires.After(r.now)) {
		return nil, problem.New(codeTokenGone, textLinkGone)
	}
	p, err := r.project(ctx, l.Project, false)
	if err != nil {
		return nil, err
	}
	if p == nil || p.status == statusHandedOver {
		return nil, problem.New(codeTokenGone, textLinkGone)
	}
	return p, nil
}

// guestCheck runs guestProject in a short transaction (the operations that call the services of the members).
func (s *Service) guestCheck(ctx context.Context, token string) (tenantctx.TenantContext, uuid.UUID, error) {
	tc, l, err := s.guestTenant(ctx, token)
	if err != nil {
		return tc, uuid.Nil, err
	}
	var project uuid.UUID
	err = s.run(ctx, tc, false, func(r *req) error {
		p, err := r.guestProject(ctx, l)
		if err != nil {
			return err
		}
		project = p.id
		return nil
	})
	return tc, project, err
}

// ApproveByClient answers approveEstimateByClient: the client approves a sent version by the link.
func (s *Service) ApproveByClient(ctx context.Context, token string, version int) (rapi.ClientEstimateApproval, error) {
	tc, project, err := s.guestCheck(ctx, token)
	if err != nil {
		return rapi.ClientEstimateApproval{}, err
	}
	e, err := s.ApproveEstimate(ctx, tc, project, version)
	if err != nil {
		return rapi.ClientEstimateApproval{}, err
	}
	return rapi.ClientEstimateApproval{Version: e.Version, State: rapi.ClientEstimateApprovalState(e.State)}, nil
}

// SignByClient answers signDocumentByClient: the client enters the code from SMS into the cabinet.
func (s *Service) SignByClient(ctx context.Context, token string, document uuid.UUID, code string) (rapi.RepairDocument, error) {
	tc, project, err := s.guestCheck(ctx, token)
	if err != nil {
		return rapi.RepairDocument{}, err
	}
	return s.SignDocument(ctx, tc, project, document, code)
}

// Cabinet answers getClientCabinet: what the client sees by the link — the stages, the photos of the accepted marks, the
// documents without drafts, the money paid and the version of the estimate.
func (s *Service) Cabinet(ctx context.Context, token string) (rapi.ClientCabinet, error) {
	var out rapi.ClientCabinet
	tc, l, err := s.guestTenant(ctx, token)
	if err != nil {
		return out, err
	}
	err = s.run(ctx, tc, false, func(r *req) error {
		p, err := r.guestProject(ctx, l)
		if err != nil {
			return err
		}
		out, err = r.cabinet(ctx, p)
		return err
	})
	return out, err
}

func (r *req) cabinet(ctx context.Context, p *projectRow) (rapi.ClientCabinet, error) {
	out := rapi.ClientCabinet{ProjectName: p.name, Address: p.address, ClientName: deref(p.clientName), Documents: []rapi.RepairDocument{}}
	out.Stages, out.Photos = nonNil(out.Stages), empty(out.Photos)
	var acts, signed int
	var paid int64
	if err := r.tx.QueryRow(ctx, `select count(*) filter (where kind = 'act'), count(*) filter (where kind = 'act' and state in ('signed', 'paid')),
		coalesce(sum(amount_minor) filter (where kind = 'invoice' and state = 'paid'), 0)::bigint from repairs.documents where project_id = $1`, p.id).Scan(&acts, &signed, &paid); err != nil {
		return out, store("cabinet totals", err)
	}
	out.ReadinessPct = readinessOf(0, 0, 0, acts, signed).ClientPct
	out.Paid = moneyOut(paid)
	for _, step := range []func(context.Context, *projectRow, *rapi.ClientCabinet) error{r.cabinetStages, r.cabinetPhotos, r.cabinetDocuments, r.cabinetEstimate} {
		if err := step(ctx, p, &out); err != nil {
			return out, err
		}
	}
	return out, nil
}

func (r *req) cabinetStages(ctx context.Context, p *projectRow, out *rapi.ClientCabinet) error {
	return r.collect(ctx, "cabinet stages", `select name, status from repairs.schedule_stages where project_id = $1 order by sort, id`, []any{p.id}, func(rows pgx.Rows) error {
		var name, state string
		if err := rows.Scan(&name, &state); err != nil {
			return err
		}
		st := grow(&out.Stages)
		st.Name, st.State = name, rapi.ClientCabinetStagesState(state)
		return nil
	})
}

// cabinetPhotos are the photos of the accepted marks, the newest first.
func (r *req) cabinetPhotos(ctx context.Context, p *projectRow, out *rapi.ClientCabinet) error {
	return r.collect(ctx, "cabinet photos", `select u.f, g.work_date from repairs.work_logs g cross join lateral unnest(g.evidence_file_ids) with ordinality as u(f, n)
		where g.project_id = $1 and g.status = 'accepted' order by g.work_date desc, g.created_at desc, u.n limit $2`, []any{p.id, maxCabinetPhotos}, func(rows pgx.Rows) error {
		var (
			file uuid.UUID
			day  time.Time
		)
		if err := rows.Scan(&file, &day); err != nil {
			return err
		}
		ph := grow(&out.Photos)
		ph.FileId, ph.Date.Time = file, day
		return nil
	})
}

// cabinetDocuments are the documents the client may see: everything but the drafts.
func (r *req) cabinetDocuments(ctx context.Context, p *projectRow, out *rapi.ClientCabinet) error {
	return r.collect(ctx, "cabinet documents", `select `+docCols+` from repairs.documents where project_id = $1 and state <> 'draft' order by created_at, id`, []any{p.id}, func(rows pgx.Rows) error {
		var d docRow
		if err := d.scan(rows); err != nil {
			return err
		}
		out.Documents = append(out.Documents, docOut(&d, true))
		return nil
	})
}

// cabinetEstimate is the version the client sees and the contract: the total of that version, else the sum of the object.
func (r *req) cabinetEstimate(ctx context.Context, p *projectRow, out *rapi.ClientCabinet) error {
	contract := int64(0)
	if p.budget != nil {
		contract = *p.budget
	}
	est, total, err := r.shownEstimate(ctx, p.id)
	if err != nil {
		return err
	}
	if est != nil {
		contract = total
		shown := alloc(&out.Estimate)
		shown.Version, shown.State, shown.Total = est.version, rapi.ClientCabinetEstimateState(est.state), moneyOut(total)
	}
	out.Contract = moneyOut(contract)
	return nil
}

// shownEstimate is the latest version the client may see: sent or approved.
func (r *req) shownEstimate(ctx context.Context, project uuid.UUID) (*estRow, int64, error) {
	all, err := r.versions(ctx, project)
	if err != nil {
		return nil, 0, err
	}
	for _, e := range slices.Backward(all) {
		if e.state != stateSent && e.state != stateApproved {
			continue
		}
		lines, err := r.lines(ctx, e.id)
		if err != nil {
			return nil, 0, err
		}
		total, ok := totalOf(lines, e.discount)
		if !ok {
			return nil, 0, invalid("lines", textTotalTooBig, "max")
		}
		return e, total, nil
	}
	return nil, 0, nil
}
