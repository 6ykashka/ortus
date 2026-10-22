//go:build integration

package forms

import (
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
)

func formNames(p fapi.FormPage) []string {
	out := []string{}
	for _, f := range p.Items {
		out = append(out, f.Name)
	}
	return out
}

// Creation (empty, a template, a copy, a definition), the card and the filters of the list.
func TestCreateAndList(t *testing.T) {
	t.Parallel()
	ctx, owner, s := t.Context(), as(t, "a.owner"), service()
	fb := must(s.CreateForm(ctx, owner, fapi.FormCreate{Name: "Отзыв клиентов CL", TemplateId: new("tpl-feedback")})).of(t)
	assert.Equal(t, fapi.FormStatusDraft, fb.Status)
	assert.Nil(t, fb.PublishedVersionNumber)
	assert.Nil(t, fb.LatestVersionId)
	assert.Equal(t, 5, fb.QuestionCount)
	assert.Equal(t, "tpl-feedback", *fb.TemplateId)
	assert.Equal(t, fapi.FormSettingsAccessPublic, fb.Settings.Access, "the settings of the template")
	assert.Equal(t, fapi.FormMy{Create: true, Manage: true, Publish: true, PublishPublic: true, ReadResponses: true,
		ReviewResponses: true, Respond: false}, fb.My)
	assert.Equal(t, "Владелец Холдинга", fb.Owner.DisplayName)
	d := must(s.Draft(ctx, owner, fb.Id)).of(t)
	keys := []string{}
	for _, x := range d.Definition.Fields {
		keys = append(keys, x.Key)
	}
	assert.Equal(t, []string{"q-rate", "q-recommend", "q-better", "q-comment", "q-phone"}, keys)
	assert.Equal(t, 1, count(t, `select count(*) from outbox.events where type = 'forms.form.created.v1' and aggregate_id = $1`, fb.Id))

	cp := must(s.CreateForm(ctx, owner, fapi.FormCreate{Name: "Отзыв клиентов CL · копия", SourceFormId: new(fb.Id)})).of(t)
	assert.Equal(t, 5, cp.QuestionCount)
	assert.Nil(t, cp.TemplateId, "a copy has no template")

	empty := must(s.CreateForm(ctx, owner, fapi.FormCreate{Name: "  Пустая CL  "})).of(t)
	assert.Equal(t, "Пустая CL", empty.Name)
	assert.Equal(t, 0, empty.QuestionCount)

	_, err := s.CreateForm(ctx, owner, fapi.FormCreate{Name: "отзыв КЛИЕНТОВ cl", TemplateId: new("blank")})
	wantField(t, err, "name", "taken", "Форма «отзыв КЛИЕНТОВ cl» уже есть — измените название")
	_, err = s.CreateForm(ctx, owner, fapi.FormCreate{Name: "  ab ", TemplateId: new("blank")})
	wantField(t, err, "name", "invalid", "Укажите название формы — не короче 3 символов")
	_, err = s.CreateForm(ctx, owner, fapi.FormCreate{Name: "Отчёт прораба CL", TemplateId: new("tpl-foreman")})
	wantCode(t, err, codeModule, "Модуль «Ремонт и стройка» не подключён: шаблон недоступен")
	_, err = s.CreateForm(ctx, owner, fapi.FormCreate{Name: "Шаблон CL", TemplateId: new("tpl-none")})
	wantField(t, err, "templateId", "invalid", "Шаблон не найден")
	_, err = s.CreateForm(ctx, owner, fapi.FormCreate{Name: "Два источника", TemplateId: new("blank"), SourceFormId: new(fb.Id)})
	wantField(t, err, "body", "invalid", "Выберите шаблон или форму для копии")
	_, err = s.CreateForm(ctx, owner, fapi.FormCreate{Name: "Область CL", OrgUnitId: new(uuid.New())})
	wantField(t, err, "orgUnitId", "invalid", "Область не найдена")

	list := must(s.Forms(ctx, owner, ListQuery{Q: new("cl")})).of(t)
	assert.ElementsMatch(t, []string{"Отзыв клиентов CL", "Отзыв клиентов CL · копия", "Пустая CL"}, formNames(list))
	drafts := must(s.Forms(ctx, owner, ListQuery{Q: new("отзыв клиентов"), Status: new("draft"), OwnerMe: true})).of(t)
	assert.Len(t, drafts.Items, 2)
	assert.Empty(t, must(s.Forms(ctx, owner, ListQuery{Q: new("отзыв клиентов"), Status: new("open")})).of(t).Items)
	assert.Empty(t, must(s.Forms(ctx, as(t, "a.region-msk"), ListQuery{Q: new("cl"), OwnerMe: true})).of(t).Items)
}

