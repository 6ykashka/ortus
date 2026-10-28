package docs

import (
	"encoding/json"
	"slices"
	"time"

	"github.com/google/uuid"

	dapi "github.com/ortus/ortus-crm/backend/internal/api/docs"
)

// memberRef is a member shown by name.
func (r *req) memberRef(id uuid.UUID) dapi.DocMemberRef {
	return dapi.DocMemberRef{DisplayName: r.w.names[id], MemberId: id}
}

// instant is t in UTC.
func instant(t time.Time) time.Time { return t.UTC() }

// setDate sets a date field of the contract (a date without a time) without naming its type.
func setDate[T any](dst **T, t time.Time) {
	b, _ := json.Marshal(t.Format(time.DateOnly))
	_ = json.Unmarshal(b, dst)
}

// decodeList decodes a jsonb array column into a slice (a broken or empty column is an empty list).
func decodeList[T any](raw []byte) []T {
	out := []T{}
	if len(raw) == 0 {
		return out
	}
	var v []T
	if err := json.Unmarshal(raw, &v); err != nil || v == nil {
		return out
	}
	return v
}

// decodeObject decodes a jsonb object column; nil for an empty or broken one.
func decodeObject[T any](raw []byte) *T {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var v T
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil
	}
	return &v
}

// shareEntry is an entry of an access list in the contract.
func (r *req) shareEntry(e entry) dapi.DocShareEntry {
	out := dapi.DocShareEntry{Who: dapi.DocShareEntryWho(e.who), Level: dapi.DocShareEntryLevel(e.level.code())}
	label := r.w.entryLabel(e)
	out.Label = &label
	if e.ref != uuid.Nil {
		ref := e.ref
		out.RefId = &ref
	}
	if e.unit != uuid.Nil {
		u := e.unit
		out.OrgUnitId = &u
	}
	if e.obj != uuid.Nil {
		out.Object = &dapi.ObjectRef{ModuleKey: "repairs", EntityType: "object", EntityId: e.obj}
	}
	if e.until != nil {
		setDate(&out.Until, *e.until)
	}
	if !e.at.IsZero() {
		at := instant(e.at)
		out.At = &at
	}
	if n := r.w.names[e.by]; n != "" {
		out.ByDisplayName = &n
	}
	return out
}

// shareEntries are the entries of the list of a folder or a document in the order they were given.
func (r *req) shareEntries(id uuid.UUID) []dapi.DocShareEntry {
	out := []dapi.DocShareEntry{}
	for _, e := range r.w.shares[id] {
		out = append(out, r.shareEntry(e))
	}
	return out
}

// can is DocCan of the rights.
func can(rt rights) dapi.DocCan {
	return dapi.DocCan{View: rt.view, Comment: rt.comment, Suggest: rt.suggest, Edit: rt.edit, Manage: rt.manage, Locked: rt.locked,
		Share: rt.share, ShareExternal: rt.shareExternal, Export: rt.export, Sign: rt.sign, Route: rt.route, Convert: rt.convert}
}

// chainDTO is the chain «Откуда доступ».
func chainDTO(a access) []dapi.DocChainStep {
	out := make([]dapi.DocChainStep, 0, len(a.chain))
	for _, s := range a.chain {
		out = append(out, dapi.DocChainStep{Kind: dapi.DocChainStepKind(s.kind), Title: s.title, Detail: s.detail})
	}
	return out
}

// my is the view of the member of a document (DocMy); the chain only when asked.
func (r *req) my(d *document, rt rights, withChain bool) dapi.DocMy {
	out := dapi.DocMy{Can: can(rt), Wait: r.waits(d)}
	if rt.level > 0 {
		l := dapi.DocMyLevel(rt.level.code())
		g := dapi.DocMyMaxGrant(rt.maxGrant.code())
		out.Level, out.MaxGrant = &l, &g
	}
	if rt.onlyVersion > 0 {
		v := int64(rt.onlyVersion)
		out.OnlyVersion = &v
	}
	if withChain {
		c := chainDTO(rt.access)
		out.Chain = &c
	}
	return out
}

// waits are the things that wait for the member in d (docWaits): a mention to answer, a scan to check, a returned
// route, the step of an active route that waits for the member.
func (r *req) waits(d *document) []dapi.DocWait {
	out := r.mentionWaits(d)
	if n := r.w.ocrOpen[d.id]; n > 0 && (d.owner == r.me.id || r.me.owner) {
		c := int64(n)
		out = append(out, dapi.DocWait{Kind: dapi.DocWaitKind("ocr"), Count: &c})
	}
	b := d.route
	switch {
	case b == nil:
	case b.status == routeReturned && b.started == r.me.id:
		w := dapi.DocWait{Kind: dapi.DocWaitKind("returned")}
		if b.backBy != "" {
			by := b.backBy
			w.By = &by
		}
		out = append(out, w)
	case b.status == routeActive && slices.Contains(b.waiting, r.me.id):
		w := dapi.DocWait{Kind: dapi.DocWaitKind(b.kind)}
		if b.due != nil {
			setDate(&w.Due, *b.due)
		}
		out = append(out, w)
	}
	return out
}

