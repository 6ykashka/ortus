//go:build integration

package docs

import (
	"testing"

	"github.com/google/uuid"

	dapi "github.com/ortus/ortus-crm/backend/internal/api/docs"
)

// grantRole writes a role of the template (once) and its assignment to a person on a folder or a document.
func grantRole(t *testing.T, person uuid.UUID, template string, actions []string, kind string, ref uuid.UUID) {
	t.Helper()
	var role uuid.UUID
	err := superA.QueryRow(t.Context(), `select id from access.roles where template_key = $1 and archived_at is null`, template).Scan(&role)
	if err != nil {
		role = uuid.New()
		if err := exec(t.Context(), `insert into access.roles (id, name, kind, template_key) values ($1, $2, 'system', $3)`, role, "docs-"+template+"-"+role.String()[:8], template); err != nil {
			t.Fatal(err)
		}
		if err := exec(t.Context(), `insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`, role, actions, person); err != nil {
			t.Fatal(err)
		}
	}
	if err := exec(t.Context(), `insert into access.role_assignments (principal_kind, principal_id, role_id, role_version, scope_kind, scope_ref,
		valid, granted_by) values ('person', $1, $2, 1, $3, $4, tstzrange('2026-09-01 00:00+03', null), $1)`, person, role, kind, nullID(ref)); err != nil {
		t.Fatal(err)
	}
}

var (
	editorActions = []string{"docs.read", "docs.comment", "docs.suggest", "docs.create", "docs.update", "docs.convert"}
	readerActions = []string{"docs.read"}
)

// newFolder is a folder of the business owner with a unique name.
func newFolder(t *testing.T, name string) uuid.UUID {
	t.Helper()
	return seedFolder(t, name+" "+uuid.NewString()[:6], uuid.Nil, personOf(t, "a.owner"), modeInherit)
}

// An editor of a folder creates a document, a stranger neither sees nor opens it, a reader opens it but does not edit
// (docCreate, docsView, docRights).
func TestCreateListAndOpen(t *testing.T) { //nolint:gocyclo,paralleltest // a scenario of one story: the steps share the data and run in order
	ownerCtx, ownerTC := as(t, "a.owner")
	editor := personOf(t, "a.manager-msk1")
	folder := newFolder(t, "Приказы")
	grantRole(t, editor, templateEditor, editorActions, scopeFolder, folder)

	editorCtx, editorTC := as(t, "a.manager-msk1")
	doc, err := svc.CreateDocument(editorCtx, editorTC, dapi.DocCreate{Kind: dapi.DocCreateKindText, Title: "  Приказ № 1 ", FolderId: folder})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if doc.Title != "Приказ № 1" || doc.Version != 1 || doc.Status != dapi.DocumentStatusDraft || doc.Owner.MemberId != editor {
		t.Fatalf("document %+v", doc)
	}
	if doc.My.Level == nil || *doc.My.Level != dapi.DocMyLevelManage || !doc.My.Can.Edit || doc.My.Can.ShareExternal {
		t.Fatalf("my %+v level %v, want the owner of the document: manage, no external link", doc.My.Can, doc.My.Level)
	}
	if got, err := svc.Document(ownerCtx, ownerTC, doc.Id); err != nil || got.Id != doc.Id {
		t.Fatalf("owner opens: %v", err)
	}
	strangerCtx, strangerTC := as(t, "a.manager-msk2")
	_, err = svc.Document(strangerCtx, strangerTC, doc.Id)
	wantCode(t, err, "not_found")
	list, err := svc.Documents(strangerCtx, strangerTC, ListQuery{})
	if err != nil {
		t.Fatal(err)
	}
	for _, it := range list.Items {
		if it.Id == doc.Id {
			t.Fatalf("the stranger sees %q in the list", it.Title)
		}
	}
	grantRole(t, personOf(t, "a.manager-msk2"), templateReader, readerActions, scopeFolder, folder)
	_, err = svc.CreateDocument(strangerCtx, strangerTC, dapi.DocCreate{Kind: dapi.DocCreateKindText, Title: "Нельзя", FolderId: folder})
	wantCode(t, err, "forbidden_action")
	got, err := svc.Document(strangerCtx, strangerTC, doc.Id)
	if err != nil || got.My.Level == nil || *got.My.Level != dapi.DocMyLevelView || got.My.Can.Edit {
		t.Fatalf("reader card: %v %+v", err, got.My)
	}
	list, err = svc.Documents(strangerCtx, strangerTC, ListQuery{Filter: "shared"})
	if err != nil || list.Counts.Shared < 1 {
		t.Fatalf("list of the reader: %v counts %+v, want the document shared with him", err, list.Counts)
	}
}

