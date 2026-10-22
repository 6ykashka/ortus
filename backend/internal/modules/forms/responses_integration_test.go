//go:build integration

package forms

import (
	"encoding/json"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
)

// inspection is «Осмотр» of the tests: a number, a choice, «Да / нет» and a text shown when «да».
func inspection() def {
	why := qq("q-defect-text", fapi.FormQuestionTypeLongtext, "Описание дефекта", true, func(x *question) {
		x.ShowIf = &fapi.FormShowIf{Mode: fapi.FormShowIfModeAll, Conditions: []fapi.FormShowIfCondition{{FieldKey: "q-defect",
			Operator: fapi.FormShowIfConditionOperatorEquals, Value: "true"}}}
	})
	return page(qq("q-odo", fapi.FormQuestionTypeNumber, "Пробег", true), qq("q-fuel", fapi.FormQuestionTypeChoice, "Топливо", true,
		withOpts("¼", "½", "¾")), qq("q-defect", fapi.FormQuestionTypeBool, "Есть дефекты?", true), why)
}

// AC-09: a response of an employee is accepted by its version; after v2 it is read by the structure of v1.
func TestSubmitAndVersions(t *testing.T) {
	t.Parallel()
	ctx, owner, s := t.Context(), as(t, "a.owner"), service()
	f := published(t, "a.owner", "Осмотр AC09", inspection())
	v1 := *f.PublishedVersionId
	x := must(s.Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: v1, Answers: []fapi.FieldEntry{dec("q-odo", "84530"),
		choice("q-fuel", "o3"), flag("q-defect", false)}})).of(t)
	assert.Equal(t, fapi.FormResponseReviewStatusAccepted, x.ReviewStatus)
	assert.Equal(t, fapi.FormResponseChannelMember, x.Channel)
	assert.Regexp(t, `^R-\d{4,}$`, x.Number)
	assert.Equal(t, 1, x.VersionNumber)
	assert.Equal(t, v1, x.VersionId)
	assert.Equal(t, "Владелец Холдинга", x.Author.DisplayName)
	assert.Equal(t, fapi.FormResponseMy{Review: true, Assign: true}, x.My)
	assert.Equal(t, 1, count(t, `select count(*) from outbox.events where type = 'forms.response.submitted.v1' and aggregate_id = $1`, x.Id))

	_, err := s.Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: v1, Answers: []fapi.FieldEntry{dec("q-odo", "1"),
		choice("q-fuel", "o1"), flag("q-defect", true)}})
	wantField(t, err, "q-defect-text", "invalid", "Обязательный вопрос")

	d := must(s.Draft(ctx, owner, f.Id)).of(t)
	def2 := cloneDef(d.Definition)
	def2.Fields[0].Type = fapi.FormQuestionTypeInt
	def2.Fields = append(def2.Fields, qq("q-score", fapi.FormQuestionTypeRating, "Оценка", false))
	saved := must(s.SaveDraft(ctx, owner, f.Id, rev(d.Revision), fapi.FormDraftSave{Definition: def2})).of(t)
	g := must(s.Form(ctx, owner, f.Id)).of(t)
	g = must(s.Publish(ctx, owner, f.Id, rev(g.Revision), fapi.FormPublishRequest{DraftRevision: saved.Revision})).of(t)

	_, err = s.Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: v1, Answers: []fapi.FieldEntry{dec("q-odo", "1")}})
	wantReason(t, err, reasonVersion, "Форма обновилась — откройте её заново")
	y := must(s.Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: *g.PublishedVersionId, Answers: []fapi.FieldEntry{
		dec("q-odo-v2", "84600"), choice("q-fuel", "o2"), flag("q-defect", false), dec("q-score", "5")}})).of(t)
	assert.Equal(t, 2, y.VersionNumber)

	old := must(s.Response(ctx, owner, f.Id, x.Id)).of(t)
	assert.Equal(t, 1, old.VersionNumber, "AC-09: the response keeps its version")
	assert.Equal(t, v1, old.VersionId)
	assert.Equal(t, "84530", valueOf(t, old, "q-odo").str(), "the old key keeps its value")
	assert.Nil(t, valueOf(t, old, "q-odo-v2"))

	list := must(s.Responses(ctx, owner, f.Id, nil, nil)).of(t)
	require.Len(t, list.Items, 2)
	assert.Equal(t, []string{y.Number, x.Number}, []string{list.Items[0].Number, list.Items[1].Number}, "the latest first")

	sum := must(s.Summary(ctx, owner, f.Id)).of(t)
	keys := []string{}
	for _, q := range sum.Questions {
		keys = append(keys, q.FieldKey)
	}
	assert.Equal(t, []string{"q-odo-v2", "q-fuel", "q-defect", "q-defect-text", "q-score", "q-odo"}, keys,
		"the questions of all versions, the fresh version first")
	assert.Equal(t, 2, sum.Total)
	csv := must(s.Export(ctx, owner, f.Id)).of(t)
	assert.Equal(t, "Осмотр AC09.csv", csv.FileName)
	assert.Equal(t, 2, csv.RowCount)
	assert.True(t, strings.HasPrefix(csv.Content, bom+"Ответ;Дата;Автор;Объект;Версия;Статус;Пробег;Топливо;"), csv.Content)
	assert.Contains(t, csv.Content, ";v1;Принят;")
	assert.Equal(t, 1, count(t, `select count(*) from audit.events where action = 'forms.responses.exported' and target_id = $1`, f.Id))
}

