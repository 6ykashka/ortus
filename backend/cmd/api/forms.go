package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	formsapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
	publicformsapi "github.com/ortus/ortus-crm/backend/internal/api/publicforms"
	"github.com/ortus/ortus-crm/backend/internal/modules/files"
	"github.com/ortus/ortus-crm/backend/internal/modules/forms"
	"github.com/ortus/ortus-crm/backend/internal/modules/knowledge"
	"github.com/ortus/ortus-crm/backend/internal/modules/tasks"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// newForms is the server of the tags Forms and PublicForms (W4.21, S4-20…S4-25): forms, drafts and immutable versions,
// responses, rules «задача», «в БЗ» and «уведомить», CSV, public links and the guest — one service over the tenant
// pools, the memberships of the control DB, the ports of tasks (W4.11) and of the knowledge base (W4.31) in the
// transaction of the response, the CRM objects of the answers (fleet, tasks), the index of the public links of the
// control DB (control 0009), the uploads of a guest through the module of files, the inbox and the clock of the
// application. The keys of the links come from FORMS_PUBLIC_LINK_KEY (publicLinkKeys).
func newForms(pools forms.Pools, ev *authz.Evaluator, control *pgxpool.Pool, getenv func(string) string, appEnv string, log *slog.Logger, now func() time.Time) (formsapi.StrictServerInterface, publicformsapi.StrictServerInterface, error) {
	keys, err := publicLinkKeys(getenv, appEnv, log)
	if err != nil {
		return nil, nil, err
	}
	uploads, err := formUploadsOf(pools, ev, getenv, log)
	if err != nil {
		return nil, nil, err
	}
	var db forms.ControlDB
	if control != nil {
		db = control
	}
	taskSvc := &tasks.Service{Pools: pools, Authz: ev, Directory: tasks.ControlDirectory{DB: control}, Audience: inbox.AuthzAudience{E: ev}, Now: now}
	kbSvc := &knowledge.Service{Pools: pools, Memberships: knowledge.PGMemberships{DB: control}, Now: now}
	s := &forms.Service{
		Pools: pools, Directory: forms.ControlDirectory{DB: db}, Tasks: formTasks{S: taskSvc}, Knowledge: formKnowledge{S: kbSvc},
		Objects: formObjects{pools: pools, ev: ev, hidden: tasks.HiddenTasks{Pools: pools, Authz: ev}, trips: newPoolTrips(pools, now)},
		Links:   forms.PGLinks{DB: db}, Uploads: uploads, Keys: keys, Audience: inbox.AuthzAudience{E: ev}, Now: now,
	}
	return forms.Server{S: s}, forms.PublicServer{S: s}, nil
}

// Environment of the keys of the public links (deploy/compose/.env.example).
const (
	envLinkKey        = "FORMS_PUBLIC_LINK_KEY"
	envLinkKeyVersion = "FORMS_PUBLIC_LINK_KEY_VERSION"
	envLinkKeysBefore = "FORMS_PUBLIC_LINK_PREVIOUS_KEYS"
	linkKeyMin        = 32
	linkKeyVersionMax = 32767
)

// publicLinkKeys are the keys of the public links (Q-W4.05-19): FORMS_PUBLIC_LINK_KEY — base64 of at least 32 bytes —
// with its version FORMS_PUBLIC_LINK_KEY_VERSION (1 by default; a token is derived again with the version of its link)
// and, after a rotation, the former keys FORMS_PUBLIC_LINK_PREVIOUS_KEYS «<version>:<base64>[,…]» (return 1): the links
// of a former version keep their tokens, new links and nonces take the current key. Without the key a dev or e2e
// stand derives a fixed key of its own and prod has no public links (503), both with a warning; a short or malformed
// key stops the start.
func publicLinkKeys(getenv func(string) string, appEnv string, log *slog.Logger) (forms.Keys, error) {
	raw := strings.TrimSpace(getenv(envLinkKey))
	if raw == "" && strings.TrimSpace(getenv(envLinkKeysBefore)) != "" {
		return forms.Keys{}, fmt.Errorf("%s without %s: the former keys need the current one", envLinkKeysBefore, envLinkKey)
	}
	if raw == "" {
		if appEnv == envProd {
			log.Warn("api: " + envLinkKey + " is not set — public links of forms answer 503 dependency_unavailable")
			return forms.Keys{}, nil
		}
		log.Warn("api: " + envLinkKey + " is not set — public links of forms use the fixed key of the stand, not for prod")
		dev := sha256.Sum256([]byte("ortus.forms.public-link.dev-stand"))
		return forms.Keys{Current: 1, ByVer: map[int][]byte{1: dev[:]}}, nil
	}
	key, err := linkKey(envLinkKey, raw)
	if err != nil {
		return forms.Keys{}, err
	}
	ver := 1
	if v := strings.TrimSpace(getenv(envLinkKeyVersion)); v != "" {
		if ver, err = linkKeyVersion(v); err != nil {
			return forms.Keys{}, fmt.Errorf("%s: %w", envLinkKeyVersion, err)
		}
	}
	keys := forms.Keys{Current: ver, ByVer: map[int][]byte{ver: key}}
	if err := previousLinkKeys(keys, getenv(envLinkKeysBefore)); err != nil {
		return forms.Keys{}, err
	}
	return keys, nil
}

