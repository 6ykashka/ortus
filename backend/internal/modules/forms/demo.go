package forms

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
)

// Exec runs one statement in the transaction of the seed (database/sql).
type Exec func(ctx context.Context, sql string, args ...any) error

// The seed of the forms 14.10 (domain W4.20, mock-data.js:231–275) as MSW seedForms writes it: «Альта» — «Осмотр
// машины» v1–v3 with its rules au-1 (задача) and au-2 (строка таблицы «Осмотры» на kb-5) and the draft «Ежедневный
// отчёт прораба»; the accepted responses R-0988 (v2) and R-1012 (v3) with their lines of the journal. The definitions
// are those of toDefV2 (a section is a page, the options of a label «…: a, b, c»), the answers — of answerOf, the
// instants — of instant() of MSW (Moscow, 2026). Other tenants have no forms.

// tenantAlta is the tenant of the forms of the seed.
const tenantAlta = "t-alta"

// demoAt is the moment of the seed of a draft (SEED_DRAFT_AT of MSW).
var demoAt = time.Date(2026, 9, 30, 7, 30, 0, 0, time.UTC)

// mskSeed is the zone of the dates of the seed (instant of MSW: UTC+3).
var mskSeed = time.FixedZone("MSK", 3*60*60)

// seedInstant is instant(s) of MSW for «ДД.ММ.ГГГГ» or «ДД.ММ ЧЧ:ММ» (2026).
func seedInstant(day, month, hour, minute int) time.Time {
	return time.Date(2026, time.Month(month), day, hour, minute, 0, 0, mskSeed).UTC()
}

// demoVersion is a version of «Осмотр машины».
type demoVersion struct {
	number int
	at     time.Time
	def    def
}

// demoQuestion is a question of the seed by its section.
func demoQuestion(key, label string, typ fapi.FormQuestionType, required bool, page string, mod ...func(*question)) question {
	q := question{Key: key, PageId: page, Type: typ, Label: label, Required: required}
	for _, m := range mod {
		m(&q)
	}
	if optionType(typ) && q.Options == nil {
		q.Options = &[]fapi.FormOption{}
	}
	return q
}

func demoOptions(labels ...string) func(*question) {
	return func(q *question) {
		os := make([]fapi.FormOption, 0, len(labels))
		for i, l := range labels {
			os = append(os, fapi.FormOption{Key: fmt.Sprintf("o%d", i+1), Label: l})
		}
		q.Options = &os
	}
}

// demoDefect is the condition «Есть дефекты? = да» of the questions of a defect.
func demoDefect(q *question) {
	q.ShowIf = &fapi.FormShowIf{Mode: fapi.FormShowIfModeAll, Conditions: []fapi.FormShowIfCondition{
		{FieldKey: "q-defect", Operator: fapi.FormShowIfConditionOperatorEquals, Value: "true"}}}
}

func demoPages(titles ...string) []fapi.FormPageDefinition {
	out := make([]fapi.FormPageDefinition, 0, len(titles))
	for i, t := range titles {
		out = append(out, fapi.FormPageDefinition{Id: fmt.Sprintf("p%d", i+1), Title: t})
	}
	return out
}