// The validation of a new document (docCreate): the title, the folder, the files of a PDF.
func TestCreateValidation(t *testing.T) { //nolint:paralleltest // the tests share the documents and the people of the fixtures and run in order
	ctx, tc := as(t, "a.owner")
	folder := newFolder(t, "Валидация")
	_, err := svc.CreateDocument(ctx, tc, dapi.DocCreate{Kind: dapi.DocCreateKindText, Title: "а", FolderId: folder})
	wantCode(t, err, "validation_failed")
	_, err = svc.CreateDocument(ctx, tc, dapi.DocCreate{Kind: dapi.DocCreateKindText, Title: "Название", FolderId: uuid.New()})
	wantCode(t, err, "not_found")
	_, err = svc.CreateDocument(ctx, tc, dapi.DocCreate{Kind: dapi.DocCreateKindPdf, Title: "Без файлов", FolderId: folder})
	wantCode(t, err, "validation_failed")
}

// The function «Водитель» never opens a finance document, whatever the lists say (AUTH-03); the list hides it.
func TestDriverFinance(t *testing.T) { //nolint:paralleltest // the tests share the documents and the people of the fixtures and run in order
	ownerCtx, ownerTC := as(t, "a.owner")
	folder := newFolder(t, "Финансы")
	if err := exec(t.Context(), `update docs.folders set sensitivity = 'finance' where id = $1`, folder); err != nil {
		t.Fatal(err)
	}
	doc := seedDoc(t, folder, ownerTC.PersonID, "Начисления", "sheet")
	if err := exec(t.Context(), `insert into docs.shares (folder_id, who, level) values ($1, 'all', 'manage')`, folder); err != nil {
		t.Fatal(err)
	}
	driverCtx, driverTC := as(t, "a.driver-msk1")
	_, err := svc.Document(driverCtx, driverTC, doc)
	wantCode(t, err, "function_blocked")
	list, err := svc.Documents(driverCtx, driverTC, ListQuery{})
	if err != nil {
		t.Fatal(err)
	}
	for _, it := range list.Items {
		if it.Id == doc {
			t.Fatal("the driver sees a finance document in the list")
		}
	}
	if _, err := svc.Document(ownerCtx, ownerTC, doc); err != nil {
		t.Fatalf("owner: %v", err)
	}
}

// Rename: If-Match, the lock of a route, the label pdn (updateDocument — docRename).
func TestUpdateDocument(t *testing.T) { //nolint:paralleltest // the tests share the documents and the people of the fixtures and run in order
	ctx, tc := as(t, "a.owner")
	folder := newFolder(t, "Переименование")
	doc, err := svc.CreateDocument(ctx, tc, dapi.DocCreate{Kind: dapi.DocCreateKindText, Title: "Было", FolderId: folder})
	if err != nil {
		t.Fatal(err)
	}
	title := "Стало"
	got, err := svc.UpdateDocument(ctx, tc, doc.Id, etag(doc.Revision), dapi.DocPatch{Title: &title})
	if err != nil || got.Title != "Стало" || got.Revision != doc.Revision+1 {
		t.Fatalf("rename: %v %+v", err, got)
	}
	_, err = svc.UpdateDocument(ctx, tc, doc.Id, etag(doc.Revision), dapi.DocPatch{Title: &title})
	wantCode(t, err, "revision_mismatch")
	if err := exec(t.Context(), `update docs.documents set status = 'in_route' where id = $1`, doc.Id); err != nil {
		t.Fatal(err)
	}
	_, err = svc.UpdateDocument(ctx, tc, doc.Id, etag(got.Revision), dapi.DocPatch{Title: &title})
	wantCode(t, err, "document_locked")
}

