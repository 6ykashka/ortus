//go:build integration

package files_test

import (
	"context"
	"encoding/json"
	"slices"
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/files" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

func deadline(tc tenantctx.TenantContext, eventID, upload uuid.UUID) events.Message {
	payload, _ := json.Marshal(map[string]string{"uploadId": upload.String()})
	return events.Message{TenantID: tc.TenantID, EventID: eventID, Type: files.EventDeadline,
		Aggregate: "files.upload", AggregateID: upload, Payload: payload, Attempts: 1}
}

// The parent decides (UploadCreate, ObjectRef): an invisible or missing parent is 404, a visible one without
// files.upload is 403, an unknown kind or a purpose the kind does not take is 422.
func TestInitiateChecksParent(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	cases := []struct {
		name, actor, tenant string
		u                   files.Upload
		code                string
	}{
		{"рейс чужой фирмы", "a.manager-msk2", "a", newUpload("trip:a1", "trip", files.PurposeInspection, "image/jpeg", "a.jpg", jpeg), "not_found"},
		{"рейс другого тенанта", "b.owner", "b", newUpload("trip:a1", "trip", files.PurposeInspection, "image/jpeg", "a.jpg", jpeg), "not_found"},
		{"рейс виден, загрузки нет", "ab.member", "a", newUpload("trip:a2", "trip", files.PurposeInspection, "image/jpeg", "a.jpg", jpeg), "forbidden_action"},
		{"родителя нет", "a.owner", "a", files.Upload{FileName: "a.jpg", ContentType: "image/jpeg", SizeBytes: 10, SHA256: digest(jpeg),
			Purpose: files.PurposeInspection, Owner: files.Ref{Module: "fleet", Entity: "trip", ID: uuid.New()}}, "not_found"},
		{"неизвестный вид родителя", "a.owner", "a", files.Upload{FileName: "a.jpg", ContentType: "image/jpeg", SizeBytes: 10, SHA256: digest(jpeg),
			Purpose: files.PurposeInspection, Owner: files.Ref{Module: "tasks", Entity: "task", ID: uuid.New()}}, "validation_failed"},
		{"чек к машине", "a.owner", "a", newUpload("vehicle:a1", "vehicle", files.PurposeExpenseReceipt, "image/jpeg", "a.jpg", jpeg), "validation_failed"},
		{"слишком большой", "a.owner", "a", func() files.Upload {
			u := newUpload("trip:a1", "trip", files.PurposeInspection, "image/jpeg", "a.jpg", jpeg)
			u.SizeBytes = files.MaxBytes + 1
			return u
		}(), "payload_too_large"},
	}
	for _, tc := range cases {
		if _, err := e.svc.Initiate(ctx, e.tc(t, tc.actor, tc.tenant), tc.u); !isCode(err, tc.code) {
			t.Errorf("%s: %v, want %s", tc.name, err, tc.code)
		}
	}
}

// S1-21, FILE-03: a file is visible when its parent is (the read action of the parent kind) and files.read covers
// the parent. Invisible — 404 like a missing id (AC-01); visible parent without files.read — 403; another tenant —
// 404 (AC-02).
func TestFileVisibility(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	f1 := e.ready(t, e.tc(t, "a.manager-msk1", "a"), newUpload("trip:a1", "trip", files.PurposeInspection, "image/jpeg", "Москва-1.jpg", jpeg), jpeg)
	f2 := e.ready(t, e.tc(t, "a.manager-msk2", "a"), newUpload("trip:a2", "trip", files.PurposeInspection, "image/jpeg", "Москва-2.jpg", jpeg), jpeg)
	cases := []struct {
		actor, tenant string
		file          uuid.UUID
		code          string // "" — visible
	}{
		{"a.owner", "a", f1.ID, ""},
		{"a.manager-msk1", "a", f1.ID, ""},
		{"a.region-msk", "a", f1.ID, ""},
		{"a.driver-msk1", "a", f1.ID, ""}, // the driver of the trip: scope «self»
		{"a.manager-msk2", "a", f1.ID, "not_found"},
		{"a.driver-msk1", "a", f2.ID, "not_found"},
		{"a.manager-msk1", "a", f2.ID, "not_found"},
		{"ab.member", "a", f2.ID, "forbidden_action"}, // sees the trip of Москва-2, no files.read
		{"a.admin", "a", f1.ID, "not_found"},          // no fleet.trips.read
		{"b.owner", "b", f1.ID, "not_found"},
		{"a.owner", "a", uuid.New(), "not_found"},
	}
	for _, tc := range cases {
		ctxA := e.tc(t, tc.actor, tc.tenant)
		_, errFile := e.svc.File(ctx, ctxA, tc.file)
		_, errDl := e.svc.Download(ctx, ctxA, tc.file)
		if tc.code == "" {
			if errFile != nil || errDl != nil {
				t.Errorf("%s → %s: File %v, Download %v", tc.actor, tc.file, errFile, errDl)
			}
			continue
		}
		if !isCode(errFile, tc.code) || !isCode(errDl, tc.code) {
			t.Errorf("%s → %s: File %v, Download %v; want %s", tc.actor, tc.file, errFile, errDl, tc.code)
		}
	}
}

func ids(page files.Page) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(page.Items))
	for _, f := range page.Items {
		out = append(out, f.ID)
	}
	return out
}

