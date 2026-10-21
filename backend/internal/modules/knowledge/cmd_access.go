package knowledge

import (
	"context"
	"encoding/json"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	kapi "github.com/ortus/ortus-crm/backend/internal/api/knowledge"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// ids are the ids of nodes.
func ids(ns []*node) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(ns))
	for _, n := range ns {
		out = append(out, n.id)
	}
	return out
}

// Move moves a node with its branch to another parent with the impact on reading (moveKnowledgeNode); dryRun moves
// nothing. The depth of the branch is recomputed in the same transaction (the composite FK of tenant 0024 is
// deferred).
func (s *Service) Move(ctx context.Context, tc tenantctx.TenantContext, nodeID uuid.UUID, b kapi.KnowledgeMove) (kapi.KnowledgeMoveResult, error) {
	var out kapi.KnowledgeMoveResult
	err := s.runOn(ctx, tc, true, onNode(nodeID), func(r *req) error {
		n, err := r.node(nodeID)
		if err != nil {
			return err
		}
		if n.home {
			return invalid("parentId", "Главную страницу пространства не переносят")
		}
		var parent *node
		if b.ParentId != nil {
			if parent, err = r.node(*b.ParentId); err != nil {
				return err
			}
		}
		moved := n.clone()
		moved.parent = uuid.Nil
		if parent != nil {
			moved.parent = parent.id
		}
		branch := ids(r.w.subtree(n, false))
		im := impactOf(r.w, r.w.with([]*node{moved}, nil), branch)
		out = kapi.KnowledgeMoveResult{Pages: len(branch), LoseView: people(im.loseView), GainView: people(im.gainView)}
		if err := r.checkMove(n, parent); err != nil {
			return err
		}
		if b.DryRun != nil && *b.DryRun {
			return nil
		}
		if err := r.move(ctx, n, parent); err != nil {
			return err
		}
		out.Applied, out.Node = true, new(r.nodeDTO(n))
		return nil
	})
	return out, err
}

// checkMove checks a move of n under parent (kbMove): the right to edit n, the same space, not into its own branch,
// the right to create in the parent, six levels at most.
func (r *req) checkMove(n, parent *node) error {
	if err := r.canEditNode(n); err != nil {
		return err
	}
	if parent == nil {
		return nil
	}
	switch {
	case parent.space != n.space:
		return failed("Переносить можно только внутри пространства")
	case slices.Contains(r.w.path(parent), n):
		return failed("Нельзя перенести страницу внутрь её же подстраницы")
	case !r.acc(parent).create:
		return forbidden("Нет права добавлять страницы в «" + parent.title + "»")
	case parent.depth+r.w.height(n) > maxDepth:
		return failed(textDepth)
	}
	return nil
}

// move writes n at the end of the children of parent and the new depth of its branch.
func (r *req) move(ctx context.Context, n, parent *node) error {
	newParent, depth := uuid.Nil, 1
	if parent != nil {
		newParent, depth = parent.id, parent.depth+1
	}
	delta := depth - n.depth
	branch := r.w.subtree(n, true)
	n.pos = r.w.nextPos(n.space, newParent)
	n.parent = newParent
	if err := r.wr.exec(ctx, "move", `update kb.nodes set parent_id = $2, position = $3, depth = $4, updated_at = $5 where id = $1`,
		n.id, nullID(newParent), n.pos, depth, r.now); err != nil {
		return err
	}
	for _, x := range branch {
		x.depth += delta
		if x.id == n.id || delta == 0 {
			continue
		}
		if err := r.wr.exec(ctx, "move", `update kb.nodes set depth = $2 where id = $1`, x.id, x.depth); err != nil {
			return err
		}
	}
	_, err := r.publish(ctx, "kb.node.moved", aggNode, n.id, map[string]any{"parentId": nullID(newParent)})
	return err
}

// SetAccess changes the access of a node with the impact (setKnowledgeNodeAccess): the lead of the space; dryRun
// changes nothing.
func (s *Service) SetAccess(ctx context.Context, tc tenantctx.TenantContext, nodeID uuid.UUID, ifMatch string, b kapi.KnowledgeAccessChange) (kapi.KnowledgeAccessImpact, error) {
	var out kapi.KnowledgeAccessImpact
	err := s.runOn(ctx, tc, true, onNode(nodeID), func(r *req) error {
		n, _, err := r.leadNode(nodeID)
		if err != nil {
			return err
		}
		if ifMatch != etag(n.accessRev) {
			return problem.New(codeConflict, "")
		}
		mode, list, err := r.accessOf(n, b)
		if err != nil {
			return err
		}
		applyOwn := b.ApplyToOwn != nil && *b.ApplyToOwn
		changed, own := r.changedAccess(n, mode, list, applyOwn)
		sub := r.w.subtree(n, false)
		im := impactOf(r.w, r.w.with(changed, nil), ids(sub))
		out = kapi.KnowledgeAccessImpact{Pages: len(sub), Own: own, GainView: people(im.gainView), LoseView: people(im.loseView),
			GainEdit: people(im.gainEdit), LoseEdit: people(im.loseEdit)}
		if b.DryRun != nil && *b.DryRun {
			return nil
		}
		if err := r.saveAccess(ctx, n, changed, mode, list); err != nil {
			return err
		}
		out.Applied, out.Access = true, new(r.accessDTO(n))
		return nil
	})
	return out, err
}

