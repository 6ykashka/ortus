//go:build integration

package files_test

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/files" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// S1-20: reserve quota → presigned PUT → complete (202, quarantined) → check → ready; the session shows every step;
// the reservation turns into committed bytes in the ledger; the object leaves quarantine.
func TestUploadToReady(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	tc := e.tc(t, "a.manager-msk1", "a")
	u := newUpload("trip:a1", "trip", files.PurposeInspection, "image/jpeg", "Р-208 · спереди.jpg", jpeg)
	ticket, err := e.svc.Initiate(ctx, tc, u)
	if err != nil {
		t.Fatal(err)
	}
	expect(t, "ticket", ticket, ticket.ContentType == "image/jpeg", ticket.SHA256 == u.SHA256, ticket.MaxBytes == files.MaxBytes,
		time.Until(ticket.ExpiresAt) <= files.TicketTTL, time.Until(ticket.ExpiresAt) > 0,
		!strings.Contains(ticket.URL, parent["trip:a1"].String()), strings.Contains(ticket.URL, "quarantine/"))
	s, err := e.svc.Session(ctx, tc, ticket.UploadID)
	expect(t, "session after initiate", s, err == nil, s.State == "issued", s.FileStatus == "pending_upload",
		s.ReservedBytes == u.SizeBytes)
	put(t, ticket, "image/jpeg", jpeg)
	s, _ = e.svc.Session(ctx, tc, ticket.UploadID)
	expect(t, "session after PUT", s, s.State == "uploaded")
	f, err := e.svc.Complete(ctx, tc, ticket.UploadID, u.SHA256)
	expect(t, "complete", f, err == nil, f.Status == "quarantined", f.FileName == u.FileName, f.ContentType == "image/jpeg",
		f.SizeBytes == u.SizeBytes, f.SHA256 == u.SHA256)
	_, err = e.svc.Download(ctx, tc, f.ID)
	expect(t, "download before the check", err, isCode(err, "photo_not_ready"))
	d := db(t, "a")
	n := scalar[int](t, d, `select count(*) from outbox.events where type = $1 and aggregate_id = $2`, files.EventUploaded, f.ID)
	expect(t, "events "+files.EventUploaded, n, n == 1)
	e.scan(t, "a", f.ID)
	s, _ = e.svc.Session(ctx, tc, ticket.UploadID)
	expect(t, "session after the check", s, s.State == "completed", s.FileStatus == "ready")
	ledger := scalar[string](t, d, `select string_agg(kind, ',' order by id) from files.quota_ledger where file_id = $1`, f.ID)
	expect(t, "ledger", ledger, ledger == "reserve,commit")
	_, err = e.s3.Stat(ctx, files.QuarantineKey(tc.TenantID, f.ID))
	expect(t, "quarantine after the check", err, errors.Is(err, storage.ErrNotFound))
	downloadReady(t, e, tc, f.ID)
}

// downloadReady checks a ready file of trip:a1: metadata with its parent, a short URL that returns the content.
func downloadReady(t *testing.T, e env, tc tenantctx.TenantContext, id uuid.UUID) {
	t.Helper()
	got, err := e.svc.File(t.Context(), tc, id)
	expect(t, "File", got, err == nil, got.Status == "ready", got.Owner.Kind() == "fleet.trip", got.OwnerTitle == "TR-2026-000101")
	dl, err := e.svc.Download(t.Context(), tc, id)
	expect(t, "download", dl, err == nil, time.Until(dl.ExpiresAt) <= files.DownloadTTL, dl.FileID == id)
	r, err := http.NewRequestWithContext(t.Context(), http.MethodGet, dl.URL, http.NoBody)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	expect(t, "GET download", resp.StatusCode, resp.StatusCode == http.StatusOK, bytes.Equal(body, jpeg))
}

