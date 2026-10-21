package knowledge

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The access chain of the knowledge base (knowledge.js 14.10:71–181, kbAccess of W4.30): the cases of the domain
// tests on the same world (access.test.ts) — the server must answer as the domain and MSW do.

func ve(w *world, m, n string) [2]bool {
	a := w.access(mb(w, m), nd(w, n))
	return [2]bool{a.view, a.edit}
}

func TestLabels(t *testing.T) {
	t.Parallel()
	w := kbDb(testNow)
	assert.Equal(t, "Север Логистик", w.unitName(pid("f-msk-sever")))
	assert.Equal(t, "вся организация", w.unitName(pid("нет")))
	assert.Equal(t, "фирма «Север Логистик»", w.areaLabel(&space{unit: pid("f-msk-sever")}))
	assert.Equal(t, "регион «Москва»", w.areaLabel(&space{unit: pid("r-msk")}))
	assert.Equal(t, "вся организация", w.areaLabel(&space{}))
	for e, want := range map[entry]string{
		memberEntry("m-kotova", canView):                 "Марина Котова",
		memberEntry("нет", canView):                      "Сотрудник",
		groupEntry("g-drv", canView):                     "Группа «Водители Север»",
		roleEntry("r-driver", "f-msk-sever", canView):    "Роль «Водитель» · «Север Логистик»",
		roleEntry("r-driver", "", canView):               "Роль «Водитель»",
		roleEntry("r-kb-editor", "f-msk-sever", canView): "Роль «Редактор» в пространстве",
		relEntry("obj-42", canView):                      "Прораб объекта «ЖК Речной · квартира 42»",
		relEntry("obj-0", canView):                       "Прораб объекта",
	} {
		assert.Equal(t, want, w.entryLabel(e), "%+v", e)
	}
	// a group or a role that is not there keeps its reference (as the domain: «Группа «g-x»», «Роль «r-x»»)
	assert.Equal(t, "Группа «"+pid("g-x").String()+"»", w.entryLabel(groupEntry("g-x", canView)))
	assert.Equal(t, "Роль «"+pid("r-x").String()+"»", w.entryLabel(roleEntry("r-x", "", canView)))
}

func TestEntriesInSpace(t *testing.T) {
	t.Parallel()
	w := kbDb(testNow)
	log, gen := spc(w, "sp-log"), spc(w, "sp-gen")
	editor := roleEntry("r-kb-editor", "", canView)
	assert.True(t, w.entryHas(mb(w, "m-kotelnikova"), editor, log), "a role of a space acts in its space")
	assert.False(t, w.entryHas(mb(w, "m-kotelnikova"), editor, gen), "…and only there")
	assert.True(t, w.entryHas(mb(w, "m-kotova"), editor, gen))
	assert.Equal(t, []string{"Алексей Соколов"}, names(w.entryPeople(relEntry("obj-42", canView), log)), "the foreman by id")
	drv := groupEntry("g-drv", canView)
	assert.False(t, w.entryHas(mb(w, "m-gromov"), drv, log), "a blocked member is in no entry")
	assert.Equal(t, []string{"Илья Васильев"}, names(w.entryPeople(drv, log)))
	assert.True(t, w.entryHas(mb(w, "m-sokolov"), entry{who: whoAll}, log))
	assert.True(t, w.entryHas(mb(w, "m-vasiliev"), roleEntry("r-driver", "", canView), log), "a role without a unit — any grant of it")
	assert.False(t, w.entryHas(mb(w, "m-vasiliev"), roleEntry("r-driver", "r-msk", canView), log),
		"a grant of a firm does not cover its region")
}

func TestLeadsAndOwner(t *testing.T) {
	t.Parallel()
	w := kbDb(testNow)
	assert.Equal(t, []string{"Марина Котова"}, names(w.leads(spc(w, "sp-log"))))
	assert.Empty(t, w.leads(spc(w, "sp-gen")))
	// PD-60: an assignment of a space acts through its last day
	last := gdef{"x1", "m-sokolov", "r-kb-lead", scopeSpace, "sp-own", "30.09.2026"}
	on := kbDb(time.Date(2026, 9, 30, 23, 0, 0, 0, moscow), last)
	off := kbDb(time.Date(2026, 10, 1, 0, 1, 0, 0, moscow), last)
	assert.Equal(t, []string{"Алексей Соколов"}, names(on.leads(spc(on, "sp-own"))))
	assert.Empty(t, off.leads(spc(off, "sp-own")))
}

