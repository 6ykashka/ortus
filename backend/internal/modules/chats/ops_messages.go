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

const (
	textEmpty       = "Напишите сообщение или прикрепите файл"
	textTooLong     = "Больше 4000 знаков: длинный текст удобнее оформить страницей Базы знаний"
	textNoAnnounce  = "Важное с подтверждением отправляют модераторы с правом «Чаты · Решать»"
	textNoAll       = "@все — только у модераторов с правом «Чаты · Решать»"
	textViewOnceOff = "Одноразовые файлы отправляют модераторы, если это разрешает политика"
	textNoFile      = "Прикрепите файл для одноразового просмотра"
	textNoFiles     = "Отправлять файлы в этом чате нельзя"
	textNoPolls     = "Создавать опросы в этом чате нельзя"
)

// visibleMessages is the condition of the messages the actor may see: not the private ones of others, and no temporary message
// whose time is over.
const visibleMessages = `(m.visible_to is null or m.visible_to = $2) and not (m.ephemeral is not null and
	(m.deleted_at is not null or (m.ephemeral ->> 'expiresAt')::timestamptz <= $3))`

// Messages reads the messages of a chat: the latest ones, or those before or after a number; the PDn is masked, a deleted
// message is a label.
func (s *Service) Messages(ctx context.Context, tc tenantctx.TenantContext, chatID uuid.UUID, topic *string, before, after *int64, limit int) (api.ChatMessageList, error) { //nolint:gocyclo // one operation of the contract: a chain of checks, each with the text of the reference
	var out api.ChatMessageList
	err := s.run(ctx, tc, false, func(r *req) error {
		a, err := r.open(ctx, chatID, false)
		if err != nil {
			return err
		}
		if limit <= 0 || limit > 200 {
			limit = 50
		}
		q := `select ` + msgCols + ` from chat.messages m where m.chat_id = $1 and ` + visibleMessages
		args := []any{chatID, r.me, r.now}
		add := func(cond string, v any) {
			args = append(args, v)
			q += strings.Replace(cond, "$?", "$"+itoa(len(args)), 1)
		}
		if a.Chat.History != litAll && a.Seat.JoinedAt != nil && (!r.tc.Owner || a.Seat.Via != ownerVia) {
			add(" and m.created_at >= $?", *a.Seat.JoinedAt)
		}
		if topic != nil && *topic != "" {
			add(` and m.topic_id = (select t.id from chat.topics t where t.chat_id = m.chat_id and lower(t.name) = lower($?))`, *topic)
		}
		desc := true
		switch {
		case after != nil:
			add(" and m.seq > $?", *after)
			desc = false
		case before != nil:
			add(" and m.seq < $?", *before)
		}
		if desc {
			q += " order by m.seq desc"
		} else {
			q += " order by m.seq"
		}
		add(" limit $?", limit+1)
		rows, err := r.tx.Query(ctx, q, args...)
		if err != nil {
			return store("messages", err)
		}
		list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (msgRec, error) { return scanMsg(row) })
		if err != nil {
			return store("messages", err)
		}
		if len(list) > limit {
			out.HasMore, list = true, list[:limit]
		}
		if desc {
			slices.Reverse(list)
		}
		if out.Items, err = r.present(ctx, a, list); err != nil {
			return err
		}
		out.LastSeq = new(a.Chat.LastSeq)
		return nil
	})
	return out, err
}

// ownerVia is the "via" of the business owner who is in a chat without a place in its roster.
const ownerVia = "Владелец бизнеса · видит все рабочие чаты"

func itoa(n int) string { return strconv.Itoa(n) }

func intToString(n int) string { return strconv.Itoa(n) }

// writeError is the refusal to write: the reason the actor cannot write in the chat.
func writeError(a *access) error {
	switch {
	case a.Chat.Status == litArchived:
		return forbidden(textArchived)
	case a.Facts.PeerGone:
		return forbidden(textPeerGone)
	case a.Chat.Kind == KindAnnounce:
		return forbidden(textReadOnlyAnn)
	}
	return forbidden(textReader)
}

// topicID finds a topic of the chat by its name.
func (r *req) topicID(ctx context.Context, chatID uuid.UUID, name string) (*uuid.UUID, error) {
	if strings.TrimSpace(name) == "" {
		return nil, nil
	}
	var id uuid.UUID
	err := r.tx.QueryRow(ctx, `select id from chat.topics where chat_id = $1 and lower(name) = lower(btrim($2))`, chatID, name).Scan(&id)
	if noRows(err) {
		return nil, failed("Такой темы в чате нет")
	}
	if err != nil {
		return nil, store("topic", err)
	}
	return &id, nil
}

// fileRec is a file of the organization to be attached to a message.
type fileRec struct {
	ID    uuid.UUID
	Name  string
	Bytes int64
	Kind  string
}

