package knowledge

// The knowledge base of the tenants of the stand: the raw seed of 14.10 (extra-data.js:24–54, mock-data.js:54–55)
// after the migration to spaces with a tree (installKnowledge + altaExtras, knowledge.js 14.10:244–315) as the domain
// W4.30 builds it (seed.ts, migrate-v2.ts): «Альта» — five spaces and 35 nodes, the roles of the spaces of Марина
// Котова and Вера Котельникова, five rules and three runs, the table of inspections; «Лотос» — «Салон и SPA» with its
// home page. Differences from the prototype (W4.30): akb-3 is «Редактор» (KB-02), the page «Только владелец» is
// «Только выбранные» (KB-07). Ids are prototype ids; cmd/seed makes them UUIDs of PD-30 (as seedUuid of MSW).

// DemoEntry is an entry of an access list or the audience of an acknowledgement: who is member, group, role, relation
// or all; Ref — the prototype id of the member, group or role; Unit — the unit of a role entry; Obj — the object of
// repairs of a relation.
type DemoEntry struct {
	Who, Ref, Unit, Obj, Can string
}

// DemoVersion is a version of a node: the day «ДД.ММ.ГГГГ» (Moscow), the author (member id) and the text.
type DemoVersion struct {
	At, By, Body string
}

// DemoAck is the acknowledgement of a node: the version, the audience and who confirmed it.
type DemoAck struct {
	V        int
	Audience DemoEntry
	Done     []string
}

// DemoNode is a node of the tree.
type DemoNode struct {
	ID, Space, Parent string
	Pos               int
	Kind, Title       string
	Status            string // "" — active
	Mode              string // "" — inherit
	List              []DemoEntry
	Finance           bool
	Owner             string // "" — m-owner
	ReviewBy          string // «ДД.ММ.ГГГГ»
	Steps             []string
	Outcomes          [][2]string // text, tone
	FileBytes         int64
	FilePages         int
	Link              *[3]string // label, module key, icon
	Obj               string     // the object of repairs of a section
	Versions          []DemoVersion
	Ack               *DemoAck
}

// DemoSpace is a space: Unit — the prototype id of its unit ("" — the whole organization).
type DemoSpace struct {
	ID, Name, Icon, Color, Unit, Access string
}

// DemoAssignment is a role of a space (scope space) of a member.
type DemoAssignment struct {
	ID, Member, Role, Space string
}

// DemoRule is a rule of automation.
type DemoRule struct {
	ID, Space, Kind, Name, Trigger string
	On                             bool
}

// DemoRun is a line of the journal: At — «ДД.ММ ЧЧ:ММ» of 2026 (Moscow).
type DemoRun struct {
	ID, Space, Rule, At, Res, Text string
}

// DemoRow is a row of a table: At — «ДД.ММ ЧЧ:ММ» of 2026 (Moscow); the form, its response and version.
type DemoRow struct {
	ID, At, Form, Resp string
	FormVersion        int
	Cells              map[string]string // column id → value
}

// DemoTable is a table of a page with its columns (id, name, type) and rows, newest first.
type DemoTable struct {
	ID, Node, Title string
	Columns         [][3]string
	Rows            []DemoRow
}

// DemoRole is a role of a space the seed creates: the prototype id, the template of the catalog, its name and actions.
type DemoRole struct {
	ID, Template, Name string
	Actions            []string
}

// Demo is the knowledge base of a tenant.
type Demo struct {
	Spaces      []DemoSpace
	Nodes       []DemoNode
	Assignments []DemoAssignment
	Rules       []DemoRule
	Runs        []DemoRun
	Tables      []DemoTable
}

