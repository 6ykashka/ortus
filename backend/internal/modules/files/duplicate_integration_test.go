//go:build integration

package files_test

import (
	"bytes"
	"crypto/rand"
	"testing"

	filesapi "github.com/ortus/ortus-crm/backend/internal/api/files"
	"github.com/ortus/ortus-crm/backend/internal/modules/files" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// unique is a JPEG whose bytes no other test uploads: the tenant DB is shared by the parallel tests of the package.
func unique(t *testing.T) []byte {
	t.Helper()
	tail := make([]byte, 16)
	if _, err := rand.Read(tail); err != nil {
		t.Fatal(err)
	}
	return append(bytes.Clone(jpeg), tail...)
}

// wantDuplicate checks File.duplicateWarning of f: nil — none.
func wantDuplicate(t *testing.T, what string, f files.File, want *files.Duplicate) {
	t.Helper()
	switch {
	case want == nil && f.Duplicate != nil:
		t.Fatalf("%s: unexpected duplicate %+v", what, *f.Duplicate)
	case want != nil && f.Duplicate == nil:
		t.Fatalf("%s: no duplicate, want %+v", what, *want)
	case want != nil && (!f.Duplicate.FirstSeenAt.Equal(want.FirstSeenAt) || f.Duplicate.PreviousCount != want.PreviousCount ||
		f.Duplicate.SameOwner != want.SameOwner):
		t.Fatalf("%s: duplicate %+v, want %+v", what, *f.Duplicate, *want)
	}
}

// Модель данных 4 (ответ владельца 17.10): sha256 файла с предупреждением о повторе. completeUpload and getFile warn
// when earlier files of the tenant have the same bytes: verified (completeUpload) and not rejected ones count, an
// upload that never completed does not; the warning holds the count, the first moment and «the same parent» only —
// never a refusal. Another tenant never counts (AC-02).
func TestDuplicateWarning(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	tc := e.tc(t, "a.manager-msk1", "a")
	content := unique(t)
	upload := func(owner, entity, name string) files.File {
		t.Helper()
		_, f := e.uploaded(t, tc, newUpload(owner, entity, files.PurposeInspection, "image/jpeg", name, content), content)
		return f
	}
	first := upload("trip:a1", "trip", "Р-208 · спереди.jpg")
	wantDuplicate(t, "first upload", first, nil)
	second := upload("vehicle:a1", "vehicle", "Р-208 · спереди (2).jpg")
	wantDuplicate(t, "the same bytes on another parent", second, &files.Duplicate{FirstSeenAt: first.CreatedAt, PreviousCount: 1})
	// Started and never completed: its sha256 is a claim of the client, not checked bytes.
	if _, err := e.svc.Initiate(ctx, tc, newUpload("trip:a1", "trip", files.PurposeInspection, "image/jpeg", "Не дошло.jpg", content)); err != nil {
		t.Fatal(err)
	}
	third := upload("trip:a1", "trip", "Р-208 · спереди (3).jpg")
	wantDuplicate(t, "the same parent", third, &files.Duplicate{FirstSeenAt: first.CreatedAt, PreviousCount: 2, SameOwner: true})

	got, err := e.svc.File(ctx, tc, first.ID)
	expect(t, "File of the first", got, err == nil)
	wantDuplicate(t, "File of the first", got, nil)
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db(t, "a").ExecContext(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`update files.objects set state = 'rejected', rejected_code = 'malware' where id = $1`, second.ID)
	got, err = e.svc.File(ctx, tc, third.ID)
	expect(t, "File of the third", got, err == nil)
	wantDuplicate(t, "a rejected file does not count", got, &files.Duplicate{FirstSeenAt: first.CreatedAt, PreviousCount: 1, SameOwner: true})

	srv := files.Server{S: e.svc}
	resp, err := srv.GetFile(tenantctx.WithTenant(ctx, tc), filesapi.GetFileRequestObject{TenantId: tc.TenantID, FileId: third.ID})
	ok200, ok := resp.(filesapi.GetFile200JSONResponse)
	expect(t, "getFile", resp, err == nil, ok)
	w := ok200.Body.DuplicateWarning
	expect(t, "getFile duplicateWarning", w, w != nil, w != nil && w.Code == filesapi.DuplicateSha256 && w.PreviousCount == 1 &&
		w.SameOwner && w.FirstSeenAt.Equal(first.CreatedAt))
	again, err := srv.GetFile(tenantctx.WithTenant(ctx, tc), filesapi.GetFileRequestObject{TenantId: tc.TenantID, FileId: first.ID})
	body, ok := again.(filesapi.GetFile200JSONResponse)
	expect(t, "getFile of the first", again, err == nil, ok, body.Body.DuplicateWarning == nil)

	other := e.tc(t, "b.owner", "b")
	_, alien := e.uploaded(t, other, newUpload("trip:b1", "trip", files.PurposeInspection, "image/jpeg", "Чужой.jpg", content), content)
	wantDuplicate(t, "another tenant", alien, nil)
}
