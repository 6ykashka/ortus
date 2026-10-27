//go:build integration

package main

// W7.11, return 1 (review, major): the files of the chats through the files module over the whole API with MinIO. The
// attachments of a chat are uploaded with initiateUpload (parent chat/chat, purpose chat_attachment) and sent with
// postChatMessage; cleaning releases the quota; the export of the history becomes a file of the organization.

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/chats"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage/miniotest"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"
)

// chatStack is filesStack that also hands out the service of the chats, to run its jobs by term.
func chatStack(t *testing.T) (*httptest.Server, storage.Config, *tenantctx.Pools, *chats.Service) {
	t.Helper()
	s3, stop, err := miniotest.Start(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(stop)
	cfg := config{
		AppEnv: envE2E, AuthProvider: envDev, ControlDBURL: stack.URL(controlDB, migrations.RoleAPI),
		SessionCookie: "ortus_sid", SessionTTL: time.Hour, AllowedOrigins: []string{"http://127.0.0.1:5213"},
	}
	vars := map[string]string{
		"TENANT_DB_URL": stack.URL("postgres", migrations.RoleAPI),
		"S3_ENDPOINT":   s3.Endpoint, "S3_REGION": s3.Region, "S3_BUCKET": s3.Bucket,
		"S3_ACCESS_KEY": s3.AccessKey, "S3_SECRET_KEY": s3.SecretKey,
	}
	getenv := func(k string) string { return vars[k] }
	d, closeDeps, err := build(t.Context(), cfg, slog.New(slog.DiscardHandler), getenv)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(newHandler(d))
	pools := tenantctx.NewPools(d.dir, getenv, "")
	t.Cleanup(func() {
		srv.Close()
		pools.Close()
		closeDeps()
	})
	return srv, s3, pools, d.chats
}

// personOf is the person of the organization «Альта» a logged-in browser acts as (the name of /me/context).
func personOf(t *testing.T, db *sql.DB, b *browser) uuid.UUID {
	t.Helper()
	status, me := b.call(http.MethodGet, "/api/v1/me/context", "")
	if status != http.StatusOK {
		t.Fatalf("me/context: %d %v", status, me)
	}
	var id uuid.UUID
	if err := db.QueryRowContext(t.Context(), `select id from people.person_profiles where full_name = $1`, me["displayName"]).Scan(&id); err != nil {
		t.Fatalf("person %v: %v", me["displayName"], err)
	}
	return id
}

// uploadToChat runs the whole upload of a chat attachment as b: initiateUpload, PUT, completeUpload, the check of the
// worker. It returns the status of initiateUpload and the id of the file when it was made.
func uploadToChat(t *testing.T, b *browser, s3cfg storage.Config, pools *tenantctx.Pools, chat uuid.UUID, content []byte) (int, uuid.UUID) {
	t.Helper()
	base := "/api/v1/tenants/" + seedAlta.String()
	sum := sha256.Sum256(content)
	digest := hex.EncodeToString(sum[:])
	status, ticket := b.send(http.MethodPost, base+"/files/uploads", map[string]any{
		"fileName": "Смета № 7.pdf", "contentType": "application/pdf", "sizeBytes": len(content), "sha256": digest,
		"purpose": "chat_attachment", "owner": map[string]any{"moduleKey": "chat", "entityType": "chat", "entityId": chat},
	})
	if status != http.StatusCreated {
		return status, uuid.Nil
	}
	putPDF(t, ticket["uploadUrl"].(string), content) //nolint:forcetypeassert // checked by the status above
	upload := ticket["uploadId"].(string)            //nolint:forcetypeassert // checked by the status above
	status, file := b.send(http.MethodPost, base+"/files/uploads/"+upload+"/complete", map[string]any{"sha256": digest})
	if status != http.StatusAccepted {
		t.Fatalf("completeUpload: %d %v", status, file)
	}
	id := uuid.MustParse(file["id"].(string)) //nolint:forcetypeassert // checked by the status above
	scanInWorker(t, s3cfg, pools, id)
	return http.StatusCreated, id
}

// chatterOf gives the person a role that reads and writes chats and files over the whole organization (the roles of the
// seed have no chat actions yet, Q-W7.11-14); the rows go after the test.
func chatterOf(t *testing.T, db *sql.DB, person uuid.UUID) {
	t.Helper()
	role := uuid.New()
	name := "Чаты стенда " + role.String()[:8]
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{`insert into access.roles (id, name, kind) values ($1, $2, 'custom')`, []any{role, name}},
		{`insert into access.role_versions (role_id, version, actions, created_by)
		  select $1, 1, array['chat.read', 'chat.write', 'chat.files.send', 'files.read', 'files.upload'], id from people.person_profiles
		   where email = 'd.zimina@alta.example'`, []any{role}},
		{`insert into access.role_assignments (principal_kind, principal_id, role_id, role_version, scope_kind, granted_by, valid)
		  select 'person', $2, $1, 1, 'tenant', o.id, tstzrange('2020-01-01', null)
		    from people.person_profiles o where o.email = 'd.zimina@alta.example'`, []any{role, person}},
		{`update access.policy_state set policy_version = policy_version + 1`, nil},
	} {
		if _, err := db.ExecContext(t.Context(), q.sql, q.args...); err != nil {
			t.Fatalf("%s: %v", q.sql, err)
		}
	}
	t.Cleanup(func() {
		ctx := context.WithoutCancel(t.Context())
		for _, q := range []string{
			`delete from access.role_assignments where role_id = $1`, `delete from access.role_versions where role_id = $1`,
			`delete from access.roles where id = $1`, `update access.policy_state set policy_version = policy_version + 1`,
		} {
			args := []any{role}
			if strings.HasPrefix(q, "update") {
				args = nil
			}
			if _, err := db.ExecContext(ctx, q, args...); err != nil {
				t.Errorf("%s: %v", q, err)
			}
		}
	})
}

