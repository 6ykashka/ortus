package knowledge

import (
	"context"

	kapi "github.com/ortus/ortus-crm/backend/internal/api/knowledge"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// GetKnowledgeNodeAccess implements kapi.StrictServerInterface.
func (s Server) GetKnowledgeNodeAccess(ctx context.Context, req kapi.GetKnowledgeNodeAccessRequestObject) (kapi.GetKnowledgeNodeAccessResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeNodeAccess, error) {
		return s.S.Access(ctx, tc, req.NodeId)
	},
		func(out kapi.KnowledgeNodeAccess, m meta) kapi.GetKnowledgeNodeAccessResponseObject {
			tag := etag(out.Revision)
			return kapi.GetKnowledgeNodeAccess200JSONResponse{Body: out, Headers: kapi.GetKnowledgeNodeAccess200ResponseHeaders{
				CacheControl: m.cache, ETag: &tag, XRequestId: m.rid}}
		}, nil)
}

// SetKnowledgeNodeAccess implements kapi.StrictServerInterface.
func (s Server) SetKnowledgeNodeAccess(ctx context.Context, req kapi.SetKnowledgeNodeAccessRequestObject) (kapi.SetKnowledgeNodeAccessResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeAccessImpact, error) {
		b, err := body(req.Body)
		if err != nil {
			return kapi.KnowledgeAccessImpact{}, err
		}
		return s.S.SetAccess(ctx, tc, req.NodeId, req.Params.IfMatch, b)
	}, func(out kapi.KnowledgeAccessImpact, m meta) kapi.SetKnowledgeNodeAccessResponseObject {
		h := kapi.SetKnowledgeNodeAccess200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}
		if out.Access != nil {
			tag := etag(out.Access.Revision)
			h.ETag = &tag
		}
		return kapi.SetKnowledgeNodeAccess200JSONResponse{Body: out, Headers: h}
	}, func(v v422) kapi.SetKnowledgeNodeAccessResponseObject {
		return kapi.SetKnowledgeNodeAccess422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// ListKnowledgeAccessCandidates implements kapi.StrictServerInterface.
func (s Server) ListKnowledgeAccessCandidates(ctx context.Context, req kapi.ListKnowledgeAccessCandidatesRequestObject) (kapi.ListKnowledgeAccessCandidatesResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeAccessCandidateList, error) {
		return s.S.Candidates(ctx, tc, req.NodeId)
	}, func(out kapi.KnowledgeAccessCandidateList, m meta) kapi.ListKnowledgeAccessCandidatesResponseObject {
		return kapi.ListKnowledgeAccessCandidates200JSONResponse{Body: out,
			Headers: kapi.ListKnowledgeAccessCandidates200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
	}, nil)
}

// GetKnowledgeAccessMap implements kapi.StrictServerInterface.
func (s Server) GetKnowledgeAccessMap(ctx context.Context, req kapi.GetKnowledgeAccessMapRequestObject) (kapi.GetKnowledgeAccessMapResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeAccessMap, error) {
		return s.S.AccessMap(ctx, tc, req.SpaceId, req.Params.MemberIds)
	}, func(out kapi.KnowledgeAccessMap, m meta) kapi.GetKnowledgeAccessMapResponseObject {
		return kapi.GetKnowledgeAccessMap200JSONResponse{Body: out, Headers: kapi.GetKnowledgeAccessMap200ResponseHeaders{CacheControl: m.cache,
			XRequestId: m.rid}}
	}, func(v v422) kapi.GetKnowledgeAccessMapResponseObject {
		return kapi.GetKnowledgeAccessMap422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// ExplainKnowledgeAccess implements kapi.StrictServerInterface.
func (s Server) ExplainKnowledgeAccess(ctx context.Context, req kapi.ExplainKnowledgeAccessRequestObject) (kapi.ExplainKnowledgeAccessResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeAccessExplanation, error) {
		return s.S.Explain(ctx, tc, req.NodeId, req.Params.MemberId)
	}, func(out kapi.KnowledgeAccessExplanation, m meta) kapi.ExplainKnowledgeAccessResponseObject {
		return kapi.ExplainKnowledgeAccess200JSONResponse{Body: out, Headers: kapi.ExplainKnowledgeAccess200ResponseHeaders{CacheControl: m.cache,
			XRequestId: m.rid}}
	}, nil)
}