// demoVersions are the versions of «Осмотр машины»: v1 02.09, v2 10.09, v3 24.09 (Дарья Зимина).
func demoVersions() []demoVersion {
	checks := demoOptions("кузов", "шины", "документы")
	return []demoVersion{
		{1, seedInstant(2, 9, 0, 0), def{Pages: demoPages("Фото", "Показания"), Fields: []question{
			demoQuestion("q-photos", "Фото: спереди, сзади, слева, справа", fapi.FormQuestionTypePhoto, true, "p1"),
			demoQuestion("q-odo", "Пробег", fapi.FormQuestionTypeNumber, true, "p2"),
			demoQuestion("q-fuel-t", "Уровень топлива", fapi.FormQuestionTypeText, false, "p2"),
		}}},
		{2, seedInstant(10, 9, 0, 0), def{Pages: demoPages("Фото", "Показания", "Проверка"), Fields: []question{
			demoQuestion("q-photos", "Фото: спереди, сзади, слева, справа, одометр", fapi.FormQuestionTypePhoto, true, "p1"),
			demoQuestion("q-odo", "Пробег по одометру, км", fapi.FormQuestionTypeNumber, true, "p2"),
			demoQuestion("q-fuel-t", "Уровень топлива", fapi.FormQuestionTypeText, false, "p2"),
			demoQuestion("q-checks", "Чек-лист: кузов, шины, документы", fapi.FormQuestionTypeMulti, true, "p3", checks),
		}}},
		{3, seedInstant(24, 9, 0, 0), def{Pages: demoPages("Фото", "Показания", "Проверка", "Дефекты"), Fields: []question{
			demoQuestion("q-photos", "Фото: спереди, сзади, слева, справа, одометр", fapi.FormQuestionTypePhoto, true, "p1"),
			demoQuestion("q-odo", "Пробег по одометру, км", fapi.FormQuestionTypeNumber, true, "p2"),
			demoQuestion("q-fuel", "Уровень топлива", fapi.FormQuestionTypeChoice, true, "p2", demoOptions("¼", "½", "¾", "Полный")),
			demoQuestion("q-checks", "Чек-лист: кузов, шины, документы", fapi.FormQuestionTypeMulti, true, "p3", checks),
			demoQuestion("q-defect", "Есть дефекты?", fapi.FormQuestionTypeBool, true, "p4"),
			demoQuestion("q-defect-text", "Описание дефекта", fapi.FormQuestionTypeText, true, "p4", demoDefect),
			demoQuestion("q-critical", "Дефект критический", fapi.FormQuestionTypeBool, false, "p4", demoDefect),
		}}},
	}
}

// demoForeman is the draft «Ежедневный отчёт прораба» (no version).
func demoForeman() def {
	return def{Pages: demoPages("Работы", "Фото"), Fields: []question{
		demoQuestion("q-volume", "Выполненный объём, м²", fapi.FormQuestionTypeNumber, true, "p1"),
		demoQuestion("q-crew", "Явка бригады", fapi.FormQuestionTypeMulti, true, "p1"),
		demoQuestion("q-photo", "Фотоотчёт", fapi.FormQuestionTypePhoto, true, "p2"),
	}}
}

// demoResponse is a response of the seed: its number, version, object (a trip of the seed), author (a member proto),
// answers, moment and the moment of its line «в БЗ».
type demoResponse struct {
	number, version int
	trip            string
	subject, author string
	answers         []entry
	at, actionAt    time.Time
}

func demoValue(typ string, v any) value {
	raw, err := json.Marshal(v)
	if err != nil {
		panic("forms: a value of the seed: " + err.Error())
	}
	return value{Type: typ, Value: raw}
}

func demoEntry(key, typ string, v any) entry { return entry{FieldKey: key, Value: demoValue(typ, v)} }

// demoResponses are R-0988 (v2, Кирилл Громов, Рейс Р-171) and R-1012 (v3, Илья Васильев, Рейс Р-196). Their objects
// are past trips of the prototype (mock-data.js:275) with the ids of PD-30 of their numbers, as subjectOf of the MSW
// adapter builds them; the trips of the seed of the stand (cmd/seed fleet_trips.go) are only Р-208 and Р-211, so
// fleet.trips has no row for them (W4.21 return 4, Q-W4.21-17): the label kept with the response (Q-W4.00-forms-23) is
// shown as in the prototype, and, as MSW sees them, a member with forms.responses.read somewhere reads them with
// fleet.trips.read anywhere (req.sees, Objects.Missing).
func demoResponses() []demoResponse {
	all := []string{"o1", "o2", "o3"}
	return []demoResponse{
		{988, 2, "Р-171", "Рейс Р-171", "m-gromov", []entry{
			demoEntry("q-photos", vText, "5 фото"), demoEntry("q-odo", vDecimal, "83902"),
			demoEntry("q-fuel-t", vText, "почти полный"), demoEntry("q-checks", vChoices, all),
		}, seedInstant(18, 9, 8, 41), seedInstant(24, 9, 18, 20)},
		{1012, 3, "Р-196", "Рейс Р-196", "m-vasiliev", []entry{
			demoEntry("q-photos", vText, "5 фото"), demoEntry("q-odo", vDecimal, "84210"),
			demoEntry("q-fuel", vChoices, []string{"o3"}), demoEntry("q-checks", vChoices, all),
			demoEntry("q-defect", vBoolean, false),
		}, seedInstant(27, 9, 9, 5), seedInstant(27, 9, 9, 12)},
	}
}

