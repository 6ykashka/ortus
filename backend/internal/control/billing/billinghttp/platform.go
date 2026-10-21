package billinghttp

import (
	"context"

	platformapi "github.com/ortus/ortus-crm/backend/internal/api/platform"
	"github.com/ortus/ortus-crm/backend/internal/control/billing"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// ListPlatformSubscriptionRequests implements platformapi.StrictServerInterface: the queue of the requests of every
// organization (or of the tenantId filter) with the operators who decided them; pendingCount counts them all.
func (s PlatformServer) ListPlatformSubscriptionRequests(ctx context.Context, req platformapi.ListPlatformSubscriptionRequestsRequestObject) (platformapi.ListPlatformSubscriptionRequestsResponseObject, error) {
	actor, err := actorOf(ctx)
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
	page, err := s.Store.Requests(ctx, billing.RequestQuery{Actor: actor, TenantID: req.Params.TenantId, Status: status, Cursor: cursor, Limit: limit})
	if err != nil {
		return nil, storeError(err)
	}
	body, err := recast[platformapi.SubscriptionChangeRequestPage](requestPage(page, operatorRequest))
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	cache, rid := headers(ctx)
	return platformapi.ListPlatformSubscriptionRequests200JSONResponse{Body: body,
		Headers: platformapi.ListPlatformSubscriptionRequests200ResponseHeaders{CacheControl: cache, XRequestId: rid}}, nil
}

// decisions of SubscriptionRequestDecision.
var decisions = map[platformapi.SubscriptionRequestDecisionDecision]bool{"approve": true, "reject": false}

// DecidePlatformSubscriptionRequest implements platformapi.StrictServerInterface: approve or reject; a rejection
// without a note is the 422 of the example.
func (s PlatformServer) DecidePlatformSubscriptionRequest(ctx context.Context, req platformapi.DecidePlatformSubscriptionRequestRequestObject) (platformapi.DecidePlatformSubscriptionRequestResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	approve, known := decisions[req.Body.Decision]
	if !known {
		return nil, problem.New(problem.CodeMalformedRequest, "decision: approve | reject")
	}
	r, err := s.Store.Decide(ctx, billing.Decision{Actor: actor, ID: req.ChangeRequestId, Approve: approve, Note: req.Body.Note})
	if p := validation(ctx, err); p != nil {
		body, rerr := recast[platformapi.Problem](p)
		if rerr != nil {
			return nil, problem.Wrap(problem.CodeDependencyUnavailable, rerr)
		}
		return platformapi.DecidePlatformSubscriptionRequest422ApplicationProblemPlusJSONResponse{
			ValidationApplicationProblemPlusJSONResponse: platformapi.ValidationApplicationProblemPlusJSONResponse{
				Body: body, Headers: platformapi.ValidationResponseHeaders{XRequestId: &body.RequestId},
			},
		}, nil
	}
	if err != nil {
		return nil, storeError(err)
	}
	if s.Events != nil {
		s.Events.RequestDecided(ctx, r)
	}
	body, err := recast[platformapi.SubscriptionChangeRequest](operatorRequest(r))
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	cache, rid := headers(ctx)
	replayed := false
	return platformapi.DecidePlatformSubscriptionRequest200JSONResponse{Body: body,
		Headers: platformapi.DecidePlatformSubscriptionRequest200ResponseHeaders{CacheControl: cache, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// ListPriceBookVersions implements platformapi.StrictServerInterface: the versions newest first with their authors
// and subscription counts; cancelled ones with includeCancelled. The price book is short (a version a few times a
// year, PriceBookVersionPage maxItems 200): one page, a cursor is refused.
func (s PlatformServer) ListPriceBookVersions(ctx context.Context, req platformapi.ListPriceBookVersionsRequestObject) (platformapi.ListPriceBookVersionsResponseObject, error) {
	if _, cursor, err := pageOf(req.Params.Limit, req.Params.Cursor); err != nil {
		return nil, err
	} else if cursor != "" {
		return nil, problem.New(problem.CodeMalformedRequest, "cursor")
	}
	vs, err := s.Store.Versions(ctx, req.Params.IncludeCancelled != nil && *req.Params.IncludeCancelled)
	if err != nil {
		return nil, storeError(err)
	}
	now := clockOf(s.Now)
	page := struct {
		Items      []versionView `json:"items"`
		NextCursor *string       `json:"nextCursor"`
	}{Items: make([]versionView, 0, len(vs))}
	for _, v := range vs[:min(len(vs), maxLimit)] {
		page.Items = append(page.Items, operatorVersion(v, now))
	}
	body, err := recast[platformapi.PriceBookVersionPage](page)
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	cache, rid := headers(ctx)
	return platformapi.ListPriceBookVersions200JSONResponse{Body: body,
		Headers: platformapi.ListPriceBookVersions200ResponseHeaders{CacheControl: cache, XRequestId: rid}}, nil
}

// draftOf is the body of publishPriceBookVersion as a draft of the billing.
func draftOf(b platformapi.PriceBookVersionCreate) billing.Draft {
	d := billing.Draft{EffectiveFrom: b.EffectiveFrom.Format("2006-01-02"), Note: b.Note}
	for _, t := range b.Tiers {
		dt := billing.DraftTier{Name: t.Name, SeatsLimit: t.SeatsLimit}
		if t.Code != nil {
			dt.Code = *t.Code
		}
		if t.MonthAmountMinor != nil {
			dt.MonthMinor = new(int64(*t.MonthAmountMinor))
		}
		d.Tiers = append(d.Tiers, dt)
	}
	for _, t := range b.Terms {
		d.Terms = append(d.Terms, billing.Term{Months: int(t.Months), DiscountPercent: t.DiscountPercent})
	}
	return d
}

// PublishPriceBookVersion implements platformapi.StrictServerInterface: the next version from a date; the checks of
// the draft are the 422 of the example.
func (s PlatformServer) PublishPriceBookVersion(ctx context.Context, req platformapi.PublishPriceBookVersionRequestObject) (platformapi.PublishPriceBookVersionResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	v, err := s.Store.Publish(ctx, billing.Publish{Actor: actor, Draft: draftOf(*req.Body)})
	if p := validation(ctx, err); p != nil {
		body, rerr := recast[platformapi.Problem](p)
		if rerr != nil {
			return nil, problem.Wrap(problem.CodeDependencyUnavailable, rerr)
		}
		return platformapi.PublishPriceBookVersion422ApplicationProblemPlusJSONResponse{
			ValidationApplicationProblemPlusJSONResponse: platformapi.ValidationApplicationProblemPlusJSONResponse{
				Body: body, Headers: platformapi.ValidationResponseHeaders{XRequestId: &body.RequestId},
			},
		}, nil
	}
	if err != nil {
		return nil, storeError(err)
	}
	body, err := recast[platformapi.PriceBookVersion](operatorVersion(v, clockOf(s.Now)))
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	cache, rid := headers(ctx)
	replayed := false
	return platformapi.PublishPriceBookVersion201JSONResponse{Body: body,
		Headers: platformapi.PublishPriceBookVersion201ResponseHeaders{CacheControl: cache, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// CancelPriceBookVersion implements platformapi.StrictServerInterface: the scheduled version is cancelled.
func (s PlatformServer) CancelPriceBookVersion(ctx context.Context, req platformapi.CancelPriceBookVersionRequestObject) (platformapi.CancelPriceBookVersionResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}
	v, err := s.Store.CancelVersion(ctx, billing.CancelVersion{Actor: actor, Number: req.Version})
	if err != nil {
		return nil, storeError(err)
	}
	body, err := recast[platformapi.PriceBookVersion](operatorVersion(v, clockOf(s.Now)))
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	cache, rid := headers(ctx)
	replayed := false
	return platformapi.CancelPriceBookVersion200JSONResponse{Body: body,
		Headers: platformapi.CancelPriceBookVersion200ResponseHeaders{CacheControl: cache, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}
