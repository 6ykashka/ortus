package forms

import (
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
)

// departureChecks are DEP_CHECKS of the prototype (fleetrules) as an inspection answers them.
func departureChecks(results ...string) []inspCheck {
	labels := []struct{ key, label string }{
		{"body", "Кузов и стёкла осмотрены"}, {"tires", "Шины и световые приборы исправны"}, {"docs", "Документы и комплект на месте"},
	}
	out := make([]inspCheck, 0, len(labels))
	for i, l := range labels {
		r := "pass"
		if i < len(results) {
			r = results[i]
		}
		out = append(out, inspCheck{key: l.key, label: l.label, result: r})
	}
	return out
}

// shown answers as the response keeps them: the key, the kind of the value and the value.
type got struct {
	key, typ string
	value    any
}

func flatten(es []entry) []got {
	out := make([]got, 0, len(es))
	for _, e := range es {
		var v any
		switch e.Value.Type {
		case vChoices:
			v = e.Value.list()
		case vBoolean:
			v, _ = e.Value.flag()
		default:
			v = e.Value.str()
		}
		out = append(out, got{e.FieldKey, e.Value.Type, v})
	}
	return out
}

// The answers of an inspection to «Осмотр машины» v3 of the seed — recordInspection of the reference (api.js:69–71): «5
// фото», the odometer, the fuel (¾ — the option «¾»), every item of the checklist, «Есть дефекты?» and the text and
// the criticality of the first defect; without a defect the questions shown by «Есть дефекты? = да» stay empty.
func TestInspectionAnswersV3(t *testing.T) {
	t.Parallel()
	v3 := demoVersions()[2].def
	blocked := inspected{kind: inspDeparture, odometer: "84530", fuel: "three_quarters", photos: 5, checks: departureChecks(),
		defects: []inspDefect{{zone: "Шины", description: "Порез боковины", blocking: true}, {zone: "Кузов", description: "Царапина"}}}
	assert.Equal(t, []got{
		{"q-photos", vText, "5 фото"}, {"q-odo", vDecimal, "84530"}, {"q-fuel", vChoices, []string{"o3"}},
		{"q-checks", vChoices, []string{"o1", "o2", "o3"}}, {"q-defect", vBoolean, true},
		{"q-defect-text", vText, "Шины: Порез боковины"}, {"q-critical", vBoolean, true},
	}, flatten(inspectionAnswers(v3, blocked)), "a departure with a blocking defect")

	clean := inspected{kind: inspReturn, odometer: "84612", fuel: "full", photos: 5, checks: departureChecks()}
	assert.Equal(t, []got{
		{"q-photos", vText, "5 фото"}, {"q-odo", vDecimal, "84612"}, {"q-fuel", vChoices, []string{"o4"}},
		{"q-checks", vChoices, []string{"o1", "o2", "o3"}}, {"q-defect", vBoolean, false},
	}, flatten(inspectionAnswers(v3, clean)), "a return without defects")

	minor := inspected{kind: inspDeparture, odometer: "84530", fuel: "half", photos: 5, checks: departureChecks("pass", "fail"),
		defects: []inspDefect{{zone: "Фары", description: "Тусклый ближний свет"}}}
	assert.Equal(t, []got{
		{"q-photos", vText, "5 фото"}, {"q-odo", vDecimal, "84530"}, {"q-fuel", vChoices, []string{"o2"}},
		{"q-checks", vChoices, []string{"o1", "o3"}}, {"q-defect", vBoolean, true},
		{"q-defect-text", vText, "Фары: Тусклый ближний свет"}, {"q-critical", vBoolean, false},
	}, flatten(inspectionAnswers(v3, minor)), "a failed item takes its option off «Чек-лист: кузов, шины, документы»")
}

// v1 of the seed asks the fuel as a text («Уровень топлива» q-fuel-t) and has no checklist and no defects.
func TestInspectionAnswersV1(t *testing.T) {
	t.Parallel()
	in := inspected{kind: inspDeparture, odometer: "84530", fuel: "half", photos: 5, checks: departureChecks(),
		defects: []inspDefect{{zone: "Шины", description: "Порез", blocking: true}}}
	assert.Equal(t, []got{{"q-photos", vText, "5 фото"}, {"q-odo", vDecimal, "84530"}, {"q-fuel-t", vText, "½"}},
		flatten(inspectionAnswers(demoVersions()[0].def, in)))
}

// A form built from the definition of the checklist (FormDefinition of W2.45: the items — single choices pass / fail /
// not_applicable by their keys) gets the result of every item; a question the inspection knows nothing of stays empty.
func TestInspectionAnswersOfChecklist(t *testing.T) {
	t.Parallel()
	results := demoOptions("Исправно", "Неисправно", "Не применимо")
	item := func(key, label string) question {
		q := demoQuestion(key, label, fapi.FormQuestionTypeChoice, true, "p1", results)
		opts := *q.Options
		for i, k := range []string{"pass", "fail", "not_applicable"} {
			opts[i].Key = k
		}
		return q
	}
	d := def{Pages: demoPages("Осмотр перед выездом"), Fields: []question{
		item("body", "Кузов и стёкла осмотрены"), item("tires", "Шины и световые приборы исправны"),
		item("docs", "Документы и комплект на месте"), demoQuestion("q-note", "Примечание", fapi.FormQuestionTypeText, false, "p1"),
	}}
	in := inspected{kind: inspDeparture, checks: departureChecks("pass", "fail", "not_applicable")}
	assert.Equal(t, []got{
		{"body", vChoices, []string{"pass"}}, {"tires", vChoices, []string{"fail"}}, {"docs", vChoices, []string{"not_applicable"}},
	}, flatten(inspectionAnswers(d, in)))
}

// Q-59 «как в прототипе» (api.js:67): one response for the departure of a trip (rev1 — a departure again after
// «Подтвердить неисправность» writes no second one), rev1 for the first return, rev2 for every return after the rework.
func TestInspectionKey(t *testing.T) {
	t.Parallel()
	trip := uuid.MustParse("6f1c9a52-0d4e-4a7b-9c3e-2b8d7f6a5e41")
	for _, c := range []struct {
		kind    string
		attempt int
		want    string
	}{
		{inspDeparture, 1, trip.String() + ":dep:rev1"},
		{inspDeparture, 2, trip.String() + ":dep:rev1"},
		{inspReturn, 1, trip.String() + ":ret:rev1"},
		{inspReturn, 2, trip.String() + ":ret:rev2"},
		{inspReturn, 3, trip.String() + ":ret:rev2"},
	} {
		assert.Equal(t, c.want, inspectionKey(trip, c.kind, c.attempt), "%s attempt %d", c.kind, c.attempt)
	}
}

// The object of the response and the title of its task (api.js:73, :76): «Рейс Р-208 · выезд», «Проверить осмотр Р-208
// (выезд)»; the return — «сдача».
func TestInspectionLabels(t *testing.T) {
	t.Parallel()
	assert.Equal(t, "Рейс Р-208 · выезд", inspectionLabel("Р-208", inspDeparture))
	assert.Equal(t, "Рейс Р-208 · сдача", inspectionLabel("Р-208", inspReturn))
	assert.Equal(t, "Проверить осмотр Р-208 (выезд)", inspectionTitle("Проверить осмотр", "Р-208", inspDeparture))
	assert.Equal(t, "Проверить осмотр Р-208 (сдача)", inspectionTitle("Проверить осмотр ", "Р-208", inspReturn))
}
