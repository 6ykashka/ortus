//go:build integration

//nolint:paralleltest // the tests share the database, the clock and the table of grants of the suite
package chats

import (
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	api "github.com/ortus/ortus-crm/backend/internal/api/chats"
)

func tripChat(t *testing.T, trip uuid.UUID, label string, sources ...RecordSource) uuid.UUID {
	t.Helper()
	id, _, err := svc.EnsureRecordChat(t.Context(), tenantA, RecordChat{Record: ObjectRef{Module: "fleet", Type: "trip", ID: trip}, Label: label,
		Nav: "/logistics/trips/" + trip.String(), Unit: new(pid("f-sever")), Topics: []string{"Общее", "Снабжение"}, Sources: sources})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func asMember(proto string, role Role) RecordSource {
	return RecordSource{Who: "member", Ref: new(pid(proto)), Role: role}
}

func TestRecordChatIsSeenByThoseWhoSeeTheRecord(t *testing.T) { //nolint:gocyclo // one scenario with its checks
	grants.allow("driver", "fleet.trips.read")
	grants.allow("logist", "fleet.trips.read")
	defer grants.deny("driver", "fleet.trips.read")
	defer grants.deny("logist", "fleet.trips.read")
	trip := uuid.New()
	id := tripChat(t, trip, "Рейс Р-208", asMember("driver", RoleMember), asMember("logist", RoleModerator), asMember("vera", RoleReader))
	again, created, err := svc.EnsureRecordChat(t.Context(), tenantA, RecordChat{Record: ObjectRef{Module: "fleet", Type: "trip", ID: trip}, Label: "Рейс Р-208",
		Unit: new(pid("f-sever")), Sources: []RecordSource{asMember("driver", RoleMember), asMember("logist", RoleModerator), asMember("foreman", RoleMember)}})
	if err != nil || created || again != id {
		t.Fatalf("the chat of a record is one: %v %v %v", again, created, err)
	}
	dctx, dtc := as(t, "driver")
	chat := must(svc.GetChat(dctx, dtc, id))
	if chat.Kind != "record" || chat.Record == nil || chat.Record.Object.EntityType != "trip" || chat.Record.Label != "Рейс Р-208" || !slices.Equal(chat.Topics, []string{"Общее", "Снабжение"}) {
		t.Fatalf("chat = %+v", chat)
	}
	// Vera was in the first roster, not in the second; the foreman is new — he has no right to trips, so the chat is closed to him.
	vctx, vtc := as(t, "vera")
	_, err = svc.GetChat(vctx, vtc, id)
	wantProblem(t, err, "not_found")
	fctx, ftc := as(t, "foreman")
	_, err = svc.GetChat(fctx, ftc, id)
	wantProblem(t, err, "not_found")
	grants.allow("foreman", "fleet.trips.read")
	if _, err := svc.GetChat(fctx, ftc, id); err != nil {
		t.Fatalf("with the right to the record the chat opens: %v", err)
	}
	grants.deny("foreman", "fleet.trips.read")
	list := must(svc.ListChats(fctx, ftc, "record", "", nil, 0))
	if slices.ContainsFunc(list.Items, func(s api.ChatSummary) bool { return s.Id == id }) {
		t.Fatal("the list shows a chat of a record the person does not see")
	}

	// A module puts its card into the chat; topics work.
	if err := svc.PostRecordCard(t.Context(), tenantA, ObjectRef{Type: "trip", ID: trip}, ServiceCard{Module: "fleet", Icon: "local_shipping", Tone: "warn",
		Title: "Критический дефект · М 608 КТ 77", Text: "Выезд заблокирован до решения менеджера", Label: "Открыть автопарк", Nav: "/logistics/fleet"}); err != nil {
		t.Fatal(err)
	}
	m := must(svc.PostMessage(dctx, dtc, id, api.ChatMessageCreate{Text: new("Нужна резина"), Topic: new("Снабжение")}))
	if m.Topic == nil || *m.Topic != "Снабжение" {
		t.Fatalf("topic = %v", m.Topic)
	}
	_, err = svc.PostMessage(dctx, dtc, id, api.ChatMessageCreate{Text: new("Куда?"), Topic: new("Допработы")})
	wantProblem(t, err, "validation_failed", "Такой темы в чате нет")
	snab := "Снабжение"
	filtered := must(svc.Messages(dctx, dtc, id, &snab, nil, nil, 10))
	if len(filtered.Items) != 1 || filtered.Items[0].Id != m.Id {
		t.Fatalf("by topic: %+v", filtered.Items)
	}
	all := must(svc.Messages(dctx, dtc, id, nil, nil, nil, 10))
	var card *api.ChatSystemCard
	for _, x := range all.Items {
		if x.System != nil && x.System.Module == "fleet" {
			card = x.System
		}
	}
	if card == nil || card.Label == nil || *card.Label != "Открыть автопарк" || card.Tone != "warn" {
		t.Fatalf("card = %+v", card)
	}

	// The record closes: the chat goes to the archive and stays readable.
	if err := svc.CloseRecordChat(t.Context(), tenantA, ObjectRef{Type: "trip", ID: trip}); err != nil {
		t.Fatal(err)
	}
	_, err = svc.PostMessage(dctx, dtc, id, api.ChatMessageCreate{Text: new("Уже поздно")})
	wantProblem(t, err, "forbidden_action", textArchived)
	if err := svc.PostRecordCard(t.Context(), tenantA, ObjectRef{Type: "trip", ID: trip}, ServiceCard{Module: "fleet", Icon: "x", Tone: "info", Title: "t", Text: "x"}); err != nil {
		t.Fatalf("a card into an archived chat is dropped silently: %v", err)
	}
	_, _, err = svc.EnsureRecordChat(t.Context(), tenantA, RecordChat{Record: ObjectRef{Type: "deal", ID: uuid.New()}, Label: "Сделка"})
	wantProblem(t, err, "validation_failed", "Чат записи бывает у рейса и объекта ремонта")
}

func TestViewOnceFilesAreOpenedOnceAndGoAfterADay(t *testing.T) { //nolint:gocyclo // one scenario with its checks
	resetClock(t)
	grants.allow("driver", "fleet.trips.read")
	grants.allow("logist", "fleet.trips.read")
	grants.allow("foreman", "fleet.trips.read")
	defer func() {
		for _, p := range []string{"driver", "logist", "foreman"} {
			grants.deny(p, "fleet.trips.read")
		}
	}()
	id := tripChat(t, uuid.New(), "Рейс Р-209", asMember("driver", RoleMember), asMember("logist", RoleModerator), asMember("foreman", RoleMember))
	lctx, ltc := as(t, "logist")
	file := newFile(t, "logist", 250_000, "application/pdf", "пропуск.pdf")
	m, err := svc.PostMessage(lctx, ltc, id, api.ChatMessageCreate{Text: new("Пропуск на склад"), FileIds: &[]uuid.UUID{file}, ViewOnce: new(true)})
	if err != nil || len(m.Attachments) != 1 || !m.Attachments[0].ViewOnce {
		t.Fatalf("m = %+v err=%v", m.Attachments, err)
	}
	dctx, dtc := as(t, "driver")
	_, err = svc.PostMessage(dctx, dtc, id, api.ChatMessageCreate{Text: new("И я"), FileIds: &[]uuid.UUID{newFile(t, "driver", 1000, "application/pdf", "x.pdf")}, ViewOnce: new(true)})
	wantProblem(t, err, "chat_ephemeral_disabled", textViewOnceOff)
	att := m.Attachments[0].Id

	link, err := svc.OpenViewOnce(dctx, dtc, id, att)
	if err != nil || link.Watermark != "Илья Васильев" || !link.NoDownload || link.Url != "https://files.test/view/"+file.String() {
		t.Fatalf("link = %+v err=%v", link, err)
	}
	_, err = svc.OpenViewOnce(dctx, dtc, id, att)
	wantProblem(t, err, "invalid_transition", "Вы уже открыли этот файл — он больше не откроется")
	_, err = svc.OpenViewOnce(lctx, ltc, id, att)
	wantProblem(t, err, "validation_failed", "Автор одноразового файла его не открывает: файл видят только получатели")
	seen := must(svc.Messages(dctx, dtc, id, nil, nil, nil, 10))
	var mine *api.ChatAttachment
	for _, x := range seen.Items {
		if x.Id == m.Id {
			mine = &x.Attachments[0]
		}
	}
	if mine == nil || mine.OpenedByMe == nil || !*mine.OpenedByMe || mine.Gone {
		t.Fatalf("attachment of the recipient = %+v", mine)
	}
	usedBefore := usedOf(t, id)

	clock.add(25 * time.Hour)
	fctx, ftc := as(t, "foreman")
	_, err = svc.OpenViewOnce(fctx, ftc, id, att)
	wantProblem(t, err, "invalid_transition", "Файл удалён: прошло 24 часа после первого открытия")
	stats, err := svc.Sweep(t.Context(), tenantA)
	if err != nil || stats.ViewOnce == 0 {
		t.Fatalf("stats = %+v err=%v", stats, err)
	}
	if !slices.Contains(files.removed, file) || usedOf(t, id) != usedBefore-250_000 {
		t.Fatalf("the file is not removed (%v) or the place not freed: %d", files.removed, usedOf(t, id))
	}
	var fileID *uuid.UUID
	if err := superA.QueryRow(t.Context(), `select file_id from chat.attachments where id = $1`, att).Scan(&fileID); err != nil || fileID != nil {
		t.Fatalf("file_id = %v err=%v", fileID, err)
	}
}

func TestSaveAttachmentsToTheRecord(t *testing.T) {
	grants.allow("driver", "fleet.trips.read")
	defer grants.deny("driver", "fleet.trips.read")
	trip := uuid.New()
	id := tripChat(t, trip, "Рейс Р-210", asMember("driver", RoleMember))
	dctx, dtc := as(t, "driver")
	file := newFile(t, "driver", 200_000, "image/jpeg", "стена.jpg")
	m := must(svc.PostMessage(dctx, dtc, id, api.ChatMessageCreate{Text: new("Фото"), FileIds: &[]uuid.UUID{file}}))
	before := usedOf(t, id)
	res, err := svc.SaveToRecord(dctx, dtc, id, m.Id, nil)
	if err != nil || len(res.Saved) != 1 || res.Saved[0].SavedTo == nil || res.Saved[0].SavedTo.EntityId != trip || res.Bytes != 200_000 || res.Record.EntityType != "trip" {
		t.Fatalf("res = %+v err=%v", res, err)
	}
	if owner := files.moved[file]; owner.ID != trip || owner.Type != "trip" {
		t.Fatalf("the owner of the file: %+v", files.moved)
	}
	if usedOf(t, id) != before-200_000 {
		t.Fatalf("the place is still charged to the chat: %d -> %d", before, usedOf(t, id))
	}
	_, err = svc.SaveToRecord(dctx, dtc, id, m.Id, nil)
	wantProblem(t, err, "validation_failed", "Нечего сохранять: файлы уже в записи")
	other := api.ObjectRef{ModuleKey: "fleet", EntityType: "trip", EntityId: uuid.New()}
	_, err = svc.SaveToRecord(dctx, dtc, id, m.Id, &other)
	wantProblem(t, err, "validation_failed", "Сохранить можно только в запись этого чата")

	g := team(t, "Не запись")
	gm := say(t, "driver", g.Id, "Без записи")
	_, err = svc.SaveToRecord(dctx, dtc, g.Id, gm.Id, nil)
	wantProblem(t, err, "forbidden_action", "Сохранять в запись могут участники чата записи")
}
