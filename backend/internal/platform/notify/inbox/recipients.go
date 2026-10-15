package inbox

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// ErrNoRecipient means the person has no active membership in the tenant: there is nobody to notify.
var ErrNoRecipient = errors.New("inbox: the person is not an active member of the tenant")

// Recipients resolves the person of a tenant DB to the tenant context of its membership (the owner binding lives
// in the control DB, the tenant DB does not know it).
type Recipients interface {
	// Recipient returns the context of the active membership of personID in tenantID, or ErrNoRecipient.
	Recipient(ctx context.Context, tenantID, personID uuid.UUID) (tenantctx.TenantContext, error)
}

// ControlDB is a pgx pool or connection of the control DB.
type ControlDB interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// PGRecipients reads memberships and owner bindings of the control DB (roles ortus_api and ortus_worker).
type PGRecipients struct{ Control ControlDB }

var _ Recipients = PGRecipients{}

const recipientSQL = `
select m.id, m.account_id,
       exists (select 1 from owner_bindings o where o.membership_id = m.id and o.revoked_at is null)
  from memberships m
 where m.tenant_id = $1 and m.person_profile_id = $2 and m.status = 'active'
 order by m.created_at, m.id
 limit 1`

// Recipient implements Recipients.
func (r PGRecipients) Recipient(ctx context.Context, tenantID, personID uuid.UUID) (tenantctx.TenantContext, error) {
	tc := tenantctx.TenantContext{TenantID: tenantID, PersonID: personID}
	err := r.Control.QueryRow(ctx, recipientSQL, tenantID, personID).Scan(&tc.MembershipID, &tc.AccountID, &tc.Owner)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return tenantctx.TenantContext{}, ErrNoRecipient
	case err != nil:
		return tenantctx.TenantContext{}, fmt.Errorf("inbox: recipient: %w", err)
	}
	return tc, nil
}