func TestAccessViewEdit(t *testing.T) {
	t.Parallel()
	w := kbDb(testNow)
	for _, c := range []struct {
		m, n       string
		view, edit bool
	}{
		{"m-owner", "own-1", true, true},
		{"m-owner", "arch", true, true},
		{"m-vasiliev", "log-home", true, false},
		{"m-vasiliev", "kb-1", true, false},
		{"m-vasiliev", "kb-1a", true, false},
		{"m-vasiliev", "f-drv", true, false},
		{"m-vasiliev", "drv-1", true, false},
		{"m-vasiliev", "drv-4", true, false},
		{"m-vasiliev", "fin", false, false},
		{"m-vasiliev", "fin-1", false, false},
		{"m-vasiliev", "arch", false, false},
		{"m-vasiliev", "gen-1", true, false},
		{"m-vasiliev", "gen-3", true, true},
		{"m-vasiliev", "own-1", false, false},
		{"m-vasiliev", "obj", false, false},
		{"m-kotova", "fin", true, true},
		{"m-kotova", "drv-4", true, true},
		{"m-kotova", "arch", true, true},
		{"m-kotova", "gen-1", true, true},
		{"m-kotova", "gen-3", true, false},
		{"m-kotova", "obj", false, false},
		{"m-kotova", "own-1", false, false},
		{"m-kotelnikova", "fin", true, false},
		{"m-kotelnikova", "fin-1", true, false},
		{"m-kotelnikova", "kb-1", true, true},
		{"m-kotelnikova", "drv-1", true, true},
		{"m-kotelnikova", "drv-4", true, false},
		{"m-sokolov", "obj", true, false},
		{"m-sokolov", "o-1", true, false},
		{"m-sokolov", "o-2", true, true},
		{"m-sokolov", "o-5", false, false},
		{"m-sokolov", "log-home", false, false},
		{"m-gromov", "gen-3", false, false},
	} {
		assert.Equal(t, [2]bool{c.view, c.edit}, ve(w, c.m, c.n), "%s → %s", c.m, c.n)
	}
}

func TestAccessChain(t *testing.T) {
	t.Parallel()
	w := kbDb(testNow)
	org := step{stepOK, "Организация", "Активный сотрудник"}
	a := w.access(mb(w, "m-owner"), nd(w, "own-1"))
	assert.Equal(t, access{view: true, edit: true, lead: true, owner: true, create: true,
		chain: []step{org, {stepOK, "Владелец бизнеса", "Видит и правит всё"}}}, a)
	assert.Equal(t, []step{{stepNo, "Организация", "Сотрудник заблокирован, доступ не действует"}},
		w.access(mb(w, "m-gromov"), nd(w, "gen-1")).chain)
	assert.Equal(t, []step{
		{stepWait, "Организация", "Приглашение не принято: доступ начнёт действовать после входа"},
		{stepNo, "Пространство «Общее»", "Нет роли в области «вся организация», не участник пространства"},
	}, w.access(mb(w, "m-petrova"), nd(w, "gen-1")).chain)

	a = w.access(mb(w, "m-vasiliev"), nd(w, "kb-1"))
	assert.Equal(t, access{view: true, chain: []step{
		org,
		{stepOK, "Пространство «Логистика»", "Читатель по уровню «Ограниченное»: роль «Водитель»"},
		{stepInherit, "«Регламент приёмки смены»", "Доступ как у родителя"},
	}}, a)
	assert.Equal(t, []step{
		{stepOK, "«Водителям»", "В списке: Роль «Водитель» · «Север Логистик» — читает"},
		{stepOK, "«Маршруты»", "Читают все, правят выбранные"},
	}, from(w.access(mb(w, "m-vasiliev"), nd(w, "drv-4")).chain, 2))
	assert.Equal(t, []step{{stepOK, "«Дежурства»", "Читают все, правят выбранные: Группа «Водители Север»"}},
		from(w.access(mb(w, "m-vasiliev"), nd(w, "gen-3")).chain, 2))
	assert.Equal(t, []step{{stepNo, "Пространство «Ремонт и стройка»", "Нет роли в области «вся организация», не участник пространства"}},
		from(w.access(mb(w, "m-kotova"), nd(w, "o-5")).chain, 1))
	assert.Equal(t, []step{
		{stepOK, "Пространство «Логистика»", "Руководитель пространства · назначение в пространстве"},
		{stepOK, "«Тарифы и начисления»", "В списке: Марина Котова — читает"},
	}, from(w.access(mb(w, "m-kotova"), nd(w, "fin")).chain, 1))
	assert.Equal(t, []step{{stepNo, "«Гарантия»", "Свой доступ «Только выбранные»: нет в списке"}},
		from(w.access(mb(w, "m-sokolov"), nd(w, "o-5")).chain, 3))
	assert.Equal(t, step{stepNo, "Пространство «Руководство»", "Закрытое: только участники и владелец бизнеса"},
		last(w.access(mb(w, "m-vasiliev"), nd(w, "own-1")).chain))
}

