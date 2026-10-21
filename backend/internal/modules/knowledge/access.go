package knowledge

import (
	"slices"
	"time"

	"github.com/google/uuid"
)

// Kinds of the steps of the chain of reasons (KnowledgeAccessStep.kind).
const (
	stepOK      = "ok"
	stepNo      = "no"
	stepWait    = "wait"
	stepInherit = "inherit"
)

// step is a step of the chain of reasons of an access.
type step struct{ kind, title, detail string }

// access is the access of a member to a node with the chain of reasons (kbAccess of the domain).
type access struct {
	view, edit, lead, create bool
	fn                       bool // closed by the function of the member (driver and finance nodes)
	owner                    bool
	chain                    []step
}

// spaceMy is the rights of a member in a space (kbSpaceMy).
type spaceMy struct {
	owner, lead, view, create, edit bool
	role                            string
}

// reachOf is a member an entry names with the reason levels above the node stop him ("" — they let him through).
type reachOf struct {
	m   *member
	why string
}

// areaVerbs are the verbs of the roles of the area of a space a member holds (PD-53: territorial and «своё» roles
// only, not the roles of objects, of a space or of the owner) and the first grant that gives them.
type areaVerbs struct {
	verbs verbs
	via   *grant
}

// spaceVerbs are the verbs of a member in a space: the best role of the space, the verbs of the area and the verbs
// the level lets in, the lead.
type spaceVerbs struct {
	best *grant // the role of the space shown on the card (lead → editor → reader → other)
	area areaVerbs
	sv   verbs
	lead bool
}

// ownerRole reports whether r is the system role of the owner of the business (its grants are not roles of an area).
func ownerRole(r *role) bool { return r.template == "owner" }

// areaOf collects the verbs of the roles of the area of sp held by m: a grant of the organization, of a unit covering
// the area of the space, or «своё» in a space of the whole organization (Q-W4.00-knowledge-15).
func (w *world) areaOf(m *member, sp *space) areaVerbs {
	var out areaVerbs
	for i, g := range w.grants[m.id] {
		if g.role.spaceRole() || ownerRole(g.role) || g.verbs == 0 {
			continue
		}
		switch g.kind {
		case scopeTenant, scopeUnit, scopeSelf:
		default:
			continue // PD-53: a role of an object acts on its object only
		}
		if sp.unit != uuid.Nil && !w.covers(g, sp.unit) {
			continue
		}
		out.verbs |= g.verbs
		if out.via == nil {
			out.via = &w.grants[m.id][i]
		}
	}
	return out
}

// rank orders the roles of a space on the card: the lead, the editor, the reader, then others.
func rank(g grant) int {
	switch {
	case g.verbs.has(verbLead):
		return 0
	case g.verbs.has(verbEdit):
		return 1
	case g.role.template == templateReader:
		return 2
	}
	return 3
}

// spaceVerbsOf computes the verbs of m in sp: the roles of the space whole; the verbs of the area all in an open
// space, reading in a limited one, none in a closed one.
func (w *world) spaceVerbsOf(m *member, sp *space) spaceVerbs {
	var out spaceVerbs
	for i, g := range w.grants[m.id] {
		if g.kind != scopeSpace || g.ref != sp.id {
			continue
		}
		out.sv |= g.verbs
		out.lead = out.lead || g.verbs.has(verbLead)
		if out.best == nil || rank(g) < rank(*out.best) {
			out.best = &w.grants[m.id][i]
		}
	}
	out.area = w.areaOf(m, sp)
	switch accessOf(sp) {
	case levelOpen:
		out.sv |= out.area.verbs
	case levelLimited:
		out.sv |= out.area.verbs & verbView
	}
	return out
}

// pageGrant is the deepest page assignment of m on the branch path (an approved request: «Читатель» of a page and
// its subpages) and its index in path; nil — none.
func (w *world) pageGrant(m *member, path []*node) (*grant, int) {
	var best *grant
	at := -1
	for i, g := range w.grants[m.id] {
		if g.kind != scopePage {
			continue
		}
		j := slices.IndexFunc(path, func(x *node) bool { return x.id == g.ref })
		if j > at {
			best, at = &w.grants[m.id][i], j
		}
	}
	return best, at
}