// FILE-02: a file with malware is rejected after complete; its bytes are released and it is never downloadable.
func TestUploadRejectedMalware(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	tc := e.tc(t, "a.driver-msk1", "a")
	content := []byte("%PDF-1.7\n" + `X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`)
	u := newUpload("expense:a1", "expense", files.PurposeExpenseReceipt, "application/pdf", "Чек.pdf", content)
	_, f := e.uploaded(t, tc, u, content)
	e.scan(t, "a", f.ID)
	got, err := e.svc.File(t.Context(), tc, f.ID)
	if err != nil || got.Status != "rejected" {
		t.Fatalf("File: %+v %v", got, err)
	}
	d := db(t, "a")
	if code := scalar[string](t, d, `select rejected_code from files.objects where id = $1`, f.ID); code != files.CodeMalware {
		t.Fatalf("rejected_code %s", code)
	}
	if ledger := scalar[string](t, d, `select string_agg(kind, ',' order by id) from files.quota_ledger where file_id = $1`, f.ID); ledger != "reserve,commit,release" {
		t.Fatalf("ledger %s", ledger)
	}
	if _, err := e.svc.Download(t.Context(), tc, f.ID); !isCode(err, "photo_not_ready") {
		t.Fatalf("download of a rejected file: %v", err)
	}
	if n := scalar[int](t, d, `select count(*) from outbox.events where type = $1 and aggregate_id = $2`, files.EventRejected, f.ID); n != 1 {
		t.Fatalf("%d rejected events", n)
	}
}

// The real type must be the declared one: a PNG sent as a JPEG is rejected (mime_mismatch).
func TestUploadRejectedMIME(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	tc := e.tc(t, "a.manager-msk1", "a")
	png := append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{7}, 100)...)
	u := newUpload("vehicle:a1", "vehicle", files.PurposeInspection, "image/jpeg", "Р-208.jpg", png)
	_, f := e.uploaded(t, tc, u, png)
	e.scan(t, "a", f.ID)
	if got, _ := e.svc.File(t.Context(), tc, f.ID); got.Status != "rejected" {
		t.Fatalf("status %s", got.Status)
	}
	if code := scalar[string](t, db(t, "a"), `select rejected_code from files.objects where id = $1`, f.ID); code != files.CodeMIMEMismatch {
		t.Fatalf("rejected_code %s", code)
	}
}

// completeUpload verifies the object: checksum of the body, presence, size and content of the object.
func TestCompleteVerifiesObject(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	tc := e.tc(t, "a.manager-msk1", "a")
	u := newUpload("reservation:a1", "reservation", files.PurposeInspection, "image/jpeg", "Р-208 · слева.jpg", jpeg)
	ticket, err := e.svc.Initiate(ctx, tc, u)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Complete(ctx, tc, ticket.UploadID, strings.Repeat("0", 64)); !isCode(err, "validation_failed") {
		t.Fatalf("another checksum: %v", err)
	}
	if _, err := e.svc.Complete(ctx, tc, ticket.UploadID, u.SHA256); !isCode(err, "invalid_transition") {
		t.Fatalf("complete before PUT: %v", err)
	}
	other := bytes.Clone(jpeg)
	other[len(other)-1] = 'X'
	put(t, ticket, "image/jpeg", other)
	if _, err := e.svc.Complete(ctx, tc, ticket.UploadID, u.SHA256); !isCode(err, "validation_failed") {
		t.Fatalf("another content: %v", err)
	}
	put(t, ticket, "image/jpeg", jpeg) // the ticket is still valid: the client retries
	if f, err := e.svc.Complete(ctx, tc, ticket.UploadID, u.SHA256); err != nil || f.Status != "quarantined" {
		t.Fatalf("complete after the right PUT: %+v %v", f, err)
	}
}

// FILE-02, PLAT-07: the ticket holds the declared size — storage refuses a larger body (a ticket for a few bytes
// cannot put a large object into the shared bucket outside the quota) and a shorter one; nothing lands in quarantine.
func TestTicketLimitsSize(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	tc := e.tc(t, "a.driver-msk1", "a")
	u := newUpload("trip:a1", "trip", files.PurposeInspection, "image/jpeg", "Мало заявлено.jpg", jpeg)
	ticket, err := e.svc.Initiate(ctx, tc, u)
	if err != nil {
		t.Fatal(err)
	}
	larger := append(bytes.Clone(jpeg), bytes.Repeat([]byte("ortus"), 16<<10)...)
	for _, body := range [][]byte{larger, jpeg[:len(jpeg)-1]} {
		if code, msg := putStatus(t, ticket, "image/jpeg", body); code != http.StatusForbidden {
			t.Fatalf("PUT of %d bytes on a ticket for %d: %d %s", len(body), u.SizeBytes, code, msg)
		}
		if _, err := e.s3.Stat(ctx, files.QuarantineKey(tc.TenantID, ticket.FileID)); !errors.Is(err, storage.ErrNotFound) {
			t.Fatalf("object of %d bytes in quarantine: %v", len(body), err)
		}
	}
	put(t, ticket, "image/jpeg", jpeg)
	if _, err := e.svc.Complete(ctx, tc, ticket.UploadID, u.SHA256); err != nil {
		t.Fatalf("complete of the declared size: %v", err)
	}
}