func TestAccessLeadSeesListed(t *testing.T) {
	t.Parallel()
	w := kbDb(testNow, gdef{"x1", "m-sokolov", "r-kb-lead", scopeSpace, "sp-rep", ""})
	a := w.access(mb(w, "m-sokolov"), nd(w, "o-5"))
	assert.True(t, a.view && a.edit && a.lead && a.create, "%+v", a)
	assert.Equal(t, []step{
		{stepOK, "«ЖК Речной · квартира 42»", "В списке: Прораб объекта «ЖК Речной · квартира 42» — читает"},
		{stepOK, "«Гарантия»", "Свой доступ; руководитель пространства видит всё"},
	}, from(a.chain, 2))
}

func TestAccessFunctionDriver(t *testing.T) {
	t.Parallel()
	w := kbDb(testNow, gdef{"x1", "m-akhmedov", "r-kb-lead", scopeSpace, "sp-log", ""})
	a := w.access(mb(w, "m-akhmedov"), nd(w, "fin-1"))
	assert.True(t, !a.view && !a.edit && a.fn, "%+v", a)
	assert.Equal(t, step{stepNo, "Функция «Водитель»", "Финансовые страницы закрыты всегда"}, last(a.chain))
	a = w.access(mb(w, "m-vasiliev"), nd(w, "fin"))
	assert.True(t, !a.view && a.fn, "%+v", a)
}

func TestAccessCreateAndArchive(t *testing.T) {
	t.Parallel()
	w := kbDb(testNow)
	a := w.access(mb(w, "m-kotova"), nd(w, "kb-1"))
	assert.True(t, a.lead && a.create)
	a = w.access(mb(w, "m-kotelnikova"), nd(w, "kb-1"))
	assert.True(t, !a.lead && a.create)
	a = w.access(mb(w, "m-kotelnikova"), nd(w, "arch"))
	assert.True(t, a.view && a.edit, "an editor sees the archive")
	a = w.access(mb(w, "m-vasiliev"), nd(w, "arch"))
	assert.True(t, !a.view && !a.create, "a reader does not")
}

