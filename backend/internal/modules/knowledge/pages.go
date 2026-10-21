package knowledge

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	kapi "github.com/ortus/ortus-crm/backend/internal/api/knowledge"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// The operations knowledge/pages of the contract 0.1 are a projection of the page nodes of the spaces (W4.04,
// Q-W4.00-knowledge-1), kept for the forms core (createKbPage, saveKbPage of the prototype): status draft and review
// → draft, active and outdated → published, archived → archived; the scope of a page is its space.

// pageStatus is the status of the projection.
func pageStatus(n *node) kapi.KnowledgePageStatus {
	switch {
	case n.archived:
		return kapi.KnowledgePageStatusArchived
	case n.status == statusDraft || n.status == statusReview:
		return kapi.KnowledgePageStatusDraft
	}
	return kapi.KnowledgePageStatusPublished
}

// pageDTO is a page node in the schema KnowledgePage.
func (r *req) pageDTO(n *node) kapi.KnowledgePage {
	cur := n.last()
	return kapi.KnowledgePage{
		Id: n.id, Title: n.title, BodyMarkdown: cur.body, ParentPageId: r.visibleParent(n), Status: pageStatus(n),
		Revision: int64(cur.v), UpdatedAt: cur.at,
		Scope: kapi.Scope{Kind: kapi.ScopeKindSpace, ResourceIds: []uuid.UUID{n.space}},
	}
}

// page returns the visible page node id (404 for another kind, as a missing one).
func (r *req) page(id uuid.UUID) (*node, error) {
	n, err := r.node(id)
	if err != nil {
		return nil, err
	}
	if n.kind != kindPage {
		return nil, notFound(textNodeNotFound)
	}
	return n, nil
}

// Pages lists the visible page nodes of the spaces (listKnowledgePages).
func (s *Service) Pages(ctx context.Context, tc tenantctx.TenantContext, p Page) (kapi.KnowledgePageList, error) {
	out := kapi.KnowledgePageList{Items: []kapi.KnowledgePage{}}
	err := s.run(ctx, tc, false, func(r *req) error {
		var pages []*node
		for _, sp := range r.w.spaces {
			for _, n := range r.w.order(sp.id, false) {
				if n.kind == kindPage && r.visible(n) {
					pages = append(pages, n)
				}
			}
		}
		from, to, next, err := paginate(ids(pages), p)
		if err != nil {
			return err
		}
		for _, n := range pages[from:to] {
			out.Items = append(out.Items, r.pageDTO(n))
		}
		out.NextCursor = next
		return nil
	})
	return out, err
}

