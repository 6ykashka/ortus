package chats

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Texts of the answers (the domain W7.10, chats.js).
const (
	textChatNotFound = "Чат не найден"
	textReadOnlyAnn  = "В объявлениях пишут модераторы"
	textArchived     = "Чат в архиве: только чтение"
	textReader       = "У вас роль «Читатель»: можно читать, голосовать и подтверждать"
	textPeerGone     = "Собеседник больше не работает: чат только для чтения"
	textMsgNotFound  = "Сообщение не найдено"
	textMsgDeleted   = "Сообщение удалено"
)

// recordRef is the record a chat belongs to (chat.chats.record_ref).
type recordRef struct {
	Module string    `json:"module"`
	Type   string    `json:"type"`
	ID     uuid.UUID `json:"id"`
	Label  string    `json:"label"`
	Nav    string    `json:"nav,omitempty"`
}

func (r recordRef) object() ObjectRef { return ObjectRef{Module: r.Module, Type: r.Type, ID: r.ID} }

// chatRec is a row of chat.chats.
type chatRec struct {
	ID          uuid.UUID
	Kind        Kind
	Title       string
	Unit        *uuid.UUID
	Status      string
	Sensitivity string
	Record      *recordRef
	History     string
	Overrides   Overrides
	LastSeq     int64
	Used        int64
	Revision    int
	CreatedBy   *uuid.UUID
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

const chatCols = `c.id, c.kind, c.title, c.org_unit_id, c.status, c.sensitivity, c.record_ref, c.history, c.overrides, c.last_seq,
	c.used_bytes, c.revision, c.created_by, c.created_at, c.updated_at`

func scanChat(row pgx.Row) (*chatRec, error) {
	var (
		c    chatRec
		kind string
		rec  []byte
		over []byte
	)
	if err := row.Scan(&c.ID, &kind, &c.Title, &c.Unit, &c.Status, &c.Sensitivity, &rec, &c.History, &over, &c.LastSeq, &c.Used,
		&c.Revision, &c.CreatedBy, &c.CreatedAt, &c.UpdatedAt); err != nil {
		return nil, err
	}
	c.Kind = Kind(kind)
	if len(rec) > 0 && string(rec) != litNull {
		c.Record = &recordRef{}
		if err := json.Unmarshal(rec, c.Record); err != nil {
			return nil, fmt.Errorf("chats: record_ref: %w", err)
		}
	}
	if err := json.Unmarshal(over, &c.Overrides); err != nil {
		return nil, fmt.Errorf("chats: overrides: %w", err)
	}
	return &c, nil
}

func store(what string, err error) error { return fmt.Errorf("chats: %s: %w", what, err) }

func noRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// kindPolicy is the policy of a kind: the values the owner set over the defaults.
func (r *req) kindPolicy(ctx context.Context, k Kind) (Policy, int, error) {
	p := DefaultPolicy(k)
	var raw []byte
	rev := 1
	err := r.tx.QueryRow(ctx, `select policy, revision from chat.policies where chat_kind = $1`, string(k)).Scan(&raw, &rev)
	switch {
	case noRows(err):
		return p, 1, nil
	case err != nil:
		return p, 0, store("policy", err)
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return p, 0, store("policy json", err)
	}
	// CHAT-10 and Q-W4.00-chats-14 hold whatever an old row says.
	p.DeletedDays, p.PdnMask = Bounds.DeletedDays.Min, true
	return p, rev, nil
}

// policyOf is the effective policy of a chat: the kind plus its overrides.
func (r *req) policyOf(ctx context.Context, c *chatRec) (Policy, error) {
	p, ok := r.kinds[c.Kind]
	if !ok {
		var err error
		if p, _, err = r.kindPolicy(ctx, c.Kind); err != nil {
			return p, err
		}
		r.kinds[c.Kind] = p
	}
	return p.WithOverrides(c.Overrides), nil
}

// isDriver reports whether the actor works as a driver now (the function closes the chats «Финансы» and the PDn).
func (r *req) isDriver(ctx context.Context) (bool, error) {
	if r.driver != nil {
		return *r.driver, nil
	}
	if r.me == uuid.Nil || r.tc.Owner {
		r.driver = new(false)
		return false, nil
	}
	var yes bool
	err := r.tx.QueryRow(ctx, `select exists (select 1 from people.work_profiles where person_id = $1 and function = 'driver'
		and valid @> $2::timestamptz)`, r.me, r.now).Scan(&yes)
	if err != nil {
		return false, store("function", err)
	}
	r.driver = &yes
	return yes, nil
}

// names returns the full names of people.
func (r *req) names(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]string, error) {
	out := make(map[uuid.UUID]string, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := r.tx.Query(ctx, `select id, full_name from people.person_profiles where id = any($1)`, ids)
	if err != nil {
		return nil, store("names", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			id uuid.UUID
			n  string
		)
		if err := rows.Scan(&id, &n); err != nil {
			return nil, store("names", err)
		}
		out[id] = n
	}
	return out, rows.Err()
}

// nameOf is the name of the actor.
func (r *req) nameOf(ctx context.Context, id uuid.UUID) (string, error) {
	m, err := r.names(ctx, []uuid.UUID{id})
	if err != nil {
		return "", err
	}
	if n, ok := m[id]; ok {
		return n, nil
	}
	return litPerson, nil
}

// seat is the place of the actor in a chat.
type seat struct {
	Role     Role
	Via      string
	JoinedAt *time.Time
	LastRead int64
}

// access is the chat as one member sees it: the row, the place, the policy and what they may do.
type access struct {
	Chat   *chatRec
	Seat   seat
	Policy Policy
	Can    Can
	Facts  ChatFacts
	Actor  Actor
	Peer   uuid.UUID // the other side of a direct chat
}

// open reads a chat the actor sees and what they may do in it; a chat the actor does not see answers the same 404 as one
// that does not exist (AC-01). lock takes the row of the chat for the operation (the numbers of messages go under it).
func (r *req) open(ctx context.Context, id uuid.UUID, lock bool) (*access, error) {
	q := `select ` + chatCols + ` from chat.chats c where c.id = $1`
	if lock {
		q += ` for update of c`
	}
	c, err := scanChat(r.tx.QueryRow(ctx, q, id))
	switch {
	case noRows(err):
		return nil, notFound(textChatNotFound)
	case err != nil:
		return nil, store(litChat, err)
	}
	return r.accessTo(ctx, c)
}

// accessTo decides what the actor sees of c: a member in the roster, or the owner of the business (not in personal chats).
func (r *req) accessTo(ctx context.Context, c *chatRec) (*access, error) { //nolint:gocyclo // one operation of the contract: a chain of checks, each with the text of the reference
	a := &access{Chat: c}
	driver, err := r.isDriver(ctx)
	if err != nil {
		return nil, err
	}
	a.Actor = Actor{Owner: r.tc.Owner, Driver: driver}
	var joined *time.Time
	var role, via *string
	var lastRead int64
	err = r.tx.QueryRow(ctx, `select m.role, m.via, m.joined_at, coalesce(rc.last_seq, 0)
		from chat.chat_members m left join chat.receipts rc on rc.chat_id = m.chat_id and rc.member_id = m.member_id
		where m.chat_id = $1 and m.member_id = $2 and m.state = 'in'`, c.ID, r.me).Scan(&role, &via, &joined, &lastRead)
	switch {
	case noRows(err):
	case err != nil:
		return nil, store("seat", err)
	default:
		a.Seat = seat{Role: Role(deref(role)), Via: deref(via), JoinedAt: joined, LastRead: lastRead}
		if c.Record != nil {
			r.related(c.ID)
		}
	}
	if a.Seat.Role == "" {
		if !r.tc.Owner || c.Kind == KindDirect {
			return nil, notFound(textChatNotFound)
		}
		a.Seat = seat{Role: RoleOwner, Via: "Владелец бизнеса · видит все рабочие чаты"}
		if err := r.tx.QueryRow(ctx, `select coalesce(last_seq, 0) from chat.receipts where chat_id = $1 and member_id = $2`, c.ID, r.me).
			Scan(&a.Seat.LastRead); err != nil && !noRows(err) {
			return nil, store("receipt", err)
		}
	}
	if c.Sensitivity == litFinance && driver {
		return nil, notFound(textChatNotFound)
	}
	if c.Record != nil {
		if act := recordReadAction(c.Record.Type); act != "" && !r.can(ctx, act, c) {
			return nil, notFound(textChatNotFound)
		}
	}
	if a.Policy, err = r.policyOf(ctx, c); err != nil {
		return nil, err
	}
	a.Facts = ChatFacts{Kind: c.Kind, Status: c.Status, HasRecord: c.Record != nil}
	if c.Kind == KindDirect {
		if a.Peer, a.Facts.PeerGone, err = r.peer(ctx, c.ID); err != nil {
			return nil, err
		}
	}
	a.Can = Rights(a.Facts, a.Actor, a.Seat.Role, a.Policy, func(action string) bool { return r.can(ctx, action, c) })
	return a, nil
}

// recordReadAction is the action that makes a record visible: the chat of a record is seen by those who see the record.
func recordReadAction(typ string) string {
	switch typ {
	case "trip":
		return "fleet.trips.read"
	case "repair_object":
		return "repairs.projects.read"
	}
	return ""
}

// peer is the other side of a direct chat and whether they are gone (blocked or dismissed): the chat is read only for the
// second member (Q-W4.00-chats-23).
func (r *req) peer(ctx context.Context, chatID uuid.UUID) (uuid.UUID, bool, error) {
	var id uuid.UUID
	var membership *uuid.UUID
	var archived bool
	err := r.tx.QueryRow(ctx, `select p.id, p.membership_id, p.archived_at is not null from chat.chat_members m
		join people.person_profiles p on p.id = m.member_id where m.chat_id = $1 and m.member_id <> $2 limit 1`, chatID, r.me).
		Scan(&id, &membership, &archived)
	if noRows(err) {
		return uuid.Nil, false, nil
	}
	if err != nil {
		return uuid.Nil, false, store("peer", err)
	}
	if archived {
		return id, true, nil
	}
	st, err := r.membership(ctx, membership)
	if err != nil {
		return uuid.Nil, false, err
	}
	return id, st.Status == "suspended" || st.Status == litEnded, nil
}

// membership is the membership of a person by its id in the control DB (active, no owner when the port is off).
func (r *req) membership(ctx context.Context, id *uuid.UUID) (Membership, error) {
	if r.s.Memberships == nil || id == nil {
		return Membership{Status: litActive}, nil
	}
	m, err := r.s.Memberships.Memberships(ctx, r.tc.TenantID, []uuid.UUID{*id})
	if err != nil {
		return Membership{}, store("memberships", err)
	}
	if x, ok := m[*id]; ok {
		return x, nil
	}
	return Membership{Status: litEnded}, nil
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
