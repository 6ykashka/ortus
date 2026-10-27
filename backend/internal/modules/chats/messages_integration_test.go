//go:build integration

//nolint:paralleltest // the tests share the database, the clock and the table of grants of the suite
package chats

import (
	"context"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	api "github.com/ortus/ortus-crm/backend/internal/api/chats"
)

type dateT = apiDate

// team is a work chat of «Север Логистик»: the logist moderates, the driver and the foreman write, Vera reads.
func team(t *testing.T, title string) api.Chat {
	t.Helper()
	return create(t, "owner", workChat(title, srcMember("logist", "moderator"), srcMember("driver", "member"), srcMember("foreman", "member"), srcMember("vera", "reader")))
}

func say(t *testing.T, by string, chat uuid.UUID, text string) api.ChatMessage {
	t.Helper()
	ctx, tc := as(t, by)
	return must(svc.PostMessage(ctx, tc, chat, api.ChatMessageCreate{Text: new(text)}))
}

func resetClock(t *testing.T) {
	t.Helper()
	base := clock.now()
	t.Cleanup(func() { clock.set(base) })
}

func TestMessagesGetNumbersWithoutGaps(t *testing.T) { //nolint:gocyclo // one scenario with its checks
	chat := team(t, "Нумерация сообщений")
	var wg sync.WaitGroup
	errs := make(chan error, 24)
	for i := range 24 {
		wg.Go(func() {
			by := []string{"logist", "driver", "foreman"}[i%3]
			ctx, tc := as(t, by)
			_, err := svc.PostMessage(ctx, tc, chat.Id, api.ChatMessageCreate{Text: new("Сообщение")})
			errs <- err
		})
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	rows, err := superA.Query(t.Context(), `select seq from chat.messages where chat_id = $1 order by seq`, chat.Id)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	want := int64(1)
	for rows.Next() {
		var seq int64
		if err := rows.Scan(&seq); err != nil {
			t.Fatal(err)
		}
		if seq != want {
			t.Fatalf("seq %d, want %d: a gap or a duplicate", seq, want)
		}
		want++
	}
	if want != 26 {
		t.Fatalf("%d messages, want 25 (24 + the service one)", want-1)
	}
	ctx, tc := as(t, "owner")
	got, err := svc.GetChat(ctx, tc, chat.Id)
	if err != nil || got.My.Role == nil {
		t.Fatal(err)
	}
	page, err := svc.Messages(ctx, tc, chat.Id, nil, nil, nil, 10)
	if err != nil || len(page.Items) != 10 || !page.HasMore || page.Items[9].Seq != 25 || page.Items[0].Seq != 16 {
		t.Fatalf("the latest page: %d items hasMore=%v err=%v", len(page.Items), page.HasMore, err)
	}
	before := page.Items[0].Seq
	older, err := svc.Messages(ctx, tc, chat.Id, nil, &before, nil, 10)
	if err != nil || len(older.Items) != 10 || older.Items[9].Seq != 15 {
		t.Fatalf("before: %+v err=%v", older.Items, err)
	}
	after := int64(23)
	newer, err := svc.Messages(ctx, tc, chat.Id, nil, nil, &after, 10)
	if err != nil || len(newer.Items) != 2 || newer.Items[0].Seq != 24 || newer.HasMore {
		t.Fatalf("after: %+v err=%v", newer.Items, err)
	}
}

func TestPostValidationAndRights(t *testing.T) {
	chat := team(t, "Проверки отправки")
	cases := []struct {
		name string
		by   string
		msg  api.ChatMessageCreate
		code string
		text string
	}{
		{"empty", "driver", api.ChatMessageCreate{}, "validation_failed", textEmpty},
		{"too long", "driver", api.ChatMessageCreate{Text: new(string(make([]rune, 4001)) + "я")}, "validation_failed", ""},
		{"reader", "vera", api.ChatMessageCreate{Text: new("Можно?")}, "forbidden_action", textReader},
		{"important without the right", "driver", api.ChatMessageCreate{Text: new("Срочно"), Important: &struct {
			DueDate *dateT `json:"dueDate,omitempty"`
		}{}}, "chat_content_forbidden", textNoAnnounce},
		{"@all without the right", "driver", api.ChatMessageCreate{Text: new("@все собираемся")}, "chat_content_forbidden", textNoAll},
		{"temporary in a work chat", "driver", api.ChatMessageCreate{Text: new("Исчезну"), Ephemeral: &struct {
			TtlHours int64 `json:"ttlHours"` //nolint:revive // the name of the generated field of the contract
		}{TtlHours: 1}}, "chat_ephemeral_disabled", "Временные сообщения в этом чате запрещены политикой вида «Рабочие группы»"},
		{"view-once without the right", "driver", api.ChatMessageCreate{Text: new("Файл"), ViewOnce: new(true)}, "chat_ephemeral_disabled", textViewOnceOff},
		{"poll with one option", "driver", api.ChatMessageCreate{Poll: &api.ChatPollCreate{Question: "Едем?", Options: []string{"Да"}}}, "validation_failed", "Нужно минимум два варианта"},
		{"poll without a question", "driver", api.ChatMessageCreate{Poll: &api.ChatPollCreate{Options: []string{"Да", "Нет"}}}, "validation_failed", "Напишите вопрос опроса"},
		{"unknown topic", "driver", api.ChatMessageCreate{Text: new("Тема"), Topic: new("Снабжение")}, "validation_failed", "Такой темы в чате нет"},
		{"file that is not there", "driver", api.ChatMessageCreate{FileIds: &[]uuid.UUID{uuid.New()}}, "validation_failed", "Файл не найден: загрузите его заново"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ctx, tc := as(t, c.by)
			_, err := svc.PostMessage(ctx, tc, chat.Id, c.msg)
			if c.text == "" {
				wantProblem(t, err, c.code)
				return
			}
			wantProblem(t, err, c.code, c.text)
		})
	}
	// Nothing of the refused was written.
	ctx, tc := as(t, "owner")
	page, err := svc.Messages(ctx, tc, chat.Id, nil, nil, nil, 50)
	if err != nil || len(page.Items) != 1 {
		t.Fatalf("messages after the refusals: %d err=%v", len(page.Items), err)
	}
	// The moderator may: important with «Ознакомлен» and @все.
	lctx, ltc := as(t, "logist")
	m, err := svc.PostMessage(lctx, ltc, chat.Id, api.ChatMessageCreate{Text: new("@все завтра в 9:00"), Important: &struct {
		DueDate *dateT `json:"dueDate,omitempty"`
	}{}})
	if err != nil || m.Important == nil || m.Important.TotalCount != 3 || m.Important.AckCount != 0 {
		t.Fatalf("important = %+v err=%v", m.Important, err)
	}
	wantDue := clock.now().AddDate(0, 0, 3).Format(time.DateOnly)
	if got := m.Important.DueDate.Format(time.DateOnly); got != wantDue {
		t.Fatalf("the date of the acknowledgement is fixed «+3 days»: %s, want %s", got, wantDue)
	}
}

