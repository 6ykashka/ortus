//go:build integration

package knowledge

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	kapi "github.com/ortus/ortus-crm/backend/internal/api/knowledge"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Commands of the knowledge base on «Альта» of the seed: the texts of the reference and the domain W4.30, the
// revisions, the transactions, the events, the audit and the roles of spaces in the common table of assignments.
// They run in order after the reads.

// wantProblem asserts the code and the detail of a Problem error.
func wantProblem(t *testing.T, err error, code, detail string) {
	t.Helper()
	require.Error(t, err)
	got, d := problemOf(err)
	assert.Equal(t, code, got, "%v", err)
	if detail != "" {
		assert.Equal(t, detail, d)
	}
}

// violation is the field and the message of a 422 answer of an operation.
func violation(t *testing.T, v kapi.ValidationApplicationProblemPlusJSONResponse) (string, string) {
	t.Helper()
	require.NotNil(t, v.Body.Violations)
	require.Len(t, *v.Body.Violations, 1)
	x := (*v.Body.Violations)[0]
	assert.Equal(t, x.Message, *v.Body.Detail)
	return x.Field, x.Message
}

func scalar[T any](t *testing.T, sql string, args ...any) T {
	t.Helper()
	var v T
	require.NoError(t, superA.QueryRow(t.Context(), sql, args...).Scan(&v))
	return v
}

func grantRoleSQL(t *testing.T, id, member, roleID, kind string, ref *uuid.UUID) {
	t.Helper()
	require.NoError(t, exec(t.Context(), `insert into access.role_assignments (id, principal_kind, principal_id, role_id, role_version,
		scope_kind, scope_ref, include_descendants, valid, granted_by) values ($1, 'person', $2, $3, 1, $4, $5, $6,
		tstzrange('2026-09-01 00:00+03', null), $7)`, pid(id), pid(member), pid(roleID), kind, ref, kind == scopeUnit, pid("m-owner")))
}

func addRoleSQL(t *testing.T, proto, name string, actions ...string) {
	t.Helper()
	require.NoError(t, exec(t.Context(), `insert into access.roles (id, name, kind) values ($1, $2, 'custom')`, pid(proto), name))
	require.NoError(t, exec(t.Context(), `insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`,
		pid(proto), actions, pid("m-owner")))
}

func createSpace(t *testing.T, proto string, b kapi.KnowledgeSpaceCreate) (kapi.CreateKnowledgeSpaceResponseObject, error) {
	t.Helper()
	return srv.CreateKnowledgeSpace(as(t, proto), kapi.CreateKnowledgeSpaceRequestObject{Body: &b})
}

func TestWriteSpaces(t *testing.T) { //nolint:paralleltest // the commands share the seed and run in order
	staff := kapi.KnowledgeSpaceCreateTemplateKeyStaff
	res, err := createSpace(t, "m-owner", kapi.KnowledgeSpaceCreate{Name: " Охрана труда ", Access: "open", TemplateKey: &staff})
	require.NoError(t, err)
	created, ok := res.(kapi.CreateKnowledgeSpace201JSONResponse)
	require.True(t, ok, "%T", res)
	sp := created.Body
	assert.Equal(t, "Охрана труда", sp.Name)
	assert.Equal(t, `"rev-1"`, *created.Headers.ETag)
	assert.Equal(t, new("staff"), sp.TemplateKey)
	assert.Equal(t, "health_and_safety", sp.Icon)
	assert.Equal(t, 5, sp.PageCount, "five pages and three folders of the template")
	require.NotNil(t, sp.HomeNodeId)
	res2, err := srv.GetKnowledgeSpaceTree(as(t, "m-vasiliev"), kapi.GetKnowledgeSpaceTreeRequestObject{SpaceId: sp.Id})
	require.NoError(t, err)
	assert.Equal(t, []string{"Обзор", "Вводный инструктаж", "Водителям", "Перед выездом"},
		titles(res2.(kapi.GetKnowledgeSpaceTree200JSONResponse).Body.Nodes), //nolint:forcetypeassert // the success of the call above
		"the folders of the other functions are «Только выбранные»")

	_, err = createSpace(t, "m-owner", kapi.KnowledgeSpaceCreate{Name: "охрана ТРУДА", Access: "open"})
	wantProblem(t, err, "validation_failed", "Пространство «охрана ТРУДА» уже есть")
	_, err = createSpace(t, "m-kotova", kapi.KnowledgeSpaceCreate{Name: "Склад", Access: "open"})
	wantProblem(t, err, "forbidden_action", textCreateSpace)
	_, err = createSpace(t, "m-owner", kapi.KnowledgeSpaceCreate{Name: "А", Access: "open"})
	wantProblem(t, err, "validation_failed", "Название — не короче 2 символов")
	_, err = createSpace(t, "m-owner", kapi.KnowledgeSpaceCreate{Name: "Склад", Access: "public"})
	wantProblem(t, err, "validation_failed", "Выберите уровень доступа")
	res, err = createSpace(t, "m-owner", kapi.KnowledgeSpaceCreate{Name: "Склад", Access: "open", OrgUnitId: new(pid("нет"))})
	require.NoError(t, err)
	v, ok := res.(kapi.CreateKnowledgeSpace422ApplicationProblemPlusJSONResponse)
	require.True(t, ok, "%T", res)
	field, msg := violation(t, v.ValidationApplicationProblemPlusJSONResponse)
	assert.Equal(t, "orgUnitId", field)
	assert.Equal(t, "Подразделение не найдено", msg)

	// PD-53: knowledge.spaces.manage of a role of a firm creates spaces of that firm; the author leads the space.
	addRoleSQL(t, "r-methodist", "Методист", actionRead, actionSpaces)
	grantRoleSQL(t, "x-methodist", "m-akhmedov", "r-methodist", scopeUnit, new(pid("f-msk-sever")))
	policy := scalar[int64](t, `select policy_version from access.policy_state`)
	res, err = createSpace(t, "m-akhmedov", kapi.KnowledgeSpaceCreate{Name: "Склад Север", Access: "closed", OrgUnitId: new(pid("f-msk-sever"))})
	require.NoError(t, err)
	own := res.(kapi.CreateKnowledgeSpace201JSONResponse).Body //nolint:forcetypeassert // the success of the call above
	assert.True(t, own.My.Lead)
	assert.Equal(t, "Руководитель пространства", own.My.Role)
	assert.Equal(t, 1, scalar[int](t, `select count(*) from access.role_assignments where principal_id = $1 and scope_kind = 'space'
		and scope_ref = $2 and state = 'active'`, pid("m-akhmedov"), own.Id))
	assert.Greater(t, scalar[int64](t, `select policy_version from access.policy_state`), policy, "the role reaches the gateway")
	_, err = createSpace(t, "m-akhmedov", kapi.KnowledgeSpaceCreate{Name: "Склад Юг", Access: "open", OrgUnitId: new(pid("f-msk-yug"))})
	wantProblem(t, err, "forbidden_action", textCreateSpace)
	_, err = createSpace(t, "m-akhmedov", kapi.KnowledgeSpaceCreate{Name: "Склад всем", Access: "open"})
	wantProblem(t, err, "forbidden_action", textCreateSpace)
	assert.Equal(t, 1, scalar[int](t, `select count(*) from outbox.events where type = 'kb.space.created.v1' and aggregate_id = $1`, own.Id))
}

