package docs

import (
	"cmp"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
)

// level is the level of access to a document (documents.js LV): the prototype has five.
type level uint8

// Levels of access, in the order of the prototype (DOC_LEVELS).
const (
	levelNone level = iota
	levelView
	levelComment
	levelSuggest
	levelEdit
	levelManage
)

var levelCodes = [...]string{"", "view", "comment", "suggest", modeEdit, "manage"}

var levelLabels = [...]string{"Нет доступа", "Читает", "Комментирует", "Предлагает правки", "Правит", "Управляет доступом"}

// code is the value of the contract (view … manage); "" for none.
func (l level) code() string {
	if int(l) >= len(levelCodes) {
		return ""
	}
	return levelCodes[l]
}

// label is the name of the level in the interface.
func (l level) label() string {
	if int(l) >= len(levelLabels) {
		return levelLabels[0]
	}
	return levelLabels[l]
}

// parseLevel returns the level of a contract value.
func parseLevel(s string) (level, bool) {
	for i, c := range levelCodes {
		if i > 0 && c == s {
			return level(i), true
		}
	}
	return levelNone, false
}

// Statuses of a member (the membership of the control DB: invited, active; suspended and ended are blocked).
const (
	memberActive  = "active"
	memberInvited = "invited"
	memberBlocked = "blocked"
)

// member is an employee of the organization: a person profile with a membership.
type member struct {
	id     uuid.UUID
	name   string
	status string
	owner  bool // an active owner binding: the owner of the business
	driver bool // an active work function driver: finance documents are closed (AUTH-03)
}

// Actions of the catalog (api/permissions.yaml core.docs) the module decides on.
const (
	actionRead     = "docs.read"
	actionComment  = "docs.comment"
	actionSuggest  = "docs.suggest"
	actionCreate   = "docs.create"
	actionUpdate   = "docs.update"
	actionConvert  = "docs.convert"
	actionExport   = "docs.export"
	actionShare    = "docs.share"
	actionExternal = "docs.share_external"
	actionSign     = "docs.sign"
	actionFolders  = "docs.folders.manage"
)

// Templates of the roles of folders (api/permissions.yaml roles; documents.md §3.1: levels 5, 4 and 1).
const (
	templateManager = "docs_folder_manager"
	templateEditor  = "docs_folder_editor"
	templateReader  = "docs_folder_reader"
	templateDriver  = "driver"
)

// role is a live role of the organization with the actions of its current version.
type role struct {
	id       uuid.UUID
	name     string
	template string
	actions  []string
	level    level // the level the role gives in its area or folder (areaLevel / scopedLevel of the prototype)
}

// finish computes the level of the role from its template or its actions: a role of a folder by template, any other
// by the strongest verb — settings (share, folders) 5, edit 4, suggest 3, comment 2, view 1.
func (r *role) finish() {
	switch r.template {
	case templateManager:
		r.level = levelManage
		return
	case templateEditor:
		r.level = levelEdit
		return
	case templateReader:
		r.level = levelView
		return
	}
	r.level = levelNone
	for _, a := range r.actions {
		switch a {
		case actionShare, actionFolders:
			r.level = max(r.level, levelManage)
		case actionUpdate:
			r.level = max(r.level, levelEdit)
		case actionSuggest:
			r.level = max(r.level, levelSuggest)
		case actionComment:
			r.level = max(r.level, levelComment)
		case actionRead:
			r.level = max(r.level, levelView)
		}
	}
}

// has reports whether the role carries the action.
func (r *role) has(action string) bool { return slices.Contains(r.actions, action) }

// Scope kinds of access.role_assignments the module reads.
const (
	scopeTenant   = "tenant"
	scopeUnit     = "unit"
	scopeSelf     = "self"
	scopeFolder   = "folder"
	scopeDoc      = "doc"
	scopeRelation = "relation"
)

// grant is an active assignment of a member (direct or through a group).
type grant struct {
	person      uuid.UUID
	role        *role
	kind        string
	ref         uuid.UUID
	descendants bool
	until       *time.Time
	group       uuid.UUID
}

// unit is an org unit (org.units).
type unit struct {
	id     uuid.UUID
	parent uuid.UUID
	kind   string
	name   string
}