func TestEditDeleteAndTheVersions(t *testing.T) { //nolint:gocyclo // one scenario with its checks
	resetClock(t)
	chat := team(t, "Правка и удаление")
	m := say(t, "driver", chat.Id, "Выезжаем в 8:00")
	dctx, dtc := as(t, "driver")
	edited, err := svc.EditMessage(dctx, dtc, chat.Id, m.Id, "Выезжаем в 8:30")
	if err != nil || edited.Text != "Выезжаем в 8:30" || edited.EditedAt == nil {
		t.Fatalf("edited = %+v err=%v", edited, err)
	}
	same, err := svc.EditMessage(dctx, dtc, chat.Id, m.Id, "Выезжаем в 8:30")
	if err != nil || same.EditedAt == nil {
		t.Fatalf("the same text: %+v err=%v", same, err)
	}
	vers, err := svc.Versions(dctx, dtc, chat.Id, m.Id)
	if err != nil || len(vers.Items) != 1 || vers.Items[0].Text != "Выезжаем в 8:00" {
		t.Fatalf("versions = %+v err=%v", vers, err)
	}
	vctx, vtc := as(t, "vera")
	_, err = svc.Versions(vctx, vtc, chat.Id, m.Id)
	wantProblem(t, err, "forbidden_action", "История правок видна автору и модераторам")
	lctx, ltc := as(t, "logist")
	if _, err := svc.Versions(lctx, ltc, chat.Id, m.Id); err != nil {
		t.Fatalf("the moderator reads the versions: %v", err)
	}
	_, err = svc.EditMessage(lctx, ltc, chat.Id, m.Id, "Подправлю чужое")
	wantProblem(t, err, "forbidden_action", "Править можно только свои сообщения")
	_, err = svc.EditMessage(dctx, dtc, chat.Id, m.Id, "  ")
	wantProblem(t, err, "validation_failed", "Текст не может быть пустым — удалите сообщение")

	clock.add(49 * time.Hour)
	_, err = svc.EditMessage(dctx, dtc, chat.Id, m.Id, "Поздно")
	wantProblem(t, err, "chat_edit_window_closed", "Окно правки закрыто: 48 часов по политике вида «Рабочие группы»")
	_, err = svc.DeleteMessage(dctx, dtc, chat.Id, m.Id, "")
	wantProblem(t, err, "chat_edit_window_closed", "Окно удаления закрыто: 48 часов. Попросите модератора")
	_, err = svc.DeleteMessage(lctx, ltc, chat.Id, m.Id, "")
	wantProblem(t, err, "validation_failed", "Укажите причину — её увидят участники")
	_, err = svc.DeleteMessage(vctx, vtc, chat.Id, m.Id, "хочу")
	wantProblem(t, err, "forbidden_action", "Чужие сообщения удаляют модераторы")

	gone, err := svc.DeleteMessage(lctx, ltc, chat.Id, m.Id, "Личные данные заказчика")
	if err != nil || gone.Deleted == nil || !gone.Deleted.Moderator || gone.Deleted.Reason == nil || *gone.Deleted.Reason != "Личные данные заказчика" ||
		gone.Deleted.ByDisplayName != "Марина Котова" {
		t.Fatalf("deleted = %+v err=%v", gone.Deleted, err)
	}
	// PD-60: the content does not come back — only the label.
	if gone.Text != "" || len(gone.Attachments) != 0 || gone.Poll != nil || gone.Important != nil || gone.Spoiler != nil {
		t.Fatalf("a deleted message must be a label only: %+v", gone)
	}
	page, _ := svc.Messages(dctx, dtc, chat.Id, nil, nil, nil, 10)
	last := page.Items[len(page.Items)-1]
	if last.Id != m.Id || last.Text != "" || last.Deleted == nil {
		t.Fatalf("in the feed: %+v", last)
	}
	if _, err := svc.Versions(lctx, ltc, chat.Id, m.Id); err == nil {
		t.Fatal("the versions of a deleted message are not given")
	}
	_, err = svc.DeleteMessage(lctx, ltc, chat.Id, m.Id, "ещё раз")
	wantProblem(t, err, "validation_failed", "Сообщение уже удалено")
	_, err = svc.Ack(dctx, dtc, chat.Id, m.Id)
	wantProblem(t, err, "validation_failed", textMsgDeleted)

	// The content is in the journal of the chat, for 30 days, and only with chat.audit.read (the owner has it).
	octx, otc := as(t, "owner")
	j, err := svc.Journal(octx, otc, chat.Id, nil, 50)
	if err != nil {
		t.Fatal(err)
	}
	seen := false
	for _, e := range j.Items {
		if e.DeletedContent != nil && *e.DeletedContent == "Выезжаем в 8:30" {
			seen = true
		}
	}
	if !seen {
		t.Fatalf("the journal does not keep the deleted content: %+v", j.Items)
	}
	_, err = svc.Journal(lctx, ltc, chat.Id, nil, 50)
	wantProblem(t, err, "forbidden_action")
}

