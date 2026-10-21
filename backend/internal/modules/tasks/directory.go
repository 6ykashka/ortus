package tasks

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ControlQuerier is a pool or a connection of the control DB (role ortus_api or ortus_worker).
type ControlQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// ControlDirectory reads the memberships of the people of a tenant from the control DB (memberships, owner_bindings):
// for a person with several memberships the active one wins.
type ControlDirectory struct{ DB ControlQuerier }

var _ Directory = ControlDirectory{}

// Memberships implements Directory.
func (d ControlDirectory) Memberships(ctx context.Context, tenantID uuid.UUID) (map[uuid.UUID]Membership, error) {
	rows, err := d.DB.Query(ctx, `select m.person_profile_id, m.status::text,
		       exists (select 1 from owner_bindings o where o.membership_id = m.id and o.revoked_at is null)
		  from memberships m
		 where m.tenant_id = $1 and m.person_profile_id is not null
		 order by m.person_profile_id, (m.status = 'active') desc, m.created_at desc`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("tasks: memberships: %w", err)
	}
	defer rows.Close()
	out := map[uuid.UUID]Membership{}
	for rows.Next() {
		var (
			person uuid.UUID
			m      Membership
		)
		if err := rows.Scan(&person, &m.Status, &m.Owner); err != nil {
			return nil, fmt.Errorf("tasks: memberships: %w", err)
		}
		if _, seen := out[person]; !seen {
			out[person] = m
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tasks: memberships: %w", err)
	}
	return out, nil
}
