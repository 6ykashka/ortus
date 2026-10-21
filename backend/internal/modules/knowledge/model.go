package knowledge

import (
	"slices"
	"time"

	"github.com/google/uuid"
)

// Statuses of a member in the knowledge base (the membership of the control DB: invited, active; suspended and
// ended are blocked — they get no access anywhere, prototype Member.status).
const (
	memberActive  = "active"
	memberInvited = "invited"
	memberBlocked = "blocked"
)

// member is an employee of the organization: a person profile with a membership.
type member struct {
	id     uuid.UUID
	name   string
	status string // memberActive | memberInvited | memberBlocked
	owner  bool   // an active owner binding: the owner of the business sees and edits everything
	driver bool   // an active work function driver: finance nodes are closed (AUTH-03)
}

// verbs are the verbs of the knowledge base a role gives (prototype role.actions.knowledge).
type verbs uint8

const (
	verbView     verbs = 1 << iota // knowledge.read
	verbCreate                     // knowledge.create
	verbEdit                       // knowledge.update
	verbReview                     // knowledge.publish («Утвердить»)
	verbSettings                   // knowledge.spaces.manage (create spaces; a role of an area)
	verbLead                       // knowledge.access.manage (the lead of a space; a role of the space)
)

func (v verbs) has(x verbs) bool { return v&x == x }

// Actions of the catalog (api/permissions.yaml core.knowledge) the module decides on.
const (
	actionRead       = "knowledge.read"
	actionCreate     = "knowledge.create"
	actionUpdate     = "knowledge.update"
	actionPublish    = "knowledge.publish"
	actionOrganize   = "knowledge.organize"
	actionAccess     = "knowledge.access.manage"
	actionMembers    = "knowledge.members.manage"
	actionAutomation = "knowledge.automation.manage"
	actionSpaces     = "knowledge.spaces.manage"
)

var actionVerbs = map[string]verbs{
	actionRead: verbView, actionCreate: verbCreate, actionUpdate: verbEdit, actionPublish: verbReview,
	actionSpaces: verbSettings, actionAccess: verbLead,
}

func verbsOf(actions []string) verbs {
	var v verbs
	for _, a := range actions {
		v |= actionVerbs[a]
	}
	return v
}

// Templates of the roles of a space (api/permissions.yaml roles, KB-02: no «Автор»), in the order of the prototype.
const (
	templateLead   = "kb_space_lead"
	templateEditor = "kb_space_editor"
	templateReader = "kb_space_reader"
)

// spaceTemplates are the templates of the roles of a space, the lead first.
var spaceTemplates = []string{templateLead, templateEditor, templateReader}

func isSpaceTemplate(t string) bool { return slices.Contains(spaceTemplates, t) }

// role is a live role of the organization with the actions of its current version.
type role struct {
	id       uuid.UUID
	name     string
	kind     string // system | template | custom
	template string // access.roles.template_key; "" — none
	actions  []string
	verbs    verbs
}

// kindSystem is the kind of a system role (the roles of spaces are system roles, created by the module).
const kindSystem = "system"

// spaceRole reports whether the role is a role of a space (it acts in its space only).
func (r *role) spaceRole() bool { return isSpaceTemplate(r.template) }

// Scope kinds of access.role_assignments the knowledge base reads.
const (
	scopeTenant = "tenant"
	scopeUnit   = "unit"
	scopeSelf   = "self"
	scopeSpace  = "space"
	scopePage   = "page"
)

// grant is an active assignment of a member (direct or through a group) with the actions of its role version.
type grant struct {
	id          uuid.UUID
	person      uuid.UUID
	role        *role
	verbs       verbs // of the version of the assignment
	kind        string
	ref         uuid.UUID
	descendants bool
	until       *time.Time // upper bound of the period; nil — open-ended
	group       uuid.UUID  // uuid.Nil: assigned to the person directly
}

// unit is an org unit (org.units).
type unit struct {
	id     uuid.UUID
	parent uuid.UUID
	kind   string // region | company | branch | team
	name   string
}

// group is a live group with its members.
type group struct {
	id      uuid.UUID
	name    string
	members []uuid.UUID
}

// Levels of a space (KnowledgeSpace.access).
const (
	levelOpen    = "open"
	levelLimited = "limited"
	levelClosed  = "closed"
)

// space is a space of the knowledge base (kb.spaces): an access area — the unit whose roles act in it (uuid.Nil — the
// whole organization) and the level.
type space struct {
	id       uuid.UUID
	name     string
	icon     string
	color    string
	unit     uuid.UUID
	access   string
	template string
	revision int64
	created  time.Time
}

// Modes of the own access of a node (prototype keys; the contract and kb.nodes write edit as edit_listed).
const (
	modeInherit = "inherit"
	modeEdit    = "edit"
	modeListed  = "listed"
)

// Kinds of entries of an access list.
const (
	whoAll      = "all"
	whoMember   = "member"
	whoGroup    = "group"
	whoRole     = "role"
	whoRelation = "relation"
)

// Rights of an entry.
const (
	canView = "view"
	canEdit = "edit"
)

// entry is an entry of an access list or the audience of an acknowledgement.
type entry struct {
	who  string
	ref  uuid.UUID // member, group or role
	unit uuid.UUID // a role entry: the unit its grant must cover (uuid.Nil — any)
	obj  uuid.UUID // a relation entry: the object of repairs (its foreman)
	can  string
}