// filesToAttach checks the files of a message: uploaded by the author for chats, checked by the scanner, not attached yet.
func (r *req) filesToAttach(ctx context.Context, ids []uuid.UUID) ([]fileRec, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := r.tx.Query(ctx, `select o.id, o.state, o.purpose, coalesce(o.bytes, 0), o.declared_mime, coalesce(o.detected_mime, ''), o.uploaded_by,
		exists (select 1 from chat.attachments a where a.file_id = o.id) from files.objects o where o.id = any($1)`, ids)
	if err != nil {
		return nil, store("files", err)
	}
	type row struct {
		id             uuid.UUID
		state, purpose string
		bytes          int64
		declared, det  string
		by             uuid.UUID
		used           bool
	}
	got, err := pgx.CollectRows(rows, func(rw pgx.CollectableRow) (row, error) {
		var x row
		err := rw.Scan(&x.id, &x.state, &x.purpose, &x.bytes, &x.declared, &x.det, &x.by, &x.used)
		return x, err
	})
	if err != nil {
		return nil, store("files", err)
	}
	byID := map[uuid.UUID]row{}
	for _, x := range got {
		byID[x.id] = x
	}
	out := make([]fileRec, 0, len(ids))
	for _, id := range ids {
		x, ok := byID[id]
		if !ok || x.purpose != "chat_attachment" || x.by != r.me {
			return nil, failed("Файл не найден: загрузите его заново")
		}
		if x.used {
			return nil, failed("Файл уже прикреплён к другому сообщению")
		}
		if x.state != "ready" {
			return nil, failed("Файл ещё проверяется: подождите минуту")
		}
		ct, name := attachmentName(x.declared)
		if x.det != "" {
			ct = x.det
		}
		out = append(out, fileRec{ID: id, Name: name, Bytes: x.bytes, Kind: kindOfMIME(ct)})
	}
	return out, nil
}

// kindOfMIME is the kind of an attachment by its type.
func kindOfMIME(ct string) string {
	switch {
	case strings.HasPrefix(ct, "image/"):
		return litPhoto
	case strings.HasPrefix(ct, "video/"):
		return litVideo
	case strings.HasPrefix(ct, "audio/"):
		return "voice"
	}
	return "doc"
}

// attsOf are the attachments of a chat as the planning of the storage sees them.
func (r *req) attsOf(ctx context.Context, c *chatRec) ([]Att, []Hold, error) {
	holds, err := r.activeHolds(ctx)
	if err != nil {
		return nil, nil, err
	}
	rows, err := r.tx.Query(ctx, `select a.id, a.kind, a.size_bytes, a.created_at, a.saved_to is not null, a.gone_at, m.author_id, m.created_at
		from chat.attachments a join chat.messages m on m.id = a.message_id where m.chat_id = $1 and (a.gone_at is null or a.gone_at > $2) order by a.created_at, a.id`, c.ID, r.now)
	if err != nil {
		return nil, nil, store("attachments", err)
	}
	defer rows.Close()
	var out []Att
	for rows.Next() {
		var (
			x       Att
			created time.Time
			gone    *time.Time
			author  *uuid.UUID
			sent    time.Time
		)
		if err := rows.Scan(&x.ID, &x.Kind, &x.Bytes, &created, &x.Saved, &gone, &author, &sent); err != nil {
			return nil, nil, store("attachments", err)
		}
		x.AgeDays = int(r.now.Sub(created) / (24 * time.Hour))
		x.Compressed = slices.Contains(c.Overrides.Compressed, x.ID)
		x.Held = AnyHold(holds, c.ID, deref0(author), sent, r.now)
		out = append(out, x)
	}
	return out, holds, rows.Err()
}

func deref0(id *uuid.UUID) uuid.UUID {
	if id == nil {
		return uuid.Nil
	}
	return *id
}

// PostMessage posts a message: text, files, a poll, a document card, the important one with «Ознакомлен», a temporary one,
// a view-once file or a spoiler. The checks run before anything is written.
func (s *Service) PostMessage(ctx context.Context, tc tenantctx.TenantContext, chatID uuid.UUID, b api.ChatMessageCreate) (api.ChatMessage, error) {
	var out api.ChatMessage
	err := s.run(ctx, tc, true, func(r *req) error {
		a, err := r.open(ctx, chatID, true)
		if err != nil {
			return err
		}
		d, err := r.checkPost(ctx, a, b)
		if err != nil {
			return err
		}
		m, err := r.writePost(ctx, a, b, d)
		if err != nil {
			return err
		}
		list, err := r.present(ctx, a, []msgRec{m})
		if err != nil {
			return err
		}
		out = list[0]
		return nil
	})
	return out, err
}

// postDraft is a message that passed the checks: what is left to write.
type postDraft struct {
	text     string
	viewOnce bool
	topic    *uuid.UUID
	poll     *pollDraft
	files    []fileRec
	total    int64
}

