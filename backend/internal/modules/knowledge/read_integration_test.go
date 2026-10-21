//go:build integration

package knowledge

import (
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	kapi "github.com/ortus/ortus-crm/backend/internal/api/knowledge"
)

// Reads of the knowledge base on «Альта» of the seed (msw/knowledge W4.04, domain W4.30): what each persona sees.
// They run before the commands (read_* < write_*): the commands change the knowledge base of the seed.

func spaces(t *testing.T, proto string) []kapi.KnowledgeSpace {
	t.Helper()
	res, err := srv.ListKnowledgeSpaces(as(t, proto), kapi.ListKnowledgeSpacesRequestObject{})
	require.NoError(t, err)
	out, ok := res.(kapi.ListKnowledgeSpaces200JSONResponse)
	require.True(t, ok, "%T", res)
	assert.Equal(t, noStore, *out.Headers.CacheControl)
	return out.Body.Items
}

func spaceNames(items []kapi.KnowledgeSpace) []string {
	out := []string{}
	for _, x := range items {
		out = append(out, x.Name)
	}
	return out
}

func TestReadSpaces(t *testing.T) { //nolint:paralleltest // reads the seed the commands change later
	owner := spaces(t, "m-owner")
	assert.Equal(t, []string{"Логистика", "Салон и SPA", "Руководство", "Ремонт и стройка", "Общее"}, spaceNames(owner))
	log := owner[0]
	assert.Equal(t, pid("sp-log"), log.Id)
	assert.Equal(t, "Фирма «Север Логистик»", log.AreaLabel)
	assert.Equal(t, kapi.KnowledgeSpaceAccessLimited, log.Access)
	assert.Equal(t, []string{"Марина Котова"}, log.LeadNames)
	assert.Equal(t, 16, log.PageCount, "18 nodes without the two folders")
	require.NotNil(t, log.HomeNodeId)
	assert.Equal(t, pid("kb-log-home"), *log.HomeNodeId)
	require.NotNil(t, log.LastUpdate)
	assert.Equal(t, "Журнал осмотров машин", log.LastUpdate.Title, "24.09: the title first")
	require.NotNil(t, log.OpenRequestCount)
	assert.Zero(t, *log.OpenRequestCount)
	assert.Equal(t, kapi.KnowledgeSpaceMy{Owner: true, Lead: true, View: true, Create: true, Edit: true, Role: "Владелец бизнеса"}, log.My)
	assert.Equal(t, "Вся организация", owner[1].AreaLabel)

	kotova := spaces(t, "m-kotova")
	assert.Equal(t, []string{"Логистика", "Общее"}, spaceNames(kotova), "a role of a project gives no verbs of an area (PD-53)")
	assert.Equal(t, "Руководитель пространства", kotova[0].My.Role)
	assert.True(t, kotova[0].My.Lead)
	assert.Equal(t, "Редактор", kotova[1].My.Role)
	assert.Nil(t, kotova[1].OpenRequestCount, "to the lead only")

	vasiliev := spaces(t, "m-vasiliev")
	assert.Equal(t, []string{"Логистика", "Салон и SPA", "Ремонт и стройка", "Общее"}, spaceNames(vasiliev))
	assert.Equal(t, "Читатель по уровню «Ограниченное»", vasiliev[0].My.Role)
	assert.Equal(t, 14, vasiliev[0].PageCount, "without the finance pages")
	assert.Equal(t, []string{"Салон и SPA", "Ремонт и стройка", "Общее"}, spaceNames(spaces(t, "m-morozova")),
		"«своё» reads the spaces of the whole organization (Q-W4.00-knowledge-15)")
}

func tree(t *testing.T, proto, sp string) ([]kapi.KnowledgeNodeSummary, error) {
	t.Helper()
	res, err := srv.GetKnowledgeSpaceTree(as(t, proto), kapi.GetKnowledgeSpaceTreeRequestObject{SpaceId: pid(sp)})
	if err != nil {
		return nil, err
	}
	out, ok := res.(kapi.GetKnowledgeSpaceTree200JSONResponse)
	require.True(t, ok, "%T", res)
	return out.Body.Nodes, nil
}

