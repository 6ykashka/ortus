package forms

import (
	"strconv"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
)

// Templates of the code catalogue (Q-W4.00-forms-14): FORM_TEMPLATES of the domain W4.20 (models.js 14.10:80–107) in
// the form of FormDefinition v2 — the draft toDefV2 of MSW makes of templateDef: pages p1…, options o1… with scores,
// conditions by keys («Нет» of a choice is its option key, «да» of «Да / нет» is true). The parity with the domain —
// the example listFormTemplates/ok (TestTemplatesParity).

// tplField is a question of a template.
type tplField = question

// template is a template: its category, name, icon, the module it needs ("" — none), the change of the settings
// FORM_SETTINGS and its pages.
type template struct {
	id, cat, name, icon, module string
	tune                        func(*settings)
	pages                       []tplPage
}

type tplPage struct {
	title  string
	fields []tplField
}

// Builders of the questions of the templates.
func tq(key string, typ fapi.FormQuestionType, label string, required bool, extra ...func(*question)) tplField {
	x := question{Key: key, Type: typ, Label: label, Required: required}
	for _, e := range extra {
		e(&x)
	}
	return x
}

func withOptions(labels ...string) func(*question) {
	return func(x *question) {
		os := make([]fapi.FormOption, 0, len(labels))
		for i, l := range labels {
			os = append(os, fapi.FormOption{Key: optionKey(i), Label: l})
		}
		x.Options = &os
	}
}

func withScored(labels []string, scores []int) func(*question) {
	return func(x *question) {
		os := make([]fapi.FormOption, 0, len(labels))
		for i, l := range labels {
			os = append(os, fapi.FormOption{Key: optionKey(i), Label: l, Score: new(scores[i])})
		}
		x.Options = &os
	}
}

func optionKey(i int) string { return "o" + strconv.Itoa(i+1) }

func when(mode fapi.FormShowIfMode, conds ...[2]string) func(*question) {
	return func(x *question) {
		s := &fapi.FormShowIf{Mode: mode}
		for _, c := range conds {
			s.Conditions = append(s.Conditions, fapi.FormShowIfCondition{FieldKey: c[0],
				Operator: fapi.FormShowIfConditionOperatorEquals, Value: c[1]})
		}
		x.ShowIf = s
	}
}

func iff(key, value string) func(*question) {
	return when(fapi.FormShowIfModeAll, [2]string{key, value})
}

func files(accept fapi.FormQuestionAccept, maxFiles int) func(*question) {
	return func(x *question) {
		x.Accept, x.MaxFiles, x.MaxFileMb = new(accept), new(maxFiles), new(20)
	}
}

func scale(lo fapi.FormQuestionScaleMin, hi int, left, right string) func(*question) {
	return func(x *question) {
		x.ScaleMin, x.ScaleMax, x.ScaleLeftLabel, x.ScaleRightLabel = new(lo), new(hi), new(left), new(right)
	}
}

const (
	tBool     = fapi.FormQuestionTypeBool
	tChoice   = fapi.FormQuestionTypeChoice
	tDate     = fapi.FormQuestionTypeDate
	tEmail    = fapi.FormQuestionTypeEmail
	tInn      = fapi.FormQuestionTypeInn
	tInt      = fapi.FormQuestionTypeInt
	tLongtext = fapi.FormQuestionTypeLongtext
	tMulti    = fapi.FormQuestionTypeMulti
	tNumber   = fapi.FormQuestionTypeNumber
	tPerson   = fapi.FormQuestionTypePerson
	tPhone    = fapi.FormQuestionTypePhone
	tPhoto    = fapi.FormQuestionTypePhoto
	tRating   = fapi.FormQuestionTypeRating
	tRef      = fapi.FormQuestionTypeRef
	tScale    = fapi.FormQuestionTypeScale
	tText     = fapi.FormQuestionTypeText
	yes       = "true" // «да» of a question «Да / нет»
	labelName = "Имя и фамилия"
	labelTel  = "Телефон"
	labelAsk  = "Вопросы и пожелания"
	labelMark = "Оценка"
	scaleNo   = "Совсем нет"
	scaleYes  = "Полностью"
)