// DemoRoles returns the roles of a space with the actions of their templates (KB-02: three roles).
func DemoRoles() []DemoRole {
	ids := map[string]string{templateLead: "r-kb-lead", templateEditor: "r-kb-editor", templateReader: "r-kb-reader"}
	out := make([]DemoRole, 0, len(spaceTemplates))
	for _, t := range spaceTemplates {
		d := spaceRoleDefs[t]
		out = append(out, DemoRole{ID: ids[t], Template: t, Name: d.name, Actions: append([]string(nil), d.actions...)})
	}
	return out
}

// Prototype ids the demo refers to.
const (
	demoOwner    = "m-owner"
	demoKotova   = "m-kotova"
	demoEditors  = "r-kb-editor"
	demoDriver   = "r-driver"
	demoSever    = "f-msk-sever"
	demoZimina   = "Дарья Зимина"
	migrationDay = "20.09.2026" // the day of the nodes the migration adds
	spLog        = "sp-log"
	spSpa        = "sp-spa"
	spRep        = "sp-rep"
	spGen        = "sp-gen"
	obj42        = "obj-42"
	colText      = "text" // the type of a column of a table
)

// DemoOf returns the knowledge base of the prototype tenant (t-alta, t-lotos); another tenant has none.
func DemoOf(tenant string) (Demo, bool) {
	switch tenant {
	case "t-alta":
		return altaDemo(), true
	case "t-lotos":
		return lotosDemo(), true
	}
	return Demo{}, false
}

func editors() DemoEntry { return DemoEntry{Who: whoRole, Ref: demoEditors, Can: canEdit} }

// page is a node of the migration (kbNode of the domain): version 1 of 20.09.2026 by the owner with body.
func page(id, sp, parent string, pos int, kind, title, body string) DemoNode {
	return DemoNode{ID: id, Space: sp, Parent: parent, Pos: pos, Kind: kind, Title: title,
		Versions: []DemoVersion{{At: migrationDay, By: demoOwner, Body: body}}}
}

func lotosDemo() Demo {
	tech := altaRaw()[3] // «Технологические карты процедур» of «Салон и SPA»
	tech.Pos = 1
	return Demo{
		Spaces: []DemoSpace{{ID: spSpa, Name: "Салон и SPA", Icon: "spa", Color: "#6B4A7A", Access: levelOpen}},
		Nodes: []DemoNode{
			page("kb-home-sp-spa", spSpa, "", 0, kindPage, homeTitle, "Главная страница пространства «Салон и SPA»."),
			tech,
		},
	}
}

// altaRaw are the five pages of the raw seed (extra-data.js:24–54) as the migration leaves them: kb-1, kb-2, kb-5,
// kb-3, kb-4 at the top level with the positions of their order; kb-4 «Только владелец» → «Только выбранные» (KB-07).
func altaRaw() []DemoNode {
	return []DemoNode{
		{ID: "kb-1", Space: spLog, Pos: 1, Kind: kindPage, Title: "Регламент приёмки смены", Versions: []DemoVersion{
			{At: "05.09.2026", By: demoOwner, Body: "Менеджер проверяет фото до и после, пробег и расходы. Машина возвращается в пул " +
				"только после приёмки."},
			{At: "24.09.2026", By: demoOwner, Body: "Менеджер проверяет фото до и после (5 ракурсов, включая одометр), пробег и " +
				"расходы с чеками. При замечаниях смена возвращается водителю с указанием раздела. Машина возвращается в пул " +
				"только после приёмки."},
		}},
		{ID: "kb-2", Space: spLog, Pos: 2, Kind: kindPage, Title: "Как фотографировать машину при осмотре", Versions: []DemoVersion{
			{At: "10.09.2026", By: demoKotova, Body: "Снимайте при дневном свете с расстояния 3–4 метра. Номер должен читаться на " +
				"фото спереди и сзади. Одометр — крупно, без бликов."},
		}},
		{ID: "kb-5", Space: spLog, Pos: 3, Kind: kindPage, Title: "Журнал осмотров машин", Versions: []DemoVersion{
			{At: "24.09.2026", By: demoOwner, Body: "Сводный журнал осмотров перед выездом и при сдаче машины. Строки добавляет " +
				"форма «Осмотр машины» после принятия ответа; исправления вносятся через ответ формы. Как снимать машину — на " +
				"странице «Как фотографировать машину при осмотре»."},
		}},
		{ID: "kb-3", Space: spSpa, Pos: 4, Kind: kindPage, Title: "Технологические карты процедур", Versions: []DemoVersion{
			{At: "12.09.2026", By: demoOwner, Body: "Классический массаж: масло 30 мл. SPA-ритуал: масло 40 мл, крем 20 г. Массаж " +
				"спины: масло 20 мл. Отклонение от нормы фиксируется при завершении процедуры."},
		}},
		{ID: "kb-4", Space: "sp-own", Pos: 5, Kind: kindPage, Title: "Политика начислений водителям", Mode: modeListed,
			Versions: []DemoVersion{{At: "01.09.2026", By: demoOwner, Body: "Начисление создаётся после приёмки смены. Ставка " +
				"зависит от маршрута. Водитель не видит начисления в приложении."}}},
	}
}

