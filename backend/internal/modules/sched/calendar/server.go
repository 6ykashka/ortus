package calendar

import (
	"context"

	calendarapi "github.com/ortus/ortus-crm/backend/internal/api/calendar"
	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// noStore is Cache-Control of every answer (the contract: «private, no-store»).
const noStore = "private, no-store"

// Server implements calendarapi.StrictServerInterface over the service.
type Server struct{ S *Service }

var _ calendarapi.StrictServerInterface = Server{}

func tenant(ctx context.Context) (tenantctx.TenantContext, error) {
	tc, ok := tenantctx.FromContext(ctx)
	if !ok {
		return tenantctx.TenantContext{}, problem.New(problem.CodeNotFound, "")
	}
	return tc, nil
}

func headers(ctx context.Context) (cache, rid *string) {
	c, id := noStore, requestid.FromContext(ctx)
	return &c, &id
}

// body is the Problem of a fieldsError with its violations; resources_unavailable is retryable (api/errors.yaml).
func body(ctx context.Context, e *fieldsError) (calendarapi.Problem, *string) {
	p := catalog.Problems[e.code]
	rid, detail, violations := requestid.FromContext(ctx), e.detail, e.violations
	out := calendarapi.Problem{
		Type: problem.TypeBase + e.code, Title: p.Title, Status: int64(p.Status), Code: calendarapi.ProblemCode(e.code),
		Detail: &detail, RequestId: rid, Violations: &violations,
	}
	if e.code == codeResourcesUnavailable {
		retry := true
		out.Retryable = &retry
	}
	return out, &rid
}

// ListCalendarResources implements calendarapi.StrictServerInterface.
func (s Server) ListCalendarResources(ctx context.Context, req calendarapi.ListCalendarResourcesRequestObject) (calendarapi.ListCalendarResourcesResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	q := ResourceQuery{OrgUnit: req.Params.OrgUnitId, Cursor: req.Params.Cursor, Limit: req.Params.Limit}
	if req.Params.Kind != nil {
		k := string(*req.Params.Kind)
		q.Kind = &k
	}
	page, err := s.S.Resources(ctx, tc, q)
	if err != nil {
		return nil, err
	}
	cache, rid := headers(ctx)
	return calendarapi.ListCalendarResources200JSONResponse{Body: page,
		Headers: calendarapi.ListCalendarResources200ResponseHeaders{CacheControl: cache, XRequestId: rid}}, nil
}

// ListCalendarBookings implements calendarapi.StrictServerInterface: a wrong window is the 422 with its violation.
func (s Server) ListCalendarBookings(ctx context.Context, req calendarapi.ListCalendarBookingsRequestObject) (calendarapi.ListCalendarBookingsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	p := req.Params
	q := BookingQuery{From: p.From, To: p.To, OrgUnit: p.OrgUnitId, Resource: p.ResourceId, Cursor: p.Cursor, Limit: p.Limit}
	if p.Kind != nil {
		k := string(*p.Kind)
		q.Kind = &k
	}
	page, err := s.S.Bookings(ctx, tc, q)
	if fe, ok := asFields(err); ok {
		b, rid := body(ctx, fe)
		return calendarapi.ListCalendarBookings422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: calendarapi.ValidationApplicationProblemPlusJSONResponse{
			Body: b, Headers: calendarapi.ValidationResponseHeaders{XRequestId: rid}}}, nil
	}
	if err != nil {
		return nil, err
	}
	cache, rid := headers(ctx)
	return calendarapi.ListCalendarBookings200JSONResponse{Body: page,
		Headers: calendarapi.ListCalendarBookings200ResponseHeaders{CacheControl: cache, XRequestId: rid}}, nil
}

// GetCalendarBooking implements calendarapi.StrictServerInterface.
func (s Server) GetCalendarBooking(ctx context.Context, req calendarapi.GetCalendarBookingRequestObject) (calendarapi.GetCalendarBookingResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	b, err := s.S.Booking(ctx, tc, req.BookingId)
	if err != nil {
		return nil, err
	}
	cache, rid := headers(ctx)
	tag := etag(b.Revision)
	return calendarapi.GetCalendarBooking200JSONResponse{Body: b,
		Headers: calendarapi.GetCalendarBooking200ResponseHeaders{CacheControl: cache, ETag: &tag, XRequestId: rid}}, nil
}

// UpdateCalendarBooking implements calendarapi.StrictServerInterface: a conflict of resources is the 409 and a field
// error the 422, both with their violations.
func (s Server) UpdateCalendarBooking(ctx context.Context, req calendarapi.UpdateCalendarBookingRequestObject) (calendarapi.UpdateCalendarBookingResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	b, err := s.S.Update(ctx, tc, req.BookingId, req.Params.IfMatch, *req.Body)
	if fe, ok := asFields(err); ok {
		pb, rid := body(ctx, fe)
		if fe.code == codeResourcesUnavailable {
			return calendarapi.UpdateCalendarBooking409ApplicationProblemPlusJSONResponse{ConflictApplicationProblemPlusJSONResponse: calendarapi.ConflictApplicationProblemPlusJSONResponse{
				Body: pb, Headers: calendarapi.ConflictResponseHeaders{XRequestId: rid}}}, nil
		}
		return calendarapi.UpdateCalendarBooking422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: calendarapi.ValidationApplicationProblemPlusJSONResponse{
			Body: pb, Headers: calendarapi.ValidationResponseHeaders{XRequestId: rid}}}, nil
	}
	if err != nil {
		return nil, err
	}
	cache, rid := headers(ctx)
	tag, replayed := etag(b.Revision), false
	return calendarapi.UpdateCalendarBooking200JSONResponse{Body: b, Headers: calendarapi.UpdateCalendarBooking200ResponseHeaders{
		CacheControl: cache, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// FindCalendarAvailability implements calendarapi.StrictServerInterface.
func (s Server) FindCalendarAvailability(ctx context.Context, req calendarapi.FindCalendarAvailabilityRequestObject) (calendarapi.FindCalendarAvailabilityResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	res, err := s.S.Availability(ctx, tc, *req.Body)
	if fe, ok := asFields(err); ok {
		b, rid := body(ctx, fe)
		return calendarapi.FindCalendarAvailability422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: calendarapi.ValidationApplicationProblemPlusJSONResponse{
			Body: b, Headers: calendarapi.ValidationResponseHeaders{XRequestId: rid}}}, nil
	}
	if err != nil {
		return nil, err
	}
	cache, rid := headers(ctx)
	return calendarapi.FindCalendarAvailability200JSONResponse{Body: res,
		Headers: calendarapi.FindCalendarAvailability200ResponseHeaders{CacheControl: cache, XRequestId: rid}}, nil
}

// CreateCalendarBooking answers 501 not_implemented: bookings are made by their modules (the visits of SPA, stage 5);
// the card of W4.40 is the day and the week and the reschedule (the mock has no handler either).
func (Server) CreateCalendarBooking(context.Context, calendarapi.CreateCalendarBookingRequestObject) (calendarapi.CreateCalendarBookingResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}
