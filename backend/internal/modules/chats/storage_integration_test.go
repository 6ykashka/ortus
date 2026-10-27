//go:build integration

//nolint:paralleltest // the tests share the database, the clock and the table of grants of the suite
package chats

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	api "github.com/ortus/ortus-crm/backend/internal/api/chats"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// newFile writes a file of the organization a person has uploaded for a chat (purpose chat_attachment, checked).
func newFile(t *testing.T, by string, size int64, contentType, name string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if err := exec(t.Context(), `insert into files.objects (id, object_key, state, purpose, owner_type, owner_id, declared_mime, bytes, uploaded_by, created_at, ready_at)
		values ($1, $2, 'ready', 'chat_attachment', 'chat', $3, $4, $5, $6, $7, $7)`, id, "chat/"+id.String(), uuid.New(),
		contentType+`; name="`+name+`"`, size, pid(by), clock.now()); err != nil {
		t.Fatal(err)
	}
	return id
}

func sendFile(t *testing.T, by string, chat uuid.UUID, size int64, contentType, name string) (api.ChatMessage, error) {
	t.Helper()
	ctx, tc := as(t, by)
	id := newFile(t, by, size, contentType, name)
	return svc.PostMessage(ctx, tc, chat, api.ChatMessageCreate{Text: new("Файл " + name), FileIds: &[]uuid.UUID{id}})
}

// smallPlace gives the chats of the kind «area» one megabyte of place; it restores the defaults after the test.
func smallPlace(t *testing.T) {
	t.Helper()
	ctx, tc := as(t, "owner")
	res, err := svc.UpdatePolicy(ctx, tc, "area", api.ChatPolicyUpdate{Patch: api.ChatPolicyPatch{QuotaMb: new(int64(1)), MaxFileMb: new(int64(10))}})
	if err != nil || !res.Applied || res.Policy.Policy.QuotaMb == nil || *res.Policy.Policy.QuotaMb != 1 {
		t.Fatalf("policy = %+v err=%v", res, err)
	}
	t.Cleanup(func() { _ = exec(context.Background(), `delete from chat.policies where chat_kind = 'area'`) })
}

func areaChat(t *testing.T, title string) api.Chat {
	t.Helper()
	return create(t, "owner", api.ChatCreate{Kind: "area", Title: title, OrgUnitId: new(pid("f-sever")),
		Sources: []api.ChatSource{srcMember("logist", "moderator"), srcMember("driver", "member")}})
}