func TestAccessPageAssignment(t *testing.T) {
	t.Parallel()
	read := gdef{"akb-9", "m-morozova", "r-kb-reader", scopePage, "kb-1", "31.10.2026"}
	w := kbDb(testNow, read)
	assert.Equal(t, [2]bool{true, false}, ve(w, "m-morozova", "kb-1"))
	assert.Equal(t, [2]bool{true, false}, ve(w, "m-morozova", "kb-1a"))
	assert.Equal(t, [2]bool{false, false}, ve(w, "m-morozova", "log-home"), "the branch opens the page, not the space")
	assert.Equal(t, []step{
		{stepOK, "Организация", "Активный сотрудник"},
		{stepOK, "Ветка «Регламент приёмки смены»", "«Читатель» с областью этой страницы до 31.10.2026"},
		{stepInherit, "«Чек-лист приёмки»", "Доступ как у родителя"},
	}, w.access(mb(w, "m-morozova"), nd(w, "kb-1a")).chain)
	in := kbDb(time.Date(2026, 10, 31, 22, 0, 0, 0, moscow), read)
	out := kbDb(time.Date(2026, 11, 1, 9, 0, 0, 0, moscow), read)
	assert.True(t, in.access(mb(in, "m-morozova"), nd(in, "kb-1")).view, "PD-60: in force through its last day")
	assert.False(t, out.access(mb(out, "m-morozova"), nd(out, "kb-1")).view, "…and not after it")
	gone := kbDb(testNow, gdef{"x", "m-morozova", "r-нет", scopePage, "kb-1", ""})
	assert.Equal(t, [2]bool{false, false}, ve(gone, "m-morozova", "kb-1"), "an assignment of a deleted role gives nothing")
}

func TestAccessAreaRoles(t *testing.T) {
	t.Parallel()
	// PD-53: a role of a project with rights of the knowledge base gives no verbs of an area
	w := kbDb(testNow)
	addRole(w, "r-kbx", "Проектная с БЗ", actionRead, actionCreate, actionUpdate)
	addGrant(w, gdef{"x1", "m-sokolov", "r-kbx", "project", "fleet", ""})
	assert.Equal(t, [2]bool{true, false}, ve(w, "m-sokolov", "gen-1"), "«своё» of the foreman reads an open space of the organization")
	w.grants[pid("m-sokolov")] = w.grants[pid("m-sokolov")][1:] // without a4 (self)
	assert.Equal(t, [2]bool{false, false}, ve(w, "m-sokolov", "gen-1"))

	w = kbDb(testNow)
	addRole(w, "r-writer", "Автор регламентов", actionRead, actionCreate)
	addGrant(w, gdef{"x1", "m-akhmedov", "r-writer", scopeUnit, "f-msk-sever", ""})
	a := w.access(mb(w, "m-akhmedov"), nd(w, "gen-2"))
	assert.True(t, a.view && a.edit && a.create, "the author of a page with knowledge.create edits it: %+v", a)
	a = w.access(mb(w, "m-akhmedov"), nd(w, "gen-1"))
	assert.True(t, a.view && !a.edit && a.create, "%+v", a)
	a = w.access(mb(w, "m-akhmedov"), nd(w, "gen-3"))
	assert.True(t, a.view && !a.edit && !a.create, "%+v", a)
	a = w.access(mb(w, "m-akhmedov"), nd(w, "log-home"))
	assert.True(t, a.view && !a.edit && !a.create, "a limited space: reading only: %+v", a)

	w = kbDb(testNow, gdef{"x1", "m-ilyin", "r-manager", scopeUnit, "f-msk-yug", ""})
	assert.Equal(t, [2]bool{false, false}, ve(w, "m-ilyin", "log-home"), "a role of another firm")
	addGrant(w, gdef{"x2", "m-ilyin", "r-manager", scopeUnit, "r-msk", ""})
	assert.Equal(t, [2]bool{true, false}, ve(w, "m-ilyin", "log-home"), "a role of the region covers its firm")

	w = kbDb(testNow)
	spc(w, "sp-gen").access = ""
	assert.Equal(t, [2]bool{false, false}, ve(w, "m-vasiliev", "gen-1"), "a space without a level is closed")
	assert.Equal(t, step{stepNo, "Пространство «Общее»", "Закрытое: только участники и владелец бизнеса"},
		last(w.access(mb(w, "m-vasiliev"), nd(w, "gen-1")).chain))
}

