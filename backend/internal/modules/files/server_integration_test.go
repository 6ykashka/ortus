//go:build integration

package files_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/google/uuid"

	billingapi "github.com/ortus/ortus-crm/backend/internal/api/billing"
	filesapi "github.com/ortus/ortus-crm/backend/internal/api/files"
	"github.com/ortus/ortus-crm/backend/internal/modules/files" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

const noStore = "private, no-store"

func serverBody() filesapi.UploadCreate {
	return filesapi.UploadCreate{
		FileName: "Сервер.jpg", ContentType: "image/jpeg", SizeBytes: int64(len(jpeg)), Sha256: digest(jpeg),
		Purpose: filesapi.UploadCreatePurpose(files.PurposeInspection),
		Owner:   filesapi.ObjectRef{ModuleKey: "fleet", EntityType: "trip", EntityId: parent["trip:a1"]},
	}
}

// initiateHTTP calls InitiateUpload of the server and returns the 201 answer.
func initiateHTTP(ctx context.Context, t *testing.T, srv files.Server, tenant uuid.UUID) filesapi.InitiateUpload201JSONResponse {
	t.Helper()
	body := serverBody()
	resp, err := srv.InitiateUpload(ctx, filesapi.InitiateUploadRequestObject{TenantId: tenant, Body: &body})
	created, ok := resp.(filesapi.InitiateUpload201JSONResponse)
	expect(t, "initiate", resp, err == nil, ok)
	return created
}

// The strict server of the tag Files maps the service to the contract: codes, bodies and headers.
func TestServerFilesUpload(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	tc := e.tc(t, "a.manager-msk1", "a")
	ctx := tenantctx.WithTenant(t.Context(), tc)
	srv := files.Server{S: e.svc}
	created := initiateHTTP(ctx, t, srv, tc.TenantID)
	expect(t, "ticket", created, created.Body.Method == http.MethodPut, created.Body.RequiredSha256 == digest(jpeg),
		created.Body.MaxBytes == files.MaxBytes, created.Headers.CacheControl != nil && *created.Headers.CacheControl == noStore)
	upload := created.Body.UploadId
	put(t, files.Ticket{URL: created.Body.UploadUrl}, "image/jpeg", jpeg)

	sess, err := srv.GetUploadSession(ctx, filesapi.GetUploadSessionRequestObject{TenantId: tc.TenantID, UploadId: upload})
	s, ok := sess.(filesapi.GetUploadSession200JSONResponse)
	expect(t, "session", sess, err == nil, ok, s.Body.State == "uploaded", s.Body.Owner.EntityId == parent["trip:a1"],
		s.Body.Purpose == "inspection")
	done, err := srv.CompleteUpload(ctx, filesapi.CompleteUploadRequestObject{TenantId: tc.TenantID, UploadId: upload,
		Body: &filesapi.UploadComplete{Sha256: digest(jpeg)}})
	accepted, ok := done.(filesapi.CompleteUpload202JSONResponse)
	expect(t, "complete", done, err == nil, ok, accepted.Body.Status == "quarantined", accepted.Body.FileName == "Сервер.jpg")
	e.scan(t, "a", accepted.Body.Id)
	serverReads(ctx, t, srv, tc.TenantID, accepted.Body.Id)

	second := initiateHTTP(ctx, t, srv, tc.TenantID)
	abort, err := srv.AbortUpload(ctx, filesapi.AbortUploadRequestObject{TenantId: tc.TenantID, UploadId: second.Body.UploadId})
	_, ok = abort.(filesapi.AbortUpload204Response)
	expect(t, "abort", abort, err == nil, ok)
	_, err = srv.GetFile(ctx, filesapi.GetFileRequestObject{TenantId: tc.TenantID, FileId: parent["trip:a1"]})
	wantCode(t, err, "not_found")
	_, err = srv.GetFile(context.Background(), filesapi.GetFileRequestObject{TenantId: tc.TenantID, FileId: accepted.Body.Id})
	wantCode(t, err, "not_found") // no tenant context
}

