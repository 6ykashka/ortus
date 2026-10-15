package files

import (
	"context"

	billingapi "github.com/ortus/ortus-crm/backend/internal/api/billing"
	filesapi "github.com/ortus/ortus-crm/backend/internal/api/files"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// noStore is the Cache-Control of every answer of the module (capabilities and confidential data).
const noStore = "private, no-store"

// tenant returns the TenantContext put by the gateway; without it the tenant does not exist for the request.
func tenant(ctx context.Context) (tenantctx.TenantContext, error) {
	tc, ok := tenantctx.FromContext(ctx)
	if !ok {
		return tenantctx.TenantContext{}, problem.New(codeNotFound, "")
	}
	return tc, nil
}

func headers(ctx context.Context) (cacheControl, reqID *string) {
	cc, rid := noStore, requestid.FromContext(ctx)
	if rid == "" {
		return &cc, nil
	}
	return &cc, &rid
}

// Server is the strict server of the tag Files.
type Server struct{ S *Service }

var _ filesapi.StrictServerInterface = Server{}

func fileDTO(f File) filesapi.File {
	return filesapi.File{
		Id: f.ID, FileName: f.FileName, ContentType: f.ContentType, SizeBytes: f.SizeBytes, Sha256: f.SHA256,
		Status: filesapi.FileStatus(f.Status), CreatedAt: f.CreatedAt.UTC(),
	}
}

func refDTO(r Ref) filesapi.ObjectRef {
	return filesapi.ObjectRef{ModuleKey: r.Module, EntityType: r.Entity, EntityId: r.ID}
}

// ListFiles implements filesapi.StrictServerInterface.
func (h Server) ListFiles(ctx context.Context, r filesapi.ListFilesRequestObject) (filesapi.ListFilesResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	q := ListQuery{}
	if p := r.Params; p.Status != nil {
		q.Status = string(*p.Status)
	}
	if r.Params.Purpose != nil {
		q.Purpose = string(*r.Params.Purpose)
	}
	if r.Params.Cursor != nil {
		q.Cursor = *r.Params.Cursor
	}
	if r.Params.Limit != nil {
		q.Limit = *r.Params.Limit
		if q.Limit == 0 {
			return nil, invalid("Размер страницы — от 1 до 200.")
		}
	}
	page, err := h.S.List(ctx, tc, q)
	if err != nil {
		return nil, err
	}
	body := filesapi.FilePage{Items: make([]filesapi.FileListItem, 0, len(page.Items))}
	for _, f := range page.Items {
		it := filesapi.FileListItem{File: fileDTO(f), Purpose: filesapi.FileListItemPurpose(f.Purpose), Owner: refDTO(f.Owner)}
		if f.OwnerTitle != "" {
			title := f.OwnerTitle
			it.OwnerTitle = &title
		}
		body.Items = append(body.Items, it)
	}
	if page.Next != "" {
		next := page.Next
		body.NextCursor = &next
	}
	cc, rid := headers(ctx)
	return filesapi.ListFiles200JSONResponse{Body: body, Headers: filesapi.ListFiles200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// InitiateUpload implements filesapi.StrictServerInterface.
func (h Server) InitiateUpload(ctx context.Context, r filesapi.InitiateUploadRequestObject) (filesapi.InitiateUploadResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, problem.New(codeMalformed, "")
	}
	b := r.Body
	t, err := h.S.Initiate(ctx, tc, Upload{
		FileName: b.FileName, ContentType: b.ContentType, SizeBytes: b.SizeBytes, SHA256: b.Sha256, Purpose: Purpose(b.Purpose),
		Owner: Ref{Module: b.Owner.ModuleKey, Entity: b.Owner.EntityType, ID: b.Owner.EntityId},
	})
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return filesapi.InitiateUpload201JSONResponse{
		Body: filesapi.UploadTicket{
			UploadId: t.UploadID, FileId: t.FileID, Method: "PUT", UploadUrl: t.URL, RequiredContentType: t.ContentType,
			RequiredSha256: t.SHA256, ExpiresAt: t.ExpiresAt.UTC(), MaxBytes: t.MaxBytes,
		},
		Headers: filesapi.InitiateUpload201ResponseHeaders{CacheControl: cc, XRequestId: rid},
	}, nil
}

// AbortUpload implements filesapi.StrictServerInterface.
func (h Server) AbortUpload(ctx context.Context, r filesapi.AbortUploadRequestObject) (filesapi.AbortUploadResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if err := h.S.Abort(ctx, tc, r.UploadId); err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return filesapi.AbortUpload204Response{Headers: filesapi.AbortUpload204ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// GetUploadSession implements filesapi.StrictServerInterface.
func (h Server) GetUploadSession(ctx context.Context, r filesapi.GetUploadSessionRequestObject) (filesapi.GetUploadSessionResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	s, err := h.S.Session(ctx, tc, r.UploadId)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return filesapi.GetUploadSession200JSONResponse{
		Body: filesapi.UploadSession{
			UploadId: s.ID, FileId: s.FileID, State: filesapi.UploadSessionState(s.State),
			Purpose: filesapi.UploadSessionPurpose(s.Purpose), Owner: refDTO(s.Owner), SizeBytes: s.SizeBytes,
			ReservedBytes: s.ReservedBytes, TicketExpiresAt: s.TicketExpiresAt.UTC(), SessionExpiresAt: s.SessionExpiresAt.UTC(),
			FileStatus: filesapi.UploadSessionFileStatus(s.FileStatus), CreatedAt: s.CreatedAt.UTC(),
		},
		Headers: filesapi.GetUploadSession200ResponseHeaders{CacheControl: cc, XRequestId: rid},
	}, nil
}

// CompleteUpload implements filesapi.StrictServerInterface.
func (h Server) CompleteUpload(ctx context.Context, r filesapi.CompleteUploadRequestObject) (filesapi.CompleteUploadResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, problem.New(codeMalformed, "")
	}
	f, err := h.S.Complete(ctx, tc, r.UploadId, r.Body.Sha256)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return filesapi.CompleteUpload202JSONResponse{Body: fileDTO(f),
		Headers: filesapi.CompleteUpload202ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// GetFile implements filesapi.StrictServerInterface.
func (h Server) GetFile(ctx context.Context, r filesapi.GetFileRequestObject) (filesapi.GetFileResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	f, err := h.S.File(ctx, tc, r.FileId)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return filesapi.GetFile200JSONResponse{Body: fileDTO(f), Headers: filesapi.GetFile200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// GetFileDownload implements filesapi.StrictServerInterface.
func (h Server) GetFileDownload(ctx context.Context, r filesapi.GetFileDownloadRequestObject) (filesapi.GetFileDownloadResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	d, err := h.S.Download(ctx, tc, r.FileId)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return filesapi.GetFileDownload200JSONResponse{
		Body:    filesapi.DownloadTicket{FileId: d.FileID, DownloadUrl: d.URL, ExpiresAt: d.ExpiresAt.UTC()},
		Headers: filesapi.GetFileDownload200ResponseHeaders{CacheControl: cc, XRequestId: rid},
	}, nil
}

// Billing is the base strict server of the tag Billing: the storage operations (S1-22). The subscription operations
// answer 501 here; W1.08 overlays them with subshttp.NewBillingServer(Billing{…}, subs) — one composition.
type Billing struct {
	S *Service
}

var _ billingapi.StrictServerInterface = Billing{}

// GetStorageUsage implements billingapi.StrictServerInterface.
func (h Billing) GetStorageUsage(ctx context.Context, _ billingapi.GetStorageUsageRequestObject) (billingapi.GetStorageUsageResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	u, err := h.S.Usage(ctx, tc)
	if err != nil {
		return nil, err
	}
	write := billingapi.StorageUsageWriteStatus("allowed")
	if u.WriteBlocked() {
		write = "blocked"
	}
	cc, rid := headers(ctx)
	return billingapi.GetStorageUsage200JSONResponse{
		Body: billingapi.StorageUsage{
			QuotaBytes: u.QuotaBytes, CommittedBytes: u.Committed(), ReservedBytes: u.ReservedBytes,
			Buckets: []billingapi.QuotaBucket{
				{Kind: "attachments", Bytes: u.FilesBytes}, {Kind: "database", Bytes: u.DatabaseBytes},
				{Kind: "versions", Bytes: 0}, {Kind: "trash", Bytes: 0}, {Kind: "reserved_uploads", Bytes: u.ReservedBytes},
			},
			MeasuredAt: u.MeasuredAt.UTC(), Consistency: "estimated", WriteStatus: write,
		},
		Headers: billingapi.GetStorageUsage200ResponseHeaders{CacheControl: cc, XRequestId: rid},
	}, nil
}

// GetStorageBreakdown implements billingapi.StrictServerInterface.
func (h Billing) GetStorageBreakdown(ctx context.Context, _ billingapi.GetStorageBreakdownRequestObject) (billingapi.GetStorageBreakdownResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	b, err := h.S.Breakdown(ctx, tc)
	if err != nil {
		return nil, err
	}
	body := billingapi.StorageBreakdown{CommittedBytes: b.Committed, MeasuredAt: b.MeasuredAt.UTC(), Consistency: "estimated",
		Groups: make([]billingapi.StorageBreakdownGroup, 0, len(b.Groups)), Modules: make([]billingapi.StorageBreakdownModule, 0, len(b.Modules))}
	for _, g := range b.Groups {
		body.Groups = append(body.Groups, billingapi.StorageBreakdownGroup{Key: billingapi.StorageBreakdownGroupKey(g.Key), Bytes: g.Bytes, FileCount: g.Count})
	}
	for _, m := range b.Modules {
		body.Modules = append(body.Modules, billingapi.StorageBreakdownModule{ModuleKey: m.Key, Bytes: m.Bytes, FileCount: m.Count})
	}
	cc, rid := headers(ctx)
	return billingapi.GetStorageBreakdown200JSONResponse{Body: body, Headers: billingapi.GetStorageBreakdown200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// RequestStorageChange implements billingapi.StrictServerInterface.
func (h Billing) RequestStorageChange(ctx context.Context, r billingapi.RequestStorageChangeRequestObject) (billingapi.RequestStorageChangeResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, problem.New(codeMalformed, "")
	}
	req := ChangeRequest{Requested: r.Body.RequestedQuotaBytes}
	switch r.Body.Mode {
	case billingapi.Quote:
	case billingapi.Commit:
		req.Commit = true
		if r.Body.AcceptedQuoteId != nil {
			req.QuoteID = *r.Body.AcceptedQuoteId
		}
	default:
		return nil, invalid("Режим — quote или commit.")
	}
	c, err := h.S.RequestChange(ctx, tc, req)
	if err != nil {
		return nil, err
	}
	charge := billingapi.Money{AmountMinor: int(c.ChargeMinor), Currency: Currency}
	qid := c.QuoteID
	body := billingapi.StorageChange{Id: c.ID, State: billingapi.StorageChangeState(c.State), RequestedQuotaBytes: c.Requested,
		QuoteId: &qid, RecurringCharge: &charge}
	if c.QuoteExpiresAt != nil {
		at := c.QuoteExpiresAt.UTC()
		body.QuoteExpiresAt = &at
	}
	if c.EffectiveAt != nil {
		at := c.EffectiveAt.UTC()
		body.EffectiveAt = &at
	}
	cc, rid := headers(ctx)
	return billingapi.RequestStorageChange201JSONResponse{Body: body, Headers: billingapi.RequestStorageChange201ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// GetTenantSubscription implements billingapi.StrictServerInterface: 501, the overlay of W1.08 answers it.
func (Billing) GetTenantSubscription(context.Context, billingapi.GetTenantSubscriptionRequestObject) (billingapi.GetTenantSubscriptionResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// RequestSubscriptionChange implements billingapi.StrictServerInterface: 501, the overlay of W1.08 answers it.
func (Billing) RequestSubscriptionChange(context.Context, billingapi.RequestSubscriptionChangeRequestObject) (billingapi.RequestSubscriptionChangeResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}