func updateSpace(t *testing.T, proto string, id uuid.UUID, ifMatch string, b kapi.KnowledgeSpacePatch) (kapi.UpdateKnowledgeSpaceResponseObject, error) {
	t.Helper()
	return srv.UpdateKnowledgeSpace(as(t, proto), kapi.UpdateKnowledgeSpaceRequestObject{SpaceId: id, Body: &b,
		Params: kapi.UpdateKnowledgeSpaceParams{IfMatch: ifMatch}})
}

func spaceNamed(t *testing.T, proto, name string) kapi.KnowledgeSpace {
	t.Helper()
	for _, sp := range spaces(t, proto) {
		if sp.Name == name {
			return sp
		}
	}
	t.Fatalf("%s does not see the space %q", proto, name)
	return kapi.KnowledgeSpace{}
}

func TestWriteUpdateSpace(t *testing.T) { //nolint:paralleltest // the commands share the seed and run in order
	sp := spaceNamed(t, "m-owner", "Охрана труда")
	_, err := updateSpace(t, "m-owner", sp.Id, `"rev-9"`, kapi.KnowledgeSpacePatch{})
	wantProblem(t, err, "revision_mismatch", "")
	closed := kapi.KnowledgeSpacePatchAccessClosed
	res, err := updateSpace(t, "m-owner", sp.Id, `"rev-1"`, kapi.KnowledgeSpacePatch{Access: &closed, DryRun: new(true)})
	require.NoError(t, err)
	dry := res.(kapi.UpdateKnowledgeSpace200JSONResponse).Body //nolint:forcetypeassert // the success of the call above
	assert.False(t, dry.Applied)
	assert.Equal(t, kapi.KnowledgeSpaceAccessClosed, dry.Space.Access)
	assert.Equal(t, int64(1), dry.Space.Revision)
	lost := map[string]int{}
	for _, p := range dry.Impact.LoseView {
		lost[p.DisplayName] = p.Pages
	}
	assert.Equal(t, 4, lost["Илья Васильев"], "Обзор, Вводный инструктаж, Водителям, Перед выездом: %v", lost)
	assert.Equal(t, 1, scalar[int](t, `select revision from kb.spaces where id = $1`, sp.Id), "dryRun changes nothing")
	res, err = updateSpace(t, "m-owner", sp.Id, `"rev-1"`, kapi.KnowledgeSpacePatch{Name: new("Охрана труда и ТБ"), Access: &closed})
	require.NoError(t, err)
	done := res.(kapi.UpdateKnowledgeSpace200JSONResponse) //nolint:forcetypeassert // the success of the call above
	assert.True(t, done.Body.Applied)
	assert.Equal(t, `"rev-2"`, *done.Headers.ETag)
	assert.Equal(t, "Охрана труда и ТБ", done.Body.Space.Name)
	assert.Equal(t, 1, scalar[int](t, `select count(*) from audit.events where action = 'knowledge.space.access_changed' and target_id = $1`, sp.Id))
	res, err = updateSpace(t, "m-owner", sp.Id, `"rev-2"`, kapi.KnowledgeSpacePatch{Name: new("логистика")})
	require.NoError(t, err)
	v, ok := res.(kapi.UpdateKnowledgeSpace422ApplicationProblemPlusJSONResponse)
	require.True(t, ok, "%T", res)
	field, msg := violation(t, v.ValidationApplicationProblemPlusJSONResponse)
	assert.Equal(t, "name", field)
	assert.Equal(t, "Пространство «логистика» уже есть", msg)
	_, err = updateSpace(t, "m-kotova", pid("sp-gen"), `"rev-1"`, kapi.KnowledgeSpacePatch{})
	wantProblem(t, err, "forbidden_action", textLeadOnly)
}

func createNode(t *testing.T, proto, sp string, parent *uuid.UUID, kind, title string) (kapi.KnowledgeNode, error) {
	t.Helper()
	res, err := srv.CreateKnowledgeNode(as(t, proto), kapi.CreateKnowledgeNodeRequestObject{SpaceId: pid(sp),
		Body: &kapi.KnowledgeNodeCreate{Kind: kapi.KnowledgeNodeCreateKind(kind), Title: title, ParentId: parent}})
	if err != nil {
		return kapi.KnowledgeNode{}, err
	}
	out, ok := res.(kapi.CreateKnowledgeNode201JSONResponse)
	require.True(t, ok, "%T", res)
	return out.Body, nil
}

func TestWriteNodes(t *testing.T) { //nolint:paralleltest // the commands share the seed and run in order
	n, err := createNode(t, "m-kotova", "sp-log", new(pid("kb-f-reg")), kindPage, "Выезд в непогоду")
	require.NoError(t, err)
	assert.Equal(t, 4, n.Position)
	assert.Equal(t, kapi.KnowledgeNodeStatusDraft, n.Status)
	assert.Equal(t, "Марина Котова", n.Owner.DisplayName)
	assert.Equal(t, []kapi.KnowledgeNodeRef{{Id: pid("kb-f-reg"), Title: "Регламенты"}}, n.Path)
	assert.Empty(t, n.Current.Body)
	assert.True(t, n.My.Edit)
	_, err = createNode(t, "m-vasiliev", "sp-log", nil, kindPage, "Моя страница")
	wantProblem(t, err, "forbidden_action", "Нет права создавать страницы в пространстве")
	_, err = createNode(t, "m-vasiliev", "sp-log", new(pid("kb-fin")), kindPage, "Моя страница")
	wantProblem(t, err, "not_found", textNodeNotFound)
	_, err = createNode(t, "m-kotova", "sp-log", nil, kindFile, "Договор")
	wantProblem(t, err, "validation_failed", "Выберите тип: страница, папка или схема")
	_, err = createNode(t, "m-kotova", "sp-log", new(pid("kb-3")), kindPage, "Чужое")
	wantProblem(t, err, "not_found", "")
	d, err := createNode(t, "m-kotova", "sp-log", nil, kindDiagram, "Схема выезда")
	require.NoError(t, err)
	assert.Equal(t, []string{"Начало", "Шаг", "Готово"}, d.Diagram.Steps)
	// KB-06: six levels at most
	parent := (*uuid.UUID)(nil)
	for i := 1; i <= maxDepth; i++ {
		x, err := createNode(t, "m-kotova", "sp-gen", parent, kindFolder, "Уровень "+string(rune('0'+i)))
		require.NoError(t, err, "level %d", i)
		parent = &x.Id
	}
	_, err = createNode(t, "m-kotova", "sp-gen", parent, kindPage, "Уровень 7")
	wantProblem(t, err, "validation_failed", "Не больше шести уровней вложенности")
	assert.Equal(t, 1, scalar[int](t, `select count(*) from outbox.events where type = 'kb.node.created.v1' and aggregate_id = $1`, n.Id))
}

