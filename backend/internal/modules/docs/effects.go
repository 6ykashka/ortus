package docs

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strconv"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
)

// Aggregates of the events of documents.
const (
	aggDocument = "docs.document"
	aggFolder   = "docs.folder"
	aggJob      = "docs.job"
)

// sortBy sorts s by cmp (a short name for slices.SortFunc).
func sortBy[T any](s []T, cmp func(a, b T) int) { slices.SortFunc(s, cmp) }

// offsetCursor / parseOffset are the cursor of a list read in full from the database (the journal).
func offsetCursor(n int) string { return strconv.Itoa(n) }

func parseOffset(c string) (int, bool) {
	n, err := strconv.Atoi(c)
	return n, err == nil && n >= 0
}

// activityID is the stable id of an audit entry for the contract (audit.events.id is a number).
func activityID(n int64) uuid.UUID {
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte("ortus.docs.activity."+strconv.FormatInt(n, 10)))
}

// publish writes an event of documents (outbox, in the transaction of the command) and returns its id. The platform
// wants three names before the version; two-name events of the contract (docs.created, docs.moved, docs.shared,
// docs.approved, docs.signed) are published as docs.document.<fact> (Q-W7.23-1).
func (r *req) publish(ctx context.Context, typ, aggregate string, id uuid.UUID, payload map[string]any) (uuid.UUID, error) {
	if payload == nil {
		payload = map[string]any{}
	}
	payload["actorId"] = r.me.id
	return events.Publish(ctx, r.tx, events.Event{Type: typ + ".v1", Aggregate: aggregate, AggregateID: id, Payload: payload})
}

// publishService writes an event of a job or of the document server (no member acts).
func (r *req) publishService(ctx context.Context, typ, aggregate string, id uuid.UUID, payload map[string]any) (uuid.UUID, error) {
	if payload == nil {
		payload = map[string]any{}
	}
	return events.Publish(ctx, r.tx, events.Event{Type: typ + ".v1", Aggregate: aggregate, AggregateID: id, Payload: payload})
}

// recordService writes the journal of a document for the service (the document server, a job of the worker).
func (r *req) recordService(ctx context.Context, action string, doc uuid.UUID, details string) error {
	e := audit.Event{ActorKind: audit.ActorService, Action: action, TargetType: aggDocument, TargetID: doc, Result: audit.OK,
		RequestID: "docs-" + uuid.NewString(), Diff: map[string]any{"details": details}}
	return audit.Record(ctx, r.tx, e)
}

// notify enqueues a notification for each of people about the document (the texts of the domain ctx.emit): a person
// without an active membership is skipped; without recipients and an audience the service sends none.
func (r *req) notify(ctx context.Context, kind, title string, doc, event uuid.UUID, people []uuid.UUID) error {
	if r.s.Recipients == nil || r.s.Audience == nil {
		return nil
	}
	n := inbox.Notice{Kind: kind, Severity: inbox.SeverityInfo, Title: clip(title, 300), SourceEvent: event}
	if doc != uuid.Nil {
		n.Object = &inbox.Object{ModuleKey: "docs", EntityType: "document", EntityID: doc}
	}
	seen := map[uuid.UUID]bool{}
	for _, p := range people {
		if seen[p] || p == uuid.Nil || p == r.me.id {
			continue
		}
		seen[p] = true
		to, err := r.s.Recipients.Recipient(ctx, r.tc.TenantID, p)
		if errors.Is(err, inbox.ErrNoRecipient) {
			continue
		}
		if err != nil {
			return fmt.Errorf("docs: recipient: %w", err)
		}
		if _, _, err := inbox.Enqueue(ctx, r.tx, r.s.Audience, to, n); err != nil {
			return fmt.Errorf("docs: notify: %w", err)
		}
	}
	return nil
}

// record writes the journal of a document: the audit entry the activity of the document reads (details in the diff).
// Changes of access and external links are sensitive (docs.share, docs.share_external).
func (r *req) record(ctx context.Context, action string, target uuid.UUID, details string, sensitive bool, diff map[string]any) error {
	e := audit.ForRequest(ctx)
	e.ActorKind, e.ActorID = audit.ActorPerson, r.me.id
	if e.RequestID == "" {
		e.RequestID = "docs-" + uuid.NewString()
	}
	if diff == nil {
		diff = map[string]any{}
	}
	diff["details"] = details
	e.Action, e.TargetType, e.TargetID, e.Diff = action, aggDocument, target, diff
	if sensitive {
		e.Sensitivity = audit.Sensitive
	}
	return audit.Record(ctx, r.tx, e)
}

// recordFolder writes the audit of a folder (it has no activity of its own).
func (r *req) recordFolder(ctx context.Context, action string, target uuid.UUID, diff map[string]any) error {
	e := audit.ForRequest(ctx)
	e.ActorKind, e.ActorID = audit.ActorPerson, r.me.id
	if e.RequestID == "" {
		e.RequestID = "docs-" + uuid.NewString()
	}
	e.Action, e.TargetType, e.TargetID, e.Diff, e.Sensitivity = action, aggFolder, target, diff, audit.Sensitive
	return audit.Record(ctx, r.tx, e)
}