// checkPost runs the checks of a new message before anything is written: the right to write, the content, the rights to
// the important, the temporary and the view-once, the topic, the poll, the files and their size.
func (r *req) checkPost(ctx context.Context, a *access, b api.ChatMessageCreate) (postDraft, error) {
	var d postDraft
	if !a.Can.Write {
		return d, writeError(a)
	}
	if b.Text != nil {
		d.text = strings.TrimSpace(*b.Text)
	}
	var fileIDs []uuid.UUID
	if b.FileIds != nil {
		fileIDs = *b.FileIds
	}
	d.viewOnce = b.ViewOnce != nil && *b.ViewOnce
	if err := mayPost(a, b, d, len(fileIDs)); err != nil {
		return d, err
	}
	var err error
	if d.topic, err = r.topicID(ctx, a.Chat.ID, deref(b.Topic)); err != nil {
		return d, err
	}
	if d.poll, err = r.pollDraft(b.Poll); err != nil {
		return d, err
	}
	if d.files, err = r.filesToAttach(ctx, fileIDs); err != nil {
		return d, err
	}
	for _, f := range d.files {
		if f.Bytes > int64(a.Policy.MaxFileMb)*1_000_000 {
			return d, coded(codeTooLarge, "«"+f.Name+"» больше "+sizeText(float64(a.Policy.MaxFileMb))+" — предел политики вида «"+kindLabels[a.Chat.Kind]+"»")
		}
		d.total += f.Bytes
	}
	return d, nil
}

// mayPost checks the content of a message against the rights of the actor and the policy of the kind.
func mayPost(a *access, b api.ChatMessageCreate, d postDraft, files int) error { //nolint:gocyclo // the table of the refusals of the reference: one case, one text
	switch {
	case d.text == "" && files == 0 && b.Document == nil && b.Poll == nil:
		return failed(textEmpty)
	case len([]rune(d.text)) > 4000:
		return failed(textTooLong)
	case b.Important != nil && !a.Can.Announce:
		return coded(codeContent, textNoAnnounce)
	case MentionsAll(d.text) && !a.Can.Announce:
		return coded(codeContent, textNoAll)
	case b.Ephemeral != nil && !a.Can.Ephemeral:
		return coded(codeEphemeral, "Временные сообщения в этом чате запрещены политикой вида «"+kindLabels[a.Chat.Kind]+"»")
	case d.viewOnce && !a.Can.ViewOnce:
		return coded(codeEphemeral, textViewOnceOff)
	case d.viewOnce && files == 0:
		return failed(textNoFile)
	case files > 0 && !a.Can.Files:
		return forbidden(textNoFiles)
	case b.Poll != nil && !a.Can.Polls:
		return forbidden(textNoPolls)
	}
	return nil
}

// newMessage makes the row of a checked message: its kind, the important, the temporary and the spoiler.
func (r *req) newMessage(b api.ChatMessageCreate, d postDraft) (newMsg, error) {
	nm := newMsg{Kind: litText, Author: &r.me, Topic: d.topic, Text: d.text}
	if d.poll != nil {
		nm.Kind = "poll"
	}
	if b.Document != nil {
		nm.Kind = "document"
		nm.Card = misc{Document: &api.ChatDocRef{Kind: b.Document.Kind, RefId: b.Document.RefId, Title: "Документ"}}
	}
	if b.Important != nil {
		nm.Important = importantJSON{DueDate: r.now.AddDate(0, 0, 3).Format(time.DateOnly)}
	}
	if b.Ephemeral != nil {
		h := b.Ephemeral.TtlHours
		if h < 1 || h > 168 {
			return nm, failed("Срок временного сообщения — от 1 часа до 7 дней")
		}
		nm.Ephemeral = ephemeralJSON{ExpiresAt: r.now.Add(time.Duration(h) * time.Hour), TTLHours: h}
	}
	if b.Spoiler != nil {
		if sp := []rune(strings.TrimSpace(*b.Spoiler)); len(sp) > 0 {
			nm.Spoiler = new(string(sp[:min(300, len(sp))]))
		}
	}
	return nm, nil
}