// Move: «Документ уже в этой папке», the right in the target, dryRun answers who loses access (docMove).
func TestMoveDocument(t *testing.T) { //nolint:gocyclo,paralleltest // a scenario of one story: the steps share the data and run in order
	ctx, tc := as(t, "a.owner")
	from, to, closed := newFolder(t, "Откуда"), newFolder(t, "Куда"), newFolder(t, "Закрытая")
	viewer := personOf(t, "a.manager-msk1")
	if err := exec(t.Context(), `insert into docs.shares (folder_id, who, ref_id, level) values ($1, 'member', $2, 'view')`, from, viewer); err != nil {
		t.Fatal(err)
	}
	doc, err := svc.CreateDocument(ctx, tc, dapi.DocCreate{Kind: dapi.DocCreateKindText, Title: "Переезд", FolderId: from})
	if err != nil {
		t.Fatal(err)
	}
	_, err = svc.MoveDocument(ctx, tc, doc.Id, dapi.DocMove{FolderId: from})
	wantCode(t, err, "validation_failed")
	dry := true
	res, err := svc.MoveDocument(ctx, tc, doc.Id, dapi.DocMove{FolderId: to, DryRun: &dry})
	if err != nil || res.Applied || len(res.Impact.Lose) != 1 || res.Impact.Lose[0].Member.MemberId != viewer {
		t.Fatalf("dryRun: %v %+v, want not applied and the viewer losing access", err, res)
	}
	if got, _ := svc.Document(ctx, tc, doc.Id); got.FolderId != from {
		t.Fatal("dryRun moved the document")
	}
	res, err = svc.MoveDocument(ctx, tc, doc.Id, dapi.DocMove{FolderId: to})
	if err != nil || !res.Applied || res.Document == nil || res.Document.FolderId != to {
		t.Fatalf("move: %v %+v", err, res)
	}
	// an editor of the document without a right in the target folder
	editorCtx, editorTC := as(t, "a.manager-msk2")
	other, err := svc.CreateDocument(ctx, tc, dapi.DocCreate{Kind: dapi.DocCreateKindText, Title: "Чужой", FolderId: from})
	if err != nil {
		t.Fatal(err)
	}
	if err := exec(t.Context(), `insert into docs.shares (document_id, who, ref_id, level) values ($1, 'member', $2, 'edit')`, other.Id, editorTC.PersonID); err != nil {
		t.Fatal(err)
	}
	_, err = svc.MoveDocument(editorCtx, editorTC, other.Id, dapi.DocMove{FolderId: closed})
	wantCode(t, err, "not_found") // a folder the member does not see is not revealed
	if err := exec(t.Context(), `insert into docs.shares (folder_id, who, ref_id, level) values ($1, 'member', $2, 'view')`, closed, editorTC.PersonID); err != nil {
		t.Fatal(err)
	}
	_, err = svc.MoveDocument(editorCtx, editorTC, other.Id, dapi.DocMove{FolderId: closed})
	wantCode(t, err, "forbidden_action")
}

// Archive and restore (archiveDocument, restoreDocument): the status before the archive comes back.
func TestArchiveAndRestore(t *testing.T) { //nolint:paralleltest // the tests share the documents and the people of the fixtures and run in order
	ctx, tc := as(t, "a.owner")
	folder := newFolder(t, "Архив")
	doc, err := svc.CreateDocument(ctx, tc, dapi.DocCreate{Kind: dapi.DocCreateKindText, Title: "Договор", FolderId: folder})
	if err != nil {
		t.Fatal(err)
	}
	if err := exec(t.Context(), `update docs.documents set status = 'approved' where id = $1`, doc.Id); err != nil {
		t.Fatal(err)
	}
	got, err := svc.ArchiveDocument(ctx, tc, doc.Id)
	if err != nil || got.Status != dapi.DocumentStatusArchived {
		t.Fatalf("archive: %v %v", err, got.Status)
	}
	list, _ := svc.Documents(ctx, tc, ListQuery{Filter: "archive", Folder: folder})
	if len(list.Items) != 1 {
		t.Fatalf("archive filter: %d items, want 1", len(list.Items))
	}
	_, err = svc.ArchiveDocument(ctx, tc, doc.Id)
	wantCode(t, err, "invalid_transition")
	got, err = svc.RestoreDocument(ctx, tc, doc.Id)
	if err != nil || got.Status != dapi.DocumentStatusApproved {
		t.Fatalf("restore: %v %v, want approved again", err, got.Status)
	}
	if err := exec(t.Context(), `update docs.documents set status = 'in_route' where id = $1`, doc.Id); err != nil {
		t.Fatal(err)
	}
	_, err = svc.ArchiveDocument(ctx, tc, doc.Id)
	wantCode(t, err, "invalid_transition")
}

