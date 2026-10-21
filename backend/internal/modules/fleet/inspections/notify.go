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
	noticeAssigned = "fleet.defect.assigned" // W2.46: the assignee of a defect in the queue
)

// maxNoticeTitle is the limit of Notification.title.
const maxNoticeTitle = 300

// candidatesSQL lists the people of the tenant who may be recipients; the audience decides who is.
const candidatesSQL = `select id from people.person_profiles where archived_at is null order by id`

// notifyManagers enqueues the notification of a blocking defect for the managers of the area of the vehicle — who
// decide it (fleet.inspections.review over the unit of the vehicle; W2.72 return 1, docs/29 rule 6: the company of the
// usual vehicle of a temporary driver) — then of the trip, and the owner: every live person with an active membership
// whose fleet.inspections.review reaches the unit now (inbox.Enqueue checks the recipient when it is enqueued, W1.10).
// event is the outbox event: a repeat adds nothing, a person reaching both units gets it once.
func (s *Service) notifyManagers(ctx context.Context, tx querier, tenant uuid.UUID, t target, vehicleUnit, event uuid.UUID, title string) error {
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
	units := []uuid.UUID{t.unit}
	if vehicleUnit != uuid.Nil && vehicleUnit != t.unit {
		units = []uuid.UUID{vehicleUnit, t.unit}
	}
	for _, unit := range units {
		n := inbox.Notice{
			Kind: noticeBlocking, Severity: inbox.SeverityCritical, Title: title,
			Object: &inbox.Object{ModuleKey: "fleet", EntityType: "trip", EntityID: t.trip},
			Unit:   unit, Permission: actionReview, SourceEvent: event,
		}
		for _, p := range people {
			if err := s.enqueue(ctx, tx, tenant, p, n); err != nil {
				return err
			}
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

// notifyAssignee enqueues the notification of an assignment for the assignee of the defect (W2.46): about the trip of
// the defect when it has one; it is shown while the assignee keeps fleet.inspections.review over the unit of the
// vehicle (checked again on every read of the inbox). The comment of the assignment is its body.
func (s *Service) notifyAssignee(ctx context.Context, tx querier, tenant, assignee uuid.UUID, d decision, event uuid.UUID, title, body string) error {
	if s.Recipients == nil || s.Audience == nil {
		return nil
	}
	n := inbox.Notice{
		Kind: noticeAssigned, Severity: inbox.SeverityWarning, Title: clip(title, maxNoticeTitle), Body: body,
		Unit: d.unit, Permission: actionReview, SourceEvent: event,
	}
	if d.trip != nil {
		n.Object = &inbox.Object{ModuleKey: "fleet", EntityType: "trip", EntityID: *d.trip}
	}
	return s.enqueue(ctx, tx, tenant, assignee, n)
}

// clip cuts s to n characters (the title of a notification is 1…300).
func clip(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
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
