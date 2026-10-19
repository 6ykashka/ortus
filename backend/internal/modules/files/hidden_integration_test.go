//go:build integration

package files_test

import (
	"context"
	"slices"
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/files" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// hider closes trips to people (files.Hider as the pool of cmd/api: the trips of the transfers of the subject closed
// to him now, and the trips left to their continuation).
type hider map[uuid.UUID]files.Closed

func (h hider) Closed(_ context.Context, tc tenantctx.TenantContext) (files.Closed, error) {
	return h[tc.PersonID], nil
}

// W2.57 (AC-06, Q-W2.07-1 «только рейс»): a trip the pool closes to its driver closes its files to him — the photos
// of the trip (uploaded by the logist too), the receipts of its expenses — in getFile, getFileDownload and listFiles
// (before the pagination), and no upload attaches to it or to its reservation; the others keep their files, and
// without a Hider nothing is hidden.
func TestHiddenTripsCloseTheirFiles(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	driver, manager := e.tc(t, "a.driver-msk1", "a"), e.tc(t, "a.manager-msk1", "a")
	photo := e.ready(t, manager, newUpload("trip:a1", "trip", files.PurposeInspection, "image/jpeg", "Рейс.jpg", jpeg), jpeg)
	receipt := e.ready(t, driver, newUpload("expense:a1", "expense", files.PurposeExpenseReceipt, "image/jpeg", "Чек.jpg", jpeg), jpeg)
	for _, f := range []files.File{photo, receipt} {
		if _, err := e.svc.File(ctx, driver, f.ID); err != nil {
			t.Fatalf("before the pool closes the trip: %s — %v", f.FileName, err)
		}
	}
	e.svc.Hidden = hider{driver.PersonID: {Hidden: []uuid.UUID{parent["trip:a1"]}}}
	for _, f := range []files.File{photo, receipt} {
		_, errFile := e.svc.File(ctx, driver, f.ID)
		_, errDl := e.svc.Download(ctx, driver, f.ID)
		if !isCode(errFile, "not_found") || !isCode(errDl, "not_found") {
			t.Errorf("%s of the closed trip: File %v, Download %v; want not_found", f.FileName, errFile, errDl)
		}
		if _, err := e.svc.File(ctx, manager, f.ID); err != nil {
			t.Errorf("%s for the manager: %v", f.FileName, err)
		}
	}
	if got := listed(t, e, driver, files.ListQuery{}); slices.Contains(got, photo.ID) || slices.Contains(got, receipt.ID) {
		t.Errorf("listFiles of the driver %v has the files of the closed trip", got)
	}
	if got := listed(t, e, manager, files.ListQuery{}); !slices.Contains(got, photo.ID) || !slices.Contains(got, receipt.ID) {
		t.Errorf("listFiles of the manager %v lost the files of the trip", got)
	}
	noUploads(t, e, driver)
	e.svc.Hidden = hider{}
	if _, err := e.svc.File(ctx, driver, photo.ID); err != nil {
		t.Errorf("a trip no transfer closes: %v", err)
	}
}

// noUploads requires that nothing attaches to the closed trip:a1, its expense and its reservation for tc.
func noUploads(t *testing.T, e env, tc tenantctx.TenantContext) {
	t.Helper()
	for owner, entity := range map[string]string{"trip:a1": "trip", "expense:a1": "expense", "reservation:a1": "reservation"} {
		purpose := files.PurposeInspection
		if entity == "expense" {
			purpose = files.PurposeExpenseReceipt
		}
		if _, err := e.svc.Initiate(t.Context(), tc, newUpload(owner, entity, purpose, "image/jpeg", "Ещё.jpg", jpeg)); !isCode(err, "not_found") {
			t.Errorf("upload to %s of the closed trip: %v, want not_found", owner, err)
		}
	}
}

// W2.57, return 2 (D09): a trip left to its continuation closes only its reservation as a parent — a departure photo
// is new work, as startTrip and the departure inspection by that reservation are in the overlay of the tag Fleet; the
// photos of the trip stay readable and take uploads. The subject is the manager who sees both parents (the Hider of
// the test is keyed by the person; in cmd/api only a temporary driver has such trips).
func TestContinuedTripsCloseTheirReservation(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	manager := e.tc(t, "a.manager-msk1", "a")
	departure := e.ready(t, manager, newUpload("reservation:a1", "reservation", files.PurposeInspection, "image/jpeg",
		"Выезд.jpg", jpeg), jpeg)
	photo := e.ready(t, manager, newUpload("trip:a1", "trip", files.PurposeInspection, "image/jpeg", "Сдача.jpg", jpeg), jpeg)
	e.svc.Hidden = hider{manager.PersonID: {Continued: []uuid.UUID{parent["trip:a1"]}}}
	if _, err := e.svc.File(ctx, manager, departure.ID); !isCode(err, "not_found") {
		t.Errorf("a departure photo of the continued trip: %v, want not_found", err)
	}
	if got := listed(t, e, manager, files.ListQuery{}); slices.Contains(got, departure.ID) || !slices.Contains(got, photo.ID) {
		t.Errorf("listFiles %v: want the photo of the trip without the departure photo of its reservation", got)
	}
	upload := newUpload("reservation:a1", "reservation", files.PurposeInspection, "image/jpeg", "Ещё выезд.jpg", jpeg)
	if _, err := e.svc.Initiate(ctx, manager, upload); !isCode(err, "not_found") {
		t.Errorf("upload to the reservation of the continued trip: %v, want not_found", err)
	}
	if _, err := e.svc.File(ctx, manager, photo.ID); err != nil {
		t.Errorf("a photo of the continued trip: %v", err)
	}
	upload = newUpload("trip:a1", "trip", files.PurposeInspection, "image/jpeg", "Ещё сдача.jpg", jpeg)
	if _, err := e.svc.Initiate(ctx, manager, upload); err != nil {
		t.Errorf("upload to the continued trip: %v", err)
	}
}
