package chats

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// SweepStats is what one pass of the jobs by term did in a tenant.
type SweepStats struct {
	Expired, ViewOnce, Aged, Purged, Wiped, PollsClosed, Overdue, Exports int
}

const sweepBatch = 500

// system runs fn as the service of the tenant (no person): the jobs by term.
func (s *Service) system(ctx context.Context, tenant uuid.UUID, fn func(*req) error) error {
	return s.run(ctx, tenantctx.TenantContext{TenantID: tenant}, true, fn)
}

// Sweep runs the jobs by term of a tenant (chatTick of the reference is these jobs, W7.11): temporary messages go, view-once
// files are removed 24 hours after the first opening, attachments and text live as long as the policy of the kind says,
// the content of deleted messages and the time of reading are wiped after their terms, polls close, overdue important
// messages are marked and the exports are built. Everything under a hold stays.
func (s *Service) Sweep(ctx context.Context, tenant uuid.UUID) (SweepStats, error) {
	var st SweepStats
	steps := []func(*req, context.Context, *SweepStats) error{
		(*req).expireEphemeral, (*req).removeViewOnce, (*req).ageAttachments, (*req).purgeText, (*req).wipeDeleted,
		(*req).closePolls, (*req).markOverdue,
	}
	for _, step := range steps {
		if err := s.system(ctx, tenant, func(r *req) error { return step(r, ctx, &st) }); err != nil {
			return st, err
		}
	}
	err := s.system(ctx, tenant, func(r *req) error { return r.runExports(ctx, &st) })
	return st, err
}

// expireEphemeral removes the temporary messages whose time is over: the text is gone, only the fact stays out of sight.
func (r *req) expireEphemeral(ctx context.Context, st *SweepStats) error {
	holds, err := r.activeHolds(ctx)
	if err != nil {
		return err
	}
	rows, err := r.tx.Query(ctx, `select m.id, m.chat_id, m.author_id, m.created_at from chat.messages m where m.ephemeral is not null and m.deleted_at is null
		and (m.ephemeral ->> 'expiresAt')::timestamptz <= $1 order by m.created_at limit $2`, r.now, sweepBatch)
	if err != nil {
		return store("expired", err)
	}
	type cand struct {
		id, chat uuid.UUID
		author   *uuid.UUID
		at       time.Time
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (cand, error) {
		var c cand
		err := row.Scan(&c.id, &c.chat, &c.author, &c.at)
		return c, err
	})
	if err != nil {
		return store("expired", err)
	}
	for _, c := range list {
		if AnyHold(holds, c.chat, deref0(c.author), c.at, r.now) {
			continue
		}
		if _, err := r.tx.Exec(ctx, `update chat.messages set text = '', spoiler = null, important = null, deleted_at = $2, deleted_by = author_id where id = $1`, c.id, r.now); err != nil {
			return store("expire", err)
		}
		if err := r.releaseAttachments(ctx, &chatRec{ID: c.chat}, c.id); err != nil {
			return err
		}
		if err := r.publish(ctx, "chat.message.expired", "chat.message", c.id, map[string]any{litChatID: c.chat, litMessageID: c.id}); err != nil {
			return err
		}
		st.Expired++
	}
	return nil
}

// removeViewOnce removes the view-once files whose 24 hours after the first opening are over.
func (r *req) removeViewOnce(ctx context.Context, st *SweepStats) error {
	rows, err := r.tx.Query(ctx, `select a.id, m.chat_id, a.size_bytes from chat.attachments a join chat.messages m on m.id = a.message_id
		where a.view_once and a.file_id is not null and a.gone_at <= $1 limit $2`, r.now, sweepBatch)
	if err != nil {
		return store("view-once", err)
	}
	type cand struct {
		id, chat uuid.UUID
		size     int64
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (cand, error) {
		var c cand
		err := row.Scan(&c.id, &c.chat, &c.size)
		return c, err
	})
	if err != nil {
		return store("view-once", err)
	}
	for _, c := range list {
		if err := r.dropAttachments(ctx, []uuid.UUID{c.id}); err != nil {
			return err
		}
		if _, err := r.tx.Exec(ctx, `update chat.chats set used_bytes = greatest(0, used_bytes - $2) where id = $1`, c.chat, c.size); err != nil {
			return store("used", err)
		}
		st.ViewOnce++
	}
	return nil
}

