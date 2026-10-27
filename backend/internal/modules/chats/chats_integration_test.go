//go:build integration

//nolint:paralleltest // the tests share the database, the clock and the table of grants of the suite
package chats

import (
	"slices"
	"testing"

	api "github.com/ortus/ortus-crm/backend/internal/api/chats"
)

func srcMember(proto string, role api.ChatSourceRole) api.ChatSource {
	return api.ChatSource{Who: "member", RefId: new(pid(proto)), Role: role}
}

func srcGroup(proto string, role api.ChatSourceRole) api.ChatSource {
	return api.ChatSource{Who: "group", RefId: new(pid(proto)), Role: role}
}

func names(refs []api.ChatMemberRef) []string {
	var out []string
	for _, r := range refs {
		out = append(out, r.DisplayName)
	}
	slices.Sort(out)
	return out
}

// create makes a group chat of the owner with the sources and returns it.
func create(t *testing.T, by string, spec api.ChatCreate) api.Chat {
	t.Helper()
	ctx, tc := as(t, by)
	res, made, err := svc.CreateChat(ctx, tc, spec)
	if err != nil || !made || res.Chat == nil {
		t.Fatalf("create: %+v made=%v err=%v", res, made, err)
	}
	return *res.Chat
}

func workChat(title string, sources ...api.ChatSource) api.ChatCreate {
	return api.ChatCreate{Kind: "group", Title: title, OrgUnitId: new(pid("f-sever")), Sources: sources}
}

func TestCreateChatComputesTheRosterFromSources(t *testing.T) { //nolint:gocyclo // one scenario with its checks
	ctx, tc := as(t, "owner")
	spec := workChat("Водители · Север Логистик", srcGroup("group-disp", "moderator"), srcMember("driver", "member"), srcMember("blocked", "member"),
		srcMember("invited", "member"), srcMember("nomodule", "member"), srcMember("outsider", "reader"))
	spec.DryRun = new(true)
	dry, made, err := svc.CreateChat(ctx, tc, spec)
	if err != nil || made || dry.Applied || dry.Chat != nil {
		t.Fatalf("dry run: %+v made=%v err=%v", dry, made, err)
	}
	wantJoined := []string{"Алексей Соколов", "Игорь Яхонтов", "Илья Васильев", "Марина Котова"}
	if got := names(dry.Impact.Joined); !slices.Equal(got, wantJoined) {
		t.Fatalf("joined = %v", got)
	}
	if got := names(dry.Impact.Pending); !slices.Equal(got, []string{"Сергей Ильин"}) {
		t.Fatalf("pending = %v", got)
	}
	reasons := map[string]string{}
	for _, s := range dry.Impact.Skipped {
		reasons[s.Member.DisplayName] = s.Reason
	}
	if reasons["Кирилл Громов"] != whyBlocked || reasons["Пётр Лазарев"] != whyNoModule || len(reasons) != 2 {
		t.Fatalf("skipped = %v", reasons)
	}
	var n int
	if err := superA.QueryRow(ctx, `select count(*) from chat.chats where title = $1`, spec.Title).Scan(&n); err != nil || n != 0 {
		t.Fatalf("a dry run wrote %d chats (%v)", n, err)
	}

	spec.DryRun = nil
	chat := create(t, "owner", spec)
	if chat.Kind != "group" || chat.MemberCount != 4 || chat.Status != "active" || chat.Policy.QuotaMb == nil || *chat.Policy.QuotaMb != 5000 {
		t.Fatalf("chat = %+v", chat)
	}
	if chat.My.Role == nil || *chat.My.Role != "owner" || chat.My.Can == nil || !chat.My.Can.Settings || !chat.My.Can.Members {
		t.Fatalf("owner view = %+v", chat.My)
	}
	// A member sees the chat with the role the source gave; a person outside the roster and a person with the module but not in
	// the roster do not: the same 404 as for a chat that does not exist (AC-01).
	for proto, role := range map[string]api.ChatMyRole{"logist": "moderator", "driver": "member", "outsider": "reader"} {
		c, c2 := as(t, proto)
		got, err := svc.GetChat(c, c2, chat.Id)
		if err != nil || got.My.Role == nil || *got.My.Role != role {
			t.Fatalf("%s: %+v err=%v", proto, got.My, err)
		}
	}
	for _, proto := range []string{"vera", "blocked", "invited", "nomodule"} {
		c, c2 := as(t, proto)
		_, err := svc.GetChat(c, c2, chat.Id)
		wantProblem(t, err, "not_found", textChatNotFound)
	}
	if got := chat.My.Chain; got == nil || len(*got) != 3 {
		t.Fatalf("chain = %v", got)
	}
	// The roster the owner reads: in, pending, out with the reason.
	list, err := svc.Members(ctx, tc, chat.Id)
	if err != nil || list.Counts.In != 4 || list.Counts.Pending != 1 || list.Counts.Out != 2 {
		t.Fatalf("members = %+v err=%v", list.Counts, err)
	}
	// The messages start with the service message of the chat.
	msgs, err := svc.Messages(ctx, tc, chat.Id, nil, nil, nil, 10)
	if err != nil || len(msgs.Items) != 1 || msgs.Items[0].System == nil || msgs.Items[0].System.Title != "Чат создан · Дарья Зимина" {
		t.Fatalf("messages = %+v err=%v", msgs, err)
	}
}