// serverReads checks getFile, getFileDownload and listFiles of a ready file of trip:a1.
func serverReads(ctx context.Context, t *testing.T, srv files.Server, tenant, file uuid.UUID) {
	t.Helper()
	got, err := srv.GetFile(ctx, filesapi.GetFileRequestObject{TenantId: tenant, FileId: file})
	f, ok := got.(filesapi.GetFile200JSONResponse)
	expect(t, "file", got, err == nil, ok, f.Body.Status == "ready")
	dl, err := srv.GetFileDownload(ctx, filesapi.GetFileDownloadRequestObject{TenantId: tenant, FileId: file})
	d, ok := dl.(filesapi.GetFileDownload200JSONResponse)
	expect(t, "download", dl, err == nil, ok, d.Body.DownloadUrl != "", d.Body.FileId == file)
	limit := 200
	list, err := srv.ListFiles(ctx, filesapi.ListFilesRequestObject{TenantId: tenant, Params: filesapi.ListFilesParams{Limit: &limit}})
	page, ok := list.(filesapi.ListFiles200JSONResponse)
	expect(t, "list", list, err == nil, ok, page.Body.NextCursor == nil)
	var item *filesapi.FileListItem
	for i := range page.Body.Items {
		if page.Body.Items[i].File.Id == file {
			item = &page.Body.Items[i]
		}
	}
	expect(t, "listed", item, item != nil)
	expect(t, "listed item", *item, item.OwnerTitle != nil, item.Owner.ModuleKey == "fleet")
	expect(t, "owner title", *item.OwnerTitle, *item.OwnerTitle == "TR-2026-000101")
}

// The storage part of the tag Billing; the subscription part is 501 here (W1.08 overlays it).
func TestServerBilling(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	tc := e.tc(t, "a.owner", "a")
	ctx := tenantctx.WithTenant(t.Context(), tc)
	srv := files.Billing{S: e.svc}

	usage, err := srv.GetStorageUsage(ctx, billingapi.GetStorageUsageRequestObject{TenantId: tc.TenantID})
	u, ok := usage.(billingapi.GetStorageUsage200JSONResponse)
	expect(t, "usage", usage, err == nil, ok, u.Body.Consistency == "estimated", len(u.Body.Buckets) == 5,
		u.Body.CommittedBytes > 0, u.Body.QuotaBytes > 0)
	expect(t, "buckets", u.Body.Buckets, u.Body.Buckets[4].Kind == "reserved_uploads")
	br, err := srv.GetStorageBreakdown(ctx, billingapi.GetStorageBreakdownRequestObject{TenantId: tc.TenantID})
	b, ok := br.(billingapi.GetStorageBreakdown200JSONResponse)
	expect(t, "breakdown", br, err == nil, ok, len(b.Body.Groups) == 4)
	expect(t, "groups", b.Body.Groups, b.Body.Groups[0].Key == "photos", b.Body.Groups[3].Key == "other")
	ch, err := srv.RequestStorageChange(ctx, billingapi.RequestStorageChangeRequestObject{TenantId: tc.TenantID,
		Body: &billingapi.StorageChangeRequest{RequestedQuotaBytes: 161061273600, Mode: billingapi.Quote}})
	q, ok := ch.(billingapi.RequestStorageChange201JSONResponse)
	expect(t, "quote", ch, err == nil, ok, q.Body.State == "quoted", q.Body.QuoteId != nil, q.Body.RecurringCharge != nil)
	expect(t, "charge", q.Body.RecurringCharge, q.Body.RecurringCharge.AmountMinor == 150000, q.Body.RecurringCharge.Currency == "RUB")

	_, err = srv.GetTenantSubscription(ctx, billingapi.GetTenantSubscriptionRequestObject{TenantId: tc.TenantID})
	wantCode(t, err, "not_implemented")
}
