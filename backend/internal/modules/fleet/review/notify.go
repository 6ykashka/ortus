package review

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
)

// notifyDriver tells the driver of trip t about the decision (the mock W2.00 reviewTrip), in the transaction of the
// command. The notification names the shift only: no amount, no earnings (AC-05).
func (s *Service) notifyDriver(ctx context.Context, tx pgx.Tx, tenant uuid.UUID, t tripRow, event uuid.UUID, kind, severity, title string) error {
	if s.Recipients == nil || s.Audience == nil || t.driver == nil {
		return nil
	}
	to, err := s.Recipients.Recipient(ctx, tenant, *t.driver)
	if errors.Is(err, inbox.ErrNoRecipient) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("review: recipient: %w", err)
	}
	n := inbox.Notice{
		Kind: kind, Severity: severity, Title: title,
		Object:      &inbox.Object{ModuleKey: "fleet", EntityType: "trip", EntityID: t.id},
		SourceEvent: event,
	}
	if _, _, err := inbox.Enqueue(ctx, tx, s.Audience, to, n); err != nil {
		return fmt.Errorf("review: notify: %w", err)
	}
	return nil
}
