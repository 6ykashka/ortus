package docs

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	dapi "github.com/ortus/ortus-crm/backend/internal/api/docs"
)

// fileRow is a row of files.objects of a version of a document.
type fileRow struct {
	id      uuid.UUID
	key     string
	state   string
	mime    string // the declared type with the display name (files.EncodeMIME)
	bytes   int64
	sha256  string
	created time.Time
}

// decodeMIME splits a stored declared MIME type into the content type and the display name.
func decodeMIME(stored string) (contentType, fileName string) {
	ct, params, err := mime.ParseMediaType(stored)
	if err != nil {
		return stored, ""
	}
	return ct, params[keyName]
}

// encodeMIME stores the display name in the «name» parameter of the declared MIME type.
func encodeMIME(contentType, fileName string) string {
	if fileName == "" {
		return contentType
	}
	if v := mime.FormatMediaType(contentType, map[string]string{keyName: fileName}); v != "" {
		return v
	}
	return contentType
}

// fileStatus is File.status of files.objects.state.
func fileStatus(state string) dapi.FileStatus {
	switch state {
	case stateReady:
		return "ready"
	case "scanning":
		return "quarantined"
	case "rejected":
		return "rejected"
	}
	return "pending_upload"
}

// fileOf reads the file id from files.objects; false — none.
func (r *req) fileOf(ctx context.Context, id uuid.UUID) (fileRow, bool, error) {
	var f fileRow
	var sha []byte
	var bytes *int64
	err := r.tx.QueryRow(ctx, `select id, object_key, state, declared_mime, bytes, sha256, created_at from files.objects where id = $1`, id).
		Scan(&f.id, &f.key, &f.state, &f.mime, &bytes, &sha, &f.created)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return fileRow{}, false, nil
	case err != nil:
		return fileRow{}, false, fmt.Errorf("docs: file: %w", err)
	}
	if bytes != nil {
		f.bytes = *bytes
	}
	f.sha256 = hex.EncodeToString(sha)
	return f, true, nil
}

func fileDTO(f fileRow) dapi.File {
	ct, name := decodeMIME(f.mime)
	return dapi.File{Id: f.id, FileName: name, ContentType: ct, SizeBytes: f.bytes, Sha256: f.sha256, Status: fileStatus(f.state),
		CreatedAt: instant(f.created)}
}

// versionRow is a row of docs.versions.
type versionRow struct {
	number    int
	file      uuid.UUID
	size      int64
	sha       string
	source    string
	name      string
	authors   []uuid.UUID
	forcesave bool
	base      int
	engineKey string
	created   time.Time
}

const versionCols = `number, coalesce(file_id, ` + nilUUID + `), size_bytes, coalesce(sha256, ''), source, coalesce(name, ''), authors, forcesave,
	coalesce(base_number, 0), coalesce(engine_key, ''), created_at`

func scanVersion(r pgx.Row) (versionRow, error) {
	var v versionRow
	err := r.Scan(&v.number, &v.file, &v.size, &v.sha, &v.source, &v.name, &v.authors, &v.forcesave, &v.base, &v.engineKey, &v.created)
	return v, err
}

// version reads version n of the document; false — none.
func (r *req) version(ctx context.Context, doc uuid.UUID, n int) (versionRow, bool, error) {
	v, err := scanVersion(r.tx.QueryRow(ctx, `select `+versionCols+` from docs.versions where document_id = $1 and number = $2`, doc, n))
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return versionRow{}, false, nil
	case err != nil:
		return versionRow{}, false, fmt.Errorf("docs: version: %w", err)
	}
	return v, true, nil
}

func (r *req) versionDTO(v versionRow) dapi.DocVersion {
	out := dapi.DocVersion{Version: int64(v.number), SizeBytes: v.size, Source: dapi.DocVersionSource(v.source), Forcesave: v.forcesave,
		CreatedAt: instant(v.created), Authors: []dapi.DocMemberRef{}}
	for _, a := range v.authors {
		out.Authors = append(out.Authors, r.memberRef(a))
	}
	if v.file != uuid.Nil {
		f := v.file
		out.FileId = &f
	}
	if v.sha != "" {
		s := v.sha
		out.Sha256 = &s
	}
	if v.name != "" {
		n := v.name
		out.Name = &n
	}
	if v.base > 0 {
		b := int64(v.base)
		out.Base = &b
	}
	return out
}

