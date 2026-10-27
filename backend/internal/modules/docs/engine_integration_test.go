//go:build integration

package docs

import (
	"context"
	"crypto/sha256"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	dapi "github.com/ortus/ortus-crm/backend/internal/api/docs"
	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: the clock of the suites
)

// seedFile writes a ready file of a document (the object in the store and the row in files.objects) and makes it
// version n of the document.
func seedFile(t *testing.T, doc, owner uuid.UUID, n int, name, contentType string, data []byte) uuid.UUID {
	t.Helper()
	id := uuid.New()
	key := fileKey(tenantA, id)
	blobs.Mem.Put(key, contentType, data)
	sum := sha256.Sum256(data)
	if err := exec(t.Context(), `insert into files.objects (id, object_key, state, purpose, owner_type, owner_id, declared_mime, detected_mime, bytes,
		sha256, uploaded_by, ready_at) values ($1, $2, 'ready', 'document', 'docs.document', $3, $4, $5, $6, $7, $8, now())`,
		id, key, doc, encodeMIME(contentType, name), contentType, len(data), sum[:], owner); err != nil {
		t.Fatal(err)
	}
	if n == 1 {
		if err := exec(t.Context(), `update docs.versions set file_id = $2, size_bytes = $3 where document_id = $1 and number = 1`, doc, id, len(data)); err != nil {
			t.Fatal(err)
		}
		return id
	}
	if err := exec(t.Context(), `insert into docs.versions (document_id, number, file_id, size_bytes, source, authors) values ($1, $2, $3, $4, 'edit', $5)`,
		doc, n, id, len(data), []uuid.UUID{owner}); err != nil {
		t.Fatal(err)
	}
	if err := exec(t.Context(), `update docs.documents set current_version = $2 where id = $1`, doc, n); err != nil {
		t.Fatal(err)
	}
	return id
}

// withEngine puts a document server in the service for the test.
func withEngine(t *testing.T, e Engine) {
	t.Helper()
	prev := svc.Engine
	svc.Engine = e
	t.Cleanup(func() { svc.Engine = prev })
}

// Versions: the name of a version, the cut of a version (the last one is named), the restore as v+1 (docCut, docRestore).
func TestVersions(t *testing.T) { //nolint:gocyclo,paralleltest // a scenario of one story: the steps share the data and run in order
	ctx, tc := as(t, "a.owner")
	folder := newFolder(t, "Версии")
	doc := seedDoc(t, folder, tc.PersonID, "Регламент", "text")
	seedFile(t, doc, tc.PersonID, 1, "reg.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", []byte("v1"))
	seedFile(t, doc, tc.PersonID, 2, "reg.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", []byte("v2 longer"))
	name := "Перед согласованием"
	v, err := svc.SaveVersion(ctx, tc, doc, dapi.DocVersionSave{Name: &name})
	if err != nil || v.Version != 2 || v.Name == nil || *v.Name != name {
		t.Fatalf("cut: %v %+v, want the last version named", err, v)
	}
	one := "Первая"
	v, err = svc.NameVersion(ctx, tc, doc, 1, dapi.DocVersionName{Name: one})
	if err != nil || v.Version != 1 || *v.Name != one {
		t.Fatalf("name: %v %+v", err, v)
	}
	_, err = svc.NameVersion(ctx, tc, doc, 9, dapi.DocVersionName{Name: one})
	wantCode(t, err, "not_found")
	restored, err := svc.RestoreVersion(ctx, tc, doc, 1)
	if err != nil || restored.Version != 3 || restored.Source != dapi.DocVersionSourceRestore || restored.Base == nil || *restored.Base != 1 {
		t.Fatalf("restore: %v %+v, want v3 from v1", err, restored)
	}
	list, err := svc.Versions(ctx, tc, doc)
	if err != nil || len(list.Items) != 3 || list.Items[0].Version != 3 || list.Items[2].Version != 1 {
		t.Fatalf("versions: %v %+v, want newest first", err, list.Items)
	}
	got, err := svc.Document(ctx, tc, doc)
	if err != nil || got.Version != 3 || got.File == nil || got.File.SizeBytes != 2 {
		t.Fatalf("document: %v version %d file %+v, want the file of v1", err, got.Version, got.File)
	}
	if err := exec(t.Context(), `update docs.documents set status = 'signed' where id = $1`, doc); err != nil {
		t.Fatal(err)
	}
	_, err = svc.RestoreVersion(ctx, tc, doc, 2)
	wantCode(t, err, "document_locked")
}