func publish(t *testing.T, proto, id, ifMatch string, b kapi.KnowledgePublish) (kapi.PublishKnowledgeNodeVersionResponseObject, error) {
	t.Helper()
	return srv.PublishKnowledgeNodeVersion(as(t, proto), kapi.PublishKnowledgeNodeVersionRequestObject{NodeId: pid(id), Body: &b,
		Params: kapi.PublishKnowledgeNodeVersionParams{IfMatch: ifMatch}})
}

func TestWritePublish(t *testing.T) { //nolint:paralleltest // the commands share the seed and run in order
	res, err := publish(t, "m-kotelnikova", "kb-2", `"rev-1"`, kapi.KnowledgePublish{Body: "Снимайте днём.\n\nНомер читается."})
	require.NoError(t, err)
	out := res.(kapi.PublishKnowledgeNodeVersion201JSONResponse) //nolint:forcetypeassert // the success of the call above
	assert.Equal(t, 2, out.Body.Version)
	assert.Equal(t, `"rev-2"`, *out.Headers.ETag)
	assert.Equal(t, "Вера Котельникова", out.Body.Node.Current.AuthorDisplayName)
	_, err = publish(t, "m-kotelnikova", "kb-2", `"rev-1"`, kapi.KnowledgePublish{Body: "Снова"})
	wantProblem(t, err, "revision_mismatch", "Страницу уже изменили (v2). Обновите и повторите правку.")
	_, err = publish(t, "m-vasiliev", "kb-1", `"rev-2"`, kapi.KnowledgePublish{Body: "Моё"})
	wantProblem(t, err, "forbidden_action", "Нет права править «Регламент приёмки смены»")
	res, err = publish(t, "m-kotova", "kb-1", `"rev-2"`, kapi.KnowledgePublish{Body: "x", Steps: &[]string{"a"}})
	require.NoError(t, err)
	v, ok := res.(kapi.PublishKnowledgeNodeVersion422ApplicationProblemPlusJSONResponse)
	require.True(t, ok, "%T", res)
	field, msg := violation(t, v.ValidationApplicationProblemPlusJSONResponse)
	assert.Equal(t, "steps", field)
	assert.Equal(t, "Шаги — только у схемы", msg)
	_, err = publish(t, "m-kotova", "kb-1", `"rev-2"`, kapi.KnowledgePublish{Body: strings.Repeat("я", maxBody+1)})
	wantProblem(t, err, "validation_failed", "Текст — не длиннее 20 000 символов")

	res, err = publish(t, "m-kotova", "kb-1", `"rev-2"`, kapi.KnowledgePublish{Body: "Новая редакция регламента.", RequestAck: new(true)})
	require.NoError(t, err)
	acked := res.(kapi.PublishKnowledgeNodeVersion201JSONResponse).Body //nolint:forcetypeassert // the success of the call above
	assert.Equal(t, 3, acked.Version)
	assert.Equal(t, 1, acked.AckRequestedCount, "Илья Васильев")
	require.NotNil(t, acked.Node.Ack)
	assert.Equal(t, 3, acked.Node.Ack.Version)
	runs, err := srv.ListKnowledgeRuns(as(t, "m-kotova"), kapi.ListKnowledgeRunsRequestObject{SpaceId: pid("sp-log")})
	require.NoError(t, err)
	items := runs.(kapi.ListKnowledgeRuns200JSONResponse).Body.Items //nolint:forcetypeassert // the success of the call above
	assert.Equal(t, "«Регламент приёмки смены» v3: попросили ознакомиться — 1 чел.", items[0].Text)

	res, err = publish(t, "m-kotova", "kb-d1", `"rev-1"`, kapi.KnowledgePublish{Body: "Сдача смены.", Steps: &[]string{" Сдача ", "", "Проверка"}})
	require.NoError(t, err)
	d := res.(kapi.PublishKnowledgeNodeVersion201JSONResponse).Body.Node //nolint:forcetypeassert // the success of the call above
	assert.Equal(t, []string{"Сдача", "Проверка"}, d.Diagram.Steps)

	st, err := srv.SetKnowledgeNodeStatus(as(t, "m-kotelnikova"), kapi.SetKnowledgeNodeStatusRequestObject{NodeId: pid("kb-6"),
		Body: &kapi.KnowledgeNodeStatusChange{Status: "active"}})
	require.NoError(t, err)
	assert.Equal(t, kapi.KnowledgeNodeStatusActive, st.(kapi.SetKnowledgeNodeStatus200JSONResponse).Body.Status) //nolint:forcetypeassert // the success of the call above
	_, err = srv.SetKnowledgeNodeStatus(as(t, "m-vasiliev"), kapi.SetKnowledgeNodeStatusRequestObject{NodeId: pid("kb-6"),
		Body: &kapi.KnowledgeNodeStatusChange{Status: "active"}})
	wantProblem(t, err, "forbidden_action", "Нет права править «Выезд при критическом дефекте»")
	_, err = srv.SetKnowledgeNodeStatus(as(t, "m-kotova"), kapi.SetKnowledgeNodeStatusRequestObject{NodeId: pid("kb-6"),
		Body: &kapi.KnowledgeNodeStatusChange{Status: "gone"}})
	wantProblem(t, err, "validation_failed", "Неизвестный статус")
}

func moveNode(t *testing.T, proto string, id uuid.UUID, parent *uuid.UUID, dry bool) (kapi.MoveKnowledgeNodeResponseObject, error) {
	t.Helper()
	return srv.MoveKnowledgeNode(as(t, proto), kapi.MoveKnowledgeNodeRequestObject{NodeId: id,
		Body: &kapi.KnowledgeMove{ParentId: parent, DryRun: &dry}})
}

