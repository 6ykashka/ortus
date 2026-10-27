package docs

import (
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
)

func tid(n int) uuid.UUID { return uuid.MustParse(fmt.Sprintf("00000000-0000-4000-8000-%012d", n)) }

var testNow = time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)

// fixture is a small organization: a firm unit, an owner, a logist with a folder role, a foreman, a driver, a clerk
// blocked and an invited accountant; folders «Север» (firm unit) › «Приказы», «Финансы» (finance), and documents.
type fixture struct {
	w                                     *world
	owner, logist, foreman, driver, other *member
	blocked, invited                      *member
	north, orders, fin, listed            *folder
	order, sheet                          *document
}

func newFixture() *fixture {
	w := newWorld(testNow)
	f := &fixture{w: w}
	mk := func(n int, name, status string) *member {
		m := &member{id: tid(n), name: name, status: status}
		w.addMember(m)
		return m
	}
	f.owner = mk(1, "Зимина Дарья", memberActive)
	f.owner.owner = true
	f.logist = mk(2, "Котова Марина", memberActive)
	f.foreman = mk(3, "Соколов Алексей", memberActive)
	f.driver = mk(4, "Водитель Иван", memberActive)
	f.driver.driver = true
	f.other = mk(5, "Прочий Пётр", memberActive)
	f.blocked = mk(6, "Заблокирован Борис", memberBlocked)
	f.invited = mk(7, "Ильин Сергей", memberInvited)
	w.units[tid(100)] = &unit{id: tid(100), kind: "company", name: "Север Логистик"}
	w.units[tid(101)] = &unit{id: tid(101), kind: "company", name: "Юг"}
	f.north = &folder{id: tid(200), name: "Север Логистик", unit: tid(100), mode: modeInherit, owner: f.owner.id}
	f.orders = &folder{id: tid(201), name: "Приказы", parent: tid(200), mode: modeInherit, owner: f.owner.id}
	f.fin = &folder{id: tid(202), name: "Финансы", parent: tid(200), mode: modeInherit, owner: f.owner.id, sens: sensFinance}
	f.listed = &folder{id: tid(203), name: "Закрытая", parent: tid(200), mode: modeListed, owner: f.owner.id}
	for _, x := range []*folder{f.north, f.orders, f.fin, f.listed} {
		w.addFolder(x)
	}
	f.order = &document{id: tid(300), kind: "text", title: "Приказ № 12", folder: f.orders.id, owner: f.logist.id, mode: modeInherit,
		status: "draft", version: 3}
	f.sheet = &document{id: tid(301), kind: "sheet", title: "Начисления", folder: f.fin.id, owner: f.owner.id, mode: modeInherit,
		status: "draft", sens: sensFinance, version: 1}
	w.addDoc(f.order)
	w.addDoc(f.sheet)
	return f
}

// role makes a role with the actions and the template of the catalog.
func (f *fixture) role(n int, template string, actions ...string) *role {
	r := &role{id: tid(n), name: template, template: template, actions: actions}
	r.finish()
	f.w.roles[r.id] = r
	return r
}

func (f *fixture) grant(m *member, r *role, kind string, ref uuid.UUID) {
	f.w.grants[m.id] = append(f.w.grants[m.id], grant{person: m.id, role: r, kind: kind, ref: ref})
}

func TestRoleLevels(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name     string
		template string
		actions  []string
		want     level
	}{
		{"manager template", templateManager, nil, levelManage},
		{"editor template", templateEditor, nil, levelEdit},
		{"reader template", templateReader, nil, levelView},
		{"share is settings", "", []string{"docs.read", "docs.share"}, levelManage},
		{"folders.manage is settings", "", []string{"docs.folders.manage"}, levelManage},
		{"update edits", "", []string{"docs.read", "docs.update"}, levelEdit},
		{"suggest alone", "", []string{"docs.read", "docs.suggest"}, levelSuggest},
		{"comment alone", "", []string{"docs.read", "docs.comment"}, levelComment},
		{"read only", "", []string{"docs.read"}, levelView},
		{"no docs actions", "", []string{"tasks.read"}, levelNone},
	} {
		r := &role{template: c.template, actions: c.actions}
		r.finish()
		if r.level != c.want {
			t.Errorf("%s: level %d, want %d", c.name, r.level, c.want)
		}
	}
}

