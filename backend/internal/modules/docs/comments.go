package docs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	dapi "github.com/ortus/ortus-crm/backend/internal/api/docs"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

const commentMax = 2000

// commentText checks the text of a comment or a reply («Напишите комментарий», 2000 characters).
func commentText(s string) (string, error) {
	t := strings.TrimSpace(s)
	switch n := utf8.RuneCountInString(t); {
	case n == 0:
		return "", invalid("text", "Напишите комментарий")
	case n > commentMax:
		return "", invalid("text", "Комментарий — не длиннее 2000 символов")
	}
	return t, nil
}

// commentOf reads a comment of the document (404 for another document's).
func (r *req) commentOf(ctx context.Context, doc, id uuid.UUID) (author uuid.UUID, mention []uuid.UUID, err error) {
	err = r.tx.QueryRow(ctx, `select author_id, mention from docs.comments where id = $1 and document_id = $2`, id, doc).Scan(&author, &mention)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, nil, notFound(textCommentNotFound)
	}
	if err != nil {
		return uuid.Nil, nil, fmt.Errorf("docs: comment: %w", err)
	}
	return author, mention, nil
}

// mentioned checks the member a comment mentions: a live member of the organization.
func (r *req) mentioned(id *uuid.UUID) (uuid.UUID, error) {
	if id == nil {
		return uuid.Nil, nil
	}
	m := r.w.member[*id]
	if m == nil || m.status == memberBlocked {
		return uuid.Nil, invalid("mention", "Сотрудник не найден")
	}
	return m.id, nil
}

// afterMention tells the mentioned member (notification «Упоминание в документе») when he opens the document; a
// member without access gets nothing — the author decides whether to give him access (wait.mention).
func (r *req) afterMention(ctx context.Context, d *document, comment, to uuid.UUID) error {
	if to == uuid.Nil {
		return nil
	}
	ev, err := r.publish(ctx, "docs.comment.mentioned", aggDocument, d.id, map[string]any{"commentId": comment, "memberId": to})
	if err != nil {
		return err
	}
	if r.w.accessToDoc(r.w.member[to], d).level == levelNone {
		return nil
	}
	return r.notify(ctx, "docs.comment.mentioned", r.me.name+" упомянул(а) вас в документе «"+d.title+"»", d.id, ev, []uuid.UUID{to})
}

// anchorJSON checks the anchor of a comment (a block, a cell or a page, a reference of at most 100 characters, a quote
// of at most 300) and renders the stored object.
func anchorJSON(kind, ref string, quote *string) ([]byte, error) {
	ref = strings.TrimSpace(ref)
	if (kind != "block" && kind != "cell" && kind != "page") || ref == "" || utf8.RuneCountInString(ref) > 100 {
		return nil, invalid("anchor", "Привязка комментария указана неверно")
	}
	a := commentAnchor{Kind: kind, Ref: ref, Quote: quote}
	if quote != nil {
		q := clip(*quote, 300)
		a.Quote = &q
	}
	return json.Marshal(a)
}

// CreateComment comments a document (createDocComment — docComment).
func (s *Service) CreateComment(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, b dapi.DocCommentCreate) (dapi.DocComment, error) {
	var out dapi.DocComment
	err := s.runOn(ctx, tc, true, onDoc(id), func(r *req) error {
		d, rt, err := r.doc(id)
		if err != nil {
			return err
		}
		if !rt.comment || rt.onlyVersion > 0 {
			return forbidden("Комментировать может тот, у кого уровень «Комментирует» и выше")
		}
		text, err := commentText(b.Text)
		if err != nil {
			return err
		}
		raw, err := anchorJSON(string(b.Anchor.Kind), b.Anchor.Ref, b.Anchor.Quote)
		if err != nil {
			return err
		}
		to, err := r.mentioned(b.Mention)
		if err != nil {
			return err
		}
		var mention []uuid.UUID
		if to != uuid.Nil {
			mention = []uuid.UUID{to}
		}
		cid := r.s.newID()
		if _, err := r.tx.Exec(ctx, `insert into docs.comments (id, document_id, author_id, text, anchor, mention, created_at)
			values ($1, $2, $3, $4, $5, $6, $7)`, cid, id, r.me.id, text, raw, mention, r.now); err != nil {
			return fmt.Errorf("docs: comment: %w", err)
		}
		if err := r.afterMention(ctx, d, cid, to); err != nil {
			return err
		}
		if err := r.record(ctx, "docs.comment.create", id, "Комментарий: "+clip(text, 80), false, nil); err != nil {
			return err
		}
		items, err := r.comments(ctx, id, cid)
		if err != nil || len(items) != 1 {
			return fmt.Errorf("docs: comment: read back: %w", err)
		}
		out = items[0]
		return nil
	})
	return out, err
}