func TestWriteMoveArchive(t *testing.T) { //nolint:paralleltest // the commands share the seed and run in order
	grantRoleSQL(t, "x-ilyin", "m-ilyin", "r-manager", scopeUnit, new(pid("r-msk")))
	res, err := moveNode(t, "m-kotova", pid("kb-1"), new(pid("kb-f-drv")), true)
	require.NoError(t, err)
	dry := res.(kapi.MoveKnowledgeNode200JSONResponse).Body //nolint:forcetypeassert // the success of the call above
	assert.False(t, dry.Applied)
	assert.Equal(t, 3, dry.Pages)
	assert.Equal(t, []kapi.KnowledgeImpactPerson{{MemberId: pid("m-ilyin"), DisplayName: "Сергей Ильин", Pages: 3},
		{MemberId: pid("m-akhmedov"), DisplayName: "Тимур Ахмедов", Pages: 3}}, dry.LoseView, "the readers of the area outside the folder")
	assert.Equal(t, pid("kb-f-reg"), scalar[uuid.UUID](t, `select parent_id from kb.nodes where id = $1`, pid("kb-1")))

	res, err = moveNode(t, "m-kotova", pid("kb-log-home"), nil, true)
	require.NoError(t, err)
	v, ok := res.(kapi.MoveKnowledgeNode422ApplicationProblemPlusJSONResponse)
	require.True(t, ok, "%T", res)
	field, msg := violation(t, v.ValidationApplicationProblemPlusJSONResponse)
	assert.Equal(t, "parentId", field)
	assert.Equal(t, "Главную страницу пространства не переносят", msg)
	_, err = moveNode(t, "m-kotova", pid("kb-1"), new(pid("kb-1a")), true)
	wantProblem(t, err, "validation_failed", "Нельзя перенести страницу внутрь её же подстраницы")
	_, err = moveNode(t, "m-kotova", pid("kb-1"), new(pid("kb-gen-1")), true)
	wantProblem(t, err, "validation_failed", "Переносить можно только внутри пространства")
	_, err = moveNode(t, "m-vasiliev", pid("kb-1"), nil, true)
	wantProblem(t, err, "forbidden_action", "Нет права править «Регламент приёмки смены»")

	a, err := createNode(t, "m-kotova", "sp-log", nil, kindFolder, "Папка А")
	require.NoError(t, err)
	b, err := createNode(t, "m-kotova", "sp-log", nil, kindPage, "Страница Б")
	require.NoError(t, err)
	c, err := createNode(t, "m-kotova", "sp-log", &b.Id, kindPage, "Страница В")
	require.NoError(t, err)
	res, err = moveNode(t, "m-kotova", b.Id, &a.Id, false)
	require.NoError(t, err)
	moved := res.(kapi.MoveKnowledgeNode200JSONResponse).Body //nolint:forcetypeassert // the success of the call above
	assert.True(t, moved.Applied)
	require.NotNil(t, moved.Node)
	assert.Equal(t, 1, moved.Node.Position)
	assert.Equal(t, 2, scalar[int](t, `select depth from kb.nodes where id = $1`, b.Id))
	assert.Equal(t, 3, scalar[int](t, `select depth from kb.nodes where id = $1`, c.Id), "the branch moves in one transaction")

	ar, err := srv.ArchiveKnowledgeNode(as(t, "m-kotova"), kapi.ArchiveKnowledgeNodeRequestObject{NodeId: b.Id})
	require.NoError(t, err)
	assert.Equal(t, 2, ar.(kapi.ArchiveKnowledgeNode200JSONResponse).Body.Pages) //nolint:forcetypeassert // the success of the call above
	ns, err := tree(t, "m-kotova", "sp-log")
	require.NoError(t, err)
	assert.NotContains(t, titles(ns), "Страница Б")
	list, err := srv.ListKnowledgeArchive(as(t, "m-kotova"), kapi.ListKnowledgeArchiveRequestObject{SpaceId: pid("sp-log")})
	require.NoError(t, err)
	items := list.(kapi.ListKnowledgeArchive200JSONResponse).Body.Items //nolint:forcetypeassert // the success of the call above
	require.Len(t, items, 1)
	assert.Equal(t, kapi.KnowledgeArchiveItem{NodeId: b.Id, Title: "Страница Б", Kind: "page", Pages: 2}, items[0])
	_, err = getNode(t, "m-ilyin", "kb-f-reg")
	require.NoError(t, err)
	_, err = srv.ArchiveKnowledgeNode(as(t, "m-ilyin"), kapi.ArchiveKnowledgeNodeRequestObject{NodeId: pid("kb-f-reg")})
	wantProblem(t, err, "forbidden_action", textArchiveRight)
	_, err = srv.ArchiveKnowledgeNode(as(t, "m-kotova"), kapi.ArchiveKnowledgeNodeRequestObject{NodeId: pid("kb-log-home")})
	wantProblem(t, err, "validation_failed", "Главную страницу пространства архивировать нельзя")
	rr, err := srv.RestoreKnowledgeNode(as(t, "m-kotova"), kapi.RestoreKnowledgeNodeRequestObject{NodeId: b.Id})
	require.NoError(t, err)
	assert.False(t, rr.(kapi.RestoreKnowledgeNode200JSONResponse).Body.Archived) //nolint:forcetypeassert // the success of the call above
	ns, err = tree(t, "m-kotova", "sp-log")
	require.NoError(t, err)
	assert.Contains(t, titles(ns), "Страница В")
}

func confirm(t *testing.T, proto, id string, v int) (kapi.AckKnowledgeNodeResponseObject, error) {
	t.Helper()
	return srv.AckKnowledgeNode(as(t, proto), kapi.AckKnowledgeNodeRequestObject{NodeId: pid(id), Body: &kapi.KnowledgeAckCreate{Version: v}})
}

func TestWriteAck(t *testing.T) { //nolint:paralleltest // the commands share the seed and run in order
	res, err := confirm(t, "m-vasiliev", "kb-1", 3)
	require.NoError(t, err)
	assert.True(t, res.(kapi.AckKnowledgeNode200JSONResponse).Body.Mine.Done) //nolint:forcetypeassert // the success of the call above
	res, err = confirm(t, "m-vasiliev", "kb-1", 3)
	require.NoError(t, err, "a repeated confirmation returns the same state")
	assert.Equal(t, 1, scalar[int](t, `select count(*) from kb.ack_log where node_id = $1 and member_id = $2`, pid("kb-1"), pid("m-vasiliev")))
	_ = res
	res, err = confirm(t, "m-vasiliev", "kb-1", 2)
	require.NoError(t, err)
	v, ok := res.(kapi.AckKnowledgeNode422ApplicationProblemPlusJSONResponse)
	require.True(t, ok, "%T", res)
	field, msg := violation(t, v.ValidationApplicationProblemPlusJSONResponse)
	assert.Equal(t, "version", field)
	assert.Equal(t, "Ознакомление со страницей не запрошено", msg)
	_, err = confirm(t, "m-kotelnikova", "kb-1", 3)
	wantProblem(t, err, "validation_failed", "Ознакомление запрошено у другой роли")
	_, err = confirm(t, "m-sokolov", "kb-rep-tech", 1)
	require.NoError(t, err)
	n, err := getNode(t, "m-kotova", "kb-1")
	require.NoError(t, err)
	require.NotNil(t, n.Ack.Log)
	assert.Len(t, *n.Ack.Log, 1, "the log of the confirmations (KB-03) — to the lead")
	assert.Equal(t, 1, *n.Ack.DoneCount)
}