func TestCreateChatByAMemberOfTheArea(t *testing.T) {
	ctx, tc := as(t, "logist")
	spec := workChat("Зимняя резина · Север Логистик", srcMember("driver", "member"), srcMember("outsider", "member"))
	spec.DryRun = new(true)
	dry, _, err := svc.CreateChat(ctx, tc, spec)
	if err != nil {
		t.Fatal(err)
	}
	if len(dry.Impact.Skipped) != 1 || dry.Impact.Skipped[0].Member.DisplayName != "Игорь Яхонтов" ||
		dry.Impact.Skipped[0].Reason != "вне вашей области «Север Логистик» — добавить может владелец или руководитель области" {
		t.Fatalf("skipped = %+v", dry.Impact.Skipped)
	}
	spec.DryRun = nil
	_, _, err = svc.CreateChat(ctx, tc, spec)
	wantProblem(t, err, "chat_member_out_of_scope")

	spec.Sources = []api.ChatSource{srcMember("driver", "member")}
	chat := create(t, "logist", spec)
	if chat.My.Role == nil || *chat.My.Role != "owner" || chat.MemberCount != 2 {
		t.Fatalf("the author must become the owner of the chat: %+v", chat.My)
	}

	cases := []struct {
		name string
		by   string
		edit func(*api.ChatCreate)
		code string
		text string
	}{
		{"announce is the owner's", "logist", func(c *api.ChatCreate) { c.Kind = "announce" }, "forbidden_action", "Чаты объявлений создаёт владелец бизнеса"},
		{"finance label is the owner's", "logist", func(c *api.ChatCreate) { c.Label = new(api.ChatCreateLabel("finance")) }, "forbidden_action", textFinanceLabel},
		{"owner of a chat is the owner's", "logist", func(c *api.ChatCreate) { c.Sources = []api.ChatSource{srcMember("driver", "owner")} }, "chat_member_out_of_scope", "Владельца чата назначает владелец бизнеса"},
		{"everybody is the owner's", "logist", func(c *api.ChatCreate) { c.Sources = []api.ChatSource{{Who: "all", Role: "member"}} }, "forbidden_action", "«Все сотрудники» добавляет владелец бизнеса"},
		{"no area, no chat", "logist", func(c *api.ChatCreate) { c.OrgUnitId = nil }, "forbidden_action", "Чат можно создать только в своей области"},
		{"short title", "logist", func(c *api.ChatCreate) { c.Title = "ab" }, "validation_failed", "Название — не короче 3 символов"},
		{"no right to create", "vera", func(*api.ChatCreate) {}, "forbidden_action", "Чат можно создать только в своей области"},
		{"source without a reference", "owner", func(c *api.ChatCreate) { c.Sources = []api.ChatSource{{Who: "group", Role: "member"}} }, "validation_failed", "Источник состава указан не полностью"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := workChat("Проверка отказа", srcMember("driver", "member"))
			c.edit(&s)
			cx, ct := as(t, c.by)
			_, _, err := svc.CreateChat(cx, ct, s)
			wantProblem(t, err, c.code, c.text)
		})
	}
}