func titles(ns []kapi.KnowledgeNodeSummary) []string {
	out := []string{}
	for _, n := range ns {
		out = append(out, n.Title)
	}
	return out
}

func TestReadTree(t *testing.T) { //nolint:paralleltest // reads the seed the commands change later
	ns, err := tree(t, "m-vasiliev", "sp-log")
	require.NoError(t, err)
	assert.Equal(t, []string{"Обзор", "Регламенты", "Регламент приёмки смены", "Чек-лист приёмки", "Типовые замечания",
		"Как фотографировать машину при осмотре", "Выезд при критическом дефекте", "Журнал осмотров машин", "Схема сдачи смены",
		"Водителям", "Памятка водителя", "ДТП и поломка в пути", "Контакты диспетчеров", "Маршруты", "Договор аренды стоянки.pdf",
		"Форма «Осмотр машины»"}, titles(ns), "the finance branch is hidden from the driver")
	assert.Equal(t, kapi.KnowledgeNodeMy{}, ns[2].My, "a reader")
	assert.Equal(t, kapi.KnowledgeNodeSummaryAccessModeListed, ns[9].AccessMode)
	assert.Equal(t, kapi.KnowledgeNodeSummaryAccessModeEditListed, ns[13].AccessMode)
	assert.Equal(t, 2, ns[2].Version)
	kotova, err := tree(t, "m-kotova", "sp-log")
	require.NoError(t, err)
	assert.Len(t, kotova, 18)
	assert.Contains(t, titles(kotova), "Тарифы и начисления")
	_, err = tree(t, "m-kotova", "sp-rep")
	code, detail := problemOf(err)
	assert.Equal(t, "not_found", code)
	assert.Equal(t, "Пространство не найдено", detail)

	sokolov, err := tree(t, "m-sokolov", "sp-rep")
	require.NoError(t, err)
	assert.Equal(t, []string{"Обзор", "Технология работ", "Объекты", "ЖК Речной · квартира 42", "Паспорт объекта",
		"Как попасть на объект", "Акты скрытых работ", "Фотоотчёт"}, titles(sokolov), "the foreman reads his section, not «Гарантия»")
	assert.True(t, sokolov[5].My.Edit, "«Как попасть на объект» — the foreman edits (KB-01)")
	assert.False(t, sokolov[4].My.Edit)
}

func TestReadSearch(t *testing.T) { //nolint:paralleltest // reads the seed the commands change later
	search := func(proto, q string, sp *uuid.UUID) ([]kapi.KnowledgeSearchHit, error) {
		res, err := srv.SearchKnowledge(as(t, proto), kapi.SearchKnowledgeRequestObject{Params: kapi.SearchKnowledgeParams{Q: q, SpaceId: sp}})
		if err != nil {
			return nil, err
		}
		if v, ok := res.(kapi.SearchKnowledge422ApplicationProblemPlusJSONResponse); ok {
			return nil, &fieldsError{detail: *v.Body.Detail, field: (*v.Body.Violations)[0].Field, code: (*v.Body.Violations)[0].Code}
		}
		out, ok := res.(kapi.SearchKnowledge200JSONResponse)
		require.True(t, ok, "%T", res)
		return out.Body.Items, nil
	}
	hits, err := search("m-vasiliev", "  ОДОМЕТР ", nil)
	require.NoError(t, err)
	got := []string{}
	for _, h := range hits {
		got = append(got, h.Title)
	}
	assert.Equal(t, []string{"Регламент приёмки смены", "Чек-лист приёмки", "Типовые замечания", "Как фотографировать машину при осмотре"}, got)
	assert.Equal(t, []string{"Логистика", "Регламенты", "Регламент приёмки смены"}, hits[1].Path)
	assert.Equal(t, "Фото с пяти ракурсов, включая одометр. Пробег совпадает с одометром на фото. У каждого расхода есть чек. "+
		"Топлива не меньше, чем при выезде.", hits[1].Excerpt)
	hits, err = search("m-vasiliev", "тариф", nil)
	require.NoError(t, err)
	assert.Empty(t, hits, "hidden is invisible in the search")
	hits, err = search("m-kotova", "тариф", new(pid("sp-log")))
	require.NoError(t, err)
	require.Len(t, hits, 1)
	_, err = search("m-vasiliev", "о", nil)
	var fe *fieldsError
	require.ErrorAs(t, err, &fe)
	assert.Equal(t, "Введите не меньше 2 символов", fe.detail)
	assert.Equal(t, "q", fe.field)
	_, err = search("m-kotova", "тариф", new(pid("sp-rep")))
	code, _ := problemOf(err)
	assert.Equal(t, "not_found", code)
}

