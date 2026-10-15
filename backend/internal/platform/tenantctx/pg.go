package tenantctx

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PGDirectory reads the control DB (role ortus_api, DML only).
type PGDirectory struct{ pool *pgxpool.Pool }

// NewPGDirectory returns a Directory over the control DB pool.
func NewPGDirectory(pool *pgxpool.Pool) *PGDirectory { return &PGDirectory{pool: pool} }

func notFound(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

// AccountByID implements Directory.
func (d *PGDirectory) AccountByID(ctx context.Context, id uuid.UUID) (Account, error) {
	var a Account
	err := d.pool.QueryRow(ctx, `select id, display_name, status from accounts where id = $1`, id).
		Scan(&a.ID, &a.DisplayName, &a.Status)
	return a, notFound(err)
}

// AccountBySubject implements Directory: the identity of the provider (issuer + subject).
func (d *PGDirectory) AccountBySubject(ctx context.Context, issuer, subject string) (Account, error) {
	var a Account
	err := d.pool.QueryRow(ctx,
		`select id, display_name, status from accounts where issuer = $1 and subject = $2`, issuer, subject).
		Scan(&a.ID, &a.DisplayName, &a.Status)
	return a, notFound(err)
}

// IsPlatformOperator implements Directory: an active row of platform_operators.
func (d *PGDirectory) IsPlatformOperator(ctx context.Context, accountID uuid.UUID) (bool, error) {
	var ok bool
	err := d.pool.QueryRow(ctx,
		`select exists (select 1 from platform_operators where account_id = $1 and status = 'active')`, accountID).
		Scan(&ok)
	return ok, err
}

const membershipsSQL = `
select m.id, m.tenant_id, m.person_profile_id, t.display_name, t.state::text, m.status::text,
       exists (select 1 from owner_bindings o where o.membership_id = m.id and o.revoked_at is null)
  from memberships m
  join tenants t on t.id = m.tenant_id
 where m.account_id = $1`

func scanMembership(row pgx.Row) (Membership, error) {
	var m Membership
	err := row.Scan(&m.ID, &m.TenantID, &m.PersonProfileID, &m.TenantName, &m.TenantState, &m.Status, &m.Owner)
	return m, err
}

// Memberships implements Directory; names are compared byte-wise (deterministic, independent of the DB locale).
func (d *PGDirectory) Memberships(ctx context.Context, accountID uuid.UUID) ([]Membership, error) {
	rows, err := d.pool.Query(ctx, membershipsSQL+` order by t.display_name collate "C", t.id`, accountID)
	if err != nil {
		return nil, fmt.Errorf("memberships: %w", err)
	}
	defer rows.Close()
	var out []Membership
	for rows.Next() {
		m, err := scanMembership(rows)
		if err != nil {
			return nil, fmt.Errorf("memberships: %w", err)
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// Membership implements Directory.
func (d *PGDirectory) Membership(ctx context.Context, accountID, tenantID uuid.UUID) (Membership, error) {
	m, err := scanMembership(d.pool.QueryRow(ctx, membershipsSQL+` and m.tenant_id = $2`, accountID, tenantID))
	return m, notFound(err)
}

// Routing implements Directory.
func (d *PGDirectory) Routing(ctx context.Context, tenantID uuid.UUID) (Routing, error) {
	var r Routing
	err := d.pool.QueryRow(ctx,
		`select tenant_id, database_name, secret_ref, sentinel from tenant_routing where tenant_id = $1`, tenantID).
		Scan(&r.TenantID, &r.DatabaseName, &r.SecretRef, &r.Sentinel)
	return r, notFound(err)
}

// TenantData reads the tenant DB of a TenantContext through the sentinel-checked pools.
type TenantData struct{ Pools *Pools }

const grantsSQL = `
select distinct a.action, ra.scope_kind, ra.scope_ref
  from access.role_assignments ra
  join access.roles r on r.id = ra.role_id and r.archived_at is null
  join access.role_versions rv on rv.role_id = ra.role_id and rv.version = ra.role_version
 cross join lateral unnest(rv.actions) as a(action)
 where ra.state = 'active' and ra.valid @> now()
   and ((ra.principal_kind = 'person' and ra.principal_id = $1)
     or (ra.principal_kind = 'group'
         and ra.principal_id in (select group_id from access.group_members where person_id = $1)))
 order by 1, 2, 3`

// Grants implements GrantSource: active assignments of the person, direct and through groups.
func (d TenantData) Grants(ctx context.Context, tc TenantContext) ([]Grant, error) {
	pool, err := d.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return nil, err
	}
	rows, err := pool.Query(ctx, grantsSQL, tc.PersonID)
	if err != nil {
		return nil, fmt.Errorf("grants: %w", err)
	}
	defer rows.Close()
	var out []Grant
	for rows.Next() {
		var g Grant
		if err := rows.Scan(&g.Action, &g.ScopeKind, &g.ScopeRef); err != nil {
			return nil, fmt.Errorf("grants: %w", err)
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// Profile is what GET /me/context reads from the tenant DB about the person of a membership.
type Profile struct {
	HomeUnitID    *uuid.UUID // nil: no live person profile
	PolicyVersion int64      // access.policy_state: +1 on any change of roles, assignments or modules
}

// Profile reads the home unit of the person and the policy version of the tenant.
func (d TenantData) Profile(ctx context.Context, tc TenantContext) (Profile, error) {
	pool, err := d.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return Profile{}, err
	}
	var p Profile
	err = pool.QueryRow(ctx, `
select (select home_unit_id from people.person_profiles where id = $1 and archived_at is null),
       coalesce((select policy_version from access.policy_state), 0)`, tc.PersonID).
		Scan(&p.HomeUnitID, &p.PolicyVersion)
	if err != nil {
		return Profile{}, fmt.Errorf("profile: %w", err)
	}
	return p, nil
}