// The area of a form (Q-W4.05-4): a role of a unit sees the forms of its unit and of the whole organization, manages
// only those of its unit; a form of another unit answers 404 as a missing one.
func TestAreaOfForm(t *testing.T) {
	t.Parallel()
	ctx, s := t.Context(), service()
	region := as(t, "a.region-msk")
	msk2 := must(s.CreateForm(ctx, region, fapi.FormCreate{Name: "Опрос Москвы-2 AR", OrgUnitId: new(unit("msk2"))})).of(t)
	org := must(s.CreateForm(ctx, as(t, "a.owner"), fapi.FormCreate{Name: "Опрос организации AR"})).of(t)
	smr := must(s.CreateForm(ctx, as(t, "a.owner"), fapi.FormCreate{Name: "Опрос Самары AR", OrgUnitId: new(unit("smr"))})).of(t)
	_, err := s.CreateForm(ctx, region, fapi.FormCreate{Name: "Опрос всей организации AR"})
	wantCode(t, err, codeForbidden, "Нет права «Создавать формы»")

	seen := formNames(must(s.Forms(ctx, region, ListQuery{Q: new(" ar")})).of(t))
	assert.ElementsMatch(t, []string{"Опрос Москвы-2 AR", "Опрос организации AR"}, seen)
	assert.True(t, must(s.Form(ctx, region, msk2.Id)).of(t).My.Manage)
	o := must(s.Form(ctx, region, org.Id)).of(t)
	assert.False(t, o.My.Manage, "a form of the whole organization is managed by a role of the organization")
	assert.True(t, o.My.ReviewResponses, "the key in any role reviews a form of the whole organization")
	_, err = s.Form(ctx, region, smr.Id)
	wantCode(t, err, codeNotFound, "Форма не найдена")
	_, err = s.Form(ctx, region, uuid.New())
	wantCode(t, err, codeNotFound, "Форма не найдена")
	_, err = s.UpdateForm(ctx, region, org.Id, rev(o.Revision), fapi.FormPatch{Name: new("Чужая")}, nil)
	wantCode(t, err, codeForbidden, "Нет права «Настраивать» формы")
	_, err = s.UpdateForm(ctx, region, msk2.Id, rev(msk2.Revision), fapi.FormPatch{OrgUnitId: new(unit("smr"))}, nil)
	wantCode(t, err, codeForbidden, "Нет права «Настраивать» формы")
	moved := must(s.UpdateForm(ctx, region, msk2.Id, rev(msk2.Revision), fapi.FormPatch{OrgUnitId: new(unit("msk1"))}, nil)).of(t)
	assert.Equal(t, unit("msk1"), *moved.OrgUnitId)
	all := must(s.UpdateForm(ctx, as(t, "a.owner"), msk2.Id, rev(moved.Revision), fapi.FormPatch{}, Nulls{"orgUnitId": true})).of(t)
	assert.Nil(t, all.OrgUnitId, "an explicit null — «Вся организация»")

	driver := as(t, "a.driver-msk1")
	assert.ElementsMatch(t, []string{"Опрос Москвы-2 AR", "Опрос организации AR"}, formNames(must(s.Forms(ctx, driver,
		ListQuery{Q: new(" ar")})).of(t)), "forms.read of Москва-1 sees the forms of the organization")
}