func TestFinanceChatIsClosedForTheDriver(t *testing.T) {
	spec := workChat("Расчёты · Север Логистик", srcMember("driver", "member"), srcMember("logist", "member"))
	spec.Label = new(api.ChatCreateLabel("finance"))
	chat := create(t, "owner", spec)
	if chat.Sensitivity != "finance" || chat.MemberCount != 1 {
		t.Fatalf("chat = %+v", chat)
	}
	ctx, tc := as(t, "driver")
	_, err := svc.GetChat(ctx, tc, chat.Id)
	wantProblem(t, err, "not_found")
	list, err := svc.ListChats(ctx, tc, "", "", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, it := range list.Items {
		if it.Id == chat.Id {
			t.Fatal("the finance chat is in the list of the driver")
		}
	}
	oc, ot := as(t, "owner")
	members, err := svc.Members(oc, ot, chat.Id)
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range members.Items {
		if m.Member.DisplayName == "Илья Васильев" && (m.State != "out" || m.Why == nil || *m.Why != whyFunction) {
			t.Fatalf("the driver: %+v", m)
		}
	}
}

func TestDirectChatIsOnePerPair(t *testing.T) { //nolint:gocyclo // one scenario with its checks
	ctx, tc := as(t, "logist")
	first, made, err := svc.CreateDirectChat(ctx, tc, api.ChatDirectCreate{MemberId: pid("driver")})
	if err != nil || !made || first.Kind != "direct" || first.Title != "Илья Васильев" || first.Peer == nil {
		t.Fatalf("first = %+v made=%v err=%v", first, made, err)
	}
	dctx, dtc := as(t, "driver")
	grants.allow("driver", "chat.direct")
	defer grants.deny("driver", "chat.direct")
	again, made, err := svc.CreateDirectChat(dctx, dtc, api.ChatDirectCreate{MemberId: pid("logist")})
	if err != nil || made || again.Id != first.Id || again.Title != "Марина Котова" {
		t.Fatalf("again = %+v made=%v err=%v", again, made, err)
	}
	// Only the two read it, the owner of the business does not.
	oc, ot := as(t, "owner")
	_, err = svc.GetChat(oc, ot, first.Id)
	wantProblem(t, err, "not_found")
	if first.Policy.Temp != "allowed" || first.My.Can == nil || first.My.Can.Settings || first.My.Can.Members || !first.My.Can.Ephemeral {
		t.Fatalf("policy / rights of a direct chat: %+v %+v", first.Policy, first.My.Can)
	}
	_, _, err = svc.CreateDirectChat(ctx, tc, api.ChatDirectCreate{MemberId: pid("logist")})
	wantProblem(t, err, "validation_failed")
	vctx, vtc := as(t, "vera")
	_, _, err = svc.CreateDirectChat(vctx, vtc, api.ChatDirectCreate{MemberId: pid("logist")})
	wantProblem(t, err, "chat_member_out_of_scope")

	// The second side is dismissed: the chat stays and is read only (Q-W4.00-chats-23).
	statuses[pid("membership:driver")] = Membership{Status: "ended"}
	defer func() { statuses[pid("membership:driver")] = Membership{Status: "active"} }()
	got, err := svc.GetChat(ctx, tc, first.Id)
	if err != nil || got.Peer == nil || got.Peer.Status == nil || *got.Peer.Status != "dismissed" || got.My.Can.Write {
		t.Fatalf("after the dismissal: %+v err=%v", got.My.Can, err)
	}
	_, err = svc.PostMessage(ctx, tc, first.Id, api.ChatMessageCreate{Text: new("Привет")})
	wantProblem(t, err, "forbidden_action", textPeerGone)
}

func TestReplaceSourcesWithARevisionAndAPreview(t *testing.T) { //nolint:gocyclo // one scenario with its checks
	chat := create(t, "owner", workChat("Состав меняется", srcMember("logist", "member"), srcMember("driver", "member"), srcMember("foreman", "member")))
	ctx, tc := as(t, "owner")
	next := []api.ChatSource{srcMember("logist", "moderator"), srcMember("vera", "member")}

	_, err := svc.ReplaceSources(ctx, tc, chat.Id, `"rev-99"`, api.ChatSourcesReplace{Sources: next})
	wantProblem(t, err, "revision_mismatch")

	dry, err := svc.ReplaceSources(ctx, tc, chat.Id, etag(chat.Revision), api.ChatSourcesReplace{Sources: next, DryRun: new(true)})
	if err != nil || dry.Applied || !slices.Equal(names(dry.Impact.Joined), []string{"Вера Котельникова"}) ||
		!slices.Equal(names(dry.Impact.Lose), []string{"Алексей Соколов", "Илья Васильев"}) {
		t.Fatalf("dry run = %+v err=%v", dry, err)
	}
	if cur, _ := svc.Sources(ctx, tc, chat.Id); len(cur.Items) != 3 || cur.Revision != chat.Revision {
		t.Fatalf("a dry run changed the sources: %+v", cur)
	}

	res, err := svc.ReplaceSources(ctx, tc, chat.Id, etag(chat.Revision), api.ChatSourcesReplace{Sources: next})
	if err != nil || !res.Applied || res.Sources == nil || res.Sources.Revision != chat.Revision+1 {
		t.Fatalf("result = %+v err=%v", res, err)
	}
	dctx, dtc := as(t, "driver")
	_, err = svc.GetChat(dctx, dtc, chat.Id)
	wantProblem(t, err, "not_found")
	vctx, vtc := as(t, "vera")
	if _, err := svc.GetChat(vctx, vtc, chat.Id); err != nil {
		t.Fatalf("the new member must see the chat: %v", err)
	}
	msgs, _ := svc.Messages(ctx, tc, chat.Id, nil, nil, nil, 10)
	last := msgs.Items[len(msgs.Items)-1]
	if last.System == nil || last.System.Title != "Состав изменён · Дарья Зимина" || last.System.Text != "Вошли: Вера Котельникова · Вышли: Алексей Соколов, Илья Васильев" {
		t.Fatalf("the service message: %+v", last.System)
	}
	exp, err := svc.AccessExplanation(ctx, tc, chat.Id, pid("driver"))
	if err != nil || exp.Ok || exp.Role != nil {
		t.Fatalf("explanation = %+v err=%v", exp, err)
	}
	// A member without the right to the roster does not see it.
	_, err = svc.Members(vctx, vtc, chat.Id)
	wantProblem(t, err, "forbidden_action", textMembersRight)
	_, err = svc.ReplaceSources(vctx, vtc, chat.Id, etag(res.Sources.Revision), api.ChatSourcesReplace{Sources: next})
	wantProblem(t, err, "forbidden_action", textMembersRight)
}

func TestArchiveAndRename(t *testing.T) {
	chat := create(t, "owner", workChat("Старое название", srcMember("logist", "member")))
	ctx, tc := as(t, "owner")
	renamed, err := svc.UpdateChat(ctx, tc, chat.Id, etag(chat.Revision), api.ChatPatch{Title: new("Новое название"), Overrides: &struct {
		OnFull *api.ChatPatchOverridesOnFull `json:"onFull,omitempty"`
	}{OnFull: new(api.ChatPatchOverridesOnFull("ring"))}})
	if err != nil || renamed.Title != "Новое название" || renamed.Policy.OnFull != "ring" || renamed.Revision != chat.Revision+1 {
		t.Fatalf("renamed = %+v err=%v", renamed, err)
	}
	_, err = svc.UpdateChat(ctx, tc, chat.Id, etag(chat.Revision), api.ChatPatch{Title: new("Ещё раз")})
	wantProblem(t, err, "revision_mismatch")
	_, err = svc.UpdateChat(ctx, tc, chat.Id, etag(renamed.Revision), api.ChatPatch{Overrides: &struct {
		OnFull *api.ChatPatchOverridesOnFull `json:"onFull,omitempty"`
	}{OnFull: new(api.ChatPatchOverridesOnFull("archive"))}})
	wantProblem(t, err, "validation_failed", "Режим «Переносить в архив» появится позже")
	lctx, ltc := as(t, "logist")
	_, err = svc.UpdateChat(lctx, ltc, chat.Id, etag(renamed.Revision), api.ChatPatch{Title: new("Чужое")})
	wantProblem(t, err, "forbidden_action", textSettingsRight)

	archived, err := svc.ArchiveChat(ctx, tc, chat.Id)
	if err != nil || archived.Status != "archived" {
		t.Fatalf("archived = %+v err=%v", archived, err)
	}
	_, err = svc.ArchiveChat(ctx, tc, chat.Id)
	wantProblem(t, err, "invalid_transition", "Чат уже в архиве")
	_, err = svc.PostMessage(lctx, ltc, chat.Id, api.ChatMessageCreate{Text: new("Ещё одно")})
	wantProblem(t, err, "forbidden_action", textArchived)
	if got, err := svc.GetChat(lctx, ltc, chat.Id); err != nil || got.My.Can.Write {
		t.Fatalf("an archived chat is readable and read only: %+v err=%v", got.My.Can, err)
	}
}

func TestListChatsFoldersSearchAndUnread(t *testing.T) { //nolint:gocyclo // one scenario with its checks
	a := create(t, "owner", workChat("Список А", srcMember("logist", "member")))
	b := create(t, "owner", api.ChatCreate{Kind: "announce", Title: "Новости салона", OrgUnitId: new(pid("f-sever")), Sources: []api.ChatSource{srcMember("logist", "reader")}})
	octx, otc := as(t, "owner")
	if _, err := svc.PostMessage(octx, otc, a.Id, api.ChatMessageCreate{Text: new("Сегодня погрузка в 9:00, номер диспетчера 8 916 123 45 67")}); err != nil {
		t.Fatal(err)
	}
	ctx, tc := as(t, "logist")
	all, err := svc.ListChats(ctx, tc, "", "", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	var row *api.ChatSummary
	for i := range all.Items {
		if all.Items[i].Id == a.Id {
			row = &all.Items[i]
		}
	}
	if row == nil || row.My.Unread != 1 || row.LastMessage == nil || row.LastMessage.Text != "Сегодня погрузка в 9:00, номер диспетчера +7 ••• •••-••-67" {
		t.Fatalf("row = %+v", row)
	}
	if all.Counts.Announce < 1 || all.Counts.Work < 1 || all.Counts.All != all.Counts.Announce+all.Counts.Work+all.Counts.Direct+all.Counts.Record {
		t.Fatalf("counts = %+v", all.Counts)
	}
	news, err := svc.ListChats(ctx, tc, "announce", "", nil, 0)
	if err != nil || len(news.Items) == 0 || news.Items[0].Kind != "announce" {
		t.Fatalf("announce folder: %+v err=%v", news, err)
	}
	found, err := svc.ListChats(ctx, tc, "", "погрузка", nil, 0)
	if err != nil || len(found.Items) != 1 || found.Items[0].Id != a.Id {
		t.Fatalf("search by message: %+v err=%v", found, err)
	}
	if byTitle, _ := svc.ListChats(ctx, tc, "", "салона", nil, 0); len(byTitle.Items) != 1 || byTitle.Items[0].Id != b.Id {
		t.Fatalf("search by title: %+v", byTitle.Items)
	}
	page, err := svc.ListChats(ctx, tc, "", "", nil, 1)
	if err != nil || len(page.Items) != 1 || page.NextCursor == nil {
		t.Fatalf("paging: %+v err=%v", page, err)
	}
	// The owner sees the chats of the organization but not the personal ones; the person outside sees none of these.
	vctx, vtc := as(t, "vera")
	if none, _ := svc.ListChats(vctx, vtc, "", "", nil, 0); slices.ContainsFunc(none.Items, func(s api.ChatSummary) bool { return s.Id == a.Id }) {
		t.Fatal("a chat the person is not in is listed")
	}
}

func TestServerAnswersCreatedAndDryRun(t *testing.T) {
	ctx, _ := as(t, "owner")
	spec := workChat("Через сервер", srcMember("logist", "member"))
	spec.DryRun = new(true)
	r, err := srv.CreateChat(ctx, api.CreateChatRequestObject{TenantId: tenantA, Body: &spec})
	if _, ok := r.(api.CreateChat200JSONResponse); err != nil || !ok {
		t.Fatalf("dry run: %T %v", r, err)
	}
	spec.DryRun = nil
	r, err = srv.CreateChat(ctx, api.CreateChatRequestObject{TenantId: tenantA, Body: &spec})
	created, ok := r.(api.CreateChat201JSONResponse)
	if err != nil || !ok || created.Body.Chat == nil {
		t.Fatalf("create: %T %v", r, err)
	}
	g, err := srv.GetChat(ctx, api.GetChatRequestObject{TenantId: tenantA, ChatId: created.Body.Chat.Id})
	got, ok := g.(api.GetChat200JSONResponse)
	if err != nil || !ok || got.Headers.ETag == nil || *got.Headers.ETag != etag(got.Body.Revision) {
		t.Fatalf("get: %T %v", g, err)
	}
	if _, err := srv.CreateChat(ctx, api.CreateChatRequestObject{TenantId: tenantA}); err == nil {
		t.Fatal("a request without a body must fail")
	} else {
		wantProblem(t, err, "malformed_request")
	}
}