// ageAttachments removes the attachments older than the term of their kind of chat (filesDays; voiceDays for voice); the
// ones under a hold and saved to a record stay.
func (r *req) ageAttachments(ctx context.Context, st *SweepStats) error {
	holds, err := r.activeHolds(ctx)
	if err != nil {
		return err
	}
	for _, k := range Kinds {
		p, _, err := r.kindPolicy(ctx, k)
		if err != nil {
			return err
		}
		files, voice := r.now.AddDate(0, 0, -p.FilesDays), r.now.AddDate(0, 0, -p.VoiceDays)
		rows, err := r.tx.Query(ctx, `select a.id, m.chat_id, a.size_bytes, m.author_id, m.created_at from chat.attachments a
			join chat.messages m on m.id = a.message_id join chat.chats c on c.id = m.chat_id
			where c.kind = $1 and a.file_id is not null and a.saved_to is null and (a.gone_at is null)
			  and ((a.kind = 'voice' and a.created_at < $2) or (a.kind <> 'voice' and a.created_at < $3)) limit $4`, string(k), voice, files, sweepBatch)
		if err != nil {
			return store("aging", err)
		}
		type cand struct {
			id, chat uuid.UUID
			size     int64
			author   *uuid.UUID
			at       time.Time
		}
		list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (cand, error) {
			var c cand
			err := row.Scan(&c.id, &c.chat, &c.size, &c.author, &c.at)
			return c, err
		})
		if err != nil {
			return store("aging", err)
		}
		for _, c := range list {
			if AnyHold(holds, c.chat, deref0(c.author), c.at, r.now) {
				continue
			}
			if err := r.dropAttachments(ctx, []uuid.UUID{c.id}); err != nil {
				return err
			}
			if _, err := r.tx.Exec(ctx, `update chat.chats set used_bytes = greatest(0, used_bytes - $2) where id = $1`, c.chat, c.size); err != nil {
				return store("used", err)
			}
			st.Aged++
		}
	}
	return nil
}

// purgeText deletes the messages older than the term of the text of their kind of chat (textYears), with everything that
// hangs on them; the ones under a hold stay.
func (r *req) purgeText(ctx context.Context, st *SweepStats) error {
	holds, err := r.activeHolds(ctx)
	if err != nil {
		return err
	}
	for _, k := range Kinds {
		p, _, err := r.kindPolicy(ctx, k)
		if err != nil {
			return err
		}
		rows, err := r.tx.Query(ctx, `select m.id, m.chat_id, m.author_id, m.created_at from chat.messages m join chat.chats c on c.id = m.chat_id
			where c.kind = $1 and m.kind <> 'system' and m.created_at < $2 order by m.created_at limit $3`, string(k), r.now.AddDate(-p.TextYears, 0, 0), sweepBatch)
		if err != nil {
			return store("purge", err)
		}
		type cand struct {
			id, chat uuid.UUID
			author   *uuid.UUID
			at       time.Time
		}
		list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (cand, error) {
			var c cand
			err := row.Scan(&c.id, &c.chat, &c.author, &c.at)
			return c, err
		})
		if err != nil {
			return store("purge", err)
		}
		for _, c := range list {
			if AnyHold(holds, c.chat, deref0(c.author), c.at, r.now) {
				continue
			}
			if err := r.releaseAttachments(ctx, &chatRec{ID: c.chat}, c.id); err != nil {
				return err
			}
			for _, q := range []string{
				`delete from chat.poll_votes where poll_id in (select id from chat.polls where message_id = $1)`,
				`delete from chat.polls where message_id = $1`, `delete from chat.acks where message_id = $1`,
				`delete from chat.message_versions where message_id = $1`, `delete from chat.pins where message_id = $1`,
				`delete from chat.attachments where message_id = $1`, `update chat.messages set reply_to = null where reply_to = $1`,
				`delete from chat.messages where id = $1`,
			} {
				if _, err := r.tx.Exec(ctx, q, c.id); err != nil {
					return store("purge", err)
				}
			}
			st.Purged++
		}
	}
	return nil
}

