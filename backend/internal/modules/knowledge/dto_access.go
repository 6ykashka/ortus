package knowledge

import (
	"slices"
	"strings"

	"github.com/google/uuid"

	kapi "github.com/ortus/ortus-crm/backend/internal/api/knowledge"
)

// entryOut is an entry of a list in the schema of the contract.
func entryOut(e entry) kapi.KnowledgeAccessEntryInput {
	out := kapi.KnowledgeAccessEntryInput{Who: kapi.KnowledgeAccessEntryInputWho(e.who), Can: kapi.KnowledgeAccessEntryInputCan(e.can)}
	if e.who == whoRelation {
		out.Relation = new(kapi.KnowledgeAccessEntryInputRelationForeman)
		out.Object = &kapi.ObjectRef{ModuleKey: "repairs", EntityType: "project", EntityId: e.obj}
	} else if e.ref != uuid.Nil {
		out.RefId = new(e.ref)
	}
	if e.unit != uuid.Nil {
		out.OrgUnitId = new(e.unit)
	}
	return out
}

// reachDTO is who an entry gives access to in n and who levels above stop, with the reason.
func (r *req) reachDTO(e entry, sp *space, n *node) *kapi.KnowledgeAccessReach {
	ppl, ok, no := r.w.entryReach(e, sp, n)
	out := &kapi.KnowledgeAccessReach{Members: len(ok), Total: len(ppl)}
	out.Blocked = emptyOf(&out.Blocked)
	for _, x := range no {
		next, b := grow(out.Blocked)
		b.DisplayName, b.Reason = x.m.name, x.why
		out.Blocked = next
	}
	return out
}

// accessDTO is the access of a visible node: the chain «Организация → Пространство → узлы со своим доступом →
// узел», the mode, where an inherited mode comes from, the entries with labels, the subpages with own access; the
// reach of the entries and the open requests — to the lead only (Q-W4.00-knowledge-9).
func (r *req) accessDTO(n *node) kapi.KnowledgeNodeAccess {
	sp := r.w.spaceOf(n)
	lead := r.w.spaceMy(r.me, sp).lead
	out := kapi.KnowledgeNodeAccess{
		NodeId: n.id, Title: n.title, AccessMode: kapi.KnowledgeNodeAccessAccessMode(modeToDB(n.mode)), Chain: r.accessChain(n, sp, lead),
		Entries: []kapi.KnowledgeAccessEntry{}, OwnSubnodes: []kapi.KnowledgeNodeRef{}, CanManage: lead,
		LeadNames: []string{}, Revision: n.accessRev,
	}
	r.inheritedFrom(n, sp, &out)
	if n.ownMode() {
		for _, e := range n.list {
			x := r.entryDTO(e)
			if lead {
				x.Reach = r.reachDTO(e, sp, n)
			}
			out.Entries = append(out.Entries, x)
		}
	}
	sub := r.w.subtree(n, false)
	out.DescendantCount = len(sub) - 1
	for _, x := range sub[1:] {
		if x.ownMode() {
			out.OwnSubnodes = append(out.OwnSubnodes, kapi.KnowledgeNodeRef{Id: x.id, Title: x.title})
		}
	}
	for _, m := range r.w.leads(sp) {
		out.LeadNames = append(out.LeadNames, m.name)
	}
	if lead {
		reqs := []kapi.KnowledgeAccessRequest{}
		for _, x := range r.w.requests {
			if x.node == n.id && x.status == requestOpen {
				reqs = append(reqs, r.requestDTO(x))
			}
		}
		out.Requests = &reqs
	}
	return out
}