// writePost writes a checked message: the place for its files by the policy of the chat, the message with its poll and
// attachments, the place of the author in the reading, the events and the hint.
func (r *req) writePost(ctx context.Context, a *access, b api.ChatMessageCreate, d postDraft) (msgRec, error) {
	c, pol := a.Chat, a.Policy
	nm, err := r.newMessage(b, d)
	if err != nil {
		return msgRec{}, err
	}
	var plan StoragePlan
	if d.total > 0 {
		atts, _, err := r.attsOf(ctx, c)
		if err != nil {
			return msgRec{}, err
		}
		if plan, err = PlanStorage(c.Used, d.total, pol, atts); err != nil {
			return msgRec{}, err
		}
		if err := r.applyPlan(ctx, c, plan); err != nil {
			return msgRec{}, err
		}
	}
	m, err := r.post(ctx, c, nm)
	if err != nil {
		return msgRec{}, err
	}
	if d.poll != nil {
		if err := r.insertPoll(ctx, m.ID, *d.poll); err != nil {
			return msgRec{}, err
		}
	}
	if err := r.attach(ctx, c, pol, m.ID, d, plan); err != nil {
		return msgRec{}, err
	}
	if _, err := r.tx.Exec(ctx, `insert into chat.receipts (chat_id, member_id, last_seq, read_at) values ($1, $2, $3, $4)
		on conflict (chat_id, member_id) do update set last_seq = greatest(chat.receipts.last_seq, excluded.last_seq), read_at = excluded.read_at`,
		c.ID, r.me, m.Seq, r.now); err != nil {
		return msgRec{}, store("receipt", err)
	}
	if err := r.postedEvents(ctx, c, m, nm.Kind, b, d); err != nil {
		return msgRec{}, err
	}
	return m, r.changed(ctx, c)
}

// attach writes the attachments of a message and charges their size to the chat.
func (r *req) attach(ctx context.Context, c *chatRec, pol Policy, msg uuid.UUID, d postDraft, plan StoragePlan) error {
	for _, f := range d.files {
		if _, err := r.tx.Exec(ctx, `insert into chat.attachments (message_id, file_id, file_name, size_bytes, kind, view_once, created_at)
			values ($1, $2, $3, $4, $5, $6, $7)`, msg, f.ID, f.Name, f.Bytes, f.Kind, d.viewOnce, r.now); err != nil {
			return store("attachment", err)
		}
	}
	if d.total == 0 {
		return nil
	}
	if _, err := r.tx.Exec(ctx, `update chat.chats set used_bytes = used_bytes + $2 where id = $1`, c.ID, d.total); err != nil {
		return store("used", err)
	}
	before := c.Used
	c.Used += d.total
	return r.quotaEvents(ctx, c, pol, before, plan)
}

// postedEvents publishes the events of a new message: chat.message.posted with the mentioned members and, for the important
// one, chat.ack.requested. The text is never in the payload.
func (r *req) postedEvents(ctx context.Context, c *chatRec, m msgRec, kind string, b api.ChatMessageCreate, d postDraft) error {
	mentions, err := r.mentionsOf(ctx, c.ID, d.text, b.Mentions)
	if err != nil {
		return err
	}
	payload := map[string]any{litChatID: c.ID, litMessageID: m.ID, litSeq: m.Seq, litKind: kind}
	if len(mentions) > 0 {
		payload["mentions"] = mentions
	}
	if err := r.publish(ctx, "chat.message.posted", "chat.message", m.ID, payload); err != nil {
		return err
	}
	if b.Important == nil {
		return nil
	}
	return r.publish(ctx, "chat.ack.requested", "chat.message", m.ID, map[string]any{litChatID: c.ID, litMessageID: m.ID})
}

// mentionsOf are the members of the chat addressed by «@Имя», «@все» and the list of the request; a person outside the chat is
// never named (PD-60).
func (r *req) mentionsOf(ctx context.Context, chatID uuid.UUID, text string, given *[]uuid.UUID) ([]uuid.UUID, error) {
	rows, err := r.tx.Query(ctx, `select m.member_id, p.full_name from chat.chat_members m join people.person_profiles p on p.id = m.member_id
		where m.chat_id = $1 and m.state = 'in' and m.member_id <> $2`, chatID, r.me)
	if err != nil {
		return nil, store("mentions", err)
	}
	names := map[uuid.UUID]string{}
	for rows.Next() {
		var (
			id uuid.UUID
			n  string
		)
		if err := rows.Scan(&id, &n); err != nil {
			rows.Close()
			return nil, store("mentions", err)
		}
		names[id] = n
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, store("mentions", err)
	}
	var out []uuid.UUID
	if MentionsAll(text) {
		for id := range names {
			out = append(out, id)
		}
		return out, nil
	}
	out = Mentioned(text, names)
	if given != nil {
		for _, id := range *given {
			if _, in := names[id]; in && !slices.Contains(out, id) {
				out = append(out, id)
			}
		}
	}
	return out, nil
}

// pollDraft is a poll checked and ready to be written.
type pollDraft struct {
	Question  string
	Options   []pollOpt
	Anonymous bool
	Multiple  bool
	Closes    time.Time
}

