package docs

import (
	"cmp"
	"slices"
	"time"

	"github.com/google/uuid"
)

// Kinds of the steps of the chain of reasons «Откуда доступ» (DocChainStep.kind).
const (
	stepOK      = "ok"
	stepNo      = "no"
	stepWait    = "wait"
	stepUp      = "up"
	stepInherit = "inh"
)

// step is a step of the chain of reasons of an access.
type step struct{ kind, title, detail string }

// access is the access of a member to a folder or a document with the chain of reasons (docAccess of the prototype).
type access struct {
	level       level
	owner       bool // the owner of the business
	fn          bool // closed by the function of the member (driver and finance)
	fin         bool // the folder path or the document is a finance one
	onlyVersion int  // a temporary access of a route is limited to this version (0 — all)
	chain       []step
}

type chainOf struct{ steps []step }

func (c *chainOf) add(kind, title, detail string) {
	c.steps = append(c.steps, step{kind, title, detail})
}

// areaLevel is the level the roles of the area give on the top folder with unit: a role of the organization or of a
// unit that covers the unit of the folder (a folder without a unit — roles of the whole organization). Roles of
// folders and documents act on their objects only, the role of the function driver — on addressed documents only.
func (w *world) areaLevel(m *member, unitID uuid.UUID) (level, *grant) {
	var best level
	var via *grant
	for i, g := range w.grants[m.id] {
		if g.role == nil || g.role.level == levelNone || g.role.template == templateDriver || isFolderRole(g.role) {
			continue
		}
		switch g.kind {
		case scopeTenant, scopeUnit:
		default:
			continue
		}
		if unitID != uuid.Nil {
			if !w.covers(g, unitID) {
				continue
			}
		} else if g.kind != scopeTenant {
			continue
		}
		if g.role.level > best {
			best, via = g.role.level, &w.grants[m.id][i]
		}
	}
	return best, via
}

func isFolderRole(r *role) bool {
	return r.template == templateManager || r.template == templateEditor || r.template == templateReader
}

// scopedLevel is the best level of the assignments of m on the folder or the document id.
func (w *world) scopedLevel(m *member, kind string, id uuid.UUID) (level, *grant) {
	var best level
	var via *grant
	for i, g := range w.grants[m.id] {
		if g.kind != kind || g.ref != id || g.role == nil {
			continue
		}
		if g.until != nil && !w.today.Before(g.until.Add(24*time.Hour)) {
			continue
		}
		if g.role.level > best {
			best, via = g.role.level, &w.grants[m.id][i]
		}
	}
	return best, via
}

// listLevel is the best level of the entries of a list that name m.
func (w *world) listLevel(m *member, list []entry) (level, *entry) {
	var best level
	var hit *entry
	for i := range list {
		e := &list[i]
		if e.level > best && w.entryActive(*e) && w.entryHas(m, *e) {
			best, hit = e.level, e
		}
	}
	return best, hit
}

// entryActive reports whether the term of an entry has not passed: the last day counts.
func (w *world) entryActive(e entry) bool { return e.until == nil || !w.today.After(*e.until) }

// entryHas reports whether entry e names m: a blocked member is in no entry; a role entry with a unit needs a grant
// covering the unit; the relation «прораб объекта» — by the id of the foreman.
func (w *world) entryHas(m *member, e entry) bool {
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
		return slices.ContainsFunc(w.grants[m.id], func(g grant) bool {
			if g.role == nil || g.role.id != e.ref {
				return false
			}
			return e.unit == uuid.Nil || w.covers(g, e.unit)
		})
	case whoRelation:
		f := w.objects[e.obj].Foreman
		return f != uuid.Nil && f == m.id
	}
	return false
}

// accessToFolder is the access of m to the folder f.
func (w *world) accessToFolder(m *member, f *folder) access { return w.chain(m, f, nil) }

// accessToDoc is the access of m to the document d.
func (w *world) accessToDoc(m *member, d *document) access { return w.chain(m, w.folders[d.folder], d) }

