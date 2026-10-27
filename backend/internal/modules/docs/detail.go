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
	b := d.route
	if b == nil {
		return nil, nil
	}
	var (
		out     dapi.DocRoute
		project *uuid.UUID
		task    *uuid.UUID
		rules   []byte
		back    []byte
	)
	err := r.tx.QueryRow(ctx, `select id, version, started_by, started_at, status, current_step, project_id, task_id, rules, back
		from docs.routes where id = $1`, b.id).
		Scan(&out.Id, &out.Version, &out.StartedBy.MemberId, &out.StartedAt, &out.Status, &out.CurrentStep, &project, &task, &rules, &back)
	if err != nil {
		return nil, fmt.Errorf("docs: route: %w", err)
	}
	out.StartedBy = r.memberRef(out.StartedBy.MemberId)
	out.StartedAt = instant(out.StartedAt)
	if project != nil {
		out.Project = &dapi.ObjectRef{ModuleKey: "tasks", EntityType: "project", EntityId: *project}
	}
	if task != nil {
		out.Task = &dapi.ObjectRef{ModuleKey: "tasks", EntityType: "task", EntityId: *task}
	}
	if rl := decodeObject[map[string]bool](rules); rl != nil {
		out.Rules.CommentOnBack, out.Rules.Escalate, out.Rules.Lock, out.Rules.NotAuthor =
			(*rl)["commentOnBack"], (*rl)["escalate"], (*rl)["lock"], (*rl)["notAuthor"]
	}
	out.Back = decodeObject[struct {
		Comment *string `json:"comment,omitempty"`
		Name    string  `json:"name"`
	}](back)
	out.Steps, err = r.routeSteps(ctx, b.id)
	return &out, err
}

// routeSteps reads the steps of a route with their decisions and acknowledgements.
func (r *req) routeSteps(ctx context.Context, route uuid.UUID) ([]dapi.DocRouteStep, error) {
	rows, err := r.tx.Query(ctx, `select position, kind, name, mode, who, audience, days, status, due_at, external
		from docs.route_steps where route_id = $1 order by position`, route)
	if err != nil {
		return nil, fmt.Errorf("docs: route steps: %w", err)
	}
	type stepRow struct {
		pos      int
		kind     string
		name     string
		mode     string
		who      []uuid.UUID
		audience []byte
		days     int
		status   string
		due      *time.Time
		external []byte
	}
	steps, err := pgx.CollectRows(rows, func(x pgx.CollectableRow) (stepRow, error) {
		var s stepRow
		return s, x.Scan(&s.pos, &s.kind, &s.name, &s.mode, &s.who, &s.audience, &s.days, &s.status, &s.due, &s.external)
	})
	if err != nil {
		return nil, fmt.Errorf("docs: route steps: %w", err)
	}
	out := make([]dapi.DocRouteStep, 0, len(steps))
	for _, s := range steps {
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
		st.External = decodeObject[struct {
			Name        string  `json:"name"`
			PhoneMasked *string `json:"phoneMasked,omitempty"`
		}](s.external)
		drs, err := r.tx.Query(ctx, `select member_id, decision, method, comment, at from docs.route_decisions
			where route_id = $1 and position = $2 order by at`, route, s.pos)
		if err != nil {
			return nil, fmt.Errorf("docs: route decisions: %w", err)
		}
		decisions, err := pgx.CollectRows(drs, func(x pgx.CollectableRow) (dapi.DocRouteDecisionRec, error) {
			var (
				rec     dapi.DocRouteDecisionRec
				mid     uuid.UUID
				comment *string
			)
			err := x.Scan(&mid, &rec.Decision, &rec.Method, &comment, &rec.At)
			rec.Member, rec.Comment, rec.At = r.memberRef(mid), comment, instant(rec.At)
			return rec, err
		})
		if err != nil {
			return nil, fmt.Errorf("docs: route decisions: %w", err)
		}
		st.Decisions = decisions
		out = append(out, st)
	}
	return out, nil
}