// listed returns the ids of a list of the actor (one page of up to 200).
func listed(t *testing.T, e env, tc tenantctx.TenantContext, q files.ListQuery) []uuid.UUID {
	t.Helper()
	q.Limit = 200
	page, err := e.svc.List(t.Context(), tc, q)
	if err != nil {
		t.Fatalf("List %+v: %v", q, err)
	}
	return ids(page)
}

// listFiles: files.read and reading the parent filter before pagination; newest first; filters; a cursor.
func TestList(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	m1 := e.tc(t, "a.manager-msk1", "a")
	f1 := e.ready(t, m1, newUpload("vehicle:a1", "vehicle", files.PurposeInspection, "image/jpeg", "Список 1.jpg", jpeg), jpeg)
	_, f2 := e.uploaded(t, m1, newUpload("vehicle:a1", "vehicle", files.PurposeInspection, "image/jpeg", "Список 2.jpg", jpeg), jpeg)
	f3 := e.ready(t, e.tc(t, "a.manager-msk2", "a"), newUpload("trip:a2", "trip", files.PurposeInspection, "image/jpeg", "Список 3.jpg", jpeg), jpeg)

	all := listed(t, e, e.tc(t, "a.owner", "a"), files.ListQuery{})
	expect(t, "owner list", all, slices.Contains(all, f1.ID), slices.Contains(all, f2.ID), slices.Contains(all, f3.ID),
		slices.Index(all, f2.ID) < slices.Index(all, f1.ID)) // newest first
	mine := listed(t, e, m1, files.ListQuery{})
	expect(t, "manager Москва-1", mine, slices.Contains(mine, f1.ID), !slices.Contains(mine, f3.ID))
	ready := listed(t, e, m1, files.ListQuery{Status: "ready"})
	expect(t, "status=ready", ready, slices.Contains(ready, f1.ID), !slices.Contains(ready, f2.ID))
	quarantined := listed(t, e, m1, files.ListQuery{Status: "quarantined"})
	expect(t, "status=quarantined", quarantined, !slices.Contains(quarantined, f1.ID), slices.Contains(quarantined, f2.ID))
	receipts := listed(t, e, m1, files.ListQuery{Purpose: string(files.PurposeExpenseReceipt)})
	expect(t, "purpose=expense_receipt", receipts, !slices.Contains(receipts, f1.ID))
	none := listed(t, e, e.tc(t, "ab.member", "a"), files.ListQuery{})
	expect(t, "no files.read", none, len(none) == 0)
	b := listed(t, e, e.tc(t, "b.owner", "b"), files.ListQuery{})
	expect(t, "tenant B", b, !slices.Contains(b, f1.ID))

	page, _ := e.svc.List(t.Context(), m1, files.ListQuery{Limit: 200})
	for _, it := range page.Items {
		if it.ID == f1.ID {
			expect(t, "item", it, it.OwnerTitle == "Р-208", it.Purpose == files.PurposeInspection, it.Owner.ID == parent["vehicle:a1"])
		}
	}
}

