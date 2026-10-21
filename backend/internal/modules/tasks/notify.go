package tasks

import (
	"context"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Events of the module (design/docs/12-errors-and-events.md «Доменные события», tasks.md §2.3) and their aggregates.
const (
	evProjectCreated  = "tasks.project.created.v1"
	evProjectUpdated  = "tasks.project.updated.v1"
	evRoleSet         = "tasks.member.role_set.v1"
	evMemberRemoved   = "tasks.member.removed.v1"
	evPublished       = "tasks.workflow.published.v1"
	evTaskCreated     = "tasks.task.created.v1"
	evTransitioned    = "tasks.task.transitioned.v1"
	evApproved        = "tasks.approval.approved.v1"
	evRejected        = "tasks.approval.rejected.v1"
	evParentChanged   = "tasks.task.parent_changed.v1"
	evFilesChanged    = "tasks.task.files_changed.v1"
	evAutomation      = "tasks.automation.changed.v1"
	evAutomationRun   = "tasks.automation.run.v1"
	aggProject        = "tasks.project"
	aggTask           = "tasks.task"
	aggAutomation     = "tasks.automation"
	keyProjectID      = "projectId"
	keyTaskID         = "taskId"
	keyMemberID       = "memberId"
	keyTransitionKey  = "transitionKey"
	keyAutomationID   = "automationId"
	keyWorkflowVer    = "version"
	noticeOwnerKindPx = "tasks."
)

// publish writes a domain event of the module into the outbox in the transaction of the change.
func (r *request) publish(ctx context.Context, typ, aggregate string, id uuid.UUID, payload map[string]any) (uuid.UUID, error) {
	ev, err := events.Publish(ctx, r.tx, events.Event{Type: typ, Aggregate: aggregate, AggregateID: id, Payload: payload})
	return ev, store("publish "+typ, err)
}

// notice is a notification queued by the request: the event it tells about, its text and its recipients (nil — the
// owners of the organization, owners() of the prototype).
type notice struct {
	kind  string
	title string
	to    []uuid.UUID
	event uuid.UUID
}

// toOwners queues a notice of the prototype to the owners (event(…, owners())).
func (r *request) toOwners(kind, title string, event uuid.UUID) {
	r.notices = append(r.notices, notice{kind: noticeOwnerKindPx + kind, title: title, event: event})
}

// flushNotices enqueues the notices of the request in its transaction (inbox.Enqueue checks every recipient).
func (r *request) flushNotices(ctx context.Context) error {
	if r.s.Audience == nil || len(r.notices) == 0 {
		r.notices = nil
		return nil
	}
	for _, n := range r.notices {
		to := n.to
		if to == nil {
			owners, err := r.owners(ctx)
			if err != nil {
				return err
			}
			to = owners
		}
		for _, person := range to {
			tc := tenantctx.TenantContext{TenantID: r.tc.TenantID, PersonID: person}
			msg := inbox.Notice{Kind: n.kind, Title: clip(n.title, 300), SourceEvent: n.event}
			if _, _, err := inbox.Enqueue(ctx, r.tx, r.s.Audience, tc, msg); err != nil {
				return store("notice "+n.kind, err)
			}
		}
	}
	r.notices = nil
	return nil
}
