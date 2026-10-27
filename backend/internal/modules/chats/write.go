package chats

import (
	"context"
	"encoding/json"
	"strconv"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
)

func etag(rev int64) string { return `"rev-` + strconv.FormatInt(rev, 10) + `"` }

// checkRevision compares If-Match with the revision of a chat.
func checkRevision(ifMatch string, rev int) error {
	if ifMatch != etag(int64(rev)) {
		return coded(codeRevision, "")
	}
	return nil
}

// newMsg is a message to be written.
type newMsg struct {
	Kind        string
	Author      *uuid.UUID
	Topic       *uuid.UUID
	Text        string
	Important   any
	Ephemeral   any
	Spoiler     *string
	Card        any
	DocRef      *uuid.UUID
	VisibleTo   *uuid.UUID
	At          time.Time
	AfterMember bool
}

func jsonOrNil(v any) (any, error) {
	if v == nil {
		return nil, nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	return b, nil
}

// post writes a message into the chat under the next number: the number is taken by the update of the row of the chat, so
// two messages never share one and there are no gaps (chat.messages.seq).
func (r *req) post(ctx context.Context, c *chatRec, m newMsg) (msgRec, error) {
	var seq int64
	if err := r.tx.QueryRow(ctx, `update chat.chats set last_seq = last_seq + 1, updated_at = $2 where id = $1 returning last_seq`,
		c.ID, r.now).Scan(&seq); err != nil {
		return msgRec{}, store("seq", err)
	}
	c.LastSeq = seq
	imp, err := jsonOrNil(m.Important)
	if err != nil {
		return msgRec{}, store("important", err)
	}
	eph, err := jsonOrNil(m.Ephemeral)
	if err != nil {
		return msgRec{}, store("ephemeral", err)
	}
	card, err := jsonOrNil(m.Card)
	if err != nil {
		return msgRec{}, store("card", err)
	}
	if m.Kind == "" {
		m.Kind = litText
	}
	row := r.tx.QueryRow(ctx, `insert into chat.messages (chat_id, seq, kind, author_id, topic_id, text, important, ephemeral, spoiler,
		system_card, document_ref, visible_to, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		returning `+insertedCols, c.ID, seq, m.Kind, m.Author, m.Topic, m.Text, imp, eph, m.Spoiler, card, m.DocRef, m.VisibleTo, r.now)
	out, err := scanMsg(row)
	if err != nil {
		return msgRec{}, store("message", err)
	}
	return out, nil
}

// insertedCols are the columns of msgCols without the alias (returning of an insert).
const insertedCols = `id, chat_id, seq, kind, author_id, topic_id, text, important, ephemeral, spoiler, system_card, document_ref,
	deleted_at, deleted_by, deleted_text, edited_at, visible_to, created_at`

// service writes a service message of the module «Чаты» or of another module into the chat.
func (r *req) service(ctx context.Context, c *chatRec, card ServiceCard) (msgRec, error) {
	return r.post(ctx, c, newMsg{Kind: litSystem, Card: card})
}

// ServiceCard is a service message in the feed: the chat itself («Чат создан») or a module (a defect found, a trip given).
type ServiceCard struct {
	Module string `json:"module"`
	Icon   string `json:"icon"`
	Tone   string `json:"tone"`
	Title  string `json:"title"`
	Text   string `json:"text"`
	Label  string `json:"label,omitempty"`
	Nav    string `json:"nav,omitempty"`
	RefID  string `json:"refId,omitempty"`
}

func chatCard(icon, tone, title, text string) ServiceCard {
	return ServiceCard{Module: litChat, Icon: icon, Tone: tone, Title: title, Text: text}
}

// journal writes a line into the journal of a chat; content is the text of a deleted message (kept for the term of the
// policy and shown only with chat.audit.read).
func (r *req) journal(ctx context.Context, chatID uuid.UUID, text string, content *string) error {
	var actor any
	if r.me != uuid.Nil {
		actor = r.me
	}
	if _, err := r.tx.Exec(ctx, `insert into chat.journal (chat_id, at, actor_id, text, deleted_content) values ($1, $2, $3, $4, $5)`,
		chatID, r.now, actor, text, content); err != nil {
		return store("journal", err)
	}
	return nil
}

// publish writes an event of the chats into the outbox, in the transaction of the command. The text of a message is never
// in the payload.
func (r *req) publish(ctx context.Context, typ string, aggregate string, id uuid.UUID, payload map[string]any) error {
	if payload == nil {
		payload = map[string]any{}
	}
	if r.me != uuid.Nil {
		payload["actorId"] = r.me
	}
	_, err := events.Publish(ctx, r.tx, events.Event{Type: typ + ".v1", Aggregate: aggregate, AggregateID: id, Payload: payload})
	if err != nil {
		return store("event "+typ, err)
	}
	return nil
}

// record writes the audit of a sensitive action.
func (r *req) record(ctx context.Context, action, target string, id uuid.UUID, diff map[string]any) error {
	e := audit.ForRequest(ctx)
	if r.me != uuid.Nil {
		e.ActorKind, e.ActorID = audit.ActorPerson, r.me
	}
	if e.RequestID == "" {
		e.RequestID = "chat-" + uuid.NewString()
	}
	e.Action, e.TargetType, e.TargetID, e.Sensitivity, e.Diff = action, target, id, audit.Sensitive, diff
	if err := audit.Record(ctx, r.tx, e); err != nil {
		return store("audit "+action, err)
	}
	return nil
}

// changed queues the hint chat.changed for the members in the chat after the commit (W7.12 delivers it).
func (r *req) changed(ctx context.Context, c *chatRec) error {
	if r.s.Hints == nil {
		return nil
	}
	rows, err := r.tx.Query(ctx, `select member_id from chat.chat_members where chat_id = $1 and state = 'in'`, c.ID)
	if err != nil {
		return store("hint", err)
	}
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return store("hint", err)
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return store("hint", err)
	}
	tenant, chat, seq, h := r.tc.TenantID, c.ID, c.LastSeq, r.s.Hints
	r.afterCommit(func() { h.ChatChanged(context.WithoutCancel(ctx), tenant, chat, seq, ids) })
	return nil
}