func getNode(t *testing.T, proto, id string) (kapi.KnowledgeNode, error) {
	t.Helper()
	res, err := srv.GetKnowledgeNode(as(t, proto), kapi.GetKnowledgeNodeRequestObject{NodeId: pid(id)})
	if err != nil {
		return kapi.KnowledgeNode{}, err
	}
	out, ok := res.(kapi.GetKnowledgeNode200JSONResponse)
	require.True(t, ok, "%T", res)
	assert.Equal(t, etag(out.Body.Revision), *out.Headers.ETag)
	return out.Body, nil
}

func TestReadNode(t *testing.T) { //nolint:paralleltest // reads the seed the commands change later
	n, err := getNode(t, "m-vasiliev", "kb-1")
	require.NoError(t, err)
	assert.Equal(t, 2, n.Version)
	assert.Equal(t, int64(2), n.Revision)
	assert.Equal(t, "Логистика", n.SpaceName)
	assert.Equal(t, []kapi.KnowledgeNodeRef{{Id: pid("kb-f-reg"), Title: "Регламенты"}}, n.Path)
	assert.Equal(t, "Дарья Зимина", n.Owner.DisplayName)
	require.NotNil(t, n.ReviewBy)
	assert.Equal(t, "2027-03-24", n.ReviewBy.Format("2006-01-02"))
	require.Len(t, n.Versions, 2)
	assert.Equal(t, 2, n.Versions[0].Version, "newest first")
	require.NotNil(t, n.Ack)
	assert.Equal(t, "роль «Водитель»", n.Ack.AudienceLabel)
	assert.True(t, n.Ack.Mine.Required)
	assert.False(t, n.Ack.Mine.Done)
	assert.Nil(t, n.Ack.Total, "the statistics — to the editors and the lead")
	assert.Nil(t, n.Ack.Log)

	lead, err := getNode(t, "m-kotova", "kb-1")
	require.NoError(t, err)
	require.NotNil(t, lead.Ack.Total)
	assert.Equal(t, 1, *lead.Ack.Total)
	assert.Equal(t, []string{"Илья Васильев"}, *lead.Ack.PendingNames)
	require.NotNil(t, lead.Ack.Log, "the log (KB-03) — to the lead")

	spa, err := getNode(t, "m-morozova", "kb-3")
	require.NoError(t, err)
	assert.True(t, spa.Ack.Mine.Done)

	_, err = getNode(t, "m-vasiliev", "kb-fin")
	code, detail := problemOf(err)
	assert.Equal(t, "not_found", code, "a finance page for the driver — 404, not function_blocked")
	assert.Equal(t, "Страница не найдена или недоступна", detail)

	d, err := getNode(t, "m-vasiliev", "kb-d1")
	require.NoError(t, err)
	require.NotNil(t, d.Diagram)
	assert.Equal(t, []string{"Сдача смены", "Фото и пробег", "Чеки расходов"}, d.Diagram.Steps)
	require.Len(t, d.Diagram.Outcomes, 2)
	assert.Equal(t, kapi.KnowledgeDiagramOutcomesToneWarn, d.Diagram.Outcomes[1].Tone)
	f, err := getNode(t, "m-vasiliev", "kb-file1")
	require.NoError(t, err)
	assert.Equal(t, &kapi.KnowledgeFile{SizeLabel: "1,2 МБ", Pages: 4}, f.File)
	l, err := getNode(t, "m-vasiliev", "kb-lnk1")
	require.NoError(t, err)
	assert.Equal(t, &kapi.KnowledgeLink{Label: "Форма «Осмотр машины» · действует версия 3", ModuleKey: "forms", Icon: "dynamic_form"}, l.Link)
	tb, err := getNode(t, "m-vasiliev", "kb-5")
	require.NoError(t, err)
	require.Len(t, tb.Tables, 1)
	assert.Equal(t, "Осмотры", tb.Tables[0].Title)
	assert.Len(t, tb.Tables[0].Columns, 7)
	require.Len(t, tb.Tables[0].Rows, 2)
	assert.Equal(t, "Рейс Р-196", tb.Tables[0].Rows[0].Cells[pid("c-obj").String()], "rows newest first")
	assert.Equal(t, "R-1012", tb.Tables[0].Rows[0].Source.ResponseNumber)

	res, err := srv.GetKnowledgeNodeVersion(as(t, "m-vasiliev"), kapi.GetKnowledgeNodeVersionRequestObject{NodeId: pid("kb-1"), Version: 1})
	require.NoError(t, err)
	v, ok := res.(kapi.GetKnowledgeNodeVersion200JSONResponse)
	require.True(t, ok)
	assert.Equal(t, 1, v.Body.Version)
	assert.Contains(t, v.Body.Body, "Машина возвращается в пул")
	_, err = srv.GetKnowledgeNodeVersion(as(t, "m-vasiliev"), kapi.GetKnowledgeNodeVersionRequestObject{NodeId: pid("kb-1"), Version: 9})
	_, detail = problemOf(err)
	assert.Equal(t, "Версия не найдена", detail)
}