func TestOwnerOfBusinessSeesAndManagesEverything(t *testing.T) {
	t.Parallel()
	f := newFixture()
	a := f.w.accessToDoc(f.owner, f.order)
	if a.level != levelManage || !a.owner {
		t.Fatalf("owner: level %d owner %v, want manage and owner", a.level, a.owner)
	}
	if got := a.chain[len(a.chain)-1].title; got != "Владелец бизнеса" {
		t.Fatalf("last step %q, want «Владелец бизнеса»", got)
	}
}

func TestBlockedMemberHasNothing(t *testing.T) {
	t.Parallel()
	f := newFixture()
	a := f.w.accessToDoc(f.blocked, f.order)
	if a.level != levelNone || a.chain[0].kind != stepNo {
		t.Fatalf("blocked: %+v, want none and a «no» step first", a)
	}
}

func TestInvitedMemberWaitsForLogin(t *testing.T) {
	t.Parallel()
	f := newFixture()
	f.w.shareFolder(f.orders, entry{who: whoMember, ref: f.invited.id, level: levelView})
	a := f.w.accessToDoc(f.invited, f.order)
	if a.level != levelView || a.chain[0].kind != stepWait {
		t.Fatalf("invited: %+v, want view and a «wait» step first", a)
	}
}

func TestDriverNeverSeesFinance(t *testing.T) {
	t.Parallel()
	f := newFixture()
	f.w.shareFolder(f.fin, entry{who: whoAll, level: levelManage})
	a := f.w.accessToDoc(f.driver, f.sheet)
	if a.level != levelNone || !a.fn {
		t.Fatalf("driver on a finance document: %+v, want none by the function", a)
	}
	// the same list opens a plain folder document to the driver
	f.w.shareFolder(f.orders, entry{who: whoAll, level: levelView})
	if got := f.w.accessToDoc(f.driver, f.order).level; got != levelView {
		t.Fatalf("driver on a plain document: level %d, want view", got)
	}
}

func TestAreaRoleReachesFoldersOfItsUnit(t *testing.T) {
	t.Parallel()
	f := newFixture()
	r := f.role(900, "", "docs.read", "docs.update")
	f.grant(f.other, r, scopeUnit, tid(100))
	if got := f.w.accessToDoc(f.other, f.order).level; got != levelEdit {
		t.Fatalf("role of the unit of the folder: level %d, want edit", got)
	}
	f.w.grants[f.foreman.id] = nil
	f.grant(f.foreman, r, scopeUnit, tid(101))
	if got := f.w.accessToDoc(f.foreman, f.order).level; got != levelNone {
		t.Fatalf("role of another unit: level %d, want none", got)
	}
}

func TestTenantRoleReachesFoldersWithoutUnitOnly(t *testing.T) {
	t.Parallel()
	f := newFixture()
	r := f.role(900, "", "docs.read")
	f.grant(f.other, r, scopeTenant, uuid.Nil)
	if got := f.w.accessToDoc(f.other, f.order).level; got != levelView {
		t.Fatalf("role of the whole organization: level %d, want view (tenant covers every unit)", got)
	}
}

func TestFolderRoleAssignmentAndListedFolder(t *testing.T) {
	t.Parallel()
	f := newFixture()
	editor := f.role(901, templateEditor, "docs.read", "docs.update")
	f.grant(f.other, editor, scopeFolder, f.north.id)
	if got := f.w.accessToDoc(f.other, f.order).level; got != levelEdit {
		t.Fatalf("role of the top folder: level %d, want edit on a subfolder document", got)
	}
	inListed := &document{id: tid(302), kind: "pdf", title: "Секрет", folder: f.listed.id, owner: f.owner.id, mode: modeInherit, version: 1}
	f.w.addDoc(inListed)
	a := f.w.accessToDoc(f.other, inListed)
	if a.level != levelNone {
		t.Fatalf("«Только выбранные» folder: level %d, want none for a role of the folder above", a.level)
	}
	f.w.shareFolder(f.listed, entry{who: whoMember, ref: f.other.id, level: levelComment})
	if got := f.w.accessToDoc(f.other, inListed).level; got != levelComment {
		t.Fatalf("listed folder with the member in the list: level %d, want comment", got)
	}
}

