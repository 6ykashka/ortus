package knowledge

import (
	"context"
	"errors"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	kapi "github.com/ortus/ortus-crm/backend/internal/api/knowledge"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// noStore is Cache-Control of every answer (the contract: «private, no-store»).
const noStore = "private, no-store"

// Server implements kapi.StrictServerInterface over the service.
type Server struct{ S *Service }

var _ kapi.StrictServerInterface = Server{}

func tenant(ctx context.Context) (tenantctx.TenantContext, error) {
	tc, ok := tenantctx.FromContext(ctx)
	if !ok {
		return tenantctx.TenantContext{}, problem.New(problem.CodeNotFound, "")
	}
	return tc, nil
}

// meta is the headers of an answer: Cache-Control, X-Request-Id and Idempotency-Replayed (false: a replay is served
// by the idempotency guard).
type meta struct {
	cache, rid *string
	replayed   *bool
}

func metaOf(ctx context.Context) meta {
	c, id, no := noStore, requestid.FromContext(ctx), false
	return meta{&c, &id, &no}
}

// v422 is the 422 of an operation with the violation of a validation of one field.
type v422 = kapi.ValidationApplicationProblemPlusJSONResponse

// fields is the 422 with the violation of a fieldsError (ok false — another error).
func fields(ctx context.Context, err error) (v422, bool) {
	fe, ok := errors.AsType[*fieldsError](err)
	if !ok {
		return v422{}, false
	}
	p := catalog.Problems[codeValidation]
	rid, detail := requestid.FromContext(ctx), fe.detail
	v := []kapi.ProblemViolation{{Field: fe.field, Code: fe.code, Message: fe.detail}}
	return v422{
		Body: kapi.Problem{Type: problem.TypeBase + codeValidation, Title: p.Title, Status: int64(p.Status), Code: codeValidation,
			Detail: &detail, RequestId: rid, Violations: &v},
		Headers: kapi.ValidationResponseHeaders{XRequestId: &rid},
	}, true
}

// answer runs call for the tenant of ctx and makes the answer of its result with ok; a validation of a field is the
// 422 of the operation when bad is given (otherwise the router answers 422 without the violation).
func answer[T, R any](ctx context.Context, call func(tenantctx.TenantContext) (T, error), ok func(T, meta) R, bad func(v422) R) (R, error) {
	var zero R
	tc, err := tenant(ctx)
	if err != nil {
		return zero, err
	}
	out, err := call(tc)
	if v, isField := fields(ctx, err); isField && bad != nil {
		return bad(v), nil
	}
	if err != nil {
		return zero, err
	}
	return ok(out, metaOf(ctx)), nil
}

// body returns the decoded body of a command (nil — 400 malformed_request).
func body[T any](b *T) (T, error) {
	if b == nil {
		var zero T
		return zero, problem.New(problem.CodeMalformedRequest, "")
	}
	return *b, nil
}

// ListKnowledgeSpaces implements kapi.StrictServerInterface.
func (s Server) ListKnowledgeSpaces(ctx context.Context, req kapi.ListKnowledgeSpacesRequestObject) (kapi.ListKnowledgeSpacesResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeSpaceList, error) {
		return s.S.Spaces(ctx, tc, Page{Cursor: req.Params.Cursor, Limit: req.Params.Limit})
	}, func(out kapi.KnowledgeSpaceList, m meta) kapi.ListKnowledgeSpacesResponseObject {
		return kapi.ListKnowledgeSpaces200JSONResponse{Body: out, Headers: kapi.ListKnowledgeSpaces200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
	}, nil)
}

