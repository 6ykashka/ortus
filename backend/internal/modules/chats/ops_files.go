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

// viewOnceTerm is how long a view-once file lives after its first opening.
const viewOnceTerm = 24 * time.Hour

// RevealPdn gives the text of a message without the mask to the one who has the right, and writes it to the journal and the
// audit: every reveal is traceable. The function «driver» never reveals (the evaluator blocks chat.pdn.read).
func (s *Service) RevealPdn(ctx context.Context, tc tenantctx.TenantContext, chatID, id uuid.UUID) (api.ChatPdnReveal, error) {
	var out api.ChatPdnReveal
	err := s.run(ctx, tc, true, func(r *req) error {
		a, err := r.open(ctx, chatID, false)
		if err != nil {
			return err
		}
		if !a.Can.Pdn {
			if a.Actor.Driver {
				return coded(codeFunction, "Функция «Водитель» закрывает раскрытие ПДн")
			}
			return forbidden("Номер скрыт: нужно право «ПДн без маски»")
		}
		m, err := r.message(ctx, chatID, id, false)
		if err != nil {
			return err
		}
		if m.DeletedAt != nil {
			return failed(textMsgDeleted)
		}
		name, err := r.nameOf(ctx, r.me)
		if err != nil {
			return err
		}
		if err := r.journal(ctx, chatID, name+" раскрыл(а) ПДн в сообщении от "+r.stamp(m.CreatedAt), nil); err != nil {
			return err
		}
		if err := r.record(ctx, "chat.message.pdn_reveal", "chat.message", m.ID, map[string]any{litChatID: chatID, litSeq: m.Seq}); err != nil {
			return err
		}
		if err := r.publish(ctx, "chat.pdn.revealed", "chat.message", m.ID, map[string]any{litChatID: chatID, litMessageID: m.ID}); err != nil {
			return err
		}
		out = api.ChatPdnReveal{MessageId: m.ID, Text: m.Text, RevealedAt: r.now}
		return nil
	})
	return out, err
}

// OpenViewOnce opens a view-once file for a recipient: a short link with a watermark and without a download; the file goes
// 24 hours after the first opening (the job Sweep). The author does not open it; each recipient opens it once.
func (s *Service) OpenViewOnce(ctx context.Context, tc tenantctx.TenantContext, chatID, attachment uuid.UUID) (api.ChatViewOnceLink, error) { //nolint:gocyclo // one operation of the contract: a chain of checks, each with the text of the reference
	var out api.ChatViewOnceLink
	err := s.run(ctx, tc, true, func(r *req) error {
		if _, err := r.open(ctx, chatID, false); err != nil {
			return err
		}
		var (
			at      attRec
			author  *uuid.UUID
			deleted *time.Time
		)
		err := r.tx.QueryRow(ctx, `select a.id, a.message_id, a.file_id, a.file_name, a.view_once, a.opened_by, a.gone_at, m.author_id, m.deleted_at
			from chat.attachments a join chat.messages m on m.id = a.message_id where a.id = $1 and m.chat_id = $2 for update of a`, attachment, chatID).
			Scan(&at.ID, &at.MessageID, &at.FileID, &at.Name, &at.ViewOnce, &at.OpenedBy, &at.GoneAt, &author, &deleted)
		if noRows(err) {
			return notFound("Вложение не найдено")
		}
		if err != nil {
			return store("attachment", err)
		}
		switch {
		case deleted != nil:
			return failed(textMsgDeleted)
		case !at.ViewOnce:
			return failed("Файл не одноразовый")
		case author != nil && *author == r.me:
			return failed("Автор одноразового файла его не открывает: файл видят только получатели")
		case at.GoneAt != nil && !at.GoneAt.After(r.now):
			return coded(codeTransition, "Файл удалён: прошло 24 часа после первого открытия")
		}
		if slices.Contains(at.OpenedBy, r.me) {
			return coded(codeTransition, "Вы уже открыли этот файл — он больше не откроется")
		}
		if r.s.Files == nil || at.FileID == nil {
			return coded("dependency_unavailable", "Просмотр файлов не подключён")
		}
		const ttl = 5 * time.Minute
		url, err := r.s.Files.ViewURL(ctx, r.tc.TenantID, *at.FileID, ttl)
		if err != nil {
			return store("view link", err)
		}
		if _, err := r.tx.Exec(ctx, `update chat.attachments set opened_by = array_append(opened_by, $2),
			gone_at = coalesce(gone_at, $3::timestamptz) where id = $1`, at.ID, r.me, r.now.Add(viewOnceTerm)); err != nil {
			return store("open once", err)
		}
		name, err := r.nameOf(ctx, r.me)
		if err != nil {
			return err
		}
		if err := r.journal(ctx, chatID, name+" открыл(а) одноразовый файл «"+at.Name+"»", nil); err != nil {
			return err
		}
		out = api.ChatViewOnceLink{Url: url, ExpiresAt: r.now.Add(ttl), Watermark: name, NoDownload: true}
		return nil
	})
	return out, err
}

