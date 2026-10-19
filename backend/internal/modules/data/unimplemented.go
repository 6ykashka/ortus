package data

import (
	"context"

	dataapi "github.com/ortus/ortus-crm/backend/internal/api/data"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// The saved views and the export jobs of the tag Data (W4.06, contract 0.7.0-stage4) answer 501 not_implemented
// until W4.50: the steward of the contract adds the operations, the owner of the module serves them.

// ListDatasetViews answers 501 not_implemented until W4.50.
func (Server) ListDatasetViews(context.Context, dataapi.ListDatasetViewsRequestObject) (dataapi.ListDatasetViewsResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// CreateDatasetView answers 501 not_implemented until W4.50.
func (Server) CreateDatasetView(context.Context, dataapi.CreateDatasetViewRequestObject) (dataapi.CreateDatasetViewResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// UpdateDatasetView answers 501 not_implemented until W4.50.
func (Server) UpdateDatasetView(context.Context, dataapi.UpdateDatasetViewRequestObject) (dataapi.UpdateDatasetViewResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// DeleteDatasetView answers 501 not_implemented until W4.50.
func (Server) DeleteDatasetView(context.Context, dataapi.DeleteDatasetViewRequestObject) (dataapi.DeleteDatasetViewResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// CreateDatasetExportJob answers 501 not_implemented until W4.50.
func (Server) CreateDatasetExportJob(context.Context, dataapi.CreateDatasetExportJobRequestObject) (dataapi.CreateDatasetExportJobResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// ListDatasetExportJobs answers 501 not_implemented until W4.50.
func (Server) ListDatasetExportJobs(context.Context, dataapi.ListDatasetExportJobsRequestObject) (dataapi.ListDatasetExportJobsResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// GetDatasetExportJob answers 501 not_implemented until W4.50.
func (Server) GetDatasetExportJob(context.Context, dataapi.GetDatasetExportJobRequestObject) (dataapi.GetDatasetExportJobResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// GetDatasetExportDownload answers 501 not_implemented until W4.50.
func (Server) GetDatasetExportDownload(context.Context, dataapi.GetDatasetExportDownloadRequestObject) (dataapi.GetDatasetExportDownloadResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// RevokeDatasetExportJob answers 501 not_implemented until W4.50.
func (Server) RevokeDatasetExportJob(context.Context, dataapi.RevokeDatasetExportJobRequestObject) (dataapi.RevokeDatasetExportJobResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}
