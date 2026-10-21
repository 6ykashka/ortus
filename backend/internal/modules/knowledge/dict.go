package knowledge

// Dictionaries of the knowledge base (knowledge.js 14.10:11–62, domain W4.30 dictionaries.ts). Differences from the
// prototype — the answers of 17.10: three roles of a space (KB-02, no «Автор»), six levels of the tree (KB-06).

// levelInfo is a level of a space: its label and description.
type levelInfo struct{ label, d string }

var levels = map[string]levelInfo{
	levelOpen:    {"Открытое", "Роли области действуют полностью"},
	levelLimited: {"Ограниченное", "Все в области читают, пишут участники"},
	levelClosed:  {"Закрытое", "Только участники и владелец бизнеса"},
}

// levelOf is the level of a space; an unknown one is closed (fail-closed, domain W4.30).
func levelOf(sp *space) levelInfo {
	if l, ok := levels[sp.access]; ok {
		return l
	}
	return levels[levelClosed]
}

// accessOf is the level key of a space; an unknown one is closed.
func accessOf(sp *space) string {
	if _, ok := levels[sp.access]; ok {
		return sp.access
	}
	return levelClosed
}

// modeLabels are the labels of the modes of a node.
var modeLabels = map[string]string{
	modeInherit: "Как у родителя",
	modeEdit:    "Читают все, правят выбранные",
	modeListed:  "Только выбранные",
}

// roleCaps are the descriptions of the roles of a space (KB_ROLE_CAPS).
var roleCaps = map[string]string{
	templateLead:   "Всё в пространстве, участники, доступ, автоматизация",
	templateEditor: "Создаёт и правит любые страницы, публикует, перемещает",
	templateReader: "Читает и отмечает «Ознакомлен»",
}

// spaceRoleDefs are the roles of a space created in an organization that has none yet: the names and the actions of
// the templates of the catalog (api/permissions.yaml kb_space_lead, kb_space_editor, kb_space_reader).
var spaceRoleDefs = map[string]struct {
	name    string
	actions []string
}{
	templateLead: {"Руководитель пространства", []string{actionRead, actionCreate, actionUpdate, actionOrganize, actionPublish,
		actionAccess, actionMembers, actionAutomation}},
	templateEditor: {"Редактор", []string{actionRead, actionCreate, actionUpdate, actionOrganize, actionPublish}},
	templateReader: {"Читатель", []string{actionRead}},
}

// Limits of the knowledge base.
const (
	maxDepth   = 6     // KB-06: «Обзор» is level 1
	maxBody    = 20000 // characters of the text of a version
	runsKept   = 40    // lines of the journal of runs of a space
	reqDays    = 30    // an approved request to read gives a page assignment for 30 days
	maxResults = 12    // results of the search
	excerptLen = 150   // characters of an excerpt of the search
	mapColumns = 8     // employees of the access map
	ackYears   = 5     // the acknowledgement log is kept 5 years (KB-03)
	titleMin   = 2
	titleMax   = 120
	homeTitle  = "Обзор"
	areaAll    = "вся организация"
)

// templateNode is a node of a template of a space: in — a subpage of the previous top node, role — a folder of a
// function (the role that reads it), ack — acknowledgement is requested from everyone who sees it.
type templateNode struct {
	title string
	kind  string
	body  string
	in    bool
	role  string // key of templateRoles
	ack   bool
}

// spaceTemplate is a starting template of a space (KB_TEMPLATES).
type spaceTemplate struct {
	key, name, icon, hint string
	nodes                 []templateNode
}

// templateRole names a role of a function of a template: the template of the catalog or, without one, the name of
// the role of the organization (the massage therapist has no template in the catalog).
type templateRole struct{ template, name string }

// foreman is the role of the template «Прорабы» and the relation «прораб объекта» (KB-01).
const foreman = "foreman"

var templateRoles = map[string]templateRole{
	"driver":    {"driver", "Водитель"},
	foreman:     {foreman, "Прораб"},
	"therapist": {"", "Массажист"},
}