func TestPdnIsMaskedAndRevealIsAudited(t *testing.T) {
	chat := team(t, "ПДн в чате")
	m := say(t, "driver", chat.Id, "Звоните заказчику 8 916 123 45 67")
	if !m.Masked || m.Text != "Звоните заказчику +7 ••• •••-••-67" {
		t.Fatalf("masked = %v %q", m.Masked, m.Text)
	}
	dctx, dtc := as(t, "driver")
	grants.allow("driver", "chat.pdn.read")
	_, err := svc.RevealPdn(dctx, dtc, chat.Id, m.Id)
	grants.deny("driver", "chat.pdn.read")
	wantProblem(t, err, "function_blocked") // the function «driver» closes it whatever the grants are
	lctx, ltc := as(t, "logist")
	_, err = svc.RevealPdn(lctx, ltc, chat.Id, m.Id)
	wantProblem(t, err, "forbidden_action", "Номер скрыт: нужно право «ПДн без маски»")
	grants.allow("logist", "chat.pdn.read")
	defer grants.deny("logist", "chat.pdn.read")
	got, err := svc.RevealPdn(lctx, ltc, chat.Id, m.Id)
	if err != nil || got.Text != "Звоните заказчику 8 916 123 45 67" || got.MessageId != m.Id {
		t.Fatalf("reveal = %+v err=%v", got, err)
	}
	var n int
	if err := superA.QueryRow(t.Context(), `select count(*) from audit.events where action = 'chat.message.pdn_reveal' and target_id = $1`, m.Id).Scan(&n); err != nil || n != 1 {
		t.Fatalf("audit rows = %d err=%v", n, err)
	}
	octx, otc := as(t, "owner")
	j, _ := svc.Journal(octx, otc, chat.Id, nil, 50)
	if !slices.ContainsFunc(j.Items, func(e api.ChatJournalEntry) bool {
		return e.ActorDisplayName == "Марина Котова" && strings.HasPrefix(e.Text, "Марина Котова раскрыл")
	}) {
		t.Fatalf("the journal: %+v", j.Items)
	}
}