// objectKey is the storage key the worker will check for a file.
func objectKey(t *testing.T, tenant string, file uuid.UUID) string {
	t.Helper()
	return scalar[string](t, db(t, tenant), `select object_key from files.objects where id = $1`, file)
}

// overwrite stores content at key as a client with a ticket for it would.
func overwrite(t *testing.T, e env, key string, content []byte) {
	t.Helper()
	url, err := e.s3.PresignPut(key, "image/jpeg", int64(len(content)), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if code, msg := putStatus(t, files.Ticket{URL: url}, "image/jpeg", content); code != http.StatusOK {
		t.Fatalf("overwrite %s: %d %s", key, code, msg)
	}
}

// The ticket outlives completeUpload (15 minutes): a PUT of another content of the same size and type after the
// verification does not reach the check — the worker checks and keeps what completeUpload verified, and File.sha256
// describes the stored object.
func TestCompleteKeepsVerifiedObject(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	tc := e.tc(t, "a.manager-msk1", "a")
	u := newUpload("trip:a1", "trip", files.PurposeInspection, "image/jpeg", "Подмена.jpg", jpeg)
	ticket, f := e.uploaded(t, tc, u, jpeg)
	swapped := bytes.Clone(jpeg)
	swapped[len(swapped)-1] = 'X'
	put(t, ticket, "image/jpeg", swapped) // the ticket is still valid
	e.scan(t, "a", f.ID)
	got, err := e.svc.File(t.Context(), tc, f.ID)
	expect(t, "file after the check", got, err == nil, got.Status == "ready", got.SHA256 == digest(jpeg))
	downloadReady(t, e, tc, f.ID)
}

// The worker compares the checked object with File.sha256 and sizeBytes: an object changed in storage after
// completeUpload is rejected (checksum_mismatch), its bytes are released.
func TestWorkerRejectsChangedObject(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	tc := e.tc(t, "a.manager-msk1", "a")
	_, f := e.uploaded(t, tc, newUpload("trip:a1", "trip", files.PurposeInspection, "image/jpeg", "Изменён.jpg", jpeg), jpeg)
	changed := bytes.Clone(jpeg)
	changed[len(changed)-1] = 'X'
	overwrite(t, e, objectKey(t, "a", f.ID), changed)
	e.scan(t, "a", f.ID)
	d := db(t, "a")
	code := scalar[string](t, d, `select coalesce(rejected_code, state) from files.objects where id = $1`, f.ID)
	expect(t, "rejected code", code, code == "checksum_mismatch")
	ledger := scalar[string](t, d, `select string_agg(kind, ',' order by id) from files.quota_ledger where file_id = $1`, f.ID)
	expect(t, "ledger", ledger, ledger == "reserve,commit,release")
}

// AC-07: completeUpload repeated concurrently has one effect — one 202, the others 409, one commit in the ledger.
func TestCompleteOnce(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	tc := e.tc(t, "a.manager-msk1", "a")
	u := newUpload("trip:a1", "trip", files.PurposeInspection, "image/jpeg", "Р-208 · сзади.jpg", jpeg)
	ticket, err := e.svc.Initiate(t.Context(), tc, u)
	if err != nil {
		t.Fatal(err)
	}
	put(t, ticket, "image/jpeg", jpeg)
	var (
		wg            sync.WaitGroup
		mu            sync.Mutex
		ok, conflicts int
	)
	for range 10 {
		wg.Go(func() {
			_, err := e.svc.Complete(t.Context(), tc, ticket.UploadID, u.SHA256)
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				ok++
			case isCode(err, "invalid_transition"):
				conflicts++
			default:
				t.Errorf("complete: %v", err)
			}
		})
	}
	wg.Wait()
	if ok != 1 || conflicts != 9 {
		t.Fatalf("%d completed, %d conflicts", ok, conflicts)
	}
	n := scalar[int](t, db(t, "a"), `select count(*) from files.quota_ledger where file_id = $1 and kind = 'commit'`, ticket.FileID)
	if n != 1 {
		t.Fatalf("%d commits", n)
	}
}