// accessOf checks the mode and the entries of a change of the access of n.
func (r *req) accessOf(n *node, b kapi.KnowledgeAccessChange) (string, []entry, error) {
	mode, ok := dbModes[string(b.Mode)]
	if !ok {
		return "", nil, failed("Выберите, кто видит страницу")
	}
	if mode == modeInherit {
		return mode, nil, nil
	}
	allowed := r.w.templateRelations(n)
	list := make([]entry, 0, len(b.Entries))
	for i, e := range b.Entries {
		x, err := r.entryIn(e, i)
		if err != nil {
			return "", nil, err
		}
		if x.who == whoRelation && !allowed[x.key()] {
			return "", nil, failed("Связь с записью CRM задаётся шаблоном раздела")
		}
		list = append(list, x)
	}
	return mode, list, nil
}

// entryIn is an entry of the contract checked against the organization.
func (r *req) entryIn(e kapi.KnowledgeAccessEntryInput, i int) (entry, error) {
	field := "entries[" + strconv.Itoa(i) + "]"
	bad := invalid(field, "Неверная запись в списке доступа")
	x := entry{who: string(e.Who), can: string(e.Can)}
	if x.can != canView && x.can != canEdit {
		return x, bad
	}
	switch x.who {
	case whoRelation:
		if e.Relation == nil || e.Object == nil {
			return x, bad
		}
		x.obj = e.Object.EntityId
		return x, nil
	case whoMember, whoGroup, whoRole:
	default:
		return x, bad
	}
	if e.RefId == nil {
		return x, bad
	}
	x.ref = *e.RefId
	if missing := r.w.missing(x); missing != "" {
		return x, invalid(field, missing)
	}
	if e.OrgUnitId != nil && x.who == whoRole {
		if r.w.units[*e.OrgUnitId] == nil {
			return x, invalid(field+".orgUnitId", "Подразделение не найдено")
		}
		x.unit = *e.OrgUnitId
	}
	return x, nil
}

// missing is the reason an entry names nobody of the organization ("" — it does).
func (w *world) missing(x entry) string {
	switch {
	case x.who == whoMember && w.member[x.ref] == nil:
		return "Сотрудник не найден"
	case x.who == whoGroup && w.groups[x.ref] == nil:
		return "Группа не найдена"
	case x.who == whoRole && w.roles[x.ref] == nil:
		return "Роль не найдена"
	}
	return ""
}

// templateRelations are the relations the template of a section gives n (KB-01): those already on its list and the
// relation «Прораб объекта» of the section n lies in — so it can be returned after «Как у родителя».
func (w *world) templateRelations(n *node) map[entryKey]bool {
	out := map[entryKey]bool{}
	for _, e := range n.list {
		if e.who == whoRelation {
			out[e.key()] = true
		}
	}
	if obj := w.sectionObject(n); obj != uuid.Nil {
		out[entry{who: whoRelation, obj: obj}.key()] = true
	}
	return out
}

// changedAccess is n with the new mode and list and, with applyOwn, its subnodes with own access set to «Как у
// родителя»; own — those subnodes.
func (r *req) changedAccess(n *node, mode string, list []entry, applyOwn bool) ([]*node, []kapi.KnowledgeNodeRef) {
	c := n.clone()
	c.mode, c.list = mode, list
	changed := []*node{c}
	own := []kapi.KnowledgeNodeRef{}
	for _, x := range r.w.subtree(n, false)[1:] {
		if !x.ownMode() {
			continue
		}
		own = append(own, kapi.KnowledgeNodeRef{Id: x.id, Title: x.title})
		if applyOwn {
			y := x.clone()
			y.mode, y.list = modeInherit, nil
			changed = append(changed, y)
		}
	}
	return changed, own
}