// previousLinkKeys adds the former keys of raw («<version>:<base64>[,…]», FORMS_PUBLIC_LINK_PREVIOUS_KEYS) to keys.
func previousLinkKeys(keys forms.Keys, raw string) error {
	for item := range strings.SplitSeq(raw, ",") {
		if item = strings.TrimSpace(item); item == "" {
			continue
		}
		v, b64, ok := strings.Cut(item, ":")
		if !ok {
			return fmt.Errorf("%s: «<version>:<base64>» separated by commas, got %q", envLinkKeysBefore, item)
		}
		n, err := linkKeyVersion(strings.TrimSpace(v))
		if err != nil {
			return fmt.Errorf("%s: %w", envLinkKeysBefore, err)
		}
		if _, taken := keys.ByVer[n]; taken {
			return fmt.Errorf("%s: the version %d is given twice (or is the current one)", envLinkKeysBefore, n)
		}
		if keys.ByVer[n], err = linkKey(envLinkKeysBefore, strings.TrimSpace(b64)); err != nil {
			return err
		}
	}
	return nil
}

// linkKey decodes a key of the public links of the variable env: base64 of at least 32 bytes.
func linkKey(env, raw string) ([]byte, error) {
	key, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, fmt.Errorf("%s: not base64: %w", env, err)
	}
	if len(key) < linkKeyMin {
		return nil, fmt.Errorf("%s: at least %d bytes, got %d", env, linkKeyMin, len(key))
	}
	return key, nil
}

// linkKeyVersion parses the version of a key of the public links: 1…32767 (public_form_links.key_version smallint).
func linkKeyVersion(v string) (int, error) {
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 || n > linkKeyVersionMax {
		return 0, fmt.Errorf("a version 1…%d, got %q", linkKeyVersionMax, v)
	}
	return n, nil
}

// formParent is the parent «forms/form» of the files of the answers (purpose form_attachment, W4.21): its unit and its
// owner. Those who see the form (forms.read) upload to it; a file of it is read only when the Hider does not close that
// file (return 2, Q-W4.00-forms-9: hiddenFormFiles — its uploader and those who read the answers holding it).
func formParent() files.ParentKind {
	return files.ParentKind{Module: "forms", Entity: "form", ReadAction: "forms.read", Purposes: []files.Purpose{files.PurposeFormAttachment},
		Rows: `select fm.org_unit_id as unit_id, null::uuid as project_id, fm.owner_id as person_a, null::uuid as person_b,
       fm.name as title from forms.forms fm where fm.id = ` + files.IDPlaceholder + `
   and (` + files.FilePlaceholder + ` is null or ` + files.FilePlaceholder + ` <> all(` + files.HiddenPlaceholder + `))`}
}

// hiddenFormFiles closes to the subject the files of the answers he does not read (forms.Service.HiddenFiles): they are
// out of listFiles and answer 404, while his uploads to the form stay open to him.
type hiddenFormFiles struct{ S *forms.Service }

var _ files.Hider = hiddenFormFiles{}

