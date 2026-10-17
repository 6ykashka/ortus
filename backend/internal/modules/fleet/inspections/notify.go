package inspections

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
)

// Kinds of the notifications of the module (the event type without its version).
const (
	noticeBlocking = "fleet.defect.blocking_reported"
	noticeDecided  = "fleet.defect.decided"
)

// candidatesSQL lists the people of the tenant who may be recipients; the audience decides who is.
const candidatesSQL = `select id from people.person_profiles where archived_at is null order by id`

// notifyManagers enqueues the notification of a blocking defect for the managers of the area of the trip and the
// owner: every live person with an active membership whose fleet.inspections.review reaches the unit of the trip now
// (inbox.Enqueue checks the recipient when it is enqueued, W1.10). event is the outbox event: a repeat adds nothing.
func (s *Service) notifyManagers(ctx context.Context, tx querier, tenant uuid.UUID, t target, event uuid.UUID, title string) error {
	if s.Recipients == nil || s.Audience == nil {
		return nil
	}
	rows, err := tx.Query(ctx, candidatesSQL)
	if err != nil {
		return fmt.Errorf("inspections: recipients: %w", err)
	}
	people, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return fmt.Errorf("inspections: recipients: %w", err)
	}
	n := inbox.Notice{
		Kind: noticeBlocking, Severity: inbox.SeverityCritical, Title: title,
		Object: &inbox.Object{ModuleKey: "fleet", EntityType: "trip", EntityID: t.trip},
		Unit:   t.unit, Permission: actionReview, SourceEvent: event,
	}
	for _, p := range people {
		if err := s.enqueue(ctx, tx, tenant, p, n); err != nil {
			return err
		}
	}
	return nil
}

// notifyDriver enqueues the notification of a decision for the driver of the trip (no permission: it is addressed
// to him).
func (s *Service) notifyDriver(ctx context.Context, tx querier, tenant uuid.UUID, driver *uuid.UUID, trip, event uuid.UUID, severity, title string) error {
	if s.Recipients == nil || s.Audience == nil || driver == nil {
		return nil
	}
	return s.enqueue(ctx, tx, tenant, *driver, inbox.Notice{
		Kind: noticeDecided, Severity: severity, Title: title,
		Object:      &inbox.Object{ModuleKey: "fleet", EntityType: "trip", EntityID: trip},
		SourceEvent: event,
	})
}

func (s *Service) enqueue(ctx context.Context, tx querier, tenant, person uuid.UUID, n inbox.Notice) error {
	to, err := s.Recipients.Recipient(ctx, tenant, person)
	if errors.Is(err, inbox.ErrNoRecipient) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("inspections: recipient: %w", err)
	}
	if _, _, err := inbox.Enqueue(ctx, tx, s.Audience, to, n); err != nil {
		return fmt.Errorf("inspections: notify: %w", err)
	}
	return nil
}