// A session without a server tells so; with a server the configuration is signed and lowered to the rights of the
// member (openDocumentSession).
func TestOpenSession(t *testing.T) { //nolint:gocyclo,paralleltest // a scenario of one story: the steps share the data and run in order
	ctx, tc := as(t, "a.owner")
	folder := newFolder(t, "Редактор")
	doc := seedDoc(t, folder, tc.PersonID, "Сессия", "text")
	seedFile(t, doc, tc.PersonID, 1, "s.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", []byte("body"))
	viewer := personOf(t, "a.manager-msk1")
	if err := exec(t.Context(), `insert into docs.shares (document_id, who, ref_id, level) values ($1, 'member', $2, 'comment')`, doc, viewer); err != nil {
		t.Fatal(err)
	}

	cfg, err := svc.OpenSession(ctx, tc, doc, modeEdit)
	if err != nil || cfg.EditorAvailable || cfg.Hint == nil || *cfg.Hint != "Редактор подключается" || cfg.Mode != dapi.DocSessionConfigModeView || cfg.Token != nil {
		t.Fatalf("without a server: %v %+v", err, cfg)
	}
	if cfg.FileUrl == nil || cfg.DocumentKey != engineKey(tenantA, doc, 1) {
		t.Fatalf("the file and the key are given anyway: %+v", cfg)
	}

	withEngine(t, &OnlyOffice{PublicURL: "https://docs.example", Secret: testSecret, Now: time.Now})
	cfg, err = svc.OpenSession(ctx, tc, doc, modeEdit)
	if err != nil || !cfg.EditorAvailable || cfg.Mode != dapi.DocSessionConfigModeEdit || cfg.Token == nil || !cfg.Permissions.Edit || cfg.Engine != dapi.DocSessionConfigEngineOnlyoffice {
		t.Fatalf("owner: %v %+v", err, cfg)
	}
	claims, err := verifyJWT(testSecret, *cfg.Token, harness.Now())
	if err != nil || claims["documentType"] != "word" {
		t.Fatalf("token: %v %v", claims, err)
	}
	vCtx, vTC := as(t, "a.manager-msk1")
	cfg, err = svc.OpenSession(vCtx, vTC, doc, modeEdit)
	if err != nil || cfg.Mode != dapi.DocSessionConfigModeComment || cfg.Permissions.Edit || !cfg.Permissions.Comment {
		t.Fatalf("a commenter asks for «edit»: %v %+v, want the mode lowered to comment", err, cfg)
	}
	if err := exec(t.Context(), `update docs.documents set status = 'in_route' where id = $1`, doc); err != nil {
		t.Fatal(err)
	}
	cfg, err = svc.OpenSession(ctx, tc, doc, modeEdit)
	if err != nil || cfg.Mode == dapi.DocSessionConfigModeEdit || cfg.Permissions.Edit {
		t.Fatalf("a document on a route: %v %+v, want no editing", err, cfg)
	}
}

// engineStub is a document server that offers a saved file.
func engineStub(t *testing.T, data []byte) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(data) }))
	t.Cleanup(srv.Close)
	return srv
}

