//go:build integration

package files_test

import (
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/files" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
)

// formFile is a checked photo of tenant A moved under the form (the parent forms/form, as the module of forms owns the
// files of the answers): its bytes are in storage, its size in the committed quota.
func formFile(t *testing.T, e env, form uuid.UUID, name string) files.File {
	t.Helper()
	f := e.ready(t, e.tc(t, "a.owner", "a"), newUpload("trip:a1", "trip", files.PurposeInspection, "image/jpeg", name, jpeg), jpeg)
	if _, err := db(t, "a").ExecContext(t.Context(), `update files.objects set owner_type = 'forms.form', owner_id = $2,
		purpose = 'form_attachment' where id = $1`, f.ID, form); err != nil {
		t.Fatal(err)
	}
	return f
}

// The port of «Формы» (W4.21, return 1; Q-W4.00-forms-22, D-26): «Хранить ответы» deletes the files of the answers of
// the deleted responses with them. files.quota_ledger is append-only and refers to the object, so the row of the file
// stays as rejected «retention_deleted» (nothing reads or downloads it): its committed bytes are released in the
// transaction of the caller with a «release» in the ledger, its bytes are removed from storage after the commit. Only
// a ready file of that form is touched.
//
//nolint:paralleltest // compares the committed quota of tenant A
func TestPurgeFormFiles(t *testing.T) {
	e := newEnv(t)
	ctx, d := t.Context(), db(t, "a")
	form := uuid.New()
	doomed, kept := formFile(t, e, form, "purge-1.jpg"), formFile(t, e, form, "purge-2.jpg")
	foreign := e.ready(t, e.tc(t, "a.owner", "a"), newUpload("trip:a1", "trip", files.PurposeInspection, "image/jpeg", "trip.jpg", jpeg), jpeg)
	key := scalar[string](t, d, `select object_key from files.objects where id = $1`, doomed.ID)
	before := scalar[int64](t, d, `select committed_bytes from files.usage`)

	pool, err := e.pools.For(ctx, ref("tenant:a"))
	if err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	after, err := e.svc.PurgeFormFiles(ctx, tx, ref("tenant:a"), form, []uuid.UUID{doomed.ID, foreign.ID, uuid.New()})
	if err != nil {
		_ = tx.Rollback(ctx)
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := after(ctx); err != nil {
		t.Fatalf("after the commit: %v", err)
	}

	state := scalar[string](t, d, `select state || ' ' || coalesce(rejected_code, '') from files.objects where id = $1`, doomed.ID)
	expect(t, "the purged file", state, state == "rejected "+files.CodeRetention)
	expect(t, "the committed quota", before, scalar[int64](t, d, `select committed_bytes from files.usage`) == before-int64(len(jpeg)))
	ledger := scalar[string](t, d, `select string_agg(kind, ',' order by id) from files.quota_ledger where file_id = $1`, doomed.ID)
	expect(t, "the ledger", ledger, ledger == "reserve,commit,release")
	// Return 2: the subscribers of the files learn that the file is gone, as from a rejection of the check.
	events := scalar[int](t, d, `select count(*) from outbox.events where type = $1 and aggregate_id = $2
		and payload->>'rejectedCode' = $3 and payload->>'ownerType' = 'forms.form'`, files.EventRejected, doomed.ID, files.CodeRetention)
	expect(t, "the event of the purged file", events, events == 1)
	if _, _, err := e.s3.Open(ctx, key); !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("the bytes of the purged file: %v, want not found", err)
	}
	for _, id := range []uuid.UUID{kept.ID, foreign.ID} {
		expect(t, "an untouched file", id, scalar[string](t, d, `select state from files.objects where id = $1`, id) == "ready")
	}

	again, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = again.Rollback(ctx) }()
	after, err = e.svc.PurgeFormFiles(ctx, again, ref("tenant:a"), form, []uuid.UUID{doomed.ID})
	if err != nil || after(ctx) != nil {
		t.Fatalf("a second purge: %v", err)
	}
	expect(t, "a second purge releases nothing", before, scalar[int64](t, d, `select committed_bytes from files.usage`) == before-int64(len(jpeg)))
	expect(t, "a second purge publishes nothing", events, scalar[int](t, d, `select count(*) from outbox.events where type = $1
		and aggregate_id = $2`, files.EventRejected, doomed.ID) == 1)
}
