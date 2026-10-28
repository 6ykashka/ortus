package service

import (
	"context"
	"errors"
	"fmt"

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

// PGIndex is the control index of the public routes (public_service_tokens and public_service_slugs, control 0011).
type PGIndex struct{ DB ControlDB }

var _ Index = PGIndex{}

// IssueToken implements Index.
func (p PGIndex) IssueToken(ctx context.Context, t TokenRow) error {
	_, err := p.DB.Exec(ctx, `insert into public_service_tokens (token_digest, tenant_id, request_id, token_id, key_version, expires_at)
		values ($1, $2, $3, $4, $5, $6)`, t.Digest, t.Tenant, t.Request, t.ID, max(t.KeyVersion, 1), t.ExpiresAt)
	if err != nil {
		return fmt.Errorf("service: portal token index: %w", err)
	}
	return nil
}

// DropToken implements Index.
func (p PGIndex) DropToken(ctx context.Context, digest string) error {
	if _, err := p.DB.Exec(ctx, `delete from public_service_tokens where token_digest = $1`, digest); err != nil {
		return fmt.Errorf("service: drop portal token index: %w", err)
	}
	return nil
}

// FindToken implements Index: the token of a working tenant (trial, active, grace) that is not revoked; an expired
// one is returned too, the caller answers 410.
func (p PGIndex) FindToken(ctx context.Context, digest string) (TokenRow, bool, error) {
	t := TokenRow{Digest: digest}
	var ver int16
	err := p.DB.QueryRow(ctx, `select x.tenant_id, x.request_id, x.token_id, x.key_version, x.expires_at, t.display_name
		  from public_service_tokens x join tenants t on t.id = x.tenant_id
		 where x.token_digest = $1 and x.revoked_at is null and t.state in ('trial', 'active', 'grace')`, digest).
		Scan(&t.Tenant, &t.Request, &t.ID, &ver, &t.ExpiresAt, &t.TenantName)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return TokenRow{}, false, nil
	case err != nil:
		return TokenRow{}, false, fmt.Errorf("service: portal token: %w", err)
	}
	t.KeyVersion = int(ver)
	return t, true, nil
}

// ClaimSlug implements Index: a taken slug of another direction is a conflict (the caller answers 409).
func (p PGIndex) ClaimSlug(ctx context.Context, s SlugRow) error {
	tag, err := p.DB.Exec(ctx, `insert into public_service_slugs (slug, tenant_id, direction_id) values ($1, $2, $3)
		on conflict (slug) do nothing`, s.Slug, s.Tenant, s.Direction)
	if err != nil {
		return fmt.Errorf("service: slug registry: %w", err)
	}
	if tag.RowsAffected() == 0 {
		var same bool
		if err := p.DB.QueryRow(ctx, `select tenant_id = $2 and direction_id = $3 from public_service_slugs where slug = $1`, s.Slug, s.Tenant, s.Direction).Scan(&same); err != nil {
			return fmt.Errorf("service: slug registry: %w", err)
		}
		if !same {
			return ErrSlugTaken
		}
	}
	return nil
}

// ErrSlugTaken is returned by ClaimSlug for a slug of another direction.
var ErrSlugTaken = errors.New("service: the slug is taken")

// DropSlug implements Index.
func (p PGIndex) DropSlug(ctx context.Context, slug string) error {
	if _, err := p.DB.Exec(ctx, `delete from public_service_slugs where slug = $1`, slug); err != nil {
		return fmt.Errorf("service: drop slug: %w", err)
	}
	return nil
}

// FindSlug implements Index.
func (p PGIndex) FindSlug(ctx context.Context, slug string) (SlugRow, bool, error) {
	s := SlugRow{Slug: slug}
	err := p.DB.QueryRow(ctx, `select x.tenant_id, x.direction_id, t.display_name from public_service_slugs x join tenants t on t.id = x.tenant_id
		 where x.slug = $1 and t.state in ('trial', 'active', 'grace')`, slug).Scan(&s.Tenant, &s.Direction, &s.TenantName)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return SlugRow{}, false, nil
	case err != nil:
		return SlugRow{}, false, fmt.Errorf("service: slug: %w", err)
	}
	return s, true, nil
}

// ControlDirectory reads the memberships of the people of a tenant from the control DB (memberships, owner_bindings):
// for a person with several memberships the active one wins.
type ControlDirectory struct{ DB ControlDB }

var _ Directory = ControlDirectory{}

// Memberships implements Directory.
func (d ControlDirectory) Memberships(ctx context.Context, tenantID uuid.UUID) (map[uuid.UUID]Member, error) {
	rows, err := d.DB.Query(ctx, `select m.person_profile_id, m.status::text = 'active',
		       exists (select 1 from owner_bindings o where o.membership_id = m.id and o.revoked_at is null)
		  from memberships m
		 where m.tenant_id = $1 and m.person_profile_id is not null
		 order by m.person_profile_id, (m.status = 'active') desc, m.created_at desc`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("service: memberships: %w", err)
	}
	defer rows.Close()
	out := map[uuid.UUID]Member{}
	for rows.Next() {
		var (
			person uuid.UUID
			m      Member
		)
		if err := rows.Scan(&person, &m.Active, &m.Owner); err != nil {
			return nil, fmt.Errorf("service: memberships: %w", err)
		}
		if _, seen := out[person]; !seen {
			out[person] = m
		}
	}
	return out, rows.Err()
}