// saveAccess writes the changed nodes (the access revision + 1 each, if it did not change meanwhile), the history of
// n, the event and the audit.
func (r *req) saveAccess(ctx context.Context, n *node, changed []*node, mode string, list []entry) error {
	for _, c := range changed {
		tag, err := r.tx.Exec(ctx, `update kb.nodes set access_mode = $3, access_revision = access_revision + 1, updated_at = $4
			where id = $1 and access_revision = $2`, c.id, c.accessRev, modeToDB(c.mode), r.now)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return problem.New(codeConflict, "")
		}
		if err := r.wr.list(ctx, c); err != nil {
			return err
		}
		c.accessRev++
		r.w.nodes[c.id] = c
	}
	*n = *r.w.nodes[n.id]
	text := "Доступ: " + modeLabels[mode]
	if len(list) > 0 {
		parts := make([]string, 0, len(list))
		for _, e := range list {
			right := "читает"
			if e.can == canEdit {
				right = "правит"
			}
			parts = append(parts, r.w.entryLabel(e)+" — "+right)
		}
		text += " · " + strings.Join(parts, ", ")
	}
	entries, err := jsonOf(&list)
	if err != nil {
		return err
	}
	if err := r.wr.exec(ctx, "access history", `insert into kb.access_history (node_id, changed_by, changed_at, mode, entries, text)
		values ($1, $2, $3, $4, $5::jsonb, $6)`, n.id, r.me.id, r.now, modeToDB(mode), entries, clip(text, 2000)); err != nil {
		return err
	}
	diff := map[string]any{"mode": modeToDB(mode), "entries": len(list), "applyOwn": len(changed) - 1}
	if err := r.record(ctx, "knowledge.access.changed", aggNode, n.id, diff); err != nil {
		return err
	}
	_, err = r.publish(ctx, "kb.access.changed", aggNode, n.id, diff)
	return err
}

// MarshalJSON writes an entry of the access history (kb.access_history.entries).
func (e entry) MarshalJSON() ([]byte, error) {
	m := map[string]string{"who": e.who, "can": e.can}
	if e.ref != uuid.Nil {
		m["ref"] = e.ref.String()
	}
	if e.unit != uuid.Nil {
		m["unit"] = e.unit.String()
	}
	if e.obj != uuid.Nil {
		m["obj"] = e.obj.String()
	}
	return json.Marshal(m)
}

// Request asks for the right to edit a visible page (createKnowledgeAccessRequest).
func (s *Service) Request(ctx context.Context, tc tenantctx.TenantContext, nodeID uuid.UUID) (kapi.KnowledgeAccessRequest, error) {
	var out kapi.KnowledgeAccessRequest
	err := s.runOn(ctx, tc, true, onNode(nodeID), func(r *req) error {
		n, err := r.node(nodeID)
		if err != nil {
			return err
		}
		if n.kind == kindFolder || n.kind == kindLink {
			return invalid("can", "Право правки запрашивают у страницы")
		}
		if r.w.openRequest(n.id, r.me.id) != nil {
			return problem.New(codePending, "Запрос уже отправлен")
		}
		if r.acc(n).edit {
			return failed("Вы уже можете править страницу")
		}
		x := &request{id: uuid.New(), node: n.id, space: n.space, member: r.me.id, can: canEdit, status: requestOpen, at: r.now}
		if err := r.wr.exec(ctx, "request", `insert into kb.requests (id, node_id, space_id, member_id, can, status, requested_at)
			values ($1, $2, $3, $4, $5, 'open', $6)`, x.id, x.node, x.space, x.member, x.can, x.at); err != nil {
			if unique(err, "requests_open_uq") {
				return problem.New(codePending, "Запрос уже отправлен")
			}
			return err
		}
		r.w.requests = append([]*request{x}, r.w.requests...)
		ev, err := r.publish(ctx, "kb.request.created", aggRequest, x.id, map[string]any{"nodeId": n.id, "can": x.can})
		if err != nil {
			return err
		}
		to := append(ids(nil), r.w.owners()...)
		for _, m := range r.w.leads(r.w.spaceOf(n)) {
			to = append(to, m.id)
		}
		if err := r.notify(ctx, "kb.request.created", r.me.name+" просит право правки к «"+n.title+"»", n.id, ev, to); err != nil {
			return err
		}
		out = r.requestDTO(x)
		return nil
	})
	return out, err
}

// openRequest is the open request of member on node (nil — none).
func (w *world) openRequest(nodeID, memberID uuid.UUID) *request {
	for _, x := range w.requests {
		if x.node == nodeID && x.member == memberID && x.status == requestOpen {
			return x
		}
	}
	return nil
}

// Decide approves or denies an access request (decideKnowledgeAccessRequest): the lead of the space of the node.
func (s *Service) Decide(ctx context.Context, tc tenantctx.TenantContext, requestID uuid.UUID, approve bool) (kapi.KnowledgeAccessRequest, error) {
	var out kapi.KnowledgeAccessRequest
	err := s.runOn(ctx, tc, true, onRequest(requestID), func(r *req) error {
		x := r.w.requestOf(requestID)
		var sp *space
		if x != nil {
			sp = r.w.space[x.space]
		}
		if x == nil || x.status != requestOpen || sp == nil || !r.w.spaceVisible(r.me, sp) {
			return notFound(textRequestNotFound)
		}
		if err := r.lead(sp); err != nil {
			return err
		}
		if err := r.decide(ctx, x, approve); err != nil {
			return err
		}
		out = r.requestDTO(x)
		return nil
	})
	return out, err
}