// demoKB is the action au-2: a row of «Осмотры» on «Журнал осмотров машин» for every accepted response.
func demoKB(id func(string) uuid.UUID) *fapi.FormRuleKbInput {
	cols := []struct{ col, name, src string }{
		{"c-at", "Дата", "$at"}, {"c-obj", "Рейс", "$object"}, {"c-who", "Водитель", "$author"}, {"c-odo", "Пробег, км", "q-odo"},
		{"c-fuel", "Топливо", "q-fuel"}, {"c-def", "Дефекты", "q-defect"}, {"c-resp", "Ответ", "$id"},
	}
	fields := make([]fapi.FormRuleKbField, 0, len(cols))
	for _, c := range cols {
		fields = append(fields, fapi.FormRuleKbField{ColumnId: new(id(c.col)), Name: c.name, Source: c.src})
	}
	return &fapi.FormRuleKbInput{NodeId: id("kb-5"), Mode: fapi.FormRuleKbInputModeTable, TableId: new(id("kt-insp")),
		Position: fapi.FormRuleKbInputPositionTop, Fields: fields, ShowLink: false, AllEmployeesConfirmed: true}
}

// demoKBText is the line of the journal of au-2.
const demoKBText = "Строка в таблице «Осмотры» · страница «Журнал осмотров машин»"

// WriteDemo writes the forms of the seed of tenant (none but «Альта») through ex with the ids of PD-30 (id of a
// proto); the rows already there are kept (a second run changes nothing), the counter of the numbers of the responses
// follows the seed (the next response is R-1013).
func WriteDemo(ctx context.Context, ex Exec, tenant string, id func(string) uuid.UUID) error {
	if tenant != tenantAlta {
		return nil
	}
	w := demoWriter{ex: ex, id: id}
	steps := []func(context.Context) error{w.inspection, w.foreman, w.rules, w.responses}
	for _, step := range steps {
		if err := step(ctx); err != nil {
			return err
		}
	}
	return w.exec(ctx, "response numbers", `select setval('forms.response_number_seq',
		greatest((select max(number) from forms.responses), 1))`)
}

// demoWriter writes the rows of the seed.
type demoWriter struct {
	ex Exec
	id func(string) uuid.UUID
}

func (w demoWriter) exec(ctx context.Context, what, sql string, args ...any) error {
	if err := w.ex(ctx, sql, args...); err != nil {
		return fmt.Errorf("forms: seed %s: %w", what, err)
	}
	return nil
}

func jsonText(v any) (string, error) {
	b, err := json.Marshal(v)
	return string(b), err
}

// form writes a form of the seed (default settings, the whole organization) with its draft.
func (w demoWriter) form(ctx context.Context, proto, name, module, status string, current *int, created, updated time.Time, draft def, savedAt *time.Time) error {
	extra, err := jsonText(defaultSettings().extra)
	if err != nil {
		return err
	}
	s := defaultSettings()
	if err := w.exec(ctx, "form", `insert into forms.forms (id, name, module_key, owner_id, status, current_version, access,
		one_per_member, retain_days, settings, revision, created_at, updated_at)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, 1, $11, $12) on conflict do nothing`,
		w.id(proto), name, module, w.id("m-owner"), status, current, s.access, s.onePerMember, s.retainDays, extra, created, updated); err != nil {
		return err
	}
	d, err := jsonText(draft)
	if err != nil {
		return err
	}
	var by any
	if savedAt != nil {
		by = w.id("m-owner")
	}
	return w.exec(ctx, "draft", `insert into forms.drafts (form_id, definition, base_version, has_changes, revision, saved_at, saved_by)
		values ($1, $2::jsonb, $3, false, 1, $4, $5) on conflict do nothing`, w.id(proto), d, current, savedAt, by)
}