// hitOf is the entry of the list of x that names m: an «правит» entry wins over an earlier «читает» one.
func (w *world) hitOf(m *member, x *node, sp *space) *entry {
	var best *entry
	for i, e := range x.list {
		if w.entryHas(m, e, sp) && (best == nil || e.can == canEdit) {
			best = &x.list[i]
		}
	}
	return best
}

// chainOf builds an access step by step.
type chainOf struct{ steps []step }

func (c *chainOf) add(kind, title, detail string) {
	c.steps = append(c.steps, step{kind, title, detail})
}

func (c *chainOf) out(view, edit bool) access { return access{view: view, edit: edit, chain: c.steps} }

// access is the access of m to n with the chain of reasons: organization → owner of the business → space (or the
// branch of a page assignment) → every parent with its own access → the node → the function of the member.
func (w *world) access(m *member, n *node) access {
	c := &chainOf{}
	sp := w.spaceOf(n)
	if m == nil || n == nil || sp == nil {
		return c.out(false, false)
	}
	switch m.status {
	case memberBlocked:
		c.add(stepNo, "Организация", "Сотрудник заблокирован, доступ не действует")
		return c.out(false, false)
	case memberInvited:
		c.add(stepWait, "Организация", "Приглашение не принято: доступ начнёт действовать после входа")
	default:
		c.add(stepOK, "Организация", "Активный сотрудник")
	}
	if m.owner {
		c.add(stepOK, "Владелец бизнеса", "Видит и правит всё")
		a := c.out(true, true)
		a.lead, a.owner, a.create = true, true, true
		return a
	}
	path := w.path(n)
	v := w.spaceVerbsOf(m, sp)
	from, ok := w.enterSpace(c, m, sp, path, &v)
	if !ok {
		return c.out(false, false)
	}
	return w.walk(c, m, n, sp, path[from:], v)
}

// enterSpace adds the step of the space (or of the branch of a page assignment when the space is not readable) and
// returns the index of the first node of path to check; false — the member does not read the space.
func (w *world) enterSpace(c *chainOf, m *member, sp *space, path []*node, v *spaceVerbs) (int, bool) {
	from := 0
	if !v.sv.has(verbView) {
		if g, i := w.pageGrant(m, path); g != nil {
			v.sv |= g.verbs
			from = i + 1
			detail := "«" + g.role.name + "» с областью этой страницы"
			if g.until != nil {
				detail += " до " + lastDay(*g.until)
			}
			c.add(stepOK, "Ветка «"+path[i].title+"»", detail)
		}
	}
	if !v.sv.has(verbView) {
		detail := "Нет роли в области «" + w.areaLabel(sp) + "», не участник пространства"
		if accessOf(sp) == levelClosed {
			detail = "Закрытое: только участники и владелец бизнеса"
		}
		c.add(stepNo, "Пространство «"+sp.name+"»", detail)
		return 0, false
	}
	if from == 0 {
		c.add(stepOK, "Пространство «"+sp.name+"»", w.spaceDetail(sp, *v))
	}
	return from, true
}

// spaceDetail is the reason of the step of the space: the role of the space or the level and the role of the area.
func (w *world) spaceDetail(sp *space, v spaceVerbs) string {
	if v.best != nil {
		via := " · назначение в пространстве"
		if v.best.group != uuid.Nil {
			via = " · группа «" + w.groupName(v.best.group) + "»"
		}
		return v.best.role.name + via
	}
	d := "Читатель по уровню «" + levelOf(sp).label + "»"
	if v.area.via != nil {
		d += ": роль «" + v.area.via.role.name + "»"
	}
	return d
}