// document is the card of a document (getDocument).
func (r *req) document(ctx context.Context, d *document, rt rights) (dapi.Document, error) {
	f := r.w.folders[d.folder]
	only := rt.onlyVersion > 0
	out := dapi.Document{
		Id: d.id, Kind: dapi.DocumentKind(d.kind), Title: d.title, FolderId: d.folder, Owner: r.memberRef(d.owner),
		Status: dapi.DocumentStatus(d.status), Sensitivity: dapi.DocumentSensitivity(d.sens), Mode: dapi.DocumentMode(d.mode),
		Version: int64(d.version), Revision: int64(d.revision), CreatedAt: instant(d.created), UpdatedAt: instant(d.updated),
		Links: decodeList[dapi.DocLink](d.links), Fields: decodeList[dapi.DocField](d.fields), Frozen: decodeObject[map[string]any](d.frozen),
		ProtectedRanges: decodeList[dapi.DocProtectedRange](d.protect), My: r.my(d, rt, true), Ocr: r.ocr(d),
		Authors: []dapi.DocMemberRef{}, Jobs: []dapi.DocJob{}, Shares: []dapi.DocShareEntry{}, TempGrants: []dapi.DocTempGrant{},
		Path: r.w.pathNames(f),
	}
	if f != nil {
		out.FolderName = f.name
	}
	flags(&out, d)
	vn := d.version
	if only {
		vn = rt.onlyVersion
	}
	if err := r.versionPart(ctx, d.id, vn, &out); err != nil {
		return out, err
	}
	if !only {
		if err := r.discussion(ctx, d, &out, rt); err != nil {
			return out, err
		}
		route, err := r.routeDTO(ctx, d)
		if err != nil {
			return out, err
		}
		out.Route = route
	}
	return out, nil
}

// flags sets the optional marks of a document: the PDF/A copy, the scan, the template.
func flags(out *dapi.Document, d *document) {
	if d.pdfa {
		t := true
		out.PdfaCopy = &t
	}
	if d.scan {
		t := true
		out.Scan = &t
	}
	if d.template != uuid.Nil {
		t := d.template.String()
		out.Template = &t
	}
}

// versionPart fills the authors and the file of version n.
func (r *req) versionPart(ctx context.Context, doc uuid.UUID, n int, out *dapi.Document) error {
	v, ok, err := r.version(ctx, doc, n)
	if err != nil || !ok {
		return err
	}
	for _, a := range v.authors {
		out.Authors = append(out.Authors, r.memberRef(a))
	}
	if v.file == uuid.Nil {
		return nil
	}
	fr, found, err := r.fileOf(ctx, v.file)
	if err != nil || !found {
		return err
	}
	fd := fileDTO(fr)
	size := fr.bytes
	out.File, out.Size = &fd, &size
	return nil
}

// discussion fills the counts of comments, the jobs, the access list and the temporary accesses: a temporary access of
// a route sees none of them.
func (r *req) discussion(ctx context.Context, d *document, out *dapi.Document, rt rights) error {
	var all, open int64
	if err := r.tx.QueryRow(ctx, `select count(*), count(*) filter (where not resolved) from docs.comments where document_id = $1`, d.id).
		Scan(&all, &open); err != nil {
		return fmt.Errorf("docs: comment count: %w", err)
	}
	out.CommentCount, out.OpenCommentCount = all, open
	jobs, err := r.jobsOf(ctx, d.id, 10)
	if err != nil {
		return err
	}
	out.Jobs = jobs
	if rt.share || rt.manage || rt.owner {
		out.Shares = r.shareEntries(d.id)
		for _, t := range d.tmp {
			g := dapi.DocTempGrant{Member: r.memberRef(t.member), Level: dapi.DocTempGrantLevel(t.level.code()), Why: t.why}
			if t.onlyVersion > 0 {
				v := int64(t.onlyVersion)
				g.OnlyVersion = &v
			}
			if t.keep {
				k := true
				g.Keep = &k
			}
			out.TempGrants = append(out.TempGrants, g)
		}
	}
	return nil
}