func TestDocumentListedModeBreaksFolderAccess(t *testing.T) {
	t.Parallel()
	f := newFixture()
	f.w.shareFolder(f.orders, entry{who: whoAll, level: levelEdit})
	if got := f.w.accessToDoc(f.other, f.order).level; got != levelEdit {
		t.Fatalf("folder list: level %d, want edit", got)
	}
	f.order.mode = modeListed
	if got := f.w.accessToDoc(f.other, f.order).level; got != levelNone {
		t.Fatalf("document «Только выбранные»: level %d, want none", got)
	}
	f.w.shareDoc(f.order, entry{who: whoMember, ref: f.other.id, level: levelSuggest})
	if got := f.w.accessToDoc(f.other, f.order).level; got != levelSuggest {
		t.Fatalf("listed document with the member: level %d, want suggest", got)
	}
}

func TestOwnerOfDocumentManagesIt(t *testing.T) {
	t.Parallel()
	f := newFixture()
	f.order.mode = modeListed
	if got := f.w.accessToDoc(f.logist, f.order).level; got != levelManage {
		t.Fatalf("owner of the document: level %d, want manage even in the listed mode", got)
	}
}

func TestExpiredEntryGivesNothing(t *testing.T) {
	t.Parallel()
	f := newFixture()
	past := time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC)
	today := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	f.w.shareFolder(f.orders, entry{who: whoMember, ref: f.other.id, level: levelView, until: &past})
	if got := f.w.accessToDoc(f.other, f.order).level; got != levelNone {
		t.Fatalf("entry until yesterday: level %d, want none", got)
	}
	f.w.shares[f.orders.id] = nil
	f.w.shareFolder(f.orders, entry{who: whoMember, ref: f.other.id, level: levelView, until: &today})
	if got := f.w.accessToDoc(f.other, f.order).level; got != levelView {
		t.Fatalf("entry until today: level %d, want view (the last day counts)", got)
	}
}

func TestGroupAndRoleEntries(t *testing.T) {
	t.Parallel()
	f := newFixture()
	f.w.groups[tid(800)] = &group{id: tid(800), name: "Логисты", members: []uuid.UUID{f.other.id}}
	f.w.shareFolder(f.orders, entry{who: whoGroup, ref: tid(800), level: levelComment})
	if got := f.w.accessToDoc(f.other, f.order).level; got != levelComment {
		t.Fatalf("group entry: level %d, want comment", got)
	}
	if got := f.w.accessToDoc(f.foreman, f.order).level; got != levelNone {
		t.Fatalf("not in the group: level %d, want none", got)
	}
	r := f.role(902, "", "docs.read")
	f.grant(f.foreman, r, scopeUnit, tid(100))
	f.w.shareFolder(f.fin, entry{who: whoRole, ref: r.id, unit: tid(100), level: levelView})
	if got := f.w.accessToDoc(f.foreman, f.sheet).level; got < levelView {
		t.Fatalf("role entry: level %d, want at least view", got)
	}
}

func TestRelationEntryNamesForemanOfObject(t *testing.T) {
	t.Parallel()
	f := newFixture()
	obj := tid(700)
	f.w.objects[obj] = repairObject{ID: obj, Foreman: f.foreman.id}
	f.w.shareFolder(f.orders, entry{who: whoRelation, obj: obj, level: levelEdit})
	if got := f.w.accessToDoc(f.foreman, f.order).level; got != levelEdit {
		t.Fatalf("foreman of the object: level %d, want edit", got)
	}
	if got := f.w.accessToDoc(f.other, f.order).level; got != levelNone {
		t.Fatalf("not the foreman: level %d, want none", got)
	}
}

func TestTemporaryGrantOfRoute(t *testing.T) {
	t.Parallel()
	f := newFixture()
	f.order.tmp = []tempGrant{{member: f.other.id, level: levelView, onlyVersion: 3, why: "ознакомление", keep: true}}
	a := f.w.accessToDoc(f.other, f.order)
	if a.level != levelView || a.onlyVersion != 3 {
		t.Fatalf("temporary grant: %+v, want view of version 3 only", a)
	}
}

