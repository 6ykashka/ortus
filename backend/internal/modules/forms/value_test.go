package forms

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
)

func val(t *testing.T, raw string) *value {
	t.Helper()
	var v value
	require.NoError(t, json.Unmarshal([]byte(raw), &v))
	return &v
}

// pvCheck of the prototype (dc:688–705) with its texts.
func TestPvCheck(t *testing.T) {
	t.Parallel()
	text := q("q-t", fapi.FormQuestionTypeText, "Имя", true)
	text.MinLength, text.MaxLength = new(3), new(5)
	num := q("q-n", fapi.FormQuestionTypeNumber, "Сумма", false)
	num.MinValue, num.MaxValue = new("1"), new("100")
	money := q("q-m", fapi.FormQuestionTypeMoney, "Сумма, ₽", false)
	money.MaxValue = new("10")
	multi := q("q-c", fapi.FormQuestionTypeMulti, "Чек-лист", false)
	multi.Options = opts("Кузов", "Шины", "Свет")
	multi.MinSelected, multi.MaxSelected = new(2), new(2)
	choice := q("q-f", fapi.FormQuestionTypeChoice, "Топливо", false)
	choice.Options = opts("¼", "½")
	photo := q("q-p", fapi.FormQuestionTypePhoto, "Фото", false)
	photo.MaxFiles = new(1)
	for name, c := range map[string]struct {
		q    question
		v    string
		want string
	}{
		"обязательный пустой":     {text, `{"type":"text","value":"  "}`, "Обязательный вопрос"},
		"обязательный без ответа": {text, ``, "Обязательный вопрос"},
		"короче":            {text, `{"type":"text","value":"ab"}`, "Не короче 3 символов"},
		"длиннее":           {text, `{"type":"text","value":"abcdef"}`, "Не длиннее 5 символов"},
		"почта":             {q("e", fapi.FormQuestionTypeEmail, "Почта", false), `{"type":"text","value":"a@b"}`, "Проверьте адрес почты"},
		"почта ок":          {q("e", fapi.FormQuestionTypeEmail, "Почта", false), `{"type":"text","value":"a@b.ru"}`, ""},
		"телефон":           {q("p", fapi.FormQuestionTypePhone, "Телефон", false), `{"type":"text","value":"+7 900 1"}`, "Нужно не меньше 10 цифр"},
		"ИНН":               {q("i", fapi.FormQuestionTypeInn, "ИНН", false), `{"type":"text","value":"12345678901"}`, "ИНН — 10 или 12 цифр"},
		"ссылка":            {q("u", fapi.FormQuestionTypeUrl, "Ссылка", false), `{"type":"text","value":"ftp://x"}`, "Ссылка начинается с http:// или https://"},
		"целое":             {q("n", fapi.FormQuestionTypeInt, "Пробег", false), `{"type":"decimal","value":"1.5"}`, "Нужно целое число"},
		"меньше":            {num, `{"type":"decimal","value":"0"}`, "Не меньше 1"},
		"больше":            {num, `{"type":"decimal","value":"101"}`, "Не больше 100"},
		"сумма больше":      {money, `{"type":"money","value":{"amountMinor":1500,"currency":"RUB"}}`, "Не больше 10"},
		"тип":               {num, `{"type":"text","value":"5"}`, "Неверный тип ответа"},
		"не из списка":      {choice, `{"type":"choices","value":["o9"]}`, "Выберите вариант из списка"},
		"один вариант":      {choice, `{"type":"choices","value":["o1","o2"]}`, "Выберите один вариант"},
		"другое без опции":  {choice, `{"type":"choices","value":["other"],"otherText":"Бак пуст"}`, "Выберите вариант из списка"},
		"не меньше выбрать": {multi, `{"type":"choices","value":["o1"]}`, "Выберите не меньше 2"},
		"не больше выбрать": {multi, `{"type":"choices","value":["o1","o2","o3"]}`, "Выберите не больше 2"},
		"файлов много":      {photo, `{"type":"files","value":["` + uuid.NewString() + `","` + uuid.NewString() + `"]}`, "Не больше 1 файлов"},
		"текст без вопроса": {q("s", fapi.FormQuestionTypeStatement, "Текст", true), ``, ""},
		"да":                {q("b", fapi.FormQuestionTypeBool, "Да?", true), `{"type":"boolean","value":false}`, ""},
		"дата":              {q("d", fapi.FormQuestionTypeDate, "Дата", true), `{"type":"date","value":"2026-10-01"}`, ""},
		"ссылка на объект":  {q("r", fapi.FormQuestionTypeRef, "Рейс", true), `{"type":"reference","value":{"moduleKey":"fleet","entityType":"trip","entityId":"` + uuid.NewString() + `"}}`, ""},
	} {
		var v *value
		if c.v != "" {
			v = val(t, c.v)
		}
		assert.Equal(t, c.want, pvCheck(c.q, v), name)
	}
	other := choice
	other.OtherOption = new(true)
	assert.Empty(t, pvCheck(other, val(t, `{"type":"choices","value":["other"],"otherText":"Бак пуст"}`)))
}