func (r *req) pollDraft(p *api.ChatPollCreate) (*pollDraft, error) {
	if p == nil {
		return nil, nil
	}
	q := strings.TrimSpace(p.Question)
	var opts []pollOpt
	for _, o := range p.Options {
		if t := strings.TrimSpace(o); t != "" {
			opts = append(opts, pollOpt{ID: uuid.New(), Text: t})
		}
	}
	switch {
	case q == "":
		return nil, failed("Напишите вопрос опроса")
	case len(opts) < 2:
		return nil, failed("Нужно минимум два варианта")
	case len(opts) > 10:
		return nil, failed("Не больше 10 вариантов")
	}
	anon := p.Anonymous != nil && *p.Anonymous
	if anon && len(r.s.PollKey) == 0 {
		return nil, coded("dependency_unavailable", "Анонимные опросы не настроены: нет ключа голосов")
	}
	hours := int64(24)
	if p.ClosesInHours != nil {
		hours = min(168, max(1, *p.ClosesInHours))
	}
	return &pollDraft{Question: q, Options: opts, Anonymous: anon, Multiple: p.Multiple != nil && *p.Multiple,
		Closes: r.now.Add(time.Duration(hours) * time.Hour)}, nil
}

func (r *req) insertPoll(ctx context.Context, msg uuid.UUID, p pollDraft) error {
	opts, _ := json.Marshal(p.Options)
	if _, err := r.tx.Exec(ctx, `insert into chat.polls (message_id, question, options, anonymous, multiple, closes_at) values ($1, $2, $3, $4, $5, $6)`,
		msg, p.Question, opts, p.Anonymous, p.Multiple, p.Closes); err != nil {
		return store("poll", err)
	}
	return nil
}

// applyPlan writes the plan of the storage: removed attachments, compressed ones and the service message about it.
func (r *req) applyPlan(ctx context.Context, c *chatRec, plan StoragePlan) error {
	if len(plan.Delete) > 0 {
		if err := r.dropAttachments(ctx, plan.Delete); err != nil {
			return err
		}
	}
	for id, size := range plan.Compress {
		if _, err := r.tx.Exec(ctx, `update chat.attachments set size_bytes = $2 where id = $1`, id, size); err != nil {
			return store("compress", err)
		}
		c.Overrides.Compressed = append(c.Overrides.Compressed, id)
	}
	if len(plan.Compress) > 0 {
		if _, err := r.tx.Exec(ctx, `update chat.chats set overrides = $2 where id = $1`, c.ID, mustJSON(c.Overrides)); err != nil {
			return store("overrides", err)
		}
	}
	if plan.Freed > 0 {
		if _, err := r.tx.Exec(ctx, `update chat.chats set used_bytes = greatest(0, used_bytes - $2) where id = $1`, c.ID, plan.Freed); err != nil {
			return store("used", err)
		}
		c.Used = max(0, c.Used-plan.Freed)
	}
	if plan.Note != nil {
		if _, err := r.service(ctx, c, chatCard(plan.Note.Icon, "neutral", plan.Note.Title, plan.Note.Text)); err != nil {
			return err
		}
	}
	return nil
}

// dropAttachments marks attachments as gone and has the files removed.
func (r *req) dropAttachments(ctx context.Context, ids []uuid.UUID) error {
	rows, err := r.tx.Query(ctx, `with old as (select id, file_id from chat.attachments where id = any($1) and file_id is not null for update)
		update chat.attachments a set gone_at = least(coalesce(a.gone_at, $2::timestamptz), $2::timestamptz), file_id = null from old where a.id = old.id returning old.file_id`, ids, r.now)
	if err != nil {
		return store("drop", err)
	}
	files, err := pgx.CollectRows(rows, pgx.RowTo[*uuid.UUID])
	if err != nil {
		return store("drop", err)
	}
	var fids []uuid.UUID
	for _, f := range files {
		if f != nil {
			fids = append(fids, *f)
		}
	}
	if r.s.Files != nil && len(fids) > 0 {
		cleanup, err := r.s.Files.Remove(ctx, r.tx, fids)
		if err != nil {
			return store("remove files", err)
		}
		if cleanup != nil {
			r.afterCommit(func() { cleanup(context.WithoutCancel(ctx)) })
		}
	}
	return nil
}

// quotaEvents raises chat.quota.warning / chat.quota.full once, when the place of the chat crosses 75 % or 100 %.
func (r *req) quotaEvents(ctx context.Context, c *chatRec, pol Policy, before int64, plan StoragePlan) error {
	if pol.QuotaMb == nil {
		return nil
	}
	quota := int64(*pol.QuotaMb) * 1_000_000
	lvl := QuotaCrossed(before-plan.Freed, c.Used, quota)
	switch lvl {
	case "warning", "offer":
		return r.publish(ctx, "chat.quota.warning", "chat.chat", c.ID, map[string]any{litChatID: c.ID, "level": lvl})
	case "full":
		return r.publish(ctx, "chat.quota.full", "chat.chat", c.ID, map[string]any{litChatID: c.ID})
	}
	return nil
}

// message reads a message of the chat by its id, 404 for another chat's or missing.
func (r *req) message(ctx context.Context, chatID, id uuid.UUID, lock bool) (msgRec, error) {
	q := `select ` + msgCols + ` from chat.messages m where m.id = $1 and m.chat_id = $2 and (m.visible_to is null or m.visible_to = $3)`
	if lock {
		q += ` for update of m`
	}
	m, err := scanMsg(r.tx.QueryRow(ctx, q, id, chatID, r.me))
	if noRows(err) {
		return msgRec{}, notFound(textMsgNotFound)
	}
	if err != nil {
		return msgRec{}, store("message", err)
	}
	return m, nil
}

