package knowledge

import (
	"fmt"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"

	kapi "github.com/ortus/ortus-crm/backend/internal/api/knowledge"
)

// The projection of the knowledge base into the schemas of the contract (msw/knowledge/state.ts of W4.04).

// idPtr is a pointer to id, nil for uuid.Nil.
func idPtr(id uuid.UUID) *uuid.UUID {
	if id == uuid.Nil {
		return nil
	}
	return &id
}

// alloc returns a new value of the type *dst points to: the date type of the generator is not named in the module
// (depguard keeps the runtime of oapi-codegen out of internal/modules), callers set its Time.
func alloc[T any](_ **T) *T { return new(T) }

// capital is s with its first letter capitalized («Вся организация»).
func capital(s string) string {
	r, size := utf8.DecodeRuneInString(s)
	return string(unicode.ToUpper(r)) + s[size:]
}

// visible reports whether the member of r sees n.
func (r *req) visible(n *node) bool { return n != nil && r.acc(n).view }

// spaceDTO is a space with the rights of the member, its leads, counters and the last update.
func (r *req) spaceDTO(sp *space) kapi.KnowledgeSpace {
	my := r.w.spaceMy(r.me, sp)
	out := kapi.KnowledgeSpace{
		Id: sp.id, Name: sp.name, Icon: sp.icon, Color: sp.color, OrgUnitId: idPtr(sp.unit),
		AreaLabel: capital(r.w.areaLabel(sp)), Access: kapi.KnowledgeSpaceAccess(accessOf(sp)), Revision: sp.revision,
		My:        kapi.KnowledgeSpaceMy{Owner: my.owner, Lead: my.lead, View: my.view, Create: my.create, Edit: my.edit, Role: my.role},
		LeadNames: []string{},
	}
	if sp.template != "" {
		out.TemplateKey = new(sp.template)
	}
	for _, m := range r.w.leads(sp) {
		out.LeadNames = append(out.LeadNames, m.name)
	}
	var last *node
	for _, n := range r.w.order(sp.id, false) {
		if n.home {
			out.HomeNodeId = new(n.id)
		}
		if n.kind == kindFolder || !r.visible(n) {
			continue
		}
		out.PageCount++
		if last == nil || newer(n, last) {
			last = n
		}
	}
	if last != nil {
		out.LastUpdate = &kapi.KnowledgeLastUpdate{NodeId: last.id, Title: last.title, At: last.last().at}
	}
	if my.lead {
		out.OpenRequestCount = new(r.openRequests(sp.id, uuid.Nil))
	}
	return out
}

// newer reports whether a was published after b (equal moments — the title first).
func newer(a, b *node) bool {
	if c := a.last().at.Compare(b.last().at); c != 0 {
		return c > 0
	}
	return a.title < b.title
}

// openRequests counts the open requests of a space (of a node when nodeID is set).
func (r *req) openRequests(spaceID, nodeID uuid.UUID) int {
	n := 0
	for _, x := range r.w.requests {
		if x.space == spaceID && x.status == requestOpen && (nodeID == uuid.Nil || x.node == nodeID) {
			n++
		}
	}
	return n
}

// treeRow is a visible node with its depth in the visible tree.
type treeRow struct {
	n *node
	d int
}

// visibleTree is the not archived nodes of sp m sees depth-first by position; a node whose parent m does not see is
// shown at the top level (visTree of the reference).
func (w *world) visibleTree(m *member, sp *space) []treeRow {
	vis := map[uuid.UUID]*node{}
	for _, n := range w.nodes {
		if n.space == sp.id && !n.archived && w.access(m, n).view {
			vis[n.id] = n
		}
	}
	kids := map[uuid.UUID][]*node{}
	for _, n := range vis {
		p := n.parent
		if vis[p] == nil {
			p = uuid.Nil
		}
		kids[p] = append(kids[p], n)
	}
	var out []treeRow
	var walk func(uuid.UUID, int)
	walk = func(p uuid.UUID, d int) {
		ns := kids[p]
		slices.SortFunc(ns, compareNodes)
		for _, n := range ns {
			out = append(out, treeRow{n, d})
			walk(n.id, d+1)
		}
	}
	walk(uuid.Nil, 1)
	return out
}

// visibleParent is the parent of n if the member sees it (a hidden parent is not revealed).
func (r *req) visibleParent(n *node) *uuid.UUID {
	if p := r.w.nodeOf(n.parent); r.visible(p) {
		return &p.id
	}
	return nil
}