// GetPage is a visible page node (getKnowledgePage).
func (s *Service) GetPage(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (kapi.KnowledgePage, error) {
	var out kapi.KnowledgePage
	err := s.runOn(ctx, tc, false, onNode(id), func(r *req) error {
		n, err := r.page(id)
		if err != nil {
			return err
		}
		out = r.pageDTO(n)
		return nil
	})
	return out, err
}

// CreatePage creates a page at the top level of the space of parentPageId or of the first space the member may
// create in (createKnowledgePage — createKbPage of the forms core): the title is unique among the pages of the space
// the member sees (an invisible duplicate is not revealed, knowledge.md §5 п. 25).
func (s *Service) CreatePage(ctx context.Context, tc tenantctx.TenantContext, b kapi.KnowledgePageCreate) (kapi.KnowledgePage, error) {
	var out kapi.KnowledgePage
	parent := probe{}
	if b.ParentPageId != nil {
		parent = onNode(*b.ParentPageId)
	}
	err := s.runOn(ctx, tc, true, parent, func(r *req) error {
		sp, err := r.pageSpace(b.ParentPageId)
		if err != nil {
			return err
		}
		n, err := r.legacyPage(sp, b.Title, b.BodyMarkdown)
		if err != nil {
			return err
		}
		if err := r.wr.node(ctx, n); err != nil {
			return err
		}
		r.w.nodes[n.id] = n
		ev, err := r.publish(ctx, "kb.node.created", aggNode, n.id, map[string]any{"spaceId": sp.id, "kind": n.kind})
		if err != nil {
			return err
		}
		title := "В разделе «" + sp.name + "» создана страница «" + n.title + "»"
		if err := r.notify(ctx, "kb.node.created", title, n.id, ev, r.w.owners()); err != nil {
			return err
		}
		out = r.pageDTO(n)
		return nil
	})
	return out, err
}

// pageSpace is the space of a new page: of the parent page, or the first the member may create in.
func (r *req) pageSpace(parent *uuid.UUID) (*space, error) {
	if parent != nil {
		p, err := r.node(*parent)
		if err != nil {
			return nil, err
		}
		sp := r.w.spaceOf(p)
		if !r.w.spaceMy(r.me, sp).create {
			return nil, forbidden("Нет права создавать страницы в пространстве")
		}
		return sp, nil
	}
	for _, sp := range r.w.spaces {
		if r.w.spaceMy(r.me, sp).create {
			return sp, nil
		}
	}
	return nil, failed("Выберите раздел Базы знаний")
}

// legacyPage checks and makes a page of the forms core in sp: the title at least 3 characters and unique among the
// visible pages of sp, a non-empty text.
func (r *req) legacyPage(sp *space, title, body string) (*node, error) {
	t := strings.TrimSpace(title)
	if utf8.RuneCountInString(t) < 3 {
		return nil, failed("Название страницы — не короче 3 символов")
	}
	if utf8.RuneCountInString(t) > titleMax {
		return nil, failed("Название — не длиннее 120 символов")
	}
	for _, n := range r.w.nodes {
		if n.space == sp.id && strings.EqualFold(n.title, t) && r.visible(n) {
			return nil, failed("В разделе «" + sp.name + "» уже есть страница «" + t + "»")
		}
	}
	text := strings.TrimSpace(body)
	if text == "" {
		return nil, failed("Текст страницы пустой")
	}
	n := r.newNode(sp, kindPage, t, text, statusActive)
	n.pos = r.w.nextPos(sp.id, uuid.Nil)
	return n, nil
}

// UpdatePage saves a page (updateKnowledgePage — saveKbPage of the forms core): a new title or text is a new
// version (If-Match is the current version), status archived archives the branch, draft — the status draft,
// published — restores an archived page or makes it active.
func (s *Service) UpdatePage(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b kapi.KnowledgePagePatch) (kapi.KnowledgePage, error) {
	var out kapi.KnowledgePage
	err := s.runOn(ctx, tc, true, onNode(id), func(r *req) error {
		n, err := r.page(id)
		if err != nil {
			return err
		}
		if ifMatch != etag(int64(n.last().v)) {
			return problem.New(codeConflict, textConflict(n.last().v))
		}
		if b.BodyMarkdown != nil || b.Title != nil {
			if err := r.savePage(ctx, n, b); err != nil {
				return err
			}
		}
		if b.Status != nil {
			if err := r.applyStatus(ctx, n, *b.Status); err != nil {
				return err
			}
		}
		out = r.pageDTO(n)
		return nil
	})
	return out, err
}

// savePage publishes the new title or text of a page (strict: the text is trimmed and not empty).
func (r *req) savePage(ctx context.Context, n *node, b kapi.KnowledgePagePatch) error {
	if err := r.canEditNode(n); err != nil {
		return err
	}
	body := n.last().body
	if b.BodyMarkdown != nil {
		body = strings.TrimSpace(*b.BodyMarkdown)
		if body == "" {
			return failed("Текст страницы пустой")
		}
	}
	p := publication{body: body}
	if b.Title != nil {
		p.title = *b.Title
	}
	_, _, err := r.publishVersion(ctx, n, p)
	return err
}

// applyStatus applies the status of the projection.
func (r *req) applyStatus(ctx context.Context, n *node, st kapi.KnowledgePagePatchStatus) error {
	switch st {
	case kapi.KnowledgePagePatchStatusArchived:
		if n.archived {
			return nil
		}
		return r.archive(ctx, n, true)
	case kapi.KnowledgePagePatchStatusDraft:
		return r.setStatus(ctx, n, statusDraft)
	case kapi.KnowledgePagePatchStatusPublished:
		if n.archived {
			return r.archive(ctx, n, false)
		}
		return r.setStatus(ctx, n, statusActive)
	}
	return failed("Неизвестный статус")
}