// templates are the four templates of Ortus, in the order of the dialog «Новое пространство».
var templates = []spaceTemplate{
	{key: "regs", name: "Регламенты подразделения", icon: "rule", hint: "Обзор, регламенты, чек-листы, журнал изменений",
		nodes: []templateNode{
			{title: homeTitle, kind: kindPage, body: "Что лежит в пространстве и к кому обращаться с вопросами."},
			{title: "Регламенты", kind: kindFolder},
			{title: "Порядок работы", kind: kindPage, in: true, body: "Кто, что и в какие сроки делает в подразделении."},
			{title: "Чек-листы", kind: kindFolder},
			{title: "Журнал изменений", kind: kindPage, body: "Что поменялось в регламентах и с какой даты действует."},
		}},
	{key: "staff", name: "Инструкции для сотрудников", icon: "health_and_safety",
		hint: "Вводный инструктаж и папки по функциям: водители, прорабы, массажисты",
		nodes: []templateNode{
			{title: homeTitle, kind: kindPage, body: "Инструкции и инструктажи для сотрудников. Каждый видит папку своей функции."},
			{title: "Вводный инструктаж", kind: kindPage, ack: true,
				body: "Правила безопасности на рабочем месте, порядок действий при травме и пожаре, контакты ответственных."},
			{title: "Водителям", kind: kindFolder, role: "driver"},
			{title: "Перед выездом", kind: kindPage, in: true, body: "Осмотр машины, фото с пяти ракурсов, проверка документов."},
			{title: "Прорабам и бригадам", kind: kindFolder, role: foreman},
			{title: "Работа на высоте", kind: kindPage, in: true, body: "Леса и стремянки, страховка, допуск к работам на высоте."},
			{title: "Массажистам", kind: kindFolder, role: "therapist"},
			{title: "Подготовка кабинета", kind: kindPage, in: true,
				body: "Проветривание, смена белья, подогрев стола, уборка после визита."},
		}},
	{key: "objects", name: "Объекты и проекты", icon: "home_work", hint: "Папка «Объекты» и технология работ",
		nodes: []templateNode{
			{title: homeTitle, kind: kindPage, body: "Объекты, их документы и технология работ."},
			{title: sectionFolder, kind: kindFolder},
			{title: "Технология работ", kind: kindPage, body: "Порядок и сроки этапов, требования к фотоотчёту."},
		}},
	{key: "blank", name: "Пустое пространство", icon: "draft", hint: "Только главная страница",
		nodes: []templateNode{{title: homeTitle, kind: kindPage}}},
}

// templateOf returns the template of key; an unknown key is the blank template (the prototype's fallback).
func templateOf(key string) spaceTemplate {
	for _, t := range templates {
		if t.key == key {
			return t
		}
	}
	return templates[len(templates)-1]
}

// sectionFolder is the top folder of a space the sections of objects go to.
const sectionFolder = "Объекты"

// sectionPage is a subpage of the section of an object (KB_SECTION «Объект ремонта» v3).
type sectionPage struct {
	title, kind, mode string
}

// sectionPages are the five subpages of a section with their own access: «Как попасть на объект» and «Фотоотчёт» —
// the foreman edits, «Гарантия» — the editors only (the foreman sees it after the object is handed over).
var sectionPages = []sectionPage{
	{"Паспорт объекта", kindPage, modeInherit},
	{"Как попасть на объект", kindPage, modeEdit},
	{"Акты скрытых работ", kindTable, modeInherit},
	{"Фотоотчёт", kindPage, modeEdit},
	{"Гарантия", kindPage, modeListed},
}

// Texts of the subpages of a section without the data of the object.
const (
	sectionActs     = "Строки добавляются, когда заказчик подписывает акт."
	sectionPhotos   = "Фото по этапам: до начала, скрытые работы, черновая и чистовая отделка."
	sectionWarranty = "Гарантийные обязательства и контакты для обращений. Прораб увидит страницу после сдачи объекта."
	sectionEntry    = "Адрес, вход, ключи, время шумных работ."
)