// wipeDeleted wipes the content of deleted messages after 30 days (CHAT-10) and the time of reading after receiptsDays of
// the kind; the content of a message under a hold is kept, and so is the journal of a chat while a hold of employees or a
// period lasts.
func (r *req) wipeDeleted(ctx context.Context, st *SweepStats) error { //nolint:gocyclo // one operation of the contract: a chain of checks, each with the text of the reference
	holds, err := r.activeHolds(ctx)
	if err != nil {
		return err
	}
	cutoff := r.now.AddDate(0, 0, -Bounds.DeletedDays.Min)
	rows, err := r.tx.Query(ctx, `select m.id, m.chat_id, m.author_id, m.created_at from chat.messages m where m.deleted_text is not null and m.deleted_at <= $1 limit $2`, cutoff, sweepBatch)
	if err != nil {
		return store("wipe", err)
	}
	type cand struct {
		id, chat uuid.UUID
		author   *uuid.UUID
		at       time.Time
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (cand, error) {
		var c cand
		err := row.Scan(&c.id, &c.chat, &c.author, &c.at)
		return c, err
	})
	if err != nil {
		return store("wipe", err)
	}
	for _, c := range list {
		if AnyHold(holds, c.chat, deref0(c.author), c.at, r.now) {
			continue
		}
		if _, err := r.tx.Exec(ctx, `update chat.messages set deleted_text = null where id = $1`, c.id); err != nil {
			return store("wipe", err)
		}
		st.Wiped++
	}
	broad := false
	held := []uuid.UUID{}
	for _, h := range holds {
		switch h.Scope {
		case litChat:
			held = append(held, h.ChatID)
		default:
			broad = true
		}
	}
	if !broad {
		if _, err := r.tx.Exec(ctx, `update chat.journal set deleted_content = null where deleted_content is not null and at <= $1 and not (chat_id = any($2))`, cutoff, held); err != nil {
			return store("wipe journal", err)
		}
	}
	for _, k := range Kinds {
		p, _, err := r.kindPolicy(ctx, k)
		if err != nil {
			return err
		}
		if _, err := r.tx.Exec(ctx, `update chat.receipts rc set read_at = null from chat.chats c where c.id = rc.chat_id and c.kind = $1
			and rc.read_at is not null and rc.read_at < $2`, string(k), r.now.AddDate(0, 0, -p.ReceiptsDays)); err != nil {
			return store("wipe receipts", err)
		}
	}
	return nil
}

// closePolls closes the polls whose time is over and tells the chat the result.
func (r *req) closePolls(ctx context.Context, st *SweepStats) error {
	rows, err := r.tx.Query(ctx, `select p.id, p.message_id, m.chat_id, p.question, p.options from chat.polls p join chat.messages m on m.id = p.message_id
		where p.closed_at is null and p.closes_at <= $1 and m.deleted_at is null limit $2 for update of p`, r.now, sweepBatch)
	if err != nil {
		return store("polls", err)
	}
	type cand struct {
		id, msg, chat uuid.UUID
		question      string
		opts          []pollOpt
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (cand, error) {
		var (
			c   cand
			raw []byte
		)
		if err := row.Scan(&c.id, &c.msg, &c.chat, &c.question, &raw); err != nil {
			return c, err
		}
		return c, json.Unmarshal(raw, &c.opts)
	})
	if err != nil {
		return store("polls", err)
	}
	for _, c := range list {
		if _, err := r.tx.Exec(ctx, `update chat.polls set closed_at = closes_at where id = $1`, c.id); err != nil {
			return store("poll", err)
		}
		chat, err := scanChat(r.tx.QueryRow(ctx, `select `+chatCols+` from chat.chats c where c.id = $1 for update of c`, c.chat))
		if err != nil {
			return store(litChat, err)
		}
		text := "Голосов нет"
		var idx int
		var n int64
		if err := r.tx.QueryRow(ctx, `select option_idx, count(*) from chat.poll_votes where poll_id = $1 group by option_idx order by count(*) desc, option_idx limit 1`, c.id).
			Scan(&idx, &n); err == nil && idx < len(c.opts) {
			text = "Больше всего голосов: " + c.opts[idx].Text + " · " + strconv.FormatInt(n, 10)
		}
		if _, err := r.service(ctx, chat, chatCard("ballot", "ok", "Опрос закрыт: «"+c.question+"»", text)); err != nil {
			return err
		}
		if err := r.publish(ctx, "chat.poll.closed", "chat.message", c.msg, map[string]any{litChatID: c.chat, litMessageID: c.msg, "pollId": c.id}); err != nil {
			return err
		}
		if err := r.changed(ctx, chat); err != nil {
			return err
		}
		st.PollsClosed++
	}
	return nil
}

// markOverdue marks once the important messages whose date passed without all the acknowledgements: chat.ack.overdue.v1.
func (r *req) markOverdue(ctx context.Context, st *SweepStats) error {
	rows, err := r.tx.Query(ctx, `select m.id, m.chat_id from chat.messages m where m.important is not null and m.deleted_at is null
		and not (m.important ? 'overdue') and (m.important ->> 'dueDate')::date < $1::date limit $2`, r.now, sweepBatch)
	if err != nil {
		return store("overdue", err)
	}
	type cand struct{ id, chat uuid.UUID }
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (cand, error) {
		var c cand
		err := row.Scan(&c.id, &c.chat)
		return c, err
	})
	if err != nil {
		return store("overdue", err)
	}
	for _, c := range list {
		if _, err := r.tx.Exec(ctx, `update chat.messages set important = important || '{"overdue": true}'::jsonb where id = $1`, c.id); err != nil {
			return store("overdue", err)
		}
		var waiting int
		if err := r.tx.QueryRow(ctx, `select count(*) from chat.chat_members cm where cm.chat_id = $1 and cm.state = 'in'
			and cm.member_id is distinct from (select author_id from chat.messages where id = $2)
			and not exists (select 1 from chat.acks a where a.message_id = $2 and a.member_id = cm.member_id)`, c.chat, c.id).Scan(&waiting); err != nil {
			return store("overdue", err)
		}
		if waiting == 0 {
			continue
		}
		if err := r.publish(ctx, "chat.ack.overdue", "chat.message", c.id, map[string]any{litChatID: c.chat, litMessageID: c.id, "waiting": waiting}); err != nil {
			return err
		}
		st.Overdue++
	}
	return nil
}