// Conditions of showing: all / any, equals / not equals; keys of options, true/false, text without case.
func TestShown(t *testing.T) {
	t.Parallel()
	vals := answers{
		"q-fuel":   *val(t, `{"type":"choices","value":["o3"]}`),
		"q-defect": *val(t, `{"type":"boolean","value":true}`),
		"q-city":   *val(t, `{"type":"text","value":"Москва"}`),
	}
	cond := func(mode fapi.FormShowIfMode, cs ...fapi.FormShowIfCondition) question {
		x := q("x", fapi.FormQuestionTypeText, "X", false)
		x.ShowIf = showIf(mode, cs...)
		return x
	}
	ne := func(key, value string) fapi.FormShowIfCondition {
		c := eq(key, value)
		c.Operator = fapi.FormShowIfConditionOperatorNotEquals
		return c
	}
	assert.True(t, shown(q("x", fapi.FormQuestionTypeText, "X", false), vals))
	assert.True(t, shown(cond(fapi.FormShowIfModeAll, eq("q-fuel", "o3"), eq("q-defect", "true"), eq("q-city", "москва")), vals))
	assert.False(t, shown(cond(fapi.FormShowIfModeAll, eq("q-fuel", "o3"), eq("q-defect", "false")), vals))
	assert.True(t, shown(cond(fapi.FormShowIfModeAny, eq("q-fuel", "o1"), eq("q-defect", "true")), vals))
	assert.True(t, shown(cond(fapi.FormShowIfModeAll, ne("q-fuel", "o1")), vals))
	assert.False(t, shown(cond(fapi.FormShowIfModeAll, eq("q-none", "x")), vals))
}

// Labels of values (Q-W4.00-forms-3: labels of options from the version) — the knowledge base, CSV and the summary.
func TestLabelOf(t *testing.T) {
	t.Parallel()
	fuel := q("q-fuel", fapi.FormQuestionTypeMulti, "Топливо", false)
	fuel.Options = opts("¼", "½", "¾")
	label := "Рейс Р-196"
	for want, c := range map[string]struct {
		q *question
		v *value
	}{
		"½, ¾, Бак пуст": {&fuel, val(t, `{"type":"choices","value":["o2","o3","other"],"otherText":"Бак пуст"}`)},
		"½, Другое":      {&fuel, val(t, `{"type":"choices","value":["o2","other"]}`)},
		"o7":             {nil, val(t, `{"type":"choices","value":["o7"]}`)},
		"да":             {nil, val(t, `{"type":"boolean","value":true}`)},
		"нет":            {nil, val(t, `{"type":"boolean","value":false}`)},
		"2 фото":         {nil, val(t, `{"type":"files","value":["`+uuid.NewString()+`","`+uuid.NewString()+`"]}`)},
		"Рейс Р-196":     {nil, &value{Type: "reference", Value: json.RawMessage(`{"moduleKey":"fleet","entityType":"trip","entityId":"` + uuid.NewString() + `"}`), Label: &label}},
		"1250.5":         {nil, val(t, `{"type":"money","value":{"amountMinor":125050,"currency":"RUB"}}`)},
		"01.10.2026":     {nil, val(t, `{"type":"date","value":"2026-10-01"}`)},
		"84210":          {nil, val(t, `{"type":"decimal","value":"84210"}`)},
		"почти полный":   {nil, val(t, `{"type":"text","value":"почти полный"}`)},
		"":               {nil, val(t, `{"type":"null","value":null}`)},
	} {
		assert.Equal(t, want, labelOf(c.q, c.v), want)
	}
	assert.Empty(t, labelOf(nil, nil))
}

// score() of the prototype: options with scores of shown, not hidden questions of choice.
func TestScoreOf(t *testing.T) {
	t.Parallel()
	one := q("q1", fapi.FormQuestionTypeChoice, "Один", true)
	one.Options = &[]fapi.FormOption{{Key: "o1", Label: "А", Score: new(0)}, {Key: "o2", Label: "Б", Score: new(1)}}
	many := q("q3", fapi.FormQuestionTypeMulti, "Много", true)
	many.Options = &[]fapi.FormOption{{Key: "o1", Label: "А", Score: new(1)}, {Key: "o2", Label: "Б", Score: new(1)}, {Key: "o3", Label: "В", Score: new(0)}}
	skipped := q("q4", fapi.FormQuestionTypeChoice, "Скрыт условием", false)
	skipped.Options = &[]fapi.FormOption{{Key: "o1", Label: "А", Score: new(5)}}
	skipped.ShowIf = showIf(fapi.FormShowIfModeAll, eq("q1", "o1"))
	d := defOf(one, many, skipped)
	vals := answers{"q1": *val(t, `{"type":"choices","value":["o2"]}`), "q3": *val(t, `{"type":"choices","value":["o1","o3"]}`)}
	assert.Equal(t, fapi.FormResponseScore{Points: 2, MaxPoints: 3, Passed: new(false)}, scoreOf(d, vals, new(3)))
	assert.Equal(t, fapi.FormResponseScore{Points: 2, MaxPoints: 3}, scoreOf(d, vals, nil))
}

// Answers are stored as FieldEntry of the contract and read back unchanged.
func TestEntriesRoundTrip(t *testing.T) {
	t.Parallel()
	raw := `[{"fieldKey":"q-odo","value":{"type":"decimal","value":"84530"}},{"fieldKey":"q-fuel","value":{"type":"choices","value":["o3"]}},` +
		`{"fieldKey":"q-who","value":{"type":"reference","value":{"moduleKey":"core","entityType":"member","entityId":"` +
		"0b6c5f2e-1111-4a5a-9a5a-111111111111" + `"},"label":"Марина Котова"}}]`
	var in []fapi.FieldEntry
	require.NoError(t, json.Unmarshal([]byte(raw), &in))
	es, err := fromAPI(in)
	require.NoError(t, err)
	require.Len(t, es, 3)
	assert.Equal(t, "84530", es[0].Value.str())
	assert.Equal(t, []string{"o3"}, es[1].Value.list())
	ref, ok := es[2].Value.ref()
	require.True(t, ok)
	assert.Equal(t, "member", ref.EntityType)
	out, err := json.Marshal(toAPI(es))
	require.NoError(t, err)
	assert.JSONEq(t, raw, string(out))
	_, err = fromAPI([]fapi.FieldEntry{{FieldKey: "x"}})
	assert.Error(t, err, "a value without a type")
}