// ReplyComment answers a comment (replyDocComment — docReply).
func (s *Service) ReplyComment(ctx context.Context, tc tenantctx.TenantContext, id, comment uuid.UUID, b dapi.DocReplyCreate) (dapi.DocComment, error) {
	var out dapi.DocComment
	err := s.runOn(ctx, tc, true, onDoc(id), func(r *req) error {
		d, rt, err := r.doc(id)
		if err != nil {
			return err
		}
		if !rt.comment || rt.onlyVersion > 0 {
			return forbidden("Отвечать может тот, у кого уровень «Комментирует» и выше")
		}
		if _, _, err := r.commentOf(ctx, id, comment); err != nil {
			return err
		}
		text, err := commentText(b.Text)
		if err != nil {
			return err
		}
		to, err := r.mentioned(b.Mention)
		if err != nil {
			return err
		}
		if _, err := r.tx.Exec(ctx, `insert into docs.replies (comment_id, author_id, text, created_at) values ($1, $2, $3, $4)`,
			comment, r.me.id, text, r.now); err != nil {
			return fmt.Errorf("docs: reply: %w", err)
		}
		if err := r.afterMention(ctx, d, comment, to); err != nil {
			return err
		}
		if err := r.record(ctx, "docs.comment.reply", id, "Ответ: "+clip(text, 80), false, nil); err != nil {
			return err
		}
		items, err := r.comments(ctx, id, comment)
		if err != nil || len(items) != 1 {
			return fmt.Errorf("docs: reply: read back: %w", err)
		}
		out = items[0]
		return nil
	})
	return out, err
}

// ResolveComment closes a discussion (resolveDocComment — docResolve): the author of the comment or the one who edits.
func (s *Service) ResolveComment(ctx context.Context, tc tenantctx.TenantContext, id, comment uuid.UUID) (dapi.DocComment, error) {
	var out dapi.DocComment
	err := s.runOn(ctx, tc, true, onDoc(id), func(r *req) error {
		_, rt, err := r.doc(id)
		if err != nil {
			return err
		}
		author, _, err := r.commentOf(ctx, id, comment)
		if err != nil {
			return err
		}
		if rt.onlyVersion > 0 || !rt.comment || (author != r.me.id && !rt.editL) {
			return forbidden(textResolveRight)
		}
		if _, err := r.tx.Exec(ctx, `update docs.comments set resolved = true, resolved_by = $2 where id = $1`, comment, r.me.id); err != nil {
			return fmt.Errorf("docs: resolve: %w", err)
		}
		if err := r.record(ctx, "docs.comment.resolve", id, "Обсуждение закрыто", false, nil); err != nil {
			return err
		}
		items, err := r.comments(ctx, id, comment)
		if err != nil || len(items) != 1 {
			return fmt.Errorf("docs: resolve: read back: %w", err)
		}
		out = items[0]
		return nil
	})
	return out, err
}

// SkipMentionGrant removes the waiting item of the author about a mention of a member without access
// (skipDocMentionGrant — docMentionSkip): the access is not given and the mention is dropped.
func (s *Service) SkipMentionGrant(ctx context.Context, tc tenantctx.TenantContext, id, comment uuid.UUID) (dapi.DocComment, error) {
	var out dapi.DocComment
	err := s.runOn(ctx, tc, true, onDoc(id), func(r *req) error {
		_, rt, err := r.doc(id)
		if err != nil {
			return err
		}
		author, _, err := r.commentOf(ctx, id, comment)
		if err != nil {
			return err
		}
		if rt.onlyVersion > 0 || author != r.me.id {
			return forbidden("Пропустить доступ может автор комментария")
		}
		if _, err := r.tx.Exec(ctx, `update docs.comments set mention = '{}' where id = $1`, comment); err != nil {
			return fmt.Errorf("docs: skip mention: %w", err)
		}
		if err := r.record(ctx, "docs.comment.skip", id, "Доступ упомянутому не выдан", false, nil); err != nil {
			return err
		}
		items, err := r.comments(ctx, id, comment)
		if err != nil || len(items) != 1 {
			return fmt.Errorf("docs: skip mention: read back: %w", err)
		}
		out = items[0]
		return nil
	})
	return out, err
}
