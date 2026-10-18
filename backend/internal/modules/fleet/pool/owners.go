package pool

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
)

// Owners lists the people bound as owners of a tenant: the owner binding lives in the control DB, the tenant DB does
// not know it (inbox.Recipients).
type Owners interface {
	Owners(ctx context.Context, tenantID uuid.UUID) ([]uuid.UUID, error)
}

// ControlOwners reads the active owner bindings of the control DB (roles ortus_api and ortus_worker, as
// inbox.PGRecipients).
type ControlOwners struct{ Control inbox.ControlDB }

var _ Owners = ControlOwners{}

const ownersSQL = `select coalesce(array_agg(distinct m.person_profile_id), '{}')
  from memberships m
  join owner_bindings o on o.membership_id = m.id and o.revoked_at is null
 where m.tenant_id = $1 and m.status = 'active'`

// Owners implements Owners.
func (o ControlOwners) Owners(ctx context.Context, tenantID uuid.UUID) ([]uuid.UUID, error) {
	var out []uuid.UUID
	if err := o.Control.QueryRow(ctx, ownersSQL, tenantID).Scan(&out); err != nil {
		return nil, fmt.Errorf("pool: owners of %s: %w", tenantID, err)
	}
	return out, nil
}