// entryKey identifies an entry of a list whatever its right (entryKey of the domain core).
type entryKey struct {
	who            string
	ref, unit, obj uuid.UUID
}

func (e entry) key() entryKey { return entryKey{e.who, e.ref, e.unit, e.obj} }

// version is a published version of a node (kb.versions).
type version struct {
	v      int
	at     time.Time
	by     uuid.UUID
	author string
	body   string
}

// ackLog is a confirmation of a version (kb.ack_log, KB-03).
type ackLog struct {
	member uuid.UUID
	v      int
	at     time.Time
}

// ack is the acknowledgement requested for a version of a node; done — the members who confirmed it.
type ack struct {
	v        int
	audience entry // who all, role, group or member
	log      []ackLog
}

// done reports whether member confirmed the requested version.
func (a *ack) done(m uuid.UUID) bool {
	return slices.ContainsFunc(a.log, func(l ackLog) bool { return l.member == m && l.v == a.v })
}

// Kinds of nodes.
const (
	kindPage    = "page"
	kindFolder  = "folder"
	kindTable   = "table"
	kindDiagram = "diagram"
	kindFile    = "file"
	kindLink    = "link"
)

// Statuses of a node.
const (
	statusActive   = "active"
	statusDraft    = "draft"
	statusReview   = "review"
	statusOutdated = "outdated"
)

// outcome is an outcome of a diagram.
type outcome struct {
	Text string `json:"text"`
	Tone string `json:"tone"` // ok | warn
}

// diagram is the steps and outcomes of a diagram node (kb.nodes.diagram).
type diagram struct {
	Steps    []string  `json:"steps"`
	Outcomes []outcome `json:"outcomes"`
}

// fileMeta is the file of a file node (files.objects, purpose knowledge_attachment): «PDF · {размер} · N страниц».
type fileMeta struct {
	id    uuid.UUID
	bytes int64
	pages int
}

// linkMeta is a CRM record node (kb.nodes.link).
type linkMeta struct {
	Label     string `json:"label"`
	ModuleKey string `json:"moduleKey"`
	Icon      string `json:"icon"`
}

// node is a node of the tree (kb.nodes) with its versions (oldest first), own access and acknowledgement.
type node struct {
	id        uuid.UUID
	space     uuid.UUID
	parent    uuid.UUID // uuid.Nil — the top level
	pos       int
	depth     int
	home      bool
	kind      string
	title     string
	status    string
	mode      string
	accessRev int64
	list      []entry
	finance   bool
	owner     uuid.UUID
	reviewBy  *time.Time // a date (midnight UTC of the day)
	diagram   *diagram
	file      *fileMeta
	link      *linkMeta
	obj       uuid.UUID // the object of repairs of a section
	archived  bool
	versions  []version
	ack       *ack
	created   time.Time
}

// ownMode reports whether the node has its own access.
func (n *node) ownMode() bool { return n.mode == modeEdit || n.mode == modeListed }

// last returns the current version (a node always has one; the zero version otherwise).
func (n *node) last() version {
	if len(n.versions) == 0 {
		return version{}
	}
	return n.versions[len(n.versions)-1]
}

// clone returns a copy of n whose list and versions can be changed without touching n.
func (n *node) clone() *node {
	c := *n
	c.list = slices.Clone(n.list)
	c.versions = slices.Clone(n.versions)
	return &c
}

// Statuses of an access request.
const (
	requestOpen     = "open"
	requestApproved = "approved"
	requestDenied   = "denied"
)

// request is an access request (kb.requests).
type request struct {
	id        uuid.UUID
	node      uuid.UUID
	space     uuid.UUID
	member    uuid.UUID
	can       string
	status    string
	at        time.Time
	decidedAt *time.Time
	decidedBy uuid.UUID
	until     *time.Time
}

// Kinds of the rules of automation.
const (
	ruleAck     = "ack"
	ruleReview  = "review"
	ruleSection = "section"
)

// rule is a rule of automation of a space (kb.rules).
type rule struct {
	id      uuid.UUID
	space   uuid.UUID
	kind    string
	name    string
	trigger string
	on      bool
}

// run is a line of the journal of runs (kb.runs).
type run struct {
	id   uuid.UUID
	rule uuid.UUID
	at   time.Time
	res  string // ok | warn | stopped | error
	text string
}

// column is a column of a table of a page.
type column struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
	Type string    `json:"type"`
}

// source is the form response a row or an entry comes from.
type source struct {
	form    uuid.UUID
	resp    string
	version int
}

// row is a row of a table of a page.
type row struct {
	id    uuid.UUID
	at    time.Time
	cells map[string]string
	src   *source
}

// table is a table of a page (kb.tables) with its rows, newest first.
type table struct {
	id      uuid.UUID
	node    uuid.UUID
	title   string
	columns []column
	rows    []row
}

// line is a line of a form entry.
type line struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// record is a form entry of a page (kb.entries, D-26).
type record struct {
	id    uuid.UUID
	node  uuid.UUID
	at    time.Time
	head  string
	lines []line
	src   source
}

// RepairObject is an object of repairs as the knowledge base needs it: the relation «прораб объекта» (KB-01) and the
// section of the object (template «Объект ремонта»).
type RepairObject struct {
	ID          uuid.UUID
	Name        string
	Stage       string
	Address     string
	Area        string
	Kind        string
	Client      string
	Contract    string
	Due         string
	Foreman     uuid.UUID // uuid.Nil — «прораб не назначен»
	ForemanName string
	Access      []string // the lines of «Как попасть на объект»
}
