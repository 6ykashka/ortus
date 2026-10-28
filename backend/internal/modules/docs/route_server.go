package docs

import (
	"context"

	dapi "github.com/ortus/ortus-crm/backend/internal/api/docs"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// The methods of the strict server of the tag Docs for the route, the signature and the acknowledgement (W7.24).

// StartDocRoute implements dapi.StrictServerInterface: 201 when the route starts, 200 for dryRun.
func (s Server) StartDocRoute(ctx context.Context, req dapi.StartDocRouteRequestObject) (dapi.StartDocRouteResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocRouteStartResult, error) {
		b, err := body(req.Body)
		if err != nil {
			return dapi.DocRouteStartResult{}, err
		}
		return s.S.StartRoute(ctx, tc, req.DocumentId, b)
	}, func(out dapi.DocRouteStartResult, m meta) dapi.StartDocRouteResponseObject {
		if !out.Applied {
			return dapi.StartDocRoute200JSONResponse{Body: out, Headers: dapi.StartDocRoute200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
		}
		return dapi.StartDocRoute201JSONResponse{Body: out, Headers: dapi.StartDocRoute201ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.StartDocRouteResponseObject {
		return dapi.StartDocRoute422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// DecideDocRoute implements dapi.StrictServerInterface.
func (s Server) DecideDocRoute(ctx context.Context, req dapi.DecideDocRouteRequestObject) (dapi.DecideDocRouteResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocRoute, error) {
		b, err := body(req.Body)
		if err != nil {
			return dapi.DocRoute{}, err
		}
		return s.S.DecideRoute(ctx, tc, req.DocumentId, b)
	}, func(out dapi.DocRoute, m meta) dapi.DecideDocRouteResponseObject {
		return dapi.DecideDocRoute200JSONResponse{Body: out, Headers: dapi.DecideDocRoute200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.DecideDocRouteResponseObject {
		return dapi.DecideDocRoute422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// RequestDocSignCode implements dapi.StrictServerInterface.
func (s Server) RequestDocSignCode(ctx context.Context, req dapi.RequestDocSignCodeRequestObject) (dapi.RequestDocSignCodeResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocSignChallenge, error) {
		b, err := body(req.Body)
		if err != nil {
			return dapi.DocSignChallenge{}, err
		}
		return s.S.RequestSignCode(ctx, tc, req.DocumentId, b)
	}, func(out dapi.DocSignChallenge, m meta) dapi.RequestDocSignCodeResponseObject {
		return dapi.RequestDocSignCode200JSONResponse{Body: out, Headers: dapi.RequestDocSignCode200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.RequestDocSignCodeResponseObject {
		return dapi.RequestDocSignCode422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// ConfirmDocSign implements dapi.StrictServerInterface.
func (s Server) ConfirmDocSign(ctx context.Context, req dapi.ConfirmDocSignRequestObject) (dapi.ConfirmDocSignResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocSignResult, error) {
		b, err := body(req.Body)
		if err != nil {
			return dapi.DocSignResult{}, err
		}
		return s.S.ConfirmSign(ctx, tc, req.DocumentId, b)
	}, func(out dapi.DocSignResult, m meta) dapi.ConfirmDocSignResponseObject {
		return dapi.ConfirmDocSign200JSONResponse{Body: out, Headers: dapi.ConfirmDocSign200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.ConfirmDocSignResponseObject {
		return dapi.ConfirmDocSign422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// AckDocument implements dapi.StrictServerInterface.
func (s Server) AckDocument(ctx context.Context, req dapi.AckDocumentRequestObject) (dapi.AckDocumentResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocAckResult, error) {
		b, err := body(req.Body)
		if err != nil {
			return dapi.DocAckResult{}, err
		}
		return s.S.Ack(ctx, tc, req.DocumentId, b)
	}, func(out dapi.DocAckResult, m meta) dapi.AckDocumentResponseObject {
		return dapi.AckDocument200JSONResponse{Body: out, Headers: dapi.AckDocument200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.AckDocumentResponseObject {
		return dapi.AckDocument422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// CloseDocAck implements dapi.StrictServerInterface.
func (s Server) CloseDocAck(ctx context.Context, req dapi.CloseDocAckRequestObject) (dapi.CloseDocAckResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocRoute, error) {
		return s.S.CloseAck(ctx, tc, req.DocumentId)
	}, func(out dapi.DocRoute, m meta) dapi.CloseDocAckResponseObject {
		return dapi.CloseDocAck200JSONResponse{Body: out, Headers: dapi.CloseDocAck200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.CloseDocAckResponseObject {
		return dapi.CloseDocAck422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// ResumeDocRoute implements dapi.StrictServerInterface.
func (s Server) ResumeDocRoute(ctx context.Context, req dapi.ResumeDocRouteRequestObject) (dapi.ResumeDocRouteResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocRoute, error) {
		return s.S.ResumeRoute(ctx, tc, req.DocumentId)
	}, func(out dapi.DocRoute, m meta) dapi.ResumeDocRouteResponseObject {
		return dapi.ResumeDocRoute200JSONResponse{Body: out, Headers: dapi.ResumeDocRoute200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.ResumeDocRouteResponseObject {
		return dapi.ResumeDocRoute422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// CancelDocRoute implements dapi.StrictServerInterface.
func (s Server) CancelDocRoute(ctx context.Context, req dapi.CancelDocRouteRequestObject) (dapi.CancelDocRouteResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocRoute, error) {
		return s.S.CancelRoute(ctx, tc, req.DocumentId)
	}, func(out dapi.DocRoute, m meta) dapi.CancelDocRouteResponseObject {
		return dapi.CancelDocRoute200JSONResponse{Body: out, Headers: dapi.CancelDocRoute200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.CancelDocRouteResponseObject {
		return dapi.CancelDocRoute422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}
