package docs

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	dapi "github.com/ortus/ortus-crm/backend/internal/api/docs"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// ListQuery is the query of the list of documents.
type ListQuery struct {
	Page
	Q      string
	Folder uuid.UUID
	Filter string // all | mine | shared | route | archive
}

// visibleFolders are the folders the member sees: the ones with an own access, the ones on the path of a document
// the member opens and the ones on the path of a folder with an own access.
func (w *world) visibleFolders(m *member) map[uuid.UUID]bool {
	out := map[uuid.UUID]bool{}
	mark := func(f *folder) {
		for _, p := range w.path(f) {
			out[p.id] = true
		}
	}
	for _, f := range w.folders {
		if out[f.id] {
			continue
		}
		if w.accessToFolder(m, f).level > 0 {
			mark(f)
		}
	}
	for _, d := range w.docs {
		if f := w.folders[d.folder]; f != nil && !out[f.id] && w.accessToDoc(m, d).level > 0 {
			mark(f)
		}
	}
	return out
}

// Folders lists the folders the member sees (listDocFolders), as the tree reads: by path.
func (s *Service) Folders(ctx context.Context, tc tenantctx.TenantContext) (dapi.DocFolderList, error) {
	out := dapi.DocFolderList{Items: []dapi.DocFolder{}}
	err := s.run(ctx, tc, false, func(r *req) error {
		vis := r.w.visibleFolders(r.me)
		for _, f := range r.w.sortedFolders() {
			if vis[f.id] {
				out.Items = append(out.Items, r.folderDTO(f, r.w.accessToFolder(r.me, f)))
			}
		}
		return nil
	})
	return out, err
}

// sortedFolders are the folders ordered by the path label.
func (w *world) sortedFolders() []*folder {
	out := make([]*folder, 0, len(w.folders))
	for _, f := range w.folders {
		out = append(out, f)
	}
	labels := map[uuid.UUID]string{}
	for _, f := range out {
		labels[f.id] = strings.ToLower(w.label(f))
	}
	sortBy(out, func(a, b *folder) int {
		if c := strings.Compare(labels[a.id], labels[b.id]); c != 0 {
			return c
		}
		return strings.Compare(a.id.String(), b.id.String())
	})
	return out
}