// accessChain is the chain of the dialog «Доступ»: the organization, the space with its level, the visible
// ancestors with own access and the node («Настраиваете сейчас» for the lead).
func (r *req) accessChain(n *node, sp *space, lead bool) []kapi.KnowledgeAccessStep {
	lvl := levelOf(sp)
	chain := []kapi.KnowledgeAccessStep{
		{Kind: stepOK, Title: "Организация", Detail: "Владелец бизнеса видит всё"},
		{Kind: stepOK, Title: "Пространство «" + sp.name + "»", Detail: lvl.label + ": " + strings.ToLower(lvl.d)},
	}
	path := r.w.path(n)
	for _, x := range path[:len(path)-1] {
		if x.ownMode() && r.visible(x) {
			chain = append(chain, kapi.KnowledgeAccessStep{Kind: stepOK, Title: "«" + x.title + "»", Detail: modeLabels[x.mode]})
		}
	}
	last := modeLabels[n.mode]
	if lead {
		last = "Настраиваете сейчас"
	}
	return append(chain, kapi.KnowledgeAccessStep{Kind: stepOK, Title: "«" + n.title + "»", Detail: last})
}

// inheritedFrom sets where «Как у родителя» comes from: the nearest ancestor with own access if the member sees it,
// the space otherwise.
func (r *req) inheritedFrom(n *node, sp *space, out *kapi.KnowledgeNodeAccess) {
	from := &out.InheritedFrom
	from.Kind, from.Id, from.Title = kapi.KnowledgeNodeAccessInheritedFromKindSpace, sp.id, sp.name
	path := r.w.path(n)
	for i := len(path) - 2; i >= 0; i-- {
		x := path[i]
		if !x.ownMode() {
			continue
		}
		if r.visible(x) {
			from.Kind, from.Id, from.Title = kapi.KnowledgeNodeAccessInheritedFromKindNode, x.id, x.title
		}
		return
	}
}

// entryDTO is an entry of a list with its label.
func (r *req) entryDTO(e entry) kapi.KnowledgeAccessEntry {
	in := entryOut(e)
	return kapi.KnowledgeAccessEntry{
		Who: kapi.KnowledgeAccessEntryWho(in.Who), Can: kapi.KnowledgeAccessEntryCan(in.Can), RefId: in.RefId,
		OrgUnitId: in.OrgUnitId, Object: in.Object, Relation: (*kapi.KnowledgeAccessEntryRelation)(in.Relation),
		Label: r.w.entryLabel(e),
	}
}

// requestDTO is an access request.
func (r *req) requestDTO(x *request) kapi.KnowledgeAccessRequest {
	out := kapi.KnowledgeAccessRequest{
		Id: x.id, NodeId: x.node, SpaceId: x.space, MemberId: x.member, MemberDisplayName: r.w.nameOf(x.member),
		Can: kapi.KnowledgeAccessRequestCan(x.can), Status: kapi.KnowledgeAccessRequestStatus(x.status), RequestedAt: x.at,
	}
	if n := r.w.nodeOf(x.node); n != nil {
		out.NodeTitle = n.title
	}
	if x.status != requestOpen {
		out.DecidedAt = x.decidedAt
		if name := r.w.nameOf(x.decidedBy); name != "" {
			out.DecidedByDisplayName = new(name)
		}
	}
	if x.until != nil {
		d := alloc(&out.Until)
		d.Time = *x.until
		out.Until = d
	}
	return out
}

// spaceRoleOf is the role of the organization with a template of a space (nil — not created yet).
func (w *world) spaceRoleOf(template string) *role {
	var out *role
	for _, x := range w.roles {
		if x.template == template && (out == nil || x.name < out.name) {
			out = x
		}
	}
	return out
}

// membersDTO is the members of a space: the roles of the space with their members to everyone who sees it; the
// members by the level of the space and the page assignments — to the lead only.
func (r *req) membersDTO(sp *space) kapi.KnowledgeSpaceMembers {
	lead := r.w.spaceMy(r.me, sp).lead
	out := kapi.KnowledgeSpaceMembers{SpaceId: sp.id, LevelLabel: levelOf(sp).d, CanManage: lead, Roles: []kapi.KnowledgeSpaceRole{}}
	inSpace := map[uuid.UUID]bool{}
	for _, t := range spaceTemplates {
		out.Roles = append(out.Roles, r.roleCard(sp, t, inSpace))
	}
	if !lead {
		return out
	}
	r.byLevel(sp, inSpace, &out)
	r.pageAssignments(sp, &out)
	return out
}

