package chats

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ControlDB is a pool of the control DB (role ortus_api: memberships, owner_bindings).
type ControlDB interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// PGMemberships reads the memberships of the people of a tenant and their owner bindings in the control DB: the status of a
// member (invited, active, suspended, ended) and the owner of the business.
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
		return nil, fmt.Errorf("chats: memberships: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			id uuid.UUID
			m  Membership
		)
		if err := rows.Scan(&id, &m.Status, &m.Owner); err != nil {
			return nil, fmt.Errorf("chats: memberships: %w", err)
		}
		out[id] = m
	}
	return out, rows.Err()
}

// ActiveTenants lists the tenants whose chats the jobs by term go through: not provisioning, closing or closed.
type ActiveTenants struct{ DB ControlDB }

// IDs returns the ids of the tenants.
func (a ActiveTenants) IDs(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := a.DB.Query(ctx, `select id from tenants where state in ('trial', 'active', 'grace', 'read_only') order by id`)
	if err != nil {
		return nil, fmt.Errorf("chats: tenants: %w", err)
	}
	defer rows.Close()
	return pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
}
