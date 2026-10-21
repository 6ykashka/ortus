package knowledge

import (
	"context"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	kapi "github.com/ortus/ortus-crm/backend/internal/api/knowledge"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// nextPos is the position after the children of parent in sp (the archive included).
func (w *world) nextPos(sp, parent uuid.UUID) int {
	p := 0
	for _, n := range w.kids(sp, parent, true) {
		p = max(p, n.pos)
	}
	return p + 1
}

// canEditNode requires the right to edit n («Нет права править «{title}»»).
func (r *req) canEditNode(n *node) error {
	if !r.acc(n).edit {
		return forbidden("Нет права править «" + n.title + "»")
	}
	return nil
}

// CreateNode creates a page, a folder or a diagram in a space (createKnowledgeNode).
func (s *Service) CreateNode(ctx context.Context, tc tenantctx.TenantContext, spaceID uuid.UUID, b kapi.KnowledgeNodeCreate) (kapi.KnowledgeNode, error) {
	var out kapi.KnowledgeNode
	err := s.runOn(ctx, tc, true, onSpace(spaceID), func(r *req) error {
		sp, err := r.space(spaceID)
		if err != nil {
			return err
		}
		var parent *node
		if b.ParentId != nil {
			if parent, err = r.node(*b.ParentId); err != nil {
				return err
			}
		}
		n, err := r.createNode(sp, parent, string(b.Kind), b.Title)
		if err != nil {
			return err
		}
		if err := r.wr.node(ctx, n); err != nil {
			return err
		}
		r.w.nodes[n.id] = n
		if _, err := r.publish(ctx, "kb.node.created", aggNode, n.id, map[string]any{"spaceId": sp.id, "kind": n.kind}); err != nil {
			return err
		}
		out = r.nodeDTO(n)
		return nil
	})
	return out, err
}

// createNode checks and makes a node of kind in sp under parent (nil — the top level): the parent of the same space,
// the right to create, six levels at most (KB-06); a folder is active, a page and a diagram — drafts.
func (r *req) createNode(sp *space, parent *node, kind, title string) (*node, error) {
	t, err := titleOf(title)
	if err != nil {
		return nil, err
	}
	if kind != kindPage && kind != kindFolder && kind != kindDiagram {
		return nil, failed("Выберите тип: страница, папка или схема")
	}
	status := statusDraft
	if kind == kindFolder {
		status = statusActive
	}
	n := r.newNode(sp, kind, t, "", status)
	if parent != nil {
		switch {
		case parent.space != sp.id:
			return nil, failed("Родитель — из другого пространства")
		case !r.acc(parent).create:
			return nil, forbidden("Нет права создавать страницы внутри «" + parent.title + "»")
		case parent.depth+1 > maxDepth:
			return nil, failed(textDepth)
		}
		n.parent, n.depth = parent.id, parent.depth+1
	} else if !r.w.spaceMy(r.me, sp).create {
		return nil, forbidden("Нет права создавать страницы в пространстве")
	}
	n.pos = r.w.nextPos(sp.id, n.parent)
	if kind == kindDiagram {
		n.diagram = &diagram{Steps: []string{"Начало", "Шаг", "Готово"}, Outcomes: []outcome{}}
	}
	return n, nil
}

// textConflict is the answer to a stale If-Match of a version.
func textConflict(v int) string {
	return "Страницу уже изменили (v" + strconv.Itoa(v) + "). Обновите и повторите правку."
}

// Publish publishes a new version of a node (publishKnowledgeNodeVersion).
func (s *Service) Publish(ctx context.Context, tc tenantctx.TenantContext, nodeID uuid.UUID, ifMatch string, b kapi.KnowledgePublish) (kapi.KnowledgePublishResult, error) {
	var out kapi.KnowledgePublishResult
	err := s.runOn(ctx, tc, true, onNode(nodeID), func(r *req) error {
		n, err := r.node(nodeID)
		if err != nil {
			return err
		}
		if err := r.canEditNode(n); err != nil {
			return err
		}
		if ifMatch != etag(int64(n.last().v)) {
			return problem.New(codeConflict, textConflict(n.last().v))
		}
		if b.Steps != nil && n.kind != kindDiagram {
			return invalid("steps", "Шаги — только у схемы")
		}
		p := publication{body: b.Body, ack: b.RequestAck != nil && *b.RequestAck}
		if b.Title != nil {
			p.title = *b.Title
		}
		if b.Steps != nil {
			p.steps = *b.Steps
		}
		v, asked, err := r.publishVersion(ctx, n, p)
		if err != nil {
			return err
		}
		out = kapi.KnowledgePublishResult{Node: r.nodeDTO(n), Version: v, AckRequestedCount: asked}
		return nil
	})
	return out, err
}

// publication is a new version of a node: the text, the title ("" — the current one), the steps of a diagram and
// the request to acknowledge it.
type publication struct {
	body, title string
	steps       []string
	ack         bool
}

// publishVersion writes version N+1 of n (kbPublish): the text at most 20 000 characters, the title 2–120, up to 8
// steps of a diagram; a draft or an outdated node becomes active; a request to acknowledge moves the acknowledgement
// to the new version and asks its audience (the rule ack of the space writes a line of the journal).
func (r *req) publishVersion(ctx context.Context, n *node, p publication) (int, int, error) {
	if err := prepare(n, p); err != nil {
		return 0, 0, err
	}
	v := version{v: n.last().v + 1, at: r.now, by: r.me.id, author: r.me.name, body: p.body}
	if err := r.wr.version(ctx, n, v); err != nil {
		if unique(err, "versions_pkey") {
			return 0, 0, problem.New(codeConflict, textConflict(n.last().v+1))
		}
		return 0, 0, err
	}
	n.versions = append(n.versions, v)
	if n.status == statusDraft || n.status == statusOutdated {
		n.status = statusActive
	}
	if err := r.saveNode(ctx, n); err != nil {
		return 0, 0, err
	}
	ev, err := r.publish(ctx, "kb.node.published", aggNode, n.id, map[string]any{"version": v.v})
	if err != nil {
		return 0, 0, err
	}
	asked := 0
	if p.ack && n.ack != nil {
		if asked, err = r.askAck(ctx, n, ev); err != nil {
			return 0, 0, err
		}
	}
	return v.v, asked, nil
}

// prepare checks the text and the title of a publication and sets the title and the steps of n.
func prepare(n *node, p publication) error {
	if utf8.RuneCountInString(p.body) > maxBody {
		return failed("Текст — не длиннее 20 000 символов")
	}
	title := p.title
	if title == "" {
		title = n.title
	}
	t, err := titleOf(title)
	if err != nil {
		return err
	}
	n.title = t
	if n.kind == kindDiagram && p.steps != nil {
		if n.diagram == nil {
			n.diagram = &diagram{Outcomes: []outcome{}}
		}
		n.diagram.Steps = cleanSteps(p.steps)
	}
	return nil
}

// cleanSteps are the non-empty trimmed steps, eight at most.
func cleanSteps(steps []string) []string {
	out := []string{}
	for _, s := range steps {
		if t := strings.TrimSpace(s); t != "" && len(out) < 8 {
			out = append(out, t)
		}
	}
	return out
}

// saveNode writes the title, the status and the diagram of n.
func (r *req) saveNode(ctx context.Context, n *node) error {
	d, err := jsonOf(n.diagram)
	if err != nil {
		return err
	}
	return r.wr.exec(ctx, "node", `update kb.nodes set title = $2, status = $3, diagram = $4::jsonb, updated_at = $5 where id = $1`,
		n.id, n.title, n.status, d, r.now)
}

// askAck moves the acknowledgement of n to its current version, notifies its audience and logs the rule ack.
func (r *req) askAck(ctx context.Context, n *node, ev uuid.UUID) (int, error) {
	n.ack.v = n.last().v
	if err := r.wr.ack(ctx, n); err != nil {
		return 0, err
	}
	who := r.w.audience(n)
	ids := make([]uuid.UUID, 0, len(who))
	for _, m := range who {
		ids = append(ids, m.id)
	}
	title := "Новая версия «" + n.title + "» v" + strconv.Itoa(n.ack.v) + " — подтвердите, что ознакомились"
	if err := r.notify(ctx, "kb.ack.requested", title, n.id, ev, ids); err != nil {
		return 0, err
	}
	if x := r.w.ruleOn(n.space, ruleAck); x != nil {
		text := "«" + n.title + "» v" + strconv.Itoa(n.ack.v) + ": попросили ознакомиться — " + strconv.Itoa(len(who)) + " чел."
		if err := r.logRun(ctx, n.space, x, "ok", text, 0); err != nil {
			return 0, err
		}
	}
	return len(who), nil
}

// ruleOn is the rule of kind of space sp that is on (nil — none).
func (w *world) ruleOn(sp uuid.UUID, kind string) *rule {
	for _, x := range w.rules {
		if x.space == sp && x.kind == kind && x.on {
			return x
		}
	}
	return nil
}

// logRun writes a line of the journal of runs of a rule and keeps the last 40 of the space; i orders the lines of
// one run (a later one is newer).
func (r *req) logRun(ctx context.Context, sp uuid.UUID, x *rule, res, text string, i int) error {
	line := run{id: uuid.New(), rule: x.id, at: r.now.Add(time.Duration(i) * time.Microsecond), res: res, text: clip(text, 500)}
	if err := r.wr.run(ctx, sp, line); err != nil {
		return err
	}
	r.w.runs[sp] = append([]run{line}, r.w.runs[sp]...)
	return r.wr.exec(ctx, "runs", `delete from kb.runs where space_id = $1 and id not in
		(select id from kb.runs where space_id = $1 order by ran_at desc, id desc limit $2)`, sp, runsKept)
}

// SetStatus approves a node or changes its status (setKnowledgeNodeStatus).
func (s *Service) SetStatus(ctx context.Context, tc tenantctx.TenantContext, nodeID uuid.UUID, status string) (kapi.KnowledgeNode, error) {
	var out kapi.KnowledgeNode
	err := s.runOn(ctx, tc, true, onNode(nodeID), func(r *req) error {
		n, err := r.node(nodeID)
		if err != nil {
			return err
		}
		if err := r.setStatus(ctx, n, status); err != nil {
			return err
		}
		out = r.nodeDTO(n)
		return nil
	})
	return out, err
}

func (r *req) setStatus(ctx context.Context, n *node, status string) error {
	if err := r.canEditNode(n); err != nil {
		return err
	}
	switch status {
	case statusActive, statusDraft, statusReview, statusOutdated:
	default:
		return failed("Неизвестный статус")
	}
	n.status = status
	if err := r.saveNode(ctx, n); err != nil {
		return err
	}
	_, err := r.publish(ctx, "kb.node.status_changed", aggNode, n.id, map[string]any{"status": status})
	return err
}

// SetArchived moves a branch to the archive or restores it (archiveKnowledgeNode, restoreKnowledgeNode): an editor
// or the lead of the space; the home page is not archived.
func (s *Service) SetArchived(ctx context.Context, tc tenantctx.TenantContext, nodeID uuid.UUID, on bool) (kapi.KnowledgeArchiveResult, error) {
	var out kapi.KnowledgeArchiveResult
	err := s.runOn(ctx, tc, true, onNode(nodeID), func(r *req) error {
		n, err := r.node(nodeID)
		if err != nil {
			return err
		}
		if err := r.archive(ctx, n, on); err != nil {
			return err
		}
		out = kapi.KnowledgeArchiveResult{NodeId: n.id, Archived: on, Pages: len(r.w.subtree(n, true))}
		return nil
	})
	return out, err
}

func (r *req) archive(ctx context.Context, n *node, on bool) error {
	if my := r.w.spaceMy(r.me, r.w.spaceOf(n)); !my.lead && !my.edit {
		return forbidden(textArchiveRight)
	}
	if on && n.home {
		return failed("Главную страницу пространства архивировать нельзя")
	}
	branch := r.w.subtree(n, true)
	ids := make([]uuid.UUID, 0, len(branch))
	for _, x := range branch {
		x.archived = on
		ids = append(ids, x.id)
	}
	var at, by any
	if on {
		at, by = r.now, r.me.id
	}
	if err := r.wr.exec(ctx, "archive", `update kb.nodes set archived_at = $2, archived_by = $3, updated_at = $4 where id = any($1)`,
		ids, at, by, r.now); err != nil {
		return err
	}
	_, err := r.publish(ctx, "kb.node.archived", aggNode, n.id, map[string]any{"archived": on, "pages": len(ids)})
	return err
}

// Ack confirms reading the current version of a node (ackKnowledgeNode, KB-03: the log is kept 5 years).
func (s *Service) Ack(ctx context.Context, tc tenantctx.TenantContext, nodeID uuid.UUID, v int) (kapi.KnowledgeAck, error) {
	var out kapi.KnowledgeAck
	err := s.runOn(ctx, tc, true, onNode(nodeID), func(r *req) error {
		n, err := r.node(nodeID)
		if err != nil {
			return err
		}
		if n.ack == nil || n.ack.v != v {
			return invalid("version", "Ознакомление со страницей не запрошено")
		}
		if !containsMember(r.w.audience(n), r.me) {
			return failed("Ознакомление запрошено у другой роли")
		}
		if !n.ack.done(r.me.id) {
			l := ackLog{member: r.me.id, v: n.ack.v, at: r.now}
			if err := r.wr.ackLog(ctx, n.id, l); err != nil {
				return err
			}
			n.ack.log = append(n.ack.log, l)
			if err := r.wr.exec(ctx, "ack log", `delete from kb.ack_log where acked_at < $1`, r.now.AddDate(-ackYears, 0, 0)); err != nil {
				return err
			}
			if _, err := r.publish(ctx, "kb.ack.done", aggNode, n.id, map[string]any{"version": n.ack.v}); err != nil {
				return err
			}
		}
		out = *r.ackDTO(n)
		return nil
	})
	return out, err
}

func containsMember(ms []*member, m *member) bool {
	for _, x := range ms {
		if x.id == m.id {
			return true
		}
	}
	return false
}

// CreateTable creates a table on a page (createKnowledgeTable, the forms core).
func (s *Service) CreateTable(ctx context.Context, tc tenantctx.TenantContext, nodeID uuid.UUID, b kapi.KnowledgeTableCreate) (kapi.KnowledgeTable, error) {
	var out kapi.KnowledgeTable
	err := s.runOn(ctx, tc, true, onNode(nodeID), func(r *req) error {
		n, err := r.node(nodeID)
		if err != nil {
			return err
		}
		if err := r.canEditNode(n); err != nil {
			return err
		}
		t, err := r.newTable(n, b)
		if err != nil {
			return err
		}
		if err := r.wr.table(ctx, t, r.now); err != nil {
			return err
		}
		r.w.tables = append(r.w.tables, t)
		title := "На странице «" + n.title + "» создана таблица «" + t.title + "»"
		if err := r.notify(ctx, "kb.table.created", title, n.id, uuid.Nil, r.w.owners()); err != nil {
			return err
		}
		out = tableDTO(t)
		return nil
	})
	return out, err
}

// newTable checks the title and the columns of a table of n (createKbTable).
func (r *req) newTable(n *node, b kapi.KnowledgeTableCreate) (*table, error) {
	title := strings.TrimSpace(b.Title)
	if utf8.RuneCountInString(title) < titleMin {
		return nil, failed("Название таблицы — не короче 2 символов")
	}
	for _, t := range r.w.tables {
		if t.node == n.id && strings.EqualFold(t.title, title) {
			return nil, failed("На странице уже есть таблица «" + title + "»")
		}
	}
	if len(b.Columns) == 0 {
		return nil, failed("Добавьте хотя бы один столбец")
	}
	t := &table{id: uuid.New(), node: n.id, title: title}
	seen := map[string]bool{}
	for _, c := range b.Columns {
		name := strings.TrimSpace(c.Name)
		if name == "" {
			return nil, failed("У столбца нет названия")
		}
		if seen[strings.ToLower(name)] {
			return nil, failed("Названия столбцов повторяются")
		}
		seen[strings.ToLower(name)] = true
		typ := "text"
		if c.Type != nil && *c.Type != "" {
			typ = *c.Type
		}
		t.columns = append(t.columns, column{ID: uuid.New(), Name: name, Type: typ})
	}
	return t, nil
}