func (w *world) requestOf(id uuid.UUID) *request {
	for _, x := range w.requests {
		if x.id == id {
			return x
		}
	}
	return nil
}

// decide writes the decision: approving a request to edit adds an entry «правит» of the member to the list of the
// node (a node «Как у родителя» becomes «Читают все, правят выбранные» with the editors of the space); approving a
// request to read gives the role «Читатель» of the page for 30 days (PD-60, Q-W4.00-knowledge-7). An approval is a
// change of access: a sensitive audit record (the access history of the node is not written — as the domain).
func (r *req) decide(ctx context.Context, x *request, approve bool) error {
	n := r.w.nodeOf(x.node)
	if n == nil {
		return notFound(textRequestNotFound)
	}
	// The request is locked before anything is granted: a decision taken meanwhile by another lead is waited for and
	// wins — this one answers as for a decided request.
	var open bool
	if err := r.tx.QueryRow(ctx, `select status = 'open' from kb.requests where id = $1 for update`, x.id).Scan(&open); err != nil {
		return err
	}
	if !open {
		return notFound(textRequestNotFound)
	}
	if approve {
		if err := r.approve(ctx, n, x); err != nil {
			return err
		}
	}
	x.status, x.decidedAt, x.decidedBy = requestDenied, &r.now, r.me.id
	verb := "Отклонён"
	if approve {
		x.status, verb = requestApproved, "Одобрен"
	}
	tag, err := r.tx.Exec(ctx, `update kb.requests set status = $2, decided_at = $3, decided_by = $4, until = $5
		where id = $1 and status = 'open'`, x.id, x.status, r.now, r.me.id, x.until)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return notFound(textRequestNotFound) // rolls back the grant
	}
	ev, err := r.publish(ctx, "kb.request.decided", aggRequest, x.id, map[string]any{"status": x.status})
	if err != nil {
		return err
	}
	return r.notify(ctx, "kb.request.decided", verb+" запрос к «"+n.title+"»", n.id, ev, []uuid.UUID{x.member})
}

// approve grants what the request x asks on n and writes the sensitive audit record of the change of access.
func (r *req) approve(ctx context.Context, n *node, x *request) error {
	var err error
	if x.can == canEdit {
		err = r.grantEdit(ctx, n, x.member)
	} else {
		err = r.grantRead(ctx, n, x)
	}
	if err != nil {
		return err
	}
	diff := map[string]any{"nodeId": n.id.String(), "memberId": x.member.String(), "can": x.can}
	if x.until != nil {
		diff["until"] = x.until.Format(time.DateOnly)
	}
	return r.record(ctx, "knowledge.request.approved", aggRequest, x.id, diff)
}

// grantEdit adds or upgrades the entry «правит» of member on n.
func (r *req) grantEdit(ctx context.Context, n *node, memberID uuid.UUID) error {
	c := n.clone()
	if !c.ownMode() {
		editors, err := r.editors(ctx)
		if err != nil {
			return err
		}
		c.mode, c.list = modeEdit, []entry{editors}
	}
	if i := slices.IndexFunc(c.list, func(e entry) bool { return e.who == whoMember && e.ref == memberID }); i >= 0 {
		c.list[i].can = canEdit
	} else {
		c.list = append(c.list, entry{who: whoMember, ref: memberID, can: canEdit})
	}
	tag, err := r.tx.Exec(ctx, `update kb.nodes set access_mode = $3, access_revision = access_revision + 1, updated_at = $4
		where id = $1 and access_revision = $2`, c.id, c.accessRev, modeToDB(c.mode), r.now)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return problem.New(codeConflict, "")
	}
	c.accessRev++
	r.w.nodes[c.id] = c
	*n = *c
	return r.wr.list(ctx, c)
}

// grantRead gives the member of a request to read the role «Читатель» of the page through the last of the 30 days.
func (r *req) grantRead(ctx context.Context, n *node, x *request) error {
	reader, err := r.spaceRole(ctx, templateReader)
	if err != nil {
		return err
	}
	last := dayOf(r.now).AddDate(0, 0, reqDays)
	end := time.Date(last.Year(), last.Month(), last.Day()+1, 0, 0, 0, 0, moscow)
	x.until = &last
	if err := r.grantRole(ctx, x.member, reader, scopePage, n.id, assignment{until: &end, reason: "запрос доступа"}); err != nil {
		return err
	}
	return r.bump(ctx, []uuid.UUID{x.member})
}