// chain is docAccess: organization → function → owner of the business → folders of the path → the document → route.
func (w *world) chain(m *member, f *folder, d *document) access {
	if m == nil || f == nil {
		return access{}
	}
	c := &chainOf{}
	fin := w.finance(f, d)
	if a, done := w.admit(c, m, fin); done {
		return a
	}
	l := w.folderLevel(c, m, w.path(f))
	if d == nil {
		if l == 0 {
			c.add(stepNo, "Папка «"+f.name+"»", "Нет роли в области, назначения в папке и записи в списке доступа")
		}
		return c.done(l, access{fin: fin})
	}
	return w.docChain(c, m, d, f, l, fin)
}

// done closes the chain with the level and the flags of the access.
func (c *chainOf) done(l level, a access) access {
	a.level, a.chain = l, c.steps
	return a
}

// admit adds the first steps of the chain: the organization (a blocked member has nothing, an invited one waits for
// his login), the function «Водитель» on finance, the owner of the business; done — the access is decided.
func (w *world) admit(c *chainOf, m *member, fin bool) (access, bool) {
	switch m.status {
	case memberBlocked:
		c.add(stepNo, "Организация", "Сотрудник заблокирован: доступ не действует")
		return c.done(levelNone, access{}), true
	case memberInvited:
		c.add(stepWait, "Организация", "Приглашение не принято: доступ начнёт действовать после входа")
	default:
		c.add(stepOK, "Организация", "Активный сотрудник")
	}
	if fin && m.driver {
		c.add(stepNo, "Функция «Водитель»", "Финансовые документы закрыты всегда, независимо от ролей и групп")
		return c.done(levelNone, access{fn: true, fin: true}), true
	}
	if m.owner {
		c.add(stepOK, "Владелец бизнеса", "Видит и правит всё, выдаёт любой уровень")
		return c.done(levelManage, access{owner: true, fin: fin}), true
	}
	return access{}, false
}

// folderLevel walks the folders of the path: «Только выбранные» breaks what the levels above gave, the role of the
// area counts on the top folder, then the assignments and the list of each folder.
func (w *world) folderLevel(c *chainOf, m *member, path []*folder) level {
	var l level
	for i, p := range path {
		if p.mode == modeListed {
			if l > 0 {
				c.add(stepUp, "Папка «"+p.name+"»", "Только выбранные: роли области и папки выше не действуют")
			}
			l = 0
		} else if i == 0 {
			if a, via := w.areaLevel(m, p.unit); a > 0 {
				l = a
				c.add(stepOK, "Роль в области", "«"+via.role.name+"» · "+w.scopeLabel(*via)+" → "+a.label())
			}
		}
		sc, via := w.scopedLevel(m, scopeFolder, p.id)
		li, hit := w.listLevel(m, w.shares[p.id])
		if top := max(sc, li); top > l {
			l = top
			if sc >= li {
				c.add(stepOK, "Папка «"+p.name+"»", "Назначение «"+via.role.name+"» в папке"+untilLabel(via.until))
			} else {
				c.add(stepOK, "Папка «"+p.name+"»", w.entryLabel(*hit)+" → "+li.label())
			}
		}
	}
	return l
}

// docChain continues the chain below the folders: the mode of the document, its own assignments and list, the owner
// of the document and the temporary accesses of a route.
func (w *world) docChain(c *chainOf, m *member, d *document, f *folder, l level, fin bool) access {
	if d.mode == modeListed {
		if l > 0 {
			c.add(stepUp, "«"+d.title+"»", "Свой доступ «Только выбранные»: доступ папки не действует")
		}
		l = 0
	} else if l > 0 {
		c.add(stepInherit, "«"+d.title+"»", "Доступ как у папки")
	}
	sc, via := w.scopedLevel(m, scopeDoc, d.id)
	li, hit := w.listLevel(m, w.shares[d.id])
	if top := max(sc, li); top > l {
		l = top
		if sc >= li {
			c.add(stepOK, "Документ", "Назначение «"+via.role.name+"»"+untilLabel(via.until))
		} else {
			c.add(stepOK, "Документ", w.entryLabel(*hit)+" → "+li.label())
		}
	}
	if d.owner == m.id && l < levelManage {
		l = levelManage
		c.add(stepOK, "Владелец документа", "Создал документ или получил его от предыдущего владельца")
	}
	var only int
	if t := bestTemp(d, m.id); t != nil && t.level > l {
		l, only = t.level, t.onlyVersion
		c.add(stepOK, "Маршрут", t.why)
	}
	if l == 0 {
		detail := "Нет доступа к папке «" + f.name + "» и записи в списке документа"
		if d.mode == modeListed {
			detail = "Нет в списке «Только выбранные»"
		}
		c.add(stepNo, "«"+d.title+"»", detail)
	}
	return c.done(l, access{fin: fin, onlyVersion: only})
}