func altaDemo() Demo {
	nodes := altaRaw()
	// Patches of altaExtras (knowledge.js:254–262).
	nodes[0].Parent, nodes[0].Pos, nodes[0].ReviewBy = "kb-f-reg", 1, "24.03.2027"
	nodes[0].Ack = &DemoAck{V: 2, Audience: DemoEntry{Who: whoRole, Ref: demoDriver, Unit: demoSever}}
	nodes[1].Parent, nodes[1].Pos, nodes[1].ReviewBy, nodes[1].Owner = "kb-f-reg", 2, "30.09.2026", demoKotova
	nodes[2].Pos, nodes[2].Kind = 2, kindTable
	nodes[3].Pos = 1
	nodes[3].Ack = &DemoAck{V: 1, Audience: DemoEntry{Who: whoRole, Ref: "r-therapist"}, Done: []string{"m-morozova"}}
	nodes[4].Pos, nodes[4].Finance = 1, true
	nodes = append(nodes, altaLogistics()...)
	nodes = append(nodes,
		page("kb-spa-home", spSpa, "", 0, kindPage, homeTitle, "Технологические карты, подготовка кабинета и правила работы салона."),
		page("kb-spa-2", spSpa, "", 2, kindPage, "Подготовка кабинета", "За 15 минут до визита проветрите кабинет, смените бельё, "+
			"включите подогрев стола.\n\nПосле визита — уборка 15 минут и отметка в «Мой день»."),
		page("kb-own-home", "sp-own", "", 0, kindPage, homeTitle, "Документы для владельца: политики начислений, договоры, планы."),
	)
	nodes = append(nodes, altaRepairs()...)
	nodes = append(nodes, altaGeneral()...)
	return Demo{
		Spaces: []DemoSpace{
			{ID: spLog, Name: "Логистика", Icon: "local_shipping", Color: "#1F6B52", Unit: demoSever, Access: levelLimited},
			{ID: spSpa, Name: "Салон и SPA", Icon: "spa", Color: "#6B4A7A", Access: levelOpen},
			{ID: "sp-own", Name: "Руководство", Icon: "shield_person", Color: "#3A4844", Access: levelClosed},
			{ID: spRep, Name: "Ремонт и стройка", Icon: "construction", Color: "#7A5214", Access: levelLimited},
			{ID: spGen, Name: "Общее", Icon: "apartment", Color: "#2B5479", Access: levelOpen},
		},
		Nodes: nodes,
		Assignments: []DemoAssignment{
			{ID: "akb-1", Member: demoKotova, Role: "r-kb-lead", Space: spLog},
			{ID: "akb-2", Member: "m-kotelnikova", Role: demoEditors, Space: spLog},
			{ID: "akb-3", Member: demoKotova, Role: demoEditors, Space: spGen}, // KB-02: «Автор» of the prototype
		},
		Rules:  altaRules(),
		Runs:   altaRuns(),
		Tables: []DemoTable{altaInspections()},
	}
}