func setAccess(t *testing.T, proto string, id uuid.UUID, ifMatch string, b kapi.KnowledgeAccessChange) (kapi.SetKnowledgeNodeAccessResponseObject, error) {
	t.Helper()
	return srv.SetKnowledgeNodeAccess(as(t, proto), kapi.SetKnowledgeNodeAccessRequestObject{NodeId: id, Body: &b,
		Params: kapi.SetKnowledgeNodeAccessParams{IfMatch: ifMatch}})
}

func memberIn(proto, can string) kapi.KnowledgeAccessEntryInput {
	return kapi.KnowledgeAccessEntryInput{Who: "member", RefId: new(pid(proto)), Can: kapi.KnowledgeAccessEntryInputCan(can)}
}

func TestWriteAccess(t *testing.T) { //nolint:paralleltest // the commands share the seed and run in order
	res, err := setAccess(t, "m-kotova", pid("kb-fin"), `"rev-1"`, kapi.KnowledgeAccessChange{Mode: "inherit", DryRun: new(true)})
	require.NoError(t, err)
	dry := res.(kapi.SetKnowledgeNodeAccess200JSONResponse).Body //nolint:forcetypeassert // the success of the call above
	assert.False(t, dry.Applied)
	assert.Equal(t, 2, dry.Pages)
	assert.Contains(t, dry.GainEdit, kapi.KnowledgeImpactPerson{MemberId: pid("m-kotelnikova"), DisplayName: "Вера Котельникова", Pages: 2})
	assert.Contains(t, dry.GainView, kapi.KnowledgeImpactPerson{MemberId: pid("m-ilyin"), DisplayName: "Сергей Ильин", Pages: 2})
	assert.Equal(t, "listed", scalar[string](t, `select access_mode from kb.nodes where id = $1`, pid("kb-fin")))

	res, err = setAccess(t, "m-kotova", pid("kb-drv-3"), `"rev-1"`, kapi.KnowledgeAccessChange{Mode: "edit_listed",
		Entries: []kapi.KnowledgeAccessEntryInput{memberIn("m-vasiliev", "edit")}})
	require.NoError(t, err)
	done := res.(kapi.SetKnowledgeNodeAccess200JSONResponse) //nolint:forcetypeassert // the success of the call above
	assert.True(t, done.Body.Applied)
	require.NotNil(t, done.Body.Access)
	assert.Equal(t, `"rev-2"`, *done.Headers.ETag)
	assert.Equal(t, "Илья Васильев", done.Body.Access.Entries[0].Label)
	assert.Equal(t, []kapi.KnowledgeImpactPerson{{MemberId: pid("m-vasiliev"), DisplayName: "Илья Васильев", Pages: 1}}, done.Body.GainEdit)
	n, err := getNode(t, "m-vasiliev", "kb-drv-3")
	require.NoError(t, err)
	assert.True(t, n.My.Edit)
	assert.Equal(t, "Доступ: Читают все, правят выбранные · Илья Васильев — правит",
		scalar[string](t, `select text from kb.access_history where node_id = $1`, pid("kb-drv-3")))
	assert.Equal(t, 1, scalar[int](t, `select count(*) from audit.events where action = 'knowledge.access.changed' and target_id = $1`, pid("kb-drv-3")))

	_, err = setAccess(t, "m-kotova", pid("kb-drv-3"), `"rev-1"`, kapi.KnowledgeAccessChange{Mode: "inherit"})
	wantProblem(t, err, "revision_mismatch", "")
	_, err = setAccess(t, "m-vasiliev", pid("kb-drv-3"), `"rev-2"`, kapi.KnowledgeAccessChange{Mode: "inherit"})
	wantProblem(t, err, "forbidden_action", textLeadOnly)
	_, err = setAccess(t, "m-kotova", pid("kb-drv-3"), `"rev-2"`, kapi.KnowledgeAccessChange{Mode: "everyone"})
	wantProblem(t, err, "validation_failed", "Выберите, кто видит страницу")
	rel := kapi.KnowledgeAccessEntryInput{Who: "relation", Relation: new(kapi.KnowledgeAccessEntryInputRelationForeman), Can: "view",
		Object: &kapi.ObjectRef{ModuleKey: "repairs", EntityType: "project", EntityId: pid("obj-42")}}
	_, err = setAccess(t, "m-kotova", pid("kb-drv-3"), `"rev-2"`, kapi.KnowledgeAccessChange{Mode: "listed",
		Entries: []kapi.KnowledgeAccessEntryInput{rel}, DryRun: new(true)})
	wantProblem(t, err, "validation_failed", "Связь с записью CRM задаётся шаблоном раздела")
	_, err = setAccess(t, "m-owner", pid("kb-o-obj-42-1"), `"rev-1"`, kapi.KnowledgeAccessChange{Mode: "listed",
		Entries: []kapi.KnowledgeAccessEntryInput{rel}, DryRun: new(true)})
	require.NoError(t, err, "KB-01: the foreman of the section may return")
	res, err = setAccess(t, "m-kotova", pid("kb-drv-3"), `"rev-2"`, kapi.KnowledgeAccessChange{Mode: "listed",
		Entries: []kapi.KnowledgeAccessEntryInput{memberIn("нет", "view")}, DryRun: new(true)})
	require.NoError(t, err)
	v, ok := res.(kapi.SetKnowledgeNodeAccess422ApplicationProblemPlusJSONResponse)
	require.True(t, ok, "%T", res)
	field, msg := violation(t, v.ValidationApplicationProblemPlusJSONResponse)
	assert.Equal(t, "entries[0]", field)
	assert.Equal(t, "Сотрудник не найден", msg)
	res, err = setAccess(t, "m-kotova", pid("kb-f-drv"), `"rev-1"`, kapi.KnowledgeAccessChange{Mode: "inherit", ApplyToOwn: new(true),
		DryRun: new(true)})
	require.NoError(t, err)
	own := res.(kapi.SetKnowledgeNodeAccess200JSONResponse).Body.Own //nolint:forcetypeassert // the success of the call above
	assert.Equal(t, []kapi.KnowledgeNodeRef{{Id: pid("kb-drv-3"), Title: "Контакты диспетчеров"}, {Id: pid("kb-drv-4"), Title: "Маршруты"}}, own)
}

