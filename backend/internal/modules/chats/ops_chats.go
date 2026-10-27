package chats

import (
	"context"
	"encoding/json"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	api "github.com/ortus/ortus-crm/backend/internal/api/chats"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// apiPolicy is the policy of the contract.
func apiPolicy(p Policy) api.ChatPolicy {
	out := api.ChatPolicy{TextYears: int64(p.TextYears), FilesDays: int64(p.FilesDays), VoiceDays: int64(p.VoiceDays),
		Receipts: api.ChatPolicyReceipts(p.Receipts), ReceiptsDays: int64(p.ReceiptsDays), DeletedDays: int64(p.DeletedDays),
		Edit: api.ChatPolicyEdit(p.Edit), MaxFileMb: int64(p.MaxFileMb), Temp: api.ChatPolicyTemp(p.Temp),
		Forward: api.ChatPolicyForward(p.Forward), PdnMask: p.PdnMask, OnFull: api.ChatPolicyOnFull(p.OnFull)}
	if p.QuotaMb != nil {
		out.QuotaMb = new(int64(*p.QuotaMb))
	}
	if p.AfterCloseDays != nil {
		out.AfterCloseDays = new(int64(*p.AfterCloseDays))
	}
	return out
}

func apiCan(c Can) *api.ChatCan {
	return &api.ChatCan{Write: c.Write, Files: c.Files, Polls: c.Polls, Moderate: c.Moderate, Pin: c.Pin, Announce: c.Announce,
		Receipts: c.Receipts, Pdn: c.Pdn, Ephemeral: c.Ephemeral, ViewOnce: c.ViewOnce, Members: c.Members, Settings: c.Settings,
		SaveToRecord: c.SaveToRecord, Task: c.Task}
}

func apiRecord(rec *recordRef) *api.ChatRecordRef {
	if rec == nil {
		return nil
	}
	out := &api.ChatRecordRef{Label: rec.Label, Object: api.ObjectRef{ModuleKey: rec.Module, EntityType: rec.Type, EntityId: rec.ID}}
	if rec.Nav != "" {
		out.Nav = new(rec.Nav)
	}
	return out
}

// chain explains the access of the actor to the chat: roster → module → function (chatAccess.chain of the domain).
func chain(a *access) []api.ChatChainStep {
	via := a.Seat.Via
	if via == "" {
		via = "Ни один источник состава не подходит"
	}
	fn := "Ограничений нет"
	if a.Actor.Driver {
		fn = "Водитель: ПДн под маской, финансовые чаты закрыты"
	}
	module := "Есть право «Чаты · Просматривать»"
	if a.Actor.Owner {
		module = "Владелец бизнеса"
	}
	return []api.ChatChainStep{{Title: "Состав чата", Detail: via, Ok: true}, {Title: "Модуль «Чаты» в ролях", Detail: module, Ok: true},
		{Title: "Функция", Detail: fn, Ok: true}}
}

// my is the view of the chat for the actor: the role, what is unread and what they may do.
func (r *req) my(ctx context.Context, a *access, full bool) (api.ChatMy, error) {
	out := api.ChatMy{Role: new(api.ChatMyRole(a.Seat.Role)), LastReadSeq: a.Seat.LastRead}
	unread, wait, err := r.counters(ctx, []uuid.UUID{a.Chat.ID})
	if err != nil {
		return out, err
	}
	out.Unread, out.AckWaitCount = unread[a.Chat.ID], wait[a.Chat.ID]
	if full {
		out.Can, out.Chain = apiCan(a.Can), new(chain(a))
	}
	return out, nil
}

// counters counts the unread messages of other people and the important ones waiting for «Ознакомлен» in the chats.
func (r *req) counters(ctx context.Context, ids []uuid.UUID) (unread, wait map[uuid.UUID]int64, err error) {
	unread, wait = map[uuid.UUID]int64{}, map[uuid.UUID]int64{}
	rows, err := r.tx.Query(ctx, `select m.chat_id, count(*) from chat.messages m
		left join chat.receipts rc on rc.chat_id = m.chat_id and rc.member_id = $2
		where m.chat_id = any($1) and m.seq > coalesce(rc.last_seq, 0) and m.author_id is distinct from $2 and m.kind <> 'system'
		  and m.deleted_at is null and (m.visible_to is null or m.visible_to = $2) group by m.chat_id`, ids, r.me)
	if err != nil {
		return nil, nil, store("unread", err)
	}
	if err := scanCounts(rows, unread); err != nil {
		return nil, nil, err
	}
	rows, err = r.tx.Query(ctx, `select m.chat_id, count(*) from chat.messages m
		join chat.chat_members cm on cm.chat_id = m.chat_id and cm.member_id = $2 and cm.state = 'in'
		where m.chat_id = any($1) and m.important is not null and m.deleted_at is null and m.author_id is distinct from $2
		  and not exists (select 1 from chat.acks a where a.message_id = m.id and a.member_id = $2) group by m.chat_id`, ids, r.me)
	if err != nil {
		return nil, nil, store("ack wait", err)
	}
	return unread, wait, scanCounts(rows, wait)
}

func scanCounts(rows pgx.Rows, into map[uuid.UUID]int64) error {
	defer rows.Close()
	for rows.Next() {
		var (
			id uuid.UUID
			n  int64
		)
		if err := rows.Scan(&id, &n); err != nil {
			return store("counts", err)
		}
		into[id] = n
	}
	return rows.Err()
}

// holdRef is the active hold of the chat (the hold of the whole chat), nil if none.
func (r *req) holdRef(ctx context.Context, chatID uuid.UUID) (*api.ChatHoldRef, error) {
	var (
		h     api.ChatHoldRef
		until *time.Time
		by    *uuid.UUID
	)
	err := r.tx.QueryRow(ctx, `select h.id, h.reason, h.until, h.created_by from chat.holds h where h.status = 'active'
		and h.scope = 'chat' and h.chat_id = $1 and (h.until is null or h.until >= $2::date) order by h.created_at desc limit 1`,
		chatID, r.now).Scan(&h.Id, &h.Reason, &until, &by)
	switch {
	case noRows(err):
		return nil, nil
	case err != nil:
		return nil, store("hold", err)
	}
	h.Period = "Весь чат"
	if until != nil {
		h.Until = dateOf(*until)
	}
	if by != nil {
		n, err := r.nameOf(ctx, *by)
		if err != nil {
			return nil, err
		}
		h.CreatedByDisplayName = n
	}
	return &h, nil
}

// chatDTO is the chat of the contract for the actor of a.
func (r *req) chatDTO(ctx context.Context, a *access) (api.Chat, error) { //nolint:gocyclo // one operation of the contract: a chain of checks, each with the text of the reference
	c := a.Chat
	my, err := r.my(ctx, a, true)
	if err != nil {
		return api.Chat{}, err
	}
	out := api.Chat{Id: c.ID, Kind: api.ChatKind(c.Kind), Title: c.Title, OrgUnitId: c.Unit, Status: api.ChatStatus(c.Status),
		Sensitivity: api.ChatSensitivity(c.Sensitivity), Record: apiRecord(c.Record), Policy: apiPolicy(a.Policy),
		History: api.ChatHistory(c.History), My: my, UsedBytes: c.Used, Revision: int64(c.Revision), Topics: []string{}}
	if c.Overrides.OnFull != "" {
		out.Overrides.OnFull = new(api.ChatOverridesOnFull(c.Overrides.OnFull))
	}
	if c.Kind == KindDirect {
		if out.Peer, err = r.peerRef(ctx, a); err != nil {
			return api.Chat{}, err
		}
		if out.Peer != nil {
			out.Title = out.Peer.DisplayName
		}
	}
	rows, err := r.tx.Query(ctx, `select name from chat.topics where chat_id = $1 order by position, name`, c.ID)
	if err != nil {
		return api.Chat{}, store("topics", err)
	}
	if out.Topics, err = pgx.CollectRows(rows, pgx.RowTo[string]); err != nil {
		return api.Chat{}, store("topics", err)
	}
	if err := r.tx.QueryRow(ctx, `select count(*) from chat.chat_members where chat_id = $1 and state = 'in'`, c.ID).Scan(&out.MemberCount); err != nil {
		return api.Chat{}, store("member count", err)
	}
	if out.Hold, err = r.holdRef(ctx, c.ID); err != nil {
		return api.Chat{}, err
	}
	pinned, err := r.pinnedID(ctx, c.ID)
	if err != nil {
		return api.Chat{}, err
	}
	if pinned != uuid.Nil {
		if m, err := scanMsg(r.tx.QueryRow(ctx, `select `+msgCols+` from chat.messages m where m.id = $1`, pinned)); err == nil {
			if list, err := r.present(ctx, a, []msgRec{m}); err == nil && len(list) == 1 {
				out.Pinned = &list[0]
			}
		}
	}
	return out, nil
}

func (r *req) pinnedID(ctx context.Context, chatID uuid.UUID) (uuid.UUID, error) {
	var id uuid.UUID
	err := r.tx.QueryRow(ctx, `select p.message_id from chat.pins p join chat.messages m on m.id = p.message_id
		where p.chat_id = $1 and m.deleted_at is null order by p.pinned_at desc limit 1`, chatID).Scan(&id)
	if noRows(err) {
		return uuid.Nil, nil
	}
	if err != nil {
		return uuid.Nil, store("pin", err)
	}
	return id, nil
}

func (r *req) peerRef(ctx context.Context, a *access) (*api.ChatPeer, error) {
	if a.Peer == uuid.Nil {
		return nil, nil
	}
	n, err := r.nameOf(ctx, a.Peer)
	if err != nil {
		return nil, err
	}
	p := &api.ChatPeer{MemberId: a.Peer, DisplayName: n}
	if a.Facts.PeerGone {
		p.Status = new(api.ChatPeerStatus("dismissed"))
	} else {
		p.Status = new(api.ChatPeerStatus(litActive))
	}
	return p, nil
}

// folderOf is the folder of the list a chat belongs to (Q-W4.00-chats-15).
func folderOf(k Kind) string {
	switch k {
	case KindGroup, KindArea:
		return "work"
	case KindDirect, KindRecord, KindAnnounce:
		return string(k)
	}
	return string(k)
}

// listItem is a chat of the list with the place of the actor in it.
type listItem struct {
	c      *chatRec
	role   Role
	last   int64
	member bool
}

// ListChats lists the chats the actor sees: where they are in the roster, and for the owner of the business all but the
// personal ones; the last message is after the PDn mask.
func (s *Service) ListChats(ctx context.Context, tc tenantctx.TenantContext, folder, q string, cursor *string, limit int) (api.ChatList, error) {
	out := api.ChatList{Items: []api.ChatSummary{}}
	err := s.run(ctx, tc, false, func(r *req) error {
		visible, err := r.visibleChats(ctx)
		if err != nil {
			return err
		}
		out.Counts = folderCounts(visible)
		var matched map[uuid.UUID]bool
		if q = strings.TrimSpace(q); q != "" {
			if matched, err = r.searchChats(ctx, visible, q); err != nil {
				return err
			}
		}
		var found []listItem
		for _, it := range visible {
			if (folder == "" || folder == litAll || folderOf(it.c.Kind) == folder) && (matched == nil || matched[it.c.ID]) {
				found = append(found, it)
			}
		}
		page, next := pageOf(found, cursor, limit)
		out.NextCursor = next
		out.Items, err = r.summaries(ctx, page)
		return err
	})
	return out, err
}

// visibleChats are the chats the actor sees, the newest activity first: the finance chats are closed to the driver and a
// chat of a record is seen by those who see the record.
func (r *req) visibleChats(ctx context.Context) ([]listItem, error) {
	rows, err := r.tx.Query(ctx, `select `+chatCols+`, m.role, m.via, coalesce(rc.last_seq, 0), m.chat_id is not null
		from chat.chats c
		left join chat.chat_members m on m.chat_id = c.id and m.member_id = $1 and m.state = 'in'
		left join chat.receipts rc on rc.chat_id = c.id and rc.member_id = $1
		where m.chat_id is not null or ($2 and c.kind <> 'direct') order by c.updated_at desc, c.id`, r.me, r.tc.Owner)
	if err != nil {
		return nil, store("chats", err)
	}
	all, err := pgx.CollectRows(rows, scanListItem)
	if err != nil {
		return nil, store("chats", err)
	}
	driver, err := r.isDriver(ctx)
	if err != nil {
		return nil, err
	}
	visible := all[:0]
	for _, it := range all {
		if it.c.Sensitivity == litFinance && driver {
			continue
		}
		if it.c.Record != nil {
			if it.member {
				r.related(it.c.ID)
			}
			if act := recordReadAction(it.c.Record.Type); act != "" && !r.can(ctx, act, it.c) {
				continue
			}
		}
		visible = append(visible, it)
	}
	return visible, nil
}

func scanListItem(row pgx.CollectableRow) (listItem, error) {
	var (
		c         chatRec
		kind      string
		rec, over []byte
		role, via *string
		it        listItem
	)
	if err := row.Scan(&c.ID, &kind, &c.Title, &c.Unit, &c.Status, &c.Sensitivity, &rec, &c.History, &over, &c.LastSeq, &c.Used,
		&c.Revision, &c.CreatedBy, &c.CreatedAt, &c.UpdatedAt, &role, &via, &it.last, &it.member); err != nil {
		return it, err
	}
	c.Kind = Kind(kind)
	if len(rec) > 0 && string(rec) != litNull {
		c.Record = &recordRef{}
		if err := json.Unmarshal(rec, c.Record); err != nil {
			return it, err
		}
	}
	if err := json.Unmarshal(over, &c.Overrides); err != nil {
		return it, err
	}
	it.c, it.role = &c, Role(deref(role))
	if it.role == "" {
		it.role = RoleOwner
	}
	return it, nil
}

// folderCounts counts the chats of the folders «Все · Личные · Рабочие · Записи · Объявления».
func folderCounts(items []listItem) api.ChatFolderCounts {
	out := api.ChatFolderCounts{All: int64(len(items))}
	for _, it := range items {
		switch folderOf(it.c.Kind) {
		case "direct":
			out.Direct++
		case "work":
			out.Work++
		case "record":
			out.Record++
		case "announce":
			out.Announce++
		}
	}
	return out
}

// searchChats are the chats of the list whose title or messages hold q (a deleted, private or service message is not searched).
func (r *req) searchChats(ctx context.Context, items []listItem, q string) (map[uuid.UUID]bool, error) {
	ids := make([]uuid.UUID, len(items))
	for i, it := range items {
		ids[i] = it.c.ID
	}
	rows, err := r.tx.Query(ctx, `select c.id from chat.chats c where c.id = any($1) and (position(lower($2) in lower(c.title)) > 0
		or exists (select 1 from chat.messages mm where mm.chat_id = c.id and mm.deleted_at is null and mm.kind <> 'system'
		  and (mm.visible_to is null or mm.visible_to = $3) and position(lower($2) in lower(mm.text)) > 0))`, ids, q, r.me)
	if err != nil {
		return nil, store("search", err)
	}
	got, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return nil, store("search", err)
	}
	out := make(map[uuid.UUID]bool, len(got))
	for _, id := range got {
		out[id] = true
	}
	return out, nil
}

