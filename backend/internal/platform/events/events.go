// Package events is the transactional outbox of the tenant DB (W1.01, S1-24, A-11): a command publishes its
// domain events in the transaction of its change (Publish, role ortus_api — insert only), and the worker
// (cmd/worker, role ortus_worker) delivers them to the handlers of a Registry with a lease, retries with backoff,
// a dead-letter after MaxAttempts and a manual retry. A consumer drops repeated deliveries with Once (outbox.inbox).
package events

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Errors of the package.
var (
	ErrInvalid   = errors.New("events: invalid event")
	ErrLeaseLost = errors.New("events: the lease of the event was lost (another worker took it over)")
	ErrNotDead   = errors.New("events: the event is not in the dead-letter")
)

// DB is a pgx pool, connection or transaction.
type DB interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Event is a domain event to publish. Type is <domain>.<entity>.<fact>.v<N> (fleet.trip.submitted.v1); the
// payload carries no restricted fields (tenant 0001).
type Event struct {
	Type        string
	Aggregate   string
	AggregateID uuid.UUID
	Payload     any       // marshalled to JSON; nil = {}
	AvailableAt time.Time // zero = now (deliver at once)
}

// Message is an event delivered to a handler.
type Message struct {
	TenantID    uuid.UUID
	ID          int64
	EventID     uuid.UUID
	Type        string
	Aggregate   string
	AggregateID uuid.UUID
	Payload     json.RawMessage
	OccurredAt  time.Time
	Attempts    int // deliveries so far, this one included
}

// Handler consumes one message; an error schedules a retry.
type Handler func(ctx context.Context, m Message) error

var (
	typeRE      = regexp.MustCompile(`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}\.v[1-9][0-9]*$`)
	aggregateRE = regexp.MustCompile(`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$`)
)

const publishSQL = `
insert into outbox.events (type, aggregate, aggregate_id, payload, available_at)
values ($1, $2, $3, $4, coalesce($5::timestamptz, now()))
returning event_id`

// Publish inserts e into outbox.events through db, the transaction of the change, and returns its event_id.
// The payload must marshal to a JSON object.
func Publish(ctx context.Context, db DB, e Event) (uuid.UUID, error) {
	switch {
	case !typeRE.MatchString(e.Type):
		return uuid.Nil, fmt.Errorf("%w: type %q: want <domain>.<entity>.<fact>.v<N>", ErrInvalid, e.Type)
	case !aggregateRE.MatchString(e.Aggregate):
		return uuid.Nil, fmt.Errorf("%w: aggregate %q", ErrInvalid, e.Aggregate)
	case e.AggregateID == uuid.Nil:
		return uuid.Nil, fmt.Errorf("%w: no aggregate id", ErrInvalid)
	}
	payload := []byte("{}")
	if e.Payload != nil {
		b, err := json.Marshal(e.Payload)
		if err != nil {
			return uuid.Nil, fmt.Errorf("%w: payload: %w", ErrInvalid, err)
		}
		if len(b) == 0 || b[0] != '{' {
			return uuid.Nil, fmt.Errorf("%w: payload must be a JSON object", ErrInvalid)
		}
		payload = b
	}
	var at any
	if !e.AvailableAt.IsZero() {
		at = e.AvailableAt
	}
	var id uuid.UUID
	if err := db.QueryRow(ctx, publishSQL, e.Type, e.Aggregate, e.AggregateID, payload, at).Scan(&id); err != nil {
		return uuid.Nil, fmt.Errorf("events: publish %s: %w", e.Type, err)
	}
	return id, nil
}

// Once records that consumer processed eventID (outbox.inbox) and reports whether this is the first time. Call it
// in the transaction of the consumer's effect.
func Once(ctx context.Context, db DB, consumer string, eventID uuid.UUID) (bool, error) {
	tag, err := db.Exec(ctx, `insert into outbox.inbox (consumer, event_id) values ($1, $2) on conflict do nothing`,
		consumer, eventID)
	if err != nil {
		return false, fmt.Errorf("events: inbox %s: %w", consumer, err)
	}
	return tag.RowsAffected() == 1, nil
}

// Registry maps event types to handlers; it is built explicitly by cmd/worker (no init()).
type Registry struct{ handlers map[string][]Handler }

// NewRegistry returns an empty registry.
func NewRegistry() *Registry { return &Registry{handlers: map[string][]Handler{}} }

// Handle adds h for eventType.
func (r *Registry) Handle(eventType string, h Handler) {
	r.handlers[eventType] = append(r.handlers[eventType], h)
}

// Dispatch runs the handlers of m.Type in registration order and returns the first error (a panic is an error).
// A type without handlers is delivered to nobody and succeeds.
func (r *Registry) Dispatch(ctx context.Context, m Message) error {
	for _, h := range r.handlers[m.Type] {
		if err := call(ctx, h, m); err != nil {
			return err
		}
	}
	return nil
}

func call(ctx context.Context, h Handler, m Message) (err error) {
	defer func() {
		if v := recover(); v != nil {
			err = fmt.Errorf("events: handler of %s panicked: %v", m.Type, v)
		}
	}()
	return h(ctx, m)
}

// maxBackoff caps DefaultBackoff.
const maxBackoff = time.Hour

// DefaultBackoff is the pause before delivery attempt+1: 1 s, 2 s, 4 s… up to one hour.
func DefaultBackoff(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	if attempt > 13 { // 2^12 s > 1 h
		return maxBackoff
	}
	return min(time.Second<<(attempt-1), maxBackoff)
}