// Closed implements files.Hider.
func (h hiddenFormFiles) Closed(ctx context.Context, tc tenantctx.TenantContext) (files.Closed, error) {
	ids, err := h.S.HiddenFiles(ctx, tc)
	if err != nil {
		return files.Closed{}, err
	}
	if ids == nil {
		ids = []uuid.UUID{}
	}
	return files.Closed{Hidden: ids, Continued: []uuid.UUID{}}, nil
}

// formFilesAccess is the module of forms as the module of files asks it: the responses a member reads, by his grants and
// the CRM objects he sees (formObjects).
func formFilesAccess(pools forms.Pools, ev *authz.Evaluator, now func() time.Time) hiddenFormFiles {
	objects := formObjects{pools: pools, ev: ev, hidden: tasks.HiddenTasks{Pools: pools, Authz: ev}, trips: newPoolTrips(pools, now)}
	return hiddenFormFiles{S: &forms.Service{Pools: pools, Objects: objects, Now: now}}
}

// formUploadsOf is the port of the uploads of a guest: a service of files with the parent «forms/form» over the object
// storage of S3_* (without S3_ENDPOINT the uploads of a guest answer 503).
func formUploadsOf(pools forms.Pools, ev *authz.Evaluator, getenv func(string) string, log *slog.Logger) (formUploads, error) {
	parents, err := files.NewParents(formParent())
	if err != nil {
		return formUploads{}, err
	}
	svc := &files.Service{Pools: pools, Authz: ev, Parents: parents}
	cfg, ok, err := storage.ConfigFromEnv(getenv)
	switch {
	case err != nil:
		return formUploads{}, fmt.Errorf("object storage: %w", err)
	case ok:
		s3, err := storage.NewS3(cfg, nil, nil)
		if err != nil {
			return formUploads{}, err
		}
		svc.Store = s3
	default:
		log.Debug("api: no object storage — the uploads of the guests of forms answer 503")
	}
	return formUploads{S: svc}, nil
}

// formUploads adapts the module of files to forms.Uploads: the module of forms has checked the capability (the nonce
// of the guest), the file is uploaded on behalf of the guest (the actor of the nonce) with the capability context —
// no grant of a member is involved.
type formUploads struct{ S *files.Service }

var _ forms.Uploads = formUploads{}

func guestContext(tenant, actor uuid.UUID) tenantctx.TenantContext {
	return tenantctx.TenantContext{TenantID: tenant, PersonID: actor, Owner: true}
}

// Initiate implements forms.Uploads.
func (u formUploads) Initiate(ctx context.Context, tenant, actor, form uuid.UUID, x forms.Upload) (publicformsapi.UploadTicket, error) {
	t, err := u.S.Initiate(ctx, guestContext(tenant, actor), files.Upload{FileName: x.FileName, ContentType: x.ContentType,
		SizeBytes: x.SizeBytes, SHA256: x.SHA256, Purpose: files.PurposeFormAttachment, Owner: files.Ref{Module: "forms", Entity: "form", ID: form}})
	if err != nil {
		return publicformsapi.UploadTicket{}, err
	}
	return publicformsapi.UploadTicket{UploadId: t.UploadID, FileId: t.FileID, UploadUrl: t.URL, Method: "PUT",
		RequiredContentType: t.ContentType, RequiredSha256: t.SHA256, ExpiresAt: t.ExpiresAt, MaxBytes: t.MaxBytes}, nil
}

// Complete implements forms.Uploads.
func (u formUploads) Complete(ctx context.Context, tenant, actor, upload uuid.UUID, sha string) (publicformsapi.File, error) {
	f, err := u.S.Complete(ctx, guestContext(tenant, actor), upload, sha)
	if err != nil {
		return publicformsapi.File{}, err
	}
	return guestFile(f), nil
}

// Status implements forms.Uploads.
func (u formUploads) Status(ctx context.Context, tenant, actor, upload uuid.UUID) (publicformsapi.File, error) {
	tc := guestContext(tenant, actor)
	s, err := u.S.Session(ctx, tc, upload)
	if err != nil {
		return publicformsapi.File{}, err
	}
	f, err := u.S.File(ctx, tc, s.FileID)
	if err != nil {
		return publicformsapi.File{}, err
	}
	return guestFile(f), nil
}

