package billinghttp

import (
	"context"

	billingapi "github.com/ortus/ortus-crm/backend/internal/api/billing"
	"github.com/ortus/ortus-crm/backend/internal/control/billing"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// GetTenantPriceBook implements billingapi.StrictServerInterface: the price book of the owner's calculation.
func (s TenantServer) GetTenantPriceBook(ctx context.Context, _ billingapi.GetTenantPriceBookRequestObject) (billingapi.GetTenantPriceBookResponseObject, error) {
	owner, err := ownerOf(ctx)
	if err != nil {
		return nil, err
	}
	pb, err := s.Store.PriceBook(ctx, owner.TenantID)
	if err != nil {
		return nil, storeError(err)
	}
	body, err := recast[billingapi.TenantPriceBook](tenantPriceBook(pb, clockOf(s.Now)))
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	cache, rid := headers(ctx)
	return billingapi.GetTenantPriceBook200JSONResponse{Body: body,
		Headers: billingapi.GetTenantPriceBook200ResponseHeaders{CacheControl: cache, XRequestId: rid}}, nil
}

// ListSubscriptionChangeRequests implements billingapi.StrictServerInterface: the requests of the tenant, newest
// first, the decisions without the operator.
func (s TenantServer) ListSubscriptionChangeRequests(ctx context.Context, req billingapi.ListSubscriptionChangeRequestsRequestObject) (billingapi.ListSubscriptionChangeRequestsResponseObject, error) {
	owner, err := ownerOf(ctx)
	if err != nil {
		return nil, err
	}
	limit, cursor, err := pageOf(req.Params.Limit, req.Params.Cursor)
	if err != nil {
		return nil, err
	}
	status, err := statusOf((*string)(req.Params.Status))
	if err != nil {
		return nil, err
	}
	page, err := s.Store.Requests(ctx, billing.RequestQuery{
		Actor: owner.AccountID, TenantID: &owner.TenantID, Owner: true, Status: status, Cursor: cursor, Limit: limit,
	})
	if err != nil {
		return nil, storeError(err)
	}
	body, err := recast[billingapi.SubscriptionChangeRequestPage](requestPage(page, ownerRequest))
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	cache, rid := headers(ctx)
	return billingapi.ListSubscriptionChangeRequests200JSONResponse{Body: body,
		Headers: billingapi.ListSubscriptionChangeRequests200ResponseHeaders{CacheControl: cache, XRequestId: rid}}, nil
}

// CreateSubscriptionChangeRequest implements billingapi.StrictServerInterface: the request of the owner; a refusal
// with violations is the 422 of the example (tier_below_usage, validation_failed).
func (s TenantServer) CreateSubscriptionChangeRequest(ctx context.Context, req billingapi.CreateSubscriptionChangeRequestRequestObject) (billingapi.CreateSubscriptionChangeRequestResponseObject, error) {
	owner, err := ownerOf(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	r, err := s.Store.CreateRequest(ctx, billing.CreateRequest{
		Owner: owner, Tier: req.Body.TierCode, TermMonths: int(req.Body.TermMonths), Comment: req.Body.Comment,
	})
	if p := validation(ctx, err); p != nil {
		body, rerr := recast[billingapi.Problem](p)
		if rerr != nil {
			return nil, problem.Wrap(problem.CodeDependencyUnavailable, rerr)
		}
		return billingapi.CreateSubscriptionChangeRequest422ApplicationProblemPlusJSONResponse{
			ValidationApplicationProblemPlusJSONResponse: billingapi.ValidationApplicationProblemPlusJSONResponse{
				Body: body, Headers: billingapi.ValidationResponseHeaders{XRequestId: &body.RequestId},
			},
		}, nil
	}
	if err != nil {
		return nil, storeError(err)
	}
	if s.Events != nil {
		s.Events.RequestCreated(ctx, r)
	}
	body, err := recast[billingapi.SubscriptionChangeRequest](ownerRequest(r))
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	cache, rid := headers(ctx)
	replayed := false
	return billingapi.CreateSubscriptionChangeRequest201JSONResponse{Body: body,
		Headers: billingapi.CreateSubscriptionChangeRequest201ResponseHeaders{CacheControl: cache, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// CancelSubscriptionChangeRequest implements billingapi.StrictServerInterface: the owner cancels the pending request.
func (s TenantServer) CancelSubscriptionChangeRequest(ctx context.Context, req billingapi.CancelSubscriptionChangeRequestRequestObject) (billingapi.CancelSubscriptionChangeRequestResponseObject, error) {
	owner, err := ownerOf(ctx)
	if err != nil {
		return nil, err
	}
	r, err := s.Store.CancelRequest(ctx, billing.CancelRequest{Owner: owner, ID: req.ChangeRequestId})
	if err != nil {
		return nil, storeError(err)
	}
	body, err := recast[billingapi.SubscriptionChangeRequest](ownerRequest(r))
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	cache, rid := headers(ctx)
	replayed := false
	return billingapi.CancelSubscriptionChangeRequest200JSONResponse{Body: body,
		Headers: billingapi.CancelSubscriptionChangeRequest200ResponseHeaders{CacheControl: cache, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}
