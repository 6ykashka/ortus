package chats

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"mime"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	api "github.com/ortus/ortus-crm/backend/internal/api/chats"
)

// msgRec is a row of chat.messages.
type msgRec struct {
	ID, ChatID  uuid.UUID
	Seq         int64
	Kind        string
	Author      *uuid.UUID
	Topic       *uuid.UUID
	Text        string
	Important   []byte
	Ephemeral   []byte
	Spoiler     *string
	Card        []byte
	DocRef      *uuid.UUID
	DeletedAt   *time.Time
	DeletedBy   *uuid.UUID
	DeletedText *string
	EditedAt    *time.Time
	VisibleTo   *uuid.UUID
	CreatedAt   time.Time
}

const msgCols = `m.id, m.chat_id, m.seq, m.kind, m.author_id, m.topic_id, m.text, m.important, m.ephemeral, m.spoiler, m.system_card,
	m.document_ref, m.deleted_at, m.deleted_by, m.deleted_text, m.edited_at, m.visible_to, m.created_at`

func scanMsg(row pgx.Row) (msgRec, error) {
	var m msgRec
	err := row.Scan(&m.ID, &m.ChatID, &m.Seq, &m.Kind, &m.Author, &m.Topic, &m.Text, &m.Important, &m.Ephemeral, &m.Spoiler, &m.Card,
		&m.DocRef, &m.DeletedAt, &m.DeletedBy, &m.DeletedText, &m.EditedAt, &m.VisibleTo, &m.CreatedAt)
	return m, err
}

// misc is what a message that is not a service one keeps in system_card: the tasks made of it, the card of a document, the
// reason of its deletion. No column of tenant 0060 holds them (Q-W7.11-2).
type misc struct {
	Tasks    []api.ChatTaskRef `json:"tasks,omitempty"`
	Document *api.ChatDocRef   `json:"document,omitempty"`
	Deleted  *struct {
		Reason    string `json:"reason,omitempty"`
		Moderator bool   `json:"moderator"`
	} `json:"deleted,omitempty"`
}

func (m msgRec) misc() misc {
	var x misc
	if m.Kind != litSystem && len(m.Card) > 0 {
		_ = json.Unmarshal(m.Card, &x)
	}
	return x
}

type importantJSON struct {
	DueDate string `json:"dueDate"`
}

type ephemeralJSON struct {
	ExpiresAt time.Time `json:"expiresAt"`
	TTLHours  int64     `json:"ttlHours"`
}

type pollOpt struct {
	ID   uuid.UUID `json:"id"`
	Text string    `json:"text"`
}

// voterHash is the hash that stands for a member in an anonymous poll: HMAC-SHA256(key, poll || 0x00 || member) in hex. The
// hash cannot be turned back into the member without the key, but it forbids a second vote.
func voterHash(key []byte, poll, member uuid.UUID) string {
	h := hmac.New(sha256.New, key)
	h.Write(poll[:])
	h.Write([]byte{0})
	h.Write(member[:])
	return hex.EncodeToString(h.Sum(nil))
}

func (r *req) myHash(poll uuid.UUID) string {
	if len(r.s.PollKey) == 0 {
		return ""
	}
	return voterHash(r.s.PollKey, poll, r.me)
}

type attRec struct {
	ID, MessageID uuid.UUID
	FileID        *uuid.UUID
	Name          string
	Size          int64
	Kind          string
	ViewOnce      bool
	OpenedBy      []uuid.UUID
	GoneAt        *time.Time
	SavedTo       []byte
}

type pollRec struct {
	ID, MessageID       uuid.UUID
	Question            string
	Options             []pollOpt
	Anonymous, Multiple bool
	ClosesAt            time.Time
	ClosedAt            *time.Time
}

type voteRec struct {
	Option int
	Voter  *uuid.UUID
	Hash   string
}

type seatCount struct {
	Person uuid.UUID
	Last   int64
	ReadAt *time.Time
}