// The draft (Q-W4.00-forms-1): its own revision and 412 of two editors, the structure 422, the issues of issues();
// the publication (checks of api.js first), the versions and the key «{key}-v{N}», the discard (AC-09: the versions
// keep their questions).
func TestDraftPublishVersions(t *testing.T) {
	t.Parallel()
	ctx, owner, s := t.Context(), as(t, "a.owner"), service()
	f := must(s.CreateForm(ctx, owner, fapi.FormCreate{Name: "Осмотр DP"})).of(t)
	d := must(s.Draft(ctx, owner, f.Id)).of(t)
	assert.Equal(t, []fapi.FormIssue{{Message: "В форме нет ни одного вопроса"}}, d.Issues)
	assert.Nil(t, d.BaseVersionNumber)

	crew := qq("q-crew", fapi.FormQuestionTypeMulti, "Явка бригады", true)
	crew.Options = &[]fapi.FormOption{}
	odo := qq("q-odo", fapi.FormQuestionTypeText, "Пробег", true)
	saved := must(s.SaveDraft(ctx, owner, f.Id, rev(d.Revision), fapi.FormDraftSave{Definition: page(odo, crew)})).of(t)
	assert.Equal(t, d.Revision+1, saved.Revision)
	assert.Equal(t, []string{"«Явка бригады»: нет вариантов ответа"}, issueTexts(saved.Issues))
	_, err := s.SaveDraft(ctx, owner, f.Id, rev(d.Revision), fapi.FormDraftSave{Definition: page(odo)})
	wantCode(t, err, codeRevision, "Черновик изменил другой редактор — обновите страницу")
	_, err = s.SaveDraft(ctx, owner, f.Id, rev(saved.Revision), fapi.FormDraftSave{Definition: page(odo, odo)})
	wantField(t, err, "q-odo", "duplicate", "Такой идентификатор уже есть")

	_, err = s.Publish(ctx, owner, f.Id, rev(f.Revision), fapi.FormPublishRequest{DraftRevision: saved.Revision})
	wantField(t, err, "form", "publish", "У вопроса «Явка бригады» нет вариантов ответа")
	wantField(t, err, "q-crew", "issue", "«Явка бригады»: нет вариантов ответа")
	assert.Equal(t, "Найдено ошибок: 2. Исправьте их в конструкторе.", detailOf(err))
	_, err = s.DiscardDraft(ctx, owner, f.Id, rev(saved.Revision))
	wantReason(t, err, reasonNotPublished, "У формы ещё нет опубликованной версии")
	_, err = s.UpdateForm(ctx, owner, f.Id, rev(f.Revision), fapi.FormPatch{Status: new(fapi.FormPatchStatusClosed)}, nil)
	wantReason(t, err, reasonNotPublished, "Форма ещё не опубликована")

	crew.Options = &[]fapi.FormOption{{Key: "o1", Label: "Все"}, {Key: "o2", Label: "Не все"}}
	saved = must(s.SaveDraft(ctx, owner, f.Id, rev(saved.Revision), fapi.FormDraftSave{Definition: page(odo, crew)})).of(t)
	_, err = s.Publish(ctx, owner, f.Id, rev(f.Revision), fapi.FormPublishRequest{DraftRevision: saved.Revision - 1})
	wantCode(t, err, codeRevision, "Черновик изменил другой редактор — обновите страницу")
	_, err = s.Publish(ctx, owner, f.Id, `"rev-9"`, fapi.FormPublishRequest{DraftRevision: saved.Revision})
	wantCode(t, err, codeRevision, "Форму уже изменили — обновите страницу")
	v1 := must(s.Publish(ctx, owner, f.Id, rev(f.Revision), fapi.FormPublishRequest{DraftRevision: saved.Revision})).of(t)
	assert.Equal(t, fapi.FormStatusPublished, v1.Status)
	assert.Equal(t, 1, *v1.PublishedVersionNumber)
	assert.False(t, v1.HasUnpublishedChanges)
	assert.Equal(t, 1, count(t, `select count(*) from outbox.events where type = 'forms.version.published.v1' and aggregate_id = $1`, f.Id))
	d = must(s.Draft(ctx, owner, f.Id)).of(t)
	_, err = s.Publish(ctx, owner, f.Id, rev(v1.Revision), fapi.FormPublishRequest{DraftRevision: d.Revision})
	wantReason(t, err, reasonNoChanges, "Изменений для публикации нет")

	odo.Type = fapi.FormQuestionTypeInt
	saved = must(s.SaveDraft(ctx, owner, f.Id, rev(d.Revision), fapi.FormDraftSave{Definition: page(odo, crew)})).of(t)
	assert.True(t, saved.HasChanges)
	g := must(s.Form(ctx, owner, f.Id)).of(t)
	assert.True(t, g.HasUnpublishedChanges)
	v2 := must(s.Publish(ctx, owner, f.Id, rev(g.Revision), fapi.FormPublishRequest{DraftRevision: saved.Revision})).of(t)
	assert.Equal(t, 2, *v2.PublishedVersionNumber)
	vs := must(s.Versions(ctx, owner, f.Id, nil, nil)).of(t)
	require.Len(t, vs.Items, 2)
	assert.Equal(t, []any{int64(2), true, "q-odo-v2"}, []any{vs.Items[0].Number, vs.Items[0].Current, vs.Items[0].Definition.Fields[0].Key})
	assert.Equal(t, []any{int64(1), false, "q-odo", fapi.FormQuestionTypeText},
		[]any{vs.Items[1].Number, vs.Items[1].Current, vs.Items[1].Definition.Fields[0].Key, vs.Items[1].Definition.Fields[0].Type},
		"AC-09: a published version is immutable")
	assert.Equal(t, 2, vs.Items[0].QuestionCount)

	d = must(s.Draft(ctx, owner, f.Id)).of(t)
	changed := must(s.SaveDraft(ctx, owner, f.Id, rev(d.Revision), fapi.FormDraftSave{Definition: page(crew)})).of(t)
	assert.True(t, changed.HasChanges)
	back := must(s.DiscardDraft(ctx, owner, f.Id, rev(changed.Revision))).of(t)
	assert.False(t, back.HasChanges)
	assert.Len(t, back.Definition.Fields, 2)
	assert.Equal(t, "q-odo-v2", back.Definition.Fields[0].Key)

	closed := must(s.UpdateForm(ctx, owner, f.Id, rev(v2.Revision), fapi.FormPatch{Status: new(fapi.FormPatchStatusClosed)}, nil)).of(t)
	assert.Equal(t, fapi.FormStatusClosed, closed.Status)
	assert.False(t, closed.My.Respond)
	assert.Equal(t, 1, count(t, `select count(*) from outbox.events where type = 'forms.form.closed.v1' and aggregate_id = $1`, f.Id))
	open := must(s.UpdateForm(ctx, owner, f.Id, rev(closed.Revision), fapi.FormPatch{Status: new(fapi.FormPatchStatusOpen)}, nil)).of(t)
	assert.Equal(t, fapi.FormStatusPublished, open.Status)
	assert.True(t, open.My.Respond)

	wantReason(t, s.DraftFlow(ctx, owner, f.Id), reasonDraftFlow, "Версии создаёт публикация черновика")
	wantCode(t, s.DraftFlow(ctx, owner, uuid.New()), codeNotFound, "Форма не найдена")
}