func TestReach(t *testing.T) {
	t.Parallel()
	w := kbDb(testNow)
	for _, c := range []struct {
		m, n string
		ok   bool
		why  string
	}{
		{"m-gromov", "gen-1", false, "сотрудник заблокирован"},
		{"m-owner", "own-1", true, ""},
		{"m-vasiliev", "fin-1", false, "функция «Водитель» не открывает финансовые страницы"},
		{"m-vasiliev", "kb-1a", true, ""},
		{"m-sokolov", "o-1", true, ""},
		{"m-kotova", "o-1", false, "не видит родителя «ЖК Речной · квартира 42»"},
		{"m-vasiliev", "gen-1", true, ""},
		{"m-vasiliev", "own-1", false, "не участник закрытого пространства"},
		{"m-kotova", "obj", false, "нет роли в области «вся организация» и не участник пространства"},
	} {
		ok, why := w.reach(mb(w, c.m), nd(w, c.n))
		assert.Equal(t, c.ok, ok, "%s → %s", c.m, c.n)
		assert.Equal(t, c.why, why, "%s → %s", c.m, c.n)
	}
	ppl, ok, no := w.entryReach(roleEntry("r-driver", "", canView), spc(w, "sp-log"), nd(w, "fin-1"))
	assert.Equal(t, []string{"Илья Васильев"}, names(ppl))
	assert.Empty(t, ok)
	require.Len(t, no, 1)
	assert.Equal(t, reachOf{ppl[0], "функция «Водитель» не открывает финансовые страницы"}, no[0])
	_, ok, no = w.entryReach(groupEntry("g-disp", canView), spc(w, "sp-log"), nd(w, "kb-1"))
	require.Len(t, ok, 1)
	assert.Equal(t, "Марина Котова", ok[0].m.name)
	require.Len(t, no, 1)
	assert.Equal(t, "Олеся Петрова", no[0].m.name)
	assert.Equal(t, "не видит родителя «Регламенты»", no[0].why)
}

func TestSpaceMy(t *testing.T) {
	t.Parallel()
	w := kbDb(testNow)
	for _, c := range []struct {
		m, sp string
		my    spaceMy
	}{
		{"m-owner", "sp-own", spaceMy{owner: true, lead: true, view: true, create: true, edit: true, role: "Владелец бизнеса"}},
		{"m-vasiliev", "sp-log", spaceMy{view: true, role: "Читатель по уровню «Ограниченное»"}},
		{"m-kotova", "sp-log", spaceMy{lead: true, view: true, create: true, edit: true, role: "Руководитель пространства"}},
		{"m-kotelnikova", "sp-log", spaceMy{view: true, create: true, edit: true, role: "Редактор"}},
		{"m-kotova", "sp-rep", spaceMy{}},
	} {
		assert.Equal(t, c.my, w.spaceMy(mb(w, c.m), spc(w, c.sp)), "%s в %s", c.m, c.sp)
	}
}

func TestSpaceVisible(t *testing.T) {
	t.Parallel()
	w := kbDb(testNow, gdef{"akb-9", "m-morozova", "r-kb-reader", scopePage, "kb-1", ""})
	assert.True(t, w.spaceVisible(mb(w, "m-morozova"), spc(w, "sp-log")), "a visible page shows its space («по ссылке»)")
	assert.False(t, w.spaceVisible(mb(w, "m-morozova"), spc(w, "sp-own")))
	assert.False(t, w.spaceVisible(mb(w, "m-kotova"), spc(w, "sp-rep")))
	assert.True(t, w.spaceVisible(mb(w, "m-vasiliev"), spc(w, "sp-rep")))
}

func addRole(w *world, proto, name string, actions ...string) {
	w.roles[pid(proto)] = &role{id: pid(proto), name: name, kind: "custom", actions: actions, verbs: verbsOf(actions)}
}

func names(ms []*member) []string {
	out := make([]string, 0, len(ms))
	for _, m := range ms {
		out = append(out, m.name)
	}
	return out
}

// from is s from index i (empty when s is shorter).
func from(s []step, i int) []step {
	if i > len(s) {
		return []step{}
	}
	return s[i:]
}

func last(s []step) step {
	if len(s) == 0 {
		return step{}
	}
	return s[len(s)-1]
}