// present turns messages into the messages of the contract for the actor of the access a: the PDn mask, a deleted message
// as a label only, the results of polls and acknowledgements and the receipts by the rules of the policy.
func (r *req) present(ctx context.Context, a *access, msgs []msgRec) ([]api.ChatMessage, error) { //nolint:gocyclo // one operation of the contract: a chain of checks, each with the text of the reference
	if len(msgs) == 0 {
		return []api.ChatMessage{}, nil
	}
	ids := make([]uuid.UUID, len(msgs))
	var people []uuid.UUID
	for i, m := range msgs {
		ids[i] = m.ID
		if m.Author != nil {
			people = append(people, *m.Author)
		}
		if m.DeletedBy != nil {
			people = append(people, *m.DeletedBy)
		}
	}
	atts, err := r.attachmentsOf(ctx, ids)
	if err != nil {
		return nil, err
	}
	polls, votes, err := r.pollsOf(ctx, ids)
	if err != nil {
		return nil, err
	}
	for _, v := range votes {
		for _, x := range v {
			if x.Voter != nil {
				people = append(people, *x.Voter)
			}
		}
	}
	acks, err := r.acksOf(ctx, ids)
	if err != nil {
		return nil, err
	}
	seats, err := r.seatsOf(ctx, a.Chat.ID)
	if err != nil {
		return nil, err
	}
	topics, err := r.topicNames(ctx, a.Chat.ID)
	if err != nil {
		return nil, err
	}
	names, err := r.names(ctx, people)
	if err != nil {
		return nil, err
	}
	out := make([]api.ChatMessage, 0, len(msgs))
	for _, m := range msgs {
		out = append(out, r.one(a, m, names, topics, atts[m.ID], polls[m.ID], votes, acks[m.ID], seats))
	}
	return out, nil
}

func (r *req) attachmentsOf(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID][]attRec, error) {
	rows, err := r.tx.Query(ctx, `select id, message_id, file_id, file_name, size_bytes, kind, view_once, opened_by, gone_at, saved_to
		from chat.attachments where message_id = any($1) order by created_at, id`, ids)
	if err != nil {
		return nil, store("attachments", err)
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (attRec, error) {
		var x attRec
		err := row.Scan(&x.ID, &x.MessageID, &x.FileID, &x.Name, &x.Size, &x.Kind, &x.ViewOnce, &x.OpenedBy, &x.GoneAt, &x.SavedTo)
		return x, err
	})
	if err != nil {
		return nil, store("attachments", err)
	}
	out := map[uuid.UUID][]attRec{}
	for _, x := range list {
		out[x.MessageID] = append(out[x.MessageID], x)
	}
	return out, nil
}

func (r *req) pollsOf(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]*pollRec, map[uuid.UUID][]voteRec, error) {
	rows, err := r.tx.Query(ctx, `select id, message_id, question, options, anonymous, multiple, closes_at, closed_at
		from chat.polls where message_id = any($1)`, ids)
	if err != nil {
		return nil, nil, store("polls", err)
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (pollRec, error) {
		var (
			p   pollRec
			raw []byte
		)
		if err := row.Scan(&p.ID, &p.MessageID, &p.Question, &raw, &p.Anonymous, &p.Multiple, &p.ClosesAt, &p.ClosedAt); err != nil {
			return p, err
		}
		return p, json.Unmarshal(raw, &p.Options)
	})
	if err != nil {
		return nil, nil, store("polls", err)
	}
	polls := map[uuid.UUID]*pollRec{}
	var pollIDs []uuid.UUID
	for i := range list {
		polls[list[i].MessageID] = &list[i]
		pollIDs = append(pollIDs, list[i].ID)
	}
	votes := map[uuid.UUID][]voteRec{}
	if len(pollIDs) == 0 {
		return polls, votes, nil
	}
	vr, err := r.tx.Query(ctx, `select poll_id, option_idx, voter_id, coalesce(voter_hash, '') from chat.poll_votes where poll_id = any($1)`, pollIDs)
	if err != nil {
		return nil, nil, store("votes", err)
	}
	defer vr.Close()
	for vr.Next() {
		var (
			poll uuid.UUID
			v    voteRec
		)
		if err := vr.Scan(&poll, &v.Option, &v.Voter, &v.Hash); err != nil {
			return nil, nil, store("votes", err)
		}
		votes[poll] = append(votes[poll], v)
	}
	return polls, votes, vr.Err()
}

func (r *req) acksOf(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID][]uuid.UUID, error) {
	rows, err := r.tx.Query(ctx, `select message_id, member_id from chat.acks where message_id = any($1)`, ids)
	if err != nil {
		return nil, store("acks", err)
	}
	defer rows.Close()
	out := map[uuid.UUID][]uuid.UUID{}
	for rows.Next() {
		var m, p uuid.UUID
		if err := rows.Scan(&m, &p); err != nil {
			return nil, store("acks", err)
		}
		out[m] = append(out[m], p)
	}
	return out, rows.Err()
}