// group is a live group with its members.
type group struct {
	id      uuid.UUID
	name    string
	members []uuid.UUID
}

// Modes of access of a folder and a document («Как у папки» and «Только выбранные»).
const (
	modeInherit = "inherit"
	modeListed  = "listed"
)

// Sensitivity of a folder or a document.
const (
	sensNormal  = "normal"
	sensFinance = "finance"
	sensPDN     = "pdn"
)

// Who an entry of an access list names.
const (
	whoAll      = "all"
	whoMember   = "member"
	whoGroup    = "group"
	whoRole     = "role"
	whoRelation = "relation"
)

// entry is an entry of the access list of a folder or a document (docs.shares).
type entry struct {
	id    uuid.UUID
	who   string
	ref   uuid.UUID // member, group or role
	unit  uuid.UUID // the area of a role entry (uuid.Nil: the whole organization)
	obj   uuid.UUID // the object of a relation entry
	level level
	until *time.Time // the last day of the entry; nil — without a term
	by    uuid.UUID
	at    time.Time
}

// folder is a folder of documents (docs.folders).
type folder struct {
	id       uuid.UUID
	name     string
	parent   uuid.UUID
	unit     uuid.UUID
	mode     string
	owner    uuid.UUID
	icon     string
	sens     string
	linkRef  []byte
	revision int
	created  time.Time
	updated  time.Time
}

// tempGrant is a temporary access of a route (docs.temp_grants).
type tempGrant struct {
	member      uuid.UUID
	level       level
	why         string
	onlyVersion int
	keep        bool
}

// document is the row of a document without its body (docs.documents); the body is the file of the engine.
type document struct {
	id       uuid.UUID
	kind     string
	title    string
	folder   uuid.UUID
	owner    uuid.UUID
	status   string
	sens     string
	mode     string
	version  int
	revision int
	template uuid.UUID
	links    []byte
	fields   []byte
	frozen   []byte
	pdfa     bool
	scan     bool
	protect  []byte
	ocr      []byte
	lockKey  string
	created  time.Time
	updated  time.Time
	archived *time.Time
	tmp      []tempGrant
	lock     bool // an active route that closes editing
	route    *routeBrief
}

// routeBrief is what the list and the card need of the active route of a document.
type routeBrief struct {
	id       uuid.UUID
	status   string
	current  int
	version  int
	started  uuid.UUID
	stepName string
	due      *time.Time
	backBy   string      // who returned a returned route
	kind     string      // the kind of the current step of an active route
	waiting  []uuid.UUID // who the current step of an active route waits for
}

// repairObject is an object of repairs of the relation «прораб объекта» (none until stage 6).
type repairObject = RepairObject

// Kinds of a document, the state of a ready file, the content type of a PDF and the keys the module repeats.
const (
	kindText   = "text"
	kindSheet  = "sheet"
	kindPDF    = "pdf"
	stateReady = "ready"
	mimePDF    = "application/pdf"
	keyName    = "name"
	keyMode    = "mode"
	keyEntries = "entries"
	keyLinkID  = "linkId"
	sourceEdit = "edit"
	extDocx    = "docx"
	extXlsx    = "xlsx"
)

// Statuses of a document (docs.documents.status).
const (
	statusDraft    = "draft"
	statusInRoute  = "in_route"
	statusReturned = "returned"
	statusAgreed   = "agreed"
	statusApproved = "approved"
	statusSigned   = "signed"
	statusArchived = "archived"
)

// world is the snapshot of the documents of an organization the access chain is computed on: the people with their
// grants, groups and functions, the roles, the units, the folders and documents with their lists. It is read in the
// transaction of one request (load.go).
type world struct {
	now      time.Time
	today    time.Time // the day of now in Moscow, as a date (midnight UTC)
	units    map[uuid.UUID]*unit
	members  []*member
	member   map[uuid.UUID]*member
	names    map[uuid.UUID]string
	roles    map[uuid.UUID]*role
	groups   map[uuid.UUID]*group
	grants   map[uuid.UUID][]grant
	folders  map[uuid.UUID]*folder
	docs     map[uuid.UUID]*document
	shares   map[uuid.UUID][]entry // folder or document id → its access list
	objects  map[uuid.UUID]repairObject
	mentions map[uuid.UUID][]mention // document id → unanswered mentions of members
	ocrOpen  map[uuid.UUID]int       // document id → doubtful words of the text layer
	routeTpl map[uuid.UUID]bool      // folder id → has a route template
}

