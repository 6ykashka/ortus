package forms

import (
	"context"
	"encoding/json"
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

// PGLinks is the control index of the public links (public_form_links, control 0009) over the control DB.
type PGLinks struct{ DB ControlDB }

var _ Links = PGLinks{}

// Issue implements Links.
func (p PGLinks) Issue(ctx context.Context, l Link) error {
	_, err := p.DB.Exec(ctx, `insert into public_form_links (token_digest, tenant_id, form_id, link_id, key_version)
		values ($1, $2, $3, $4, $5)`, l.Digest, l.Tenant, l.Form, l.ID, l.KeyVersion)
	if err != nil {
		return fmt.Errorf("forms: public link index: %w", err)
	}
	return nil
}

// Drop implements Links.
func (p PGLinks) Drop(ctx context.Context, digest string) error {
	if _, err := p.DB.Exec(ctx, `delete from public_form_links where token_digest = $1`, digest); err != nil {
		return fmt.Errorf("forms: drop public link index: %w", err)
	}
	return nil
}

// Find implements Links: the active link of a working tenant (trial, active, grace — the states that take commands)
// with the name of the organization.
func (p PGLinks) Find(ctx context.Context, digest string) (Link, bool, error) {
	l := Link{Digest: digest}
	var ver int16
	err := p.DB.QueryRow(ctx, `select l.tenant_id, l.form_id, l.link_id, l.key_version, t.display_name
		  from public_form_links l join tenants t on t.id = l.tenant_id
		 where l.token_digest = $1 and l.revoked_at is null and t.state in ('trial', 'active', 'grace')`, digest).
		Scan(&l.Tenant, &l.Form, &l.ID, &ver, &l.TenantName)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return Link{}, false, nil
	case err != nil:
		return Link{}, false, fmt.Errorf("forms: public link: %w", err)
	}
	l.KeyVersion = int(ver)
	return l, true, nil
}

// ControlDirectory reads the memberships of the people of a tenant from the control DB (memberships,
// owner_bindings): for a person with several memberships the active one wins.
type ControlDirectory struct{ DB ControlDB }

var _ Directory = ControlDirectory{}

// Memberships implements Directory.
func (d ControlDirectory) Memberships(ctx context.Context, tenantID uuid.UUID) (map[uuid.UUID]Membership, error) {
	rows, err := d.DB.Query(ctx, `select m.person_profile_id, m.status::text,
		       exists (select 1 from owner_bindings o where o.membership_id = m.id and o.revoked_at is null)
		  from memberships m
		 where m.tenant_id = $1 and m.person_profile_id is not null
		 order by m.person_profile_id, (m.status = 'active') desc, m.created_at desc`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("forms: memberships: %w", err)
	}
	defer rows.Close()
	out := map[uuid.UUID]Membership{}
	for rows.Next() {
		var (
			person uuid.UUID
			m      Membership
		)
		if err := rows.Scan(&person, &m.Status, &m.Owner); err != nil {
			return nil, fmt.Errorf("forms: memberships: %w", err)
		}
		if _, seen := out[person]; !seen {
			out[person] = m
		}
	}
	return out, rows.Err()
}

// convert copies a value of a generated type into the same schema of another tag (through JSON).
func convert(from, to any) error {
	b, err := json.Marshal(from)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, to)
}