// Refusals of the submission: closed, past «Принимать до», the limit, «Один ответ от сотрудника», a hidden question
// in the answers, a parameter of the link of another question; the hidden question from the link and its default.
func TestSubmitRefusals(t *testing.T) {
	t.Parallel()
	ctx, owner, s := t.Context(), as(t, "a.owner"), service()
	f := published(t, "a.owner", "Заявка SR", page(qq("q-text", fapi.FormQuestionTypeText, "Вопрос", true),
		qq("q-src", fapi.FormQuestionTypeText, "Источник", false, hidden("сайт"))))
	v := *f.PublishedVersionId
	_, err := s.Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: v, Answers: []fapi.FieldEntry{text("q-text", "Когда?"),
		text("q-src", "реклама")}})
	wantField(t, err, "q-src", "hidden", "Скрытый вопрос заполняют ссылка и значение по умолчанию")
	_, err = s.Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: v, Answers: []fapi.FieldEntry{text("q-text", "Когда?"),
		text("q-x", "?")}, LinkParams: &map[string]string{"q-text": "x"}})
	wantField(t, err, "q-x", "unknown", "Вопроса нет в форме")
	wantField(t, err, "linkParams.q-text", "not_hidden", "Параметр ссылки — только для скрытого вопроса")
	byLink := must(s.Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: v, Answers: []fapi.FieldEntry{text("q-text", "Когда?")},
		LinkParams: &map[string]string{"q-src": "email"}})).of(t)
	assert.Equal(t, []string{"q-src"}, *byLink.LinkParamKeys)
	assert.Equal(t, "email", valueOf(t, byLink, "q-src").str())
	byDefault := must(s.Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: v, Answers: []fapi.FieldEntry{text("q-text", "Скидки?")}})).of(t)
	assert.Equal(t, "сайт", valueOf(t, byDefault, "q-src").str())
	assert.Nil(t, byDefault.LinkParamKeys)

	once := must(s.UpdateForm(ctx, owner, f.Id, rev(f.Revision), fapi.FormPatch{Settings: &fapi.FormSettingsPatch{OnePerMember: new(true)}}, nil)).of(t)
	_, err = s.Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: v, Answers: []fapi.FieldEntry{text("q-text", "Ещё")}})
	wantReason(t, err, reasonAnswered, "Вы уже отвечали на эту форму")
	assert.False(t, must(s.Form(ctx, owner, f.Id)).of(t).My.Respond)
	limit := must(s.UpdateForm(ctx, owner, f.Id, rev(once.Revision), fapi.FormPatch{Settings: &fapi.FormSettingsPatch{
		OnePerMember: new(false), ResponseLimit: new(2)}}, nil)).of(t)
	_, err = s.Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: v, Answers: []fapi.FieldEntry{text("q-text", "Ещё")}})
	wantReason(t, err, reasonClosed, "Приём ответов закрыт")
	past := must(s.UpdateForm(ctx, owner, f.Id, rev(limit.Revision), fapi.FormPatch{Settings: untilPatch(t, "2020-01-01")},
		Nulls{"settings.responseLimit": true})).of(t)
	_, err = s.Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: v, Answers: []fapi.FieldEntry{text("q-text", "Ещё")}})
	wantReason(t, err, reasonClosed, "Приём ответов закрыт")
	must(s.UpdateForm(ctx, owner, f.Id, rev(past.Revision), fapi.FormPatch{Settings: &fapi.FormSettingsPatch{}}, Nulls{"settings.acceptUntil": true})).of(t)
	must(s.Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: v, Answers: []fapi.FieldEntry{text("q-text", "Можно")}})).of(t)

	_, err = s.Submit(ctx, owner, uuid.New(), fapi.FormResponseCreate{VersionId: v})
	wantCode(t, err, codeNotFound, "Форма не найдена")
	draft := must(s.CreateForm(ctx, owner, fapi.FormCreate{Name: "Черновик SR"})).of(t)
	_, err = s.Submit(ctx, owner, draft.Id, fapi.FormResponseCreate{VersionId: v})
	wantCode(t, err, codeNotFound, "Форма не найдена")
}

