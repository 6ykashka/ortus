//go:build integration

package inbox_test

import (
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	harness "github.com/ortus/ortus-crm/backend/test"
)

func ids(items []inbox.Notification) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(items))
	for _, n := range items {
		out = append(out, n.ID)
	}
	return out
}

// feed is the notifications of a.manager-msk1 in tenant A: visible ones (trips of Москва-1, a plain one, a read
// one) and ones the audience hides now (Москва-2, earnings, archived) or that belong to someone else.
type feed struct {
	e                   *env
	visible             []uuid.UUID // newest first
	unread              int
	newestHidden        uuid.UUID
	foreign, hiddenMsk2 uuid.UUID
}

func newFeed(t *testing.T, name string) feed {
	t.Helper()
	e := load(t, name)
	me := e.tc(t, "a.manager-msk1").PersonID
	msk1, msk2 := e.id(t, "unit:a.msk1"), e.id(t, "unit:a.msk2")
	trips := func(ago int) row {
		return row{person: me, minutesAgo: ago, permission: "fleet.trips.review", unit: msk1}
	}
	f := feed{e: e}
	f.newestHidden = e.insert(t, row{person: me, minutesAgo: 1, permission: "fleet.trips.review", unit: msk2})
	f.hiddenMsk2 = f.newestHidden
	e.insert(t, row{person: me, minutesAgo: 2, permission: "fleet.earnings.read", unit: msk1, sensitivity: inbox.SensitivityRestricted})
	e.insert(t, row{person: me, minutesAgo: 3, permission: "fleet.trips.review", unit: msk1, archived: true})
	f.foreign = e.insert(t, row{person: e.tc(t, "a.manager-msk2").PersonID, minutesAgo: 4})
	for ago := 10; ago <= 14; ago++ {
		f.visible = append(f.visible, e.insert(t, trips(ago)))
	}
	f.visible = append(f.visible, e.insert(t, row{person: me, minutesAgo: 20}))
	f.visible = append(f.visible, e.insert(t, row{person: me, minutesAgo: 30, permission: "fleet.trips.review", unit: msk1, read: true}))
	f.unread = 6
	return f
}

// Выдача: лента новыми сверху по курсору, только видимые сейчас уведомления; unreadCount — по видимым.
func TestInboxListPages(t *testing.T) {
	t.Parallel()
	f := newFeed(t, "inbox_list")
	tc := f.e.tc(t, "a.manager-msk1")
	if got := pages(t, f, inbox.Query{Limit: 3}); !slices.Equal(got, f.visible) {
		t.Fatalf("feed = %v\nwant %v", got, f.visible)
	}
	unread, err := f.e.in.List(t.Context(), tc, inbox.Query{UnreadOnly: true, Limit: 50})
	if err != nil || len(unread.Items) != f.unread || unread.NextCursor != "" {
		t.Fatalf("unread filter: %d items, next %q, %v", len(unread.Items), unread.NextCursor, err)
	}
	checkItem(t, unread.Items[0])
	if last, _ := f.e.in.List(t.Context(), tc, inbox.Query{Limit: 50}); last.Items[len(last.Items)-1].ReadAt == nil {
		t.Fatal("a read notification has no readAt")
	}
}

// checkItem checks the fields of an unread notification written by row.
func checkItem(t *testing.T, n inbox.Notification) {
	t.Helper()
	if n.Kind != "fleet.trip.submitted" || n.Severity != inbox.SeverityInfo || n.ReadAt != nil ||
		n.Body == nil || *n.Body != "Проверьте рейс" || n.Link == nil || *n.Link != "/fleet/trips/R-102" ||
		n.Object == nil || n.Object.ModuleKey != "fleet" || n.Object.EntityType != "trip" {
		t.Fatalf("item = %+v", n)
	}
}

// pages follows the cursors of q from the first page and returns the ids of every page, checking unreadCount.
func pages(t *testing.T, f feed, q inbox.Query) []uuid.UUID {
	t.Helper()
	tc := f.e.tc(t, "a.manager-msk1")
	var got []uuid.UUID
	for n := range 6 {
		p, err := f.e.in.List(t.Context(), tc, q)
		if err != nil {
			t.Fatal(err)
		}
		if p.Unread != int64(f.unread) || len(p.Items) > q.Limit {
			t.Fatalf("page %d: unread %d, %d items", n, p.Unread, len(p.Items))
		}
		got = append(got, ids(p.Items)...)
		if p.NextCursor == "" {
			return got
		}
		q.Cursor = p.NextCursor
	}
	t.Fatal("cursor does not advance")
	return nil
}

// Курсор привязан к выборке: другой фильтр, другой субъект или мусор — ErrBadCursor.
func TestInboxCursorBinding(t *testing.T) {
	t.Parallel()
	f := newFeed(t, "inbox_cursor")
	tc := f.e.tc(t, "a.manager-msk1")
	p, err := f.e.in.List(t.Context(), tc, inbox.Query{Limit: 1})
	if err != nil || p.NextCursor == "" {
		t.Fatalf("first page: %+v %v", p, err)
	}
	for name, q := range map[string]inbox.Query{
		"другой фильтр": {Limit: 1, Cursor: p.NextCursor, UnreadOnly: true},
		"мусор":         {Limit: 1, Cursor: "bm90LWEtY3Vyc29y"},
	} {
		if _, err := f.e.in.List(t.Context(), tc, q); !errors.Is(err, inbox.ErrBadCursor) {
			t.Errorf("%s: %v, want ErrBadCursor", name, err)
		}
	}
	other := f.e.tc(t, "a.manager-msk2")
	if _, err := f.e.in.List(t.Context(), other, inbox.Query{Limit: 1, Cursor: p.NextCursor}); !errors.Is(err, inbox.ErrBadCursor) {
		t.Errorf("another person: %v, want ErrBadCursor", err)
	}
}

