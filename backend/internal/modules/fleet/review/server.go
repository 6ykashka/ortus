package review

import (
	"context"
	"strconv"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Server overlays reviewTrip and reviewTripExpense on a strict server of the tag Fleet; the other operations go to
// the base.
type Server struct {
	fleetapi.StrictServerInterface
	S *Service
}

var _ fleetapi.StrictServerInterface = Server{}

// NewServer returns the overlay on base (nil: the other operations of the tag answer 501).
func NewServer(base fleetapi.StrictServerInterface, s *Service) Server {
	if base == nil {
		base = unimplemented{}
	}
	return Server{StrictServerInterface: base, S: s}
}

const noStore = "private, no-store"

// etag is the strong ETag of a revision (a trip and an expense alike).
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

// ReviewTrip implements fleetapi.StrictServerInterface.
func (h Server) ReviewTrip(ctx context.Context, r fleetapi.ReviewTripRequestObject) (fleetapi.ReviewTripResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	out, err := h.S.Review(ctx, tc, r.TripId, r.Params.IfMatch, *r.Body)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag, replayed := etag(out.Revision), false
	return fleetapi.ReviewTrip200JSONResponse{Body: out, Headers: fleetapi.ReviewTrip200ResponseHeaders{
		CacheControl: cc, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// ReviewTripExpense implements fleetapi.StrictServerInterface.
func (h Server) ReviewTripExpense(ctx context.Context, r fleetapi.ReviewTripExpenseRequestObject) (fleetapi.ReviewTripExpenseResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	out, err := h.S.ReviewExpense(ctx, tc, r.TripId, r.ExpenseId, r.Params.IfMatch, *r.Body)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag, replayed := etag(out.Revision), false
	return fleetapi.ReviewTripExpense200JSONResponse{Body: out, Headers: fleetapi.ReviewTripExpense200ResponseHeaders{
		CacheControl: cc, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}