func TestImportantAcknowledgementsAndReading(t *testing.T) { //nolint:gocyclo // one scenario with its checks
	chat := team(t, "Важное и прочтение")
	lctx, ltc := as(t, "logist")
	m := must(svc.PostMessage(lctx, ltc, chat.Id, api.ChatMessageCreate{Text: new("Завтра проверка"), Important: &struct {
		DueDate *dateT `json:"dueDate,omitempty"`
	}{}}))
	fctx, ftc := as(t, "foreman")
	row := func() api.ChatSummary {
		list := must(svc.ListChats(fctx, ftc, "", "", nil, 0))
		for _, it := range list.Items {
			if it.Id == chat.Id {
				return it
			}
		}
		t.Fatal("chat not in the list")
		return api.ChatSummary{}
	}
	if r := row(); r.My.Unread != 1 || r.My.AckWaitCount != 1 {
		t.Fatalf("before: %+v", r.My)
	}
	acked, err := svc.Ack(fctx, ftc, chat.Id, m.Id)
	if err != nil || acked.Important == nil || acked.Important.AckCount != 1 || acked.Important.Mine == nil || !acked.Important.Mine.Done {
		t.Fatalf("acked = %+v err=%v", acked.Important, err)
	}
	if again, err := svc.Ack(fctx, ftc, chat.Id, m.Id); err != nil || again.Important.AckCount != 1 {
		t.Fatalf("a repeat is not an error and counts once: %+v err=%v", again.Important, err)
	}
	if r := row(); r.My.AckWaitCount != 0 {
		t.Fatalf("after: %+v", r.My)
	}
	_, err = svc.Ack(lctx, ltc, chat.Id, m.Id)
	wantProblem(t, err, "validation_failed", "Своё сообщение подтверждать не нужно")
	plain := say(t, "driver", chat.Id, "Обычное")
	fctx2, ftc2 := fctx, ftc
	_, err = svc.Ack(fctx2, ftc2, chat.Id, plain.Id)
	wantProblem(t, err, "validation_failed", "Подтверждение не запрошено")

	read, err := svc.MarkRead(fctx, ftc, chat.Id, 1_000_000)
	if err != nil || read.LastReadSeq != 3 || read.Unread != 0 {
		t.Fatalf("read = %+v err=%v", read, err)
	}
	back, err := svc.MarkRead(fctx, ftc, chat.Id, 1)
	if err != nil || back.LastReadSeq != 3 {
		t.Fatalf("the place never moves back: %+v err=%v", back, err)
	}

	// Receipts: «ticks» gives N of M to the author; the names only in the mode «who», for the author and the moderators.
	mine := must(svc.PostMessage(lctx, ltc, chat.Id, api.ChatMessageCreate{Text: new("Прочитали?")}))
	if _, err := svc.MarkRead(fctx, ftc, chat.Id, mine.Seq); err != nil {
		t.Fatal(err)
	}
	r, err := svc.Receipts(lctx, ltc, chat.Id, mine.Id)
	if err != nil || r.Mode != "ticks" || r.ReadCount != 1 || r.TotalCount != 3 || r.Items != nil {
		t.Fatalf("ticks = %+v err=%v", r, err)
	}
	dctx, dtc := as(t, "driver")
	_, err = svc.Receipts(dctx, dtc, chat.Id, mine.Id)
	wantProblem(t, err, "forbidden_action", "Кто прочитал, видят автор и модераторы")
	if _, err := superA.Exec(t.Context(), `insert into chat.policies (chat_kind, policy) values ('group', $1)`, mustJSON(withReceipts(DefaultPolicy(KindGroup), "who"))); err != nil {
		t.Fatal(err)
	}
	defer superA.Exec(context.Background(), `delete from chat.policies where chat_kind = 'group'`)
	who, err := svc.Receipts(lctx, ltc, chat.Id, mine.Id)
	if err != nil || who.Mode != "who" || who.Items == nil || len(*who.Items) != 3 {
		t.Fatalf("who = %+v err=%v", who, err)
	}
	for _, it := range *who.Items {
		if (it.Member.DisplayName == "Алексей Соколов") != (it.ReadAt != nil) {
			t.Fatalf("only the foreman has read: %+v", it)
		}
	}
}