// roleCard is the card of a role of a space with its members (marked in inSpace).
func (r *req) roleCard(sp *space, template string, inSpace map[uuid.UUID]bool) kapi.KnowledgeSpaceRole {
	label := spaceRoleDefs[template].name
	x := r.w.spaceRoleOf(template)
	if x != nil {
		label = x.name
	}
	out := kapi.KnowledgeSpaceRole{Role: kapi.KnowledgeSpaceRoleRole(template), Label: label, Description: roleCaps[template],
		Members: []kapi.KnowledgeSpaceMember{}}
	for _, m := range r.w.members {
		if x == nil || !r.w.hasSpaceRole(m, sp, x) {
			continue
		}
		inSpace[m.id] = true
		state := kapi.KnowledgeSpaceMemberStateActive
		if m.status == memberInvited {
			state = kapi.KnowledgeSpaceMemberStateInvited
		}
		out.Members = append(out.Members, kapi.KnowledgeSpaceMember{MemberId: m.id, DisplayName: m.name, State: state})
	}
	return out
}

// pageAssignments adds the page assignments of the nodes of sp («Страница «…» до {дата}»).
func (r *req) pageAssignments(sp *space, out *kapi.KnowledgeSpaceMembers) {
	pages := emptyOf(out.PageAssignments)
	for _, m := range r.w.members {
		for _, g := range r.w.grants[m.id] {
			n := r.w.nodeOf(g.ref)
			if g.kind != scopePage || n == nil || n.space != sp.id {
				continue
			}
			next, pa := grow(pages)
			pages = next
			pa.MemberId, pa.DisplayName, pa.NodeId, pa.NodeTitle = m.id, m.name, n.id, n.title
			if g.until != nil {
				d := alloc(&pa.Until)
				d.Time = dateOf(lastDay(*g.until))
				pa.Until = d
			}
		}
	}
	out.PageAssignments = &pages
}

// emptyOf is an empty slice of the elements of *list (a type of the generator the module does not name).
func emptyOf[E any](_ *[]E) []E { return []E{} }

// grow appends a zero element to s and returns it.
func grow[E any](s []E) ([]E, *E) {
	var zero E
	s = append(s, zero)
	return s, &s[len(s)-1]
}

// hasSpaceRole reports whether m holds role x in sp.
func (w *world) hasSpaceRole(m *member, sp *space, x *role) bool {
	return slices.ContainsFunc(w.grants[m.id], func(g grant) bool {
		return g.kind == scopeSpace && g.ref == sp.id && g.role.id == x.id
	})
}

// byLevel adds the members who read sp by its level (not members of the space, not the owner of the business): up
// to eight with the source of their access and the total.
func (r *req) byLevel(sp *space, inSpace map[uuid.UUID]bool, out *kapi.KnowledgeSpaceMembers) {
	by := alloc(&out.ByLevel)
	by.Label, by.Members = "По уровню «"+levelOf(sp).label+"»", emptyOf(&by.Members)
	for _, m := range r.w.members {
		if m.status == memberBlocked || inSpace[m.id] || m.owner || !r.w.spaceMy(m, sp).view {
			continue
		}
		by.Total++
		if len(by.Members) < mapColumns {
			next, x := grow(by.Members)
			x.MemberId, x.DisplayName, x.Source = m.id, m.name, r.sourceOf(m)
			by.Members = next
		}
	}
	out.ByLevel = by
}

// sourceOf is the role a member reads a space by: «роль «…» · {область}» (the first role with rights of the knowledge
// base that is not a role of a space).
func (r *req) sourceOf(m *member) string {
	for _, g := range r.w.grants[m.id] {
		if g.role.spaceRole() || g.role.verbs == 0 {
			continue
		}
		where := areaAll
		switch g.kind {
		case scopeSelf:
			where = "своё"
		case scopeTenant:
		default:
			where = r.w.unitName(g.ref)
		}
		return "роль «" + g.role.name + "» · " + strings.ToLower(where)
	}
	return "по роли в области"
}

