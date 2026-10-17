package trips

import (
	"context"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Server overlays the trip operations of the module on a strict server of the tag Fleet: startTrip, getTrip,
// listTrips, finishTripRoute, returnTrip. The other operations go to the base, the trip card (getTripPlan,
// listTripPlans) too: it is the read of W2.03 (fleet/routes) in the base of the tag; Service.Plan projects the same
// TripPlan for Trip.plan and the answers of the commands (Q-W2.05-3).
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

// page reads cursor and limit of a list; an explicit limit outside 1…200 is 400.
func page(cursor *string, limit *int) (string, int, error) {
	c, n := "", 0
	if cursor != nil {
		c = *cursor
	}
	if limit != nil {
		if *limit < 1 || *limit > maxPageLimit {
			return "", 0, problem.New(problem.CodeMalformedRequest, "Размер страницы — от 1 до 200.")
		}
		n = *limit
	}
	return c, n, nil
}

// StartTrip implements fleetapi.StrictServerInterface.
func (h Server) StartTrip(ctx context.Context, r fleetapi.StartTripRequestObject) (fleetapi.StartTripResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	out, err := h.S.Start(ctx, tc, *r.Body)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag, replayed := etag(out.Revision), false
	return fleetapi.StartTrip201JSONResponse{Body: out, Headers: fleetapi.StartTrip201ResponseHeaders{
		CacheControl: cc, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// GetTrip implements fleetapi.StrictServerInterface.
func (h Server) GetTrip(ctx context.Context, r fleetapi.GetTripRequestObject) (fleetapi.GetTripResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.Trip(ctx, tc, r.TripId)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag := etag(out.Revision)
	return fleetapi.GetTrip200JSONResponse{Body: out,
		Headers: fleetapi.GetTrip200ResponseHeaders{CacheControl: cc, ETag: &tag, XRequestId: rid}}, nil
}

// ListTrips implements fleetapi.StrictServerInterface.
func (h Server) ListTrips(ctx context.Context, r fleetapi.ListTripsRequestObject) (fleetapi.ListTripsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	c, n, err := page(r.Params.Cursor, r.Params.Limit)
	if err != nil {
		return nil, err
	}
	out, err := h.S.Trips(ctx, tc, PageQuery{Cursor: c, Limit: n})
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return fleetapi.ListTrips200JSONResponse{Body: out,
		Headers: fleetapi.ListTrips200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// FinishTripRoute implements fleetapi.StrictServerInterface.
func (h Server) FinishTripRoute(ctx context.Context, r fleetapi.FinishTripRouteRequestObject) (fleetapi.FinishTripRouteResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.Finish(ctx, tc, r.TripId, r.Params.IfMatch)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag, replayed := etag(out.Revision), false
	return fleetapi.FinishTripRoute200JSONResponse{Body: out, Headers: fleetapi.FinishTripRoute200ResponseHeaders{
		CacheControl: cc, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// ReturnTrip implements fleetapi.StrictServerInterface.
func (h Server) ReturnTrip(ctx context.Context, r fleetapi.ReturnTripRequestObject) (fleetapi.ReturnTripResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	out, err := h.S.Return(ctx, tc, r.TripId, r.Params.IfMatch, *r.Body)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag, replayed := etag(out.Revision), false
	return fleetapi.ReturnTrip200JSONResponse{Body: out, Headers: fleetapi.ReturnTrip200ResponseHeaders{
		CacheControl: cc, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}
