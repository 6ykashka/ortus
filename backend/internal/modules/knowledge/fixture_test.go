package knowledge

import (
	"strings"
	"time"

	"github.com/google/uuid"
)

// The world of the unit tests: «Альта» of the raw seed 14.10 (people, roles, groups, assignments of cmd/seed and
// the domain core) with the roles of spaces and either the small tree of the domain tests (kbDb, fixture.test-util.ts
// of W4.30 — the same expectations) or the knowledge base of the seed (demoDb, demo.go).

// testNow is the «today» of the knowledge base of the domain tests: 01.10.2026 in Moscow.
var testNow = time.Date(2026, 10, 1, 10, 30, 0, 0, moscow)

// pid is the UUID of a prototype id of «Альта» (PD-30, as cmd/seed and seedUuid of MSW).
func pid(proto string) uuid.UUID {
	return uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:t-alta:"+proto))
}

type personDef struct {
	proto, name, status string
	owner, driver       bool
}

var altaPeople = []personDef{
	{"m-owner", "Дарья Зимина", memberActive, true, false},
	{"m-kotova", "Марина Котова", memberActive, false, false},
	{"m-vasiliev", "Илья Васильев", memberActive, false, true},
	{"m-morozova", "Анна Морозова", memberActive, false, false},
	{"m-sokolov", "Алексей Соколов", memberActive, false, false},
	{"m-petrova", "Олеся Петрова", memberInvited, false, false},
	{"m-gromov", "Кирилл Громов", memberBlocked, false, true},
	{"m-kotelnikova", "Вера Котельникова", memberActive, false, false},
	{"m-akhmedov", "Тимур Ахмедов", memberActive, false, true},
	{"m-ilyin", "Сергей Ильин", memberInvited, false, false},
}

type roleDef struct {
	proto, name, kind, template string
	actions                     []string
}

var allKnowledge = []string{actionRead, actionCreate, actionUpdate, actionPublish, actionOrganize, actionAccess, actionMembers,
	actionAutomation, actionSpaces}

func altaRoles() []roleDef {
	out := []roleDef{
		{"r-owner", "Владелец бизнеса", "system", "owner", allKnowledge},
		{"r-manager", "Менеджер логистики", "template", "logistics_manager", []string{actionRead, "fleet.trips.read"}},
		{"r-driver", "Водитель", "template", "driver", []string{actionRead, "fleet.trips.start"}},
		{"r-therapist", "Массажист", "template", "", []string{actionRead}},
		{"r-foreman", "Прораб", "template", "foreman", []string{actionRead}},
		{"r-pm", "Руководитель проекта", "template", "project_manager", []string{"tasks.read"}},
		{"r-approver", "Согласующий", "template", "project_approver", []string{"tasks.read"}},
		{"r-exec", "Исполнитель", "template", "project_executor", []string{"tasks.read"}},
		{"r-viewer", "Наблюдатель", "template", "project_viewer", []string{"tasks.read"}},
	}
	for _, r := range DemoRoles() {
		out = append(out, roleDef{r.ID, r.Name, "system", r.Template, r.Actions})
	}
	return out
}

// gdef is an assignment of a test: member is a member proto or «group:<proto>»; until — the last day «ДД.ММ.ГГГГ».
type gdef struct {
	id, member, role, kind, ref, until string
}

func altaGrants() []gdef {
	return []gdef{
		{"a1", "m-owner", "r-owner", scopeTenant, "", ""},
		{"ap1", "m-kotova", "r-pm", "project", "fleet", ""},
		{"ap2", "group:g-drv", "r-exec", "project", "fleet", ""},
		{"ap3", "m-kotelnikova", "r-approver", "project", "fleet", ""},
		{"a2", "group:g-drv", "r-driver", scopeUnit, "f-msk-sever", ""},
		{"a3", "m-morozova", "r-therapist", scopeSelf, "", ""},
		{"a4", "m-sokolov", "r-foreman", scopeSelf, "", ""},
		{"akb-1", "m-kotova", "r-kb-lead", scopeSpace, "sp-log", ""},
		{"akb-2", "m-kotelnikova", "r-kb-editor", scopeSpace, "sp-log", ""},
		{"akb-3", "m-kotova", "r-kb-editor", scopeSpace, "sp-gen", ""},
	}
}

var altaGroups = map[string]struct {
	name    string
	members []string
}{
	"g-disp": {"Диспетчеры Север", []string{"m-kotova", "m-petrova"}},
	"g-drv":  {"Водители Север", []string{"m-vasiliev", "m-gromov"}},
}