// EditMessage edits an own message inside the window of the policy; the previous text goes to the versions.
func (s *Service) EditMessage(ctx context.Context, tc tenantctx.TenantContext, chatID, id uuid.UUID, text string) (api.ChatMessage, error) {
	var out api.ChatMessage
	err := s.run(ctx, tc, true, func(r *req) error {
		a, err := r.open(ctx, chatID, false)
		if err != nil {
			return err
		}
		m, err := r.message(ctx, chatID, id, true)
		if err != nil {
			return err
		}
		t := strings.TrimSpace(text)
		if err := r.mayEdit(a, m, t); err != nil {
			return err
		}
		if t != m.Text {
			if err := r.saveEdit(ctx, a, &m, t); err != nil {
				return err
			}
		}
		list, err := r.present(ctx, a, []msgRec{m})
		if err != nil {
			return err
		}
		out = list[0]
		return nil
	})
	return out, err
}

// mayEdit checks that the actor may change the text of m to t: an own text message, inside the window of the policy.
func (r *req) mayEdit(a *access, m msgRec, t string) error {
	switch {
	case m.Author == nil || *m.Author != r.me:
		return forbidden("Править можно только свои сообщения")
	case m.DeletedAt != nil:
		return failed(textMsgDeleted)
	case m.Kind == litSystem || m.Kind == "poll":
		return failed("Это сообщение править нельзя")
	case t == "":
		return failed("Текст не может быть пустым — удалите сообщение")
	case len([]rune(t)) > 4000:
		return failed(textTooLong)
	case a.Chat.Status == litArchived:
		return forbidden(textArchived)
	}
	if d, limited := EditWindow(a.Policy.Edit); limited && r.now.Sub(m.CreatedAt) > d {
		return coded(codeEditWindow, "Окно правки закрыто: "+editLabels[a.Policy.Edit]+" по политике вида «"+kindLabels[a.Chat.Kind]+"»")
	}
	return nil
}

// saveEdit writes the new text and keeps the previous one as a version.
func (r *req) saveEdit(ctx context.Context, a *access, m *msgRec, t string) error {
	if _, err := r.tx.Exec(ctx, `insert into chat.message_versions (message_id, number, text, edited_at, edited_by)
		values ($1, (select coalesce(max(number), 0) + 1 from chat.message_versions where message_id = $1), $2, $3, $4)`, m.ID, m.Text, r.now, r.me); err != nil {
		return store("version", err)
	}
	if _, err := r.tx.Exec(ctx, `update chat.messages set text = $2, edited_at = $3 where id = $1`, m.ID, t, r.now); err != nil {
		return store("edit", err)
	}
	if _, err := r.tx.Exec(ctx, `update chat.chats set updated_at = $2 where id = $1`, a.Chat.ID, r.now); err != nil {
		return store(litChat, err)
	}
	m.Text, m.EditedAt = t, &r.now
	if err := r.publish(ctx, "chat.message.edited", "chat.message", m.ID, map[string]any{litChatID: a.Chat.ID, litMessageID: m.ID, litSeq: m.Seq}); err != nil {
		return err
	}
	return r.changed(ctx, a.Chat)
}

