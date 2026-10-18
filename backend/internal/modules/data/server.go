package data

import (
	"context"
	"errors"

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
	p := catalog.Problems[codeValidation]
	rid, detail := requestid.FromContext(ctx), e.Detail
	violations := []dataapi.ProblemViolation{{Field: e.Field, Code: e.Code, Message: e.Message}}
	return dataapi.QueryDataset422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: dataapi.ValidationApplicationProblemPlusJSONResponse{
		Body: dataapi.Problem{
			Type: problem.TypeBase + codeValidation, Title: p.Title, Status: int64(p.Status), Code: dataapi.ProblemCode(codeValidation),
			Detail: &detail, RequestId: rid, Violations: &violations,
		},
		Headers: dataapi.ValidationResponseHeaders{XRequestId: &rid},
	}}
}