// altaBase is the world of «Альта» at now without spaces and nodes; extra are more assignments.
func altaBase(now time.Time, extra ...gdef) *world {
	w := newWorld(now)
	for _, u := range []unit{
		{id: pid("r-msk"), kind: "region", name: "Москва"},
		{id: pid("r-smr"), kind: "region", name: "Самара"},
		{id: pid("f-msk-sever"), parent: pid("r-msk"), kind: "company", name: "Север Логистик"},
		{id: pid("f-msk-yug"), parent: pid("r-msk"), kind: "company", name: "Юг Транс"},
		{id: pid("f-smr-volga"), parent: pid("r-smr"), kind: "company", name: "Волга Логистик"},
	} {
		w.units[u.id] = &u
	}
	for _, p := range altaPeople {
		w.addMember(&member{id: pid(p.proto), name: p.name, status: p.status, owner: p.owner, driver: p.driver})
	}
	for _, r := range altaRoles() {
		w.roles[pid(r.proto)] = &role{id: pid(r.proto), name: r.name, kind: r.kind, template: r.template, actions: r.actions,
			verbs: verbsOf(r.actions)}
	}
	for proto, g := range altaGroups {
		gr := &group{id: pid(proto), name: g.name}
		for _, m := range g.members {
			gr.members = append(gr.members, pid(m))
		}
		w.groups[gr.id] = gr
	}
	for _, g := range append(altaGrants(), extra...) {
		addGrant(w, g)
	}
	return w
}

// addGrant adds an assignment in force at w.now (PD-60: through its last day in Moscow).
func addGrant(w *world, d gdef) {
	r := w.roles[pid(d.role)]
	if r == nil {
		return // an assignment of a deleted role gives nothing
	}
	g := grant{id: pid(d.id), role: r, verbs: r.verbs, kind: d.kind, descendants: d.kind == scopeUnit}
	if d.ref != "" {
		g.ref = pid(d.ref)
	}
	if d.until != "" {
		end := dateOf(d.until).Add(21 * time.Hour) // midnight of the next day in Moscow
		if !w.now.Before(end) {
			return
		}
		g.until = &end
	}
	people := []uuid.UUID{pid(d.member)}
	if proto, ok := strings.CutPrefix(d.member, "group:"); ok {
		g.group = pid(proto)
		people = w.groups[g.group].members
	}
	for _, p := range people {
		g.person = p
		w.grants[p] = append(w.grants[p], g)
	}
}

// testSpace adds a space of the tests.
func testSpace(w *world, id, name, unitProto, level string) {
	sp := &space{id: pid(id), name: name, unit: uuid.Nil, access: level, revision: 1, icon: "menu_book", color: "#2B5479"}
	if unitProto != "" {
		sp.unit = pid(unitProto)
	}
	w.addSpace(sp)
}

// opt changes a node of a test.
type opt func(*node)

func title(t string) opt            { return func(n *node) { n.title = t } }
func kindOf(k string) opt           { return func(n *node) { n.kind = k } }
func archived() opt                 { return func(n *node) { n.archived = true } }
func finance() opt                  { return func(n *node) { n.finance = true } }
func owner(proto string) opt        { return func(n *node) { n.owner = pid(proto) } }
func objOf(proto string) opt        { return func(n *node) { n.obj = pid(proto) } }
func mode(m string, l ...entry) opt { return func(n *node) { n.mode, n.list = m, l } }

// mk adds a node of a test (mkNode of the domain fixture).
func mk(w *world, id, sp, parent string, pos int, opts ...opt) *node {
	n := &node{
		id: pid(id), space: pid(sp), pos: pos, kind: kindPage, title: "Страница " + id, mode: modeInherit,
		status: statusActive, owner: pid("m-owner"), accessRev: 1, created: testNow,
		versions: []version{{v: 1, at: dateOf("20.09.2026"), by: pid("m-owner"), author: "Дарья Зимина", body: "Текст " + id}},
	}
	if parent != "" {
		n.parent = pid(parent)
	}
	for _, o := range opts {
		o(n)
	}
	w.nodes[n.id] = n
	return n
}

// fixDepths sets the depth of every node from its path.
func fixDepths(w *world) {
	for _, n := range w.nodes {
		n.depth = w.depth(n)
	}
}

func roleEntry(roleProto, unitProto, can string) entry {
	e := entry{who: whoRole, ref: pid(roleProto), can: can}
	if unitProto != "" {
		e.unit = pid(unitProto)
	}
	return e
}