func altaLogistics() []DemoNode {
	kb6 := page("kb-6", spLog, "kb-f-reg", 3, kindPage, "Выезд при критическом дефекте", "Если при осмотре отмечен критический "+
		"дефект, выезд блокируется. Менеджер разрешает выезд или подтверждает неисправность и отправляет машину в ремонт.")
	kb6.Status, kb6.Owner, kb6.Versions[0].By = statusReview, demoKotova, demoKotova
	d1 := page("kb-d1", spLog, "", 3, kindDiagram, "Схема сдачи смены", "Как водитель сдаёт смену и что проверяет менеджер.")
	d1.Steps = []string{"Сдача смены", "Фото и пробег", "Чеки расходов"}
	d1.Outcomes = [][2]string{{"Принято · машина в пул", "ok"}, {"Возврат по разделам", "warn"}}
	drv := page("kb-f-drv", spLog, "", 4, kindFolder, "Водителям", "Памятки для водителей «Север Логистик».")
	drv.Mode, drv.List = modeListed, []DemoEntry{{Who: whoRole, Ref: demoDriver, Unit: demoSever, Can: canView}, editors()}
	routes := page("kb-drv-4", spLog, "kb-f-drv", 4, kindDiagram, "Маршруты", "Схему правит только руководитель пространства.")
	routes.Mode = modeEdit
	routes.Steps = []string{"Склад «Север»", "Погрузка", "Маршрут по заявке", "Разгрузка"}
	routes.Outcomes = [][2]string{{"Возврат на стоянку", "ok"}}
	fin := page("kb-fin", spLog, "", 5, kindPage, "Тарифы и начисления", "Ставки начислений водителям и порядок расчёта. "+
		"Начисление создаётся после приёмки смены.")
	fin.Finance, fin.Mode = true, modeListed
	fin.List = []DemoEntry{{Who: whoMember, Ref: demoKotova, Can: canView}, {Who: whoMember, Ref: "m-kotelnikova", Can: canView}}
	file := page("kb-file1", spLog, "", 6, kindFile, "Договор аренды стоянки.pdf", "")
	file.FileBytes, file.FilePages = 1258291, 4 // «1,2 МБ · 4 страницы»
	link := page("kb-lnk1", spLog, "", 7, kindLink, "Форма «Осмотр машины»", "")
	link.Link = &[3]string{"Форма «Осмотр машины» · действует версия 3", "forms", "dynamic_form"}
	return []DemoNode{
		page("kb-log-home", spLog, "", 0, kindPage, homeTitle, "Регламенты и памятки фирмы «Север Логистик»: приёмка смены, "+
			"осмотр машины, выезд при дефекте. Вопросы по пространству — Марине Котовой."),
		page("kb-f-reg", spLog, "", 1, kindFolder, "Регламенты", ""),
		page("kb-1a", spLog, "kb-1", 1, kindPage, "Чек-лист приёмки", "Фото с пяти ракурсов, включая одометр.\n\nПробег совпадает "+
			"с одометром на фото.\n\nУ каждого расхода есть чек.\n\nТоплива не меньше, чем при выезде."),
		page("kb-1b", spLog, "kb-1", 2, kindPage, "Типовые замечания", "Нет фото одометра — вернуть раздел «Фото».\n\nРасход без "+
			"чека — вернуть раздел «Расходы».\n\nПробег не совпадает с фото — вернуть раздел «Пробег»."),
		kb6, d1, drv,
		page("kb-drv-1", spLog, "kb-f-drv", 1, kindPage, "Памятка водителя", "Перед сменой — осмотр машины в приложении: пять "+
			"фото и пробег. Без осмотра выезд не начнётся.\n\nВ пути расходы заносите сразу и фотографируйте чек.\n\nПосле "+
			"рейса — сдача смены с фото, пробегом и чеками."),
		page("kb-drv-2", spLog, "kb-f-drv", 2, kindPage, "ДТП и поломка в пути", "Остановитесь в безопасном месте, включите "+
			"аварийную сигнализацию и выставьте знак.\n\nПозвоните диспетчеру, затем сфотографируйте место и "+
			"повреждения.\n\nНе подписывайте документы без согласования с диспетчером."),
		page("kb-drv-3", spLog, "kb-f-drv", 3, kindPage, "Контакты диспетчеров", "Диспетчерская «Север Логистик» работает "+
			"ежедневно с 8:00 до 20:00. Ночью — дежурный менеджер по номеру из карточки рейса."),
		routes, fin,
		page("kb-fin-1", spLog, "kb-fin", 1, kindPage, "Ставки по маршрутам", "Город — 2 400 ₽ за смену.\n\nМежгород до 300 км — "+
			"3 800 ₽.\n\nМежгород свыше 300 км — 5 200 ₽.\n\nНочная смена — плюс 15%."),
		file, link,
	}
}