// ruleDTO is a rule of automation; a section rule lists the objects of repairs with their sections.
func (r *req) ruleDTO(x *rule) kapi.KnowledgeRule {
	out := kapi.KnowledgeRule{Id: x.id, SpaceId: x.space, Kind: kapi.KnowledgeRuleKind(x.kind), Name: x.name, Trigger: x.trigger,
		Enabled: x.on}
	if x.kind != ruleSection {
		return out
	}
	objs := []kapi.KnowledgeSectionObject{}
	for _, o := range r.w.sortedObjects() {
		so := kapi.KnowledgeSectionObject{ProjectId: o.ID, Name: o.Name}
		if o.Stage != "" {
			so.Stage = new(o.Stage)
		}
		if f := r.w.foremanName(o); f != "" {
			so.ForemanName = new(f)
		}
		if s := r.w.sectionOf(x.space, o.ID); s != nil {
			so.SectionNodeId = new(s.id)
		}
		objs = append(objs, so)
	}
	out.Objects = &objs
	return out
}

// sortedObjects are the objects of repairs by name.
func (w *world) sortedObjects() []RepairObject {
	out := make([]RepairObject, 0, len(w.objects))
	for _, o := range w.objects {
		out = append(out, o)
	}
	slices.SortFunc(out, func(a, b RepairObject) int { return strings.Compare(a.Name, b.Name) })
	return out
}

// foremanName is the name of the foreman of an object ("" — «прораб не назначен»).
func (w *world) foremanName(o RepairObject) string {
	if o.ForemanName != "" {
		return o.ForemanName
	}
	return w.nameOf(o.Foreman)
}

// sectionOf is the section of object obj in space sp (the folder made by the rule), nil — none.
func (w *world) sectionOf(sp, obj uuid.UUID) *node {
	for _, n := range w.nodes {
		if n.space == sp && n.obj == obj && n.kind == kindFolder {
			return n
		}
	}
	return nil
}

func runDTO(x run) kapi.KnowledgeRun {
	return kapi.KnowledgeRun{Id: x.id, RuleId: x.rule, At: x.at, Result: kapi.KnowledgeRunResult(x.res), Text: x.text}
}

// templatesDTO is the starting templates of spaces (constants of the module) with the roles of their folders.
func (r *req) templatesDTO() []kapi.KnowledgeSpaceTemplate {
	out := make([]kapi.KnowledgeSpaceTemplate, 0, len(templates))
	for _, t := range templates {
		x := kapi.KnowledgeSpaceTemplate{Key: kapi.KnowledgeSpaceTemplateKey(t.key), Name: t.name, Icon: t.icon, Hint: t.hint,
			Nodes: []kapi.KnowledgeTemplateNode{}}
		top := -1
		for i, n := range t.nodes {
			tn := kapi.KnowledgeTemplateNode{Index: i, Kind: kapi.KnowledgeTemplateNodeKind(n.kind), Title: n.title, RequestAck: n.ack}
			if n.in {
				tn.ParentIndex = new(top)
			} else {
				top = i
			}
			if n.role != "" {
				if rl := r.w.templateRole(n.role); rl != nil {
					tn.ReaderRoleLabel = new(rl.name)
				}
			}
			x.Nodes = append(x.Nodes, tn)
		}
		out = append(out, x)
	}
	return out
}

// templateRole is the role of the organization of a folder of a function of a template: by the template of the
// catalog, else by the name (nil — the organization has none).
func (w *world) templateRole(key string) *role {
	tr, ok := templateRoles[key]
	if !ok {
		return nil
	}
	var byName *role
	for _, x := range w.roles {
		if tr.template != "" && x.template == tr.template {
			return x
		}
		if strings.EqualFold(x.name, tr.name) {
			byName = x
		}
	}
	return byName
}