// CreateKnowledgeSpace implements kapi.StrictServerInterface.
func (s Server) CreateKnowledgeSpace(ctx context.Context, req kapi.CreateKnowledgeSpaceRequestObject) (kapi.CreateKnowledgeSpaceResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeSpace, error) {
		b, err := body(req.Body)
		if err != nil {
			return kapi.KnowledgeSpace{}, err
		}
		return s.S.CreateSpace(ctx, tc, b)
	}, func(out kapi.KnowledgeSpace, m meta) kapi.CreateKnowledgeSpaceResponseObject {
		tag := etag(out.Revision)
		return kapi.CreateKnowledgeSpace201JSONResponse{Body: out, Headers: kapi.CreateKnowledgeSpace201ResponseHeaders{CacheControl: m.cache,
			ETag: &tag, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) kapi.CreateKnowledgeSpaceResponseObject {
		return kapi.CreateKnowledgeSpace422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// ListKnowledgeSpaceTemplates implements kapi.StrictServerInterface.
func (s Server) ListKnowledgeSpaceTemplates(ctx context.Context, _ kapi.ListKnowledgeSpaceTemplatesRequestObject) (kapi.ListKnowledgeSpaceTemplatesResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeSpaceTemplateList, error) {
		return s.S.Templates(ctx, tc)
	},
		func(out kapi.KnowledgeSpaceTemplateList, m meta) kapi.ListKnowledgeSpaceTemplatesResponseObject {
			return kapi.ListKnowledgeSpaceTemplates200JSONResponse{Body: out,
				Headers: kapi.ListKnowledgeSpaceTemplates200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
		}, nil)
}

// UpdateKnowledgeSpace implements kapi.StrictServerInterface.
func (s Server) UpdateKnowledgeSpace(ctx context.Context, req kapi.UpdateKnowledgeSpaceRequestObject) (kapi.UpdateKnowledgeSpaceResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeSpaceChange, error) {
		b, err := body(req.Body)
		if err != nil {
			return kapi.KnowledgeSpaceChange{}, err
		}
		return s.S.UpdateSpace(ctx, tc, req.SpaceId, req.Params.IfMatch, b)
	}, func(out kapi.KnowledgeSpaceChange, m meta) kapi.UpdateKnowledgeSpaceResponseObject {
		tag := etag(out.Space.Revision)
		return kapi.UpdateKnowledgeSpace200JSONResponse{Body: out, Headers: kapi.UpdateKnowledgeSpace200ResponseHeaders{CacheControl: m.cache,
			ETag: &tag, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) kapi.UpdateKnowledgeSpaceResponseObject {
		return kapi.UpdateKnowledgeSpace422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// GetKnowledgeSpaceTree implements kapi.StrictServerInterface.
func (s Server) GetKnowledgeSpaceTree(ctx context.Context, req kapi.GetKnowledgeSpaceTreeRequestObject) (kapi.GetKnowledgeSpaceTreeResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeTree, error) { return s.S.Tree(ctx, tc, req.SpaceId) },
		func(out kapi.KnowledgeTree, m meta) kapi.GetKnowledgeSpaceTreeResponseObject {
			return kapi.GetKnowledgeSpaceTree200JSONResponse{Body: out, Headers: kapi.GetKnowledgeSpaceTree200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
		}, nil)
}

// SearchKnowledge implements kapi.StrictServerInterface.
func (s Server) SearchKnowledge(ctx context.Context, req kapi.SearchKnowledgeRequestObject) (kapi.SearchKnowledgeResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeSearchResult, error) {
		return s.S.Search(ctx, tc, req.Params.Q, req.Params.SpaceId)
	}, func(out kapi.KnowledgeSearchResult, m meta) kapi.SearchKnowledgeResponseObject {
		return kapi.SearchKnowledge200JSONResponse{Body: out, Headers: kapi.SearchKnowledge200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
	}, func(v v422) kapi.SearchKnowledgeResponseObject {
		return kapi.SearchKnowledge422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// GetKnowledgeNode implements kapi.StrictServerInterface.
func (s Server) GetKnowledgeNode(ctx context.Context, req kapi.GetKnowledgeNodeRequestObject) (kapi.GetKnowledgeNodeResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeNode, error) { return s.S.Node(ctx, tc, req.NodeId) },
		func(out kapi.KnowledgeNode, m meta) kapi.GetKnowledgeNodeResponseObject {
			tag := etag(out.Revision)
			return kapi.GetKnowledgeNode200JSONResponse{Body: out, Headers: kapi.GetKnowledgeNode200ResponseHeaders{CacheControl: m.cache, ETag: &tag,
				XRequestId: m.rid}}
		}, nil)
}

// GetKnowledgeNodeVersion implements kapi.StrictServerInterface.
func (s Server) GetKnowledgeNodeVersion(ctx context.Context, req kapi.GetKnowledgeNodeVersionRequestObject) (kapi.GetKnowledgeNodeVersionResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeVersion, error) {
		return s.S.Version(ctx, tc, req.NodeId, req.Version)
	}, func(out kapi.KnowledgeVersion, m meta) kapi.GetKnowledgeNodeVersionResponseObject {
		return kapi.GetKnowledgeNodeVersion200JSONResponse{Body: out,
			Headers: kapi.GetKnowledgeNodeVersion200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
	}, nil)
}

// CreateKnowledgeNode implements kapi.StrictServerInterface.
func (s Server) CreateKnowledgeNode(ctx context.Context, req kapi.CreateKnowledgeNodeRequestObject) (kapi.CreateKnowledgeNodeResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeNode, error) {
		b, err := body(req.Body)
		if err != nil {
			return kapi.KnowledgeNode{}, err
		}
		return s.S.CreateNode(ctx, tc, req.SpaceId, b)
	}, func(out kapi.KnowledgeNode, m meta) kapi.CreateKnowledgeNodeResponseObject {
		tag := etag(out.Revision)
		return kapi.CreateKnowledgeNode201JSONResponse{Body: out, Headers: kapi.CreateKnowledgeNode201ResponseHeaders{CacheControl: m.cache,
			ETag: &tag, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, nil)
}

// PublishKnowledgeNodeVersion implements kapi.StrictServerInterface.
func (s Server) PublishKnowledgeNodeVersion(ctx context.Context, req kapi.PublishKnowledgeNodeVersionRequestObject) (kapi.PublishKnowledgeNodeVersionResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgePublishResult, error) {
		b, err := body(req.Body)
		if err != nil {
			return kapi.KnowledgePublishResult{}, err
		}
		return s.S.Publish(ctx, tc, req.NodeId, req.Params.IfMatch, b)
	}, func(out kapi.KnowledgePublishResult, m meta) kapi.PublishKnowledgeNodeVersionResponseObject {
		tag := etag(out.Node.Revision)
		return kapi.PublishKnowledgeNodeVersion201JSONResponse{Body: out, Headers: kapi.PublishKnowledgeNodeVersion201ResponseHeaders{
			CacheControl: m.cache, ETag: &tag, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) kapi.PublishKnowledgeNodeVersionResponseObject {
		return kapi.PublishKnowledgeNodeVersion422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// SetKnowledgeNodeStatus implements kapi.StrictServerInterface.
func (s Server) SetKnowledgeNodeStatus(ctx context.Context, req kapi.SetKnowledgeNodeStatusRequestObject) (kapi.SetKnowledgeNodeStatusResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeNode, error) {
		b, err := body(req.Body)
		if err != nil {
			return kapi.KnowledgeNode{}, err
		}
		return s.S.SetStatus(ctx, tc, req.NodeId, string(b.Status))
	}, func(out kapi.KnowledgeNode, m meta) kapi.SetKnowledgeNodeStatusResponseObject {
		tag := etag(out.Revision)
		return kapi.SetKnowledgeNodeStatus200JSONResponse{Body: out, Headers: kapi.SetKnowledgeNodeStatus200ResponseHeaders{CacheControl: m.cache,
			ETag: &tag, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, nil)
}

// MoveKnowledgeNode implements kapi.StrictServerInterface.
func (s Server) MoveKnowledgeNode(ctx context.Context, req kapi.MoveKnowledgeNodeRequestObject) (kapi.MoveKnowledgeNodeResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeMoveResult, error) {
		b, err := body(req.Body)
		if err != nil {
			return kapi.KnowledgeMoveResult{}, err
		}
		return s.S.Move(ctx, tc, req.NodeId, b)
	}, func(out kapi.KnowledgeMoveResult, m meta) kapi.MoveKnowledgeNodeResponseObject {
		return kapi.MoveKnowledgeNode200JSONResponse{Body: out, Headers: kapi.MoveKnowledgeNode200ResponseHeaders{CacheControl: m.cache,
			IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) kapi.MoveKnowledgeNodeResponseObject {
		return kapi.MoveKnowledgeNode422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// ArchiveKnowledgeNode implements kapi.StrictServerInterface.
func (s Server) ArchiveKnowledgeNode(ctx context.Context, req kapi.ArchiveKnowledgeNodeRequestObject) (kapi.ArchiveKnowledgeNodeResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeArchiveResult, error) {
		return s.S.SetArchived(ctx, tc, req.NodeId, true)
	}, func(out kapi.KnowledgeArchiveResult, m meta) kapi.ArchiveKnowledgeNodeResponseObject {
		return kapi.ArchiveKnowledgeNode200JSONResponse{Body: out, Headers: kapi.ArchiveKnowledgeNode200ResponseHeaders{CacheControl: m.cache,
			IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, nil)
}

// RestoreKnowledgeNode implements kapi.StrictServerInterface.
func (s Server) RestoreKnowledgeNode(ctx context.Context, req kapi.RestoreKnowledgeNodeRequestObject) (kapi.RestoreKnowledgeNodeResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeArchiveResult, error) {
		return s.S.SetArchived(ctx, tc, req.NodeId, false)
	}, func(out kapi.KnowledgeArchiveResult, m meta) kapi.RestoreKnowledgeNodeResponseObject {
		return kapi.RestoreKnowledgeNode200JSONResponse{Body: out, Headers: kapi.RestoreKnowledgeNode200ResponseHeaders{CacheControl: m.cache,
			IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, nil)
}

// ListKnowledgeArchive implements kapi.StrictServerInterface.
func (s Server) ListKnowledgeArchive(ctx context.Context, req kapi.ListKnowledgeArchiveRequestObject) (kapi.ListKnowledgeArchiveResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeArchiveList, error) {
		return s.S.Archive(ctx, tc, req.SpaceId)
	},
		func(out kapi.KnowledgeArchiveList, m meta) kapi.ListKnowledgeArchiveResponseObject {
			return kapi.ListKnowledgeArchive200JSONResponse{Body: out, Headers: kapi.ListKnowledgeArchive200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
		}, nil)
}

// AckKnowledgeNode implements kapi.StrictServerInterface.
func (s Server) AckKnowledgeNode(ctx context.Context, req kapi.AckKnowledgeNodeRequestObject) (kapi.AckKnowledgeNodeResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeAck, error) {
		b, err := body(req.Body)
		if err != nil {
			return kapi.KnowledgeAck{}, err
		}
		return s.S.Ack(ctx, tc, req.NodeId, b.Version)
	}, func(out kapi.KnowledgeAck, m meta) kapi.AckKnowledgeNodeResponseObject {
		return kapi.AckKnowledgeNode200JSONResponse{Body: out, Headers: kapi.AckKnowledgeNode200ResponseHeaders{CacheControl: m.cache,
			IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) kapi.AckKnowledgeNodeResponseObject {
		return kapi.AckKnowledgeNode422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// CreateKnowledgeTable implements kapi.StrictServerInterface.
func (s Server) CreateKnowledgeTable(ctx context.Context, req kapi.CreateKnowledgeTableRequestObject) (kapi.CreateKnowledgeTableResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (kapi.KnowledgeTable, error) {
		b, err := body(req.Body)
		if err != nil {
			return kapi.KnowledgeTable{}, err
		}
		return s.S.CreateTable(ctx, tc, req.NodeId, b)
	}, func(out kapi.KnowledgeTable, m meta) kapi.CreateKnowledgeTableResponseObject {
		return kapi.CreateKnowledgeTable201JSONResponse{Body: out, Headers: kapi.CreateKnowledgeTable201ResponseHeaders{CacheControl: m.cache,
			IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, nil)
}
