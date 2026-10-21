package knowledge

import (
	"context"

	"github.com/google/uuid"

	kapi "github.com/ortus/ortus-crm/backend/internal/api/knowledge"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// SetRule switches a rule of automation on or off (setKnowledgeRuleEnabled): the lead of its space.
func (s *Service) SetRule(ctx context.Context, tc tenantctx.TenantContext, ruleID uuid.UUID, on bool) (kapi.KnowledgeRule, error) {
	var out kapi.KnowledgeRule
	err := s.runOn(ctx, tc, true, onRule(ruleID), func(r *req) error {
		x := r.w.ruleOf(ruleID)
		var sp *space
		if x != nil {
			sp = r.w.space[x.space]
		}
		if x == nil || sp == nil || !r.w.spaceVisible(r.me, sp) {
			return notFound(textRuleNotFound)
		}
		if err := r.lead(sp); err != nil {
			return err
		}
		if x.on != on {
			x.on = on
			if err := r.wr.exec(ctx, "rule", `update kb.rules set enabled = $2, enabled_by = $3, revision = revision + 1 where id = $1`,
				x.id, on, r.me.id); err != nil {
				return err
			}
		}
		out = r.ruleDTO(x)
		return nil
	})
	return out, err
}

func (w *world) ruleOf(id uuid.UUID) *rule {
	for _, x := range w.rules {
		if x.id == id {
			return x
		}
	}
	return nil
}

// ReviewCheck checks the review dates of a space now (runKnowledgeReviewCheck — «Проверить сроки сейчас»): the
// pages whose date has come become «Пора пересмотреть», their owners are notified, each gets a line of the journal.
func (s *Service) ReviewCheck(ctx context.Context, tc tenantctx.TenantContext, spaceID uuid.UUID) (kapi.KnowledgeRunReport, error) {
	var out kapi.KnowledgeRunReport
	err := s.runOn(ctx, tc, true, onSpace(spaceID), func(r *req) error {
		sp, err := r.leadSpace(spaceID)
		if err != nil {
			return err
		}
		x := r.w.ruleOn(sp.id, ruleReview)
		if x == nil {
			return failed("Правило «Пора пересмотреть» выключено")
		}
		count, err := r.reviewDue(ctx, sp, x)
		if err != nil {
			return err
		}
		out = kapi.KnowledgeRunReport{Count: count, Runs: r.newRuns(sp.id, max(count, 1))}
		return nil
	})
	return out, err
}

// reviewDue marks the due pages of sp outdated (KbCheckReview) and returns their number.
func (r *req) reviewDue(ctx context.Context, sp *space, x *rule) (int, error) {
	due := 0
	for _, n := range r.w.order(sp.id, false) {
		if n.reviewBy == nil || n.reviewBy.After(r.w.today) || n.status == statusOutdated {
			continue
		}
		n.status = statusOutdated
		if err := r.saveNode(ctx, n); err != nil {
			return 0, err
		}
		day := n.reviewBy.Format("02.01.2006")
		ev, err := r.publish(ctx, "kb.review.due", aggNode, n.id, map[string]any{"reviewBy": day})
		if err != nil {
			return 0, err
		}
		if err := r.notify(ctx, "kb.review.due", "Пора пересмотреть «"+n.title+"»: срок был "+day, n.id, ev, []uuid.UUID{n.owner}); err != nil {
			return 0, err
		}
		text := "«" + n.title + "»: срок пересмотра " + day + ", уведомлён владелец " + r.w.nameOf(n.owner)
		if err := r.logRun(ctx, sp.id, x, "ok", text, due); err != nil {
			return 0, err
		}
		due++
	}
	if due == 0 {
		return 0, r.logRun(ctx, sp.id, x, "stopped", "Остановлено условием: сроки пересмотра не наступили", 0)
	}
	return due, nil
}

// newRuns are the n newest lines of the journal of sp (the lines of this run), newest first.
func (r *req) newRuns(sp uuid.UUID, n int) []kapi.KnowledgeRun {
	out := []kapi.KnowledgeRun{}
	for i, x := range r.w.runs[sp] {
		if i == n {
			break
		}
		out = append(out, runDTO(x))
	}
	return out
}

// Section creates the section of an object of repairs (runKnowledgeSection — «Создать раздел»): a folder in the
// top folder «Объекты» read by the foreman of the object and edited by the editors, with five subpages.
func (s *Service) Section(ctx context.Context, tc tenantctx.TenantContext, spaceID, projectID uuid.UUID) (kapi.KnowledgeRunReport, error) {
	var out kapi.KnowledgeRunReport
	err := s.runOn(ctx, tc, true, onSpace(spaceID), func(r *req) error {
		sp, err := r.leadSpace(spaceID)
		if err != nil {
			return err
		}
		o, ok := r.w.objects[projectID]
		if !ok {
			return notFound("Объект не найден")
		}
		x := r.w.ruleOn(sp.id, ruleSection)
		if x == nil {
			return invalid("projectId", "Правило выключено")
		}
		if f := r.w.sectionOf(sp.id, o.ID); f != nil {
			out = kapi.KnowledgeRunReport{Created: new(false), NodeId: new(f.id)}
			if err := r.logRun(ctx, sp.id, x, "stopped", o.Name+": остановлено условием — раздел уже есть", 0); err != nil {
				return err
			}
			out.Runs = r.newRuns(sp.id, 1)
			return nil
		}
		f, err := r.makeSection(ctx, sp, x, o)
		if err != nil {
			return err
		}
		out = kapi.KnowledgeRunReport{Count: 1, Created: new(true), NodeId: new(f.id), Runs: r.newRuns(sp.id, 1)}
		return nil
	})
	return out, err
}

// sectionNodes are the folder of the section of o in folder and its five subpages: the foreman reads the folder and
// edits «Как попасть на объект» and «Фотоотчёт», the editors edit everything, «Гарантия» is theirs only.
func (r *req) sectionNodes(sp *space, folder *node, o RepairObject, editors entry) []*node {
	rel := func(can string) entry { return entry{who: whoRelation, obj: o.ID, can: can} }
	f := r.newNode(sp, kindFolder, clip(o.Name, titleMax), "", statusActive)
	f.parent, f.depth, f.pos, f.obj = folder.id, folder.depth+1, len(r.w.kids(sp.id, folder.id, true))+1, o.ID
	f.mode, f.list = modeListed, []entry{rel(canView), editors}
	nodes := []*node{f}
	for i, p := range sectionPages {
		n := r.newNode(sp, p.kind, p.title, sectionBody(i, o), statusActive)
		n.parent, n.depth, n.pos, n.mode = f.id, f.depth+1, i+1, p.mode
		switch p.mode {
		case modeEdit:
			n.list = []entry{rel(canEdit), editors}
		case modeListed:
			n.list = []entry{editors}
		}
		nodes = append(nodes, n)
	}
	return nodes
}

// makeSection writes the section of o (makeSection of the domain) and the line of the journal.
func (r *req) makeSection(ctx context.Context, sp *space, x *rule, o RepairObject) (*node, error) {
	var folder *node
	for _, n := range r.w.kids(sp.id, uuid.Nil, false) {
		if n.kind == kindFolder && n.title == sectionFolder {
			folder = n
			break
		}
	}
	if folder == nil {
		return nil, failed("В пространстве нет папки «Объекты»")
	}
	editors, err := r.editors(ctx)
	if err != nil {
		return nil, err
	}
	nodes := r.sectionNodes(sp, folder, o, editors)
	f := nodes[0]
	for _, n := range nodes {
		if err := r.wr.node(ctx, n); err != nil {
			return nil, err
		}
		r.w.nodes[n.id] = n
	}
	ev, err := r.publish(ctx, "kb.section.created", aggNode, f.id, map[string]any{"projectId": o.ID})
	if err != nil {
		return nil, err
	}
	foreman := r.w.foremanName(o)
	res, text := "ok", o.Name+": создан раздел и 5 подстраниц, доступ получил прораб "+foreman
	if foreman == "" {
		res, text = "warn", o.Name+": прораб не назначен — раздел создан, доступ пока у редакторов. Назначат прораба — он получит доступ сам"
	}
	if err := r.logRun(ctx, sp.id, x, res, text, 0); err != nil {
		return nil, err
	}
	return f, r.notify(ctx, "kb.section.created", "Создан раздел объекта «"+o.Name+"» в базе знаний", f.id, ev, []uuid.UUID{o.Foreman})
}
