package forms

import (
	"context"

	pfapi "github.com/ortus/ortus-crm/backend/internal/api/publicforms"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
)

// PublicServer implements pfapi.StrictServerInterface (the guest of a public form, security: []) over the service.
type PublicServer struct{ S *Service }

var _ pfapi.StrictServerInterface = PublicServer{}

func publicBody(ctx context.Context, f *failure) pfapi.Problem {
	var out pfapi.Problem
	if err := convert(body(ctx, f), &out); err != nil {
		panic("forms: the problem of a guest: " + err.Error()) // the same schema of another tag
	}
	return out
}

type (
	publicInvalidOf interface {
		~struct {
			pfapi.ValidationApplicationProblemPlusJSONResponse
		}
	}
	publicConflictOf interface {
		~struct {
			pfapi.ConflictApplicationProblemPlusJSONResponse
		}
	}
)

// publicReply is reply of the tag PublicForms.
func publicReply[R any, V publicInvalidOf, C publicConflictOf](ctx context.Context, err error, ok func() R, _ V, _ C) (R, error) {
	f, failed := asFailure(err)
	rid := new(requestid.FromContext(ctx))
	switch {
	case failed && f.code == codeValidation:
		return answerOf[R](V{pfapi.ValidationApplicationProblemPlusJSONResponse{Body: publicBody(ctx, f),
			Headers: pfapi.ValidationResponseHeaders{XRequestId: rid}}}), nil
	case failed:
		return answerOf[R](C{pfapi.ConflictApplicationProblemPlusJSONResponse{Body: publicBody(ctx, f),
			Headers: pfapi.ConflictResponseHeaders{XRequestId: rid}}}), nil
	case err != nil:
		var zero R
		return zero, err
	}
	return ok(), nil
}

func publicIn[T any](b *T) (T, error) {
	var zero T
	if b == nil {
		return zero, problem.New(problem.CodeMalformedRequest, "")
	}
	return *b, nil
}

// GetPublicForm implements pfapi.StrictServerInterface.
func (s PublicServer) GetPublicForm(ctx context.Context, req pfapi.GetPublicFormRequestObject) (pfapi.GetPublicFormResponseObject, error) {
	out, err := s.S.PublicForm(ctx, req.PublicToken)
	if f, failed := asFailure(err); failed {
		if f.code == codeValidation {
			return pfapi.GetPublicForm422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: pfapi.
				ValidationApplicationProblemPlusJSONResponse{Body: publicBody(ctx, f), Headers: pfapi.ValidationResponseHeaders{
				XRequestId: new(requestid.FromContext(ctx))}}}, nil
		}
		return nil, problem.New(f.code, f.detail)
	}
	if err != nil {
		return nil, err
	}
	return pfapi.GetPublicForm200JSONResponse{Body: out, Headers: pfapi.GetPublicForm200ResponseHeaders{CacheControl: cache(),
		XRequestId: rid(ctx)}}, nil
}

// SubmitPublicForm implements pfapi.StrictServerInterface.
func (s PublicServer) SubmitPublicForm(ctx context.Context, req pfapi.SubmitPublicFormRequestObject) (pfapi.SubmitPublicFormResponseObject, error) {
	b, err := publicIn(req.Body)
	if err != nil {
		return nil, err
	}
	out, replayed, err := s.S.SubmitPublic(ctx, req.PublicToken, b)
	return publicReply(ctx, err, func() pfapi.SubmitPublicFormResponseObject {
		return pfapi.SubmitPublicForm201JSONResponse{Body: out, Headers: pfapi.SubmitPublicForm201ResponseHeaders{CacheControl: cache(),
			IdempotencyReplayed: new(replayed), XRequestId: rid(ctx)}}
	}, pfapi.SubmitPublicForm422ApplicationProblemPlusJSONResponse{}, pfapi.SubmitPublicForm409ApplicationProblemPlusJSONResponse{})
}

// InitiatePublicUpload implements pfapi.StrictServerInterface.
func (s PublicServer) InitiatePublicUpload(ctx context.Context, req pfapi.InitiatePublicUploadRequestObject) (pfapi.InitiatePublicUploadResponseObject, error) {
	b, err := publicIn(req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.InitiateUpload(ctx, req.PublicToken, b)
	return publicReply(ctx, err, func() pfapi.InitiatePublicUploadResponseObject {
		return pfapi.InitiatePublicUpload201JSONResponse{Body: out, Headers: pfapi.InitiatePublicUpload201ResponseHeaders{
			CacheControl: cache(), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, pfapi.InitiatePublicUpload422ApplicationProblemPlusJSONResponse{}, pfapi.InitiatePublicUpload409ApplicationProblemPlusJSONResponse{})
}

// CompletePublicUpload implements pfapi.StrictServerInterface.
func (s PublicServer) CompletePublicUpload(ctx context.Context, req pfapi.CompletePublicUploadRequestObject) (pfapi.CompletePublicUploadResponseObject, error) {
	b, err := publicIn(req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.CompleteUpload(ctx, req.PublicToken, req.UploadId, b)
	return publicReply(ctx, err, func() pfapi.CompletePublicUploadResponseObject {
		return pfapi.CompletePublicUpload202JSONResponse{Body: out, Headers: pfapi.CompletePublicUpload202ResponseHeaders{
			CacheControl: cache(), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, pfapi.CompletePublicUpload422ApplicationProblemPlusJSONResponse{}, pfapi.CompletePublicUpload409ApplicationProblemPlusJSONResponse{})
}

// GetPublicUploadStatus implements pfapi.StrictServerInterface.
func (s PublicServer) GetPublicUploadStatus(ctx context.Context, req pfapi.GetPublicUploadStatusRequestObject) (pfapi.GetPublicUploadStatusResponseObject, error) {
	b, err := publicIn(req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.UploadStatus(ctx, req.PublicToken, req.UploadId, b)
	return publicReply(ctx, err, func() pfapi.GetPublicUploadStatusResponseObject {
		return pfapi.GetPublicUploadStatus200JSONResponse{Body: out, Headers: pfapi.GetPublicUploadStatus200ResponseHeaders{
			CacheControl: cache(), XRequestId: rid(ctx)}}
	}, pfapi.GetPublicUploadStatus422ApplicationProblemPlusJSONResponse{}, pfapi.GetPublicUploadStatus409ApplicationProblemPlusJSONResponse{})
}