func askEdit(t *testing.T, proto, id string) (kapi.CreateKnowledgeAccessRequestResponseObject, error) {
	t.Helper()
	return srv.CreateKnowledgeAccessRequest(as(t, proto), kapi.CreateKnowledgeAccessRequestRequestObject{NodeId: pid(id),
		Body: &kapi.KnowledgeAccessRequestCreate{Can: "edit"}})
}

func decide(t *testing.T, proto string, id uuid.UUID, d kapi.KnowledgeAccessRequestDecisionDecision) (kapi.KnowledgeAccessRequest, error) {
	t.Helper()
	res, err := srv.DecideKnowledgeAccessRequest(as(t, proto), kapi.DecideKnowledgeAccessRequestRequestObject{RequestId: id,
		Body: &kapi.KnowledgeAccessRequestDecision{Decision: d}})
	if err != nil {
		return kapi.KnowledgeAccessRequest{}, err
	}
	return res.(kapi.DecideKnowledgeAccessRequest200JSONResponse).Body, nil //nolint:forcetypeassert // the success of the call above
}

func TestWriteRequests(t *testing.T) { //nolint:paralleltest // the commands share the seed and run in order
	res, err := askEdit(t, "m-vasiliev", "kb-drv-1")
	require.NoError(t, err)
	x := res.(kapi.CreateKnowledgeAccessRequest201JSONResponse).Body //nolint:forcetypeassert // the success of the call above
	assert.Equal(t, kapi.KnowledgeAccessRequestStatusOpen, x.Status)
	assert.Equal(t, "Памятка водителя", x.NodeTitle)
	_, err = askEdit(t, "m-vasiliev", "kb-drv-1")
	wantProblem(t, err, "request_pending", "Запрос уже отправлен")
	res, err = askEdit(t, "m-vasiliev", "kb-f-drv")
	require.NoError(t, err)
	v, ok := res.(kapi.CreateKnowledgeAccessRequest422ApplicationProblemPlusJSONResponse)
	require.True(t, ok, "%T", res)
	field, _ := violation(t, v.ValidationApplicationProblemPlusJSONResponse)
	assert.Equal(t, "can", field)
	_, err = askEdit(t, "m-kotova", "kb-1")
	wantProblem(t, err, "validation_failed", "Вы уже можете править страницу")
	sp := spaceNamed(t, "m-kotova", "Логистика")
	assert.Equal(t, 1, *sp.OpenRequestCount, "«Запросы доступа: 1»")

	_, err = decide(t, "m-vasiliev", x.Id, kapi.Approve)
	wantProblem(t, err, "forbidden_action", textLeadOnly)
	ok1, err := decide(t, "m-kotova", x.Id, kapi.Approve)
	require.NoError(t, err)
	assert.Equal(t, kapi.KnowledgeAccessRequestStatusApproved, ok1.Status)
	assert.Equal(t, new("Марина Котова"), ok1.DecidedByDisplayName)
	n, err := getNode(t, "m-vasiliev", "kb-drv-1")
	require.NoError(t, err)
	assert.True(t, n.My.Edit, "an entry «правит» of the employee")
	assert.Equal(t, kapi.KnowledgeNodeAccessModeEditListed, n.AccessMode)
	_, err = decide(t, "m-kotova", x.Id, kapi.Deny)
	wantProblem(t, err, "not_found", "Запрос не найден или уже решён")

	res, err = askEdit(t, "m-vasiliev", "kb-drv-2")
	require.NoError(t, err)
	no, err := decide(t, "m-kotova", res.(kapi.CreateKnowledgeAccessRequest201JSONResponse).Body.Id, kapi.Deny) //nolint:forcetypeassert // the success of the call above
	require.NoError(t, err)
	assert.Equal(t, kapi.KnowledgeAccessRequestStatusDenied, no.Status)

	// A request to read (seeded only): «Читатель» of the page for 30 days (PD-60, Q-W4.00-knowledge-7).
	read := uuid.New()
	require.NoError(t, exec(t.Context(), `insert into kb.requests (id, node_id, space_id, member_id, can, requested_at)
		values ($1, $2, $3, $4, 'view', now())`, read, pid("kb-1"), pid("sp-log"), pid("m-morozova")))
	_, err = getNode(t, "m-morozova", "kb-1")
	wantProblem(t, err, "not_found", "")
	yes, err := decide(t, "m-kotova", read, kapi.Approve)
	require.NoError(t, err)
	require.NotNil(t, yes.Until)
	assert.Equal(t, "2026-10-31", yes.Until.Format("2006-01-02"))
	_, err = getNode(t, "m-morozova", "kb-1a")
	require.NoError(t, err, "the branch of the page opens")
	m, err := srv.ListKnowledgeSpaceMembers(as(t, "m-kotova"), kapi.ListKnowledgeSpaceMembersRequestObject{SpaceId: pid("sp-log")})
	require.NoError(t, err)
	pages := *m.(kapi.ListKnowledgeSpaceMembers200JSONResponse).Body.PageAssignments //nolint:forcetypeassert // the success of the call above
	require.Len(t, pages, 1)
	assert.Equal(t, "Анна Морозова", pages[0].DisplayName)
	assert.Equal(t, "2026-10-31", pages[0].Until.Format("2006-01-02"))
}

// recipients resolves the people of «Альта» as active members of tenant A (the control DB of the fixtures does not
// know them); everyone is in the audience.
type recipients struct{}

func (recipients) Recipient(_ context.Context, tenantID, personID uuid.UUID) (tenantctx.TenantContext, error) {
	return tenantctx.TenantContext{TenantID: tenantID, PersonID: personID}, nil
}

type everyone struct{}

func (everyone) Admits(context.Context, tenantctx.TenantContext, inbox.Rule) (bool, error) {
	return true, nil
}

func TestWriteNotifications(t *testing.T) { //nolint:paralleltest // the commands share the seed and run in order
	notifying := Server{S: &Service{Pools: pools, Memberships: memberships, Relations: relations{}, Recipients: recipients{},
		Audience: everyone{}, Now: svc.Now}}
	res, err := notifying.CreateKnowledgeAccessRequest(as(t, "m-vasiliev"), kapi.CreateKnowledgeAccessRequestRequestObject{
		NodeId: pid("kb-drv-2"), Body: &kapi.KnowledgeAccessRequestCreate{Can: "edit"}})
	require.NoError(t, err)
	_, ok := res.(kapi.CreateKnowledgeAccessRequest201JSONResponse)
	require.True(t, ok, "%T", res)
	rows, err := superA.Query(t.Context(), `select recipient_person_id, title from notify.notifications where kind = 'kb.request.created'
		order by recipient_person_id`)
	require.NoError(t, err)
	defer rows.Close()
	got := map[uuid.UUID]string{}
	for rows.Next() {
		var (
			p  uuid.UUID
			tt string
		)
		require.NoError(t, rows.Scan(&p, &tt))
		got[p] = tt
	}
	require.NoError(t, rows.Err())
	assert.Equal(t, map[uuid.UUID]string{
		pid("m-owner"):  "Илья Васильев просит право правки к «ДТП и поломка в пути»",
		pid("m-kotova"): "Илья Васильев просит право правки к «ДТП и поломка в пути»",
	}, got, "the leads of the space and the owners of the business at once (Q-W4.00-knowledge-7)")
}