// demoObj42 is «ЖК Речной · квартира 42» (extra-data.js:82–83): the section of the seed is built from it while the
// module «Ремонт и стройка» (stage 6) is not there (KB_OBJ_42 of the domain).
var demoObj42 = RepairObject{
	Name: "ЖК Речной · квартира 42", Address: "Москва, ул. Речная, 5, кв. 42", Area: "51 м², 2 комнаты",
	Kind: "капитальный ремонт", Client: "Ольга Смирнова", Contract: "договор № 42", Due: "27.11",
	ForemanName: "Алексей Соколов",
	Access: []string{
		"Подъезд 2, этаж 9, домофон 42К",
		"Грузовой лифт до 20:00, материалы заносить со двора",
		"Ключи у прораба, запасной комплект в офисе",
		"Шумные работы: будни 9:00–19:00, перерыв 13:00–15:00",
	},
}

func altaRepairs() []DemoNode {
	tech := page("kb-rep-tech", spRep, "", 1, kindPage, "Технология работ", "Грунтование — не раньше чем через 24 часа после "+
		"шпаклёвки.\n\nПлитка — после приёмки скрытых работ по электрике и сантехнике.\n\nФото каждого этапа — в «Фотоотчёт» "+
		"объекта.")
	tech.Ack = &DemoAck{V: 1, Audience: DemoEntry{Who: whoRole, Ref: "r-foreman"}}
	out := []DemoNode{
		page("kb-rep-home", spRep, "", 0, kindPage, homeTitle, "Технология работ, объекты и их документы. Раздел объекта "+
			"создаётся сам, когда объект переходит на этап «Договор»."),
		tech,
		page("kb-rep-obj", spRep, "", 2, kindFolder, sectionFolder, "Разделы объектов: паспорт, как попасть, акты, фотоотчёт, "+
			"гарантия."),
	}
	return append(out, demoSection(obj42, demoObj42, "kb-rep-obj")...)
}

// demoSection is the section of an object (makeSection of the domain) for the seed: the folder «{объект}» read by the
// foreman of the object, edited by the editors, and its five subpages.
func demoSection(obj string, o RepairObject, folder string) []DemoNode {
	id := "kb-o-" + obj
	rel := func(can string) DemoEntry { return DemoEntry{Who: whoRelation, Obj: obj, Can: can} }
	f := page(id, spRep, folder, 1, kindFolder, o.Name, "")
	f.Mode, f.List, f.Obj = modeListed, []DemoEntry{rel(canView), editors()}, obj
	out := []DemoNode{f}
	for i, sp := range sectionPages {
		n := page(id+"-"+string(rune('1'+i)), spRep, id, i+1, sp.kind, sp.title, sectionBody(i, o))
		n.Mode = sp.mode
		switch sp.mode {
		case modeEdit:
			n.List = []DemoEntry{rel(canEdit), editors()}
		case modeListed:
			n.List = []DemoEntry{editors()}
		}
		out = append(out, n)
	}
	return out
}