func usedOf(t *testing.T, chat uuid.UUID) int64 {
	t.Helper()
	var n int64
	if err := superA.QueryRow(t.Context(), `select used_bytes from chat.chats where id = $1`, chat).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestFilesOverTheQuotaAreRefusedInTheModeBlock(t *testing.T) {
	smallPlace(t)
	chat := areaChat(t, "Место: запретить")
	first, err := sendFile(t, "driver", chat.Id, 800_000, "image/jpeg", "стена.jpg")
	if err != nil || len(first.Attachments) != 1 || first.Attachments[0].Kind != "photo" || first.Attachments[0].FileName != "стена.jpg" {
		t.Fatalf("first = %+v err=%v", first.Attachments, err)
	}
	if got := usedOf(t, chat.Id); got != 800_000 {
		t.Fatalf("used = %d", got)
	}
	var warned int
	if err := superA.QueryRow(t.Context(), `select count(*) from outbox.events where type = 'chat.quota.warning.v1' and aggregate_id = $1`, chat.Id).Scan(&warned); err != nil || warned != 1 {
		t.Fatalf("the threshold of 75 %% raises one event: %d err=%v", warned, err)
	}
	before := messageCount(t, chat.Id)
	_, err = sendFile(t, "driver", chat.Id, 300_000, "image/jpeg", "ещё.jpg")
	wantProblem(t, err, "chat_quota_full", "Место чата заполнено: 0,8 МБ из 1 МБ. Файлы не отправляются — текст, опросы и подтверждения работают. Освободите место в «Сведения › Хранение»")
	if messageCount(t, chat.Id) != before || usedOf(t, chat.Id) != 800_000 {
		t.Fatal("a refused file changed the chat")
	}
	if _, err := svc.PostMessage(mustCtx(t, "driver"), tcOf(t, "driver"), chat.Id, api.ChatMessageCreate{Text: new("Текст работает")}); err != nil {
		t.Fatalf("text works in a full chat: %v", err)
	}
	big := newFile(t, "driver", 11_000_000, "video/mp4", "обход.mp4")
	_, err = svc.PostMessage(mustCtx(t, "driver"), tcOf(t, "driver"), chat.Id, api.ChatMessageCreate{FileIds: &[]uuid.UUID{big}})
	wantProblem(t, err, "chat_file_too_large", "«обход.mp4» больше 10 МБ — предел политики вида «По роли в области»")
}

func mustCtx(t *testing.T, proto string) context.Context {
	t.Helper()
	c, _ := as(t, proto)
	return c
}

func tcOf(t *testing.T, proto string) tenantctx.TenantContext {
	t.Helper()
	_, tc := as(t, proto)
	return tc
}

func messageCount(t *testing.T, chat uuid.UUID) int {
	t.Helper()
	var n int
	if err := superA.QueryRow(t.Context(), `select count(*) from chat.messages where chat_id = $1`, chat).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestRingDeletesTheOldestAttachments(t *testing.T) { //nolint:gocyclo // one scenario with its checks
	smallPlace(t)
	chat := areaChat(t, "Место: удалять старые")
	octx, otc := as(t, "owner")
	if _, err := svc.UpdateChat(octx, otc, chat.Id, etag(chat.Revision), api.ChatPatch{Overrides: &struct {
		OnFull *api.ChatPatchOverridesOnFull `json:"onFull,omitempty"`
	}{OnFull: new(api.ChatPatchOverridesOnFull("ring"))}}); err != nil {
		t.Fatal(err)
	}
	m1 := must(sendFile(t, "driver", chat.Id, 400_000, "image/jpeg", "один.jpg"))
	clock.add(time.Hour)
	must(sendFile(t, "driver", chat.Id, 400_000, "image/jpeg", "два.jpg"))
	clock.add(time.Hour)
	m3, err := sendFile(t, "driver", chat.Id, 400_000, "image/jpeg", "три.jpg")
	if err != nil || len(m3.Attachments) != 1 {
		t.Fatalf("the third file must go in by freeing the oldest: %v", err)
	}
	if got := usedOf(t, chat.Id); got != 800_000 {
		t.Fatalf("used = %d", got)
	}
	if len(files.removed) == 0 || files.removed[len(files.removed)-1] == uuid.Nil {
		t.Fatalf("the file of the oldest attachment was not removed: %v", files.removed)
	}
	page := must(svc.Messages(octx, otc, chat.Id, nil, nil, nil, 20))
	var first api.ChatMessage
	var note *api.ChatSystemCard
	for _, m := range page.Items {
		if m.Id == m1.Id {
			first = m
		}
		if m.System != nil && m.System.Title == "Удалены старые вложения: место чата" {
			note = m.System
		}
	}
	if len(first.Attachments) != 1 || !first.Attachments[0].Gone {
		t.Fatalf("the oldest attachment is gone: %+v", first.Attachments)
	}
	if note == nil || note.Text != "1 файл · 400 КБ · сохранённое в запись и под удержанием не тронуто" && note.Text != "1 файл · 0,4 МБ · сохранённое в запись и под удержанием не тронуто" {
		t.Fatalf("note = %+v", note)
	}
}

func TestCompressShrinksOldMedia(t *testing.T) { //nolint:gocyclo // one scenario with its checks
	resetClock(t)
	smallPlace(t)
	chat := areaChat(t, "Место: сжимать")
	octx, otc := as(t, "owner")
	if _, err := svc.UpdateChat(octx, otc, chat.Id, etag(chat.Revision), api.ChatPatch{Overrides: &struct {
		OnFull *api.ChatPatchOverridesOnFull `json:"onFull,omitempty"`
	}{OnFull: new(api.ChatPatchOverridesOnFull("compress"))}}); err != nil {
		t.Fatal(err)
	}
	must(sendFile(t, "driver", chat.Id, 500_000, "video/mp4", "старое.mp4"))
	clock.add(40 * 24 * time.Hour)
	if _, err := sendFile(t, "driver", chat.Id, 600_000, "image/jpeg", "новое.jpg"); err != nil {
		t.Fatalf("old media shrinks to make room: %v", err)
	}
	if got := usedOf(t, chat.Id); got != 900_000 {
		t.Fatalf("used = %d, want 300 000 (the old video shrank by 40 %%) + 600 000", got)
	}
	_, err := sendFile(t, "driver", chat.Id, 600_000, "image/jpeg", "ещё.jpg")
	wantProblem(t, err, "chat_quota_full")
	st := must(svc.Storage(octx, otc, chat.Id))
	if st.UsedBytes != 900_000 || st.QuotaBytes == nil || *st.QuotaBytes != 1_000_000 || st.OnFull != "compress" || len(st.Buckets) != 2 {
		t.Fatalf("storage = %+v", st)
	}
	compressed := 0
	for _, b := range st.Buckets {
		if b.Compressed {
			compressed++
			if b.Kind != "video" || b.AgeDays != 30 {
				t.Fatalf("the compressed bucket: %+v", b)
			}
		}
	}
	if compressed != 1 {
		t.Fatalf("buckets = %+v", st.Buckets)
	}
}

func TestCleanupDryRunApplyAndHold(t *testing.T) { //nolint:gocyclo // one scenario with its checks
	resetClock(t)
	chat := areaChat(t, "Очистка вложений")
	must(sendFile(t, "driver", chat.Id, 3_000_000, "video/mp4", "обход.mp4"))
	clock.add(100 * 24 * time.Hour)
	must(sendFile(t, "driver", chat.Id, 1_000_000, "image/jpeg", "фото.jpg"))
	octx, otc := as(t, "owner")
	dctx, dtc := as(t, "driver")
	_, err := svc.Cleanup(dctx, dtc, chat.Id, api.ChatCleanupCreate{Kinds: &[]api.ChatCleanupCreateKinds{"video"}})
	wantProblem(t, err, "forbidden_action", "Очищать чат может его владелец")
	_, err = svc.Cleanup(octx, otc, chat.Id, api.ChatCleanupCreate{})
	wantProblem(t, err, "validation_failed", "Выберите, что удалить")
	filter := api.ChatCleanupCreate{Kinds: &[]api.ChatCleanupCreateKinds{"video"}, OlderThanDays: new(int64(90)), DryRun: new(true)}
	dry := must(svc.Cleanup(octx, otc, chat.Id, filter))
	if dry.Applied || dry.Files != 1 || dry.Bytes != 3_000_000 || dry.AfterBytes != 1_000_000 {
		t.Fatalf("dry = %+v", dry)
	}
	if usedOf(t, chat.Id) != 4_000_000 {
		t.Fatal("a dry run changed the place")
	}
	// A hold on the whole chat forbids the cleanup.
	hold := must(svc.CreateHold(octx, otc, api.ChatHoldCreate{Scope: "chat", ChatId: &chat.Id, Reason: "Проверка ГИБДД"}))
	if hold.Status != "active" || hold.Period != "Весь чат" || hold.Files != 2 {
		t.Fatalf("hold = %+v", hold)
	}
	filter.DryRun = nil
	_, err = svc.Cleanup(octx, otc, chat.Id, filter)
	wantProblem(t, err, "chat_on_hold", "Нельзя очистить: удержание «Проверка ГИБДД»")
	if st := must(svc.Storage(octx, otc, chat.Id)); st.Hold == nil || st.Hold.Reason != "Проверка ГИБДД" {
		t.Fatalf("the hold is in the storage: %+v", st.Hold)
	}
	released := must(svc.ReleaseHold(octx, otc, hold.Id))
	if released.Status != "released" {
		t.Fatalf("released = %+v", released)
	}
	_, err = svc.ReleaseHold(octx, otc, hold.Id)
	wantProblem(t, err, "invalid_transition", "Удержание уже снято")

	done := must(svc.Cleanup(octx, otc, chat.Id, filter))
	if !done.Applied || done.Files != 1 || done.AfterBytes != 1_000_000 || usedOf(t, chat.Id) != 1_000_000 {
		t.Fatalf("done = %+v used=%d", done, usedOf(t, chat.Id))
	}
	_, err = svc.Cleanup(octx, otc, chat.Id, filter)
	wantProblem(t, err, "validation_failed", "Под фильтр ничего не попало")
	page := must(svc.Messages(octx, otc, chat.Id, nil, nil, nil, 20))
	cleaned := false
	for _, m := range page.Items {
		if m.System != nil && m.System.Text == "1 файл · 3 МБ. Подписи, превью и ответы остались" {
			cleaned = true
		}
	}
	if !cleaned {
		t.Fatal("the service message of the cleanup is missing")
	}
	j := must(svc.Journal(octx, otc, chat.Id, nil, 50))
	if len(j.Items) < 3 {
		t.Fatalf("journal = %+v", j.Items)
	}
}

func TestHoldsProtectMessagesFromDeletion(t *testing.T) {
	chat := team(t, "Удержание сообщений")
	m := say(t, "driver", chat.Id, "Это сообщение под удержанием")
	octx, otc := as(t, "owner")
	dctx, dtc := as(t, "driver")
	lctx, ltc := as(t, "logist")

	_, err := svc.CreateHold(octx, otc, api.ChatHoldCreate{Scope: "chat", ChatId: &chat.Id, Reason: "ab"})
	wantProblem(t, err, "validation_failed", "Укажите причину удержания")
	_, err = svc.CreateHold(lctx, ltc, api.ChatHoldCreate{Scope: "chat", ChatId: &chat.Id, Reason: "Проверка"})
	wantProblem(t, err, "forbidden_action", textOwnerOnly)
	_, err = svc.CreateHold(octx, otc, api.ChatHoldCreate{Scope: "member", Reason: "Проверка"})
	wantProblem(t, err, "validation_failed", "Выберите сотрудников")
	_, err = svc.CreateHold(octx, otc, api.ChatHoldCreate{Scope: "period", Reason: "Проверка"})
	wantProblem(t, err, "validation_failed", "Укажите период удержания")

	members := []uuid.UUID{pid("driver")}
	hold := must(svc.CreateHold(octx, otc, api.ChatHoldCreate{Scope: "member", MemberIds: &members, Reason: "Служебная проверка водителя"}))
	if hold.Period != "1 сотрудник" {
		t.Fatalf("hold = %+v", hold)
	}
	_, err = svc.DeleteMessage(dctx, dtc, chat.Id, m.Id, "")
	wantProblem(t, err, "chat_on_hold", "Нельзя удалить: удержание «Служебная проверка водителя»")
	_, err = svc.DeleteMessage(lctx, ltc, chat.Id, m.Id, "Модератор тоже не может")
	wantProblem(t, err, "chat_on_hold")
	other := say(t, "foreman", chat.Id, "Это сообщение не под удержанием")
	if _, err := svc.DeleteMessage(lctx, ltc, chat.Id, other.Id, "Лишнее"); err != nil {
		t.Fatalf("the hold is for the driver only: %v", err)
	}
	list := must(svc.Holds(octx, otc))
	if len(list.Items) == 0 || list.Items[0].Status != "active" {
		t.Fatalf("holds = %+v", list.Items)
	}
	must(svc.ReleaseHold(octx, otc, hold.Id))
	if _, err := svc.DeleteMessage(dctx, dtc, chat.Id, m.Id, ""); err != nil {
		t.Fatalf("after the release: %v", err)
	}
	_, err = svc.Holds(lctx, ltc)
	wantProblem(t, err, "forbidden_action", textOwnerOnly)
}

func TestPoliciesWithinTheBounds(t *testing.T) { //nolint:gocyclo // one scenario with its checks
	t.Cleanup(func() { _ = exec(context.Background(), `delete from chat.policies where chat_kind = 'group'`) })
	chat := team(t, "Политика вида")
	octx, otc := as(t, "owner")
	list := must(svc.Policies(octx, otc))
	if len(list.Items) != 5 || list.Items[0].Kind != "direct" || list.Items[1].Policy.DeletedDays != 30 || list.Items[1].Bounds.MaxFileMb.Max != 2000 {
		t.Fatalf("list = %+v", list.Items)
	}
	lctx, ltc := as(t, "logist")
	_, err := svc.Policies(lctx, ltc)
	wantProblem(t, err, "forbidden_action")
	_, err = svc.UpdatePolicy(lctx, ltc, "group", api.ChatPolicyUpdate{Patch: api.ChatPolicyPatch{MaxFileMb: new(int64(300))}})
	wantProblem(t, err, "forbidden_action", "Политики чатов меняет владелец бизнеса")
	_, err = svc.UpdatePolicy(octx, otc, "bogus", api.ChatPolicyUpdate{Patch: api.ChatPolicyPatch{MaxFileMb: new(int64(300))}})
	wantProblem(t, err, "validation_failed", "Неизвестный вид чата")
	_, err = svc.UpdatePolicy(octx, otc, "group", api.ChatPolicyUpdate{Patch: api.ChatPolicyPatch{DeletedDays: new(int64(7))}})
	wantProblem(t, err, "validation_failed", "Значение вне пределов организации: 30–30")
	temp := api.ChatPolicyPatchTemp("allowed")
	_, err = svc.UpdatePolicy(octx, otc, "group", api.ChatPolicyUpdate{Patch: api.ChatPolicyPatch{Temp: &temp}})
	wantProblem(t, err, "validation_failed", "Временные сообщения разрешены только в личных чатах")

	edit := api.ChatPolicyPatchEdit("15m")
	patch := api.ChatPolicyUpdate{Patch: api.ChatPolicyPatch{Edit: &edit, FilesDays: new(int64(90))}, DryRun: new(true)}
	dry := must(svc.UpdatePolicy(octx, otc, "group", patch))
	if dry.Applied || len(dry.Notes) != 3 || dry.Policy.Policy.Edit != "15m" || dry.Policy.Revision != 1 {
		t.Fatalf("dry = %+v", dry)
	}
	if again := must(svc.Policies(octx, otc)); again.Items[1].Policy.Edit != "48h" {
		t.Fatal("a dry run changed the policy")
	}
	patch.DryRun = nil
	done := must(svc.UpdatePolicy(octx, otc, "group", patch))
	if !done.Applied || done.Policy.Revision != 2 || done.Policy.Policy.Edit != "15m" {
		t.Fatalf("done = %+v", done)
	}
	// The new value is in force at once, and the chats of the kind got a service message.
	got := must(svc.GetChat(octx, otc, chat.Id))
	if got.Policy.Edit != "15m" {
		t.Fatalf("policy of the chat = %+v", got.Policy)
	}
	page := must(svc.Messages(octx, otc, chat.Id, nil, nil, nil, 10))
	if last := page.Items[len(page.Items)-1]; last.System == nil || last.System.Title != "Политика вида изменена · Дарья Зимина" {
		t.Fatalf("service message = %+v", last.System)
	}
	m := say(t, "driver", chat.Id, "Правлю сразу")
	clock.add(20 * time.Minute)
	defer clock.add(-20 * time.Minute)
	dctx, dtc := as(t, "driver")
	_, err = svc.EditMessage(dctx, dtc, chat.Id, m.Id, "Поздно")
	wantProblem(t, err, "chat_edit_window_closed", "Окно правки закрыто: 15 минут по политике вида «Рабочие группы»")
}

func TestExportOfTheHistoryIsAJob(t *testing.T) {
	chat := team(t, "Выгрузка истории")
	say(t, "driver", chat.Id, "Звоните 8 916 123 45 67")
	octx, otc := as(t, "owner")
	dctx, dtc := as(t, "driver")
	_, err := svc.CreateExport(dctx, dtc, chat.Id, api.ChatExportCreate{Format: "csv"})
	wantProblem(t, err, "forbidden_action")
	job := must(svc.CreateExport(octx, otc, chat.Id, api.ChatExportCreate{Format: "csv"}))
	if job.Status != "queued" {
		t.Fatalf("job = %+v", job)
	}
	stats, err := svc.Sweep(t.Context(), tenantA)
	if err != nil || stats.Exports == 0 {
		t.Fatalf("stats = %+v err=%v", stats, err)
	}
	got := must(svc.Export(octx, otc, chat.Id, job.Id))
	if got.Status != "done" {
		t.Fatalf("job after the sweep = %+v", got)
	}
	if len(files.saved) == 0 {
		t.Fatal("the file of the export was not saved")
	}
	_, err = svc.Export(octx, otc, chat.Id, uuid.New())
	wantProblem(t, err, "not_found", "Выгрузка не найдена")
}