// Categories of the templates («Основные», «Опросы и оценка», «Сотрудники», «Отраслевые»).
const (
	catBasic    = "basic"
	catSurvey   = "survey"
	catPeople   = "people"
	catIndustry = "industry"
)

// Modules of the templates (ModuleKey of the contract: logistics → fleet, repair → repairs).
const (
	moduleFleet   = "fleet"
	moduleRepairs = "repairs"
	moduleSpa     = "spa"
)

var catalogue = []template{
	{id: "blank", cat: catBasic, name: "Пустая форма", icon: "note_add",
		pages: []tplPage{{textFirstPage, []tplField{tq("q-1", tText, "Вопрос 1", false)}}}},
	{id: "tpl-profile", cat: catBasic, name: "Анкета", icon: "badge", pages: []tplPage{{"Контакты", []tplField{
		tq("q-name", tText, labelName, true), tq("q-phone", tPhone, labelTel, true), tq("q-email", tEmail, "Почта", false),
		tq("q-company", tText, "Компания", false), tq("q-inn", tInn, "ИНН компании", false),
		tq("q-contact", tChoice, "Как удобнее связаться", false, withOptions("Звонок", "Мессенджер", "Почта")),
	}}}},
	{id: "tpl-feedback", cat: catBasic, name: "Форма обратной связи", icon: "forum",
		tune: func(s *settings) { s.access = accessPublic }, pages: []tplPage{{"Отзыв", []tplField{
			tq("q-rate", tRating, "Оцените работу", true),
			tq("q-recommend", tChoice, "Порекомендуете нас знакомым?", true, withOptions("Да", "Нет", "Не знаю")),
			tq("q-better", tLongtext, "Что нам улучшить?", true, iff("q-recommend", "o2")),
			tq("q-comment", tLongtext, "Комментарий", false), tq("q-phone", tPhone, "Телефон, если нужен ответ", false),
		}}}},
	{id: "tpl-request", cat: catBasic, name: "Заявка на услугу или работу", icon: "assignment_add", pages: []tplPage{
		{"Что нужно", []tplField{
			tq("q-what", tLongtext, "Что нужно сделать", true), tq("q-where", tText, "Адрес или объект", true),
			tq("q-date", tDate, "Удобная дата", true), tq("q-photo", tPhoto, "Фото, если есть", false, files(fapi.FormQuestionAcceptPhoto, 5)),
		}},
		{"Контакты", []tplField{
			tq("q-name", tText, "Как к вам обращаться", true), tq("q-phone", tPhone, labelTel, true), tq("q-urgent", tBool, "Срочно?", false),
			tq("q-why", tText, "Почему срочно", false, iff("q-urgent", yes)),
		}},
	}},
	{id: "tpl-event", cat: catBasic, name: "Регистрация на обучение", icon: "event_available", pages: []tplPage{
		{"Участник", []tplField{tq("q-name", tText, labelName, true), tq("q-email", tEmail, "Почта", true), tq("q-phone", tPhone, labelTel, false)}},
		{"Участие", []tplField{
			tq("q-format", tChoice, "Формат", true, withOptions("Очно", "Онлайн")),
			tq("q-car", tBool, "Нужен пропуск на машину?", false, iff("q-format", "o1")),
			tq("q-plate", tText, "Номер машины", true, iff("q-car", yes)), tq("q-ask", tLongtext, "Вопросы к организаторам", false),
		}},
	}},
	{id: "tpl-csat", cat: catSurvey, name: "CSAT · удовлетворённость", icon: "sentiment_satisfied", pages: []tplPage{{labelMark, []tplField{
		tq("q-csat", tRating, "Насколько вы довольны результатом?", true), tq("q-why", tLongtext, "Что повлияло на оценку?", false),
	}}}},
	{id: "tpl-nps", cat: catSurvey, name: "NPS · готовность рекомендовать", icon: "recommend", pages: []tplPage{{labelMark, []tplField{
		tq("q-nps", tScale, "Насколько вероятно, что вы порекомендуете нас знакомым?", true, scale(0, 10, "Точно нет", "Точно да")),
		tq("q-why", tLongtext, "Почему такая оценка?", false),
	}}}},
	{id: "tpl-ces", cat: catSurvey, name: "CES · лёгкость обращения", icon: "speed", pages: []tplPage{{labelMark, []tplField{
		tq("q-ces", tScale, "Насколько легко было решить ваш вопрос?", true, scale(1, 7, "Очень сложно", "Очень легко")),
		tq("q-hard", tLongtext, "Что было сложнее всего?", false),
	}}}},
	{id: "tpl-support", cat: catSurvey, name: "Оценка поддержки", icon: "support_agent", pages: []tplPage{{"Обращение", []tplField{
		tq("q-solved", tChoice, "Ваш вопрос решён?", true, withOptions("Да", "Частично", "Нет")),
		tq("q-speed", tRating, "Скорость ответа", true), tq("q-polite", tRating, "Вежливость", true),
		tq("q-left", tLongtext, "Что осталось нерешённым", true, when(fapi.FormShowIfModeAny, [2]string{"q-solved", "o2"}, [2]string{"q-solved", "o3"})),
	}}}},
	{id: "tpl-pulse", cat: catPeople, name: "Пульс команды", icon: "monitor_heart", pages: []tplPage{
		{"Работа", []tplField{
			tq("q-goals", tScale, "Я понимаю приоритеты на эту неделю", true, scale(1, 5, scaleNo, scaleYes)),
			tq("q-tools", tScale, "Мне хватает инструментов и материалов", true, scale(1, 5, scaleNo, scaleYes)),
		}},
		{"Команда", []tplField{
			tq("q-help", tScale, "Коллеги помогают, когда нужно", true, scale(1, 5, scaleNo, scaleYes)),
			tq("q-idea", tLongtext, "Что улучшить в работе команды", false),
		}},
	}},
	{id: "tpl-onboard", cat: catPeople, name: "Онбординг сотрудника", icon: "person_add", pages: []tplPage{
		{"Документы", []tplField{
			tq("q-docs", tMulti, "Какие документы сданы", true, withOptions("Паспорт", "СНИЛС", "ИНН", "Трудовая книжка")),
			tq("q-scan", tPhoto, "Скан или фото документов", false, files(fapi.FormQuestionAcceptDocs, 6)),
		}},
		{"Доступы", []tplField{
			tq("q-access", tMulti, "Что уже работает", false, withOptions("Вход в Ортус", "Рабочая почта", "Пропуск")),
			tq("q-mentor", tPerson, "Наставник", true),
		}},
		{"Инструктаж", []tplField{
			tq("q-brief", tBool, "Инструктаж по технике безопасности пройден", true),
			tq("q-brief-date", tDate, "Дата инструктажа", true, iff("q-brief", yes)), tq("q-ask", tLongtext, labelAsk, false),
		}},
	}},
	{id: "tpl-quiz", cat: "quiz", name: "Тест знаний с баллами", icon: "quiz",
		tune: func(s *settings) { s.extra.Scoring, s.extra.PassScore, s.extra.ShowScore = true, new(4), true }, pages: []tplPage{
			{"Осмотр машины", []tplField{
				tq("q-q1", tChoice, "Что делать, если перед рейсом найден дефект?", true, withScored([]string{
					"Выехать и сообщить после рейса", "Отметить дефект в осмотре и сообщить менеджеру", "Ничего, если дефект мелкий"}, []int{0, 1, 0})),
				tq("q-q2", tChoice, "Кто решает, выпускать ли машину с дефектом?", true, withScored([]string{
					"Водитель", "Менеджер логистики", "Механик подрядчика"}, []int{0, 1, 0})),
				tq("q-q3", tMulti, "Что обязательно фотографировать при осмотре?", true, withScored([]string{
					"Четыре стороны машины", "Одометр", "Салон изнутри"}, []int{1, 1, 0})),
			}},
			{"Документы", []tplField{
				tq("q-q4", tChoice, "Как исправить ошибку в уже принятом ответе?", true, withScored([]string{
					"Удалить ответ", "Попросить исправление — появится ревизия"}, []int{0, 1})),
			}},
		}},
	{id: "tpl-insp", cat: catIndustry, name: "Круговой осмотр машины", icon: "local_shipping", module: moduleFleet, pages: []tplPage{
		{"Фото", []tplField{tq("q-photos", tPhoto, "Фото: спереди, сзади, слева, справа, одометр", true, files(fapi.FormQuestionAcceptPhoto, 5))}},
		{"Показания", []tplField{
			tq("q-odo", tInt, "Пробег по одометру, км", true), tq("q-fuel", tChoice, "Уровень топлива", true, withOptions("¼", "½", "¾", "Полный")),
		}},
		{"Проверка", []tplField{
			tq("q-checks", tMulti, "Чек-лист", true, withOptions("Кузов", "Шины", "Свет", "Документы")),
			tq("q-defect", tBool, "Есть дефекты?", true), tq("q-defect-text", tLongtext, "Описание дефекта", true, iff("q-defect", yes)),
			tq("q-defect-photo", tPhoto, "Фото дефекта", true, files(fapi.FormQuestionAcceptPhoto, 3), iff("q-defect", yes)),
		}},
	}},
	{id: "tpl-foreman", cat: catIndustry, name: "Ежедневный отчёт прораба", icon: "construction", module: moduleRepairs, pages: []tplPage{
		{"Работы", []tplField{
			tq("q-object", tRef, "Объект", true, func(x *question) { x.RefKind = new(fapi.FormQuestionRefKindObject) }),
			tq("q-done", tLongtext, "Что сделано за день", true), tq("q-volume", tNumber, "Выполненный объём", true),
			tq("q-crew", tPerson, "Кто был на объекте", true),
		}},
		{"Фото и простой", []tplField{
			tq("q-photo", tPhoto, "Фото до и после", true, files(fapi.FormQuestionAcceptPhoto, 10)),
			tq("q-stop", tBool, "Был простой или замечания?", true),
			tq("q-stop-why", tLongtext, "Причина и что нужно от офиса", true, iff("q-stop", yes)),
		}},
	}},
	{id: "tpl-spa", cat: catIndustry, name: "Анкета клиента перед процедурой", icon: "spa", module: moduleSpa, pages: []tplPage{
		{"Клиент", []tplField{tq("q-name", tText, labelName, true), tq("q-phone", tPhone, labelTel, true)}},
		{"Здоровье", []tplField{
			tq("q-contra", tBool, "Есть противопоказания: давление, беременность, кожные заболевания?", true),
			tq("q-contra-text", tLongtext, "Уточните противопоказания", true, iff("q-contra", yes)),
			tq("q-allergy", tText, "Аллергия на масла или косметику", false),
			tq("q-consent", tBool, "Согласие на обработку персональных данных", true),
		}},
	}},
}