func getAccess(t *testing.T, proto, id string) kapi.KnowledgeNodeAccess {
	t.Helper()
	res, err := srv.GetKnowledgeNodeAccess(as(t, proto), kapi.GetKnowledgeNodeAccessRequestObject{NodeId: pid(id)})
	require.NoError(t, err)
	out, ok := res.(kapi.GetKnowledgeNodeAccess200JSONResponse)
	require.True(t, ok, "%T", res)
	return out.Body
}

func TestReadAccess(t *testing.T) { //nolint:paralleltest // reads the seed the commands change later
	a := getAccess(t, "m-vasiliev", "kb-drv-4")
	assert.Equal(t, []kapi.KnowledgeAccessStep{
		{Kind: "ok", Title: "Организация", Detail: "Владелец бизнеса видит всё"},
		{Kind: "ok", Title: "Пространство «Логистика»", Detail: "Ограниченное: все в области читают, пишут участники"},
		{Kind: "ok", Title: "«Водителям»", Detail: "Только выбранные"},
		{Kind: "ok", Title: "«Маршруты»", Detail: "Читают все, правят выбранные"},
	}, a.Chain)
	assert.False(t, a.CanManage)
	assert.Equal(t, kapi.KnowledgeNodeAccessInheritedFromKindNode, a.InheritedFrom.Kind)
	assert.Equal(t, "Водителям", a.InheritedFrom.Title)
	assert.Nil(t, a.Requests, "to the lead only")
	assert.Equal(t, []string{"Марина Котова"}, a.LeadNames)

	f := getAccess(t, "m-kotova", "kb-f-drv")
	assert.True(t, f.CanManage)
	assert.Equal(t, "Настраиваете сейчас", f.Chain[len(f.Chain)-1].Detail)
	require.Len(t, f.Entries, 2)
	assert.Equal(t, "Роль «Водитель» · «Север Логистик»", f.Entries[0].Label)
	require.NotNil(t, f.Entries[0].Reach)
	assert.Equal(t, 1, f.Entries[0].Reach.Members, "Илья Васильев; Кирилл Громов is blocked")
	assert.Equal(t, "Роль «Редактор» в пространстве", f.Entries[1].Label)
	assert.Equal(t, 4, f.DescendantCount)
	assert.Equal(t, []kapi.KnowledgeNodeRef{{Id: pid("kb-drv-4"), Title: "Маршруты"}}, f.OwnSubnodes)
	require.NotNil(t, f.Requests)
	assert.Equal(t, kapi.KnowledgeNodeAccessInheritedFromKindSpace, f.InheritedFrom.Kind)
}