func committedBytes(t *testing.T, db *sql.DB) int64 {
	t.Helper()
	var n int64
	if err := db.QueryRowContext(t.Context(), `select committed_bytes from files.usage where singleton`).Scan(&n); err != nil && !errors.Is(err, sql.ErrNoRows) { // no row before the first upload
		t.Fatal(err)
	}
	return n
}

// The attachments of a chat end to end: a member uploads and sends a file, a person outside the chat neither uploads nor
// reads it, cleaning removes the file and gives its bytes back to the quota of the organization.
func TestStackChatAttachments(t *testing.T) { //nolint:paralleltest,gocyclo // one seeded stack; one scenario, step by step
	srv, s3cfg, pools, _ := chatStack(t)
	db := super(t, "t_alta")
	base := "/api/v1/tenants/" + seedAlta.String()
	owner, manager, driver := newBrowser(t, srv).login("owner"), newBrowser(t, srv).login("manager"), newBrowser(t, srv).login("driver")
	mgr := personOf(t, db, manager)
	chatterOf(t, db, mgr)
	var unit uuid.UUID
	if err := db.QueryRowContext(t.Context(), `select home_unit_id from people.person_profiles where id = $1`, mgr).Scan(&unit); err != nil {
		t.Fatal(err)
	}
	status, made := owner.send(http.MethodPost, base+"/chats", map[string]any{
		"kind": "group", "title": "Файлы чата · W7.11", "orgUnitId": unit,
		"sources": []any{map[string]any{"who": "member", "refId": mgr, "role": "member"}},
	})
	if status != http.StatusCreated {
		t.Fatalf("createChat: %d %v", status, made)
	}
	chat := uuid.MustParse(made["chat"].(map[string]any)["id"].(string)) //nolint:forcetypeassert // checked by the status above
	content := append([]byte("%PDF-1.4\n% Смета № 7\n"), bytes.Repeat([]byte("%\n"), 512)...)

	if status, _ := uploadToChat(t, driver, s3cfg, pools, chat, content); status != http.StatusNotFound {
		t.Errorf("initiateUpload to a chat by a person outside it: %d, want 404", status)
	}
	before := committedBytes(t, db)
	status, file := uploadToChat(t, manager, s3cfg, pools, chat, content)
	if status != http.StatusCreated {
		t.Fatalf("initiateUpload to a chat by its member: %d, want 201 (purpose chat_attachment, parent chat/chat); impact %v", status, made["impact"])
	}
	if got := committedBytes(t, db); got != before+int64(len(content)) {
		t.Errorf("committed bytes after the upload: %d, want %d", got, before+int64(len(content)))
	}
	status, msg := manager.send(http.MethodPost, base+"/chats/"+chat.String()+"/messages", map[string]any{"text": "Смета во вложении", "fileIds": []any{file}})
	if status != http.StatusCreated {
		t.Fatalf("postChatMessage with the file: %d %v", status, msg)
	}
	if at, _ := msg["attachments"].([]any); len(at) != 1 {
		t.Fatalf("attachments of the message: %v", msg["attachments"])
	}
	for name, want := range map[string]struct {
		b      *browser
		status int
	}{"member": {manager, http.StatusOK}, "owner of the business": {owner, http.StatusOK}, "outside the chat": {driver, http.StatusNotFound}} {
		for _, path := range []string{"/files/" + file.String(), "/files/" + file.String() + "/download"} {
			if status, body := want.b.call(http.MethodGet, base+path, ""); status != want.status {
				t.Errorf("GET %s by the person %s: %d %v, want %d", path, name, status, body, want.status)
			}
		}
	}
	status, res := owner.send(http.MethodPost, base+"/chats/"+chat.String()+"/cleanups", map[string]any{"kinds": []any{"doc"}, "olderThanDays": 0})
	if status != http.StatusOK || res["applied"] != true {
		t.Fatalf("createChatCleanup: %d %v", status, res)
	}
	var state string
	if err := db.QueryRowContext(t.Context(), `select state from files.objects where id = $1`, file).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != "rejected" {
		t.Errorf("state of the cleaned file: %q, want rejected", state)
	}
	if got := committedBytes(t, db); got != before {
		t.Errorf("committed bytes after the cleanup: %d, want %d (the bytes of the cleaned file go back to the quota)", got, before)
	}
}

