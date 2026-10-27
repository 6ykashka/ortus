//go:build integration

//nolint:paralleltest // the tests share the database, the clock and the table of grants of the suite
package chats

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	api "github.com/ortus/ortus-crm/backend/internal/api/chats"
)

// The jobs by term run last: they look at every chat of the tenant, and some tests move the clock far ahead.

func direct(t *testing.T) api.Chat {
	t.Helper()
	ctx, tc := as(t, "logist")
	chat, _, err := svc.CreateDirectChat(ctx, tc, api.ChatDirectCreate{MemberId: pid("driver")})
	if err != nil {
		t.Fatal(err)
	}
	return chat
}

func TestTemporaryMessagesDisappearAndAHoldKeepsThem(t *testing.T) { //nolint:gocyclo // one scenario with its checks
	resetClock(t)
	chat := direct(t)
	lctx, ltc := as(t, "logist")
	dctx, dtc := as(t, "driver")
	temp := &struct {
		TtlHours int64 `json:"ttlHours"` //nolint:revive // the name of the generated field of the contract
	}{TtlHours: 1}
	gone := must(svc.PostMessage(lctx, ltc, chat.Id, api.ChatMessageCreate{Text: new("Исчезну через час"), Ephemeral: temp}))
	if gone.Ephemeral == nil || gone.Ephemeral.TtlHours != 1 {
		t.Fatalf("ephemeral = %+v", gone.Ephemeral)
	}
	stays := must(svc.PostMessage(dctx, dtc, chat.Id, api.ChatMessageCreate{Text: new("Исчезну, но под удержанием"), Ephemeral: temp}))
	octx, otc := as(t, "owner")
	members := []uuid.UUID{pid("driver")}
	hold := must(svc.CreateHold(octx, otc, api.ChatHoldCreate{Scope: "member", MemberIds: &members, Reason: "Проверка водителя"}))
	clock.add(2 * time.Hour)
	shown := must(svc.Messages(dctx, dtc, chat.Id, nil, nil, nil, 10))
	for _, m := range shown.Items {
		if m.Id == gone.Id || m.Id == stays.Id {
			t.Fatalf("a temporary message whose time is over is in the feed: %+v", m)
		}
	}
	stats, err := svc.Sweep(t.Context(), tenantA)
	if err != nil || stats.Expired == 0 {
		t.Fatalf("stats = %+v err=%v", stats, err)
	}
	var goneText string
	var goneAt, stayAt *time.Time
	if err := superA.QueryRow(t.Context(), `select text, deleted_at from chat.messages where id = $1`, gone.Id).Scan(&goneText, &goneAt); err != nil || goneAt == nil || goneText != "" {
		t.Fatalf("the expired message: %q %v %v", goneText, goneAt, err)
	}
	var stayText string
	if err := superA.QueryRow(t.Context(), `select text, deleted_at from chat.messages where id = $1`, stays.Id).Scan(&stayText, &stayAt); err != nil || stayAt != nil || stayText == "" {
		t.Fatalf("the message under a hold must stay: %q %v %v", stayText, stayAt, err)
	}
	must(svc.ReleaseHold(octx, otc, hold.Id))
	if _, err := svc.Sweep(t.Context(), tenantA); err != nil {
		t.Fatal(err)
	}
	if err := superA.QueryRow(t.Context(), `select deleted_at from chat.messages where id = $1`, stays.Id).Scan(&stayAt); err != nil || stayAt == nil {
		t.Fatalf("after the release the message goes: %v %v", stayAt, err)
	}
}

func TestPollsCloseByTheirTermAndImportantOnesBecomeOverdue(t *testing.T) { //nolint:gocyclo // one scenario with its checks
	resetClock(t)
	chat := team(t, "Сроки: опросы и важное")
	lctx, ltc := as(t, "logist")
	poll := must(svc.PostMessage(lctx, ltc, chat.Id, api.ChatMessageCreate{Poll: &api.ChatPollCreate{Question: "Когда?", Options: []string{"Утром", "Вечером"}, ClosesInHours: new(int64(1))}}))
	imp := must(svc.PostMessage(lctx, ltc, chat.Id, api.ChatMessageCreate{Text: new("Подтвердите"), Important: &struct {
		DueDate *dateT `json:"dueDate,omitempty"`
	}{}}))
	dctx, dtc := as(t, "driver")
	must(svc.Vote(dctx, dtc, chat.Id, poll.Poll.Id, []uuid.UUID{poll.Poll.Options[1].Id}))
	clock.add(4 * 24 * time.Hour)
	stats, err := svc.Sweep(t.Context(), tenantA)
	if err != nil || stats.PollsClosed == 0 || stats.Overdue == 0 {
		t.Fatalf("stats = %+v err=%v", stats, err)
	}
	page := must(svc.Messages(dctx, dtc, chat.Id, nil, nil, nil, 20))
	closed := false
	for _, m := range page.Items {
		if m.System != nil && m.System.Title == "Опрос закрыт: «Когда?»" && m.System.Text == "Больше всего голосов: Вечером · 1" {
			closed = true
		}
		if m.Id == poll.Id && !m.Poll.Closed {
			t.Fatal("the poll stays open")
		}
	}
	if !closed {
		t.Fatalf("no result in the chat: %+v", page.Items)
	}
	var n int
	if err := superA.QueryRow(t.Context(), `select count(*) from outbox.events where type = 'chat.ack.overdue.v1' and aggregate_id = $1`, imp.Id).Scan(&n); err != nil || n != 1 {
		t.Fatalf("overdue events = %d err=%v", n, err)
	}
	// A second pass does not repeat it.
	if again, err := svc.Sweep(t.Context(), tenantA); err != nil || again.Overdue != 0 || again.PollsClosed != 0 {
		t.Fatalf("again = %+v err=%v", again, err)
	}
}

