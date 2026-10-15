package inbox

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/events"
)

// Pools reaches the database of a tenant (tenantctx.Pools: sentinel-checked, never a fallback database).
type Pools interface {
	For(ctx context.Context, tenantID uuid.UUID) (*pgxpool.Pool, error)
}

// Delivery is one notice for one person of the tenant of an event.
type Delivery struct {
	PersonID uuid.UUID // people.person_profiles.id in the tenant DB of the event
	Notice   Notice    // SourceEvent is set by the consumer; an empty Kind becomes KindOf(event type)
}

// Route turns an outbox message into deliveries (who is told what). It must not write: the consumer enqueues the
// deliveries in its own transaction.
type Route func(ctx context.Context, m events.Message) ([]Delivery, error)

// Consumer is an outbox handler (events.Handler) that enqueues the notifications of an event: the recipients are
// resolved and checked (Enqueue) and the rows are written in one transaction of the tenant DB together with
// events.Once, so a repeated delivery of the event adds nothing. A producer registers it in cmd/worker:
//
//	reg.Handle("access.ownership.transferred.v1", (&inbox.Consumer{Name: "notify.inbox.ownership", …}).Handle)
type Consumer struct {
	Name       string // consumer of outbox.inbox, unique per route
	Pools      Pools
	Recipients Recipients
	Audience   Audience
	Route      Route
	Log        *slog.Logger // optional: skipped recipients are logged at debug level
}

// Handle implements events.Handler. A person without an active membership and a recipient outside the audience
// are skipped; an invalid notice or a failing database is an error (the worker retries, then dead-letters).
func (c *Consumer) Handle(ctx context.Context, m events.Message) error {
	deliveries, err := c.Route(ctx, m)
	if err != nil {
		return fmt.Errorf("inbox %s: route %s: %w", c.Name, m.Type, err)
	}
	pool, err := c.Pools.For(ctx, m.TenantID)
	if err != nil {
		return fmt.Errorf("inbox %s: %w", c.Name, err)
	}
	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		first, err := events.Once(ctx, tx, c.Name, m.EventID)
		if err != nil || !first {
			return err
		}
		for _, d := range deliveries {
			if err := c.deliver(ctx, tx, m, d); err != nil {
				return err
			}
		}
		return nil
	})
}

func (c *Consumer) deliver(ctx context.Context, tx pgx.Tx, m events.Message, d Delivery) error {
	to, err := c.Recipients.Recipient(ctx, m.TenantID, d.PersonID)
	if errors.Is(err, ErrNoRecipient) {
		c.skipped(ctx, m, d.PersonID, "no active membership")
		return nil
	}
	if err != nil {
		return fmt.Errorf("inbox %s: %w", c.Name, err)
	}
	n := d.Notice
	n.SourceEvent = m.EventID
	if n.Kind == "" {
		n.Kind = KindOf(m.Type)
	}
	out, _, err := Enqueue(ctx, tx, c.Audience, to, n)
	if err != nil {
		return fmt.Errorf("inbox %s: event %s: %w", c.Name, m.EventID, err)
	}
	if out == NotInAudience {
		c.skipped(ctx, m, d.PersonID, out.String())
	}
	return nil
}

func (c *Consumer) skipped(ctx context.Context, m events.Message, person uuid.UUID, why string) {
	if c.Log != nil {
		c.Log.DebugContext(ctx, "inbox: recipient skipped", slog.String("consumer", c.Name),
			slog.String("event_id", m.EventID.String()), slog.String("person_id", person.String()), slog.String("reason", why))
	}
}