// bestTemp is the strongest temporary access of a route that names the member; nil — none.
func bestTemp(d *document, member uuid.UUID) *tempGrant {
	var best *tempGrant
	for i := range d.tmp {
		if t := &d.tmp[i]; t.member == member && (best == nil || t.level > best.level) {
			best = t
		}
	}
	return best
}

// untilLabel is « до ДД.ММ.ГГГГ» of the last day of an assignment ("" — without a term).
func untilLabel(until *time.Time) string {
	if until == nil {
		return ""
	}
	return " до " + until.In(moscow).Add(-time.Nanosecond).Format("02.01.2006")
}

// scopeLabel names the scope of a grant in the chain.
func (w *world) scopeLabel(g grant) string {
	switch g.kind {
	case scopeUnit:
		return w.unitName(g.ref)
	case scopeTenant:
		return "вся организация"
	}
	return g.kind
}

// entryLabel is the name of the target of an entry (entryLabel of the prototype).
func (w *world) entryLabel(e entry) string {
	switch e.who {
	case whoAll:
		return "Все сотрудники организации"
	case whoMember:
		if n := w.names[e.ref]; n != "" {
			return n
		}
		return "Сотрудник"
	case whoGroup:
		if g := w.groups[e.ref]; g != nil {
			return "Группа «" + g.name + "»"
		}
		return "Группа «" + e.ref.String() + "»"
	case whoRole:
		name := e.ref.String()
		if r := w.roles[e.ref]; r != nil {
			name = r.name
		}
		return "Роль «" + name + "» · " + w.unitName(e.unit)
	case whoRelation:
		return "Прораб объекта"
	}
	return "—"
}

// rights is what a member may do with a document (docRights); the server computes it, the client never does.
type rights struct {
	access
	view, comment, suggest, edit, editL, manage bool
	locked, share, shareExternal                bool
	export, sign, route, convert                bool
	maxGrant                                    level
}

// rightsOf is docRights on an access: settings — the member holds a role with the verb «Настраивать» (docs.share);
// export and sign verbs are added by world.rightsFor.
func rightsOf(a access, d *document, settings bool) rights {
	l, own := a.level, a.owner
	locked := d.lock || d.pdfa || d.status == statusSigned
	r := rights{access: a, locked: locked, maxGrant: maxGrantOf(l)}
	r.view, r.comment = l >= levelView, l >= levelComment
	r.suggest = l >= levelSuggest && !locked
	r.edit = l >= levelEdit && !locked
	r.editL = l >= levelEdit
	r.manage = l == levelManage
	r.share = canShare(l, own, settings)
	r.shareExternal = own
	r.export = l > 0 && (own || l >= levelEdit)
	r.sign = l > 0 && own
	r.route = r.edit
	r.convert = r.editL
	return r
}

// canShare: the owner of the business, the one who manages, or a commenter and above with the verb «Настраивать».
func canShare(l level, own, settings bool) bool {
	return l > 0 && (own || l == levelManage || (l >= levelComment && settings))
}

// maxGrantOf is the highest level a member of level l gives: not above «Правит», the one who manages gives all.
func maxGrantOf(l level) level {
	if l == levelManage {
		return levelManage
	}
	return min(l, levelEdit)
}