func setMember(t *testing.T, proto, sp, member string, role *kapi.KnowledgeSpaceMemberChangeRole) (kapi.KnowledgeSpaceMembers, error) {
	t.Helper()
	res, err := srv.SetKnowledgeSpaceMember(as(t, proto), kapi.SetKnowledgeSpaceMemberRequestObject{SpaceId: pid(sp), MemberId: pid(member),
		Body: &kapi.KnowledgeSpaceMemberChange{Role: role}})
	if err != nil {
		return kapi.KnowledgeSpaceMembers{}, err
	}
	return res.(kapi.SetKnowledgeSpaceMember200JSONResponse).Body, nil //nolint:forcetypeassert // the success of the call above
}

func TestWriteMembers(t *testing.T) { //nolint:paralleltest // the commands share the seed and run in order
	reader, editor := new(kapi.KnowledgeSpaceMemberChangeRoleKbSpaceReader), new(kapi.KnowledgeSpaceMemberChangeRoleKbSpaceEditor)
	m, err := setMember(t, "m-kotova", "sp-log", "m-akhmedov", reader)
	require.NoError(t, err)
	assert.Equal(t, "Тимур Ахмедов", m.Roles[2].Members[0].DisplayName)
	assert.Contains(t, spaceNames(spaces(t, "m-akhmedov")), "Логистика")
	m, err = setMember(t, "m-kotova", "sp-log", "m-akhmedov", editor)
	require.NoError(t, err)
	assert.Empty(t, m.Roles[2].Members)
	assert.Len(t, m.Roles[1].Members, 2)
	m, err = setMember(t, "m-kotova", "sp-log", "m-akhmedov", nil)
	require.NoError(t, err)
	assert.Len(t, m.Roles[1].Members, 1, "«Убрать»")
	assert.Equal(t, 1, scalar[int](t, `select count(*) from outbox.events where type = 'access.assignment.changed.v1'
		and payload->>'memberId' = $1 and payload->>'role' = ''`, pid("m-akhmedov").String()))

	_, err = setMember(t, "m-kotova", "sp-log", "m-kotova", editor)
	wantProblem(t, err, "validation_failed", "Свою роль руководителя снимает владелец бизнеса")
	_, err = setMember(t, "m-kotova", "sp-log", "m-owner", reader)
	wantProblem(t, err, "validation_failed", "Владелец бизнеса видит всё без назначения")
	_, err = setMember(t, "m-kotova", "sp-log", "нет", reader)
	wantProblem(t, err, "validation_failed", "Выберите сотрудника")
	_, err = setMember(t, "m-kotelnikova", "sp-log", "m-akhmedov", reader)
	wantProblem(t, err, "forbidden_action", textLeadOnly)

	// A lead gives only the rights he has (docs/23, as roles.assign).
	addRoleSQL(t, "r-host", "Ведущий салона", actionRead, actionAccess, actionMembers)
	grantRoleSQL(t, "x-host", "m-sokolov", "r-host", scopeSpace, new(pid("sp-spa")))
	_, err = setMember(t, "m-sokolov", "sp-spa", "m-morozova", editor)
	wantProblem(t, err, "delegation_exceeds_grant", textDelegation)
	m, err = setMember(t, "m-sokolov", "sp-spa", "m-morozova", reader)
	require.NoError(t, err)
	assert.Equal(t, "Анна Морозова", m.Roles[2].Members[0].DisplayName)
}

func TestWriteAutomation(t *testing.T) { //nolint:paralleltest // the commands share the seed and run in order
	toggle := func(proto string, id uuid.UUID, on bool) (kapi.KnowledgeRule, error) {
		res, err := srv.SetKnowledgeRuleEnabled(as(t, proto), kapi.SetKnowledgeRuleEnabledRequestObject{RuleId: id,
			Body: &kapi.KnowledgeRulePatch{Enabled: on}})
		if err != nil {
			return kapi.KnowledgeRule{}, err
		}
		return res.(kapi.SetKnowledgeRuleEnabled200JSONResponse).Body, nil //nolint:forcetypeassert // the success of the call above
	}
	r, err := toggle("m-kotova", pid("kr-1"), false)
	require.NoError(t, err)
	assert.False(t, r.Enabled)
	_, err = toggle("m-kotova", pid("kr-1"), true)
	require.NoError(t, err)
	_, err = toggle("m-kotova", pid("нет"), true)
	wantProblem(t, err, "not_found", "Правило не найдено")
	_, err = toggle("m-vasiliev", pid("kr-1"), false)
	wantProblem(t, err, "forbidden_action", textLeadOnly)

	check := func(proto, sp string) (kapi.KnowledgeRunReport, error) {
		res, err := srv.RunKnowledgeReviewCheck(as(t, proto), kapi.RunKnowledgeReviewCheckRequestObject{SpaceId: pid(sp)})
		if err != nil {
			return kapi.KnowledgeRunReport{}, err
		}
		return res.(kapi.RunKnowledgeReviewCheck200JSONResponse).Body, nil //nolint:forcetypeassert // the success of the call above
	}
	rep, err := check("m-kotova", "sp-log")
	require.NoError(t, err)
	assert.Equal(t, 1, rep.Count)
	require.Len(t, rep.Runs, 1)
	assert.Equal(t, "«Как фотографировать машину при осмотре»: срок пересмотра 30.09.2026, уведомлён владелец Марина Котова", rep.Runs[0].Text)
	assert.Equal(t, "outdated", scalar[string](t, `select status from kb.nodes where id = $1`, pid("kb-2")))
	rep, err = check("m-kotova", "sp-log")
	require.NoError(t, err)
	assert.Zero(t, rep.Count)
	assert.Equal(t, "Остановлено условием: сроки пересмотра не наступили", rep.Runs[0].Text)
	assert.Equal(t, kapi.KnowledgeRunResultStopped, rep.Runs[0].Result)
	_, err = check("m-owner", "sp-rep")
	wantProblem(t, err, "validation_failed", "Правило «Пора пересмотреть» выключено")

	section := func(obj string) (kapi.RunKnowledgeSectionResponseObject, error) {
		return srv.RunKnowledgeSection(as(t, "m-owner"), kapi.RunKnowledgeSectionRequestObject{SpaceId: pid("sp-rep"),
			Body: &kapi.KnowledgeSectionCreate{ProjectId: pid(obj)}})
	}
	res, err := section("obj-38")
	require.NoError(t, err)
	s := res.(kapi.RunKnowledgeSection200JSONResponse).Body //nolint:forcetypeassert // the success of the call above
	assert.Equal(t, new(true), s.Created)
	assert.Equal(t, 1, s.Count)
	assert.Equal(t, "ЖК Северный парк · квартира 117: создан раздел и 5 подстраниц, доступ получил прораб Алексей Соколов", s.Runs[0].Text)
	ns, err := tree(t, "m-sokolov", "sp-rep")
	require.NoError(t, err)
	assert.Contains(t, titles(ns), "ЖК Северный парк · квартира 117")
	res, err = section("obj-42")
	require.NoError(t, err)
	s = res.(kapi.RunKnowledgeSection200JSONResponse).Body //nolint:forcetypeassert // the success of the call above
	assert.Equal(t, new(false), s.Created)
	assert.Equal(t, "ЖК Речной · квартира 42: остановлено условием — раздел уже есть", s.Runs[0].Text)
	res, err = section("obj-45")
	require.NoError(t, err)
	s = res.(kapi.RunKnowledgeSection200JSONResponse).Body //nolint:forcetypeassert // the success of the call above
	assert.Equal(t, kapi.KnowledgeRunResultWarn, s.Runs[0].Result)
	_, err = section("obj-0")
	wantProblem(t, err, "not_found", "Объект не найден")
	_, err = toggle("m-owner", pid("kr-3"), false)
	require.NoError(t, err)
	res, err = section("obj-38")
	require.NoError(t, err)
	v, ok := res.(kapi.RunKnowledgeSection422ApplicationProblemPlusJSONResponse)
	require.True(t, ok, "%T", res)
	field, msg := violation(t, v.ValidationApplicationProblemPlusJSONResponse)
	assert.Equal(t, "projectId", field)
	assert.Equal(t, "Правило выключено", msg)
}

