package forms

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Events of the module (docs/12 «События», forms.md §2.3), written to the outbox with the command.
const (
	evFormCreated    = "forms.form.created"
	evFormUpdated    = "forms.form.updated"
	evFormClosed     = "forms.form.closed"
	evFormReopened   = "forms.form.reopened"
	evPublished      = "forms.version.published"
	evSubmitted      = "forms.response.submitted"
	evAccepted       = "forms.response.accepted"
	evActionFailed   = "forms.action.failed"
	aggForm          = "forms.form"
	aggResponse      = "forms.response"
	auditExport      = "forms.responses.exported"
	moduleKeyForms   = "forms"
	entityForm       = "form"
	entityResponse   = "response"
	keyFormID        = "formId"
	keyResponseID    = "responseId"
	keyVersionNumber = "versionNumber"
)

// pendingNotice is a notification of the owners to send with the command.
type pendingNotice struct {
	kind, title string
	object      uuid.UUID
	entity      string
	event       uuid.UUID
	to          []uuid.UUID // nil — the owners of the business
}

// publish writes an event of the module (outbox, in the transaction of the command) and returns its id.
func (r *req) publish(ctx context.Context, typ, aggregate string, id uuid.UUID, payload map[string]any) (uuid.UUID, error) {
	if payload == nil {
		payload = map[string]any{}
	}
	if r.me() != uuid.Nil {
		payload["actorId"] = r.me()
	}
	return events.Publish(ctx, r.tx, events.Event{Type: typ + ".v1", Aggregate: aggregate, AggregateID: id, Payload: payload})
}

// event publishes an event of the form f and queues the notice title to the owners.
func (r *req) event(ctx context.Context, typ string, formID uuid.UUID, payload map[string]any, title string) error {
	if payload == nil {
		payload = map[string]any{}
	}
	payload[keyFormID] = formID
	id, err := r.publish(ctx, typ, aggForm, formID, payload)
	if err != nil {
		return store("event", err)
	}
	if title != "" {
		r.events = append(r.events, pendingNotice{kind: typ, title: title, object: formID, entity: entityForm, event: id})
	}
	return nil
}

// flushNotices sends the notices of the command (the owners or their recipients) in its transaction.
func (r *req) flushNotices(ctx context.Context) error {
	if r.s.Audience == nil || r.s.Directory == nil {
		r.events = nil
		return nil
	}
	for _, n := range r.events {
		to := n.to
		if to == nil {
			owners, err := r.owners(ctx)
			if err != nil {
				return err
			}
			to = owners
		}
		for _, p := range to {
			if err := r.notify(ctx, p, n); err != nil {
				return err
			}
		}
	}
	r.events = nil
	return nil
}

// notify enqueues n for person (an inactive one is skipped by the inbox).
func (r *req) notify(ctx context.Context, person uuid.UUID, n pendingNotice) error {
	m, active, err := r.activeMember(ctx, person)
	if err != nil || !active {
		return err
	}
	to := tenantctx.TenantContext{TenantID: r.tc.TenantID, PersonID: person, Owner: m.Owner}
	notice := inbox.Notice{Kind: n.kind, Severity: inbox.SeverityInfo, Title: clip(n.title, 300), SourceEvent: n.event,
		Object: &inbox.Object{ModuleKey: moduleKeyForms, EntityType: n.entity, EntityID: n.object}}
	if _, _, err := inbox.Enqueue(ctx, r.tx, r.s.Audience, to, notice); err != nil && !errors.Is(err, inbox.ErrNoRecipient) {
		return fmt.Errorf("forms: notify: %w", err)
	}
	return nil
}

// record writes an audit line of the request.
func (r *req) record(ctx context.Context, action, target string, id uuid.UUID, diff map[string]any) error {
	e := audit.ForRequest(ctx)
	e.ActorKind, e.ActorID = audit.ActorPerson, r.me()
	if e.RequestID == "" {
		e.RequestID = "forms-" + uuid.NewString()
	}
	e.Action, e.TargetType, e.TargetID, e.Diff = action, target, id, diff
	return audit.Record(ctx, r.tx, e)
}