// walk checks the nodes of the branch from the space down to n: the own access of each, the function, the archive,
// and decides editing by the nearest node with own access.
func (w *world) walk(c *chainOf, m *member, n *node, sp *space, nodes []*node, v spaceVerbs) access {
	view, nearest, hit := w.lists(c, m, sp, nodes, v.lead)
	fin := m.driver && w.finance(n)
	if fin {
		view = false
		c.add(stepNo, "Функция «Водитель»", "Финансовые страницы закрыты всегда")
	}
	if view && n.parent != uuid.Nil && !n.ownMode() {
		c.add(stepInherit, "«"+n.title+"»", "Доступ как у родителя")
	}
	if !view {
		a := c.out(false, false)
		a.fn = fin
		return a
	}
	if n.archived && !v.lead && !v.sv.has(verbEdit) {
		return c.out(false, false)
	}
	edit := editOf(m, n, v, nearest, hit)
	a := c.out(true, edit)
	a.lead = v.lead
	a.create = edit || (v.sv.has(verbCreate) && nearest == nil)
	return a
}

// editOf decides editing of a visible node: the lead edits everything; under a node with own access — its «правит»
// entry; otherwise the right to edit of the space; the author with the right to create edits his node.
func editOf(m *member, n *node, v spaceVerbs, nearest *node, hit *entry) bool {
	own := v.sv.has(verbCreate) && n.owner == m.id
	switch {
	case v.lead:
		return true
	case nearest != nil:
		return (hit != nil && hit.can == canEdit) || own
	}
	return v.sv.has(verbEdit) || own
}

// lists goes down the nodes with their own access: a «Только выбранные» node without m (and m not the lead) hides
// the branch; the last node with own access and the entry of m in it decide editing.
func (w *world) lists(c *chainOf, m *member, sp *space, nodes []*node, lead bool) (bool, *node, *entry) {
	var nearest *node
	var hit *entry
	for _, x := range nodes {
		if !x.ownMode() {
			continue
		}
		h := w.hitOf(m, x, sp)
		if x.mode == modeListed && h == nil && !lead {
			c.add(stepNo, "«"+x.title+"»", "Свой доступ «Только выбранные»: нет в списке")
			return false, nearest, hit
		}
		c.add(stepOK, "«"+x.title+"»", w.ownDetail(x, h))
		nearest, hit = x, h
	}
	return true, nearest, hit
}

// finance reports whether n or an ancestor is a finance node.
func (w *world) finance(n *node) bool {
	return slices.ContainsFunc(w.path(n), func(x *node) bool { return x.finance })
}

// ownDetail is the reason of the step of a node with its own access.
func (w *world) ownDetail(x *node, h *entry) string {
	if x.mode == modeListed {
		if h == nil {
			return "Свой доступ; руководитель пространства видит всё"
		}
		right := "читает"
		if h.can == canEdit {
			right = "правит"
		}
		return "В списке: " + w.entryLabel(*h) + " — " + right
	}
	d := modeLabels[modeEdit]
	if h != nil && h.can == canEdit {
		d += ": " + w.entryLabel(*h)
	}
	return d
}

// lastDay is the last day of a period that ends at until (exclusive, midnight of the next day in Moscow):
// «ДД.ММ.ГГГГ».
func lastDay(until time.Time) string {
	return until.In(moscow).Add(-time.Nanosecond).Format("02.01.2006")
}

// spaceMy is the rights of m in sp (the card of the space, the buttons «Создать»).
func (w *world) spaceMy(m *member, sp *space) spaceMy {
	if m == nil {
		return spaceMy{}
	}
	if m.owner {
		return spaceMy{owner: true, lead: true, view: true, create: true, edit: true, role: "Владелец бизнеса"}
	}
	v := w.spaceVerbsOf(m, sp)
	out := spaceMy{lead: v.lead, view: v.sv.has(verbView), create: v.lead || v.sv.has(verbCreate), edit: v.lead || v.sv.has(verbEdit)}
	switch {
	case v.best != nil:
		out.role = v.best.role.name
	case out.view:
		out.role = "Читатель по уровню «" + levelOf(sp).label + "»"
	}
	return out
}