// The search finds a title and the words of the text layer of a scan.
func TestSearch(t *testing.T) { //nolint:paralleltest // the tests share the documents and the people of the fixtures and run in order
	ctx, tc := as(t, "a.owner")
	folder := newFolder(t, "Поиск")
	a := seedDoc(t, folder, tc.PersonID, "Накладная на склад", "pdf")
	b := seedDoc(t, folder, tc.PersonID, "Скан без названия", "pdf")
	if err := exec(t.Context(), `insert into docs.ocr_words (document_id, id, text, confidence) values ($1, 'w1', 'Складская', 0.58)`, b); err != nil {
		t.Fatal(err)
	}
	list, err := svc.Documents(ctx, tc, ListQuery{Q: "склад", Folder: folder})
	if err != nil || len(list.Items) != 2 {
		t.Fatalf("search: %v %d items, want both", err, len(list.Items))
	}
	list, _ = svc.Documents(ctx, tc, ListQuery{Q: "100%_", Folder: folder})
	if len(list.Items) != 0 {
		t.Fatal("wildcards of the query match")
	}
	_ = a
}

// Folders: create under a parent, the name is unique among siblings, only an empty folder is deleted.
func TestFolders(t *testing.T) { //nolint:paralleltest // the tests share the documents and the people of the fixtures and run in order
	ctx, tc := as(t, "a.owner")
	top, err := svc.CreateFolder(ctx, tc, dapi.DocFolderCreate{Name: "Верх " + uuid.NewString()[:6]})
	if err != nil {
		t.Fatal(err)
	}
	sub, err := svc.CreateFolder(ctx, tc, dapi.DocFolderCreate{Name: "Вложенная", ParentId: &top.Id})
	if err != nil || sub.ParentId == nil || *sub.ParentId != top.Id || !sub.My.Manage {
		t.Fatalf("subfolder: %v %+v", err, sub)
	}
	_, err = svc.CreateFolder(ctx, tc, dapi.DocFolderCreate{Name: " вложенная ", ParentId: &top.Id})
	wantCode(t, err, "conflict")
	name := "Переименована"
	upd, err := svc.UpdateFolder(ctx, tc, sub.Id, etag(sub.Revision), dapi.DocFolderPatch{Name: &name})
	if err != nil || upd.Name != name {
		t.Fatalf("rename: %v %+v", err, upd)
	}
	_, err = svc.UpdateFolder(ctx, tc, sub.Id, etag(sub.Revision), dapi.DocFolderPatch{Name: &name})
	wantCode(t, err, "revision_mismatch")
	doc := seedDoc(t, sub.Id, tc.PersonID, "В папке", "text")
	wantCode(t, svc.DeleteFolder(ctx, tc, sub.Id), "conflict")
	if err := exec(t.Context(), `delete from docs.versions where document_id = $1`, doc); err != nil {
		t.Fatal(err)
	}
	if err := exec(t.Context(), `delete from docs.documents where id = $1`, doc); err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteFolder(ctx, tc, sub.Id); err != nil {
		t.Fatalf("delete an empty folder: %v", err)
	}
	stranger, strangerTC := as(t, "a.manager-msk2")
	_, err = svc.CreateFolder(stranger, strangerTC, dapi.DocFolderCreate{Name: "Чужая"})
	wantCode(t, err, "forbidden_action")
}
