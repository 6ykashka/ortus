//go:build integration

package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"net/http"
	"testing"

	"github.com/google/uuid"
)

// closedTask is a task of a closed project of «Альта» nobody has a role in (TP-03: the owner does not see it either)
// with a checked attachment; everything is removed after the test.
type closedTask struct{ project, task, file uuid.UUID }

func seedClosedTask(t *testing.T, db *sql.DB) closedTask {
	t.Helper()
	ctx := t.Context()
	c := closedTask{project: uuid.New(), task: uuid.New(), file: uuid.New()}
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{`insert into tasks.projects (id, key, name, org_unit_id, access, flow, workflow_key, owner_id, current_version,
		   workflow_revision, task_seq, revision, created_at, updated_at)
		 select $1, 'ЗКРТ', 'Закрытый · W4.11', org_unit_id, 'closed', 'tasks', 'approval', owner_id, 1, 1, 101, 1, now(), now()
		   from tasks.projects where key = 'LOG'`, []any{c.project}},
		{`insert into tasks.workflow_versions (project_id, version, statuses, transitions, published_at, published_by)
		 select $1, 1, v.statuses, v.transitions, v.published_at, v.published_by
		   from tasks.workflow_versions v join tasks.projects p on p.id = v.project_id where p.key = 'LOG' and v.version = 1`,
			[]any{c.project}},
		{`insert into tasks.tasks (id, project_id, number, title, status_id, workflow_version, priority, labels, checklist,
		   created_at, updated_at) values ($1, $2, 101, 'Задача закрытого проекта', 's1', 1, 'normal', '{}', '[]', now(), now())`,
			[]any{c.task, c.project}},
		{`insert into files.objects (id, object_key, state, purpose, owner_type, owner_id, declared_mime, detected_mime, bytes,
		   sha256, uploaded_by, created_at, ready_at)
		 select $1::uuid, 'w411/closed/' || $1::uuid::text, 'ready', 'task_attachment', 'tasks.task', $2, 'application/pdf; name="Смета.pdf"',
		        'application/pdf', 10, decode(repeat('b', 64), 'hex'), id, now(), now()
		   from people.person_profiles where email = 'd.zimina@alta.example'`, []any{c.file, c.task}},
	} {
		if _, err := db.ExecContext(ctx, q.sql, q.args...); err != nil {
			t.Fatalf("%s: %v", q.sql, err)
		}
	}
	t.Cleanup(func() {
		ctx := context.WithoutCancel(t.Context())
		for _, q := range []struct {
			sql string
			id  uuid.UUID
		}{{`delete from files.objects where id = $1`, c.file}, {`delete from tasks.tasks where id = $1`, c.task},
			{`delete from tasks.workflow_versions where project_id = $1`, c.project}, {`delete from tasks.projects where id = $1`, c.project}} {
			if _, err := db.ExecContext(ctx, q.sql, q.id); err != nil {
				t.Errorf("%s: %v", q.sql, err)
			}
		}
	})
	return c
}

// W4.11 возврат 1 (ревью, major): the attachments of tasks through the files module, over the whole API with MinIO.
// UploadCreate with the parent tasks/task: the project lead of LOG uploads the invoice of T-65 (purpose
// task_attachment), the upload of a task of a closed project is 404 to its owner and to that lead. A file is read
// as its task: the assignee of T-65 (scope self), the project lead and the owner of the organization read and
// download it; the attachment of a task of a closed project without a role (TP-03) is 404 and absent from listFiles
// for the owner and for the lead of another project.
func TestStackTaskAttachments(t *testing.T) { //nolint:paralleltest // one seeded stack; adds a closed project to t_alta
	srv, s3cfg, pools := filesStack(t)
	closed := seedClosedTask(t, super(t, "t_alta"))
	base := "/api/v1/tenants/" + seedAlta.String()
	t65 := uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:t-alta:T-65"))
	owner, lead, assignee := newBrowser(t, srv).login("owner"), newBrowser(t, srv).login("manager"), newBrowser(t, srv).login("driver")
	content := append([]byte("%PDF-1.4\n% Счёт № 418\n"), bytes.Repeat([]byte("%\n"), 512)...)
	sum := sha256.Sum256(content)
	initiate := func(b *browser, task uuid.UUID) (int, map[string]any) {
		return b.send(http.MethodPost, base+"/files/uploads", map[string]any{
			"fileName": "Счёт № 418.pdf", "contentType": "application/pdf", "sizeBytes": len(content), "sha256": hex.EncodeToString(sum[:]),
			"purpose": "task_attachment", "owner": map[string]any{"moduleKey": "tasks", "entityType": "task", "entityId": task},
		})
	}
	for name, b := range map[string]*browser{"owner": owner, "lead of LOG": lead} {
		if status, body := initiate(b, closed.task); status != http.StatusNotFound {
			t.Errorf("initiateUpload for a task of the closed project by the %s: %d %v, want 404 (TP-03)", name, status, body)
		}
	}
	status, ticket := initiate(lead, t65)
	if status != http.StatusCreated {
		t.Fatalf("initiateUpload for T-65 by the project lead: %d %v", status, ticket)
	}
	putPDF(t, ticket["uploadUrl"].(string), content) //nolint:forcetypeassert // checked by the status above
	upload := ticket["uploadId"].(string)            //nolint:forcetypeassert // checked by the status above
	status, file := lead.send(http.MethodPost, base+"/files/uploads/"+upload+"/complete", map[string]any{"sha256": hex.EncodeToString(sum[:])})
	if status != http.StatusAccepted {
		t.Fatalf("completeUpload: %d %v", status, file)
	}
	invoice := uuid.MustParse(file["id"].(string)) //nolint:forcetypeassert // checked by the status above
	scanInWorker(t, s3cfg, pools, invoice)
	for name, b := range map[string]*browser{"assignee of T-65": assignee, "project lead": lead, "owner": owner} {
		for _, path := range []string{"/files/" + invoice.String(), "/files/" + invoice.String() + "/download"} {
			if status, body := b.call(http.MethodGet, base+path, ""); status != http.StatusOK {
				t.Errorf("GET %s by the %s: %d %v, want 200 (a file is read as its task)", path, name, status, body)
			}
		}
	}
	for name, b := range map[string]*browser{"owner": owner, "lead of LOG": lead} {
		if status, body := b.call(http.MethodGet, base+"/files/"+closed.file.String(), ""); status != http.StatusNotFound {
			t.Errorf("getFile of the closed project by the %s: %d %v, want 404 (TP-03)", name, status, body)
		}
		status, list := b.call(http.MethodGet, base+"/files?limit=100", "")
		if status != http.StatusOK || listsFile(list, closed.file) || !listsFile(list, invoice) {
			t.Errorf("listFiles of the %s: %d, want the invoice of T-65 and no file of the closed project: %v", name, status, list)
		}
	}
}

// listsFile reports whether a page of listFiles holds the file id (items[].file.id).
func listsFile(page map[string]any, id uuid.UUID) bool {
	for _, it := range asSlice(page["items"]) {
		item, _ := it.(map[string]any)
		if f, _ := item["file"].(map[string]any); f["id"] == id.String() {
			return true
		}
	}
	return false
}

func putPDF(t *testing.T, url string, content []byte) {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPut, url, bytes.NewReader(content))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/pdf")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("PUT: %d", resp.StatusCode)
	}
}
