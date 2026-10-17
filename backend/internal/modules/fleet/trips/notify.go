package trips

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/platform/idem"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
)

// Kinds of the notifications of the module (the event type without its version, the mock W2.00).
const (
	noticeStarted   = "fleet.trip.started"
	noticeSubmitted = "fleet.trip.submitted"
)

// candidatesSQL lists the people of the tenant who may be recipients; the audience decides who is.
const candidatesSQL = `select id from people.person_profiles where archived_at is null order by id`

// notifyManagers enqueues a notification about trip t for the managers of its area and the owner: every live person
// with an active membership whose fleet.trips.review reaches the unit of the trip now (inbox.Enqueue checks the
// recipient when it is enqueued, W1.10), in the transaction of the command.
func (s *Service) notifyManagers(ctx context.Context, tx pgx.Tx, tenant uuid.UUID, t tripRow, event uuid.UUID, kind, title string) error {
	if s.Recipients == nil || s.Audience == nil {
		return nil
	}
	rows, err := tx.Query(ctx, candidatesSQL)
	if err != nil {
		return fmt.Errorf("trips: recipients: %w", err)
	}
	people, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return fmt.Errorf("trips: recipients: %w", err)
	}
	n := inbox.Notice{
		Kind: kind, Severity: inbox.SeverityInfo, Title: title,
		Object: &inbox.Object{ModuleKey: "fleet", EntityType: "trip", EntityID: t.id},
		Unit:   t.unit, Permission: actionReview, SourceEvent: event,
	}
	for _, p := range people {
		to, err := s.Recipients.Recipient(ctx, tenant, p)
		if errors.Is(err, inbox.ErrNoRecipient) {
			continue
		}
		if err != nil {
			return fmt.Errorf("trips: recipient: %w", err)
		}
		if _, _, err := inbox.Enqueue(ctx, tx, s.Audience, to, n); err != nil {
			return fmt.Errorf("trips: notify: %w", err)
		}
	}
	return nil
}

// complete stores the outcome of a command in tx when it runs under an Idempotency-Key (10 §3.5): the body is
// encoded like the generated strict server does. Outside the guard there is nothing to store; a lost lease rolls the
// command back (409 idempotency_in_progress, retryable).
func complete(ctx context.Context, tx pgx.Tx, status int, tag string, body any) error {
	if _, ok := idem.FromContext(ctx); !ok {
		return nil
	}
	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(body); err != nil {
		return fmt.Errorf("trips: outcome: %w", err)
	}
	h := http.Header{"Content-Type": {"application/json"}}
	h.Set("ETag", tag)
	err := idem.CompleteInTx(ctx, tx, status, h, buf.Bytes())
	switch {
	case errors.Is(err, idem.ErrLeaseLost):
		return problem.Wrap(codeIdemInProgress, err)
	case err != nil:
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return nil
}

// requestID is the request id of ctx; a call outside an HTTP request gets a generated one (audit needs it).
func requestID(ctx context.Context) string {
	if id := requestid.FromContext(ctx); id != "" {
		return id
	}
	return "job-" + uuid.NewString()
}