// routeDTO is the route of a document with its steps, decisions and acknowledgements; nil — none.
func (r *req) routeDTO(ctx context.Context, d *document) (*dapi.DocRoute, error) {
	if d.route == nil {
		return nil, nil
	}
	rd, err := r.loadRouteByID(ctx, d.id, d.route.id)
	if err != nil || rd == nil {
		return nil, err
	}
	out := dapi.DocRoute{Id: rd.id, Version: int64(rd.version), StartedBy: r.memberRef(rd.startedBy), StartedAt: instant(rd.startedAt),
		Status: dapi.DocRouteStatus(rd.status), CurrentStep: int64(rd.current), Steps: make([]dapi.DocRouteStep, 0, len(rd.steps))}
	if rd.project != uuid.Nil {
		out.Project = &dapi.ObjectRef{ModuleKey: "tasks", EntityType: "project", EntityId: rd.project}
	}
	if rd.task != uuid.Nil {
		out.Task = &dapi.ObjectRef{ModuleKey: "tasks", EntityType: "task", EntityId: rd.task}
	}
	out.Rules.CommentOnBack, out.Rules.Escalate, out.Rules.Lock, out.Rules.NotAuthor = rd.rules.CommentOnBack, rd.rules.Escalate, rd.rules.Lock, rd.rules.NotAuthor
	if rd.back != nil {
		out.Back = &struct {
			Comment *string `json:"comment,omitempty"`
			Name    string  `json:"name"`
		}{Name: rd.back.Name}
		if rd.back.Comment != "" {
			c := rd.back.Comment
			out.Back.Comment = &c
		}
	}
	for _, s := range rd.steps {
		st, err := r.stepDTO(ctx, rd, s)
		if err != nil {
			return nil, err
		}
		out.Steps = append(out.Steps, st)
	}
	return &out, nil
}

// stepDTO is a step of a route with its decisions, its acknowledgements and its customer.
func (r *req) stepDTO(ctx context.Context, rd *routeData, s *routeStep) (dapi.DocRouteStep, error) {
	st := dapi.DocRouteStep{Kind: dapi.DocRouteStepKind(s.kind), Name: s.name, Mode: dapi.DocRouteStepMode(s.mode), Days: int64(s.days),
		Status: dapi.DocRouteStepStatus(s.status), Who: []dapi.DocMemberRef{}, Decisions: []dapi.DocRouteDecisionRec{}}
	for _, w := range s.who {
		st.Who = append(st.Who, r.memberRef(w))
	}
	if a := decodeList[dapi.DocShareEntry](s.audience); len(a) > 0 {
		st.Audience = &a
	}
	if s.due != nil {
		setDate(&st.Due, dayOf(*s.due))
	}
	for _, d := range s.decisions {
		rec := dapi.DocRouteDecisionRec{Member: r.memberRef(d.member), Decision: dapi.DocRouteDecisionRecDecision(d.kind),
			Method: dapi.DocRouteDecisionRecMethod(d.method), At: instant(d.at)}
		if d.comment != "" {
			c := d.comment
			rec.Comment = &c
		}
		st.Decisions = append(st.Decisions, rec)
	}
	switch s.kind {
	case stepExternal:
		st.External = &struct {
			Name        string  `json:"name"`
			PhoneMasked *string `json:"phoneMasked,omitempty"`
		}{Name: s.ext.name}
		if m := maskPhone(s.ext.phone); m != "" {
			st.External.PhoneMasked = &m
		}
	case stepAck:
		done, err := r.stepDone(ctx, rd.doc, rd.version)
		if err != nil {
			return st, err
		}
		st.Done = &done
	}
	return st, nil
}
