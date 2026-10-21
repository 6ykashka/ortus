package knowledge

import (
	"context"
	"encoding/base64"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	kapi "github.com/ortus/ortus-crm/backend/internal/api/knowledge"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Page is the cursor and the limit of a list.
type Page struct {
	Cursor *string
	Limit  *int
}

const (
	defaultLimit = 50
	maxLimit     = 200
)

// paginate returns the page of ids after the cursor (the last id of the previous page) and the next cursor.
func paginate(ids []uuid.UUID, p Page) (from, to int, next *string, err error) {
	limit := defaultLimit
	if p.Limit != nil {
		limit = min(max(*p.Limit, 1), maxLimit)
	}
	if p.Cursor != nil && *p.Cursor != "" {
		raw, derr := base64.RawURLEncoding.DecodeString(*p.Cursor)
		id, perr := uuid.FromBytes(raw)
		i := slices.Index(ids, id)
		if derr != nil || perr != nil || i < 0 {
			return 0, 0, nil, problem.New(problem.CodeMalformedRequest, "")
		}
		from = i + 1
	}
	to = min(from+limit, len(ids))
	if to < len(ids) {
		c := base64.RawURLEncoding.EncodeToString(ids[to-1][:])
		next = &c
	}
	return from, to, next, nil
}

// Spaces lists the spaces the member sees, as created (listKnowledgeSpaces).
func (s *Service) Spaces(ctx context.Context, tc tenantctx.TenantContext, p Page) (kapi.KnowledgeSpaceList, error) {
	out := kapi.KnowledgeSpaceList{Items: []kapi.KnowledgeSpace{}}
	err := s.run(ctx, tc, false, func(r *req) error {
		var vis []*space
		var ids []uuid.UUID
		for _, sp := range r.w.spaces {
			if r.w.spaceVisible(r.me, sp) {
				vis, ids = append(vis, sp), append(ids, sp.id)
			}
		}
		from, to, next, err := paginate(ids, p)
		if err != nil {
			return err
		}
		for _, sp := range vis[from:to] {
			out.Items = append(out.Items, r.spaceDTO(sp))
		}
		out.NextCursor = next
		return nil
	})
	return out, err
}

// Templates lists the starting templates of spaces (listKnowledgeSpaceTemplates).
func (s *Service) Templates(ctx context.Context, tc tenantctx.TenantContext) (kapi.KnowledgeSpaceTemplateList, error) {
	var out kapi.KnowledgeSpaceTemplateList
	err := s.run(ctx, tc, false, func(r *req) error {
		out.Items = r.templatesDTO()
		return nil
	})
	return out, err
}

// Tree is a space and its visible nodes depth-first (getKnowledgeSpaceTree).
func (s *Service) Tree(ctx context.Context, tc tenantctx.TenantContext, spaceID uuid.UUID) (kapi.KnowledgeTree, error) {
	var out kapi.KnowledgeTree
	err := s.runOn(ctx, tc, false, onSpace(spaceID), func(r *req) error {
		sp, err := r.space(spaceID)
		if err != nil {
			return err
		}
		out.Space, out.Nodes = r.spaceDTO(sp), []kapi.KnowledgeNodeSummary{}
		for _, x := range r.w.visibleTree(r.me, sp) {
			out.Nodes = append(out.Nodes, r.summaryDTO(x.n))
		}
		return nil
	})
	return out, err
}

// Search finds the visible not archived nodes by title and current text (searchKnowledge): at most twelve, by space
// and tree, each with the path «Пространство › родители» and an excerpt.
func (s *Service) Search(ctx context.Context, tc tenantctx.TenantContext, q string, spaceID *uuid.UUID) (kapi.KnowledgeSearchResult, error) {
	out := kapi.KnowledgeSearchResult{Items: []kapi.KnowledgeSearchHit{}}
	needle := strings.ToLower(strings.TrimSpace(q))
	if utf8.RuneCountInString(needle) < titleMin {
		return out, invalid("q", "Введите не меньше 2 символов", "too_short")
	}
	in := probe{}
	if spaceID != nil {
		in = onSpace(*spaceID)
	}
	err := s.runOn(ctx, tc, false, in, func(r *req) error {
		spaces := r.w.spaces
		if spaceID != nil {
			sp, err := r.space(*spaceID)
			if err != nil {
				return err
			}
			spaces = []*space{sp}
		}
		for _, sp := range spaces {
			for _, n := range r.w.order(sp.id, false) {
				if len(out.Items) == maxResults {
					return nil
				}
				body := n.last().body
				if r.visible(n) && strings.Contains(strings.ToLower(n.title+" "+body), needle) {
					out.Items = append(out.Items, r.hit(sp, n))
				}
			}
		}
		return nil
	})
	return out, err
}

func (r *req) hit(sp *space, n *node) kapi.KnowledgeSearchHit {
	path := []string{sp.name}
	for _, x := range r.visiblePath(n) {
		path = append(path, x.Title)
	}
	return kapi.KnowledgeSearchHit{NodeId: n.id, SpaceId: sp.id, SpaceName: sp.name, Kind: kapi.KnowledgeSearchHitKind(n.kind),
		Title: n.title, Path: path, Excerpt: excerpt(n.last().body, excerptLen)}
}

// Node is a visible node (getKnowledgeNode).
func (s *Service) Node(ctx context.Context, tc tenantctx.TenantContext, nodeID uuid.UUID) (kapi.KnowledgeNode, error) {
	var out kapi.KnowledgeNode
	err := s.runOn(ctx, tc, false, onNode(nodeID), func(r *req) error {
		n, err := r.node(nodeID)
		if err != nil {
			return err
		}
		out = r.nodeDTO(n)
		return nil
	})
	return out, err
}

// Version is an old version of a visible node (getKnowledgeNodeVersion).
func (s *Service) Version(ctx context.Context, tc tenantctx.TenantContext, nodeID uuid.UUID, v int) (kapi.KnowledgeVersion, error) {
	var out kapi.KnowledgeVersion
	err := s.runOn(ctx, tc, false, onNode(nodeID), func(r *req) error {
		n, err := r.node(nodeID)
		if err != nil {
			return err
		}
		i := slices.IndexFunc(n.versions, func(x version) bool { return x.v == v })
		if i < 0 {
			return notFound("Версия не найдена")
		}
		x := n.versions[i]
		if x.v != n.last().v {
			if err := r.tx.QueryRow(ctx, `select body from kb.versions where node_id = $1 and version = $2`, n.id, x.v).Scan(&x.body); err != nil {
				return err
			}
		}
		out = kapi.KnowledgeVersion{Version: x.v, PublishedAt: x.at, AuthorDisplayName: x.author, Body: x.body}
		return nil
	})
	return out, err
}

// Archive lists the roots of the archived branches of a space with their size (listKnowledgeArchive): an editor or
// the lead of the space.
func (s *Service) Archive(ctx context.Context, tc tenantctx.TenantContext, spaceID uuid.UUID) (kapi.KnowledgeArchiveList, error) {
	out := kapi.KnowledgeArchiveList{Items: []kapi.KnowledgeArchiveItem{}}
	err := s.runOn(ctx, tc, false, onSpace(spaceID), func(r *req) error {
		sp, err := r.space(spaceID)
		if err != nil {
			return err
		}
		if my := r.w.spaceMy(r.me, sp); !my.edit && !my.lead {
			return forbidden(textArchiveRight)
		}
		for _, n := range r.w.order(sp.id, true) {
			if !n.archived || (r.w.nodeOf(n.parent) != nil && r.w.nodeOf(n.parent).archived) || !r.visible(n) {
				continue
			}
			out.Items = append(out.Items, kapi.KnowledgeArchiveItem{NodeId: n.id, Title: n.title,
				Kind: kapi.KnowledgeArchiveItemKind(n.kind), Pages: len(r.w.subtree(n, true))})
		}
		return nil
	})
	return out, err
}