func TestRightsByLevel(t *testing.T) {
	t.Parallel()
	f := newFixture()
	for _, c := range []struct {
		lvl                               level
		view, comment, suggest, edit      bool
		manage, route                     bool
		maxGrant                          level
		exportByLevel, shareWithoutVerb   bool
		shareWithSettingsVerb, wantLocked bool
	}{
		{levelView, true, false, false, false, false, false, levelView, false, false, false, false},
		{levelComment, true, true, false, false, false, false, levelComment, false, false, true, false},
		{levelSuggest, true, true, true, false, false, false, levelSuggest, false, false, true, false},
		{levelEdit, true, true, true, true, false, true, levelEdit, true, false, true, false},
		{levelManage, true, true, true, true, true, true, levelManage, true, true, true, false},
	} {
		rt := rightsOf(access{level: c.lvl}, f.order, false)
		if rt.view != c.view || rt.comment != c.comment || rt.suggest != c.suggest || rt.edit != c.edit || rt.manage != c.manage ||
			rt.route != c.route || rt.maxGrant != c.maxGrant || rt.export != c.exportByLevel || rt.share != c.shareWithoutVerb {
			t.Errorf("level %d: %+v", c.lvl, rt)
		}
		withVerb := rightsOf(access{level: c.lvl}, f.order, true)
		if withVerb.share != c.shareWithSettingsVerb {
			t.Errorf("level %d with the settings verb: share %v, want %v", c.lvl, withVerb.share, c.shareWithSettingsVerb)
		}
	}
}

func TestLockedDocumentCannotBeEdited(t *testing.T) {
	t.Parallel()
	f := newFixture()
	f.order.lock = true
	rt := rightsOf(access{level: levelEdit}, f.order, false)
	if !rt.locked || rt.edit || rt.suggest || rt.route || !rt.comment {
		t.Fatalf("locked document at edit level: %+v, want locked, comment only", rt)
	}
	f.order.lock, f.order.pdfa = false, true
	if rt = rightsOf(access{level: levelEdit}, f.order, false); !rt.locked || rt.route {
		t.Fatalf("PDF/A copy: %+v, want locked and no route", rt)
	}
}

func TestOwnerOfBusinessMayShareExternally(t *testing.T) {
	t.Parallel()
	f := newFixture()
	rt := rightsOf(f.w.accessToDoc(f.owner, f.order), f.order, false)
	if !rt.shareExternal || !rt.share || !rt.sign {
		t.Fatalf("owner: %+v, want external share, share and sign", rt)
	}
	rt = rightsOf(f.w.accessToDoc(f.logist, f.order), f.order, false)
	if rt.shareExternal {
		t.Fatalf("owner of the document, not of the business: %+v, want no external share (Q-W4.00-documents-4)", rt)
	}
}

func TestImpactOfMoveAndShare(t *testing.T) {
	t.Parallel()
	f := newFixture()
	f.w.shareFolder(f.orders, entry{who: whoMember, ref: f.other.id, level: levelView})
	f.w.shareFolder(f.north, entry{who: whoMember, ref: f.foreman.id, level: levelEdit})
	imp := f.w.impactOfMove(f.order, f.north)
	names := func(ps []impactPerson) []string {
		var out []string
		for _, p := range ps {
			out = append(out, p.member.name)
		}
		return out
	}
	// the foreman is listed in the top folder: moving up changes nothing for him inside the inherited chain, the
	// other loses the list of «Приказы»
	if got := names(imp.lose); len(got) != 1 || got[0] != f.other.name {
		t.Fatalf("lose %v, want only %q", got, f.other.name)
	}
	if len(imp.gain) != 0 {
		t.Fatalf("gain %v, want none", names(imp.gain))
	}
	shared := f.w.impactOfShare(f.order, modeListed, []entry{{who: whoMember, ref: f.other.id, level: levelComment}})
	if got := names(shared.gain); len(got) != 0 {
		t.Fatalf("share gain %v, want none: the other already reads", got)
	}
	if got := names(shared.up); len(got) != 1 || got[0] != f.other.name {
		t.Fatalf("share up %v, want the other raised to comment", got)
	}
	if got := names(shared.lose); len(got) != 1 || got[0] != f.foreman.name {
		t.Fatalf("share lose %v, want the foreman who falls out of the listed document", got)
	}
}