func issueTexts(is []fapi.FormIssue) []string {
	out := []string{}
	for _, i := range is {
		out = append(out, i.Message)
	}
	return out
}

// The settings (FormPatch v2): the name trimmed, explicit nulls, the limit, public access with its right and no CRM
// question, the retention shortened with its grace.
func TestUpdateSettings(t *testing.T) {
	t.Parallel()
	ctx, owner, s := t.Context(), as(t, "a.owner"), service()
	f := must(s.CreateForm(ctx, owner, fapi.FormCreate{Name: "Настройки ST"})).of(t)
	_, err := s.UpdateForm(ctx, owner, f.Id, rev(f.Revision), fapi.FormPatch{Name: new("  ab ")}, nil)
	wantField(t, err, "name", "invalid", "Название формы — не короче 3 символов")
	until := must(s.UpdateForm(ctx, owner, f.Id, rev(f.Revision), fapi.FormPatch{Settings: &fapi.FormSettingsPatch{
		ResponseLimit: new(500), PassScore: new(3), OnePerMember: new(true), RetainResponsesDays: new(fapi.FormSettingsPatchRetainResponsesDaysN90)}}, nil)).of(t)
	assert.Equal(t, 500, *until.Settings.ResponseLimit)
	assert.True(t, until.Settings.OnePerMember)
	assert.Equal(t, fapi.FormSettingsRetainResponsesDaysN90, until.Settings.RetainResponsesDays)
	assert.Equal(t, 1, count(t, `select count(*) from forms.forms where id = $1 and settings->'shortened'->>'days' = '365'`, f.Id),
		"the older responses keep a year for the grace period")
	cleared := must(s.UpdateForm(ctx, owner, f.Id, rev(until.Revision), fapi.FormPatch{Settings: &fapi.FormSettingsPatch{}},
		Nulls{"settings.responseLimit": true, "settings.passScore": true})).of(t)
	assert.Nil(t, cleared.Settings.ResponseLimit)
	assert.Nil(t, cleared.Settings.PassScore)
	_, err = s.UpdateForm(ctx, owner, f.Id, rev(cleared.Revision), fapi.FormPatch{Settings: &fapi.FormSettingsPatch{ResponseLimit: new(0)}}, nil)
	wantField(t, err, "settings.responseLimit", "invalid", "Лимит ответов — положительное число")

	dr := must(s.Draft(ctx, owner, f.Id)).of(t)
	who := qq("q-who", fapi.FormQuestionTypePerson, "Кто дежурит", true)
	must(s.SaveDraft(ctx, owner, f.Id, rev(dr.Revision), fapi.FormDraftSave{Definition: page(who)})).of(t)
	_, err = s.UpdateForm(ctx, owner, f.Id, rev(cleared.Revision), fapi.FormPatch{Settings: &fapi.FormSettingsPatch{
		Access: new(fapi.FormSettingsPatchAccessPublic)}}, nil)
	wantField(t, err, "settings.access", "invalid", "Публичный доступ невозможен: вопрос «Кто дежурит» спрашивает данные CRM")

	m := must(s.CreateForm(ctx, as(t, "a.region-msk"), fapi.FormCreate{Name: "Публичная ST", OrgUnitId: new(unit("msk1"))})).of(t)
	_, err = s.UpdateForm(ctx, as(t, "a.manager-msk1"), m.Id, rev(m.Revision), fapi.FormPatch{Settings: &fapi.FormSettingsPatch{
		Access: new(fapi.FormSettingsPatchAccessPublic)}}, nil)
	require.NoError(t, err, "a.manager-msk1 holds forms.publish_public in Москва-1")
}