// guestFile is a file of a guest without the warning of duplicates: earlier files of the tenant are not his business.
func guestFile(f files.File) publicformsapi.File {
	return publicformsapi.File{Id: f.ID, FileName: f.FileName, ContentType: f.ContentType, SizeBytes: f.SizeBytes, Sha256: f.SHA256,
		Status: publicformsapi.FileStatus(f.Status), CreatedAt: f.CreatedAt}
}

// formTasks adapts the port of the module of tasks (tasks/forms_port.go) to forms.Tasks.
type formTasks struct{ S *tasks.Service }

var _ forms.Tasks = formTasks{}

// CreateFormTask implements forms.Tasks.
func (a formTasks) CreateFormTask(ctx context.Context, tx pgx.Tx, tenant uuid.UUID, t forms.FormTask) (forms.TaskResult, error) {
	r, err := a.S.CreateFormTask(ctx, tx, tenant, tasks.FormTask{Project: t.Project, Author: t.Author, Assignee: t.Assignee,
		AuthorOwner: t.AuthorOwner, AuthorName: t.AuthorName, Title: t.Title, Description: t.Description, Response: t.Response, Origin: t.Origin})
	return forms.TaskResult{ID: r.ID, Key: r.Key, Status: r.Status, Assigned: r.Assigned, Refused: r.Refused}, err
}

// MayCreate implements forms.Tasks.
func (a formTasks) MayCreate(ctx context.Context, tx pgx.Tx, tenant, member uuid.UUID, owner bool, project uuid.UUID) (bool, error) {
	return a.S.MayCreate(ctx, tx, tenant, member, owner, project)
}

// Keys implements forms.Tasks.
func (a formTasks) Keys(ctx context.Context, tx pgx.Tx, _ uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]string, error) {
	return a.S.FormTaskKeys(ctx, tx, ids)
}

// formKnowledge adapts the port of the knowledge base (knowledge/forms_port.go) to forms.Knowledge.
type formKnowledge struct{ S *knowledge.Service }

var _ forms.Knowledge = formKnowledge{}

// Nodes implements forms.Knowledge.
func (a formKnowledge) Nodes(ctx context.Context, tx pgx.Tx, tenant uuid.UUID, v forms.Viewer, ids []uuid.UUID) (map[uuid.UUID]forms.KBNode, error) {
	ns, err := a.S.FormNodes(ctx, tx, tenant, v.Member, v.Owner, ids)
	if err != nil {
		return nil, err
	}
	out := make(map[uuid.UUID]forms.KBNode, len(ns))
	for id, n := range ns {
		x := forms.KBNode{ID: n.ID, Title: n.Title, Visible: n.Visible, AllEmployees: n.AllEmployees}
		for _, t := range n.Tables {
			x.Tables = append(x.Tables, forms.KBTable{ID: t.ID, Title: t.Title, Columns: t.Columns})
		}
		out[id] = x
	}
	return out, nil
}

// Write implements forms.Knowledge.
func (a formKnowledge) Write(ctx context.Context, tx pgx.Tx, tenant uuid.UUID, rec forms.KBRecord) (forms.KBResult, error) {
	lines := make([]knowledge.FormLine, 0, len(rec.Lines))
	for _, l := range rec.Lines {
		lines = append(lines, knowledge.FormLine{Name: l.Name, Value: l.Value})
	}
	r, err := a.S.FormWrite(ctx, tx, tenant, knowledge.FormRecord{Author: rec.Author.Member, AuthorOwner: rec.Author.Owner,
		AuthorName: rec.AuthorName, Node: rec.Node, Table: rec.Table, Bottom: rec.Bottom, Head: rec.Head, Lines: lines, Cells: rec.Cells,
		Form: rec.Form, Response: rec.Response, Version: rec.Version, At: rec.At})
	return forms.KBResult{Text: r.Text, Refused: r.Refused}, err
}

// formObjects are the CRM objects of the answers and of the responses by the rights of the member (as MSW
// optionsOf/subjectOf): the vehicles of fleet.vehicles.read, the trips of fleet.trips.read without those the pool closes
// to him (W2.57), the tasks he reads (TP-03); the objects of repairs come with the module of stage 6.
type formObjects struct {
	pools  forms.Pools
	ev     *authz.Evaluator
	hidden tasks.HiddenTasks
	trips  poolTrips
}