// untilPatch is the settings patch «Принимать до» day (the date type of the generator is set through JSON).
func untilPatch(t *testing.T, day string) *fapi.FormSettingsPatch {
	t.Helper()
	var p fapi.FormSettingsPatch
	require.NoError(t, json.Unmarshal([]byte(`{"acceptUntil":"`+day+`"}`), &p))
	return &p
}

// The limit and «Один ответ от сотрудника» hold under concurrency (select … for update of forms.forms).
func TestSubmitConcurrently(t *testing.T) {
	t.Parallel()
	ctx, owner, s := t.Context(), as(t, "a.owner"), service()
	f := published(t, "a.owner", "Гонка RC", page(qq("q-text", fapi.FormQuestionTypeText, "Вопрос", true)))
	f = must(s.UpdateForm(ctx, owner, f.Id, rev(f.Revision), fapi.FormPatch{Settings: &fapi.FormSettingsPatch{ResponseLimit: new(3)}}, nil)).of(t)
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for range 8 {
		wg.Go(func() {
			_, err := service().Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: *f.PublishedVersionId,
				Answers: []fapi.FieldEntry{text("q-text", "Ответ")}})
			errs <- err
		})
	}
	wg.Wait()
	close(errs)
	closed := 0
	for err := range errs {
		if err != nil {
			wantReason(t, err, reasonClosed, "Приём ответов закрыт")
			closed++
		}
	}
	assert.Equal(t, 5, closed)
	assert.Equal(t, 3, count(t, `select count(*) from forms.responses where form_id = $1`, f.Id), "the limit is not exceeded")

	once := published(t, "a.owner", "Один ответ RC", page(qq("q-text", fapi.FormQuestionTypeText, "Вопрос", true)))
	once = must(s.UpdateForm(ctx, owner, once.Id, rev(once.Revision), fapi.FormPatch{Settings: &fapi.FormSettingsPatch{OnePerMember: new(true)}}, nil)).of(t)
	var wg2 sync.WaitGroup
	for range 4 {
		wg2.Go(func() {
			_, _ = service().Submit(ctx, owner, once.Id, fapi.FormResponseCreate{VersionId: *once.PublishedVersionId,
				Answers: []fapi.FieldEntry{text("q-text", "Ответ")}})
		})
	}
	wg2.Wait()
	assert.Equal(t, 1, count(t, `select count(*) from forms.responses where form_id = $1`, once.Id), "one response of the member")
}

