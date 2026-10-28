package service

import (
	"context"

	"github.com/google/uuid"

	api "github.com/ortus/ortus-crm/backend/internal/api/service"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Server is the strict server of the tag Service over the Service: the parameters are checked here, the rules are the
// Service's.
type Server struct{ S *Service }

var _ api.StrictServerInterface = Server{}

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

func pageQuery(cursor *string, limit *int) PageQuery {
	var q PageQuery
	if cursor != nil {
		q.Cursor = *cursor
	}
	if limit != nil {
		q.Limit = *limit
		if q.Limit == 0 {
			q.Limit = -1 // an explicit zero is out of range, not «default»
		}
	}
	return q
}

func idOf(p *uuid.UUID) uuid.UUID {
	if p == nil {
		return uuid.Nil
	}
	return *p
}

func strOf[T ~string](p *T) string {
	if p == nil {
		return ""
	}
	return string(*p)
}

// ListServiceDirections implements api.StrictServerInterface.
func (h Server) ListServiceDirections(ctx context.Context, _ api.ListServiceDirectionsRequestObject) (api.ListServiceDirectionsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.ListDirections(ctx, tc)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return api.ListServiceDirections200JSONResponse{Body: out, Headers: api.ListServiceDirections200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// CreateServiceDirection implements api.StrictServerInterface.
func (h Server) CreateServiceDirection(ctx context.Context, r api.CreateServiceDirectionRequestObject) (api.CreateServiceDirectionResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.CreateDirection(ctx, tc, r.Body)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	replayed := false
	return api.CreateServiceDirection201JSONResponse{Body: out, Headers: api.CreateServiceDirection201ResponseHeaders{CacheControl: cc, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// GetServiceDirection implements api.StrictServerInterface.
func (h Server) GetServiceDirection(ctx context.Context, r api.GetServiceDirectionRequestObject) (api.GetServiceDirectionResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.GetDirection(ctx, tc, r.DirectionId)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return api.GetServiceDirection200JSONResponse{Body: out, Headers: api.GetServiceDirection200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// UpdateServiceDirectionDraft implements api.StrictServerInterface.
func (h Server) UpdateServiceDirectionDraft(ctx context.Context, r api.UpdateServiceDirectionDraftRequestObject) (api.UpdateServiceDirectionDraftResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.SaveDraft(ctx, tc, r.DirectionId, r.Params.IfMatch, r.Body)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag, replayed := etag(out.Revision), false
	return api.UpdateServiceDirectionDraft200JSONResponse{Body: out, Headers: api.UpdateServiceDirectionDraft200ResponseHeaders{CacheControl: cc, ETag: &tag,
		IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// PublishServiceDirection implements api.StrictServerInterface.
func (h Server) PublishServiceDirection(ctx context.Context, r api.PublishServiceDirectionRequestObject) (api.PublishServiceDirectionResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.Publish(ctx, tc, r.DirectionId)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	replayed := false
	return api.PublishServiceDirection200JSONResponse{Body: out, Headers: api.PublishServiceDirection200ResponseHeaders{CacheControl: cc, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// ListServiceReplyTemplates implements api.StrictServerInterface.
func (h Server) ListServiceReplyTemplates(ctx context.Context, r api.ListServiceReplyTemplatesRequestObject) (api.ListServiceReplyTemplatesResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.Templates(ctx, tc, r.DirectionId)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return api.ListServiceReplyTemplates200JSONResponse{Body: out, Headers: api.ListServiceReplyTemplates200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// GetServiceQueueCounts implements api.StrictServerInterface.
func (h Server) GetServiceQueueCounts(ctx context.Context, r api.GetServiceQueueCountsRequestObject) (api.GetServiceQueueCountsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.QueueCounts(ctx, tc, idOf(r.Params.DirectionId))
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return api.GetServiceQueueCounts200JSONResponse{Body: out, Headers: api.GetServiceQueueCounts200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// ListServiceRatings implements api.StrictServerInterface.
func (h Server) ListServiceRatings(ctx context.Context, r api.ListServiceRatingsRequestObject) (api.ListServiceRatingsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.ListRatings(ctx, tc, strOf(r.Params.Status), pageQuery(r.Params.Cursor, r.Params.Limit))
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return api.ListServiceRatings200JSONResponse{Body: out, Headers: api.ListServiceRatings200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// DecideServiceRating implements api.StrictServerInterface.
func (h Server) DecideServiceRating(ctx context.Context, r api.DecideServiceRatingRequestObject) (api.DecideServiceRatingResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.DecideRating(ctx, tc, r.RatingId, r.Body)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	replayed := false
	return api.DecideServiceRating200JSONResponse{Body: out, Headers: api.DecideServiceRating200ResponseHeaders{CacheControl: cc, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// GetServiceReport implements api.StrictServerInterface.
func (h Server) GetServiceReport(ctx context.Context, r api.GetServiceReportRequestObject) (api.GetServiceReportResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	q := ReportQuery{Direction: idOf(r.Params.DirectionId)}
	if r.Params.From != nil {
		q.From = r.Params.From.Time
	}
	if r.Params.To != nil {
		q.To = r.Params.To.Time
	}
	out, err := h.S.Report(ctx, tc, q)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return api.GetServiceReport200JSONResponse{Body: out, Headers: api.GetServiceReport200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// ListServiceRequests implements api.StrictServerInterface.
func (h Server) ListServiceRequests(ctx context.Context, r api.ListServiceRequestsRequestObject) (api.ListServiceRequestsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	p := r.Params
	out, err := h.S.ListRequests(ctx, tc, ListQuery{PageQuery: pageQuery(p.Cursor, p.Limit), Direction: idOf(p.DirectionId), Queue: strOf(p.Queue),
		Kind: strOf(p.Kind), Channel: strOf(p.Channel), Q: deref(p.Q)})
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return api.ListServiceRequests200JSONResponse{Body: out, Headers: api.ListServiceRequests200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// CreateServiceRequest implements api.StrictServerInterface.
func (h Server) CreateServiceRequest(ctx context.Context, r api.CreateServiceRequestRequestObject) (api.CreateServiceRequestResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.CreateRequest(ctx, tc, r.Body)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	replayed := false
	return api.CreateServiceRequest201JSONResponse{Body: out, Headers: api.CreateServiceRequest201ResponseHeaders{CacheControl: cc, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// GetServiceRequest implements api.StrictServerInterface.
func (h Server) GetServiceRequest(ctx context.Context, r api.GetServiceRequestRequestObject) (api.GetServiceRequestResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.GetRequest(ctx, tc, r.RequestId)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag := etag(out.Revision)
	return api.GetServiceRequest200JSONResponse{Body: out, Headers: api.GetServiceRequest200ResponseHeaders{CacheControl: cc, ETag: &tag, XRequestId: rid}}, nil
}

// UpdateServiceRequest implements api.StrictServerInterface.
func (h Server) UpdateServiceRequest(ctx context.Context, r api.UpdateServiceRequestRequestObject) (api.UpdateServiceRequestResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.Patch(ctx, tc, r.RequestId, r.Params.IfMatch, r.Body, Unassigns(ctx))
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag, replayed := etag(out.Revision), false
	return api.UpdateServiceRequest200JSONResponse{Body: out, Headers: api.UpdateServiceRequest200ResponseHeaders{CacheControl: cc, ETag: &tag,
		IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// RevealServiceClientPhone implements api.StrictServerInterface.
func (h Server) RevealServiceClientPhone(ctx context.Context, r api.RevealServiceClientPhoneRequestObject) (api.RevealServiceClientPhoneResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.RevealPhone(ctx, tc, r.RequestId)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	replayed := false
	return api.RevealServiceClientPhone200JSONResponse{Body: out, Headers: api.RevealServiceClientPhone200ResponseHeaders{CacheControl: cc, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// SetServiceCompensation implements api.StrictServerInterface.
func (h Server) SetServiceCompensation(ctx context.Context, r api.SetServiceCompensationRequestObject) (api.SetServiceCompensationResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.SetCompensation(ctx, tc, r.RequestId, r.Params.IfMatch, r.Body)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag, replayed := etag(out.Revision), false
	return api.SetServiceCompensation200JSONResponse{Body: out, Headers: api.SetServiceCompensation200ResponseHeaders{CacheControl: cc, ETag: &tag,
		IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// ShareServiceConclusion implements api.StrictServerInterface.
func (h Server) ShareServiceConclusion(ctx context.Context, r api.ShareServiceConclusionRequestObject) (api.ShareServiceConclusionResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.ShareConclusion(ctx, tc, r.RequestId, r.Params.IfMatch, r.Body)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag, replayed := etag(out.Revision), false
	return api.ShareServiceConclusion200JSONResponse{Body: out, Headers: api.ShareServiceConclusion200ResponseHeaders{CacheControl: cc, ETag: &tag,
		IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// PostServiceMessage implements api.StrictServerInterface.
func (h Server) PostServiceMessage(ctx context.Context, r api.PostServiceMessageRequestObject) (api.PostServiceMessageResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.PostMessage(ctx, tc, r.RequestId, r.Body)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	replayed := false
	return api.PostServiceMessage201JSONResponse{Body: out, Headers: api.PostServiceMessage201ResponseHeaders{CacheControl: cc, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// MoveServiceRequest implements api.StrictServerInterface.
func (h Server) MoveServiceRequest(ctx context.Context, r api.MoveServiceRequestRequestObject) (api.MoveServiceRequestResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.Move(ctx, tc, r.RequestId, r.Params.IfMatch, r.Body)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag, replayed := etag(out.Revision), false
	return api.MoveServiceRequest200JSONResponse{Body: out, Headers: api.MoveServiceRequest200ResponseHeaders{CacheControl: cc, ETag: &tag,
		IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// CreateServiceRequestTask implements api.StrictServerInterface.
func (h Server) CreateServiceRequestTask(ctx context.Context, r api.CreateServiceRequestTaskRequestObject) (api.CreateServiceRequestTaskResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.CreateTask(ctx, tc, r.RequestId, r.Body)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	replayed := false
	return api.CreateServiceRequestTask201JSONResponse{Body: out, Headers: api.CreateServiceRequestTask201ResponseHeaders{CacheControl: cc, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// TransitionServiceRequest implements api.StrictServerInterface.
func (h Server) TransitionServiceRequest(ctx context.Context, r api.TransitionServiceRequestRequestObject) (api.TransitionServiceRequestResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.Transition(ctx, tc, r.RequestId, r.Params.IfMatch, r.Body)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag, replayed := etag(out.Revision), false
	return api.TransitionServiceRequest200JSONResponse{Body: out, Headers: api.TransitionServiceRequest200ResponseHeaders{CacheControl: cc, ETag: &tag,
		IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}