var _ forms.Objects = formObjects{}

// Kinds of the objects of the answers (FormQuestion.refKind) and their entities.
const (
	moduleFleet = "fleet"
	refVehicle  = "vehicle"
	refTrip     = "trip"
	refTask     = "task"
)

// objectRow is an object with its label and hint.
type objectRow struct {
	ref         formsapi.ObjectRef
	label, hint string
}

// Options implements forms.Objects.
func (o formObjects) Options(ctx context.Context, tc tenantctx.TenantContext, kind, q string) ([]formsapi.FormFieldOption, error) {
	rows, err := o.objects(ctx, tc, kind, nil, true)
	if err != nil {
		return nil, err
	}
	q = strings.ToLower(strings.TrimSpace(q))
	out := []formsapi.FormFieldOption{}
	for _, r := range rows {
		if q != "" && !strings.Contains(strings.ToLower(r.label), q) {
			continue
		}
		opt := formsapi.FormFieldOption{Ref: r.ref, Label: r.label}
		if r.hint != "" {
			opt.Hint = new(r.hint)
		}
		out = append(out, opt)
	}
	return out, nil
}

// Labels implements forms.Objects: the label of a response object («Рейс Р-196», «Задача LOG-12», the name of a
// vehicle).
func (o formObjects) Labels(ctx context.Context, tc tenantctx.TenantContext, refs []formsapi.ObjectRef) (map[formsapi.ObjectRef]string, error) {
	out := map[formsapi.ObjectRef]string{}
	byKind := map[string][]uuid.UUID{}
	for _, r := range refs {
		if k := kindOfRef(r); k != "" {
			byKind[k] = append(byKind[k], r.EntityId)
		}
	}
	for kind, ids := range byKind {
		rows, err := o.objects(ctx, tc, kind, ids, false)
		if err != nil {
			return nil, err
		}
		for _, r := range rows {
			out[r.ref] = r.label
		}
	}
	return out, nil
}

// Missing implements forms.Objects: the trips of refs with no row in fleet.trips of the tenant (the past trips of the
// prototype the responses of the seed are about, W4.21 return 4), whatever the rights of tc.
func (o formObjects) Missing(ctx context.Context, tc tenantctx.TenantContext, refs []formsapi.ObjectRef) ([]formsapi.ObjectRef, error) {
	var trips []uuid.UUID
	for _, r := range refs {
		if kindOfRef(r) == refTrip {
			trips = append(trips, r.EntityId)
		}
	}
	if len(trips) == 0 {
		return nil, nil
	}
	pool, err := o.pools.For(ctx, tc.TenantID)
	if err != nil {
		return nil, err
	}
	rows, err := pool.Query(ctx, `select id from fleet.trips where id = any($1)`, trips)
	if err != nil {
		return nil, fmt.Errorf("forms: trips: %w", err)
	}
	found, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return nil, fmt.Errorf("forms: trips: %w", err)
	}
	var out []formsapi.ObjectRef
	for _, r := range refs {
		if kindOfRef(r) == refTrip && !slices.Contains(found, r.EntityId) && !slices.Contains(out, r) {
			out = append(out, r)
		}
	}
	return out, nil
}

// kindOfRef is the kind of an object reference ("" — not an object of the answers).
func kindOfRef(r formsapi.ObjectRef) string {
	switch {
	case r.ModuleKey == moduleFleet && r.EntityType == refVehicle:
		return refVehicle
	case r.ModuleKey == moduleFleet && r.EntityType == refTrip:
		return refTrip
	case r.ModuleKey == "tasks" && r.EntityType == refTask:
		return refTask
	}
	return ""
}