// mentionWaits are the mentions the member answers, or — for the author — the mentioned ones who cannot open the
// document yet.
func (r *req) mentionWaits(d *document) []dapi.DocWait {
	out := []dapi.DocWait{}
	for _, m := range r.w.mentions[d.id] {
		id, text := m.comment, m.text
		switch {
		case m.member == r.me.id:
			by := r.w.names[m.by]
			out = append(out, dapi.DocWait{Kind: dapi.DocWaitKind("mention"), CommentId: &id, By: &by, Comment: &text})
		case m.by == r.me.id:
			// the author: the mentioned member does not open the document — give him access or skip (docMentionSkip)
			if t := r.w.member[m.member]; t != nil && t.status != memberBlocked && r.w.accessToDoc(t, d).level == levelNone {
				by := t.name
				out = append(out, dapi.DocWait{Kind: dapi.DocWaitKind("mention"), CommentId: &id, By: &by, Comment: &text})
			}
		}
	}
	return out
}

// routeBrief is the status of the route for the list.
func (r *req) routeBrief(d *document) *dapi.DocRouteBrief {
	b := d.route
	if b == nil {
		return nil
	}
	out := &dapi.DocRouteBrief{CurrentStep: int64(b.current), Status: dapi.DocRouteBriefStatus(b.status)}
	if b.stepName != "" {
		n := b.stepName
		out.StepName = &n
	}
	if b.due != nil {
		setDate(&out.DueDate, *b.due)
	}
	return out
}

// summary is a row of the list of documents.
func (r *req) summary(d *document, rt rights) dapi.DocSummary {
	f := r.w.folders[d.folder]
	out := dapi.DocSummary{
		Id: d.id, FolderId: d.folder, Kind: dapi.DocSummaryKind(d.kind), Title: d.title, Owner: r.memberRef(d.owner),
		Status: dapi.DocSummaryStatus(d.status), Sensitivity: dapi.DocSummarySensitivity(d.sens), Version: int64(d.version),
		UpdatedAt: instant(d.updated), Links: decodeList[dapi.DocLink](d.links), My: r.my(d, rt, false), Route: r.routeBrief(d),
		Ocr: r.ocr(d),
	}
	if f != nil {
		out.FolderName = f.name
	}
	if d.pdfa {
		t := true
		out.PdfaCopy = &t
	}
	return out
}

// ocr is the state of the text layer of a scan: the stored object with the number of doubtful words.
func (r *req) ocr(d *document) *dapi.DocOcr {
	o := decodeObject[dapi.DocOcr](d.ocr)
	if o == nil {
		return nil
	}
	o.Doubtful = int64(r.w.ocrOpen[d.id])
	return o
}

// folderDTO is a folder with the rights of the member.
func (r *req) folderDTO(f *folder, a access) dapi.DocFolder {
	out := dapi.DocFolder{
		Id: f.id, Name: f.name, Icon: f.icon, Mode: dapi.DocFolderMode(f.mode), Owner: r.memberRef(f.owner),
		Revision: int64(f.revision), Sensitivity: dapi.DocFolderSensitivity(f.sens), Shares: []dapi.DocShareEntry{},
		Link: decodeObject[dapi.ObjectRef](f.linkRef), HasRouteTemplate: r.w.routeTpl[f.id],
	}
	if f.parent != uuid.Nil {
		p := f.parent
		out.ParentId = &p
	}
	if f.unit != uuid.Nil {
		u := f.unit
		out.OrgUnitId = &u
	}
	out.DocumentCount = int64(r.w.docCount(f.id))
	if a.level > 0 {
		l := dapi.DocFolderMyLevel(a.level.code())
		out.My.Level = &l
	}
	out.My.Create = a.level >= levelEdit
	out.My.Manage = a.level == levelManage
	if out.My.Manage || a.owner {
		out.Shares = r.shareEntries(f.id)
	}
	return out
}

// docCount is the number of the live documents directly in folder id.
func (w *world) docCount(id uuid.UUID) int {
	n := 0
	for _, d := range w.docs {
		if d.folder == id && d.status != statusArchived {
			n++
		}
	}
	return n
}

// pathNames are the names of the folders from the top down to the folder of d.
func (w *world) pathNames(f *folder) []string {
	out := []string{}
	for _, p := range w.path(f) {
		out = append(out, p.name)
	}
	return out
}

// sortedDocs are the documents ordered by the time of the last change, newest first.
func (w *world) sortedDocs() []*document {
	out := make([]*document, 0, len(w.docs))
	for _, d := range w.docs {
		out = append(out, d)
	}
	slices.SortFunc(out, func(a, b *document) int {
		if c := b.updated.Compare(a.updated); c != 0 {
			return c
		}
		return slices.Compare(a.id[:], b.id[:])
	})
	return out
}
