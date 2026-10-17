package main

// W1.42: the notifications of stage 1 that come through the outbox (S1-26). The only producer of stage 1 with an
// outbox event is the change of owners (W1.06, Q-W0.08-3, Q-W0.08-6); the inbox port of W1.10 checks the recipient
// (an active member of the tenant of the event) and the audience when it enqueues.

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"slices"
	"sync"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// eventOwnerChanged is the event of a transfer or a revocation of ownership (W1.06, assignments/owners.go).
const eventOwnerChanged = "access.owner.changed.v1"

// ownerChanged is the payload of eventOwnerChanged.
type ownerChanged struct {
	Change  string      `json:"change"` // transfer | revoke
	Actor   uuid.UUID   `json:"actorPersonId"`
	Members []uuid.UUID `json:"memberIds"` // the new owner (transfer) or the removed one (revoke)
	Owners  []uuid.UUID `json:"ownerIds"`  // the owners after the change
}

// Texts of the owner notices (default of W1.42: the reference has none; the owner of the product confirms them).
const (
	titleOwnerGranted = "Вам передано владение бизнесом"
	titleOwnerRemoved = "Вы больше не владелец бизнеса"
	titleOwnersChange = "Изменён состав владельцев бизнеса"
	linkMembers       = "/users" // «Пользователи и роли», as the notices of MSW
)

// ownerNotices is the inbox.Route of eventOwnerChanged: a transfer tells the new owner; a revocation tells the
// removed owner and the other owners. The actor is never told about its own action. The notices carry no
// permission: a removed owner loses members.manage but still reads its notice.
func ownerNotices(_ context.Context, m events.Message) ([]inbox.Delivery, error) {
	var p ownerChanged
	if err := json.Unmarshal(m.Payload, &p); err != nil {
		return nil, fmt.Errorf("%s payload: %w", m.Type, err)
	}
	var out []inbox.Delivery
	kind := inbox.KindOf(m.Type) // access.owner.changed
	add := func(person uuid.UUID, n inbox.Notice) {
		if person == p.Actor || slices.ContainsFunc(out, func(d inbox.Delivery) bool { return d.PersonID == person }) {
			return
		}
		n.Kind = kind
		out = append(out, inbox.Delivery{PersonID: person, Notice: n})
	}
	switch p.Change {
	case "transfer":
		for _, member := range p.Members {
			add(member, inbox.Notice{Severity: inbox.SeverityInfo, Title: titleOwnerGranted, Link: linkMembers})
		}
	case "revoke":
		for _, member := range p.Members {
			add(member, inbox.Notice{Severity: inbox.SeverityWarning, Title: titleOwnerRemoved})
		}
		for _, owner := range p.Owners {
			add(owner, inbox.Notice{Severity: inbox.SeverityInfo, Title: titleOwnersChange, Link: linkMembers})
		}
	}
	return out, nil
}

// admitted is the audience of a consumer for one message: it records the recipients it admits. inbox.Enqueue asks
// the audience last, after the active membership (the recipient it is given comes from inbox.Recipients) and the
// live profile, and writes the notice once admitted, so these are the people the consumer enqueued for (a repeated
// delivery of the event asks nobody). TestHintAdmittedEnqueuedOnly holds this order of inbox.Enqueue; inbox.Consumer
// does not report its outcomes yet (a question to W1.10, report of W1.42, return 2).
type admitted struct {
	inbox.Audience

	mu      sync.Mutex
	persons []uuid.UUID
}

// Admits implements inbox.Audience.
func (a *admitted) Admits(ctx context.Context, tc tenantctx.TenantContext, r inbox.Rule) (bool, error) {
	ok, err := a.Audience.Admits(ctx, tc, r)
	if ok && err == nil {
		a.mu.Lock()
		if !slices.Contains(a.persons, tc.PersonID) {
			a.persons = append(a.persons, tc.PersonID)
		}
		a.mu.Unlock()
	}
	return ok, err
}

// hinted makes a consumer of the inbox also tell the recipients that their inbox changed (notifications.changed,
// ADR-0015) once the notices are enqueued — only those the consumer enqueued for, not every person of the route
// (a suspended member or one outside the audience gets no notice and no hint). The hint is best effort: the notices
// are committed, a lost hint only delays the bell until the next read.
func hinted(c *inbox.Consumer, hint hintFunc) events.Handler {
	handle := func(ctx context.Context, m events.Message, aud inbox.Audience) error {
		one := *c // the consumer of this message, with the recording audience
		one.Audience = aud
		return one.Handle(ctx, m)
	}
	return hintAdmitted(c.Audience, handle, hint, c.Name, c.Log)
}

// hintFunc tells persons of tenantID that their inbox changed.
type hintFunc func(ctx context.Context, tenantID uuid.UUID, persons []uuid.UUID) error

// handleWith handles one message with aud as the audience of the consumer.
type handleWith func(ctx context.Context, m events.Message, aud inbox.Audience) error

// hintAdmitted is hinted over the handling of a message: handle gets aud wrapped in a recorder, and the persons it
// admitted get the hint after the handling succeeds.
func hintAdmitted(aud inbox.Audience, handle handleWith, hint hintFunc, name string, log *slog.Logger) events.Handler {
	return func(ctx context.Context, m events.Message) error {
		rec := &admitted{Audience: aud}
		if err := handle(ctx, m, rec); err != nil {
			return err
		}
		if len(rec.persons) == 0 {
			return nil // an empty list would address every active member
		}
		if err := hint(ctx, m.TenantID, rec.persons); err != nil && log != nil {
			log.WarnContext(ctx, "inbox: notifications.changed", slog.String("consumer", name),
				slog.String("event_id", m.EventID.String()), slog.String("error", err.Error()))
		}
		return nil
	}
}