// abortUpload releases the reservation and deletes the object; a closed session answers 204 again; a completed one
// is 409; the aborted upload cannot be completed.
func TestAbort(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	tc := e.tc(t, "a.manager-msk1", "a")
	u := newUpload("trip:a1", "trip", files.PurposeInspection, "image/jpeg", "Отмена.jpg", jpeg)
	ticket, err := e.svc.Initiate(ctx, tc, u)
	if err != nil {
		t.Fatal(err)
	}
	put(t, ticket, "image/jpeg", jpeg)
	for range 2 {
		if err := e.svc.Abort(ctx, tc, ticket.UploadID); err != nil {
			t.Fatalf("Abort: %v", err)
		}
	}
	s, err := e.svc.Session(ctx, tc, ticket.UploadID)
	if err != nil || s.State != "aborted" || s.ReservedBytes != 0 {
		t.Fatalf("session: %+v %v", s, err)
	}
	if _, err := e.s3.Stat(ctx, files.QuarantineKey(tc.TenantID, ticket.FileID)); !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("object after abort: %v", err)
	}
	if _, err := e.svc.Complete(ctx, tc, ticket.UploadID, u.SHA256); !isCode(err, "not_found") {
		t.Fatalf("complete after abort: %v", err)
	}
	if _, err := e.svc.File(ctx, tc, ticket.FileID); !isCode(err, "not_found") {
		t.Fatalf("file of an aborted upload: %v", err)
	}
	ledger := scalar[string](t, db(t, "a"), `select string_agg(kind, ',' order by id) from files.quota_ledger where file_id = $1`, ticket.FileID)
	if ledger != "reserve,release" {
		t.Fatalf("ledger %s", ledger)
	}
	done, _ := e.uploaded(t, tc, newUpload("trip:a1", "trip", files.PurposeInspection, "image/jpeg", "Готово.jpg", jpeg), jpeg)
	if err := e.svc.Abort(ctx, tc, done.UploadID); !isCode(err, "invalid_transition") {
		t.Fatalf("abort of a completed upload: %v", err)
	}
}

// A session is seen only by the actor who started it: another one gets 404 as for a missing id.
func TestSessionOfAnotherActor(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	owner := e.tc(t, "a.manager-msk1", "a")
	ticket, err := e.svc.Initiate(ctx, owner, newUpload("trip:a1", "trip", files.PurposeInspection, "image/jpeg", "a.jpg", jpeg))
	if err != nil {
		t.Fatal(err)
	}
	for _, actor := range []string{"a.region-msk", "a.owner"} {
		other := e.tc(t, actor, "a")
		if _, err := e.svc.Session(ctx, other, ticket.UploadID); !isCode(err, "not_found") {
			t.Errorf("%s: Session %v", actor, err)
		}
		if _, err := e.svc.Complete(ctx, other, ticket.UploadID, digest(jpeg)); !isCode(err, "not_found") {
			t.Errorf("%s: Complete %v", actor, err)
		}
		if err := e.svc.Abort(ctx, other, ticket.UploadID); !isCode(err, "not_found") {
			t.Errorf("%s: Abort %v", actor, err)
		}
	}
	if _, err := e.svc.Session(ctx, owner, uuid.New()); !isCode(err, "not_found") {
		t.Errorf("missing session: %v", err)
	}
}

