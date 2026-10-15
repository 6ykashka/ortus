//go:build integration

package inbox_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
)

// Потребитель outbox: событие → адресаты → уведомления в одной транзакции с events.Once. Повтор доставки не
// создаёт второе уведомление; адресат без членства и адресат вне аудитории пропускаются без ошибки.
func TestConsumerEnqueuesOnce(t *testing.T) {
	t.Parallel()
	e := load(t, "inbox_consumer")
	manager, other := e.tc(t, "a.manager-msk1"), e.tc(t, "a.manager-msk2")
	msk1 := e.id(t, "unit:a.msk1")
	stranger := e.id(t, "person:b.owner@b")
	c := &inbox.Consumer{
		Name: "inbox.test", Pools: e.pools, Recipients: inbox.PGRecipients{Control: e.control}, Audience: e.aud,
		Route: func(context.Context, events.Message) ([]inbox.Delivery, error) {
			n := inbox.Notice{Title: "Рейс R-102 сдан", Permission: "fleet.trips.review", Unit: msk1}
			return []inbox.Delivery{
				{PersonID: manager.PersonID, Notice: n},
				{PersonID: other.PersonID, Notice: n}, // Москва-2: не адресат уведомления по Москва-1
				{PersonID: stranger, Notice: n},       // профиль организации B: в A нет членства
			}, nil
		},
	}
	m := events.Message{
		TenantID: e.id(t, "tenant:a"), EventID: uuid.New(), Type: "fleet.trip.submitted.v1",
		Aggregate: "fleet.trip", AggregateID: uuid.New(),
	}
	for range 2 {
		if err := c.Handle(t.Context(), m); err != nil {
			t.Fatal(err)
		}
	}
	if e.count(t, manager.PersonID) != 1 || e.count(t, other.PersonID) != 0 || e.count(t, stranger) != 0 {
		t.Fatalf("rows: manager %d, other %d, stranger %d", e.count(t, manager.PersonID), e.count(t, other.PersonID), e.count(t, stranger))
	}
	var kind string
	var source uuid.UUID
	if err := e.super(t).QueryRowContext(t.Context(),
		`select kind, source_event_id from notify.notifications where recipient_person_id = $1`, manager.PersonID).
		Scan(&kind, &source); err != nil {
		t.Fatal(err)
	}
	if kind != "fleet.trip.submitted" || source != m.EventID {
		t.Fatalf("kind %q, source %s; want fleet.trip.submitted, %s", kind, source, m.EventID)
	}
	var inboxRows int
	if err := e.super(t).QueryRowContext(t.Context(),
		`select count(*) from outbox.inbox where consumer = 'inbox.test' and event_id = $1`, m.EventID).Scan(&inboxRows); err != nil {
		t.Fatal(err)
	}
	if inboxRows != 1 {
		t.Fatalf("outbox.inbox rows = %d", inboxRows)
	}
}

// Неверное уведомление производителя — ошибка обработчика (повтор, затем dead-letter), а не тихий пропуск;
// транзакция откатывается вместе с отметкой events.Once.
func TestConsumerInvalidNoticeFails(t *testing.T) {
	t.Parallel()
	e := load(t, "inbox_consumer_bad")
	owner := e.tc(t, "a.owner")
	c := &inbox.Consumer{
		Name: "inbox.test", Pools: e.pools, Recipients: inbox.PGRecipients{Control: e.control}, Audience: e.aud,
		Route: func(context.Context, events.Message) ([]inbox.Delivery, error) {
			return []inbox.Delivery{{PersonID: owner.PersonID, Notice: inbox.Notice{Title: "x", Link: "//evil"}}}, nil
		},
	}
	m := events.Message{TenantID: owner.TenantID, EventID: uuid.New(), Type: "members.invitation.accepted.v1"}
	if err := c.Handle(t.Context(), m); err == nil {
		t.Fatal("invalid notice: no error")
	}
	var n int
	if err := e.super(t).QueryRowContext(t.Context(), `select count(*) from outbox.inbox where event_id = $1`, m.EventID).Scan(&n); err != nil || n != 0 {
		t.Fatalf("outbox.inbox rows %d %v: the failed delivery must not be marked processed", n, err)
	}
}