// The export of the history is a job: the sweep builds the file of the organization, the one who asked for it reads it,
// a member without the right to export does not.
func TestStackChatExport(t *testing.T) { //nolint:paralleltest,gocyclo // one seeded stack; one scenario, step by step
	srv, _, _, svc := chatStack(t)
	db := super(t, "t_alta")
	base := "/api/v1/tenants/" + seedAlta.String()
	owner, manager := newBrowser(t, srv).login("owner"), newBrowser(t, srv).login("manager")
	mgr := personOf(t, db, manager)
	chatterOf(t, db, mgr)
	status, made := owner.send(http.MethodPost, base+"/chats", map[string]any{
		"kind": "group", "title": "Выгрузка · W7.11",
		"sources": []any{map[string]any{"who": "member", "refId": mgr, "role": "member"}},
	})
	if status != http.StatusCreated {
		t.Fatalf("createChat: %d %v", status, made)
	}
	chat := made["chat"].(map[string]any)["id"].(string) //nolint:forcetypeassert // checked by the status above
	if status, body := owner.send(http.MethodPost, base+"/chats/"+chat+"/messages", map[string]any{"text": "Первое сообщение выгрузки"}); status != http.StatusCreated {
		t.Fatalf("postChatMessage: %d %v", status, body)
	}
	before := committedBytes(t, db)
	status, job := owner.send(http.MethodPost, base+"/chats/"+chat+"/exports", map[string]any{"format": "json"})
	if status != http.StatusAccepted {
		t.Fatalf("createChatExport: %d %v", status, job)
	}
	if _, err := svc.Sweep(context.WithoutCancel(t.Context()), seedAlta); err != nil {
		t.Fatal(err)
	}
	path := base + "/chats/" + chat + "/exports/" + job["id"].(string) //nolint:forcetypeassert // checked by the status above
	status, done := owner.call(http.MethodGet, path, "")
	file, _ := done["file"].(map[string]any)
	if status != http.StatusOK || done["status"] != "done" || file == nil {
		t.Fatalf("getChatExport after the sweep: %d %v, want done with a file (the export has to be written to the storage)", status, done)
	}
	if got := committedBytes(t, db); got <= before {
		t.Errorf("committed bytes after the export: %d, want more than %d (the file counts for the quota)", got, before)
	}
	status, ticket := owner.call(http.MethodGet, base+"/files/"+file["id"].(string)+"/download", "") //nolint:forcetypeassert // the file has an id
	if status != http.StatusOK {
		t.Fatalf("download of the export by the one who asked: %d %v", status, ticket)
	}
	resp, err := http.Get(ticket["downloadUrl"].(string)) //nolint:noctx,forcetypeassert // the presigned link of the test MinIO
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(data), "Первое сообщение выгрузки") {
		t.Errorf("content of the export: %d %.200q", resp.StatusCode, data)
	}
	if status, body := manager.call(http.MethodGet, base+"/files/"+file["id"].(string), ""); status != http.StatusNotFound { //nolint:forcetypeassert // the file has an id
		t.Errorf("getFile of the export by a member without the right to export: %d %v, want 404", status, body)
	}
}