func TestPollsKeepOnlyAHashForAnAnonymousVote(t *testing.T) { //nolint:gocyclo // one scenario with its checks
	chat := team(t, "Опросы")
	lctx, ltc := as(t, "logist")
	m := must(svc.PostMessage(lctx, ltc, chat.Id, api.ChatMessageCreate{Poll: &api.ChatPollCreate{
		Question: "Во сколько выезд?", Options: []string{"7:00", "8:00"}, Anonymous: new(true)}}))
	if m.Kind != "poll" || m.Poll == nil || len(m.Poll.Options) != 2 || !m.Poll.Anonymous || m.Poll.Closed {
		t.Fatalf("poll = %+v", m.Poll)
	}
	poll := m.Poll
	dctx, dtc := as(t, "driver")
	seen := must(svc.Messages(dctx, dtc, chat.Id, nil, nil, nil, 10))
	if p := seen.Items[len(seen.Items)-1].Poll; p == nil || p.Options[0].Votes != nil {
		t.Fatalf("the results are hidden until the own vote: %+v", p)
	}
	voted, err := svc.Vote(dctx, dtc, chat.Id, poll.Id, []uuid.UUID{poll.Options[1].Id})
	if err != nil || voted.Poll.TotalVoters != 1 || voted.Poll.Options[1].Votes == nil || *voted.Poll.Options[1].Votes != 1 || len(voted.Poll.MyVotes) != 1 ||
		voted.Poll.Options[1].Voters != nil {
		t.Fatalf("voted = %+v err=%v", voted.Poll, err)
	}
	var withMember, withHash int
	if err := superA.QueryRow(t.Context(), `select count(*) filter (where voter_id is not null), count(*) filter (where voter_hash ~ '^[0-9a-f]{64}$')
		from chat.poll_votes where poll_id = $1`, poll.Id).Scan(&withMember, &withHash); err != nil || withMember != 0 || withHash != 1 {
		t.Fatalf("an anonymous vote stores the member (%d) and no hash (%d), err=%v", withMember, withHash, err)
	}
	// A new vote replaces the old one; one option only in this poll.
	if v, err := svc.Vote(dctx, dtc, chat.Id, poll.Id, []uuid.UUID{poll.Options[0].Id}); err != nil || v.Poll.TotalVoters != 1 || *v.Poll.Options[0].Votes != 1 || *v.Poll.Options[1].Votes != 0 {
		t.Fatalf("revote = %+v err=%v", v.Poll, err)
	}
	_, err = svc.Vote(dctx, dtc, chat.Id, poll.Id, []uuid.UUID{poll.Options[0].Id, poll.Options[1].Id})
	wantProblem(t, err, "validation_failed", "В этом опросе один вариант")
	_, err = svc.Vote(dctx, dtc, chat.Id, poll.Id, []uuid.UUID{uuid.New()})
	wantProblem(t, err, "validation_failed", "Выберите вариант")
	if n, err := svc.RemindPoll(lctx, ltc, chat.Id, poll.Id); err != nil || n.Notified != 2 {
		t.Fatalf("the foreman and Vera have not voted: %+v err=%v", n, err)
	}
	_, err = svc.RemindPoll(dctx, dtc, chat.Id, poll.Id)
	wantProblem(t, err, "forbidden_action")
	_, err = svc.ClosePoll(dctx, dtc, chat.Id, poll.Id)
	wantProblem(t, err, "forbidden_action", "Закрыть опрос может автор или модератор")
	closed, err := svc.ClosePoll(lctx, ltc, chat.Id, poll.Id)
	if err != nil || !closed.Poll.Closed {
		t.Fatalf("closed = %+v err=%v", closed.Poll, err)
	}
	_, err = svc.ClosePoll(lctx, ltc, chat.Id, poll.Id)
	wantProblem(t, err, "validation_failed", "Опрос уже закрыт")
	_, err = svc.Vote(dctx, dtc, chat.Id, poll.Id, []uuid.UUID{poll.Options[0].Id})
	wantProblem(t, err, "invalid_transition")
	page := must(svc.Messages(dctx, dtc, chat.Id, nil, nil, nil, 10))
	if last := page.Items[len(page.Items)-1]; last.System == nil || last.System.Title != "Опрос закрыт: «Во сколько выезд?»" || last.System.Text != "Больше всего голосов: 7:00 · 1" {
		t.Fatalf("the result is in the chat: %+v", last.System)
	}

	open := must(svc.PostMessage(dctx, dtc, chat.Id, api.ChatMessageCreate{Poll: &api.ChatPollCreate{Question: "Кто едет?", Options: []string{"Я", "Не я"}, Multiple: new(true)}}))
	both := []uuid.UUID{open.Poll.Options[0].Id, open.Poll.Options[1].Id}
	v, err := svc.Vote(lctx, ltc, chat.Id, open.Poll.Id, both)
	if err != nil || v.Poll.Options[0].Voters == nil || (*v.Poll.Options[0].Voters)[0] != "Марина Котова" {
		t.Fatalf("an open poll names its voters: %+v err=%v", v.Poll, err)
	}
}

