package knowledge

import (
	"context"
	"strconv"

	"github.com/google/uuid"

	kapi "github.com/ortus/ortus-crm/backend/internal/api/knowledge"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Access is the access of a visible node (getKnowledgeNodeAccess).
func (s *Service) Access(ctx context.Context, tc tenantctx.TenantContext, nodeID uuid.UUID) (kapi.KnowledgeNodeAccess, error) {
	var out kapi.KnowledgeNodeAccess
	err := s.runOn(ctx, tc, false, onNode(nodeID), func(r *req) error {
		n, err := r.node(nodeID)
		if err != nil {
			return err
		}
		out = r.accessDTO(n)
		return nil
	})
	return out, err
}

// leadNode returns a visible node whose space the member leads.
func (r *req) leadNode(nodeID uuid.UUID) (*node, *space, error) {
	n, err := r.node(nodeID)
	if err != nil {
		return nil, nil, err
	}
	sp := r.w.spaceOf(n)
	return n, sp, r.lead(sp)
}

// leadSpace returns a visible space the member leads.
func (r *req) leadSpace(spaceID uuid.UUID) (*space, error) {
	sp, err := r.space(spaceID)
	if err != nil {
		return nil, err
	}
	return sp, r.lead(sp)
}

// Candidates lists whom the access of a node may name with their reach (listKnowledgeAccessCandidates): the roles
// of the area, the roles of the space, the groups, the foreman of the object of a section and the employees who are
// not blocked.
func (s *Service) Candidates(ctx context.Context, tc tenantctx.TenantContext, nodeID uuid.UUID) (kapi.KnowledgeAccessCandidateList, error) {
	out := kapi.KnowledgeAccessCandidateList{Items: []kapi.KnowledgeAccessCandidate{}}
	err := s.runOn(ctx, tc, false, onNode(nodeID), func(r *req) error {
		n, sp, err := r.leadNode(nodeID)
		if err != nil {
			return err
		}
		out.Items = r.candidates(n, sp)
		return nil
	})
	return out, err
}

func (r *req) candidates(n *node, sp *space) []kapi.KnowledgeAccessCandidate {
	var items []kapi.KnowledgeAccessCandidate
	push := func(e entry, label string) {
		ppl, ok, no := r.w.entryReach(e, sp, n)
		c := kapi.KnowledgeAccessCandidate{Entry: entryOut(e), Label: label, ReachLabel: reachLabel(len(ppl), len(ok), len(no))}
		c.Reach.Members, c.Reach.Total = len(ok), len(ppl)
		if len(no) > 0 {
			c.Reach.Reason = new(no[0].why)
		}
		items = append(items, c)
	}
	area := " · вся организация"
	if sp.unit != uuid.Nil {
		area = " · «" + r.w.unitName(sp.unit) + "»"
	}
	for _, x := range r.w.areaRoles() {
		push(entry{who: whoRole, ref: x.id, unit: sp.unit, can: canView}, "Роль «"+x.name+"»"+area)
	}
	for _, t := range spaceTemplates {
		if x := r.w.spaceRoleOf(t); x != nil {
			push(entry{who: whoRole, ref: x.id, can: canView}, "Роль «"+x.name+"» в пространстве")
		}
	}
	for _, g := range r.w.sortedGroups() {
		push(entry{who: whoGroup, ref: g.id, can: canView}, "Группа «"+g.name+"»")
	}
	if obj := r.w.sectionObject(n); obj != uuid.Nil {
		push(entry{who: whoRelation, obj: obj, can: canView}, "Прораб этого объекта")
	}
	for _, m := range r.w.members {
		if m.status == memberBlocked {
			continue
		}
		ok, why := r.w.reach(m, n)
		c := kapi.KnowledgeAccessCandidate{Entry: entryOut(entry{who: whoMember, ref: m.id, can: canView}), Label: m.name}
		c.Reach.Total = 1
		if ok {
			c.Reach.Members = 1
		} else {
			c.Reach.Reason, c.ReachLabel = new(why), "— не получит доступ: "+why
		}
		items = append(items, c)
	}
	return items
}

// reachLabel is «— сейчас никого», «— не получат доступ», «— получат N из M» or empty.
func reachLabel(ppl, ok, no int) string {
	switch {
	case ppl == 0:
		return "— сейчас никого"
	case ok == 0:
		return "— не получат доступ"
	case no > 0:
		return "— получат " + strconv.Itoa(ok) + " из " + strconv.Itoa(ppl)
	}
	return ""
}

// areaRoles are the roles an entry with the area of a space may name: not the owner's, not of a space, not of a
// project of tasks, not system ones — by name.
func (w *world) areaRoles() []*role {
	var out []*role
	for _, x := range w.roles {
		if x.kind == kindSystem || x.spaceRole() || ownerRole(x) || projectRole(x) {
			continue
		}
		out = append(out, x)
	}
	sortRoles(out)
	return out
}

// projectRole reports whether x is a role of a project of tasks (its templates project_*).
func projectRole(x *role) bool { return len(x.template) > 8 && x.template[:8] == "project_" }

// sectionObject is the object of repairs of the section n lies in (uuid.Nil — none).
func (w *world) sectionObject(n *node) uuid.UUID {
	for _, x := range w.path(n) {
		if x.obj != uuid.Nil {
			return x.obj
		}
	}
	return uuid.Nil
}

// AccessMap is the pages × employees of a space (getKnowledgeAccessMap): the lead only; up to eight employees.
func (s *Service) AccessMap(ctx context.Context, tc tenantctx.TenantContext, spaceID uuid.UUID, memberIDs *[]uuid.UUID) (kapi.KnowledgeAccessMap, error) {
	var out kapi.KnowledgeAccessMap
	err := s.runOn(ctx, tc, false, onSpace(spaceID), func(r *req) error {
		sp, err := r.leadSpace(spaceID)
		if err != nil {
			return err
		}
		rows := r.w.visibleTree(r.me, sp)
		people, err := r.mapPeople(rows, memberIDs)
		if err != nil {
			return err
		}
		out = r.accessMap(sp, rows, people)
		return nil
	})
	return out, err
}

// mapPeople are the columns of the map: the given employees or the first eight active ones who see a page, without
// the owner of the business.
func (r *req) mapPeople(rows []treeRow, ids *[]uuid.UUID) ([]*member, error) {
	if ids != nil && len(*ids) > 0 {
		if len(*ids) > mapColumns {
			return nil, invalid("memberIds", "Не больше 8 сотрудников")
		}
		out := make([]*member, 0, len(*ids))
		for i, id := range *ids {
			m := r.w.member[id]
			if m == nil {
				return nil, invalid("memberIds["+strconv.Itoa(i)+"]", "Сотрудник не найден")
			}
			out = append(out, m)
		}
		return out, nil
	}
	var out []*member
	for _, m := range r.w.members {
		if len(out) == mapColumns {
			break
		}
		if m.status == memberBlocked || m.owner {
			continue
		}
		for _, x := range rows {
			if r.w.access(m, x.n).view {
				out = append(out, m)
				break
			}
		}
	}
	return out, nil
}

func (r *req) accessMap(sp *space, rows []treeRow, people []*member) kapi.KnowledgeAccessMap {
	out := kapi.KnowledgeAccessMap{SpaceId: sp.id, Cells: [][]kapi.KnowledgeAccessMapCells{}}
	out.Members, out.Rows = emptyOf(&out.Members), emptyOf(&out.Rows)
	for _, m := range people {
		next, c := grow(out.Members)
		c.MemberId, c.DisplayName = m.id, m.name
		out.Members = next
	}
	for _, x := range rows {
		next, row := grow(out.Rows)
		row.NodeId, row.Title, row.Depth = x.n.id, x.n.title, x.d
		out.Rows = next
		cells := make([]kapi.KnowledgeAccessMapCells, 0, len(people))
		for _, m := range people {
			cells = append(cells, cell(r.w.access(m, x.n)))
		}
		out.Cells = append(out.Cells, cells)
	}
	return out
}

func cell(a access) kapi.KnowledgeAccessMapCells {
	switch {
	case a.edit:
		return kapi.KnowledgeAccessMapCellsEdit
	case a.view:
		return kapi.KnowledgeAccessMapCellsView
	case a.fn:
		return kapi.KnowledgeAccessMapCellsFunction
	}
	return kapi.KnowledgeAccessMapCellsNone
}

// Explain is the chain of reasons of the access of an employee to a node («Проверить сотрудника»): the lead only.
func (s *Service) Explain(ctx context.Context, tc tenantctx.TenantContext, nodeID, memberID uuid.UUID) (kapi.KnowledgeAccessExplanation, error) {
	var out kapi.KnowledgeAccessExplanation
	err := s.runOn(ctx, tc, false, onNode(nodeID), func(r *req) error {
		n, _, err := r.leadNode(nodeID)
		if err != nil {
			return err
		}
		m := r.w.member[memberID]
		if m == nil {
			return notFound("Сотрудник не найден")
		}
		a := r.w.access(m, n)
		out = kapi.KnowledgeAccessExplanation{NodeId: n.id, MemberId: m.id, MemberDisplayName: m.name, View: a.view, Edit: a.edit,
			FunctionBlocked: a.fn, Summary: summary(a), Chain: []kapi.KnowledgeAccessStep{}}
		for _, st := range a.chain {
			out.Chain = append(out.Chain, kapi.KnowledgeAccessStep{Kind: kapi.KnowledgeAccessStepKind(st.kind), Title: st.title, Detail: st.detail})
		}
		return nil
	})
	return out, err
}

// summary is the result of «Проверить сотрудника».
func summary(a access) string {
	switch {
	case a.edit:
		return "Читает и правит."
	case a.view:
		return "Читает, править не может."
	}
	s := "Не видит: страницы нет в его дереве, поиске и блоке «Подстраницы»."
	if a.fn {
		s += " Функция «Водитель» закрывает финансовые страницы, роль или группа это не обходят."
	}
	return s
}

// Requests lists the access requests of a space by status, newest first (listKnowledgeAccessRequests): the lead only.
func (s *Service) Requests(ctx context.Context, tc tenantctx.TenantContext, spaceID uuid.UUID, status string) (kapi.KnowledgeAccessRequestList, error) {
	out := kapi.KnowledgeAccessRequestList{Items: []kapi.KnowledgeAccessRequest{}}
	if status == "" {
		status = requestOpen
	}
	if status != requestOpen && status != requestApproved && status != requestDenied {
		return out, problem.New(problem.CodeMalformedRequest, "")
	}
	err := s.runOn(ctx, tc, false, onSpace(spaceID), func(r *req) error {
		sp, err := r.leadSpace(spaceID)
		if err != nil {
			return err
		}
		for _, x := range r.w.requests {
			if x.space == sp.id && x.status == status {
				out.Items = append(out.Items, r.requestDTO(x))
			}
		}
		return nil
	})
	return out, err
}

// Members is the members of a space (listKnowledgeSpaceMembers).
func (s *Service) Members(ctx context.Context, tc tenantctx.TenantContext, spaceID uuid.UUID) (kapi.KnowledgeSpaceMembers, error) {
	var out kapi.KnowledgeSpaceMembers
	err := s.runOn(ctx, tc, false, onSpace(spaceID), func(r *req) error {
		sp, err := r.space(spaceID)
		if err != nil {
			return err
		}
		out = r.membersDTO(sp)
		return nil
	})
	return out, err
}

// Rules lists the rules of a space (listKnowledgeRules): the lead only.
func (s *Service) Rules(ctx context.Context, tc tenantctx.TenantContext, spaceID uuid.UUID) (kapi.KnowledgeRuleList, error) {
	out := kapi.KnowledgeRuleList{Items: []kapi.KnowledgeRule{}}
	err := s.runOn(ctx, tc, false, onSpace(spaceID), func(r *req) error {
		sp, err := r.leadSpace(spaceID)
		if err != nil {
			return err
		}
		for _, x := range r.w.rules {
			if x.space == sp.id {
				out.Items = append(out.Items, r.ruleDTO(x))
			}
		}
		return nil
	})
	return out, err
}

// Runs lists the last runs of the rules of a space, newest first (listKnowledgeRuns): the lead only.
func (s *Service) Runs(ctx context.Context, tc tenantctx.TenantContext, spaceID uuid.UUID) (kapi.KnowledgeRunList, error) {
	out := kapi.KnowledgeRunList{Items: []kapi.KnowledgeRun{}}
	err := s.runOn(ctx, tc, false, onSpace(spaceID), func(r *req) error {
		sp, err := r.leadSpace(spaceID)
		if err != nil {
			return err
		}
		for _, x := range r.w.runs[sp.id] {
			out.Items = append(out.Items, runDTO(x))
		}
		return nil
	})
	return out, err
}
