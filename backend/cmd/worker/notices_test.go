package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Возврат 2 W1.42: notifications.changed уходит только тем, кому consumer поставил уведомление. Обработчик
// сообщения здесь — настоящий inbox.Enqueue (W1.10) над поддельной tenant DB: если владелец inbox спросит аудиторию
// раньше проверки живого профиля или запишет уведомление без неё, тест покраснеет без testcontainers.
func TestHintAdmittedEnqueuedOnly(t *testing.T) {
	t.Parallel()
	tenant := uuid.New()
	enqueued, archived, outside := uuid.New(), uuid.New(), uuid.New()
	db := fakeTenantDB{archived: []uuid.UUID{archived}}
	aud := fakeAudience{enqueued, archived} // the archived profile is in the audience: only the order of Enqueue drops it
	enqueue := func(persons ...uuid.UUID) handleWith {
		return func(ctx context.Context, _ events.Message, aud inbox.Audience) error {
			for _, p := range persons {
				to := tenantctx.TenantContext{TenantID: tenant, PersonID: p}
				n := inbox.Notice{Kind: "access.owner.changed", Title: titleOwnerGranted, Link: linkMembers}
				if _, _, err := inbox.Enqueue(ctx, db, aud, to, n); err != nil {
					return err
				}
			}
			return nil
		}
	}
	errHandle, errHint := errors.New("tenant DB down"), errors.New("control DB down")
	for _, tc := range []struct {
		name    string
		handle  handleWith
		hintErr error
		wantErr error
		want    [][]uuid.UUID // the persons of each hint
	}{
		{name: "only the enqueued", handle: enqueue(enqueued, archived, outside, enqueued), want: [][]uuid.UUID{{enqueued}}},
		{name: "nobody enqueued: no hint, never an empty list", handle: enqueue(archived, outside)},
		{name: "repeated delivery enqueues nothing", handle: enqueue()},
		{
			name: "failed handling: the error, no hint",
			handle: func(ctx context.Context, m events.Message, a inbox.Audience) error {
				_ = enqueue(enqueued)(ctx, m, a)
				return errHandle
			},
			wantErr: errHandle,
		},
		{name: "failed hint is not a failed event", handle: enqueue(enqueued), hintErr: errHint, want: [][]uuid.UUID{{enqueued}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			var got [][]uuid.UUID
			hint := func(_ context.Context, tenantID uuid.UUID, persons []uuid.UUID) error {
				if tenantID != tenant {
					t.Errorf("hint for tenant %s, want %s", tenantID, tenant)
				}
				got = append(got, slices.Clone(persons))
				return tc.hintErr
			}
			h := hintAdmitted(aud, tc.handle, hint, "notify.inbox.owner", slog.New(slog.DiscardHandler))
			err := h(t.Context(), events.Message{EventID: uuid.New(), TenantID: tenant, Type: eventOwnerChanged})
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("handler error = %v, want %v", err, tc.wantErr)
			}
			if !slices.EqualFunc(got, tc.want, slices.Equal) {
				t.Fatalf("hints = %v, want %v", got, tc.want)
			}
		})
	}
}

// fakeAudience admits its persons.
type fakeAudience []uuid.UUID

func (a fakeAudience) Admits(_ context.Context, tc tenantctx.TenantContext, _ inbox.Rule) (bool, error) {
	return slices.Contains(a, tc.PersonID), nil
}

// fakeTenantDB answers the two statements of inbox.Enqueue: the live profile and the insert of the notice.
type fakeTenantDB struct{ archived []uuid.UUID }

func (fakeTenantDB) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, errors.New("unexpected Exec")
}

func (fakeTenantDB) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("unexpected Query")
}

func (db fakeTenantDB) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	person, _ := args[0].(uuid.UUID)
	switch {
	case strings.Contains(sql, "people.person_profiles"):
		return fakeRow{value: !slices.Contains(db.archived, person)}
	case strings.Contains(sql, "insert into notify.notifications"):
		return fakeRow{value: uuid.New()}
	}
	return fakeRow{err: fmt.Errorf("unexpected SQL %q", sql)}
}

type fakeRow struct {
	value any
	err   error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	switch d := dest[0].(type) {
	case *bool:
		*d, _ = r.value.(bool)
	case *uuid.UUID:
		*d, _ = r.value.(uuid.UUID)
	default:
		return fmt.Errorf("unexpected destination %T", dest[0])
	}
	return nil
}