// Objects of the answers and of the response (return 2): an object the respondent does not see, a member who is not
// active, a unit of another level — 422; the label is set by the server.
func TestSubmitObjects(t *testing.T) {
	t.Parallel()
	ctx, owner, s := t.Context(), as(t, "a.owner"), service()
	trip := fapi.ObjectRef{ModuleKey: "fleet", EntityType: "trip", EntityId: uuid.New()}
	objects.set(trip, "Рейс Р-901")
	region := qq("q-region", fapi.FormQuestionTypeUnit, "Регион", false, func(x *question) {
		x.UnitLevel = new(fapi.FormQuestionUnitLevelRegion)
	})
	f := published(t, "a.owner", "Объекты OB", page(qq("q-who", fapi.FormQuestionTypePerson, "Кто", false), region,
		qq("q-trip", fapi.FormQuestionTypeRef, "Рейс", false, func(x *question) { x.RefKind = new(fapi.FormQuestionRefKindTrip) })))
	v := *f.PublishedVersionId
	member := fapi.ObjectRef{ModuleKey: "core", EntityType: "member", EntityId: person("a.manager-msk1")}
	x := must(s.Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: v, Subject: &trip, Answers: []fapi.FieldEntry{
		refTo("q-who", member), refTo("q-region", fapi.ObjectRef{ModuleKey: "core", EntityType: "org_unit", EntityId: unit("msk")}),
		refTo("q-trip", trip)}})).of(t)
	assert.Equal(t, "Рейс Р-901", x.Subject.Label)
	assert.Equal(t, "Менеджер Москва-1", *valueOf(t, x, "q-who").Label)
	assert.Equal(t, "Москва", *valueOf(t, x, "q-region").Label)
	assert.Equal(t, "Рейс Р-901", *valueOf(t, x, "q-trip").Label)

	other := fapi.ObjectRef{ModuleKey: "fleet", EntityType: "trip", EntityId: uuid.New()}
	_, err := s.Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: v, Subject: &other})
	wantField(t, err, "subject", "invalid", "Объект не найден")
	_, err = s.Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: v, Answers: []fapi.FieldEntry{
		refTo("q-who", fapi.ObjectRef{ModuleKey: "core", EntityType: "member", EntityId: uuid.New()}),
		refTo("q-region", fapi.ObjectRef{ModuleKey: "core", EntityType: "org_unit", EntityId: unit("msk1")}),
		refTo("q-trip", other)}})
	wantField(t, err, "q-who", "not_found", "Сотрудник не найден")
	wantField(t, err, "q-region", "not_found", "Объект не найден")
	wantField(t, err, "q-trip", "not_found", "Объект не найден")

	opts := must(s.Options(ctx, owner, f.Id, "q-who", new("менеджер москва-1"))).of(t)
	require.Len(t, opts.Items, 1)
	assert.Equal(t, member, opts.Items[0].Ref)
	units := must(s.Options(ctx, owner, f.Id, "q-region", nil)).of(t)
	for _, u := range units.Items {
		assert.Equal(t, "регион", *u.Hint)
	}
	trips := must(s.Options(ctx, owner, f.Id, "q-trip", new("Р-901"))).of(t)
	assert.Len(t, trips.Items, 1)
	_, err = s.Options(ctx, owner, f.Id, "q-none", nil)
	wantCode(t, err, codeNotFound, "Вопрос не найден")
}

