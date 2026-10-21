//go:build integration

package main

import (
	"net/http"
	"slices"
	"testing"

	"github.com/google/uuid"
)

// W4.11 end to end: the Go seed writes the projects and the tasks of «Альта» (cmd/seed/tasks.go), the owner reads them
// over HTTP — LOG with its demo T-65 waiting for approval and its attachment; a command without If-Match is 428, with a
// stale one 412; createTaskProject repeated with its Idempotency-Key replays the first answer.
func TestStackTasks(t *testing.T) { //nolint:paralleltest // one seeded stack; creates a project of t_alta
	owner := newBrowser(t, server(t)).login("owner")
	base := "/api/v1/tenants/" + seedAlta.String()
	status, _, projects := owner.do(http.MethodGet, base+"/projects", "", nil)
	if keys := itemsOf(projects, "key"); status != http.StatusOK || !slices.Contains(keys, "LOG") || !slices.Contains(keys, "ЗАЯ") {
		t.Fatalf("projects: %d %v", status, keys)
	}
	t65 := base + "/tasks/" + uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:t-alta:T-65")).String()
	stackT65(t, owner, t65)
	stackIfMatch(t, owner, t65)
	stackReplay(t, owner, base)
}

// stackT65 reads the demo task waiting for approval. The seed of the stack runs without an object storage
// (S3_ENDPOINT is not set), so it attaches no invoice (W4.11 возврат 1): no row of core.files that cannot be
// downloaded; TestStackTaskAttachments uploads attachments through MinIO.
func stackT65(t *testing.T, owner *browser, path string) {
	t.Helper()
	status, hdr, task := owner.do(http.MethodGet, path, "", nil)
	files, _ := task["files"].([]any)
	got := []any{status, hdr.Get("ETag"), task["key"], task["status"], len(files), task["approval"] != nil}
	if want := []any{http.StatusOK, `"rev-1"`, "T-65", "s3", 0, true}; !slices.Equal(got, want) {
		t.Fatalf("T-65: %v, want %v (%v)", got, want, task)
	}
}

// stackIfMatch: a command without If-Match — 428 before the module, with a stale one — 412 with the text of the task.
func stackIfMatch(t *testing.T, owner *browser, path string) {
	t.Helper()
	patch := `{"priority":"urgent"}`
	if status, _, res := owner.do(http.MethodPatch, path, patch, map[string]string{"Idempotency-Key": "w411-stack-without-if-match"}); status != http.StatusPreconditionRequired {
		t.Fatalf("without If-Match: %d %v", status, res)
	}
	status, _, res := owner.do(http.MethodPatch, path, patch, map[string]string{"Idempotency-Key": "w411-stack-stale-if-match", "If-Match": `"rev-9"`})
	got := []any{status, res["code"], res["detail"]}
	if want := []any{http.StatusPreconditionFailed, "revision_mismatch", "Задачу уже изменили. Обновите и повторите."}; !slices.Equal(got, want) {
		t.Fatalf("stale If-Match: %v, want %v", got, want)
	}
}

// stackReplay: createTaskProject repeated with the same Idempotency-Key replays the first answer.
func stackReplay(t *testing.T, owner *browser, base string) {
	t.Helper()
	body := `{"name":"Склад · Север","key":"СКЛ","workflowKey":"simple"}`
	key := map[string]string{"Idempotency-Key": "w411-stack-create-project"}
	status, hdr, first := owner.do(http.MethodPost, base+"/projects", body, key)
	if got := []any{status, hdr.Get("ETag"), first["key"]}; !slices.Equal(got, []any{http.StatusCreated, `"rev-1"`, "СКЛ"}) {
		t.Fatalf("create: %v %v", got, first)
	}
	status, hdr, again := owner.do(http.MethodPost, base+"/projects", body, key)
	if got := []any{status, hdr.Get("Idempotency-Replayed"), again["id"]}; !slices.Equal(got, []any{http.StatusCreated, "true", first["id"]}) {
		t.Fatalf("replay: %v %v", got, again)
	}
}