func altaGeneral() []DemoNode {
	office := page("kb-gen-1", spGen, "", 1, kindPage, "Контакты офиса", "Офис: Москва, Дмитровское шоссе, 41, этаж 2. Будни "+
		"9:00–18:00.\n\nБухгалтерия принимает документы по пятницам до 16:00.")
	office.Owner, office.Versions[0].By = demoKotova, demoKotova
	return []DemoNode{
		page("kb-gen-home", spGen, "", 0, kindPage, homeTitle, "Общие сведения для всех сотрудников «Альта Групп»."),
		office,
		page("kb-gen-2", spGen, "", 2, kindPage, "Как пользоваться Ортусом", "Задачи — в разделе «Задачи», обращения клиентов — "+
			"в «Обращениях».\n\nРегламенты своего подразделения ищите в его пространстве базы знаний."),
	}
}

func altaRules() []DemoRule {
	const (
		published = "База знаний · страница опубликована"
		daily     = "По расписанию · каждый день в 09:00"
		review    = "Пора пересмотреть страницу → уведомить владельца"
	)
	return []DemoRule{
		{"kr-1", spLog, ruleAck, "Новая версия регламента → попросить ознакомиться заново", published, true},
		{"kr-2", spLog, ruleReview, review, daily, true},
		{"kr-3", spRep, ruleSection, "Объект на этапе «Договор» → раздел из шаблона «Объект ремонта»",
			"Ремонт и стройка · этап объекта изменён", true},
		{"kr-4", spRep, ruleAck, "Новая версия «Технологии работ» → ознакомить прорабов", published, true},
		{"kr-5", spRep, ruleReview, review, daily, false},
	}
}

func altaRuns() []DemoRun {
	return []DemoRun{
		{"krr-1", spRep, "kr-3", "24.09 10:42", "ok",
			"ЖК Речной · квартира 42: создан раздел и 5 подстраниц, доступ получил прораб Алексей Соколов"},
		{"krr-2", spRep, "kr-3", "01.10 14:05", "stopped",
			"Дом 120 м², Истра: остановлено условием — новый этап «Замер», а не «Договор»"},
		{"krr-3", spLog, "kr-1", "24.09 18:10", "ok",
			"«Регламент приёмки смены» v2: попросили ознакомиться роль «Водитель» в «Север Логистик» — 1 человек"},
	}
}

func altaInspections() DemoTable {
	return DemoTable{
		ID: "kt-insp", Node: "kb-5", Title: "Осмотры",
		Columns: [][3]string{
			{"c-at", "Дата", colText}, {"c-obj", "Рейс", colText}, {"c-who", "Водитель", colText}, {"c-odo", "Пробег, км", "number"},
			{"c-fuel", "Топливо", colText}, {"c-def", "Дефекты", colText}, {"c-resp", "Ответ", colText},
		},
		Rows: []DemoRow{
			{ID: "kr-2", At: "27.09 09:12", Form: "fm-insp", Resp: "R-1012", FormVersion: 3, Cells: map[string]string{
				"c-at": "27.09 09:05", "c-obj": "Рейс Р-196", "c-who": "Илья Васильев", "c-odo": "84 210", "c-fuel": "¾",
				"c-def": "нет", "c-resp": "R-1012"}},
			{ID: "kr-1", At: "24.09 18:20", Form: "fm-insp", Resp: "R-0988", FormVersion: 2, Cells: map[string]string{
				"c-at": "18.09 08:41", "c-obj": "Рейс Р-171", "c-who": "Кирилл Громов", "c-odo": "83 902", "c-resp": "R-0988"}},
		},
	}
}
