package chats

import (
	"context"
	"encoding/json"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	api "github.com/ortus/ortus-crm/backend/internal/api/chats"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// poll reads a poll of the chat by its id (404 for another chat's) and the message it belongs to.
func (r *req) poll(ctx context.Context, chatID, id uuid.UUID, lock bool) (*pollRec, msgRec, error) {
	q := `select p.id, p.message_id, p.question, p.options, p.anonymous, p.multiple, p.closes_at, p.closed_at from chat.polls p
		join chat.messages m on m.id = p.message_id where p.id = $1 and m.chat_id = $2`
	if lock {
		q += ` for update of p`
	}
	var (
		p   pollRec
		raw []byte
	)
	err := r.tx.QueryRow(ctx, q, id, chatID).Scan(&p.ID, &p.MessageID, &p.Question, &raw, &p.Anonymous, &p.Multiple, &p.ClosesAt, &p.ClosedAt)
	if noRows(err) {
		return nil, msgRec{}, notFound("Опрос не найден")
	}
	if err != nil {
		return nil, msgRec{}, store("poll", err)
	}
	if err := json.Unmarshal(raw, &p.Options); err != nil {
		return nil, msgRec{}, store("poll options", err)
	}
	m, err := r.message(ctx, chatID, p.MessageID, false)
	if err != nil {
		return nil, msgRec{}, err
	}
	if m.DeletedAt != nil {
		return nil, msgRec{}, failed(textMsgDeleted)
	}
	return &p, m, nil
}

func (p *pollRec) isClosed(now time.Time) bool { return p.ClosedAt != nil || !p.ClosesAt.After(now) }

func (p *pollRec) closedText() string {
	return "Опрос закрыт " + p.ClosesAt.UTC().Format("02.01") + " в " + p.ClosesAt.UTC().Format("15:04")
}

// Vote records the vote of the member (a repeat replaces the previous one while the poll is open); an anonymous poll keeps
// only voter_hash, never the member (Q-W4.00-chats-12).
func (s *Service) Vote(ctx context.Context, tc tenantctx.TenantContext, chatID, pollID uuid.UUID, optionIDs []uuid.UUID) (api.ChatMessage, error) { //nolint:gocyclo // one operation of the contract: a chain of checks, each with the text of the reference
	var out api.ChatMessage
	err := s.run(ctx, tc, true, func(r *req) error {
		a, err := r.open(ctx, chatID, false)
		if err != nil {
			return err
		}
		p, m, err := r.poll(ctx, chatID, pollID, true)
		if err != nil {
			return err
		}
		if p.isClosed(r.now) {
			return coded(codeTransition, p.closedText())
		}
		var idx []int
		for _, o := range optionIDs {
			i := slices.IndexFunc(p.Options, func(x pollOpt) bool { return x.ID == o })
			if i < 0 {
				return failed("Выберите вариант")
			}
			if !slices.Contains(idx, i) {
				idx = append(idx, i)
			}
		}
		if !p.Multiple && len(idx) > 1 {
			return failed("В этом опросе один вариант")
		}
		hash := ""
		if p.Anonymous {
			if hash = r.myHash(p.ID); hash == "" {
				return coded("dependency_unavailable", "Анонимные опросы не настроены: нет ключа голосов")
			}
		}
		if _, err := r.tx.Exec(ctx, `delete from chat.poll_votes where poll_id = $1 and (voter_id = $2 or voter_hash = $3)`, p.ID, r.me, nullIfEmpty(hash)); err != nil {
			return store("votes", err)
		}
		for _, i := range idx {
			var voter, h any
			if p.Anonymous {
				h = hash
			} else {
				voter = r.me
			}
			if _, err := r.tx.Exec(ctx, `insert into chat.poll_votes (poll_id, option_idx, voter_id, voter_hash, voted_at) values ($1, $2, $3, $4, $5)`,
				p.ID, i, voter, h, r.now); err != nil {
				return store("vote", err)
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

// ClosePoll closes a poll once: its author or a moderator; the result goes to the chat as a service message.
func (s *Service) ClosePoll(ctx context.Context, tc tenantctx.TenantContext, chatID, pollID uuid.UUID) (api.ChatMessage, error) { //nolint:gocyclo // one operation of the contract: a chain of checks, each with the text of the reference
	var out api.ChatMessage
	err := s.run(ctx, tc, true, func(r *req) error {
		a, err := r.open(ctx, chatID, true)
		if err != nil {
			return err
		}
		p, m, err := r.poll(ctx, chatID, pollID, true)
		if err != nil {
			return err
		}
		if !r.authorOrModerator(m, a) {
			return forbidden("Закрыть опрос может автор или модератор")
		}
		if p.ClosedAt != nil {
			return failed("Опрос уже закрыт")
		}
		if _, err := r.tx.Exec(ctx, `update chat.polls set closed_at = $2 where id = $1`, p.ID, r.now); err != nil {
			return store("poll", err)
		}
		p.ClosedAt = &r.now
		text := "Голосов нет"
		rows, err := r.tx.Query(ctx, `select option_idx, count(*) from chat.poll_votes where poll_id = $1 group by option_idx order by count(*) desc, option_idx limit 1`, p.ID)
		if err != nil {
			return store("votes", err)
		}
		for rows.Next() {
			var (
				i int
				n int64
			)
			if err := rows.Scan(&i, &n); err != nil {
				rows.Close()
				return store("votes", err)
			}
			if i < len(p.Options) {
				text = "Больше всего голосов: " + p.Options[i].Text + " · " + intToString(int(n))
			}
		}
		rows.Close()
		if _, err := r.service(ctx, a.Chat, chatCard("ballot", "ok", "Опрос закрыт: «"+p.Question+"»", text)); err != nil {
			return err
		}
		if err := r.publish(ctx, "chat.poll.closed", "chat.message", m.ID, map[string]any{litChatID: chatID, litMessageID: m.ID, "pollId": p.ID}); err != nil {
			return err
		}
		if err := r.changed(ctx, a.Chat); err != nil {
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

// RemindPoll reminds the members who have not voted; it only counts and queues the event, the texts come from the
// notifications of W7.15.
func (s *Service) RemindPoll(ctx context.Context, tc tenantctx.TenantContext, chatID, pollID uuid.UUID) (api.ChatPollReminder, error) { //nolint:gocyclo // one operation of the contract: a chain of checks, each with the text of the reference
	var out api.ChatPollReminder
	err := s.run(ctx, tc, true, func(r *req) error {
		a, err := r.open(ctx, chatID, false)
		if err != nil {
			return err
		}
		p, m, err := r.poll(ctx, chatID, pollID, true)
		if err != nil {
			return err
		}
		if !r.authorOrModerator(m, a) {
			return forbidden("Напомнить об опросе может автор или модератор")
		}
		if p.isClosed(r.now) {
			return coded(codeTransition, p.closedText())
		}
		seats, err := r.seatsOf(ctx, chatID)
		if err != nil {
			return err
		}
		voted := map[uuid.UUID]bool{}
		rows, err := r.tx.Query(ctx, `select distinct voter_id from chat.poll_votes where poll_id = $1 and voter_id is not null`, p.ID)
		if err != nil {
			return store("votes", err)
		}
		ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
		if err != nil {
			return store("votes", err)
		}
		for _, id := range ids {
			voted[id] = true
		}
		if p.Anonymous {
			hr, err := r.tx.Query(ctx, `select voter_hash from chat.poll_votes where poll_id = $1 and voter_hash is not null`, p.ID)
			if err != nil {
				return store("votes", err)
			}
			hashes, err := pgx.CollectRows(hr, pgx.RowTo[string])
			if err != nil {
				return store("votes", err)
			}
			for _, s := range seats {
				if slices.Contains(hashes, voterHash(r.s.PollKey, p.ID, s.Person)) {
					voted[s.Person] = true
				}
			}
		}
		var rest []uuid.UUID
		for _, s := range seats {
			if !voted[s.Person] && (m.Author == nil || s.Person != *m.Author) {
				rest = append(rest, s.Person)
			}
		}
		if _, err := r.tx.Exec(ctx, `update chat.polls set reminded_at = $2 where id = $1`, p.ID, r.now); err != nil {
			return store("poll", err)
		}
		if err := r.publish(ctx, "chat.poll.reminded", "chat.message", m.ID, map[string]any{litChatID: chatID, "pollId": p.ID, "recipients": rest}); err != nil {
			return err
		}
		out.Notified = int64(len(rest))
		return nil
	})
	return out, err
}

// Pin pins a message of the chat (one at a time); moderators only.
func (s *Service) Pin(ctx context.Context, tc tenantctx.TenantContext, chatID, msg uuid.UUID) (api.ChatPinState, error) {
	var out api.ChatPinState
	err := s.run(ctx, tc, true, func(r *req) error {
		a, err := r.open(ctx, chatID, false)
		if err != nil {
			return err
		}
		if !a.Can.Pin {
			return forbidden("Закрепляют модераторы")
		}
		m, err := r.message(ctx, chatID, msg, false)
		if err != nil {
			return err
		}
		if m.DeletedAt != nil || m.Kind == litSystem {
			return failed("Это сообщение закрепить нельзя")
		}
		if _, err := r.tx.Exec(ctx, `delete from chat.pins where chat_id = $1`, chatID); err != nil {
			return store("pin", err)
		}
		if _, err := r.tx.Exec(ctx, `insert into chat.pins (chat_id, message_id, pinned_by, pinned_at) values ($1, $2, $3, $4)`, chatID, msg, r.me, r.now); err != nil {
			return store("pin", err)
		}
		out.PinnedMessageId = &msg
		return nil
	})
	return out, err
}

// Unpin removes the pin of the chat.
func (s *Service) Unpin(ctx context.Context, tc tenantctx.TenantContext, chatID uuid.UUID) (api.ChatPinState, error) {
	var out api.ChatPinState
	err := s.run(ctx, tc, true, func(r *req) error {
		a, err := r.open(ctx, chatID, false)
		if err != nil {
			return err
		}
		if !a.Can.Pin {
			return forbidden("Закрепляют модераторы")
		}
		if _, err := r.tx.Exec(ctx, `delete from chat.pins where chat_id = $1`, chatID); err != nil {
			return store("pin", err)
		}
		return nil
	})
	return out, err
}