func TestReadCandidatesMapExplain(t *testing.T) { //nolint:paralleltest // reads the seed the commands change later
	res, err := srv.ListKnowledgeAccessCandidates(as(t, "m-kotova"), kapi.ListKnowledgeAccessCandidatesRequestObject{NodeId: pid("kb-1")})
	require.NoError(t, err)
	cands := res.(kapi.ListKnowledgeAccessCandidates200JSONResponse).Body.Items //nolint:forcetypeassert // the success of the call above
	labels := []string{}
	for _, c := range cands[:9] {
		labels = append(labels, c.Label+c.ReachLabel)
	}
	assert.Equal(t, []string{
		"Роль «Водитель» · «Север Логистик»", "Роль «Массажист» · «Север Логистик»— сейчас никого",
		"Роль «Менеджер логистики» · «Север Логистик»— сейчас никого", "Роль «Прораб» · «Север Логистик»— сейчас никого",
		"Роль «Руководитель пространства» в пространстве", "Роль «Редактор» в пространстве", "Роль «Читатель» в пространстве— сейчас никого",
		"Группа «Водители Север»", "Группа «Диспетчеры Север»— получат 1 из 2",
	}, labels)
	assert.Len(t, cands, 9+9, "nine employees who are not blocked")
	_, err = srv.ListKnowledgeAccessCandidates(as(t, "m-vasiliev"), kapi.ListKnowledgeAccessCandidatesRequestObject{NodeId: pid("kb-1")})
	code, detail := problemOf(err)
	assert.Equal(t, "forbidden_action", code)
	assert.Equal(t, "Это может руководитель пространства или владелец бизнеса", detail)

	mres, err := srv.GetKnowledgeAccessMap(as(t, "m-kotova"), kapi.GetKnowledgeAccessMapRequestObject{SpaceId: pid("sp-log")})
	require.NoError(t, err)
	m := mres.(kapi.GetKnowledgeAccessMap200JSONResponse).Body //nolint:forcetypeassert // the success of the call above
	cols := []string{}
	for _, x := range m.Members {
		cols = append(cols, x.DisplayName)
	}
	assert.Equal(t, []string{"Вера Котельникова", "Илья Васильев", "Марина Котова"}, cols)
	require.Len(t, m.Rows, 18)
	fin := -1
	for i, r := range m.Rows {
		if r.NodeId == pid("kb-fin") {
			fin = i
		}
	}
	require.GreaterOrEqual(t, fin, 0)
	assert.Equal(t, []kapi.KnowledgeAccessMapCells{"view", "function", "edit"}, m.Cells[fin])
	bad, err := srv.GetKnowledgeAccessMap(as(t, "m-kotova"), kapi.GetKnowledgeAccessMapRequestObject{SpaceId: pid("sp-log"),
		Params: kapi.GetKnowledgeAccessMapParams{MemberIds: &[]uuid.UUID{pid("нет")}}})
	require.NoError(t, err)
	v, ok := bad.(kapi.GetKnowledgeAccessMap422ApplicationProblemPlusJSONResponse)
	require.True(t, ok, "%T", bad)
	assert.Equal(t, "memberIds[0]", (*v.Body.Violations)[0].Field)

	eres, err := srv.ExplainKnowledgeAccess(as(t, "m-kotova"), kapi.ExplainKnowledgeAccessRequestObject{NodeId: pid("kb-fin"),
		Params: kapi.ExplainKnowledgeAccessParams{MemberId: pid("m-vasiliev")}})
	require.NoError(t, err)
	e := eres.(kapi.ExplainKnowledgeAccess200JSONResponse).Body //nolint:forcetypeassert // the success of the call above
	assert.False(t, e.View)
	assert.True(t, e.FunctionBlocked)
	assert.Equal(t, "Не видит: страницы нет в его дереве, поиске и блоке «Подстраницы». Функция «Водитель» закрывает финансовые "+
		"страницы, роль или группа это не обходят.", e.Summary)
	assert.Equal(t, kapi.KnowledgeAccessStep{Kind: "no", Title: "Функция «Водитель»", Detail: "Финансовые страницы закрыты всегда"},
		e.Chain[len(e.Chain)-1])
}

