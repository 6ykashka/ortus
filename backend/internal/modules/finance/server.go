package finance

import (
	"context"
	"strconv"

	earningsapi "github.com/ortus/ortus-crm/backend/internal/api/earnings"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Server is the strict server of the tag Earnings.
type Server struct{ S *Service }

var _ earningsapi.StrictServerInterface = Server{}

const (
	noStore      = "private, no-store"
	maxPageLimit = 200
)

// etag is the strong ETag of a revision.
func etag(revision int64) string { return `"` + strconv.FormatInt(revision, 10) + `"` }

// tenant returns the TenantContext put by the gateway; without it the tenant does not exist for the request.
func tenant(ctx context.Context) (tenantctx.TenantContext, error) {
	tc, ok := tenantctx.FromContext(ctx)
	if !ok {
		return tenantctx.TenantContext{}, problem.New(problem.CodeNotFound, "")
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

// ListTripEarnings implements earningsapi.StrictServerInterface.
func (h Server) ListTripEarnings(ctx context.Context, r earningsapi.ListTripEarningsRequestObject) (earningsapi.ListTripEarningsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	q := ListQuery{}
	if r.Params.Cursor != nil {
		q.Cursor = *r.Params.Cursor
	}
	if r.Params.Limit != nil {
		if *r.Params.Limit < 1 || *r.Params.Limit > maxPageLimit {
			return nil, problem.New(problem.CodeMalformedRequest, "Размер страницы — от 1 до 200.")
		}
		q.Limit = *r.Params.Limit
	}
	if r.Params.OrgUnitId != nil {
		q.Unit = *r.Params.OrgUnitId
	}
	out, err := h.S.List(ctx, tc, q)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return earningsapi.ListTripEarnings200JSONResponse{Body: out,
		Headers: earningsapi.ListTripEarnings200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// GetTripEarnings implements earningsapi.StrictServerInterface.
func (h Server) GetTripEarnings(ctx context.Context, r earningsapi.GetTripEarningsRequestObject) (earningsapi.GetTripEarningsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.Earnings(ctx, tc, r.TripId)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag := etag(out.Revision)
	return earningsapi.GetTripEarnings200JSONResponse{Body: out,
		Headers: earningsapi.GetTripEarnings200ResponseHeaders{CacheControl: cc, ETag: &tag, XRequestId: rid}}, nil
}

// SetTripEarnings implements earningsapi.StrictServerInterface.
func (h Server) SetTripEarnings(ctx context.Context, r earningsapi.SetTripEarningsRequestObject) (earningsapi.SetTripEarningsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	out, err := h.S.Set(ctx, tc, r.TripId, r.Params.IfMatch, *r.Body)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag, replayed := etag(out.Revision), false
	return earningsapi.SetTripEarnings200JSONResponse{Body: out, Headers: earningsapi.SetTripEarnings200ResponseHeaders{
		CacheControl: cc, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}
