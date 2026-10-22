//go:build integration

package files_test

import (
	"slices"
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/files" //nolint:depguard // the package under test
)

// W4.21, return 4 (review, merge with W2.79): FilePlaceholder in the rows of the parent itself is the id of the file
// read through it — in getFile, getFileDownload and listFiles alike — and null on an upload, next to the shares of the
// kind (W2.79 binds the same placeholder in Share.Rows). A kind that closes some of its files by their ids (as forms/form
// does with the files of the answers, Q-W4.00-forms-9) keeps them closed: a stand-in id (uuid.Nil) is neither null nor
// closed and opens them, an untyped one fails the statement. The trip of the fleet, with its share of W2.79, closes here
// one photo to the manager; both spellings of the condition (null first, as formParent of cmd/api, and null last).
func TestOwnScopeReadsTheFile(t *testing.T) {
	t.Parallel()
	const (
		file   = files.FilePlaceholder
		closes = file + ` <> all(` + files.HiddenPlaceholder + `)`
	)
	for name, cond := range map[string]string{
		"null first": `(` + file + ` is null or ` + closes + `)`,
		"null last":  `(` + closes + ` or ` + file + ` is null)`,
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			ownScopeReadsTheFile(t, cond)
		})
	}
}

// ownScopeReadsTheFile checks the trip whose own rows also require cond (FilePlaceholder against HiddenPlaceholder).
func ownScopeReadsTheFile(t *testing.T, cond string) {
	t.Helper()
	e := newEnv(t)
	ctx := t.Context()
	manager, owner := e.tc(t, "a.manager-msk1", "a"), e.tc(t, "a.owner", "a")
	closed := e.ready(t, manager, newUpload("trip:a1", "trip", files.PurposeInspection, "image/jpeg", "Закрытое.jpg", jpeg), jpeg)
	open := e.ready(t, manager, newUpload("trip:a1", "trip", files.PurposeInspection, "image/jpeg", "Открытое.jpg", jpeg), jpeg)

	kinds := files.FleetParents()
	for i := range kinds {
		if kinds[i].Entity == "trip" {
			if len(kinds[i].Shares) == 0 {
				t.Fatal("the trip lost its share of W2.79: the test no longer checks the parent next to a share")
			}
			kinds[i].Rows += ` and ` + cond
		}
	}
	parents, err := files.NewParents(kinds...)
	if err != nil {
		t.Fatal(err)
	}
	e.svc.Parents = parents
	e.svc.Hidden = hider{manager.PersonID: {Hidden: []uuid.UUID{closed.ID}}}

	_, errFile := e.svc.File(ctx, manager, closed.ID)
	_, errDl := e.svc.Download(ctx, manager, closed.ID)
	if !isCode(errFile, "not_found") || !isCode(errDl, "not_found") {
		t.Errorf("a file its parent closes by its id: File %v, Download %v; want not_found", errFile, errDl)
	}
	if f, err := e.svc.File(ctx, manager, open.ID); err != nil || f.ID != open.ID {
		t.Errorf("another file of the same parent: %+v %v", f.ID, err)
	}
	if got := listed(t, e, manager, files.ListQuery{}); slices.Contains(got, closed.ID) || !slices.Contains(got, open.ID) {
		t.Errorf("listFiles %v: want %s without %s", got, open.ID, closed.ID)
	}
	if _, err := e.svc.File(ctx, owner, closed.ID); err != nil {
		t.Errorf("the file for a subject the Hider does not close it to: %v", err)
	}
	upload := newUpload("trip:a1", "trip", files.PurposeInspection, "image/jpeg", "Ещё.jpg", jpeg)
	if _, err := e.svc.Initiate(ctx, manager, upload); err != nil {
		t.Errorf("an upload binds null (no file yet) and takes the parent: %v", err)
	}
}
