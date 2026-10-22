package forms

import (
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
)

// keyRE is the pattern of FormQuestion.key of the contract.
var keyRE = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`)

func q(key string, typ fapi.FormQuestionType, label string, required bool) question {
	return question{Key: key, PageId: "p1", Type: typ, Label: label, Required: required}
}

func defOf(qs ...question) def {
	return def{Pages: []fapi.FormPageDefinition{{Id: "p1", Title: "Страница 1"}}, Fields: qs}
}

func opts(labels ...string) *[]fapi.FormOption {
	out := make([]fapi.FormOption, 0, len(labels))
	for i, l := range labels {
		out = append(out, fapi.FormOption{Key: "o" + string(rune('1'+i)), Label: l})
	}
	return &out
}

func showIf(mode fapi.FormShowIfMode, conds ...fapi.FormShowIfCondition) *fapi.FormShowIf {
	return &fapi.FormShowIf{Mode: mode, Conditions: conds}
}

func eq(key, value string) fapi.FormShowIfCondition {
	return fapi.FormShowIfCondition{FieldKey: key, Operator: fapi.FormShowIfConditionOperatorEquals, Value: value}
}

func messages(is []fapi.FormIssue) []string {
	out := []string{}
	for _, i := range is {
		out = append(out, i.Message)
	}
	return out
}

// The structure of a draft: a repeated key and a question on a missing page cannot be saved (saveFormDraft 422).
func TestStructureErrors(t *testing.T) {
	t.Parallel()
	d := defOf(q("q-odo", fapi.FormQuestionTypeInt, "Пробег", true), q("q-odo", fapi.FormQuestionTypeText, "Пробег", false))
	d.Fields = append(d.Fields, question{Key: "q-x", PageId: "p9", Type: fapi.FormQuestionTypeText, Label: "X"})
	d.Pages = append(d.Pages, fapi.FormPageDefinition{Id: "p1", Title: "Ещё"})
	got := structureErrors(d)
	assert.Equal(t, []violation{
		{field: "pages", code: "duplicate", message: "Страницы повторяются"},
		{field: "q-odo", code: "duplicate", message: "Такой идентификатор уже есть"},
		{field: "q-x", code: "unknown_page", message: "Страница не найдена"},
	}, got)
	assert.Empty(t, structureErrors(defOf(q("q-1", fapi.FormQuestionTypeText, "", false))), "an incomplete question is an issue, not an error")
}

// issues() of the prototype (dc:721–738) with its texts.
func TestIssues(t *testing.T) {
	t.Parallel()
	assert.Equal(t, []string{"В форме нет ни одного вопроса"}, messages(issuesOf(false, defOf(q("s", fapi.FormQuestionTypeStatement, "Текст", false)))))

	choice := q("q-crew", fapi.FormQuestionTypeMulti, "Явка бригады", true)
	choice.Options = &[]fapi.FormOption{}
	empty := q("q-fuel", fapi.FormQuestionTypeChoice, "Топливо", true)
	empty.Options = &[]fapi.FormOption{{Key: "o1", Label: "¼"}, {Key: "o2", Label: " "}}
	below := q("q-why", fapi.FormQuestionTypeText, "Почему", false)
	below.ShowIf = showIf(fapi.FormShowIfModeAll, eq("q-late", "true"))
	gone := q("q-gone", fapi.FormQuestionTypeText, "Куда", false)
	gone.ShowIf = showIf(fapi.FormShowIfModeAny, eq("q-none", "x"))
	hidden := q("q-src", fapi.FormQuestionTypeText, "Источник", true)
	hidden.Hidden = new(true)
	lohi := q("q-sum", fapi.FormQuestionTypeNumber, "Сумма", false)
	lohi.MinValue, lohi.MaxValue = new("10"), new("2")
	text := q("q-t", fapi.FormQuestionTypeText, "Отзыв", false)
	text.MinLength, text.MaxLength = new(5), new(3)
	d := defOf(choice, empty, q("q-x", fapi.FormQuestionTypeText, "  ", false), below, q("q-late", fapi.FormQuestionTypeBool, "Опоздал", false),
		gone, hidden, lohi, text, q("q-x", fapi.FormQuestionTypeText, "Повтор", false))
	assert.Equal(t, []string{
		"«Явка бригады»: нет вариантов ответа",
		"«Топливо»: есть пустой вариант",
		"Вопрос 3: нет текста",
		"«Почему»: условие ссылается на вопрос ниже — условие может зависеть только от вопросов выше",
		"«Куда»: условие ссылается на удалённый вопрос",
		"«Источник»: скрытый обязательный вопрос без значения по умолчанию",
		"«Сумма»: «от» больше «до»",
		"«Отзыв»: «от» больше «до»",
		"Идентификатор q-x повторяется",
	}, messages(issuesOf(false, d)))
	is := issuesOf(false, d)
	require.NotNil(t, is[0].FieldKey)
	assert.Equal(t, "q-crew", *is[0].FieldKey)

	crm := q("q-who", fapi.FormQuestionTypePerson, "Кто дежурит", true)
	assert.Equal(t, []string{"«Кто дежурит»: публичная форма не может спрашивать данные CRM"}, messages(issuesOf(true, defOf(crm))))
	assert.Empty(t, issuesOf(false, defOf(crm)))
}

// publishForm: the checks of api.js first (validatePublish, the first one only), then issues() not repeated.
func TestPublishViolations(t *testing.T) {
	t.Parallel()
	crew := q("q-crew", fapi.FormQuestionTypeMulti, "Явка бригады", true)
	crew.Options = &[]fapi.FormOption{}
	got := publishViolations(false, defOf(q("q-volume", fapi.FormQuestionTypeNumber, "Объём", true), crew))
	assert.Equal(t, []violation{
		{field: "form", code: "publish", message: "У вопроса «Явка бригады» нет вариантов ответа"},
		{field: "q-crew", code: "issue", message: "«Явка бригады»: нет вариантов ответа"},
	}, got)

	assert.Equal(t, []violation{{field: "form", code: "publish", message: "В форме нет ни одного вопроса"}},
		publishViolations(false, defOf()), "the same text is not repeated")
	assert.Equal(t, "У вопроса нет текста", publishViolations(false, defOf(q("a", fapi.FormQuestionTypeText, " ", false)))[0].message)
	crm := q("q-who", fapi.FormQuestionTypePerson, "Кто", true)
	assert.Equal(t, "Публичная форма не может спрашивать «Кто»: справочники CRM гостю не показываются",
		publishViolations(true, defOf(crm))[0].message)
	dup := publishViolations(false, defOf(q("q-a", fapi.FormQuestionTypeText, "А", false), q("q-a", fapi.FormQuestionTypeText, "Б", false)))
	assert.Equal(t, "Повторяется идентификатор вопроса q-a", dup[0].message)
	assert.Empty(t, publishViolations(false, defOf(q("q-a", fapi.FormQuestionTypeText, "А", false))))
}

// A question whose type changed gets «{key}-v{N}» within 64 characters; conditions of the version follow it.
func TestNextVersion(t *testing.T) {
	t.Parallel()
	long := "q" + strings.Repeat("x", 63)
	prev := defOf(q(long, fapi.FormQuestionTypeText, "Пробег", false))
	why := q("q-why", fapi.FormQuestionTypeText, "Почему", false)
	why.ShowIf = showIf(fapi.FormShowIfModeAll, eq(long, "0"))
	next := nextVersion(defOf(q(long, fapi.FormQuestionTypeNumber, "Пробег", false), why), &prev, 12)
	key := next.Fields[0].Key
	assert.Regexp(t, keyRE, key)
	assert.True(t, strings.HasSuffix(key, "-v12"), key)
	assert.Equal(t, key, next.Fields[1].ShowIf.Conditions[0].FieldKey)

	prev = defOf(q("q-odo", fapi.FormQuestionTypeText, "Пробег", false))
	next = nextVersion(defOf(q("q-odo", fapi.FormQuestionTypeNumber, "Пробег", false), q("q-odo-v2", fapi.FormQuestionTypeText, "Старый", false)), &prev, 2)
	assert.Equal(t, []string{"q-odo-v2-2", "q-odo-v2"}, []string{next.Fields[0].Key, next.Fields[1].Key})

	first := nextVersion(defOf(q("q-odo", fapi.FormQuestionTypeNumber, "Пробег", false)), nil, 1)
	assert.Equal(t, "q-odo", first.Fields[0].Key, "the first version keeps the keys")
	assert.Equal(t, "q-odo", prev.Fields[0].Key, "the previous version is not changed")
}

func TestQuestionCountAndSame(t *testing.T) {
	t.Parallel()
	d := defOf(q("a", fapi.FormQuestionTypeText, "А", false), q("s", fapi.FormQuestionTypeStatement, "Текст", false))
	assert.Equal(t, 1, questionCount(d))
	assert.True(t, sameDef(d, defOf(q("a", fapi.FormQuestionTypeText, "А", false), q("s", fapi.FormQuestionTypeStatement, "Текст", false))))
	assert.False(t, sameDef(d, defOf(q("a", fapi.FormQuestionTypeText, "Б", false))))
	assert.Equal(t, def{Pages: []fapi.FormPageDefinition{{Id: "p1", Title: "Страница 1"}}, Fields: []question{}}, emptyDef())
}