// Groups of forms (FM-03): the name, the repeat, the move, the counter of the forms seen, the deletion of an empty one.
func TestGroups(t *testing.T) {
	t.Parallel()
	ctx, owner, s := t.Context(), as(t, "a.owner"), service()
	g := must(s.CreateGroup(ctx, owner, fapi.FormGroupCreate{Name: "  Опросы GR  "})).of(t)
	assert.Equal(t, "Опросы GR", g.Name)
	_, err := s.CreateGroup(ctx, owner, fapi.FormGroupCreate{Name: "опросы gr"})
	wantField(t, err, "name", "taken", "Такая группа уже есть")
	_, err = s.CreateGroup(ctx, owner, fapi.FormGroupCreate{Name: " a "})
	wantField(t, err, "name", "invalid", "Название группы — от 2 символов")

	f := must(s.CreateForm(ctx, owner, fapi.FormCreate{Name: "Анкета GR", OrgUnitId: new(unit("smr"))})).of(t)
	moved := must(s.UpdateForm(ctx, owner, f.Id, rev(f.Revision), fapi.FormPatch{GroupId: new(g.Id)}, nil)).of(t)
	assert.Equal(t, g.Id, *moved.GroupId)
	_, err = s.UpdateForm(ctx, owner, f.Id, rev(moved.Revision), fapi.FormPatch{GroupId: new(uuid.New())}, nil)
	wantField(t, err, "groupId", "invalid", "Группа не найдена")
	countOf := func(actor string) int {
		for _, x := range must(s.Groups(ctx, as(t, actor))).of(t).Items {
			if x.Id == g.Id {
				return x.FormCount
			}
		}
		return -1
	}
	assert.Equal(t, 1, countOf("a.owner"))
	assert.Equal(t, 0, countOf("a.region-msk"), "a form of Самара is not seen in Москва")
	inGroup := must(s.Forms(ctx, owner, ListQuery{Group: new(g.Id)})).of(t)
	assert.Equal(t, []string{"Анкета GR"}, formNames(inGroup))
	wantReason(t, s.DeleteGroup(ctx, owner, g.Id), reasonGroupFull, "В группе есть формы — сначала переместите их")
	must(s.UpdateForm(ctx, owner, f.Id, rev(moved.Revision), fapi.FormPatch{}, Nulls{"groupId": true})).of(t)
	require.NoError(t, s.DeleteGroup(ctx, owner, g.Id))
	wantCode(t, s.DeleteGroup(ctx, owner, g.Id), codeNotFound, "Группа не найдена")
}

// listFormTemplates: the 15 templates; the industry ones by the modules of the tenant.
func TestTemplates(t *testing.T) {
	t.Parallel()
	list := must(service().Templates(t.Context(), as(t, "a.owner"))).of(t)
	require.Len(t, list.Items, 15)
	for _, x := range list.Items {
		if x.ModuleKey != nil {
			assert.Equal(t, *x.ModuleKey == moduleFleet, x.Available, x.Id+": the fixtures install «Логистика» (stored as logistics)")
		}
	}
	assert.True(t, strings.HasPrefix(list.Items[0].Name, "Пустая"))
}