// hasVerb reports whether m holds a role with the action over the document: a role of the organization, of the unit of
// the top folder, of a folder of the path, of the document, or «своё» (the owner of the document or a relation entry).
func (w *world) hasVerb(m *member, d *document, action string) bool {
	f := w.folders[d.folder]
	path := w.path(f)
	var unitID uuid.UUID
	ids := map[uuid.UUID]bool{}
	for i, p := range path {
		ids[p.id] = true
		if i == 0 {
			unitID = p.unit
		}
	}
	return slices.ContainsFunc(w.grants[m.id], func(g grant) bool {
		if g.role == nil || !g.role.has(action) {
			return false
		}
		switch g.kind {
		case scopeTenant:
			return true
		case scopeUnit:
			return unitID != uuid.Nil && w.covers(g, unitID)
		case scopeFolder:
			return ids[g.ref]
		case scopeDoc:
			return g.ref == d.id
		case scopeSelf:
			if d.owner == m.id {
				return true
			}
			return w.relationHit(m, d, path)
		}
		return false
	})
}

// relationHit reports whether a relation entry of the folders or the document names m.
func (w *world) relationHit(m *member, d *document, path []*folder) bool {
	lists := [][]entry{w.shares[d.id]}
	for _, p := range path {
		lists = append(lists, w.shares[p.id])
	}
	return slices.ContainsFunc(slices.Concat(lists...), func(e entry) bool { return e.who == whoRelation && w.entryHas(m, e) })
}

// rightsFor is the rights of m over d with the verbs of the roles.
func (w *world) rightsFor(m *member, d *document) rights {
	a := w.accessToDoc(m, d)
	r := rightsOf(a, d, a.level > 0 && w.hasVerb(m, d, actionShare))
	if a.level > 0 {
		r.export = r.export || w.hasVerb(m, d, actionExport)
		r.sign = r.sign || w.hasVerb(m, d, actionSign)
	}
	return r
}

// impactPerson is the change of the level of a member.
type impactPerson struct {
	member   *member
	from, to level
	invited  bool
}

// impact is who gets, loses, raises or lowers the access (diffAccess).
type impact struct{ gain, lose, up, down []impactPerson }

// diff compares the access of every live member to d before and after.
func (w *world) diff(before, after func(*member) level) impact {
	var out impact
	for _, m := range w.members {
		if m.status == memberBlocked {
			continue
		}
		a, b := before(m), after(m)
		if a == b {
			continue
		}
		p := impactPerson{member: m, from: a, to: b, invited: m.status == memberInvited}
		switch {
		case a == levelNone:
			out.gain = append(out.gain, p)
		case b == levelNone:
			out.lose = append(out.lose, p)
		case b > a:
			out.up = append(out.up, p)
		default:
			out.down = append(out.down, p)
		}
	}
	for _, s := range [][]impactPerson{out.gain, out.lose, out.up, out.down} {
		slices.SortFunc(s, func(a, b impactPerson) int { return cmp.Compare(a.member.name, b.member.name) })
	}
	return out
}

// impactOfMove is the impact of moving d to the folder to.
func (w *world) impactOfMove(d *document, to *folder) impact {
	moved := *d
	moved.folder = to.id
	return w.diff(func(m *member) level { return w.accessToDoc(m, d).level },
		func(m *member) level { return w.accessToDoc(m, &moved).level })
}

// impactOfShare is the impact of replacing the mode and the list of d.
func (w *world) impactOfShare(d *document, mode string, entries []entry) impact {
	changed := *d
	changed.mode = mode
	saved := w.shares[d.id]
	before := func(m *member) level { return w.accessToDoc(m, d).level }
	after := func(m *member) level {
		w.shares[d.id] = entries
		defer func() { w.shares[d.id] = saved }()
		return w.accessToDoc(m, &changed).level
	}
	return w.diff(before, after)
}

// impactOfFolderShare is the impact of replacing the mode and the list of the folder f on the access to the folder.
func (w *world) impactOfFolderShare(f *folder, mode string, entries []entry) impact {
	changed := *f
	changed.mode = mode
	saved := w.shares[f.id]
	before := func(m *member) level { return w.accessToFolder(m, f).level }
	after := func(m *member) level {
		w.folders[f.id], w.shares[f.id] = &changed, entries
		defer func() { w.folders[f.id], w.shares[f.id] = f, saved }()
		return w.accessToFolder(m, &changed).level
	}
	return w.diff(before, after)
}
