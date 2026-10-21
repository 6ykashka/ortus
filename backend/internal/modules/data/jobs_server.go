package data

import (
	"context"
	"errors"

	dataapi "github.com/ortus/ortus-crm/backend/internal/api/data"
)

// The operations of the export jobs over the service (W4.50, contract 0.7.0-stage4 W4.06): every answer is
// «private, no-store»; a field error of createDatasetExportJob is the 422 with its violation, other errors go to
// problem.Write (404, 403, 409 invalid_transition, 412, 428, 429 rate_limited, 503).

// CreateDatasetExportJob implements dataapi.StrictServerInterface: 202 with the queued job.
func (s Server) CreateDatasetExportJob(ctx context.Context, req dataapi.CreateDatasetExportJobRequestObject) (dataapi.CreateDatasetExportJobResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	j, err := s.S.CreateJob(ctx, tc, req.DatasetId, req.Body)
	switch fe, field := errors.AsType[*fieldError](err); {
	case field:
		return dataapi.CreateDatasetExportJob422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: invalid(ctx, fe)}, nil
	case err != nil:
		return nil, err
	}
	return accepted(ctx, j), nil
}

// accepted is the 202 of a queued job.
func accepted(ctx context.Context, j dataapi.DatasetExportJob) dataapi.CreateDatasetExportJob202JSONResponse {
	cache, rid := headers(ctx)
	tag, replayed := etag(j.Revision), false
	return dataapi.CreateDatasetExportJob202JSONResponse{Body: j, Headers: dataapi.CreateDatasetExportJob202ResponseHeaders{
		CacheControl: cache, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid,
	}}
}

// ListDatasetExportJobs implements dataapi.StrictServerInterface: the journal of the member (the owner — of all).
func (s Server) ListDatasetExportJobs(ctx context.Context, req dataapi.ListDatasetExportJobsRequestObject) (dataapi.ListDatasetExportJobsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	page, err := s.S.Jobs(ctx, tc, req.Params)
	if err != nil {
		return nil, err
	}
	cache, rid := headers(ctx)
	return dataapi.ListDatasetExportJobs200JSONResponse{Body: page, Headers: dataapi.ListDatasetExportJobs200ResponseHeaders{
		CacheControl: cache, XRequestId: rid,
	}}, nil
}

// GetDatasetExportJob implements dataapi.StrictServerInterface.
func (s Server) GetDatasetExportJob(ctx context.Context, req dataapi.GetDatasetExportJobRequestObject) (dataapi.GetDatasetExportJobResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	j, err := s.S.Job(ctx, tc, req.ExportJobId)
	if err != nil {
		return nil, err
	}
	cache, rid := headers(ctx)
	tag := etag(j.Revision)
	return dataapi.GetDatasetExportJob200JSONResponse{Body: j, Headers: dataapi.GetDatasetExportJob200ResponseHeaders{
		CacheControl: cache, ETag: &tag, XRequestId: rid,
	}}, nil
}

// GetDatasetExportDownload implements dataapi.StrictServerInterface: a link of 5 minutes to the file of the author.
func (s Server) GetDatasetExportDownload(ctx context.Context, req dataapi.GetDatasetExportDownloadRequestObject) (dataapi.GetDatasetExportDownloadResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	d, err := s.S.Download(ctx, tc, req.ExportJobId)
	if err != nil {
		return nil, err
	}
	cache, rid := headers(ctx)
	return dataapi.GetDatasetExportDownload200JSONResponse{Body: d, Headers: dataapi.GetDatasetExportDownload200ResponseHeaders{
		CacheControl: cache, XRequestId: rid,
	}}, nil
}

// RevokeDatasetExportJob implements dataapi.StrictServerInterface.
func (s Server) RevokeDatasetExportJob(ctx context.Context, req dataapi.RevokeDatasetExportJobRequestObject) (dataapi.RevokeDatasetExportJobResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	j, err := s.S.Revoke(ctx, tc, req.ExportJobId, req.Params.IfMatch)
	if err != nil {
		return nil, err
	}
	cache, rid := headers(ctx)
	tag, replayed := etag(j.Revision), false
	return dataapi.RevokeDatasetExportJob200JSONResponse{Body: j, Headers: dataapi.RevokeDatasetExportJob200ResponseHeaders{
		CacheControl: cache, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid,
	}}, nil
}
