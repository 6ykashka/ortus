package docs

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ControlDB is a pool of the control DB (role ortus_api or ortus_worker).
type ControlDB interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// PGMemberships reads the memberships of the people of a tenant and their owner bindings in the control DB: the
// status of a member (invited, active, suspended, ended) and the owner of the business.
type PGMemberships struct{ DB ControlDB }

var _ Memberships = PGMemberships{}

// Memberships implements Memberships: the memberships of tenantID with these ids.
func (p PGMemberships) Memberships(ctx context.Context, tenantID uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]Membership, error) {
	out := make(map[uuid.UUID]Membership, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := p.DB.Query(ctx, `select m.id, m.status::text,
		       exists (select 1 from owner_bindings b where b.membership_id = m.id and b.revoked_at is null)
		  from memberships m where m.tenant_id = $1 and m.id = any($2)`, tenantID, ids)
	if err != nil {
		return nil, fmt.Errorf("docs: memberships: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			id uuid.UUID
			m  Membership
		)
		if err := rows.Scan(&id, &m.Status, &m.Owner); err != nil {
			return nil, fmt.Errorf("docs: memberships: %w", err)
		}
		out[id] = m
	}
	return out, rows.Err()
}

// PGLinks is the control index of the external links (public_doc_links, control 0011) over the control DB.
type PGLinks struct{ DB ControlDB }

var _ Links = PGLinks{}

// Issue implements Links.
func (p PGLinks) Issue(ctx context.Context, l Link) error {
	_, err := p.DB.Exec(ctx, `insert into public_doc_links (token_digest, tenant_id, document_id, link_id, key_version, expires_at)
		values ($1, $2, $3, $4, $5, $6)`, l.Digest, l.Tenant, l.Document, l.ID, l.KeyVersion, l.Expires)
	if err != nil {
		return fmt.Errorf("docs: link index: %w", err)
	}
	return nil
}

// Drop implements Links.
func (p PGLinks) Drop(ctx context.Context, digest string) error {
	if _, err := p.DB.Exec(ctx, `delete from public_doc_links where token_digest = $1`, digest); err != nil {
		return fmt.Errorf("docs: drop link index: %w", err)
	}
	return nil
}

// Revoke implements Links.
func (p PGLinks) Revoke(ctx context.Context, digest string, at time.Time) error {
	if _, err := p.DB.Exec(ctx, `update public_doc_links set revoked_at = coalesce(revoked_at, $2) where token_digest = $1`, digest, at); err != nil {
		return fmt.Errorf("docs: revoke link index: %w", err)
	}
	return nil
}

// Find implements Links: the link of a working tenant (trial, active, grace — the states that take commands).
func (p PGLinks) Find(ctx context.Context, digest string) (Link, bool, error) {
	l := Link{Digest: digest}
	var ver int16
	var revoked *time.Time
	err := p.DB.QueryRow(ctx, `select l.tenant_id, l.document_id, l.link_id, l.key_version, l.expires_at, l.revoked_at
		  from public_doc_links l join tenants t on t.id = l.tenant_id
		 where l.token_digest = $1 and t.state in ('trial', 'active', 'grace')`, digest).
		Scan(&l.Tenant, &l.Document, &l.ID, &ver, &l.Expires, &revoked)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return Link{}, false, nil
	case err != nil:
		return Link{}, false, fmt.Errorf("docs: link: %w", err)
	}
	l.KeyVersion, l.Revoked = int(ver), revoked != nil
	return l, true, nil
}