// An expired session is closed when read and by the deadline event of the worker: the reservation is released.
func TestExpiry(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	tc := e.tc(t, "a.manager-msk1", "a")
	later := *e.svc
	later.Now = func() time.Time { return time.Now().Add(files.SessionTTL + time.Minute) }

	first, err := e.svc.Initiate(ctx, tc, newUpload("trip:a1", "trip", files.PurposeInspection, "image/jpeg", "1.jpg", jpeg))
	if err != nil {
		t.Fatal(err)
	}
	if s, err := later.Session(ctx, tc, first.UploadID); err != nil || s.State != "expired" || s.ReservedBytes != 0 {
		t.Fatalf("expired session: %+v %v", s, err)
	}
	if _, err := later.Complete(ctx, tc, first.UploadID, digest(jpeg)); !isCode(err, "not_found") {
		t.Fatalf("complete of an expired session: %v", err)
	}

	second, err := e.svc.Initiate(ctx, tc, newUpload("trip:a1", "trip", files.PurposeInspection, "image/jpeg", "2.jpg", jpeg))
	if err != nil {
		t.Fatal(err)
	}
	d := db(t, "a")
	eventID := scalar[uuid.UUID](t, d, `select event_id from outbox.events where type = $1 and aggregate_id = $2`, files.EventDeadline, second.UploadID)
	m := deadline(tc, eventID, second.UploadID)
	if err := e.worker.Expire(ctx, m); err == nil {
		t.Fatal("the deadline of a live session is handled")
	}
	lateWorker := *e.worker
	lateWorker.Now = later.Now
	for range 2 { // a repeated delivery has no effect
		if err := lateWorker.Expire(ctx, m); err != nil {
			t.Fatal(err)
		}
	}
	if s, _ := e.svc.Session(ctx, tc, second.UploadID); s.State != "expired" {
		t.Fatalf("session after the deadline: %+v", s)
	}
	ledger := scalar[string](t, d, `select string_agg(kind, ',' order by id) from files.quota_ledger where file_id = $1`, second.FileID)
	if ledger != "reserve,release" {
		t.Fatalf("ledger %s", ledger)
	}
}

// The worker is idempotent: a repeated delivery of a checked file, an unknown file or session does nothing; a
// file whose object vanished from quarantine is rejected (object_missing) and its bytes are released.
func TestWorkerEdges(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	tc := e.tc(t, "a.manager-msk1", "a")
	f := e.ready(t, tc, newUpload("trip:a1", "trip", files.PurposeInspection, "image/jpeg", "Повтор.jpg", jpeg), jpeg)
	e.scan(t, "a", f.ID) // the second delivery
	d := db(t, "a")
	n := scalar[int](t, d, `select count(*) from outbox.events where type = $1 and aggregate_id = $2`, files.EventReady, f.ID)
	expect(t, "ready events after a repeated delivery", n, n == 1)
	e.scan(t, "a", uuid.New())
	if err := e.worker.Expire(t.Context(), deadline(tc, uuid.New(), uuid.New())); err != nil {
		t.Fatalf("deadline of an unknown session: %v", err)
	}

	_, lost := e.uploaded(t, tc, newUpload("trip:a1", "trip", files.PurposeInspection, "image/jpeg", "Пропал.jpg", jpeg), jpeg)
	if err := e.s3.Delete(t.Context(), objectKey(t, "a", lost.ID)); err != nil {
		t.Fatal(err)
	}
	e.scan(t, "a", lost.ID)
	code := scalar[string](t, d, `select rejected_code from files.objects where id = $1`, lost.ID)
	expect(t, "rejected code", code, code == files.CodeObjectMissing)
}

// Without object storage (S3_ENDPOINT unset) metadata is readable, uploads and downloads answer 503.
func TestWithoutStorage(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	tc := e.tc(t, "a.manager-msk1", "a")
	f := e.ready(t, tc, newUpload("trip:a1", "trip", files.PurposeInspection, "image/jpeg", "Без S3.jpg", jpeg), jpeg)
	ticket, err := e.svc.Initiate(ctx, tc, newUpload("trip:a1", "trip", files.PurposeInspection, "image/jpeg", "Позже.jpg", jpeg))
	if err != nil {
		t.Fatal(err)
	}
	offline := *e.svc
	offline.Store = nil
	got, err := offline.File(ctx, tc, f.ID)
	expect(t, "File without storage", got, err == nil, got.Status == "ready")
	_, err = offline.Download(ctx, tc, f.ID)
	wantCode(t, err, "dependency_unavailable")
	s, err := offline.Session(ctx, tc, ticket.UploadID)
	expect(t, "Session without storage", s, err == nil, s.State == "issued")
	_, err = offline.Complete(ctx, tc, ticket.UploadID, digest(jpeg))
	wantCode(t, err, "dependency_unavailable")
	_, err = offline.Initiate(ctx, tc, newUpload("trip:a1", "trip", files.PurposeInspection, "image/jpeg", "Нет.jpg", jpeg))
	wantCode(t, err, "dependency_unavailable")
	if err := offline.Abort(ctx, tc, ticket.UploadID); err != nil {
		t.Fatalf("abort without storage: %v", err)
	}
}
