package expenses

import (
	"context"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Server overlays the expense operations of the module on a strict server of the tag Fleet: createTripExpense,
// listTripExpenses, getTripExpense. reviewTripExpense (W2.06) and the other operations go to the base.
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

func tenant(ctx context.Context) (tenantctx.TenantContext, error) {
	tc, ok := tenantctx.FromContext(ctx)
	if !ok {
		return tenantctx.TenantContext{}, problem.New(problem.CodeNotFound, "")
	}
	return tc, nil
}

func headers(ctx context.Context) (cacheControl, reqID *string) {
	cc, rid := "private, no-store", requestid.FromContext(ctx)
	if rid == "" {
		return &cc, nil
	}
	return &cc, &rid
}

// CreateTripExpense implements fleetapi.StrictServerInterface.
func (h Server) CreateTripExpense(ctx context.Context, r fleetapi.CreateTripExpenseRequestObject) (fleetapi.CreateTripExpenseResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	out, err := h.S.Create(ctx, tc, r.TripId, *r.Body)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag, replayed := etag(out.Revision), false
	return fleetapi.CreateTripExpense201JSONResponse{Body: out, Headers: fleetapi.CreateTripExpense201ResponseHeaders{
		CacheControl: cc, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// ListTripExpenses implements fleetapi.StrictServerInterface.
func (h Server) ListTripExpenses(ctx context.Context, r fleetapi.ListTripExpensesRequestObject) (fleetapi.ListTripExpensesResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	q := PageQuery{}
	if r.Params.Cursor != nil {
		q.Cursor = *r.Params.Cursor
	}
	if r.Params.Limit != nil {
		if *r.Params.Limit < 1 || *r.Params.Limit > maxPageLimit {
			return nil, problem.New(problem.CodeMalformedRequest, "Размер страницы — от 1 до 200.")
		}
		q.Limit = *r.Params.Limit
	}
	out, err := h.S.List(ctx, tc, r.TripId, q)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return fleetapi.ListTripExpenses200JSONResponse{Body: out,
		Headers: fleetapi.ListTripExpenses200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// GetTripExpense implements fleetapi.StrictServerInterface.
func (h Server) GetTripExpense(ctx context.Context, r fleetapi.GetTripExpenseRequestObject) (fleetapi.GetTripExpenseResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.Get(ctx, tc, r.TripId, r.ExpenseId)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag := etag(out.Revision)
	return fleetapi.GetTripExpense200JSONResponse{Body: out,
		Headers: fleetapi.GetTripExpense200ResponseHeaders{CacheControl: cc, ETag: &tag, XRequestId: rid}}, nil
}