// Who reads the responses (Q-W4.00-forms-9) and who reviews them (Q-W4.05-16): forms.responses.read of the area —
// all; the key elsewhere — own ones and those about an object he sees; the review of a form of the whole organization
// by the relation; the assignee.
func TestReadAndReview(t *testing.T) {
	t.Parallel()
	ctx, owner, s := t.Context(), as(t, "a.owner"), service()
	trip := fapi.ObjectRef{ModuleKey: "fleet", EntityType: "trip", EntityId: uuid.New()}
	objects.set(trip, "Рейс Р-902")
	f := published(t, "a.owner", "Отчёт RR", page(qq("q-text", fapi.FormQuestionTypeText, "Вопрос", true)))
	v := *f.PublishedVersionId
	about := must(s.Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: v, Subject: &trip,
		Answers: []fapi.FieldEntry{text("q-text", "По рейсу")}})).of(t)
	plain := must(s.Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: v, Answers: []fapi.FieldEntry{text("q-text", "Без рейса")}})).of(t)
	driver := as(t, "a.driver-msk1")
	mine := must(s.Submit(ctx, driver, f.Id, fapi.FormResponseCreate{VersionId: v, Answers: []fapi.FieldEntry{text("q-text", "Мой")}})).of(t)

	reviewer := as(t, "a.manager-msk2")
	seen := must(s.Responses(ctx, reviewer, f.Id, nil, nil)).of(t)
	numbers := []string{}
	for _, x := range seen.Items {
		numbers = append(numbers, x.Number)
	}
	assert.ElementsMatch(t, []string{about.Number}, numbers, "the key elsewhere: a response about an object he sees")
	_, err := s.Response(ctx, reviewer, f.Id, plain.Id)
	wantCode(t, err, codeNotFound, "Ответ не найден")
	r := must(s.Response(ctx, reviewer, f.Id, about.Id)).of(t)
	assert.Equal(t, fapi.FormResponseMy{Review: true, Assign: false}, r.My)
	assert.Equal(t, 1, must(s.Form(ctx, reviewer, f.Id)).of(t).ResponseCount)

	_, err = s.Review(ctx, reviewer, f.Id, about.Id, rev(r.Revision), fapi.ResponseReviewPatch{}, nil)
	wantField(t, err, "body", "invalid", textReviewEmpty)
	assert.Equal(t, int64(1), must(s.Response(ctx, owner, f.Id, about.Id)).of(t).Revision, "an empty body changes nothing")
	_, err = s.Review(ctx, reviewer, f.Id, about.Id, rev(r.Revision), fapi.ResponseReviewPatch{AssigneeMemberId: new(person("a.manager-msk2"))}, nil)
	wantCode(t, err, codeForbidden, "Нет права «Назначать ответственного за ответ»")
	rejected := must(s.Review(ctx, reviewer, f.Id, about.Id, rev(r.Revision), fapi.ResponseReviewPatch{
		ReviewStatus: new(fapi.ResponseReviewPatchReviewStatusRejected), ReviewComment: new("Нет фото одометра")}, nil)).of(t)
	assert.Equal(t, fapi.FormResponseReviewStatusRejected, rejected.ReviewStatus)
	assert.Equal(t, int64(2), rejected.Revision)
	_, err = s.Review(ctx, reviewer, f.Id, about.Id, rev(r.Revision), fapi.ResponseReviewPatch{ReviewComment: new("x")}, nil)
	wantCode(t, err, codeRevision, "Ответ уже изменили — обновите страницу")
	assigned := must(s.Review(ctx, owner, f.Id, about.Id, rev(rejected.Revision), fapi.ResponseReviewPatch{
		AssigneeMemberId: new(person("a.manager-msk2"))}, nil)).of(t)
	assert.Equal(t, person("a.manager-msk2"), *assigned.AssigneeMemberId)
	unassigned := must(s.Review(ctx, owner, f.Id, about.Id, rev(assigned.Revision), fapi.ResponseReviewPatch{}, Nulls{"assigneeMemberId": true})).of(t)
	assert.Nil(t, unassigned.AssigneeMemberId)

	own := must(s.Responses(ctx, driver, f.Id, nil, nil)).of(t)
	assert.Empty(t, own.Items, "forms.read without forms.responses.read reads nothing")
	_, err = s.Response(ctx, driver, f.Id, mine.Id)
	wantCode(t, err, codeNotFound, "Ответ не найден")
	_, err = s.Export(ctx, driver, f.Id)
	wantReason(t, err, reasonNoResponses, "Ответов пока нет")
}
