package docs

import (
	"context"

	dapi "github.com/ortus/ortus-crm/backend/internal/api/docs"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// The methods of the strict server of the tag Docs: each one binds the request to a service call and the result to the answer.

// ListDocFolders implements dapi.StrictServerInterface.
func (s Server) ListDocFolders(ctx context.Context, _ dapi.ListDocFoldersRequestObject) (dapi.ListDocFoldersResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocFolderList, error) {
		return s.S.Folders(ctx, tc)
	}, func(out dapi.DocFolderList, m meta) dapi.ListDocFoldersResponseObject {
		return dapi.ListDocFolders200JSONResponse{Body: out, Headers: dapi.ListDocFolders200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
	}, func(v v422) dapi.ListDocFoldersResponseObject {
		return dapi.ListDocFolders422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// CreateDocFolder implements dapi.StrictServerInterface.
func (s Server) CreateDocFolder(ctx context.Context, req dapi.CreateDocFolderRequestObject) (dapi.CreateDocFolderResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocFolder, error) {
		b, err := body(req.Body)
		if err != nil {
			return dapi.DocFolder{}, err
		}
		return s.S.CreateFolder(ctx, tc, b)
	}, func(out dapi.DocFolder, m meta) dapi.CreateDocFolderResponseObject {
		return dapi.CreateDocFolder201JSONResponse{Body: out, Headers: dapi.CreateDocFolder201ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.CreateDocFolderResponseObject {
		return dapi.CreateDocFolder422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// DeleteDocFolder implements dapi.StrictServerInterface.
func (s Server) DeleteDocFolder(ctx context.Context, req dapi.DeleteDocFolderRequestObject) (dapi.DeleteDocFolderResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (struct{}, error) {
		return struct{}{}, s.S.DeleteFolder(ctx, tc, req.FolderId)
	}, func(_ struct{}, m meta) dapi.DeleteDocFolderResponseObject {
		return dapi.DeleteDocFolder204Response{Headers: dapi.DeleteDocFolder204ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.DeleteDocFolderResponseObject {
		return dapi.DeleteDocFolder422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// UpdateDocFolder implements dapi.StrictServerInterface.
func (s Server) UpdateDocFolder(ctx context.Context, req dapi.UpdateDocFolderRequestObject) (dapi.UpdateDocFolderResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocFolder, error) {
		b, err := body(req.Body)
		if err != nil {
			return dapi.DocFolder{}, err
		}
		return s.S.UpdateFolder(ctx, tc, req.FolderId, req.Params.IfMatch, b)
	}, func(out dapi.DocFolder, m meta) dapi.UpdateDocFolderResponseObject {
		tag := etag(out.Revision)
		return dapi.UpdateDocFolder200JSONResponse{Body: out, Headers: dapi.UpdateDocFolder200ResponseHeaders{CacheControl: m.cache, ETag: &tag, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.UpdateDocFolderResponseObject {
		return dapi.UpdateDocFolder422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// SetDocFolderShares implements dapi.StrictServerInterface.
func (s Server) SetDocFolderShares(ctx context.Context, req dapi.SetDocFolderSharesRequestObject) (dapi.SetDocFolderSharesResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocSharesResult, error) {
		b, err := body(req.Body)
		if err != nil {
			return dapi.DocSharesResult{}, err
		}
		return s.S.SetFolderShares(ctx, tc, req.FolderId, b)
	}, func(out dapi.DocSharesResult, m meta) dapi.SetDocFolderSharesResponseObject {
		return dapi.SetDocFolderShares200JSONResponse{Body: out, Headers: dapi.SetDocFolderShares200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.SetDocFolderSharesResponseObject {
		return dapi.SetDocFolderShares422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// CreateDocJob implements dapi.StrictServerInterface.
func (s Server) CreateDocJob(ctx context.Context, req dapi.CreateDocJobRequestObject) (dapi.CreateDocJobResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocJob, error) {
		b, err := body(req.Body)
		if err != nil {
			return dapi.DocJob{}, err
		}
		return s.S.CreateJob(ctx, tc, b)
	}, func(out dapi.DocJob, m meta) dapi.CreateDocJobResponseObject {
		return dapi.CreateDocJob202JSONResponse{Body: out, Headers: dapi.CreateDocJob202ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.CreateDocJobResponseObject {
		return dapi.CreateDocJob422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// GetDocJob implements dapi.StrictServerInterface.
func (s Server) GetDocJob(ctx context.Context, req dapi.GetDocJobRequestObject) (dapi.GetDocJobResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocJob, error) {
		return s.S.Job(ctx, tc, req.JobId)
	}, func(out dapi.DocJob, m meta) dapi.GetDocJobResponseObject {
		return dapi.GetDocJob200JSONResponse{Body: out, Headers: dapi.GetDocJob200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
	}, func(v v422) dapi.GetDocJobResponseObject {
		return dapi.GetDocJob422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// RetryDocJob implements dapi.StrictServerInterface.
func (s Server) RetryDocJob(ctx context.Context, req dapi.RetryDocJobRequestObject) (dapi.RetryDocJobResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocJob, error) {
		b, err := body(req.Body)
		if err != nil {
			return dapi.DocJob{}, err
		}
		return s.S.RetryJob(ctx, tc, req.JobId, b)
	}, func(out dapi.DocJob, m meta) dapi.RetryDocJobResponseObject {
		return dapi.RetryDocJob202JSONResponse{Body: out, Headers: dapi.RetryDocJob202ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.RetryDocJobResponseObject {
		return dapi.RetryDocJob422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// ListDocRouteTemplates implements dapi.StrictServerInterface.
func (s Server) ListDocRouteTemplates(ctx context.Context, _ dapi.ListDocRouteTemplatesRequestObject) (dapi.ListDocRouteTemplatesResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocRouteTemplateList, error) {
		return s.S.RouteTemplates(ctx, tc)
	}, func(out dapi.DocRouteTemplateList, m meta) dapi.ListDocRouteTemplatesResponseObject {
		return dapi.ListDocRouteTemplates200JSONResponse{Body: out, Headers: dapi.ListDocRouteTemplates200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
	}, func(v v422) dapi.ListDocRouteTemplatesResponseObject {
		return dapi.ListDocRouteTemplates422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// ListDocTemplates implements dapi.StrictServerInterface.
func (s Server) ListDocTemplates(ctx context.Context, _ dapi.ListDocTemplatesRequestObject) (dapi.ListDocTemplatesResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocTemplateList, error) {
		return s.S.Templates(ctx, tc)
	}, func(out dapi.DocTemplateList, m meta) dapi.ListDocTemplatesResponseObject {
		return dapi.ListDocTemplates200JSONResponse{Body: out, Headers: dapi.ListDocTemplates200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
	}, func(v v422) dapi.ListDocTemplatesResponseObject {
		return dapi.ListDocTemplates422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// ListDocuments implements dapi.StrictServerInterface.
func (s Server) ListDocuments(ctx context.Context, req dapi.ListDocumentsRequestObject) (dapi.ListDocumentsResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocumentList, error) {
		return s.S.Documents(ctx, tc, listQuery(req.Params))
	}, func(out dapi.DocumentList, m meta) dapi.ListDocumentsResponseObject {
		return dapi.ListDocuments200JSONResponse{Body: out, Headers: dapi.ListDocuments200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
	}, func(v v422) dapi.ListDocumentsResponseObject {
		return dapi.ListDocuments422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// CreateDocument implements dapi.StrictServerInterface.
func (s Server) CreateDocument(ctx context.Context, req dapi.CreateDocumentRequestObject) (dapi.CreateDocumentResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.Document, error) {
		b, err := body(req.Body)
		if err != nil {
			return dapi.Document{}, err
		}
		return s.S.CreateDocument(ctx, tc, b)
	}, func(out dapi.Document, m meta) dapi.CreateDocumentResponseObject {
		return dapi.CreateDocument201JSONResponse{Body: out, Headers: dapi.CreateDocument201ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.CreateDocumentResponseObject {
		return dapi.CreateDocument422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// GetDocument implements dapi.StrictServerInterface.
func (s Server) GetDocument(ctx context.Context, req dapi.GetDocumentRequestObject) (dapi.GetDocumentResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.Document, error) {
		return s.S.Document(ctx, tc, req.DocumentId)
	}, func(out dapi.Document, m meta) dapi.GetDocumentResponseObject {
		tag := etag(out.Revision)
		return dapi.GetDocument200JSONResponse{Body: out, Headers: dapi.GetDocument200ResponseHeaders{CacheControl: m.cache, ETag: &tag, XRequestId: m.rid}}
	}, func(v v422) dapi.GetDocumentResponseObject {
		return dapi.GetDocument422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// UpdateDocument implements dapi.StrictServerInterface.
func (s Server) UpdateDocument(ctx context.Context, req dapi.UpdateDocumentRequestObject) (dapi.UpdateDocumentResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.Document, error) {
		b, err := body(req.Body)
		if err != nil {
			return dapi.Document{}, err
		}
		return s.S.UpdateDocument(ctx, tc, req.DocumentId, req.Params.IfMatch, b)
	}, func(out dapi.Document, m meta) dapi.UpdateDocumentResponseObject {
		tag := etag(out.Revision)
		return dapi.UpdateDocument200JSONResponse{Body: out, Headers: dapi.UpdateDocument200ResponseHeaders{CacheControl: m.cache, ETag: &tag, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.UpdateDocumentResponseObject {
		return dapi.UpdateDocument422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// ListDocActivity implements dapi.StrictServerInterface.
func (s Server) ListDocActivity(ctx context.Context, req dapi.ListDocActivityRequestObject) (dapi.ListDocActivityResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocActivityList, error) {
		return s.S.Activity(ctx, tc, req.DocumentId, Page{Cursor: req.Params.Cursor, Limit: req.Params.Limit})
	}, func(out dapi.DocActivityList, m meta) dapi.ListDocActivityResponseObject {
		return dapi.ListDocActivity200JSONResponse{Body: out, Headers: dapi.ListDocActivity200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
	}, func(v v422) dapi.ListDocActivityResponseObject {
		return dapi.ListDocActivity422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// ArchiveDocument implements dapi.StrictServerInterface.
func (s Server) ArchiveDocument(ctx context.Context, req dapi.ArchiveDocumentRequestObject) (dapi.ArchiveDocumentResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.Document, error) {
		return s.S.ArchiveDocument(ctx, tc, req.DocumentId)
	}, func(out dapi.Document, m meta) dapi.ArchiveDocumentResponseObject {
		return dapi.ArchiveDocument200JSONResponse{Body: out, Headers: dapi.ArchiveDocument200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.ArchiveDocumentResponseObject {
		return dapi.ArchiveDocument422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// ListDocComments implements dapi.StrictServerInterface.
func (s Server) ListDocComments(ctx context.Context, req dapi.ListDocCommentsRequestObject) (dapi.ListDocCommentsResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocCommentList, error) {
		return s.S.Comments(ctx, tc, req.DocumentId)
	}, func(out dapi.DocCommentList, m meta) dapi.ListDocCommentsResponseObject {
		return dapi.ListDocComments200JSONResponse{Body: out, Headers: dapi.ListDocComments200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
	}, func(v v422) dapi.ListDocCommentsResponseObject {
		return dapi.ListDocComments422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// CreateDocComment implements dapi.StrictServerInterface.
func (s Server) CreateDocComment(ctx context.Context, req dapi.CreateDocCommentRequestObject) (dapi.CreateDocCommentResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocComment, error) {
		b, err := body(req.Body)
		if err != nil {
			return dapi.DocComment{}, err
		}
		return s.S.CreateComment(ctx, tc, req.DocumentId, b)
	}, func(out dapi.DocComment, m meta) dapi.CreateDocCommentResponseObject {
		return dapi.CreateDocComment201JSONResponse{Body: out, Headers: dapi.CreateDocComment201ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.CreateDocCommentResponseObject {
		return dapi.CreateDocComment422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// ReplyDocComment implements dapi.StrictServerInterface.
func (s Server) ReplyDocComment(ctx context.Context, req dapi.ReplyDocCommentRequestObject) (dapi.ReplyDocCommentResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocComment, error) {
		b, err := body(req.Body)
		if err != nil {
			return dapi.DocComment{}, err
		}
		return s.S.ReplyComment(ctx, tc, req.DocumentId, req.CommentId, b)
	}, func(out dapi.DocComment, m meta) dapi.ReplyDocCommentResponseObject {
		return dapi.ReplyDocComment201JSONResponse{Body: out, Headers: dapi.ReplyDocComment201ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.ReplyDocCommentResponseObject {
		return dapi.ReplyDocComment422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// ResolveDocComment implements dapi.StrictServerInterface.
func (s Server) ResolveDocComment(ctx context.Context, req dapi.ResolveDocCommentRequestObject) (dapi.ResolveDocCommentResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocComment, error) {
		return s.S.ResolveComment(ctx, tc, req.DocumentId, req.CommentId)
	}, func(out dapi.DocComment, m meta) dapi.ResolveDocCommentResponseObject {
		return dapi.ResolveDocComment200JSONResponse{Body: out, Headers: dapi.ResolveDocComment200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.ResolveDocCommentResponseObject {
		return dapi.ResolveDocComment422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// SkipDocMentionGrant implements dapi.StrictServerInterface.
func (s Server) SkipDocMentionGrant(ctx context.Context, req dapi.SkipDocMentionGrantRequestObject) (dapi.SkipDocMentionGrantResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocComment, error) {
		return s.S.SkipMentionGrant(ctx, tc, req.DocumentId, req.CommentId)
	}, func(out dapi.DocComment, m meta) dapi.SkipDocMentionGrantResponseObject {
		return dapi.SkipDocMentionGrant200JSONResponse{Body: out, Headers: dapi.SkipDocMentionGrant200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.SkipDocMentionGrantResponseObject {
		return dapi.SkipDocMentionGrant422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// SyncDocDataset implements dapi.StrictServerInterface.
func (s Server) SyncDocDataset(ctx context.Context, req dapi.SyncDocDatasetRequestObject) (dapi.SyncDocDatasetResponseObject, error) {
	_, _ = ctx, req
	return nil, problem.New(problem.CodeNotImplemented, textNotYet("W7.20"))
}

// GrantDocAccess implements dapi.StrictServerInterface.
func (s Server) GrantDocAccess(ctx context.Context, req dapi.GrantDocAccessRequestObject) (dapi.GrantDocAccessResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocShares, error) {
		b, err := body(req.Body)
		if err != nil {
			return dapi.DocShares{}, err
		}
		return s.S.Grant(ctx, tc, req.DocumentId, b)
	}, func(out dapi.DocShares, m meta) dapi.GrantDocAccessResponseObject {
		return dapi.GrantDocAccess200JSONResponse{Body: out, Headers: dapi.GrantDocAccess200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.GrantDocAccessResponseObject {
		return dapi.GrantDocAccess422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// ListDocLinks implements dapi.StrictServerInterface.
func (s Server) ListDocLinks(ctx context.Context, req dapi.ListDocLinksRequestObject) (dapi.ListDocLinksResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocExternalLinkList, error) {
		return s.S.ListLinks(ctx, tc, req.DocumentId)
	}, func(out dapi.DocExternalLinkList, m meta) dapi.ListDocLinksResponseObject {
		return dapi.ListDocLinks200JSONResponse{Body: out, Headers: dapi.ListDocLinks200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
	}, func(v v422) dapi.ListDocLinksResponseObject {
		return dapi.ListDocLinks422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// CreateDocLink implements dapi.StrictServerInterface.
func (s Server) CreateDocLink(ctx context.Context, req dapi.CreateDocLinkRequestObject) (dapi.CreateDocLinkResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocExternalLinkCreated, error) {
		b, err := body(req.Body)
		if err != nil {
			return dapi.DocExternalLinkCreated{}, err
		}
		return s.S.CreateLink(ctx, tc, req.DocumentId, b)
	}, func(out dapi.DocExternalLinkCreated, m meta) dapi.CreateDocLinkResponseObject {
		return dapi.CreateDocLink201JSONResponse{Body: out, Headers: dapi.CreateDocLink201ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.CreateDocLinkResponseObject {
		return dapi.CreateDocLink422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// RevokeDocLink implements dapi.StrictServerInterface.
func (s Server) RevokeDocLink(ctx context.Context, req dapi.RevokeDocLinkRequestObject) (dapi.RevokeDocLinkResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocExternalLink, error) {
		return s.S.RevokeLink(ctx, tc, req.DocumentId, req.LinkId)
	}, func(out dapi.DocExternalLink, m meta) dapi.RevokeDocLinkResponseObject {
		return dapi.RevokeDocLink200JSONResponse{Body: out, Headers: dapi.RevokeDocLink200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.RevokeDocLinkResponseObject {
		return dapi.RevokeDocLink422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// MoveDocument implements dapi.StrictServerInterface.
func (s Server) MoveDocument(ctx context.Context, req dapi.MoveDocumentRequestObject) (dapi.MoveDocumentResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocMoveResult, error) {
		b, err := body(req.Body)
		if err != nil {
			return dapi.DocMoveResult{}, err
		}
		return s.S.MoveDocument(ctx, tc, req.DocumentId, b)
	}, func(out dapi.DocMoveResult, m meta) dapi.MoveDocumentResponseObject {
		return dapi.MoveDocument200JSONResponse{Body: out, Headers: dapi.MoveDocument200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.MoveDocumentResponseObject {
		return dapi.MoveDocument422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// ReviewOcrWord implements dapi.StrictServerInterface.
func (s Server) ReviewOcrWord(ctx context.Context, req dapi.ReviewOcrWordRequestObject) (dapi.ReviewOcrWordResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocOcrWord, error) {
		b, err := body(req.Body)
		if err != nil {
			return dapi.DocOcrWord{}, err
		}
		return s.S.ReviewOcrWord(ctx, tc, req.DocumentId, req.WordId, b)
	}, func(out dapi.DocOcrWord, m meta) dapi.ReviewOcrWordResponseObject {
		return dapi.ReviewOcrWord200JSONResponse{Body: out, Headers: dapi.ReviewOcrWord200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.ReviewOcrWordResponseObject {
		return dapi.ReviewOcrWord422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// OpenDocumentSession implements dapi.StrictServerInterface.
func (s Server) OpenDocumentSession(ctx context.Context, req dapi.OpenDocumentSessionRequestObject) (dapi.OpenDocumentSessionResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocSessionConfig, error) {
		return s.S.OpenSession(ctx, tc, req.DocumentId, modeOf(req.Params.Mode))
	}, func(out dapi.DocSessionConfig, m meta) dapi.OpenDocumentSessionResponseObject {
		return dapi.OpenDocumentSession200JSONResponse{Body: out, Headers: dapi.OpenDocumentSession200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
	}, func(v v422) dapi.OpenDocumentSessionResponseObject {
		return dapi.OpenDocumentSession422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// RestoreDocument implements dapi.StrictServerInterface.
func (s Server) RestoreDocument(ctx context.Context, req dapi.RestoreDocumentRequestObject) (dapi.RestoreDocumentResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.Document, error) {
		return s.S.RestoreDocument(ctx, tc, req.DocumentId)
	}, func(out dapi.Document, m meta) dapi.RestoreDocumentResponseObject {
		return dapi.RestoreDocument200JSONResponse{Body: out, Headers: dapi.RestoreDocument200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.RestoreDocumentResponseObject {
		return dapi.RestoreDocument422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// GetDocRoute implements dapi.StrictServerInterface.
func (s Server) GetDocRoute(ctx context.Context, req dapi.GetDocRouteRequestObject) (dapi.GetDocRouteResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocRoute, error) {
		return s.S.Route(ctx, tc, req.DocumentId)
	}, func(out dapi.DocRoute, m meta) dapi.GetDocRouteResponseObject {
		return dapi.GetDocRoute200JSONResponse{Body: out, Headers: dapi.GetDocRoute200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
	}, func(v v422) dapi.GetDocRouteResponseObject {
		return dapi.GetDocRoute422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// GetDocShares implements dapi.StrictServerInterface.
func (s Server) GetDocShares(ctx context.Context, req dapi.GetDocSharesRequestObject) (dapi.GetDocSharesResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocShares, error) {
		return s.S.Shares(ctx, tc, req.DocumentId)
	}, func(out dapi.DocShares, m meta) dapi.GetDocSharesResponseObject {
		tag := etag(out.Revision)
		return dapi.GetDocShares200JSONResponse{Body: out, Headers: dapi.GetDocShares200ResponseHeaders{CacheControl: m.cache, ETag: &tag, XRequestId: m.rid}}
	}, func(v v422) dapi.GetDocSharesResponseObject {
		return dapi.GetDocShares422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// SetDocShares implements dapi.StrictServerInterface.
func (s Server) SetDocShares(ctx context.Context, req dapi.SetDocSharesRequestObject) (dapi.SetDocSharesResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocSharesResult, error) {
		b, err := body(req.Body)
		if err != nil {
			return dapi.DocSharesResult{}, err
		}
		return s.S.SetShares(ctx, tc, req.DocumentId, req.Params.IfMatch, b)
	}, func(out dapi.DocSharesResult, m meta) dapi.SetDocSharesResponseObject {
		tag := etag(sharesRev(out))
		return dapi.SetDocShares200JSONResponse{Body: out, Headers: dapi.SetDocShares200ResponseHeaders{CacheControl: m.cache, ETag: &tag, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.SetDocSharesResponseObject {
		return dapi.SetDocShares422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// ListDocVersions implements dapi.StrictServerInterface.
func (s Server) ListDocVersions(ctx context.Context, req dapi.ListDocVersionsRequestObject) (dapi.ListDocVersionsResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocVersionList, error) {
		return s.S.Versions(ctx, tc, req.DocumentId)
	}, func(out dapi.DocVersionList, m meta) dapi.ListDocVersionsResponseObject {
		return dapi.ListDocVersions200JSONResponse{Body: out, Headers: dapi.ListDocVersions200ResponseHeaders{CacheControl: m.cache, XRequestId: m.rid}}
	}, func(v v422) dapi.ListDocVersionsResponseObject {
		return dapi.ListDocVersions422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// SaveDocVersion implements dapi.StrictServerInterface.
func (s Server) SaveDocVersion(ctx context.Context, req dapi.SaveDocVersionRequestObject) (dapi.SaveDocVersionResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocVersion, error) {
		b, err := body(req.Body)
		if err != nil {
			return dapi.DocVersion{}, err
		}
		return s.S.SaveVersion(ctx, tc, req.DocumentId, b)
	}, func(out dapi.DocVersion, m meta) dapi.SaveDocVersionResponseObject {
		return dapi.SaveDocVersion201JSONResponse{Body: out, Headers: dapi.SaveDocVersion201ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.SaveDocVersionResponseObject {
		return dapi.SaveDocVersion422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// NameDocVersion implements dapi.StrictServerInterface.
func (s Server) NameDocVersion(ctx context.Context, req dapi.NameDocVersionRequestObject) (dapi.NameDocVersionResponseObject, error) {
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocVersion, error) {
		b, err := body(req.Body)
		if err != nil {
			return dapi.DocVersion{}, err
		}
		return s.S.NameVersion(ctx, tc, req.DocumentId, req.Version, b)
	}, func(out dapi.DocVersion, m meta) dapi.NameDocVersionResponseObject {
		return dapi.NameDocVersion200JSONResponse{Body: out, Headers: dapi.NameDocVersion200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.NameDocVersionResponseObject {
		return dapi.NameDocVersion422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}

// RestoreDocVersion implements dapi.StrictServerInterface.
func (s Server) RestoreDocVersion(ctx context.Context, req dapi.RestoreDocVersionRequestObject) (dapi.RestoreDocVersionResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	return answer(ctx, func(tc tenantctx.TenantContext) (dapi.DocVersion, error) {
		return s.S.RestoreVersion(ctx, tc, req.DocumentId, req.Version)
	}, func(out dapi.DocVersion, m meta) dapi.RestoreDocVersionResponseObject {
		return dapi.RestoreDocVersion201JSONResponse{Body: out, Headers: dapi.RestoreDocVersion201ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}
	}, func(v v422) dapi.RestoreDocVersionResponseObject {
		return dapi.RestoreDocVersion422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: v}
	})
}