func TestReadMembersRulesRuns(t *testing.T) { //nolint:paralleltest // reads the seed the commands change later
	res, err := srv.ListKnowledgeSpaceMembers(as(t, "m-kotova"), kapi.ListKnowledgeSpaceMembersRequestObject{SpaceId: pid("sp-log")})
	require.NoError(t, err)
	m := res.(kapi.ListKnowledgeSpaceMembers200JSONResponse).Body //nolint:forcetypeassert // the success of the call above
	require.Len(t, m.Roles, 3)
	assert.Equal(t, kapi.KnowledgeSpaceRoleRoleKbSpaceLead, m.Roles[0].Role)
	assert.Equal(t, "Марина Котова", m.Roles[0].Members[0].DisplayName)
	assert.Equal(t, "Вера Котельникова", m.Roles[1].Members[0].DisplayName)
	assert.Empty(t, m.Roles[2].Members)
	require.NotNil(t, m.ByLevel)
	assert.Equal(t, "По уровню «Ограниченное»", m.ByLevel.Label)
	assert.Equal(t, 1, m.ByLevel.Total)
	assert.Equal(t, "роль «Водитель» · север логистик", m.ByLevel.Members[0].Source)
	require.NotNil(t, m.PageAssignments)
	res, err = srv.ListKnowledgeSpaceMembers(as(t, "m-vasiliev"), kapi.ListKnowledgeSpaceMembersRequestObject{SpaceId: pid("sp-log")})
	require.NoError(t, err)
	assert.Nil(t, res.(kapi.ListKnowledgeSpaceMembers200JSONResponse).Body.ByLevel) //nolint:forcetypeassert // the success of the call above

	rres, err := srv.ListKnowledgeRules(as(t, "m-owner"), kapi.ListKnowledgeRulesRequestObject{SpaceId: pid("sp-rep")})
	require.NoError(t, err)
	rules := rres.(kapi.ListKnowledgeRules200JSONResponse).Body.Items //nolint:forcetypeassert // the success of the call above
	require.Len(t, rules, 3)
	require.NotNil(t, rules[0].Objects)
	objs := *rules[0].Objects
	require.Len(t, objs, 3)
	assert.Equal(t, "ЖК Речной · квартира 42", objs[0].Name)
	assert.Equal(t, new(pid("kb-o-obj-42")), objs[0].SectionNodeId)
	assert.Nil(t, objs[2].ForemanName, "«прораб не назначен»")
	assert.False(t, rules[2].Enabled)
	_, err = srv.ListKnowledgeRules(as(t, "m-vasiliev"), kapi.ListKnowledgeRulesRequestObject{SpaceId: pid("sp-log")})
	code, _ := problemOf(err)
	assert.Equal(t, "forbidden_action", code)

	runs, err := srv.ListKnowledgeRuns(as(t, "m-owner"), kapi.ListKnowledgeRunsRequestObject{SpaceId: pid("sp-rep")})
	require.NoError(t, err)
	items := runs.(kapi.ListKnowledgeRuns200JSONResponse).Body.Items //nolint:forcetypeassert // the success of the call above
	require.Len(t, items, 2)
	assert.Equal(t, kapi.KnowledgeRunResultStopped, items[0].Result, "newest first")

	arch, err := srv.ListKnowledgeArchive(as(t, "m-kotova"), kapi.ListKnowledgeArchiveRequestObject{SpaceId: pid("sp-log")})
	require.NoError(t, err)
	assert.Empty(t, arch.(kapi.ListKnowledgeArchive200JSONResponse).Body.Items) //nolint:forcetypeassert // the success of the call above
	_, err = srv.ListKnowledgeArchive(as(t, "m-vasiliev"), kapi.ListKnowledgeArchiveRequestObject{SpaceId: pid("sp-log")})
	_, detail := problemOf(err)
	assert.Equal(t, "Архивировать может редактор или руководитель пространства", detail)

	reqs, err := srv.ListKnowledgeAccessRequests(as(t, "m-kotova"), kapi.ListKnowledgeAccessRequestsRequestObject{SpaceId: pid("sp-log")})
	require.NoError(t, err)
	assert.Empty(t, reqs.(kapi.ListKnowledgeAccessRequests200JSONResponse).Body.Items) //nolint:forcetypeassert // the success of the call above
}