// mention is a mention in an open comment the mentioned member has not answered.
type mention struct {
	comment, by, member uuid.UUID
	text                string
}

func newWorld(now time.Time) *world {
	return &world{
		now: now, today: dayOf(now),
		units: map[uuid.UUID]*unit{}, member: map[uuid.UUID]*member{}, names: map[uuid.UUID]string{},
		roles: map[uuid.UUID]*role{}, groups: map[uuid.UUID]*group{}, grants: map[uuid.UUID][]grant{},
		folders: map[uuid.UUID]*folder{}, docs: map[uuid.UUID]*document{}, shares: map[uuid.UUID][]entry{},
		objects: map[uuid.UUID]repairObject{}, mentions: map[uuid.UUID][]mention{}, ocrOpen: map[uuid.UUID]int{},
		routeTpl: map[uuid.UUID]bool{},
	}
}

// moscow is the zone of the dates of the module (terms of entries and links): the pilot is in Moscow (UTC+3).
var moscow = time.FixedZone("MSK", 3*60*60)

// dayOf is the date of t in Moscow as midnight UTC (the form of a date column).
func dayOf(t time.Time) time.Time {
	y, m, d := t.In(moscow).Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

func (w *world) addMember(m *member) {
	w.member[m.id] = m
	w.names[m.id] = m.name
	i, _ := slices.BinarySearchFunc(w.members, m, func(a, b *member) int {
		if c := cmp.Compare(a.name, b.name); c != 0 {
			return c
		}
		return slices.Compare(a.id[:], b.id[:])
	})
	w.members = slices.Insert(w.members, i, m)
}

func (w *world) addFolder(f *folder) { w.folders[f.id] = f }
func (w *world) addDoc(d *document)  { w.docs[d.id] = d }

func (w *world) shareFolder(f *folder, e entry) { w.shares[f.id] = append(w.shares[f.id], e) }
func (w *world) shareDoc(d *document, e entry)  { w.shares[d.id] = append(w.shares[d.id], e) }

// pathGuard bounds a path against a cycle.
const pathGuard = 40

// path is the chain of folders from the top one down to f included.
func (w *world) path(f *folder) []*folder {
	var out []*folder
	for x, g := f, 0; x != nil && g < pathGuard; x, g = w.folders[x.parent], g+1 {
		out = append(out, x)
	}
	slices.Reverse(out)
	return out
}

// label is the path of a folder: «Север › Приказы».
func (w *world) label(f *folder) string {
	names := make([]string, 0, 4)
	for _, x := range w.path(f) {
		names = append(names, x.name)
	}
	return strings.Join(names, " › ")
}

// ancestorsOf returns u and its ancestors.
func (w *world) ancestorsOf(id uuid.UUID) []uuid.UUID {
	var out []uuid.UUID
	for u, g := w.units[id], 0; u != nil && g < pathGuard; u, g = w.units[u.parent], g+1 {
		out = append(out, u.id)
	}
	return out
}

// covers reports whether a territorial grant covers the unit: the organization covers everything, a unit — itself
// and, with descendants, its subtree.
func (w *world) covers(g grant, unitID uuid.UUID) bool {
	switch g.kind {
	case scopeTenant:
		return true
	case scopeUnit:
		if g.ref == unitID {
			return true
		}
		return g.descendants && slices.Contains(w.ancestorsOf(unitID), g.ref)
	}
	return false
}

// unitName is the name of a unit, «вся организация» for none.
func (w *world) unitName(id uuid.UUID) string {
	if u := w.units[id]; u != nil {
		return u.name
	}
	return "вся организация"
}

// finance reports whether the folders of the path or the document are finance ones.
func (w *world) finance(f *folder, d *document) bool {
	if d != nil && d.sens == sensFinance {
		return true
	}
	return slices.ContainsFunc(w.path(f), func(x *folder) bool { return x.sens == sensFinance })
}