// reach reports whether m passes the levels above n — the space and every parent — and why not.
func (w *world) reach(m *member, n *node) (bool, string) {
	sp := w.spaceOf(n)
	if m == nil || n == nil || sp == nil || m.status == memberBlocked {
		return false, "сотрудник заблокирован"
	}
	if m.owner {
		return true, ""
	}
	if m.driver && w.finance(n) {
		return false, "функция «Водитель» не открывает финансовые страницы"
	}
	if p := w.nodeOf(n.parent); p != nil {
		if w.access(m, p).view {
			return true, ""
		}
		return false, "не видит родителя «" + p.title + "»"
	}
	if w.spaceVerbsOf(m, sp).sv.has(verbView) {
		return true, ""
	}
	if accessOf(sp) == levelClosed {
		return false, "не участник закрытого пространства"
	}
	return false, "нет роли в области «" + w.areaLabel(sp) + "» и не участник пространства"
}

// entryReach splits the people an entry names into those levels above n let through and the others.
func (w *world) entryReach(e entry, sp *space, n *node) (ppl []*member, ok, no []reachOf) {
	ppl = w.entryPeople(e, sp)
	for _, m := range ppl {
		if pass, why := w.reach(m, n); pass {
			ok = append(ok, reachOf{m: m})
		} else {
			no = append(no, reachOf{m, why})
		}
	}
	return ppl, ok, no
}

// entryHas reports whether entry e names m in space sp (entryHas of the domain core): a blocked member is in no
// entry; a role of a space counts in its space only; a role entry with a unit needs a grant covering the unit; the
// relation «прораб объекта» — by the id of the foreman.
func (w *world) entryHas(m *member, e entry, sp *space) bool {
	if m == nil || m.status == memberBlocked {
		return false
	}
	switch e.who {
	case whoAll:
		return true
	case whoMember:
		return e.ref == m.id
	case whoGroup:
		g := w.groups[e.ref]
		return g != nil && slices.Contains(g.members, m.id)
	case whoRole:
		return w.holdsRole(m, e, sp)
	case whoRelation:
		f := w.foremanOf(e.obj)
		return f != uuid.Nil && f == m.id
	}
	return false
}

// holdsRole reports whether m holds the role of a role entry (in the space for a role of a space).
func (w *world) holdsRole(m *member, e entry, sp *space) bool {
	r := w.roles[e.ref]
	if r == nil {
		return false
	}
	return slices.ContainsFunc(w.grants[m.id], func(g grant) bool {
		switch {
		case g.role.id != r.id:
			return false
		case r.spaceRole():
			return g.kind == scopeSpace && sp != nil && g.ref == sp.id
		case e.unit == uuid.Nil:
			return true
		}
		return w.covers(g, e.unit)
	})
}

// entryPeople are the members e names in sp, blocked excluded.
func (w *world) entryPeople(e entry, sp *space) []*member {
	var out []*member
	for _, m := range w.members {
		if w.entryHas(m, e, sp) {
			out = append(out, m)
		}
	}
	return out
}

// leads are the members with a role of the lead of sp (knowledge.access.manage on the space).
func (w *world) leads(sp *space) []*member {
	var out []*member
	for _, m := range w.members {
		if slices.ContainsFunc(w.grants[m.id], func(g grant) bool {
			return g.kind == scopeSpace && g.ref == sp.id && g.verbs.has(verbLead)
		}) {
			out = append(out, m)
		}
	}
	return out
}

// spaceVisible reports whether m sees sp: by a role of its area or of the space, or by a visible node of it.
func (w *world) spaceVisible(m *member, sp *space) bool {
	if w.spaceMy(m, sp).view {
		return true
	}
	for _, n := range w.nodes {
		if n.space == sp.id && w.access(m, n).view {
			return true
		}
	}
	return false
}

// foremanOf is the foreman of an object of repairs (uuid.Nil — none).
func (w *world) foremanOf(obj uuid.UUID) uuid.UUID { return w.objects[obj].Foreman }

// groupName is the name of a group, its id if unknown.
func (w *world) groupName(id uuid.UUID) string {
	if g := w.groups[id]; g != nil {
		return g.name
	}
	return id.String()
}