// definition is the draft of a form made from t.
func (t template) definition() def {
	d := def{Pages: []fapi.FormPageDefinition{}, Fields: []question{}}
	for i, p := range t.pages {
		id := "p" + strconv.Itoa(i+1)
		d.Pages = append(d.Pages, fapi.FormPageDefinition{Id: id, Title: p.title})
		for _, x := range p.fields {
			x.PageId = id
			d.Fields = append(d.Fields, x)
		}
	}
	return cloneDef(d)
}

// settings are FORM_SETTINGS with the change of t.
func (t template) settings() settings {
	s := defaultSettings()
	if t.tune != nil {
		t.tune(&s)
	}
	return s
}

// templateByID is the template id.
func templateByID(id string) (template, bool) {
	for _, t := range catalogue {
		if t.id == id {
			return t, true
		}
	}
	return template{}, false
}

// templateName is the name of the template id ("" — none).
func templateName(id string) string {
	t, _ := templateByID(id)
	return t.name
}

// templateList is listFormTemplates: active tells whether a module is active.
func templateList(active func(module string) bool) fapi.FormTemplateList {
	out := fapi.FormTemplateList{Items: []fapi.FormTemplate{}}
	for _, t := range catalogue {
		d := t.definition()
		x := fapi.FormTemplate{Id: t.id, Category: fapi.FormTemplateCategory(t.cat), Name: t.name, Icon: t.icon,
			Available: t.module == "" || active(t.module), PageCount: len(d.Pages), QuestionCount: questionCount(d)}
		if t.module != "" {
			x.ModuleKey = new(t.module)
		}
		out.Items = append(out.Items, x)
	}
	return out
}