// The cursor continues the list without repeats and is bound to the filters of the first page.
func TestListCursor(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	tc := e.tc(t, "a.owner", "a")
	for i := range 3 {
		e.ready(t, tc, newUpload("trip:a1", "trip", files.PurposeExpenseReceipt, "image/jpeg", "Чек "+string(rune('A'+i))+".jpg", jpeg), jpeg)
	}
	q := files.ListQuery{Purpose: string(files.PurposeExpenseReceipt), Limit: 2}
	seen := map[uuid.UUID]bool{}
	for page := 0; ; page++ {
		p, err := e.svc.List(ctx, tc, q)
		if err != nil {
			t.Fatal(err)
		}
		for _, id := range ids(p) {
			if seen[id] {
				t.Fatalf("page %d repeats %s", page, id)
			}
			seen[id] = true
		}
		if p.Next == "" {
			break
		}
		if page > 50 {
			t.Fatal("endless pages")
		}
		other := q
		other.Cursor, other.Purpose = p.Next, string(files.PurposeInspection)
		if _, err := e.svc.List(ctx, tc, other); !isCode(err, "malformed_request") {
			t.Fatalf("cursor with other filters: %v", err)
		}
		q.Cursor = p.Next
	}
	if len(seen) < 3 {
		t.Fatalf("%d files", len(seen))
	}
	if _, err := e.svc.List(ctx, tc, files.ListQuery{Cursor: "not-a-cursor", Limit: 10}); !isCode(err, "malformed_request") {
		t.Fatalf("bad cursor: %v", err)
	}
	if _, err := e.svc.List(ctx, tc, files.ListQuery{Limit: 201}); !isCode(err, "validation_failed") {
		t.Fatalf("limit 201: %v", err)
	}
}

// revokeAll revokes the active grants of person in tenant A; the returned func restores them (also on cleanup).
func revokeAll(t *testing.T, person uuid.UUID) func() {
	t.Helper()
	d := db(t, "a")
	revoke := `update access.role_assignments set state = 'revoked', revoked_at = now() where principal_id = $1 and state = 'active'`
	if _, err := d.ExecContext(t.Context(), revoke, person); err != nil {
		t.Fatal(err)
	}
	restore := func() {
		q := `update access.role_assignments set state = 'active', revoked_at = null where principal_id = $1`
		if _, err := d.ExecContext(context.WithoutCancel(t.Context()), q, person); err != nil {
			t.Errorf("restore the grants of %s: %v", person, err)
		}
	}
	t.Cleanup(restore) // t.Context() is already cancelled in cleanups
	return restore
}

// completeUpload checks files.upload on the parent again, as initiateUpload did: an actor who lost the role
// between the ticket and complete does not get the file in (404 — the parent is invisible now); the reservation
// stays until the session closes. With the role back the same session completes. Sequential: it revokes grants of
// the shared fixtures.
func TestCompleteAfterRevoke(t *testing.T) { //nolint:paralleltest // revokes a grant of the shared fixtures
	e := newEnv(t)
	ctx := t.Context()
	tc := e.tc(t, "a.region-msk", "a")
	u := newUpload("trip:a1", "trip", files.PurposeInspection, "image/jpeg", "Роль отозвана.jpg", jpeg)
	ticket, err := e.svc.Initiate(ctx, tc, u)
	if err != nil {
		t.Fatal(err)
	}
	put(t, ticket, "image/jpeg", jpeg)
	restore := revokeAll(t, ref("person:a.region-msk@a"))
	_, err = e.svc.Complete(ctx, tc, ticket.UploadID, u.SHA256)
	expect(t, "complete after revoke", err, isCode(err, "not_found"))
	s, err := e.svc.Session(ctx, tc, ticket.UploadID)
	expect(t, "session after a refused complete", s, err == nil, s.State == "uploaded", s.ReservedBytes == u.SizeBytes)
	restore()
	f, err := e.svc.Complete(ctx, tc, ticket.UploadID, u.SHA256)
	expect(t, "complete with the role back", f, err == nil, f.Status == "quarantined")
}

// AC-10 for files (Q-W1.04-15): the permission is checked on every download — after the role is revoked the next
// URL is not issued. Sequential: it changes a grant of the fixtures and restores it.
func TestAC10DownloadAfterRevoke(t *testing.T) { //nolint:paralleltest // revokes a grant of the shared fixtures
	e := newEnv(t)
	ctx := t.Context()
	tc := e.tc(t, "a.region-msk", "a")
	f := e.ready(t, tc, newUpload("trip:a1", "trip", files.PurposeInspection, "image/jpeg", "AC-10.jpg", jpeg), jpeg)
	if _, err := e.svc.Download(ctx, tc, f.ID); err != nil {
		t.Fatal(err)
	}
	revokeAll(t, ref("person:a.region-msk@a"))
	if _, err := e.svc.Download(ctx, tc, f.ID); !isCode(err, "not_found") {
		t.Fatalf("download after revoke: %v", err)
	}
}