// seatsOf are the members who are in the chat with how far they have read.
func (r *req) seatsOf(ctx context.Context, chatID uuid.UUID) ([]seatCount, error) {
	rows, err := r.tx.Query(ctx, `select m.member_id, coalesce(rc.last_seq, 0), rc.read_at from chat.chat_members m
		left join chat.receipts rc on rc.chat_id = m.chat_id and rc.member_id = m.member_id where m.chat_id = $1 and m.state = 'in'`, chatID)
	if err != nil {
		return nil, store("seats", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (seatCount, error) {
		var s seatCount
		err := row.Scan(&s.Person, &s.Last, &s.ReadAt)
		return s, err
	})
}

func (r *req) topicNames(ctx context.Context, chatID uuid.UUID) (map[uuid.UUID]string, error) {
	rows, err := r.tx.Query(ctx, `select id, name from chat.topics where chat_id = $1`, chatID)
	if err != nil {
		return nil, store("topics", err)
	}
	defer rows.Close()
	out := map[uuid.UUID]string{}
	for rows.Next() {
		var (
			id uuid.UUID
			n  string
		)
		if err := rows.Scan(&id, &n); err != nil {
			return nil, store("topics", err)
		}
		out[id] = n
	}
	return out, rows.Err()
}

// one makes the message of the contract.
func (r *req) one(a *access, m msgRec, names map[uuid.UUID]string, topics map[uuid.UUID]string, atts []attRec, poll *pollRec, //nolint:gocyclo // one message of the contract: each part of it by its own rule
	votes map[uuid.UUID][]voteRec, acks []uuid.UUID, seats []seatCount) api.ChatMessage {
	author := "Система"
	if m.Author != nil {
		author = names[*m.Author]
		if author == "" {
			author = litPerson
		}
	}
	out := api.ChatMessage{Id: m.ID, Seq: m.Seq, CreatedAt: m.CreatedAt, AuthorMemberId: m.Author, AuthorDisplayName: author,
		Kind: api.ChatMessageKind(m.Kind), Attachments: []api.ChatAttachment{}, Tasks: []api.ChatTaskRef{}, EditedAt: m.EditedAt}
	if m.Topic != nil {
		if n, ok := topics[*m.Topic]; ok {
			out.Topic = &n
		}
	}
	if m.VisibleTo != nil && r.me == *m.VisibleTo {
		out.VisibleOnlyToMe = new(true)
	}
	x := m.misc()
	if m.DeletedAt != nil {
		// PD-60: a deleted message is only a label — who, when, why; the content stays in the journal and never returns here.
		by := litPerson
		if m.DeletedBy != nil && names[*m.DeletedBy] != "" {
			by = names[*m.DeletedBy]
		}
		d := &api.ChatDeleted{ByDisplayName: by, At: *m.DeletedAt}
		if x.Deleted != nil {
			d.Moderator = x.Deleted.Moderator
			if x.Deleted.Reason != "" {
				d.Reason = new(x.Deleted.Reason)
			}
		}
		out.Deleted = d
		return out
	}
	text := m.Text
	if a.Policy.PdnMask {
		text = MaskPdn(text)
	}
	out.Text, out.Masked = text, text != m.Text
	if m.Spoiler != nil {
		out.Spoiler = m.Spoiler
	}
	out.Tasks = append(out.Tasks, x.Tasks...)
	if m.Kind == litSystem {
		var card api.ChatSystemCard
		if json.Unmarshal(m.Card, &card) == nil {
			out.System = &card
		}
		return out
	}
	out.Document = x.Document
	if len(m.Ephemeral) > 0 && string(m.Ephemeral) != litNull {
		var e ephemeralJSON
		if json.Unmarshal(m.Ephemeral, &e) == nil {
			out.Ephemeral = &struct {
				ExpiresAt api.Instant `json:"expiresAt"`
				TtlHours  int64       `json:"ttlHours"` //nolint:revive // the name of the generated field of the contract
			}{ExpiresAt: e.ExpiresAt, TtlHours: e.TTLHours}
		}
	}
	for _, at := range atts {
		out.Attachments = append(out.Attachments, r.attachment(m, at))
	}
	if len(m.Important) > 0 && string(m.Important) != litNull {
		out.Important = r.important(a, m, acks, seats)
	}
	if poll != nil {
		out.Poll = r.pollOf(a, m, poll, votes[poll.ID], names)
	}
	if (m.Author != nil && *m.Author == r.me || a.Can.Moderate) && a.Policy.Receipts != litOff {
		read, total := readCounts(m, seats)
		out.Reads = &struct {
			ReadCount  int64 `json:"readCount"`
			TotalCount int64 `json:"totalCount"`
		}{ReadCount: read, TotalCount: total}
	}
	return out
}

// readCounts counts how many of the members in the chat (but the author) have read up to the message.
func readCounts(m msgRec, seats []seatCount) (read, total int64) {
	for _, s := range seats {
		if m.Author != nil && s.Person == *m.Author {
			continue
		}
		total++
		if s.Last >= m.Seq {
			read++
		}
	}
	return read, total
}

func (r *req) attachment(_ msgRec, at attRec) api.ChatAttachment {
	out := api.ChatAttachment{Id: at.ID, FileId: at.FileID, FileName: at.Name, SizeBytes: at.Size, Kind: api.ChatAttachmentKind(at.Kind),
		ViewOnce: at.ViewOnce, Gone: at.GoneAt != nil && !at.GoneAt.After(r.now)}
	if at.ViewOnce {
		for _, id := range at.OpenedBy {
			if id == r.me {
				out.OpenedByMe = new(true)
			}
		}
	}
	if len(at.SavedTo) > 0 && string(at.SavedTo) != litNull {
		var o objJSON
		if json.Unmarshal(at.SavedTo, &o) == nil {
			out.SavedTo = &api.ObjectRef{ModuleKey: o.ModuleKey, EntityType: o.EntityType, EntityId: o.EntityID}
		}
	}
	return out
}

func (r *req) important(_ *access, m msgRec, acks []uuid.UUID, seats []seatCount) *api.ChatImportant {
	var j importantJSON
	if json.Unmarshal(m.Important, &j) != nil {
		return nil
	}
	due, _ := time.Parse(time.DateOnly, j.DueDate)
	out := &api.ChatImportant{DueDate: apiDate{Time: due}}
	total := int64(0)
	for _, s := range seats {
		if m.Author == nil || s.Person != *m.Author {
			total++
		}
	}
	out.TotalCount, out.AckCount = total, int64(len(acks))
	if m.Author == nil || *m.Author != r.me {
		done := false
		for _, id := range acks {
			if id == r.me {
				done = true
			}
		}
		out.Mine = &struct {
			Done     bool `json:"done"`
			Required bool `json:"required"`
		}{Done: done, Required: true}
	}
	return out
}

// pollOf makes the poll for the actor: the results show after the own vote, to the author and the moderators, and when the
// poll is closed; an anonymous poll never names the voters (Q-W4.00-chats-12).
func (r *req) pollOf(a *access, m msgRec, p *pollRec, votes []voteRec, names map[uuid.UUID]string) *api.ChatPoll { //nolint:gocyclo // one operation of the contract: a chain of checks, each with the text of the reference
	closed := p.ClosedAt != nil || !p.ClosesAt.After(r.now)
	my := map[int]bool{}
	voters := map[string]bool{}
	hash := r.myHash(p.ID)
	for _, v := range votes {
		key := v.Hash
		if v.Voter != nil {
			key = v.Voter.String()
		}
		voters[key] = true
		if (v.Voter != nil && *v.Voter == r.me) || (hash != "" && v.Hash == hash) {
			my[v.Option] = true
		}
	}
	show := closed || len(my) > 0 || (m.Author != nil && *m.Author == r.me) || a.Can.Moderate
	out := &api.ChatPoll{Id: p.ID, Question: p.Question, Anonymous: p.Anonymous, Multiple: p.Multiple, ClosesAt: p.ClosesAt,
		Closed: closed, TotalVoters: int64(len(voters)), MyVotes: []uuid.UUID{}, Options: []api.ChatPollOption{}}
	for i, o := range p.Options {
		opt := api.ChatPollOption{Id: o.ID, Text: o.Text}
		if my[i] {
			opt.Mine = new(true)
			out.MyVotes = append(out.MyVotes, o.ID)
		}
		if show {
			n := int64(0)
			var who []string
			for _, v := range votes {
				if v.Option != i {
					continue
				}
				n++
				if !p.Anonymous && v.Voter != nil {
					who = append(who, names[*v.Voter])
				}
			}
			opt.Votes = &n
			if !p.Anonymous {
				opt.Voters = &who
			}
		}
		out.Options = append(out.Options, opt)
	}
	return out
}

// attachmentName is the name of a file: files.objects keeps it in declared_mime as the parameter «name».
func attachmentName(declared string) (contentType, name string) {
	ct, params, err := mime.ParseMediaType(declared)
	if err != nil {
		return declared, "файл"
	}
	name = params["name"]
	if name == "" {
		name = "файл"
	}
	return ct, name
}