// DeleteMessage deletes a message for everybody: only the label stays, the content goes to the journal for the term of the
// policy. A hold forbids it; a moderator needs a reason.
func (s *Service) DeleteMessage(ctx context.Context, tc tenantctx.TenantContext, chatID, id uuid.UUID, reason string) (api.ChatMessage, error) { //nolint:gocyclo // one operation of the contract: a chain of checks, each with the text of the reference
	var out api.ChatMessage
	err := s.run(ctx, tc, true, func(r *req) error {
		a, err := r.open(ctx, chatID, false)
		if err != nil {
			return err
		}
		m, err := r.message(ctx, chatID, id, true)
		if err != nil {
			return err
		}
		if m.DeletedAt != nil {
			return failed("Сообщение уже удалено")
		}
		if m.Kind == litSystem {
			return forbidden("Служебные сообщения не удаляются")
		}
		holds, err := r.activeHolds(ctx)
		if err != nil {
			return err
		}
		if h := coveringHold(holds, chatID, m, r.now); h != nil {
			return coded(codeOnHold, "Нельзя удалить: удержание «"+h.Reason+"»"+untilText(h.Until))
		}
		own := m.Author != nil && *m.Author == r.me
		inWindow := true
		if d, limited := EditWindow(a.Policy.Edit); limited {
			inWindow = r.now.Sub(m.CreatedAt) <= d
		}
		if own && !inWindow && !a.Can.Moderate {
			return coded(codeEditWindow, "Окно удаления закрыто: "+editLabels[a.Policy.Edit]+". Попросите модератора")
		}
		if !own && !a.Can.Moderate {
			return forbidden("Чужие сообщения удаляют модераторы")
		}
		why := strings.TrimSpace(reason)
		if !own && why == "" {
			return failed("Укажите причину — её увидят участники")
		}
		x := m.misc()
		x.Deleted = &struct {
			Reason    string `json:"reason,omitempty"`
			Moderator bool   `json:"moderator"`
		}{Reason: why, Moderator: !own}
		card, _ := json.Marshal(x)
		content := m.Text
		if _, err := r.tx.Exec(ctx, `update chat.messages set deleted_at = $2, deleted_by = $3, deleted_text = $4, text = '', spoiler = null,
			system_card = $5, important = null where id = $1`, m.ID, r.now, r.me, content, card); err != nil {
			return store("delete", err)
		}
		if err := r.releaseAttachments(ctx, a.Chat, m.ID); err != nil {
			return err
		}
		label := "Удалено автором"
		if !own {
			label = "Удалено модератором: " + why
		}
		if err := r.journal(ctx, chatID, label+" · сообщение от "+r.stamp(m.CreatedAt), &content); err != nil {
			return err
		}
		if err := r.publish(ctx, "chat.message.deleted", "chat.message", m.ID, map[string]any{litChatID: chatID, litMessageID: m.ID, litSeq: m.Seq, "moderator": !own}); err != nil {
			return err
		}
		if _, err := r.tx.Exec(ctx, `update chat.chats set updated_at = $2 where id = $1`, chatID, r.now); err != nil {
			return store(litChat, err)
		}
		if err := r.changed(ctx, a.Chat); err != nil {
			return err
		}
		fresh, err := r.message(ctx, chatID, id, false)
		if err != nil {
			return err
		}
		list, err := r.present(ctx, a, []msgRec{fresh})
		if err != nil {
			return err
		}
		out = list[0]
		return nil
	})
	return out, err
}