// pageOf cuts a page of the list: the cursor is the offset of its first chat; next is the cursor of the following page.
func pageOf(items []listItem, cursor *string, limit int) (page []listItem, next *string) {
	start := 0
	if cursor != nil {
		if n, err := strconv.Atoi(*cursor); err == nil && n > 0 {
			start = min(n, len(items))
		}
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	end := start + limit
	if end >= len(items) {
		return items[start:], nil
	}
	return items[start:end], new(strconv.Itoa(end))
}

// summaries are the rows of the list for a page: the unread, the last message after the mask, the peer of a personal chat
// and the pinned message.
func (r *req) summaries(ctx context.Context, page []listItem) ([]api.ChatSummary, error) {
	ids := make([]uuid.UUID, len(page))
	chats := make([]*chatRec, len(page))
	for i, it := range page {
		ids[i], chats[i] = it.c.ID, it.c
	}
	unread, wait, err := r.counters(ctx, ids)
	if err != nil {
		return nil, err
	}
	last, err := r.lastMessages(ctx, ids)
	if err != nil {
		return nil, err
	}
	peers, err := r.peers(ctx, chats)
	if err != nil {
		return nil, err
	}
	out := make([]api.ChatSummary, 0, len(page))
	for _, it := range page {
		s := api.ChatSummary{Id: it.c.ID, Kind: api.ChatSummaryKind(it.c.Kind), Title: it.c.Title, OrgUnitId: it.c.Unit,
			Status: api.ChatSummaryStatus(it.c.Status), Sensitivity: api.ChatSummarySensitivity(it.c.Sensitivity),
			Record: apiRecord(it.c.Record), LastMessage: last[it.c.ID], Revision: int64(it.c.Revision), UsedBytes: new(it.c.Used),
			My: api.ChatMy{Role: new(api.ChatMyRole(it.role)), Unread: unread[it.c.ID], AckWaitCount: wait[it.c.ID], LastReadSeq: it.last}}
		if p := peers[it.c.ID]; p != nil {
			s.Peer, s.Title = p, p.DisplayName
		}
		if pin, err := r.pinnedID(ctx, it.c.ID); err == nil && pin != uuid.Nil {
			s.PinnedMessageId = new(pin)
		}
		out = append(out, s)
	}
	return out, nil
}

// related marks the chat of a record as one the actor is in through the record (the trip they drive, the object they foreman):
// for the evaluator the record names them (scope relation, Q-W4.02-1).
func (r *req) related(id uuid.UUID) {
	if r.relatedTo == nil {
		r.relatedTo = map[uuid.UUID]bool{}
	}
	r.relatedTo[id] = true
}

// peers are the other sides of the personal chats among cs.
func (r *req) peers(ctx context.Context, cs []*chatRec) (map[uuid.UUID]*api.ChatPeer, error) {
	var ids []uuid.UUID
	for _, c := range cs {
		if c.Kind == KindDirect {
			ids = append(ids, c.ID)
		}
	}
	out := map[uuid.UUID]*api.ChatPeer{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := r.tx.Query(ctx, `select m.chat_id, p.id, p.full_name, p.membership_id, p.archived_at is not null
		from chat.chat_members m join people.person_profiles p on p.id = m.member_id where m.chat_id = any($1) and m.member_id <> $2`, ids, r.me)
	if err != nil {
		return nil, store("peers", err)
	}
	type row struct {
		chat, id uuid.UUID
		name     string
		mem      *uuid.UUID
		gone     bool
	}
	got, err := pgx.CollectRows(rows, func(rw pgx.CollectableRow) (row, error) {
		var x row
		err := rw.Scan(&x.chat, &x.id, &x.name, &x.mem, &x.gone)
		return x, err
	})
	if err != nil {
		return nil, store("peers", err)
	}
	for _, x := range got {
		status := litActive
		if x.gone {
			status = "dismissed"
		} else if m, err := r.membership(ctx, x.mem); err != nil {
			return nil, err
		} else if m.Status == "suspended" {
			status = "blocked"
		} else if m.Status == litEnded {
			status = "dismissed"
		}
		out[x.chat] = &api.ChatPeer{MemberId: x.id, DisplayName: x.name, Status: new(api.ChatPeerStatus(status))}
	}
	return out, nil
}

// lastMessages are the previews of the last messages of the chats (the PDn mask, a deleted message as a label).
func (r *req) lastMessages(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]*api.ChatMessagePreview, error) {
	out := map[uuid.UUID]*api.ChatMessagePreview{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := r.tx.Query(ctx, `select distinct on (m.chat_id) m.chat_id, m.seq, m.created_at, coalesce(p.full_name, 'Система'), m.kind, m.text,
		coalesce(m.spoiler, ''), m.deleted_at is not null, m.system_card,
		coalesce((select a.file_name from chat.attachments a where a.message_id = m.id order by a.created_at limit 1), ''),
		coalesce((select pl.question from chat.polls pl where pl.message_id = m.id), '')
		from chat.messages m left join people.person_profiles p on p.id = m.author_id
		where m.chat_id = any($1) and (m.visible_to is null or m.visible_to = $2) and not (m.ephemeral is not null and m.deleted_at is not null)
		order by m.chat_id, m.seq desc`, ids, r.me)
	if err != nil {
		return nil, store("last messages", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			chat                uuid.UUID
			pv                  api.ChatMessagePreview
			kind, text, spoiler string
			deleted             bool
			card                []byte
			file, question      string
		)
		if err := rows.Scan(&chat, &pv.Seq, &pv.At, &pv.AuthorDisplayName, &kind, &text, &spoiler, &deleted, &card, &file, &question); err != nil {
			return nil, store("last messages", err)
		}
		in := PreviewInput{Text: text, Deleted: deleted, Spoiler: spoiler, PollQuestion: question, FileName: file, System: kind == litSystem}
		if kind == litSystem {
			var c api.ChatSystemCard
			if json.Unmarshal(card, &c) == nil {
				in.Text = c.Title
			}
		}
		if kind == "document" {
			var x misc
			if json.Unmarshal(card, &x) == nil && x.Document != nil {
				in.DocTitle = x.Document.Title
			}
		}
		pv.Text, pv.Kind = Preview(in), api.ChatMessagePreviewKind(PreviewKind(in))
		out[chat] = &pv
	}
	return out, rows.Err()
}

// GetChat reads a chat the actor sees.
func (s *Service) GetChat(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (api.Chat, error) {
	var out api.Chat
	err := s.run(ctx, tc, false, func(r *req) error {
		a, err := r.open(ctx, id, false)
		if err != nil {
			return err
		}
		out, err = r.chatDTO(ctx, a)
		return err
	})
	return out, err
}

func memberRef(names map[uuid.UUID]string, id uuid.UUID) api.ChatMemberRef {
	n := names[id]
	if n == "" {
		n = litPerson
	}
	return api.ChatMemberRef{MemberId: id, DisplayName: n}
}

// impactDTO makes the impact of the contract.
func (r *req) impactDTO(ctx context.Context, im Impact) (api.ChatMembershipImpact, error) {
	var ids []uuid.UUID
	ids = append(ids, im.Joined...)
	ids = append(ids, im.Pending...)
	ids = append(ids, im.Lose...)
	for _, s := range im.Skipped {
		ids = append(ids, s.Person)
	}
	names, err := r.names(ctx, ids)
	if err != nil {
		return api.ChatMembershipImpact{}, err
	}
	out := api.ChatMembershipImpact{Joined: []api.ChatMemberRef{}, Pending: []api.ChatMemberRef{}, Lose: []api.ChatMemberRef{}, Skipped: []api.ChatSkipped{}}
	for _, id := range im.Joined {
		out.Joined = append(out.Joined, memberRef(names, id))
	}
	for _, id := range im.Pending {
		out.Pending = append(out.Pending, memberRef(names, id))
	}
	for _, id := range im.Lose {
		out.Lose = append(out.Lose, memberRef(names, id))
	}
	for _, s := range im.Skipped {
		out.Skipped = append(out.Skipped, api.ChatSkipped{Member: memberRef(names, s.Person), Reason: s.Reason})
	}
	return out, nil
}

// unitName is the name of an organization unit.
func (r *req) unitName(ctx context.Context, id *uuid.UUID) (string, error) {
	if id == nil {
		return "вся организация", nil
	}
	var n string
	if err := r.tx.QueryRow(ctx, `select name from org.units where id = $1`, *id).Scan(&n); err != nil {
		if noRows(err) {
			return "вся организация", nil
		}
		return "", store("unit", err)
	}
	return n, nil
}

// inArea reports which of the people are inside the area of unit (the unit and its descendants by their home unit).
func (r *req) outsideArea(ctx context.Context, unit uuid.UUID, ids []uuid.UUID) ([]uuid.UUID, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := r.tx.Query(ctx, `select p.id from people.person_profiles p where p.id = any($1) and not exists (
		select 1 from org.unit_closure uc where uc.ancestor_id = $2 and uc.descendant_id = p.home_unit_id)`, ids, unit)
	if err != nil {
		return nil, store("area", err)
	}
	out, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return nil, store("area", err)
	}
	return out, nil
}

// sourcesFrom validates the sources of the contract against the author and turns them into rows: a source gives the
// strongest role, the owner of a chat and «all employees» are the business owner's, a role stays in the area of the chat.
func (r *req) sourcesFrom(in []api.ChatSource, unit *uuid.UUID) ([]srcRec, error) {
	out := make([]srcRec, 0, len(in))
	for _, s := range in {
		who := string(s.Who)
		inUnit := unit != nil && s.OrgUnitId != nil && *s.OrgUnitId == *unit
		if err := SourceAllowed(r.tc.Owner, who, Role(s.Role), inUnit); err != nil {
			return nil, err
		}
		rec := srcRec{Who: who, Ref: s.RefId, Unit: s.OrgUnitId, Trip: s.TripId, Role: Role(s.Role)}
		if s.Object != nil {
			rec.Object = &objJSON{ModuleKey: s.Object.ModuleKey, EntityType: s.Object.EntityType, EntityID: s.Object.EntityId}
		}
		switch who {
		case litGroup, litRole, litMember:
			if rec.Ref == nil {
				return nil, failed("Источник состава указан не полностью")
			}
		case litRelation:
			if rec.Object == nil {
				return nil, failed("Источник состава указан не полностью")
			}
		case litTripDriver:
			if rec.Trip == nil {
				return nil, failed("Источник состава указан не полностью")
			}
		}
		out = append(out, rec)
	}
	return out, nil
}

// previewRoster computes who the sources let in, for the author of a chat in unit; the people outside the area of an author
// who is not the owner of the business are skipped (chat_member_out_of_scope).
func (r *req) previewRoster(ctx context.Context, c *chatRec, srcs []srcRec, before map[uuid.UUID]string) ([]memberRow, Impact, error) {
	cands, err := r.candidates(ctx, srcs)
	if err != nil {
		return nil, Impact{}, err
	}
	rows, err := r.decide(ctx, c.Sensitivity, cands)
	if err != nil {
		return nil, Impact{}, err
	}
	if !r.tc.Owner && c.Unit != nil {
		ids := make([]uuid.UUID, len(rows))
		for i, m := range rows {
			ids[i] = m.Person
		}
		outside, err := r.outsideArea(ctx, *c.Unit, ids)
		if err != nil {
			return nil, Impact{}, err
		}
		unit, err := r.unitName(ctx, c.Unit)
		if err != nil {
			return nil, Impact{}, err
		}
		for i := range rows {
			if slices.Contains(outside, rows[i].Person) {
				rows[i].State, rows[i].Role = litOut, ""
				rows[i].Why = "вне вашей области «" + unit + "» — добавить может владелец или руководитель области"
			}
		}
	}
	return rows, impactOf(before, rows), nil
}

// outOfScope is the error of a chat whose sources reach people outside the area of its author.
func outOfScope(im Impact) error {
	for _, s := range im.Skipped {
		if strings.HasPrefix(s.Reason, "вне вашей области") {
			return coded(codeOutOfScope, s.Reason)
		}
	}
	return nil
}

// CreateChat creates a group, area or announcement chat and its roster, or (dryRun) tells who would join.
func (s *Service) CreateChat(ctx context.Context, tc tenantctx.TenantContext, b api.ChatCreate) (api.ChatCreateResult, bool, error) { //nolint:gocyclo // one operation of the contract: a chain of checks, each with the text of the reference
	var out api.ChatCreateResult
	created := false
	err := s.run(ctx, tc, true, func(r *req) error {
		dry := b.DryRun != nil && *b.DryRun
		if b.OrgUnitId == nil && !r.tc.Owner {
			return forbidden("Чат можно создать только в своей области")
		}
		if b.OrgUnitId != nil && !r.canIn(ctx, "chat.create", *b.OrgUnitId) {
			return forbidden("Чат можно создать только в своей области")
		}
		if b.OrgUnitId == nil && !r.canIn(ctx, "chat.create", uuid.Nil) {
			return forbidden("Создавать групповые чаты может роль с правом «Чаты · Изменять»")
		}
		if b.Kind == api.ChatCreateKind(KindAnnounce) && !r.tc.Owner {
			return forbidden("Чаты объявлений создаёт владелец бизнеса")
		}
		label := "normal"
		if b.Label != nil {
			label = string(*b.Label)
		}
		if label == litFinance && !r.tc.Owner {
			return forbidden("Метку «Финансы» ставит владелец бизнеса")
		}
		title := strings.TrimSpace(b.Title)
		if !dry && len([]rune(title)) < 3 {
			return failed("Название — не короче 3 символов")
		}
		if title == "" {
			title = "Новый чат"
		}
		srcs, err := r.sourcesFrom(b.Sources, b.OrgUnitId)
		if err != nil {
			return err
		}
		if !r.tc.Owner {
			srcs = append(srcs, srcRec{Who: litMember, Ref: new(r.me), Role: RoleOwner})
		}
		history := litAll
		if b.History != nil {
			history = string(*b.History)
		}
		draft := &chatRec{ID: uuid.New(), Kind: Kind(b.Kind), Title: title, Unit: b.OrgUnitId, Status: litActive, Sensitivity: label,
			History: history, Revision: 1}
		rows, im, err := r.previewRoster(ctx, draft, srcs, map[uuid.UUID]string{})
		if err != nil {
			return err
		}
		dto, err := r.impactDTO(ctx, im)
		if err != nil {
			return err
		}
		if dry {
			out = api.ChatCreateResult{Applied: false, Impact: dto}
			return nil
		}
		if err := outOfScope(im); err != nil {
			return err
		}
		if _, err := r.tx.Exec(ctx, `insert into chat.chats (id, kind, title, org_unit_id, status, sensitivity, history, created_by, created_at, updated_at)
			values ($1, $2, $3, $4, 'active', $5, $6, $7, $8, $8)`, draft.ID, string(draft.Kind), draft.Title, draft.Unit, label, history, r.me, r.now); err != nil {
			return store(litChat, err)
		}
		if err := r.saveSources(ctx, draft.ID, srcs); err != nil {
			return err
		}
		if err := r.reconcile(ctx, draft.ID, rows); err != nil {
			return err
		}
		name, err := r.nameOf(ctx, r.me)
		if err != nil {
			return err
		}
		unit, err := r.unitName(ctx, draft.Unit)
		if err != nil {
			return err
		}
		text := kindOne[draft.Kind]
		if draft.Unit != nil {
			text += " · " + unit
		}
		if _, err := r.service(ctx, draft, chatCard("add_comment", "ok", "Чат создан · "+name, text)); err != nil {
			return err
		}
		if err := r.journal(ctx, draft.ID, "Чат создан · "+name, nil); err != nil {
			return err
		}
		if err := r.publish(ctx, "chat.chat.created", "chat.chat", draft.ID, map[string]any{litChatID: draft.ID, litKind: string(draft.Kind)}); err != nil {
			return err
		}
		if err := r.memberEvents(ctx, draft.ID, im.Joined, nil); err != nil {
			return err
		}
		if err := r.changed(ctx, draft); err != nil {
			return err
		}
		a, err := r.open(ctx, draft.ID, false)
		if err != nil {
			return err
		}
		chat, err := r.chatDTO(ctx, a)
		if err != nil {
			return err
		}
		out = api.ChatCreateResult{Applied: true, Chat: &chat, Impact: dto}
		created = true
		return nil
	})
	return out, created, err
}

// memberEvents publishes chat.member.joined/left for the people who came and left.
func (r *req) memberEvents(ctx context.Context, chatID uuid.UUID, joined, left []uuid.UUID) error {
	for _, id := range joined {
		if err := r.publish(ctx, "chat.member.joined", "chat.chat", chatID, map[string]any{litChatID: chatID, "memberId": id}); err != nil {
			return err
		}
	}
	for _, id := range left {
		if err := r.publish(ctx, "chat.member.left", "chat.chat", chatID, map[string]any{litChatID: chatID, "memberId": id}); err != nil {
			return err
		}
	}
	return nil
}