// Сводка: непрочитанные и время последнего видимого уведомления; скрытое аудиторией не учитывается.
func TestInboxSummary(t *testing.T) {
	t.Parallel()
	f := newFeed(t, "inbox_summary")
	c, err := f.e.in.Summary(t.Context(), f.e.tc(t, "a.manager-msk1"))
	want := harness.Now().Add(-10 * time.Minute)
	if err != nil || c.Unread != int64(f.unread) || c.LatestAt == nil || !c.LatestAt.Equal(want) {
		t.Fatalf("summary = %+v %v; want unread %d, latest %s", c, err, f.unread, want)
	}
	empty, err := f.e.in.Summary(t.Context(), f.e.tc(t, "a.two-roles"))
	if err != nil || empty.Unread != 0 || empty.LatestAt != nil {
		t.Fatalf("no notifications: %+v %v", empty, err)
	}
	if c, err := f.e.in.Summary(t.Context(), f.e.tc(t, "a.owner")); err != nil || c.Unread != 0 {
		t.Fatalf("owner sees notifications of others: %+v %v", c, err)
	}
}

// Проверка адресата при выдаче: отзыв роли скрывает уведомления и уменьшает счётчик сразу, старый курсор
// недействителен (смена версии политики).
func TestInboxRevokedRole(t *testing.T) {
	t.Parallel()
	f := newFeed(t, "inbox_revoke")
	tc := f.e.tc(t, "a.manager-msk1")
	p, err := f.e.in.List(t.Context(), tc, inbox.Query{Limit: 1})
	if err != nil || p.NextCursor == "" {
		t.Fatalf("first page: %v", err)
	}
	super := f.e.super(t)
	if _, err := super.ExecContext(t.Context(), `update access.role_assignments set state = 'revoked', revoked_at = now()
		where principal_kind = 'person' and principal_id = $1`, tc.PersonID); err != nil {
		t.Fatal(err)
	}
	if _, err := super.ExecContext(t.Context(), `update access.policy_state set policy_version = policy_version + 1`); err != nil {
		t.Fatal(err)
	}
	c, err := f.e.in.Summary(t.Context(), tc)
	if err != nil || c.Unread != 1 {
		t.Fatalf("after revocation: %+v %v; want only the plain notification", c, err)
	}
	all, err := f.e.in.List(t.Context(), tc, inbox.Query{Limit: 50})
	if err != nil || len(all.Items) != 1 || all.Items[0].ID != f.visible[5] {
		t.Fatalf("after revocation: %v %v", ids(all.Items), err)
	}
	if _, err := f.e.in.List(t.Context(), tc, inbox.Query{Limit: 1, Cursor: p.NextCursor}); !errors.Is(err, inbox.ErrBadCursor) {
		t.Fatalf("cursor issued before the revocation: %v", err)
	}
}

func (e *env) readAt(t *testing.T, id uuid.UUID) *time.Time {
	t.Helper()
	var at *time.Time
	if err := e.super(t).QueryRowContext(t.Context(), `select read_at from notify.notifications where id = $1`, id).Scan(&at); err != nil {
		t.Fatal(err)
	}
	return at
}

// Отметка «прочитано»: по id (чужие, скрытые и несуществующие игнорируются без раскрытия) и по upTo; уже
// прочитанные сохраняют readAt.
func TestInboxMarkRead(t *testing.T) {
	t.Parallel()
	f := newFeed(t, "inbox_mark")
	tc := f.e.tc(t, "a.manager-msk1")
	left, err := f.e.in.MarkRead(t.Context(), tc, inbox.Mark{IDs: []uuid.UUID{f.visible[0], f.foreign, f.hiddenMsk2, uuid.New()}})
	if err != nil || left != int64(f.unread-1) {
		t.Fatalf("mark by ids: %d %v", left, err)
	}
	if f.e.readAt(t, f.visible[0]) == nil || f.e.readAt(t, f.foreign) != nil || f.e.readAt(t, f.hiddenMsk2) != nil {
		t.Fatal("mark by ids touched the wrong notifications")
	}
	readBefore := f.e.readAt(t, f.visible[6])
	upTo := harness.Now().Add(-12 * time.Minute)
	left, err = f.e.in.MarkRead(t.Context(), tc, inbox.Mark{UpTo: &upTo})
	if err != nil || left != 1 {
		t.Fatalf("mark up to: %d %v; want 1 left (11 minutes ago; 10 minutes ago was marked by id)", left, err)
	}
	if f.e.readAt(t, f.visible[1]) != nil || f.e.readAt(t, f.visible[3]) == nil || f.e.readAt(t, f.hiddenMsk2) != nil {
		t.Fatal("mark up to touched the wrong notifications")
	}
	if after := f.e.readAt(t, f.visible[6]); after == nil || !after.Equal(*readBefore) {
		t.Fatalf("readAt of a read notification changed: %v → %v", readBefore, after)
	}
}