// objects are the objects of kind tc sees (ids — only those; nil — all), labelled for the options or for a subject.
func (o formObjects) objects(ctx context.Context, tc tenantctx.TenantContext, kind string, ids []uuid.UUID, options bool) ([]objectRow, error) {
	pool, err := o.pools.For(ctx, tc.TenantID)
	if err != nil {
		return nil, err
	}
	switch kind {
	case refVehicle:
		// An archived vehicle is no choice (return 1); the subject of an old response keeps its label.
		from := `fleet.vehicles v`
		if options {
			from = `(select * from fleet.vehicles where archived_at is null) v`
		}
		return o.scoped(ctx, pool, tc, "fleet.vehicles.read", authz.Columns{Unit: "v.unit_id"},
			`select v.id, coalesce(v.display_name, v.plate), v.plate from `+from, "v.id", ids,
			func(id uuid.UUID, a, b string) objectRow {
				return objectRow{ref: formsapi.ObjectRef{ModuleKey: moduleFleet, EntityType: refVehicle, EntityId: id}, label: a, hint: b}
			})
	case refTrip:
		closed, err := o.trips.Hidden(ctx, tc)
		if err != nil {
			return nil, err
		}
		rows, err := o.scoped(ctx, pool, tc, "fleet.trips.read", authz.Columns{Unit: "t.unit_id", Persons: []string{"t.driver_person_id"}},
			`select t.id, 'Рейс ' || t.number, coalesce(t.title, '') from fleet.trips t`, "t.id", ids,
			func(id uuid.UUID, a, b string) objectRow {
				return objectRow{ref: formsapi.ObjectRef{ModuleKey: moduleFleet, EntityType: refTrip, EntityId: id}, label: a, hint: b}
			})
		return without(rows, closed), err
	case refTask:
		return o.tasksOf(ctx, pool, tc, ids, options)
	}
	return nil, nil
}

// without drops the rows of the ids closed.
func without(rows []objectRow, closed []uuid.UUID) []objectRow {
	out := rows[:0]
	for _, r := range rows {
		if !slices.Contains(closed, r.ref.EntityId) {
			out = append(out, r)
		}
	}
	return out
}

// scoped reads the rows of sql (id, label, hint) tc may read with action over the columns c (ids — only those).
func (o formObjects) scoped(ctx context.Context, pool *pgxpool.Pool, tc tenantctx.TenantContext, action string, c authz.Columns, sql, idCol string, ids []uuid.UUID, row func(uuid.UUID, string, string) objectRow) ([]objectRow, error) {
	args := []any{}
	where := "true"
	if ids != nil {
		args = append(args, ids)
		where = idCol + " = any($1)"
	}
	p, err := o.ev.ScopeQuery(ctx, tc, action, c, len(args))
	if err != nil {
		return nil, err
	}
	rows, err := pool.Query(ctx, sql+" where "+where+" and "+p.SQL, append(args, p.Args...)...)
	if err != nil {
		return nil, fmt.Errorf("forms: objects: %w", err)
	}
	defer rows.Close()
	var out []objectRow
	for rows.Next() {
		var (
			id   uuid.UUID
			a, b string
		)
		if err := rows.Scan(&id, &a, &b); err != nil {
			return nil, fmt.Errorf("forms: objects: %w", err)
		}
		out = append(out, row(id, a, b))
	}
	return out, rows.Err()
}

// tasksOf are the live tasks tc reads: «KEY название» for the options, «Задача KEY» for a subject.
func (o formObjects) tasksOf(ctx context.Context, pool *pgxpool.Pool, tc tenantctx.TenantContext, ids []uuid.UUID, options bool) ([]objectRow, error) {
	closed, err := o.hidden.Hidden(ctx, tc)
	if err != nil {
		return nil, err
	}
	sql := `select t.id, coalesce(t.legacy_key, p.key || '-' || t.number), t.title from tasks.tasks t
		join tasks.projects p on p.id = t.project_id where t.deleted_at is null and t.id <> all($1)`
	args := []any{closed}
	if ids != nil {
		sql += " and t.id = any($2)"
		args = append(args, ids)
	}
	rows, err := pool.Query(ctx, sql, args...)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return nil, err
		}
		return nil, fmt.Errorf("forms: tasks: %w", err)
	}
	defer rows.Close()
	var out []objectRow
	for rows.Next() {
		var (
			id         uuid.UUID
			key, title string
		)
		if err := rows.Scan(&id, &key, &title); err != nil {
			return nil, fmt.Errorf("forms: tasks: %w", err)
		}
		label := "Задача " + key
		if options {
			label = key + " " + title
		}
		out = append(out, objectRow{ref: formsapi.ObjectRef{ModuleKey: "tasks", EntityType: refTask, EntityId: id}, label: label})
	}
	return out, rows.Err()
}