// SaveToRecord gives the attachments of a message to the record of the chat: the owner of the files changes, and the place
// is no longer charged to the chat.
func (s *Service) SaveToRecord(ctx context.Context, tc tenantctx.TenantContext, chatID, id uuid.UUID, target *api.ObjectRef) (api.ChatSaveToRecordResult, error) { //nolint:gocyclo // one operation of the contract: a chain of checks, each with the text of the reference
	var out api.ChatSaveToRecordResult
	err := s.run(ctx, tc, true, func(r *req) error {
		a, err := r.open(ctx, chatID, true)
		if err != nil {
			return err
		}
		if !a.Can.SaveToRecord {
			return forbidden("Сохранять в запись могут участники чата записи")
		}
		m, err := r.message(ctx, chatID, id, false)
		if err != nil {
			return err
		}
		if m.DeletedAt != nil {
			return failed(textMsgDeleted)
		}
		rec := a.Chat.Record
		if target != nil && (target.EntityId != rec.ID || target.EntityType != rec.Type) {
			return failed("Сохранить можно только в запись этого чата")
		}
		rows, err := r.tx.Query(ctx, `select id, message_id, file_id, file_name, size_bytes, kind, view_once, opened_by, gone_at, saved_to
			from chat.attachments where message_id = $1 and saved_to is null and not view_once and (gone_at is null or gone_at > $2) order by created_at, id for update`, id, r.now)
		if err != nil {
			return store("attachments", err)
		}
		list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (attRec, error) {
			var x attRec
			err := row.Scan(&x.ID, &x.MessageID, &x.FileID, &x.Name, &x.Size, &x.Kind, &x.ViewOnce, &x.OpenedBy, &x.GoneAt, &x.SavedTo)
			return x, err
		})
		if err != nil {
			return store("attachments", err)
		}
		if len(list) == 0 {
			return failed("Нечего сохранять: файлы уже в записи")
		}
		saved, _ := json.Marshal(objJSON{ModuleKey: rec.Module, EntityType: rec.Type, EntityID: rec.ID})
		var bytes int64
		out.Saved = make([]api.ChatAttachment, 0, len(list))
		for _, at := range list {
			if _, err := r.tx.Exec(ctx, `update chat.attachments set saved_to = $2 where id = $1`, at.ID, saved); err != nil {
				return store("save", err)
			}
			if r.s.Files != nil && at.FileID != nil {
				if err := r.s.Files.Move(ctx, r.tx, *at.FileID, rec.object()); err != nil {
					return store("move file", err)
				}
			}
			at.SavedTo = saved
			out.Saved = append(out.Saved, r.attachment(m, at))
			bytes += at.Size
		}
		if _, err := r.tx.Exec(ctx, `update chat.chats set used_bytes = greatest(0, used_bytes - $2) where id = $1`, chatID, bytes); err != nil {
			return store("used", err)
		}
		name, err := r.nameOf(ctx, r.me)
		if err != nil {
			return err
		}
		if err := r.journal(ctx, chatID, name+" сохранил(а) "+pluralN(len(list), "файл", "файла", "файлов")+" в запись · "+sizeText(bytesMB(bytes)), nil); err != nil {
			return err
		}
		out.Record = api.ObjectRef{ModuleKey: rec.Module, EntityType: rec.Type, EntityId: rec.ID}
		out.Bytes = bytes
		return nil
	})
	return out, err
}

// TaskFromMessage makes a task of a message with the rights of the actor (the project is the argument, or the project of
// the unit of the chat, or the first one the port finds); the link goes back to the message.
func (s *Service) TaskFromMessage(ctx context.Context, tc tenantctx.TenantContext, chatID, id uuid.UUID, b api.ChatTaskCreate) (api.ChatTaskRef, error) {
	var out api.ChatTaskRef
	err := s.run(ctx, tc, true, func(r *req) error {
		a, err := r.open(ctx, chatID, false)
		if err != nil {
			return err
		}
		if !a.Can.Task {
			return forbidden("Создавать задачи может роль с правом «Задачи · Создавать»")
		}
		m, err := r.message(ctx, chatID, id, true)
		if err != nil {
			return err
		}
		if m.DeletedAt != nil {
			return failed(textMsgDeleted)
		}
		if r.s.Tasks == nil {
			return coded("dependency_unavailable", "Задачи не подключены")
		}
		title := b.Title
		if title == "" {
			title = TaskTitle(m.Text, "")
		}
		d := TaskDraft{Title: title, ChatID: chatID, Message: id, Link: "Чат «" + a.Chat.Title + "»"}
		if b.ProjectId != nil {
			d.Project = *b.ProjectId
		}
		if a.Chat.Unit != nil {
			d.Unit = *a.Chat.Unit
		}
		res, err := r.s.Tasks.Create(ctx, r.tc, d)
		if err != nil {
			return err
		}
		x := m.misc()
		x.Tasks = append(x.Tasks, api.ChatTaskRef{TaskId: res.ID, Key: res.Key})
		card, _ := json.Marshal(x)
		if _, err := r.tx.Exec(ctx, `update chat.messages set system_card = $2 where id = $1`, id, card); err != nil {
			return store("task link", err)
		}
		if err := r.journal(ctx, chatID, "Задача "+res.Key+" создана из сообщения от "+r.stamp(m.CreatedAt), nil); err != nil {
			return err
		}
		out = api.ChatTaskRef{TaskId: res.ID, Key: res.Key}
		return nil
	})
	return out, err
}