func TestTasksFromMessagesAndTheLinkBack(t *testing.T) {
	chat := team(t, "Задачи из чата")
	m := say(t, "driver", chat.Id, "Заменить шину на М 608 КТ 77")
	dctx, dtc := as(t, "driver")
	_, err := svc.TaskFromMessage(dctx, dtc, chat.Id, m.Id, api.ChatTaskCreate{Title: "Заменить шину"})
	wantProblem(t, err, "forbidden_action", "Создавать задачи может роль с правом «Задачи · Создавать»")
	grants.allow("driver", "tasks.create")
	defer grants.deny("driver", "tasks.create")
	ref, err := svc.TaskFromMessage(dctx, dtc, chat.Id, m.Id, api.ChatTaskCreate{Title: "Заменить шину"})
	if err != nil || ref.Key == "" {
		t.Fatalf("ref = %+v err=%v", ref, err)
	}
	if len(tasks.made) == 0 || tasks.made[len(tasks.made)-1].Message != m.Id || tasks.made[len(tasks.made)-1].Link != "Чат «Задачи из чата»" {
		t.Fatalf("draft = %+v", tasks.made)
	}
	page := must(svc.Messages(dctx, dtc, chat.Id, nil, nil, nil, 10))
	got := page.Items[len(page.Items)-1]
	if len(got.Tasks) != 1 || got.Tasks[0].TaskId != ref.TaskId {
		t.Fatalf("the link back: %+v", got.Tasks)
	}
	lctx, ltc := as(t, "logist")
	del := must(svc.DeleteMessage(lctx, ltc, chat.Id, m.Id, "Дубль"))
	if del.Text != "" {
		t.Fatal("deleted")
	}
	_, err = svc.TaskFromMessage(dctx, dtc, chat.Id, m.Id, api.ChatTaskCreate{Title: "Ещё одна"})
	wantProblem(t, err, "validation_failed", textMsgDeleted)
}

func TestPinOneMessage(t *testing.T) {
	chat := team(t, "Закреплённое")
	a, b := say(t, "driver", chat.Id, "Первое"), say(t, "driver", chat.Id, "Второе")
	dctx, dtc := as(t, "driver")
	_, err := svc.Pin(dctx, dtc, chat.Id, a.Id)
	wantProblem(t, err, "forbidden_action", "Закрепляют модераторы")
	lctx, ltc := as(t, "logist")
	if st, err := svc.Pin(lctx, ltc, chat.Id, a.Id); err != nil || st.PinnedMessageId == nil || *st.PinnedMessageId != a.Id {
		t.Fatalf("pin = %+v err=%v", st, err)
	}
	if st, err := svc.Pin(lctx, ltc, chat.Id, b.Id); err != nil || *st.PinnedMessageId != b.Id {
		t.Fatalf("a second pin replaces the first: %+v err=%v", st, err)
	}
	got := must(svc.GetChat(dctx, dtc, chat.Id))
	if got.Pinned == nil || got.Pinned.Id != b.Id {
		t.Fatalf("pinned = %+v", got.Pinned)
	}
	if st, err := svc.Unpin(lctx, ltc, chat.Id); err != nil || st.PinnedMessageId != nil {
		t.Fatalf("unpin = %+v err=%v", st, err)
	}
	_, err = svc.Pin(lctx, ltc, chat.Id, uuid.New())
	wantProblem(t, err, "not_found", textMsgNotFound)
}