// The callback of the server: a signed call saves the next version, a repeat is accepted without a second version, an
// old key is 409, an unsigned call is refused (docServerCallback, ADR-0016).
func TestCallback(t *testing.T) { //nolint:gocyclo,paralleltest // a scenario of one story: the steps share the data and run in order
	ctx, tc := as(t, "a.owner")
	folder := newFolder(t, "Callback")
	doc := seedDoc(t, folder, tc.PersonID, "Правится", "text")
	seedFile(t, doc, tc.PersonID, 1, "p.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", []byte("first"))
	srv := engineStub(t, []byte("second version bytes"))
	withEngine(t, &OnlyOffice{PublicURL: srv.URL, Secret: testSecret})

	signed := func() *http.Request {
		tok, _ := signJWT(testSecret, map[string]any{"payload": "x"})
		r := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/internal/docs/callback", nil)
		r.Header.Set("Authorization", "Bearer "+tok)
		return r
	}
	unsigned := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/internal/docs/callback", nil)
	if _, err := svc.AuthorizeCallback(unsigned); err == nil {
		t.Fatal("a callback without a token is authorized")
	} else {
		wantCode(t, err, "session_expired")
	}
	cbCtx, err := svc.AuthorizeCallback(signed())
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.Callback(t.Context(), CallbackBody{Key: engineKey(tenantA, doc, 1), Status: cbReady, URL: srv.URL + "/f"}); err == nil {
		t.Fatal("a call that did not pass the check of the signature is accepted")
	}
	body := CallbackBody{Key: engineKey(tenantA, doc, 1), Status: cbReady, URL: srv.URL + "/f", Users: []string{tc.PersonID.String(), "not-a-person"}}
	if err := svc.Callback(cbCtx, body); err != nil {
		t.Fatalf("callback: %v", err)
	}
	got, err := svc.Document(ctx, tc, doc)
	if err != nil || got.Version != 2 || got.File == nil || got.File.SizeBytes != int64(len("second version bytes")) {
		t.Fatalf("after the callback: %v version %d file %+v, want v2", err, got.Version, got.File)
	}
	if err := svc.Callback(cbCtx, body); err != nil {
		t.Fatalf("repeat: %v", err)
	}
	if got, _ = svc.Document(ctx, tc, doc); got.Version != 2 {
		t.Fatalf("a repeat of the call made v%d", got.Version)
	}
	// the engine edited v1, but v2 is current: an old key
	body2 := body
	body2.Key, body2.Status, body2.Lastsave = engineKey(tenantA, doc, 1), cbForce, time.Now()
	wantCode(t, svc.Callback(cbCtx, body2), "invalid_transition")
	// a forced save of the current version is a version of its own (forcesave)
	body3 := CallbackBody{Key: engineKey(tenantA, doc, 2), Status: cbForce, URL: srv.URL + "/f", Lastsave: time.Now()}
	if err := svc.Callback(cbCtx, body3); err != nil {
		t.Fatalf("forcesave: %v", err)
	}
	list, _ := svc.Versions(ctx, tc, doc)
	if len(list.Items) != 3 || !list.Items[0].Forcesave || list.Items[0].Source != dapi.DocVersionSourceEdit {
		t.Fatalf("versions %+v, want v3 by forcesave", list.Items)
	}
	// statuses without a file, a bad key, an address on another host
	if err := svc.Callback(cbCtx, CallbackBody{Key: engineKey(tenantA, doc, 3), Status: cbEditing}); err != nil {
		t.Fatalf("editing: %v", err)
	}
	wantCode(t, svc.Callback(cbCtx, CallbackBody{Key: "x", Status: cbReady, URL: srv.URL}), "validation_failed")
	wantCode(t, svc.Callback(cbCtx, CallbackBody{Key: engineKey(tenantA, doc, 3), Status: cbReady, URL: "http://169.254.169.254/x"}), "validation_failed")
	wantCode(t, svc.Callback(cbCtx, CallbackBody{Key: engineKey(tenantA, uuid.New(), 1), Status: cbReady, URL: srv.URL + "/f"}), "not_found")
	// a document on a route does not take a file from the engine
	if err := exec(t.Context(), `update docs.documents set status = 'in_route' where id = $1`, doc); err != nil {
		t.Fatal(err)
	}
	wantCode(t, svc.Callback(cbCtx, CallbackBody{Key: engineKey(tenantA, doc, 3), Status: cbReady, URL: srv.URL + "/f"}), "document_locked")
	// the tenant of the key is not the organization of the document: another tenant's document is not found
	other := uuid.New()
	wantCode(t, svc.Callback(cbCtx, CallbackBody{Key: engineKey(other, doc, 1), Status: cbReady, URL: srv.URL + "/f"}), "not_found")
}