// visiblePath is the ancestors of n from the top the member sees (the path stops at a hidden ancestor).
func (r *req) visiblePath(n *node) []kapi.KnowledgeNodeRef {
	out := []kapi.KnowledgeNodeRef{}
	for p := r.w.nodeOf(n.parent); r.visible(p); p = r.w.nodeOf(p.parent) {
		out = append([]kapi.KnowledgeNodeRef{{Id: p.id, Title: p.title}}, out...)
	}
	return out
}

func (r *req) nodeMy(n *node) kapi.KnowledgeNodeMy {
	a := r.acc(n)
	return kapi.KnowledgeNodeMy{Edit: a.edit, Lead: a.lead, Create: a.create}
}

func sensitivity(n *node) string {
	if n.finance {
		return "finance"
	}
	return "normal"
}

// summaryDTO is a visible node of the tree.
func (r *req) summaryDTO(n *node) kapi.KnowledgeNodeSummary {
	return kapi.KnowledgeNodeSummary{
		Id: n.id, SpaceId: n.space, ParentId: r.visibleParent(n), Position: n.pos, Kind: kapi.KnowledgeNodeSummaryKind(n.kind),
		Title: n.title, Status: kapi.KnowledgeNodeSummaryStatus(n.status),
		AccessMode: kapi.KnowledgeNodeSummaryAccessMode(modeToDB(n.mode)), Sensitivity: kapi.KnowledgeNodeSummarySensitivity(sensitivity(n)),
		Archived: n.archived, Version: n.last().v, My: r.nodeMy(n),
	}
}

// nodeDTO is a node with its current version, versions, path, owner, acknowledgement, tables and entries.
func (r *req) nodeDTO(n *node) kapi.KnowledgeNode {
	cur := n.last()
	out := kapi.KnowledgeNode{
		Id: n.id, SpaceId: n.space, ParentId: r.visibleParent(n), Position: n.pos, Kind: kapi.KnowledgeNodeKind(n.kind),
		Title: n.title, Status: kapi.KnowledgeNodeStatus(n.status), AccessMode: kapi.KnowledgeNodeAccessMode(modeToDB(n.mode)),
		Sensitivity: kapi.KnowledgeNodeSensitivity(sensitivity(n)), Archived: n.archived, Version: cur.v, My: r.nodeMy(n),
		SpaceName: r.w.spaceOf(n).name, Path: r.visiblePath(n), Revision: int64(cur.v),
		Current: kapi.KnowledgeVersion{Version: cur.v, PublishedAt: cur.at, AuthorDisplayName: cur.author, Body: cur.body},
		Tables:  []kapi.KnowledgeTable{}, Entries: []kapi.KnowledgeEntry{}, Versions: []kapi.KnowledgeVersionSummary{},
	}
	if n.reviewBy != nil {
		d := alloc(&out.ReviewBy)
		d.Time = *n.reviewBy
		out.ReviewBy = d
	}
	out.Owner.DisplayName = r.w.nameOf(n.owner)
	out.Owner.MemberId = idPtr(n.owner)
	for _, v := range slices.Backward(n.versions) {
		out.Versions = append(out.Versions, kapi.KnowledgeVersionSummary{Version: v.v, PublishedAt: v.at, AuthorDisplayName: v.author})
	}
	for _, t := range r.w.tables {
		if t.node == n.id {
			out.Tables = append(out.Tables, tableDTO(t))
		}
	}
	for _, e := range r.w.records {
		if e.node == n.id {
			out.Entries = append(out.Entries, recordDTO(e))
		}
	}
	out.Ack = r.ackDTO(n)
	r.extrasDTO(n, &out)
	return out
}

// extrasDTO sets the diagram, the file and the CRM record of a node.
func (r *req) extrasDTO(n *node, out *kapi.KnowledgeNode) {
	if n.kind == kindDiagram && n.diagram != nil {
		d := &kapi.KnowledgeDiagram{Steps: append([]string{}, n.diagram.Steps...)}
		d.Outcomes = emptyOf(&d.Outcomes)
		for _, o := range n.diagram.Outcomes {
			next, x := grow(d.Outcomes)
			x.Text, x.Tone = o.Text, kapi.KnowledgeDiagramOutcomesToneOk
			if o.Tone == "warn" {
				x.Tone = kapi.KnowledgeDiagramOutcomesToneWarn
			}
			d.Outcomes = next
		}
		out.Diagram = d
	}
	if n.kind == kindFile && n.file != nil {
		out.File = &kapi.KnowledgeFile{SizeLabel: sizeLabel(n.file.bytes), Pages: n.file.pages}
	}
	if n.kind == kindLink && n.link != nil {
		out.Link = &kapi.KnowledgeLink{Label: n.link.Label, ModuleKey: n.link.ModuleKey, Icon: n.link.Icon}
	}
}