// «Сохранить в запись» gives the file to the record: it is read as the record from then on, not as the chat.
func TestStackChatFileToRecord(t *testing.T) { //nolint:paralleltest // one seeded stack
	srv, s3cfg, pools, _ := chatStack(t)
	db := super(t, "t_alta")
	base := "/api/v1/tenants/" + seedAlta.String()
	owner := newBrowser(t, srv).login("owner")
	status, made := owner.send(http.MethodPost, base+"/chats", map[string]any{
		"kind": "group", "title": "В запись · W7.11",
		"sources": []any{map[string]any{"who": "member", "refId": personOf(t, db, owner), "role": "owner"}},
	})
	if status != http.StatusCreated {
		t.Fatalf("createChat: %d %v", status, made)
	}
	chat := uuid.MustParse(made["chat"].(map[string]any)["id"].(string)) //nolint:forcetypeassert // checked by the status above
	status, file := uploadToChat(t, owner, s3cfg, pools, chat, append([]byte("%PDF-1.4\n"), bytes.Repeat([]byte("%\n"), 300)...))
	if status != http.StatusCreated {
		t.Fatalf("initiateUpload to a chat by its owner: %d, want 201", status)
	}
	trip := uuid.New()
	if _, err := db.ExecContext(t.Context(), `insert into fleet.trips (id, number, unit_id, state, planned)
		select $1, 'TR-W711-0001', id, 'planned', tstzrange(now(), now() + interval '1 day') from org.units limit 1`, trip); err != nil {
		t.Fatal(err)
	}
	blobs := chatBlobs{pools: pools}
	pool, err := pools.For(t.Context(), seedAlta)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if err := blobs.Move(t.Context(), tx, file, chats.ObjectRef{Module: "fleet", Type: "trip", ID: trip}); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	var ownerType string
	var ownerID uuid.UUID
	if err := db.QueryRowContext(t.Context(), `select owner_type, owner_id from files.objects where id = $1`, file).Scan(&ownerType, &ownerID); err != nil {
		t.Fatal(err)
	}
	if ownerType != "fleet.trip" || ownerID != trip {
		t.Errorf("owner of the saved file: %s %s, want fleet.trip %s", ownerType, ownerID, trip)
	}
	if status, body := owner.call(http.MethodGet, base+"/files/"+file.String(), ""); status != http.StatusOK {
		t.Errorf("getFile of the saved file as the record: %d %v", status, body)
	}
}