// CreateKnowledgeAccessRequest implements kapi.StrictServerInterface.
func (s Server) CreateKnowledgeAccessRequest(ctx context.Context, req kapi.CreateKnowledgeAccessRequestRequestObject) (kapi.CreateKnowledgeAccessRequestResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeAccessRequest, error) {
		if _, err := body(req.Body); err != nil {
			return kapi.KnowledgeAccessRequest{}, err
		}
		return s.S.Request(ctx, tc, req.NodeId)
	}, func(out kapi.KnowledgeAccessRequest, m meta) kapi.CreateKnowledgeAccessRequestResponseObject {
		return kapi.CreateKnowledgeAccessRequest201JSONResponse{Body: out, Headers: kapi.CreateKnowledgeAccessRequest201ResponseHeaders{
			CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) kapi.CreateKnowledgeAccessRequestResponseObject {
		return kapi.CreateKnowledgeAccessRequest422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// DecideKnowledgeAccessRequest implements kapi.StrictServerInterface.
func (s Server) DecideKnowledgeAccessRequest(ctx context.Context, req kapi.DecideKnowledgeAccessRequestRequestObject) (kapi.DecideKnowledgeAccessRequestResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeAccessRequest, error) {
		b, err := body(req.Body)
		if err != nil {
			return kapi.KnowledgeAccessRequest{}, err
		}
		if !b.Decision.Valid() {
			return kapi.KnowledgeAccessRequest{}, invalid("decision", "Выберите решение")
		}
		return s.S.Decide(ctx, tc, req.RequestId, b.Decision == kapi.Approve)
	}, func(out kapi.KnowledgeAccessRequest, m meta) kapi.DecideKnowledgeAccessRequestResponseObject {
		return kapi.DecideKnowledgeAccessRequest200JSONResponse{Body: out, Headers: kapi.DecideKnowledgeAccessRequest200ResponseHeaders{
			CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) kapi.DecideKnowledgeAccessRequestResponseObject {
		return kapi.DecideKnowledgeAccessRequest422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// ListKnowledgeAccessRequests implements kapi.StrictServerInterface.
func (s Server) ListKnowledgeAccessRequests(ctx context.Context, req kapi.ListKnowledgeAccessRequestsRequestObject) (kapi.ListKnowledgeAccessRequestsResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeAccessRequestList, error) {
		status := ""
		if req.Params.Status != nil {
			status = string(*req.Params.Status)
		}
		return s.S.Requests(ctx, tc, req.SpaceId, status)
	}, func(out kapi.KnowledgeAccessRequestList, m meta) kapi.ListKnowledgeAccessRequestsResponseObject {
		return kapi.ListKnowledgeAccessRequests200JSONResponse{Body: out,
			Headers: kapi.ListKnowledgeAccessRequests200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
	}, nil)
}

// ListKnowledgeSpaceMembers implements kapi.StrictServerInterface.
func (s Server) ListKnowledgeSpaceMembers(ctx context.Context, req kapi.ListKnowledgeSpaceMembersRequestObject) (kapi.ListKnowledgeSpaceMembersResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeSpaceMembers, error) {
		return s.S.Members(ctx, tc, req.SpaceId)
	},
		func(out kapi.KnowledgeSpaceMembers, m meta) kapi.ListKnowledgeSpaceMembersResponseObject {
			return kapi.ListKnowledgeSpaceMembers200JSONResponse{Body: out,
				Headers: kapi.ListKnowledgeSpaceMembers200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
		}, nil)
}

// SetKnowledgeSpaceMember implements kapi.StrictServerInterface.
func (s Server) SetKnowledgeSpaceMember(ctx context.Context, req kapi.SetKnowledgeSpaceMemberRequestObject) (kapi.SetKnowledgeSpaceMemberResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeSpaceMembers, error) {
		b, err := body(req.Body)
		if err != nil {
			return kapi.KnowledgeSpaceMembers{}, err
		}
		return s.S.SetMember(ctx, tc, req.SpaceId, req.MemberId, b)
	}, func(out kapi.KnowledgeSpaceMembers, m meta) kapi.SetKnowledgeSpaceMemberResponseObject {
		return kapi.SetKnowledgeSpaceMember200JSONResponse{Body: out, Headers: kapi.SetKnowledgeSpaceMember200ResponseHeaders{CacheControl: m.cache,
			IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, nil)
}

// ListKnowledgeRules implements kapi.StrictServerInterface.
func (s Server) ListKnowledgeRules(ctx context.Context, req kapi.ListKnowledgeRulesRequestObject) (kapi.ListKnowledgeRulesResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeRuleList, error) {
		return s.S.Rules(ctx, tc, req.SpaceId)
	},
		func(out kapi.KnowledgeRuleList, m meta) kapi.ListKnowledgeRulesResponseObject {
			return kapi.ListKnowledgeRules200JSONResponse{Body: out, Headers: kapi.ListKnowledgeRules200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
		}, nil)
}

// SetKnowledgeRuleEnabled implements kapi.StrictServerInterface.
func (s Server) SetKnowledgeRuleEnabled(ctx context.Context, req kapi.SetKnowledgeRuleEnabledRequestObject) (kapi.SetKnowledgeRuleEnabledResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeRule, error) {
		b, err := body(req.Body)
		if err != nil {
			return kapi.KnowledgeRule{}, err
		}
		return s.S.SetRule(ctx, tc, req.RuleId, b.Enabled)
	}, func(out kapi.KnowledgeRule, m meta) kapi.SetKnowledgeRuleEnabledResponseObject {
		return kapi.SetKnowledgeRuleEnabled200JSONResponse{Body: out, Headers: kapi.SetKnowledgeRuleEnabled200ResponseHeaders{CacheControl: m.cache,
			IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, nil)
}

// RunKnowledgeReviewCheck implements kapi.StrictServerInterface.
func (s Server) RunKnowledgeReviewCheck(ctx context.Context, req kapi.RunKnowledgeReviewCheckRequestObject) (kapi.RunKnowledgeReviewCheckResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeRunReport, error) {
		return s.S.ReviewCheck(ctx, tc, req.SpaceId)
	},
		func(out kapi.KnowledgeRunReport, m meta) kapi.RunKnowledgeReviewCheckResponseObject {
			return kapi.RunKnowledgeReviewCheck200JSONResponse{Body: out, Headers: kapi.RunKnowledgeReviewCheck200ResponseHeaders{
				CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
		}, nil)
}

// RunKnowledgeSection implements kapi.StrictServerInterface.
func (s Server) RunKnowledgeSection(ctx context.Context, req kapi.RunKnowledgeSectionRequestObject) (kapi.RunKnowledgeSectionResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeRunReport, error) {
		b, err := body(req.Body)
		if err != nil {
			return kapi.KnowledgeRunReport{}, err
		}
		return s.S.Section(ctx, tc, req.SpaceId, b.ProjectId)
	}, func(out kapi.KnowledgeRunReport, m meta) kapi.RunKnowledgeSectionResponseObject {
		return kapi.RunKnowledgeSection200JSONResponse{Body: out, Headers: kapi.RunKnowledgeSection200ResponseHeaders{CacheControl: m.cache,
			IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) kapi.RunKnowledgeSectionResponseObject {
		return kapi.RunKnowledgeSection422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// ListKnowledgeRuns implements kapi.StrictServerInterface.
func (s Server) ListKnowledgeRuns(ctx context.Context, req kapi.ListKnowledgeRunsRequestObject) (kapi.ListKnowledgeRunsResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeRunList, error) { return s.S.Runs(ctx, tc, req.SpaceId) },
		func(out kapi.KnowledgeRunList, m meta) kapi.ListKnowledgeRunsResponseObject {
			return kapi.ListKnowledgeRuns200JSONResponse{Body: out, Headers: kapi.ListKnowledgeRuns200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
		}, nil)
}

// ListKnowledgePages implements kapi.StrictServerInterface.
func (s Server) ListKnowledgePages(ctx context.Context, req kapi.ListKnowledgePagesRequestObject) (kapi.ListKnowledgePagesResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgePageList, error) {
		return s.S.Pages(ctx, tc, Page{Cursor: req.Params.Cursor, Limit: req.Params.Limit})
	}, func(out kapi.KnowledgePageList, m meta) kapi.ListKnowledgePagesResponseObject {
		return kapi.ListKnowledgePages200JSONResponse{Body: out, Headers: kapi.ListKnowledgePages200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
	}, nil)
}

// CreateKnowledgePage implements kapi.StrictServerInterface.
func (s Server) CreateKnowledgePage(ctx context.Context, req kapi.CreateKnowledgePageRequestObject) (kapi.CreateKnowledgePageResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgePage, error) {
		b, err := body(req.Body)
		if err != nil {
			return kapi.KnowledgePage{}, err
		}
		return s.S.CreatePage(ctx, tc, b)
	}, func(out kapi.KnowledgePage, m meta) kapi.CreateKnowledgePageResponseObject {
		tag := etag(out.Revision)
		return kapi.CreateKnowledgePage201JSONResponse{Body: out, Headers: kapi.CreateKnowledgePage201ResponseHeaders{CacheControl: m.cache,
			ETag: &tag, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, nil)
}

// GetKnowledgePage implements kapi.StrictServerInterface.
func (s Server) GetKnowledgePage(ctx context.Context, req kapi.GetKnowledgePageRequestObject) (kapi.GetKnowledgePageResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgePage, error) { return s.S.GetPage(ctx, tc, req.PageId) },
		func(out kapi.KnowledgePage, m meta) kapi.GetKnowledgePageResponseObject {
			tag := etag(out.Revision)
			return kapi.GetKnowledgePage200JSONResponse{Body: out, Headers: kapi.GetKnowledgePage200ResponseHeaders{CacheControl: m.cache, ETag: &tag,
				XRequestId: m.rid}}
		}, nil)
}

// UpdateKnowledgePage implements kapi.StrictServerInterface.
func (s Server) UpdateKnowledgePage(ctx context.Context, req kapi.UpdateKnowledgePageRequestObject) (kapi.UpdateKnowledgePageResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgePage, error) {
		b, err := body(req.Body)
		if err != nil {
			return kapi.KnowledgePage{}, err
		}
		return s.S.UpdatePage(ctx, tc, req.PageId, req.Params.IfMatch, b)
	}, func(out kapi.KnowledgePage, m meta) kapi.UpdateKnowledgePageResponseObject {
		tag := etag(out.Revision)
		return kapi.UpdateKnowledgePage200JSONResponse{Body: out, Headers: kapi.UpdateKnowledgePage200ResponseHeaders{CacheControl: m.cache,
			ETag: &tag, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, nil)
}