func TestAttachmentsAndDeletedContentLiveByThePolicy(t *testing.T) { //nolint:gocyclo // one scenario with its checks
	resetClock(t)
	t.Cleanup(func() { _ = exec(context.Background(), `delete from chat.policies where chat_kind = 'area'`) })
	chat := areaChat(t, "Сроки: вложения")
	octx, otc := as(t, "owner")
	if _, err := svc.UpdatePolicy(octx, otc, "area", api.ChatPolicyUpdate{Patch: api.ChatPolicyPatch{FilesDays: new(int64(30))}}); err != nil {
		t.Fatal(err)
	}
	old := must(sendFile(t, "driver", chat.Id, 500_000, "video/mp4", "старое.mp4"))
	kept := must(sendFile(t, "driver", chat.Id, 100_000, "image/jpeg", "под удержанием.jpg"))
	_ = kept
	dctx, dtc := as(t, "driver")
	del := say(t, "driver", chat.Id, "Лишнее")
	must(svc.DeleteMessage(dctx, dtc, chat.Id, del.Id, ""))
	members := []uuid.UUID{pid("logist")}
	hold := must(svc.CreateHold(octx, otc, api.ChatHoldCreate{Scope: "member", MemberIds: &members, Reason: "Проверка логиста"}))
	lctx, ltc := as(t, "logist")
	heldMsg := must(svc.PostMessage(lctx, ltc, chat.Id, api.ChatMessageCreate{Text: new("Под удержанием"), FileIds: &[]uuid.UUID{newFile(t, "logist", 50_000, "image/jpeg", "логист.jpg")}}))

	clock.add(31 * 24 * time.Hour)
	stats, err := svc.Sweep(t.Context(), tenantA)
	if err != nil || stats.Aged < 2 || stats.Wiped == 0 {
		t.Fatalf("stats = %+v err=%v", stats, err)
	}
	gone := func(msg uuid.UUID) bool {
		var at *time.Time
		if err := superA.QueryRow(t.Context(), `select gone_at from chat.attachments where message_id = $1`, msg).Scan(&at); err != nil {
			t.Fatal(err)
		}
		return at != nil
	}
	if !gone(old.Id) || gone(heldMsg.Id) {
		t.Fatalf("the old file goes (%v), the one under a hold stays (%v)", gone(old.Id), gone(heldMsg.Id))
	}
	var text *string
	if err := superA.QueryRow(t.Context(), `select deleted_text from chat.messages where id = $1`, del.Id).Scan(&text); err != nil || text != nil {
		t.Fatalf("the content of the deleted message after 30 days: %v err=%v", text, err)
	}
	// While a hold of employees lasts the journal keeps the content; after the release it goes too.
	j := must(svc.Journal(octx, otc, chat.Id, nil, 50))
	if !slices.ContainsFunc(j.Items, func(e api.ChatJournalEntry) bool { return e.DeletedContent != nil }) {
		t.Fatalf("under a hold the journal keeps the content: %+v", j.Items)
	}
	must(svc.ReleaseHold(octx, otc, hold.Id))
	if _, err := svc.Sweep(t.Context(), tenantA); err != nil {
		t.Fatal(err)
	}
	j = must(svc.Journal(octx, otc, chat.Id, nil, 50))
	for _, e := range j.Items {
		if e.DeletedContent != nil {
			t.Fatalf("the journal still holds the deleted content: %+v", e)
		}
	}
	if !gone(heldMsg.Id) {
		t.Fatal("after the release the file of the held message goes by its term")
	}
}

func TestTextOlderThanThePolicyIsPurgedButNotUnderAHold(t *testing.T) {
	resetClock(t)
	t.Cleanup(func() { _ = exec(context.Background(), `delete from chat.policies where chat_kind = 'group'`) })
	chat := team(t, "Сроки: текст")
	octx, otc := as(t, "owner")
	if _, err := svc.UpdatePolicy(octx, otc, "group", api.ChatPolicyUpdate{Patch: api.ChatPolicyPatch{TextYears: new(int64(1))}}); err != nil {
		t.Fatal(err)
	}
	a := say(t, "foreman", chat.Id, "Старое сообщение")
	b := say(t, "driver", chat.Id, "Старое сообщение под удержанием")
	poll := must(svc.PostMessage(mustCtx(t, "logist"), tcOf(t, "logist"), chat.Id, api.ChatMessageCreate{Poll: &api.ChatPollCreate{Question: "Старый?", Options: []string{"Да", "Нет"}}}))
	members := []uuid.UUID{pid("driver")}
	hold := must(svc.CreateHold(octx, otc, api.ChatHoldCreate{Scope: "member", MemberIds: &members, Reason: "Проверка водителя"}))
	clock.add(400 * 24 * time.Hour)
	stats, err := svc.Sweep(t.Context(), tenantA)
	if err != nil || stats.Purged < 2 {
		t.Fatalf("stats = %+v err=%v", stats, err)
	}
	exists := func(id uuid.UUID) bool {
		var n int
		if err := superA.QueryRow(t.Context(), `select count(*) from chat.messages where id = $1`, id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n == 1
	}
	if exists(a.Id) || exists(poll.Id) || !exists(b.Id) {
		t.Fatalf("purge: foreman's message %v, poll %v (must be gone), the driver's under a hold %v (must stay)", exists(a.Id), exists(poll.Id), exists(b.Id))
	}
	var votes int
	if err := superA.QueryRow(t.Context(), `select count(*) from chat.polls where id = $1`, poll.Poll.Id).Scan(&votes); err != nil || votes != 0 {
		t.Fatalf("the poll of a purged message: %d err=%v", votes, err)
	}
	must(svc.ReleaseHold(octx, otc, hold.Id))
}