// runExports builds the queued exports: the history of the chat in CSV or JSON, the text after the PDn mask; the file goes
// to the files of the organization. Without the storage of the files the job fails and says so.
func (r *req) runExports(ctx context.Context, st *SweepStats) error {
	rows, err := r.tx.Query(ctx, `select e.id, e.chat_id, e.format, e.period_from, e.period_to, e.created_by from chat.exports e
		where e.status = 'queued' order by e.created_at limit 20 for update of e skip locked`)
	if err != nil {
		return store("exports", err)
	}
	type job struct {
		id, chat uuid.UUID
		format   string
		from, to *time.Time
		by       *uuid.UUID
	}
	jobs, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (job, error) {
		var j job
		err := row.Scan(&j.id, &j.chat, &j.format, &j.from, &j.to, &j.by)
		return j, err
	})
	if err != nil {
		return store("exports", err)
	}
	for _, j := range jobs {
		file, err := r.buildExport(ctx, j.id, j.chat, j.format, j.from, j.to, j.by)
		status := "done"
		if err != nil || r.s.Files == nil {
			status = "failed"
		}
		var fid any
		if file != uuid.Nil {
			fid = file
		}
		if _, err := r.tx.Exec(ctx, `update chat.exports set status = $2, file_id = $3, finished_at = $4 where id = $1`, j.id, status, fid, r.now); err != nil {
			return store("export", err)
		}
		st.Exports++
	}
	return nil
}

func (r *req) buildExport(ctx context.Context, exportID, chatID uuid.UUID, format string, from, to *time.Time, by *uuid.UUID) (uuid.UUID, error) {
	if r.s.Files == nil {
		return uuid.Nil, nil
	}
	rows, err := r.tx.Query(ctx, `select m.seq, m.created_at, coalesce(p.full_name, 'Система'), m.kind, case when m.deleted_at is not null then '' else m.text end,
		m.deleted_at is not null from chat.messages m left join people.person_profiles p on p.id = m.author_id
		where m.chat_id = $1 and m.visible_to is null and ($2::timestamptz is null or m.created_at >= $2) and ($3::timestamptz is null or m.created_at <= $3)
		order by m.seq`, chatID, from, to)
	if err != nil {
		return uuid.Nil, store("export rows", err)
	}
	defer rows.Close()
	type line struct {
		Seq     int64     `json:"seq"`
		At      time.Time `json:"at"`
		Author  string    `json:"author"`
		Kind    string    `json:"kind"`
		Text    string    `json:"text"`
		Deleted bool      `json:"deleted"`
	}
	var lines []line
	for rows.Next() {
		var l line
		if err := rows.Scan(&l.Seq, &l.At, &l.Author, &l.Kind, &l.Text, &l.Deleted); err != nil {
			return uuid.Nil, store("export rows", err)
		}
		l.Text = MaskPdn(l.Text)
		lines = append(lines, l)
	}
	if err := rows.Err(); err != nil {
		return uuid.Nil, store("export rows", err)
	}
	var buf bytes.Buffer
	name, ctype := "chat-"+chatID.String()[:8]+"."+format, "application/json"
	if format == "csv" {
		ctype = "text/csv; charset=utf-8"
		w := csv.NewWriter(&buf)
		_ = w.Write([]string{litSeq, "at", "author", litKind, litText, "deleted"})
		for _, l := range lines {
			_ = w.Write([]string{strconv.FormatInt(l.Seq, 10), l.At.UTC().Format(time.RFC3339), l.Author, l.Kind, l.Text, strconv.FormatBool(l.Deleted)})
		}
		w.Flush()
	} else if err := json.NewEncoder(&buf).Encode(lines); err != nil {
		return uuid.Nil, err
	}
	return r.s.Files.Save(ctx, r.tx, r.tc.TenantID, deref0(by), ObjectRef{Module: "chat", Type: "export", ID: exportID}, name, ctype, buf.Bytes())
}