func memberEntry(proto, can string) entry { return entry{who: whoMember, ref: pid(proto), can: can} }
func groupEntry(proto, can string) entry  { return entry{who: whoGroup, ref: pid(proto), can: can} }
func relEntry(obj, can string) entry      { return entry{who: whoRelation, obj: pid(obj), can: can} }

// ed is «Редакторы пространства правят».
var ed = roleEntry("r-kb-editor", "", canEdit)

// kbDb is the world of the domain tests of W4.30 (fixture.test-util.ts): «Альта» with the roles of spaces, the
// objects obj-42 (foreman Алексей Соколов) and obj-45 (no foreman) and the small tree.
func kbDb(now time.Time, extra ...gdef) *world {
	w := altaBase(now, extra...)
	w.objects[pid("obj-42")] = RepairObject{ID: pid("obj-42"), Name: "ЖК Речной · квартира 42", Foreman: pid("m-sokolov"),
		ForemanName: "Алексей Соколов"}
	w.objects[pid("obj-45")] = RepairObject{ID: pid("obj-45"), Name: "Дом 120 м², Истра"}
	testSpace(w, "sp-log", "Логистика", "f-msk-sever", levelLimited)
	testSpace(w, "sp-gen", "Общее", "", levelOpen)
	testSpace(w, "sp-own", "Руководство", "", levelClosed)
	testSpace(w, "sp-rep", "Ремонт и стройка", "", levelLimited)
	mk(w, "log-home", "sp-log", "", 0, title(homeTitle))
	mk(w, "f-reg", "sp-log", "", 1, kindOf(kindFolder), title("Регламенты"))
	mk(w, "kb-1", "sp-log", "f-reg", 1, title("Регламент приёмки смены"))
	mk(w, "kb-1a", "sp-log", "kb-1", 1, title("Чек-лист приёмки"))
	mk(w, "f-drv", "sp-log", "", 2, kindOf(kindFolder), title("Водителям"),
		mode(modeListed, roleEntry("r-driver", "f-msk-sever", canView), ed))
	mk(w, "drv-1", "sp-log", "f-drv", 1, title("Памятка водителя"))
	mk(w, "drv-4", "sp-log", "f-drv", 2, kindOf(kindDiagram), title("Маршруты"), mode(modeEdit))
	mk(w, "fin", "sp-log", "", 3, title("Тарифы и начисления"), finance(),
		mode(modeListed, memberEntry("m-kotova", canView), memberEntry("m-kotelnikova", canView)))
	mk(w, "fin-1", "sp-log", "fin", 1, title("Ставки по маршрутам"))
	mk(w, "arch", "sp-log", "", 4, title("Старый регламент"), archived())
	mk(w, "gen-home", "sp-gen", "", 0, title(homeTitle))
	mk(w, "gen-1", "sp-gen", "", 1, title("Контакты офиса"), owner("m-kotova"))
	mk(w, "gen-2", "sp-gen", "", 2, title("Как пользоваться Ортусом"), owner("m-akhmedov"))
	mk(w, "gen-3", "sp-gen", "", 3, title("Дежурства"),
		mode(modeEdit, memberEntry("m-vasiliev", canView), groupEntry("g-drv", canEdit)))
	mk(w, "own-1", "sp-own", "", 1, title("Политика начислений водителям"), mode(modeListed))
	mk(w, "obj", "sp-rep", "", 1, kindOf(kindFolder), title("ЖК Речной · квартира 42"), objOf("obj-42"),
		mode(modeListed, relEntry("obj-42", canView), ed))
	mk(w, "o-1", "sp-rep", "obj", 1, title("Паспорт объекта"))
	mk(w, "o-2", "sp-rep", "obj", 2, title("Как попасть на объект"), mode(modeEdit, relEntry("obj-42", canEdit), ed))
	mk(w, "o-5", "sp-rep", "obj", 5, title("Гарантия"), mode(modeListed, ed))
	fixDepths(w)
	return w
}

// n returns the node proto of w.
func nd(w *world, proto string) *node {
	n := w.nodes[pid(proto)]
	if n == nil {
		panic("no node " + proto)
	}
	return n
}

// mb returns the member proto of w.
func mb(w *world, proto string) *member {
	m := w.member[pid(proto)]
	if m == nil {
		panic("no member " + proto)
	}
	return m
}

// sp returns the space proto of w.
func spc(w *world, proto string) *space {
	s := w.space[pid(proto)]
	if s == nil {
		panic("no space " + proto)
	}
	return s
}