// sizeLabel is the size of a file as the reference shows it: «1,2 МБ», «640 КБ».
func sizeLabel(bytes int64) string {
	const kb, mb = 1024, 1024 * 1024
	if bytes >= mb/10 {
		return strings.Replace(fmt.Sprintf("%.1f МБ", float64(bytes)/mb), ".", ",", 1)
	}
	return fmt.Sprintf("%d КБ", (bytes+kb-1)/kb)
}

func tableDTO(t *table) kapi.KnowledgeTable {
	out := kapi.KnowledgeTable{Id: t.id, NodeId: t.node, Title: t.title, Columns: []kapi.KnowledgeTableColumn{},
		Rows: []kapi.KnowledgeTableRow{}}
	for _, c := range t.columns {
		out.Columns = append(out.Columns, kapi.KnowledgeTableColumn{Id: c.ID, Name: c.Name, Type: c.Type})
	}
	for _, x := range t.rows {
		rw := kapi.KnowledgeTableRow{Id: x.id, AddedAt: x.at, Cells: x.cells}
		if x.src != nil {
			rw.Source = &kapi.KnowledgeEntrySource{FormId: x.src.form, ResponseNumber: x.src.resp, FormVersion: x.src.version}
		}
		out.Rows = append(out.Rows, rw)
	}
	return out
}

func recordDTO(e *record) kapi.KnowledgeEntry {
	out := kapi.KnowledgeEntry{Id: e.id, NodeId: e.node, AddedAt: e.at, Head: e.head,
		Source: kapi.KnowledgeEntrySource{FormId: e.src.form, ResponseNumber: e.src.resp, FormVersion: e.src.version}}
	out.Lines = emptyOf(&out.Lines)
	for _, l := range e.lines {
		next, x := grow(out.Lines)
		x.Name, x.Value = l.Name, l.Value
		out.Lines = next
	}
	return out
}

// audience is the active members asked to acknowledge n: those who see it and are in the audience of its
// acknowledgement.
func (w *world) audience(n *node) []*member {
	if n.ack == nil {
		return nil
	}
	sp := w.spaceOf(n)
	var out []*member
	for _, m := range w.members {
		if m.status == memberActive && w.access(m, n).view && (n.ack.audience.who == whoAll || w.entryHas(m, n.ack.audience, sp)) {
			out = append(out, m)
		}
	}
	return out
}

// ackDTO is the acknowledgement of n: the own state to everyone, the statistics to its editors and the lead, the
// log (KB-03) to the lead of the space and the owner of the business only.
func (r *req) ackDTO(n *node) *kapi.KnowledgeAck {
	a := n.ack
	if a == nil {
		return nil
	}
	who := r.w.audience(n)
	out := &kapi.KnowledgeAck{Version: a.v, AudienceLabel: r.audienceLabel(a.audience)}
	out.Mine.Required = slices.Contains(who, r.me)
	out.Mine.Done = a.done(r.me.id)
	if acc := r.acc(n); acc.edit || acc.lead {
		done, pending := 0, []string{}
		for _, m := range who {
			if a.done(m.id) {
				done++
			} else {
				pending = append(pending, m.name)
			}
		}
		out.Total, out.DoneCount, out.PendingNames = new(len(who)), new(done), &pending
	}
	if r.w.spaceMy(r.me, r.w.spaceOf(n)).lead {
		log := make([]kapi.KnowledgeAckLogEntry, 0, len(a.log))
		for _, l := range a.log {
			log = append(log, kapi.KnowledgeAckLogEntry{MemberId: l.member, DisplayName: r.w.nameOf(l.member), Version: l.v, At: l.at})
		}
		out.Log = &log
	}
	return out
}

// audienceLabel is «все, кто видит страницу» or «роль «{роль}»» (a group or an employee by name).
func (r *req) audienceLabel(e entry) string {
	switch e.who {
	case whoAll:
		return "все, кто видит страницу"
	case whoGroup:
		return "группа «" + r.w.groupName(e.ref) + "»"
	case whoMember:
		return r.w.nameOf(e.ref)
	}
	name := e.ref.String()
	if x := r.w.roles[e.ref]; x != nil {
		name = x.name
	}
	return "роль «" + name + "»"
}

// excerpt is the text collapsed to one line, at most n characters with «…».
func excerpt(s string, n int) string {
	x := strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(x) <= n {
		return x
	}
	return string([]rune(x)[:n-1]) + "…"
}
