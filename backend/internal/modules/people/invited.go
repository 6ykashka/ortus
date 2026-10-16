package people

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/access/invitations" //nolint:depguard // W1.52: the pending invitations of the control DB (read only)
)

// Invitations reads the pending invitations of person profiles in the control DB (W1.52): a card invited by
// inviteMember has no membership until the acceptance, its invitation makes it invited.
type Invitations interface {
	Pending(ctx context.Context, tenantID uuid.UUID, persons []uuid.UUID) (map[uuid.UUID]time.Time, error)
}

// ControlInvitations is Invitations over the control DB (invitations.Pending).
type ControlInvitations struct{ DB invitations.Reader }

// Pending implements Invitations.
func (c ControlInvitations) Pending(ctx context.Context, tenantID uuid.UUID, persons []uuid.UUID) (map[uuid.UUID]time.Time, error) {
	return invitations.Pending(ctx, c.DB, tenantID, persons)
}