// releaseAttachments frees the place of the files of a deleted message.
func (r *req) releaseAttachments(ctx context.Context, c *chatRec, msg uuid.UUID) error {
	var bytes int64
	rows, err := r.tx.Query(ctx, `select id, size_bytes, saved_to is not null from chat.attachments where message_id = $1 and (gone_at is null or gone_at > $2)`, msg, r.now)
	if err != nil {
		return store("attachments", err)
	}
	var ids []uuid.UUID
	for rows.Next() {
		var (
			id    uuid.UUID
			size  int64
			saved bool
		)
		if err := rows.Scan(&id, &size, &saved); err != nil {
			rows.Close()
			return store("attachments", err)
		}
		if !saved {
			bytes += size
			ids = append(ids, id)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return store("attachments", err)
	}
	if len(ids) == 0 {
		return nil
	}
	if err := r.dropAttachments(ctx, ids); err != nil {
		return err
	}
	if _, err := r.tx.Exec(ctx, `update chat.chats set used_bytes = greatest(0, used_bytes - $2) where id = $1`, c.ID, bytes); err != nil {
		return store("used", err)
	}
	return nil
}

// stamp is the date and time of a message for the texts of the journal.
func (r *req) stamp(t time.Time) string { return t.In(time.UTC).Format("02.01 15:04") }

// Versions lists the previous texts of a message: for its author and the moderators.
func (s *Service) Versions(ctx context.Context, tc tenantctx.TenantContext, chatID, id uuid.UUID) (api.ChatMessageVersionList, error) {
	out := api.ChatMessageVersionList{Items: []api.ChatMessageVersion{}}
	err := s.run(ctx, tc, false, func(r *req) error {
		a, err := r.open(ctx, chatID, false)
		if err != nil {
			return err
		}
		m, err := r.message(ctx, chatID, id, false)
		if err != nil {
			return err
		}
		if !r.authorOrModerator(m, a) {
			return forbidden("История правок видна автору и модераторам")
		}
		if m.DeletedAt != nil {
			return failed(textMsgDeleted)
		}
		rows, err := r.tx.Query(ctx, `select text, edited_at from chat.message_versions where message_id = $1 order by number`, id)
		if err != nil {
			return store("versions", err)
		}
		defer rows.Close()
		for rows.Next() {
			var v api.ChatMessageVersion
			if err := rows.Scan(&v.Text, &v.EditedAt); err != nil {
				return store("versions", err)
			}
			if a.Policy.PdnMask {
				v.Text = MaskPdn(v.Text)
			}
			out.Items = append(out.Items, v)
		}
		return rows.Err()
	})
	return out, err
}

// MarkRead moves the place the member has read up to; it never moves back and never past the last message.
func (s *Service) MarkRead(ctx context.Context, tc tenantctx.TenantContext, chatID uuid.UUID, upto int64) (api.ChatReadState, error) {
	var out api.ChatReadState
	err := s.run(ctx, tc, true, func(r *req) error {
		a, err := r.open(ctx, chatID, false)
		if err != nil {
			return err
		}
		if upto > a.Chat.LastSeq {
			upto = a.Chat.LastSeq
		}
		if upto < 0 {
			upto = 0
		}
		if err := r.tx.QueryRow(ctx, `insert into chat.receipts (chat_id, member_id, last_seq, read_at) values ($1, $2, $3, $4)
			on conflict (chat_id, member_id) do update set last_seq = greatest(chat.receipts.last_seq, excluded.last_seq),
			  read_at = case when excluded.last_seq > chat.receipts.last_seq then excluded.read_at else chat.receipts.read_at end
			returning last_seq`, chatID, r.me, upto, r.now).Scan(&out.LastReadSeq); err != nil {
			return store("receipt", err)
		}
		a.Seat.LastRead = out.LastReadSeq
		unread, _, err := r.counters(ctx, []uuid.UUID{chatID})
		if err != nil {
			return err
		}
		out.Unread = unread[chatID]
		return nil
	})
	return out, err
}

// Ack confirms an important message («Ознакомлен»); a repeat is not an error.
func (s *Service) Ack(ctx context.Context, tc tenantctx.TenantContext, chatID, id uuid.UUID) (api.ChatMessage, error) {
	var out api.ChatMessage
	err := s.run(ctx, tc, true, func(r *req) error {
		a, err := r.open(ctx, chatID, false)
		if err != nil {
			return err
		}
		m, err := r.message(ctx, chatID, id, true)
		if err != nil {
			return err
		}
		switch {
		case m.DeletedAt != nil:
			return failed(textMsgDeleted)
		case len(m.Important) == 0:
			return failed("Подтверждение не запрошено")
		case m.Author != nil && *m.Author == r.me:
			return failed("Своё сообщение подтверждать не нужно")
		}
		tag, err := r.tx.Exec(ctx, `insert into chat.acks (message_id, member_id, acked_at) values ($1, $2, $3) on conflict do nothing`, id, r.me, r.now)
		if err != nil {
			return store("ack", err)
		}
		if tag.RowsAffected() > 0 {
			if err := r.publish(ctx, "chat.ack.done", "chat.message", id, map[string]any{litChatID: chatID, litMessageID: id}); err != nil {
				return err
			}
			if _, err := r.tx.Exec(ctx, `insert into chat.receipts (chat_id, member_id, last_seq, read_at) values ($1, $2, $3, $4)
				on conflict (chat_id, member_id) do update set last_seq = greatest(chat.receipts.last_seq, excluded.last_seq)`, chatID, r.me, m.Seq, r.now); err != nil {
				return store("receipt", err)
			}
		}
		list, err := r.present(ctx, a, []msgRec{m})
		if err != nil {
			return err
		}
		out = list[0]
		return nil
	})
	return out, err
}

// Receipts tells who has read a message: counts for the mode «галочки», names and time for «кто и когда»; the author and
// the moderators only (Q-W4.00-chats-8).
func (s *Service) Receipts(ctx context.Context, tc tenantctx.TenantContext, chatID, id uuid.UUID) (api.ChatReceipts, error) { //nolint:gocyclo // one operation of the contract: a chain of checks, each with the text of the reference
	var out api.ChatReceipts
	err := s.run(ctx, tc, false, func(r *req) error {
		a, err := r.open(ctx, chatID, false)
		if err != nil {
			return err
		}
		m, err := r.message(ctx, chatID, id, false)
		if err != nil {
			return err
		}
		if !r.authorOrModerator(m, a) {
			return forbidden("Кто прочитал, видят автор и модераторы")
		}
		out.Mode = api.ChatReceiptsMode(a.Policy.Receipts)
		if a.Policy.Receipts == litOff {
			return nil
		}
		seats, err := r.seatsOf(ctx, chatID)
		if err != nil {
			return err
		}
		out.ReadCount, out.TotalCount = readCounts(m, seats)
		if a.Policy.Receipts != "who" {
			return nil
		}
		var ids []uuid.UUID
		for _, s := range seats {
			if m.Author == nil || s.Person != *m.Author {
				ids = append(ids, s.Person)
			}
		}
		names, err := r.names(ctx, ids)
		if err != nil {
			return err
		}
		items := []api.ChatReceipt{}
		for _, s := range seats {
			if m.Author != nil && s.Person == *m.Author {
				continue
			}
			it := api.ChatReceipt{Member: memberRef(names, s.Person)}
			if s.Last >= m.Seq {
				it.ReadAt = s.ReadAt
			}
			items = append(items, it)
		}
		out.Items = &items
		return nil
	})
	return out, err
}

// authorOrModerator reports whether the actor wrote the message or moderates the chat.
func (r *req) authorOrModerator(m msgRec, a *access) bool {
	return (m.Author != nil && *m.Author == r.me) || a.Can.Moderate
}