// inspection writes «Осмотр машины» v1–v3 (acting v3, the draft is v3).
func (w demoWriter) inspection(ctx context.Context) error {
	vs := demoVersions()
	last := vs[len(vs)-1]
	if err := w.form(ctx, "fm-insp", "Осмотр машины", moduleFleet, statusPublished, new(last.number), vs[0].at, last.at, last.def, nil); err != nil {
		return err
	}
	for _, v := range vs {
		d, err := jsonText(v.def)
		if err != nil {
			return err
		}
		if err := w.exec(ctx, "version", `insert into forms.versions (id, form_id, number, definition, question_count, published_at,
			published_by) values ($1, $2, $3, $4::jsonb, $5, $6, $7) on conflict do nothing`, w.id(fmt.Sprintf("fm-insp:v%d", v.number)),
			w.id("fm-insp"), v.number, d, questionCount(v.def), v.at, w.id("m-owner")); err != nil {
			return err
		}
	}
	return nil
}

// foreman writes the draft «Ежедневный отчёт прораба».
func (w demoWriter) foreman(ctx context.Context) error {
	return w.form(ctx, "fm-foreman", "Ежедневный отчёт прораба", moduleRepairs, statusDraft, nil, demoAt, demoAt, demoForeman(), new(demoAt))
}

// rules writes au-1 «Ответ принят → задача менеджеру «Проверить осмотр»» (LOG, Марина Котова) and au-2 «в БЗ».
func (w demoWriter) rules(ctx context.Context) error {
	at := demoVersions()[0].at
	for _, r := range []struct {
		proto, kind string
		config      ruleConfig
	}{
		{"au-1", kindTask, ruleConfig{Task: &fapi.FormRuleTask{ProjectId: w.id("fleet"), Title: "Проверить осмотр",
			AssigneeMemberId: w.id("m-kotova")}}},
		{"au-2", kindKB, ruleConfig{KB: demoKB(w.id)}},
	} {
		cfg, err := jsonText(r.config)
		if err != nil {
			return err
		}
		if err := w.exec(ctx, "rule", `insert into forms.rules (id, form_id, kind, enabled, version, trigger, config, author_id, revision,
			created_at, updated_at) values ($1, $2, $3, true, 1, $4, $5::jsonb, $6, 1, $7, $7) on conflict do nothing`,
			w.id(r.proto), w.id("fm-insp"), r.kind, triggerAccepted, cfg, w.id("m-owner"), at); err != nil {
			return err
		}
	}
	return nil
}

// responses writes R-0988 and R-1012 with their lines «в БЗ» of au-2.
func (w demoWriter) responses(ctx context.Context) error {
	for _, r := range demoResponses() {
		answers, err := jsonText(r.answers)
		if err != nil {
			return err
		}
		proto := numberOf(r.number)
		if err := w.exec(ctx, "response", `insert into forms.responses (id, form_id, number, version_number, channel, author_id,
			subject_module, subject_type, subject_id, subject_label, answers, review_status, revision, submitted_at)
			values ($1, $2, $3, $4, 'inspection', $5, 'fleet', 'trip', $6, $7, $8::jsonb, 'accepted', 1, $9) on conflict do nothing`,
			w.id(proto), w.id("fm-insp"), r.number, r.version, w.id(r.author), w.id(r.trip), r.subject, answers, r.at); err != nil {
			return err
		}
		if err := w.exec(ctx, "journal", `insert into forms.response_actions (response_id, rule_id, rule_version, kind, ok, at, text,
			kb_node_id) values ($1, $2, 1, 'kb', true, $3, $4, $5) on conflict do nothing`,
			w.id(proto), w.id("au-2"), r.actionAt, demoKBText, w.id("kb-5")); err != nil {
			return err
		}
	}
	return nil
}