func TestReadTemplatesAndPages(t *testing.T) { //nolint:paralleltest // reads the seed the commands change later
	res, err := srv.ListKnowledgeSpaceTemplates(as(t, "m-owner"), kapi.ListKnowledgeSpaceTemplatesRequestObject{})
	require.NoError(t, err)
	tpls := res.(kapi.ListKnowledgeSpaceTemplates200JSONResponse).Body.Items //nolint:forcetypeassert // the success of the call above
	require.Len(t, tpls, 4)
	staff := tpls[1]
	assert.Equal(t, kapi.KnowledgeSpaceTemplateKeyStaff, staff.Key)
	roles := []string{}
	for _, n := range staff.Nodes {
		if n.ReaderRoleLabel != nil {
			roles = append(roles, *n.ReaderRoleLabel)
		}
	}
	assert.Equal(t, []string{"Водитель", "Прораб", "Массажист"}, roles)
	assert.Equal(t, new(2), staff.Nodes[3].ParentIndex)
	assert.True(t, staff.Nodes[1].RequestAck)

	pres, err := srv.GetKnowledgePage(as(t, "m-vasiliev"), kapi.GetKnowledgePageRequestObject{PageId: pid("kb-1")})
	require.NoError(t, err)
	p := pres.(kapi.GetKnowledgePage200JSONResponse).Body //nolint:forcetypeassert // the success of the call above
	assert.Equal(t, kapi.KnowledgePageStatusPublished, p.Status)
	assert.Equal(t, int64(2), p.Revision)
	assert.Equal(t, kapi.ScopeKindSpace, p.Scope.Kind)
	assert.Equal(t, []uuid.UUID{pid("sp-log")}, p.Scope.ResourceIds)
	_, err = srv.GetKnowledgePage(as(t, "m-vasiliev"), kapi.GetKnowledgePageRequestObject{PageId: pid("kb-f-reg")})
	code, _ := problemOf(err)
	assert.Equal(t, "not_found", code, "a folder is not a page of the projection")
	lres, err := srv.ListKnowledgePages(as(t, "m-vasiliev"), kapi.ListKnowledgePagesRequestObject{Params: kapi.ListKnowledgePagesParams{Limit: new(5)}})
	require.NoError(t, err)
	list := lres.(kapi.ListKnowledgePages200JSONResponse).Body //nolint:forcetypeassert // the success of the call above
	assert.Len(t, list.Items, 5)
	require.NotNil(t, list.NextCursor)
	lres, err = srv.ListKnowledgePages(as(t, "m-vasiliev"), kapi.ListKnowledgePagesRequestObject{Params: kapi.ListKnowledgePagesParams{
		Cursor: list.NextCursor, Limit: new(200)}})
	require.NoError(t, err)
	rest := lres.(kapi.ListKnowledgePages200JSONResponse).Body //nolint:forcetypeassert // the success of the call above
	assert.Nil(t, rest.NextCursor)
	assert.NotEqual(t, list.Items[0].Id, rest.Items[0].Id)
}
