package data

import (
	"context"
	"errors"
	"strconv"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	dataapi "github.com/ortus/ortus-crm/backend/internal/api/data"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// noStore is Cache-Control of every answer (the contract: «private, no-store»).
const noStore = "private, no-store"

// Server implements dataapi.StrictServerInterface over the service.
type Server struct{ S *Service }

var _ dataapi.StrictServerInterface = Server{}

// tenant returns the tenant context the gateway put in ctx; without one the request has no tenant (404).
func tenant(ctx context.Context) (tenantctx.TenantContext, error) {
	tc, ok := tenantctx.FromContext(ctx)
	if !ok {
		return tenantctx.TenantContext{}, problem.New(problem.CodeNotFound, "")
	}
	return tc, nil
}

// ListDatasets implements dataapi.StrictServerInterface.
func (s Server) ListDatasets(ctx context.Context, _ dataapi.ListDatasetsRequestObject) (dataapi.ListDatasetsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	cat, err := s.S.Catalog(ctx, tc)
	if err != nil {
		return nil, err
	}
	cache, rid := noStore, requestid.FromContext(ctx)
	return dataapi.ListDatasets200JSONResponse{
		Body: cat, Headers: dataapi.ListDatasets200ResponseHeaders{CacheControl: &cache, XRequestId: &rid},
	}, nil
}

// QueryDataset implements dataapi.StrictServerInterface: a field error is the 422 with its violation, other errors go
// to problem.Write.
func (s Server) QueryDataset(ctx context.Context, req dataapi.QueryDatasetRequestObject) (dataapi.QueryDatasetResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	res, err := s.S.Query(ctx, tc, req.DatasetId, req.Body)
	if fe, ok := errors.AsType[*fieldError](err); ok {
		return validation(ctx, fe), nil
	}
	if err != nil {
		return nil, err
	}
	cache, rid := noStore, requestid.FromContext(ctx)
	return dataapi.QueryDataset200JSONResponse{
		Body: res, Headers: dataapi.QueryDataset200ResponseHeaders{CacheControl: &cache, XRequestId: &rid},
	}, nil
}

// ExportDataset answers 501 not_implemented until W2.50 (W2.52, contract 0.6.1-stage2): the CSV export of a dataset.
func (Server) ExportDataset(context.Context, dataapi.ExportDatasetRequestObject) (dataapi.ExportDatasetResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// validation is the 422 of a field error with its violation.
func validation(ctx context.Context, e *fieldError) dataapi.QueryDataset422ApplicationProblemPlusJSONResponse {
	return dataapi.QueryDataset422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: invalid(ctx, e)}
}

// invalid is the Problem of a 422 validation_failed with the violation of e (the body of every 422 of the tag).
func invalid(ctx context.Context, e *fieldError) dataapi.ValidationApplicationProblemPlusJSONResponse {
	p := catalog.Problems[codeValidation]
	rid, detail := requestid.FromContext(ctx), e.Detail
	violations := []dataapi.ProblemViolation{{Field: e.Field, Code: e.Code, Message: e.Message}}
	return dataapi.ValidationApplicationProblemPlusJSONResponse{
		Body: dataapi.Problem{
			Type: problem.TypeBase + codeValidation, Title: p.Title, Status: int64(p.Status), Code: dataapi.ProblemCode(codeValidation),
			Detail: &detail, RequestId: rid, Violations: &violations,
		},
		Headers: dataapi.ValidationResponseHeaders{XRequestId: &rid},
	}
}

// headers are the Cache-Control and X-Request-Id of an answer of the tag.
func headers(ctx context.Context) (cache, rid *string) {
	c, r := noStore, requestid.FromContext(ctx)
	return &c, &r
}

// ListDatasetViews implements dataapi.StrictServerInterface (W4.50).
func (s Server) ListDatasetViews(ctx context.Context, req dataapi.ListDatasetViewsRequestObject) (dataapi.ListDatasetViewsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	list, err := s.S.Views(ctx, tc, req.DatasetId)
	if err != nil {
		return nil, err
	}
	cache, rid := headers(ctx)
	return dataapi.ListDatasetViews200JSONResponse{Body: list, Headers: dataapi.ListDatasetViews200ResponseHeaders{CacheControl: cache, XRequestId: rid}}, nil
}

// CreateDatasetView implements dataapi.StrictServerInterface (W4.50): a field error is the 422 with its violation.
func (s Server) CreateDatasetView(ctx context.Context, req dataapi.CreateDatasetViewRequestObject) (dataapi.CreateDatasetViewResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	v, err := s.S.CreateView(ctx, tc, req.DatasetId, req.Body)
	if fe, ok := errors.AsType[*fieldError](err); ok {
		return dataapi.CreateDatasetView422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: invalid(ctx, fe)}, nil
	}
	if err != nil {
		return nil, err
	}
	cache, rid := headers(ctx)
	tag, replayed := etag(v.Revision), false
	return dataapi.CreateDatasetView201JSONResponse{Body: v, Headers: dataapi.CreateDatasetView201ResponseHeaders{
		CacheControl: cache, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid,
	}}, nil
}

// UpdateDatasetView implements dataapi.StrictServerInterface (W4.50).
func (s Server) UpdateDatasetView(ctx context.Context, req dataapi.UpdateDatasetViewRequestObject) (dataapi.UpdateDatasetViewResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	v, err := s.S.UpdateView(ctx, tc, req.DatasetId, req.ViewId, req.Params.IfMatch, req.Body)
	if fe, ok := errors.AsType[*fieldError](err); ok {
		return dataapi.UpdateDatasetView422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: invalid(ctx, fe)}, nil
	}
	if err != nil {
		return nil, err
	}
	cache, rid := headers(ctx)
	tag, replayed := etag(v.Revision), false
	return dataapi.UpdateDatasetView200JSONResponse{Body: v, Headers: dataapi.UpdateDatasetView200ResponseHeaders{
		CacheControl: cache, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid,
	}}, nil
}

// DeleteDatasetView implements dataapi.StrictServerInterface (W4.50).
func (s Server) DeleteDatasetView(ctx context.Context, req dataapi.DeleteDatasetViewRequestObject) (dataapi.DeleteDatasetViewResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.S.DeleteView(ctx, tc, req.DatasetId, req.ViewId, req.Params.IfMatch); err != nil {
		return nil, err
	}
	cache, rid := headers(ctx)
	replayed := false
	return dataapi.DeleteDatasetView204Response{Headers: dataapi.DeleteDatasetView204ResponseHeaders{
		CacheControl: cache, IdempotencyReplayed: &replayed, XRequestId: rid,
	}}, nil
}

// etag is the strong ETag of a revision (kit.ETag).
func etag(revision int64) string { return `"` + strconv.FormatInt(revision, 10) + `"` }
