package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/importer"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/realtime"
)

// Тесты W-1 брифа W1.42: реестр потребителей outbox, маршрут уведомлений владения, уборка импортов, конфигурация.

// W-1: реестр знает события этапа 1 — битое событие известного типа даёт ошибку обработчика (повтор, затем
// dead-letter), а не «доставлено никому» (events.Registry.Dispatch молчит только о типе без обработчиков).
func TestNewRegistryHandlers(t *testing.T) {
	t.Parallel()
	reg := newRegistry(registryDeps{log: slog.New(slog.DiscardHandler)})
	for _, typ := range []string{realtime.EventPolicyBumped, eventOwnerChanged} {
		m := events.Message{TenantID: uuid.New(), EventID: uuid.New(), Type: typ, Payload: []byte(`not json`)}
		if err := reg.Dispatch(t.Context(), m); err == nil {
			t.Errorf("%s: no handler in the registry", typ)
		}
	}
	if err := reg.Dispatch(t.Context(), events.Message{Type: "spa.visit.completed.v1", Payload: []byte(`{}`)}); err != nil {
		t.Errorf("an event without consumers: %v", err)
	}
}

func ownerEvent(t *testing.T, payload any) events.Message {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	return events.Message{TenantID: uuid.New(), EventID: uuid.New(), Type: eventOwnerChanged, Aggregate: "access.owner", Payload: raw}
}

type wantNotice struct {
	person          uuid.UUID
	title, severity string
	link            string
}

func noticesOf(ds []inbox.Delivery) []wantNotice {
	out := make([]wantNotice, 0, len(ds))
	for _, d := range ds {
		out = append(out, wantNotice{person: d.PersonID, title: d.Notice.Title, severity: d.Notice.Severity, link: d.Notice.Link})
	}
	return out
}

// W-1 (Q-W0.08-3, Q-W0.08-6): передача — уведомление новому владельцу; снятие — снятому и остальным владельцам;
// действующий себе не пишет. Уведомления обычные (без права и подразделения), годные для порта входящих.
func TestOwnerNotices(t *testing.T) {
	t.Parallel()
	actor, target, other := uuid.New(), uuid.New(), uuid.New()
	transferred := wantNotice{person: target, title: "Вам передано владение бизнесом", severity: inbox.SeverityInfo, link: "/users"}
	cases := map[string]struct {
		payload any
		want    []wantNotice
	}{
		"передача": {map[string]any{"change": "transfer", "actorPersonId": actor, "memberIds": []uuid.UUID{target},
			"ownerIds": []uuid.UUID{target, other}}, []wantNotice{transferred}},
		"снятие": {map[string]any{"change": "revoke", "actorPersonId": actor, "memberIds": []uuid.UUID{target},
			"ownerIds": []uuid.UUID{actor, other}}, []wantNotice{
			{person: target, title: "Вы больше не владелец бизнеса", severity: inbox.SeverityWarning},
			{person: other, title: "Изменён состав владельцев бизнеса", severity: inbox.SeverityInfo, link: "/users"},
		}},
		"снял себя сам": {map[string]any{"change": "revoke", "actorPersonId": actor, "memberIds": []uuid.UUID{actor},
			"ownerIds": []uuid.UUID{other}}, []wantNotice{
			{person: other, title: "Изменён состав владельцев бизнеса", severity: inbox.SeverityInfo, link: "/users"},
		}},
		"неизвестное изменение": {map[string]any{"change": "merge", "memberIds": []uuid.UUID{target}}, []wantNotice{}},
	}
	for name, tc := range cases {
		ds, err := ownerNotices(t.Context(), ownerEvent(t, tc.payload))
		if err != nil {
			t.Errorf("%s: %v", name, err)
			continue
		}
		if got := noticesOf(ds); !slices.Equal(got, tc.want) {
			t.Errorf("%s: deliveries %+v, want %+v", name, got, tc.want)
		}
		for _, d := range ds {
			if err := d.Notice.Validate(); err != nil || d.Notice.Permission != "" || d.Notice.Unit != uuid.Nil {
				t.Errorf("%s: notice %+v: %v; want a valid normal notice", name, d.Notice, err)
			}
		}
	}
	if _, err := ownerNotices(t.Context(), events.Message{Type: eventOwnerChanged, Payload: []byte(`{"memberIds": "x"}`)}); err == nil {
		t.Error("a malformed payload: no error")
	}
}

// W-1 (Q-W1.05-17): уборка импортов проходит все организации на момент часов приложения; сбой одной не
// останавливает остальные и возвращается ошибкой с её id.
func TestImportPurgeOnce(t *testing.T) {
	t.Parallel()
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	at := time.Date(2026, 10, 2, 9, 0, 0, 0, time.UTC)
	var (
		mu   sync.Mutex
		seen []uuid.UUID
	)
	p := importPurge{
		tenants: func(context.Context) ([]uuid.UUID, error) { return []uuid.UUID{a, b, c}, nil },
		purge: func(_ context.Context, tenant uuid.UUID, now time.Time) (importer.PurgeResult, error) {
			mu.Lock()
			defer mu.Unlock()
			if !now.Equal(at) {
				return importer.PurgeResult{}, fmt.Errorf("now = %v", now)
			}
			seen = append(seen, tenant)
			if tenant == b {
				return importer.PurgeResult{}, errors.New("tenant DB unreachable")
			}
			return importer.PurgeResult{Expired: 1}, nil
		},
		now: func() time.Time { return at }, every: time.Minute, log: slog.New(slog.DiscardHandler),
	}
	err := p.once(t.Context())
	if err == nil || !strings.Contains(err.Error(), b.String()) {
		t.Fatalf("once = %v, want the error of %s", err, b)
	}
	if !slices.Equal(seen, []uuid.UUID{a, b, c}) {
		t.Fatalf("purged %v, want every tenant", seen)
	}
	p.tenants = func(context.Context) ([]uuid.UUID, error) { return nil, errors.New("control DB down") }
	if err := p.once(t.Context()); err == nil {
		t.Fatal("no tenants: no error")
	}
}