func TestWriteTablesAndPages(t *testing.T) { //nolint:paralleltest // the commands share the seed and run in order
	table := func(proto, id, title string, cols ...string) (kapi.CreateKnowledgeTableResponseObject, error) {
		b := kapi.KnowledgeTableCreate{Title: title}
		for _, c := range cols {
			b.Columns = append(b.Columns, struct {
				Name string  `json:"name"`
				Type *string `json:"type,omitempty"`
			}{Name: c})
		}
		return srv.CreateKnowledgeTable(as(t, proto), kapi.CreateKnowledgeTableRequestObject{NodeId: pid(id), Body: &b})
	}
	res, err := table("m-kotova", "kb-1", "Пробеги", "Дата", "Км")
	require.NoError(t, err)
	tb := res.(kapi.CreateKnowledgeTable201JSONResponse).Body //nolint:forcetypeassert // the success of the call above
	assert.Len(t, tb.Columns, 2)
	assert.Equal(t, "text", tb.Columns[0].Type)
	_, err = table("m-kotova", "kb-1", "пробеги", "Дата")
	wantProblem(t, err, "validation_failed", "На странице уже есть таблица «пробеги»")
	_, err = table("m-kotova", "kb-1", "Расходы")
	wantProblem(t, err, "validation_failed", "Добавьте хотя бы один столбец")
	_, err = table("m-kotova", "kb-1", "Расходы", "Дата", " дата ")
	wantProblem(t, err, "validation_failed", "Названия столбцов повторяются")
	_, err = table("m-vasiliev", "kb-1", "Мои", "Дата")
	wantProblem(t, err, "forbidden_action", "Нет права править «Регламент приёмки смены»")

	page := func(proto, title, body string, parent *uuid.UUID) (kapi.KnowledgePage, error) {
		res, err := srv.CreateKnowledgePage(as(t, proto), kapi.CreateKnowledgePageRequestObject{Body: &kapi.KnowledgePageCreate{
			Title: title, BodyMarkdown: body, ParentPageId: parent}})
		if err != nil {
			return kapi.KnowledgePage{}, err
		}
		return res.(kapi.CreateKnowledgePage201JSONResponse).Body, nil //nolint:forcetypeassert // the success of the call above
	}
	p, err := page("m-kotova", "Памятка по погоде", " Гололёд. ", new(pid("kb-1")))
	require.NoError(t, err)
	assert.Equal(t, kapi.KnowledgePageStatusPublished, p.Status)
	assert.Equal(t, "Гололёд.", p.BodyMarkdown)
	assert.Nil(t, p.ParentPageId, "at the top level of the space of the parent page")
	assert.Equal(t, []uuid.UUID{pid("sp-log")}, p.Scope.ResourceIds)
	_, err = page("m-kotova", "памятка по погоде", "Текст", nil)
	wantProblem(t, err, "validation_failed", "В разделе «Логистика» уже есть страница «памятка по погоде»")
	_, err = page("m-kotova", "Ок", "Текст", nil)
	wantProblem(t, err, "validation_failed", "Название страницы — не короче 3 символов")
	_, err = page("m-kotova", "Пустая", "  ", nil)
	wantProblem(t, err, "validation_failed", "Текст страницы пустой")

	update := func(id uuid.UUID, ifMatch string, b kapi.KnowledgePagePatch) (kapi.KnowledgePage, error) {
		res, err := srv.UpdateKnowledgePage(as(t, "m-kotova"), kapi.UpdateKnowledgePageRequestObject{PageId: id, Body: &b,
			Params: kapi.UpdateKnowledgePageParams{IfMatch: ifMatch}})
		if err != nil {
			return kapi.KnowledgePage{}, err
		}
		return res.(kapi.UpdateKnowledgePage200JSONResponse).Body, nil //nolint:forcetypeassert // the success of the call above
	}
	p, err = update(p.Id, `"rev-1"`, kapi.KnowledgePagePatch{BodyMarkdown: new("Гололёд и снег.")})
	require.NoError(t, err)
	assert.Equal(t, int64(2), p.Revision)
	_, err = update(p.Id, `"rev-1"`, kapi.KnowledgePagePatch{BodyMarkdown: new("Снова")})
	wantProblem(t, err, "revision_mismatch", "Страницу уже изменили (v2). Обновите и повторите правку.")
	archivedStatus, published := kapi.KnowledgePagePatchStatusArchived, kapi.KnowledgePagePatchStatusPublished
	p, err = update(p.Id, `"rev-2"`, kapi.KnowledgePagePatch{Status: &archivedStatus})
	require.NoError(t, err)
	assert.Equal(t, kapi.KnowledgePageStatusArchived, p.Status)
	p, err = update(p.Id, `"rev-2"`, kapi.KnowledgePagePatch{Status: &published})
	require.NoError(t, err)
	assert.Equal(t, kapi.KnowledgePageStatusPublished, p.Status)
}