// matchOCR returns the documents whose text layer holds q (the words of the recognition).
func (r *req) matchOCR(ctx context.Context, q string) (map[uuid.UUID]bool, error) {
	rows, err := r.tx.Query(ctx, `select distinct document_id from docs.ocr_words where text ilike '%' || $1 || '%' escape '\'`, likeEscape(q))
	if err != nil {
		return nil, fmt.Errorf("docs: search: %w", err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return nil, fmt.Errorf("docs: search: %w", err)
	}
	out := make(map[uuid.UUID]bool, len(ids))
	for _, id := range ids {
		out[id] = true
	}
	return out, nil
}

// likeEscape escapes the wildcards of a LIKE pattern.
func likeEscape(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

// Documents lists the documents the member opens (listDocuments): the filters «Все», «Мои», «Поделились со мной» and
// «На маршруте» with their counters, the search by the title and the text layer of scans.
func (s *Service) Documents(ctx context.Context, tc tenantctx.TenantContext, q ListQuery) (dapi.DocumentList, error) {
	out := dapi.DocumentList{Items: []dapi.DocSummary{}}
	err := s.run(ctx, tc, false, func(r *req) error {
		if q.Folder != uuid.Nil && r.w.folders[q.Folder] == nil {
			return notFound(textFolderNotFound)
		}
		var scan map[uuid.UUID]bool
		needle := strings.TrimSpace(q.Q)
		if needle != "" {
			var err error
			if scan, err = r.matchOCR(ctx, needle); err != nil {
				return err
			}
		}
		picked, rts := r.pickDocs(q, needle, scan, &out)
		ids := make([]uuid.UUID, len(picked))
		for i, d := range picked {
			ids[i] = d.id
		}
		from, to, next, err := paginate(ids, q.Page)
		if err != nil {
			return err
		}
		for i := from; i < to; i++ {
			out.Items = append(out.Items, r.summary(picked[i], rts[i]))
		}
		out.NextCursor = next
		return nil
	})
	return out, err
}

// pickDocs walks the documents the member opens, counts them for the chips and picks the ones the query asks for.
func (r *req) pickDocs(q ListQuery, needle string, scan map[uuid.UUID]bool, out *dapi.DocumentList) ([]*document, []rights) {
	var picked []*document
	var rts []rights
	for _, d := range r.w.sortedDocs() {
		rt := r.w.rightsFor(r.me, d)
		if !rt.view {
			continue
		}
		countDoc(d, r.me.id, &out.Counts)
		if !pickDoc(d, r.me.id, q.Filter) || (q.Folder != uuid.Nil && !r.w.inFolder(d.folder, q.Folder)) {
			continue
		}
		if needle != "" && !strings.Contains(strings.ToLower(d.title), strings.ToLower(needle)) && !scan[d.id] {
			continue
		}
		picked, rts = append(picked, d), append(rts, rt)
	}
	return picked, rts
}

// countDoc adds a live document to the counters of the chips «Все», «Мои», «Поделились со мной», «На маршруте».
func countDoc(d *document, me uuid.UUID, c *struct {
	All    int64 `json:"all"`
	Mine   int64 `json:"mine"`
	Route  int64 `json:"route"`
	Shared int64 `json:"shared"`
}) {
	if d.status == statusArchived {
		return
	}
	c.All++
	if d.owner == me {
		c.Mine++
	} else {
		c.Shared++
	}
	if d.status == statusInRoute || d.status == statusReturned {
		c.Route++
	}
}

// pickDoc is the filter of the list (docsView).
func pickDoc(d *document, me uuid.UUID, filter string) bool {
	archived := d.status == statusArchived
	switch filter {
	case "archive":
		return archived
	case "mine":
		return !archived && d.owner == me
	case "shared":
		return !archived && d.owner != me
	case "route":
		return !archived && (d.status == statusInRoute || d.status == statusReturned)
	}
	return !archived
}

// Document is the card of a document (getDocument); the finance document of the function «Водитель» is 403.
func (s *Service) Document(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (dapi.Document, error) {
	var out dapi.Document
	err := s.runOn(ctx, tc, false, onDoc(id), func(r *req) error {
		d, rt, err := r.doc(id)
		if err != nil {
			return err
		}
		out, err = r.document(ctx, d, rt)
		return err
	})
	return out, err
}

// Versions lists the versions, newest first (listDocVersions); a temporary access of a route sees the approved one.
func (s *Service) Versions(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (dapi.DocVersionList, error) {
	out := dapi.DocVersionList{Items: []dapi.DocVersion{}}
	err := s.runOn(ctx, tc, false, onDoc(id), func(r *req) error {
		_, rt, err := r.doc(id)
		if err != nil {
			return err
		}
		rows, err := r.tx.Query(ctx, `select `+versionCols+` from docs.versions where document_id = $1 order by number desc`, id)
		if err != nil {
			return fmt.Errorf("docs: versions: %w", err)
		}
		vs, err := pgx.CollectRows(rows, func(x pgx.CollectableRow) (versionRow, error) { return scanVersion(x) })
		if err != nil {
			return fmt.Errorf("docs: versions: %w", err)
		}
		for _, v := range vs {
			if rt.onlyVersion > 0 && v.number != rt.onlyVersion {
				continue
			}
			out.Items = append(out.Items, r.versionDTO(v))
		}
		return nil
	})
	return out, err
}

// Comments lists the comments with their replies (listDocComments); a temporary access of a route sees none.
func (s *Service) Comments(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (dapi.DocCommentList, error) {
	out := dapi.DocCommentList{Items: []dapi.DocComment{}}
	err := s.runOn(ctx, tc, false, onDoc(id), func(r *req) error {
		_, rt, err := r.doc(id)
		if err != nil {
			return err
		}
		if rt.onlyVersion > 0 {
			return nil
		}
		items, err := r.comments(ctx, id, uuid.Nil)
		out.Items = items
		return err
	})
	return out, err
}

// comments reads the comments of a document (or only the comment one) with their replies.
func (r *req) comments(ctx context.Context, doc, one uuid.UUID) ([]dapi.DocComment, error) {
	rows, err := r.tx.Query(ctx, `select id, author_id, text, anchor, mention, resolved, coalesce(resolved_by, `+nilUUID+`), created_at
		from docs.comments where document_id = $1 and ($2::uuid is null or id = $2) order by created_at, id`, doc, nullID(one))
	if err != nil {
		return nil, fmt.Errorf("docs: comments: %w", err)
	}
	type commentRow struct {
		id, author, resolver uuid.UUID
		text                 string
		anchor               []byte
		mention              []uuid.UUID
		resolved             bool
		created              time.Time
	}
	cs, err := pgx.CollectRows(rows, func(x pgx.CollectableRow) (commentRow, error) {
		var c commentRow
		return c, x.Scan(&c.id, &c.author, &c.text, &c.anchor, &c.mention, &c.resolved, &c.resolver, &c.created)
	})
	if err != nil {
		return nil, fmt.Errorf("docs: comments: %w", err)
	}
	reps, err := r.replies(ctx, doc)
	if err != nil {
		return nil, err
	}
	out := make([]dapi.DocComment, 0, len(cs))
	for _, c := range cs {
		x := dapi.DocComment{Id: c.id, Author: r.memberRef(c.author), Text: c.text, Resolved: c.resolved, CreatedAt: instant(c.created),
			Replies: reps[c.id]}
		if x.Replies == nil {
			x.Replies = []dapi.DocReply{}
		}
		if a := decodeObject[commentAnchor](c.anchor); a != nil {
			x.Anchor.Kind, x.Anchor.Ref, x.Anchor.Quote = dapi.DocCommentAnchorKind(a.Kind), a.Ref, a.Quote
		}
		if len(c.mention) > 0 {
			m := r.memberRef(c.mention[0])
			x.Mention = &m
		}
		if c.resolver != uuid.Nil {
			m := r.memberRef(c.resolver)
			x.ResolvedBy = &m
		}
		out = append(out, x)
	}
	return out, nil
}

// commentAnchor is the stored anchor of a comment.
type commentAnchor struct {
	Kind  string  `json:"kind"`
	Ref   string  `json:"ref"`
	Quote *string `json:"quote,omitempty"`
}

// replies reads the replies of the comments of a document by the comment.
func (r *req) replies(ctx context.Context, doc uuid.UUID) (map[uuid.UUID][]dapi.DocReply, error) {
	rows, err := r.tx.Query(ctx, `select p.comment_id, p.id, p.author_id, p.text, p.created_at from docs.replies p
		join docs.comments c on c.id = p.comment_id where c.document_id = $1 order by p.created_at, p.id`, doc)
	if err != nil {
		return nil, fmt.Errorf("docs: replies: %w", err)
	}
	defer rows.Close()
	out := map[uuid.UUID][]dapi.DocReply{}
	for rows.Next() {
		var (
			cid    uuid.UUID
			rep    dapi.DocReply
			author uuid.UUID
		)
		if err := rows.Scan(&cid, &rep.Id, &author, &rep.Text, &rep.At); err != nil {
			return nil, fmt.Errorf("docs: replies: %w", err)
		}
		rep.Author, rep.At = r.memberRef(author), instant(rep.At)
		out[cid] = append(out[cid], rep)
	}
	return out, rows.Err()
}

// shares is the access list of a document with the mode and the revision (getDocShares).
func (r *req) shares(d *document) dapi.DocShares {
	return dapi.DocShares{Mode: dapi.DocSharesMode(d.mode), Revision: int64(d.revision), Entries: r.shareEntries(d.id)}
}

// Shares reads the access list of a document (getDocShares); a temporary access of a route does not see it.
func (s *Service) Shares(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (dapi.DocShares, error) {
	var out dapi.DocShares
	err := s.runOn(ctx, tc, false, onDoc(id), func(r *req) error {
		d, rt, err := r.doc(id)
		if err != nil {
			return err
		}
		if rt.onlyVersion > 0 || !rt.share {
			return forbidden(textNeedShare)
		}
		out = r.shares(d)
		return nil
	})
	return out, err
}

// Activity is the journal of a document (listDocActivity): the audit entries of the document, newest first.
func (s *Service) Activity(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, p Page) (dapi.DocActivityList, error) {
	out := dapi.DocActivityList{Items: []dapi.DocActivity{}}
	err := s.runOn(ctx, tc, false, onDoc(id), func(r *req) error {
		_, rt, err := r.doc(id)
		if err != nil {
			return err
		}
		if rt.onlyVersion > 0 {
			return forbidden(textNeedShare)
		}
		rows, err := r.tx.Query(ctx, `select id, coalesce(actor_id, `+nilUUID+`), action, coalesce(diff->>'details', ''), at
			from audit.events where target_type = 'docs.document' and target_id = $1 order by at desc, id desc`, id)
		if err != nil {
			return fmt.Errorf("docs: activity: %w", err)
		}
		type row struct {
			id      int64
			actor   uuid.UUID
			action  string
			details string
			at      time.Time
		}
		items, err := pgx.CollectRows(rows, func(x pgx.CollectableRow) (row, error) {
			var a row
			return a, x.Scan(&a.id, &a.actor, &a.action, &a.details, &a.at)
		})
		if err != nil {
			return fmt.Errorf("docs: activity: %w", err)
		}
		limit := defaultLimit
		if p.Limit != nil {
			limit = min(max(*p.Limit, 1), maxLimit)
		}
		from := 0
		if p.Cursor != nil && *p.Cursor != "" {
			n, ok := parseOffset(*p.Cursor)
			if !ok {
				return problem.New(problem.CodeMalformedRequest, "")
			}
			from = n
		}
		to := min(from+limit, len(items))
		for i := min(from, len(items)); i < to; i++ {
			a := items[i]
			out.Items = append(out.Items, dapi.DocActivity{Id: activityID(a.id), Action: a.action, Details: a.details, At: instant(a.at),
				By: r.memberRef(a.actor)})
		}
		if to < len(items) {
			c := offsetCursor(to)
			out.NextCursor = &c
		}
		return nil
	})
	return out, err
}

// ListLinks lists the external links of a document with their openings (listDocLinks).
func (s *Service) ListLinks(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (dapi.DocExternalLinkList, error) {
	out := dapi.DocExternalLinkList{Items: []dapi.DocExternalLink{}}
	err := s.runOn(ctx, tc, false, onDoc(id), func(r *req) error {
		_, rt, err := r.doc(id)
		if err != nil {
			return err
		}
		if !rt.shareExternal {
			return forbidden(textExternalOwner)
		}
		items, err := r.links(ctx, id, uuid.Nil)
		out.Items = items
		return err
	})
	return out, err
}

// Templates lists the templates of documents (listDocTemplates) the member may create from: the ones of the folders it
// sees.
func (s *Service) Templates(ctx context.Context, tc tenantctx.TenantContext) (dapi.DocTemplateList, error) {
	out := dapi.DocTemplateList{Items: []dapi.DocTemplate{}}
	err := s.run(ctx, tc, false, func(r *req) error {
		rows, err := r.tx.Query(ctx, `select id, name, kind, icon, hint, link, folder_id, fields from docs.templates order by name, id`)
		if err != nil {
			return fmt.Errorf("docs: templates: %w", err)
		}
		type row struct {
			t      dapi.DocTemplate
			link   *string
			fields []byte
		}
		items, err := pgx.CollectRows(rows, func(x pgx.CollectableRow) (row, error) {
			var a row
			return a, x.Scan(&a.t.Id, &a.t.Name, &a.t.Kind, &a.t.Icon, &a.t.Hint, &a.link, &a.t.FolderId, &a.fields)
		})
		if err != nil {
			return fmt.Errorf("docs: templates: %w", err)
		}
		vis := r.w.visibleFolders(r.me)
		for _, a := range items {
			if !vis[a.t.FolderId] {
				continue
			}
			if a.link != nil {
				l := dapi.DocTemplateLink(*a.link)
				a.t.Link = &l
			}
			a.t.Fields = decodeList[dapi.DocField](a.fields)
			out.Items = append(out.Items, a.t)
		}
		return nil
	})
	return out, err
}

// RouteTemplates lists the route templates of the folders the member sees (listDocRouteTemplates).
func (s *Service) RouteTemplates(ctx context.Context, tc tenantctx.TenantContext) (dapi.DocRouteTemplateList, error) {
	out := dapi.DocRouteTemplateList{Items: []dapi.DocRouteTemplate{}}
	err := s.run(ctx, tc, false, func(r *req) error {
		rows, err := r.tx.Query(ctx, `select id, folder_id, name, project_id, steps, rules from docs.route_templates order by name, id`)
		if err != nil {
			return fmt.Errorf("docs: route templates: %w", err)
		}
		type row struct {
			t     dapi.DocRouteTemplate
			steps []byte
			rules []byte
		}
		items, err := pgx.CollectRows(rows, func(x pgx.CollectableRow) (row, error) {
			var a row
			return a, x.Scan(&a.t.Id, &a.t.FolderId, &a.t.Name, &a.t.ProjectId, &a.steps, &a.rules)
		})
		if err != nil {
			return fmt.Errorf("docs: route templates: %w", err)
		}
		vis := r.w.visibleFolders(r.me)
		for _, a := range items {
			if !vis[a.t.FolderId] {
				continue
			}
			a.t.Steps = decodeList[dapi.DocRouteStepInput](a.steps)
			if rl := decodeObject[map[string]bool](a.rules); rl != nil {
				a.t.Rules.CommentOnBack, a.t.Rules.Escalate, a.t.Rules.Lock, a.t.Rules.NotAuthor =
					(*rl)["commentOnBack"], (*rl)["escalate"], (*rl)["lock"], (*rl)["notAuthor"]
			}
			out.Items = append(out.Items, a.t)
		}
		return nil
	})
	return out, err
}

// Job reads a job of a document the member opens (getDocJob).
func (s *Service) Job(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (dapi.DocJob, error) {
	var out dapi.DocJob
	err := s.runOn(ctx, tc, false, onJob(id), func(r *req) error {
		j, err := r.job(ctx, id)
		if err != nil {
			return err
		}
		out = jobDTO(j)
		return nil
	})
	return out, err
}

// job reads a job whose documents the member opens (every one of them): another answer is 404.
func (r *req) job(ctx context.Context, id uuid.UUID) (jobRow, error) {
	j, err := scanJob(r.tx.QueryRow(ctx, `select `+jobCols+` from docs.jobs where id = $1`, id))
	if err != nil {
		return jobRow{}, notFound(textJobNotFound)
	}
	for _, d := range j.docs {
		doc := r.w.docs[d]
		if doc == nil || !r.w.rightsFor(r.me, doc).view {
			return jobRow{}, notFound(textJobNotFound)
		}
	}
	return j, nil
}
