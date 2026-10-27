package main

import (
	"context"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	repairsapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
	"github.com/ortus/ortus-crm/backend/internal/modules/repairs"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// repairsServer is the strict server of the tag Repairs. The tag has several owners: W6.11 (objects, the foreman and
// the crew, works, marks and their acceptance — modules/repairs), W6.12 (measurement and estimates), W6.13 (supply),
// W6.14 (schedule), W6.15 (finance, documents, the client cabinet). Every owner embeds its server here (one line and
// one line in newRepairs) and takes its operations out of repairsPending; the stubs of repairsPending are one level
// deeper than the methods of the embedded servers and never shadow them.
type repairsServer struct {
	repairs.Server // W6.11
	repairsPending
}

var _ repairsapi.StrictServerInterface = repairsServer{}

// newRepairs is the server of the tag Repairs over the tenant pools and the clock of the application (APP_FIXED_NOW
// outside prod).
func newRepairs(pools repairs.Pools, now func() time.Time) repairsapi.StrictServerInterface {
	return repairsServer{Server: repairs.Server{S: &repairs.Service{Pools: pools, Now: now}}}
}

// repairsImplemented are the operations of the tag Repairs that have a server; an owner adds its own together with the
// embedded server.
var repairsImplemented = map[string]bool{
	// W6.11: objects, the foreman, works, marks.
	"listRepairProjects": true, "createRepairProject": true, "getRepairProject": true, "updateRepairProject": true, "getRepairProjectOverview": true, "assignRepairForeman": true, "activateRepairProject": true, "handOverRepairProject": true, "listRepairWorks": true, "listWorkLogs": true, "submitWorkLog": true, "acceptWorkLog": true, "returnWorkLog": true,
}

// mountRepairsPending answers 501 for the operations of the tag Repairs without a server over the routes of the
// generated strict handler (chi replaces the endpoint): they answer before their parameters are bound, as a tag without
// a server does, so the pending isolation rows of their owners keep seeing 501.
func mountRepairsPending(r chi.Router) {
	for _, op := range catalog.Operations {
		if op.Tag == "Repairs" && !repairsImplemented[op.ID] {
			r.MethodFunc(op.Method, op.Path, notImplemented)
		}
	}
}

// repairsPending puts the stubs one level below the embedded servers.
type repairsPending struct{ repairsNotImplemented }

type repairsNotImplemented struct{}

var errRepairsNotImplemented = problem.New(problem.CodeNotImplemented, "")

func (repairsNotImplemented) AccrueByAct(context.Context, repairsapi.AccrueByActRequestObject) (repairsapi.AccrueByActResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) ApplyScheduleChange(context.Context, repairsapi.ApplyScheduleChangeRequestObject) (repairsapi.ApplyScheduleChangeResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) ApproveEstimateByClient(context.Context, repairsapi.ApproveEstimateByClientRequestObject) (repairsapi.ApproveEstimateByClientResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) ConsumeSupplyRequest(context.Context, repairsapi.ConsumeSupplyRequestRequestObject) (repairsapi.ConsumeSupplyRequestResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) CopyTemplate(context.Context, repairsapi.CopyTemplateRequestObject) (repairsapi.CopyTemplateResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) CreateEstimateFromTemplate(context.Context, repairsapi.CreateEstimateFromTemplateRequestObject) (repairsapi.CreateEstimateFromTemplateResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) CreateEstimateRevision(context.Context, repairsapi.CreateEstimateRevisionRequestObject) (repairsapi.CreateEstimateRevisionResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) CreatePriceItem(context.Context, repairsapi.CreatePriceItemRequestObject) (repairsapi.CreatePriceItemResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) CreatePurchase(context.Context, repairsapi.CreatePurchaseRequestObject) (repairsapi.CreatePurchaseResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) CreateScheduleBaseline(context.Context, repairsapi.CreateScheduleBaselineRequestObject) (repairsapi.CreateScheduleBaselineResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) CreateScheduleFromEstimate(context.Context, repairsapi.CreateScheduleFromEstimateRequestObject) (repairsapi.CreateScheduleFromEstimateResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) CreateSupplyRequest(context.Context, repairsapi.CreateSupplyRequestRequestObject) (repairsapi.CreateSupplyRequestResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) DeleteEstimateDraft(context.Context, repairsapi.DeleteEstimateDraftRequestObject) (repairsapi.DeleteEstimateDraftResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) DiffEstimates(context.Context, repairsapi.DiffEstimatesRequestObject) (repairsapi.DiffEstimatesResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) GetClientCabinet(context.Context, repairsapi.GetClientCabinetRequestObject) (repairsapi.GetClientCabinetResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) GetClientLink(context.Context, repairsapi.GetClientLinkRequestObject) (repairsapi.GetClientLinkResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) GetEstimate(context.Context, repairsapi.GetEstimateRequestObject) (repairsapi.GetEstimateResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) GetMeasurement(context.Context, repairsapi.GetMeasurementRequestObject) (repairsapi.GetMeasurementResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) GetProjectFinance(context.Context, repairsapi.GetProjectFinanceRequestObject) (repairsapi.GetProjectFinanceResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) GetSchedule(context.Context, repairsapi.GetScheduleRequestObject) (repairsapi.GetScheduleResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) GetTemplate(context.Context, repairsapi.GetTemplateRequestObject) (repairsapi.GetTemplateResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) IssueClientLink(context.Context, repairsapi.IssueClientLinkRequestObject) (repairsapi.IssueClientLinkResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) IssueSupplyRequest(context.Context, repairsapi.IssueSupplyRequestRequestObject) (repairsapi.IssueSupplyRequestResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) ListChangeOrders(context.Context, repairsapi.ListChangeOrdersRequestObject) (repairsapi.ListChangeOrdersResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) ListCrewAccruals(context.Context, repairsapi.ListCrewAccrualsRequestObject) (repairsapi.ListCrewAccrualsResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) ListEstimates(context.Context, repairsapi.ListEstimatesRequestObject) (repairsapi.ListEstimatesResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) ListPriceItems(context.Context, repairsapi.ListPriceItemsRequestObject) (repairsapi.ListPriceItemsResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) ListProjectStock(context.Context, repairsapi.ListProjectStockRequestObject) (repairsapi.ListProjectStockResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) ListPurchases(context.Context, repairsapi.ListPurchasesRequestObject) (repairsapi.ListPurchasesResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) ListRepairDocuments(context.Context, repairsapi.ListRepairDocumentsRequestObject) (repairsapi.ListRepairDocumentsResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) ListSubcontractors(context.Context, repairsapi.ListSubcontractorsRequestObject) (repairsapi.ListSubcontractorsResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) ListSupplyRequests(context.Context, repairsapi.ListSupplyRequestsRequestObject) (repairsapi.ListSupplyRequestsResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) ListTemplates(context.Context, repairsapi.ListTemplatesRequestObject) (repairsapi.ListTemplatesResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) PayoutAccruals(context.Context, repairsapi.PayoutAccrualsRequestObject) (repairsapi.PayoutAccrualsResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) PreviewScheduleChange(context.Context, repairsapi.PreviewScheduleChangeRequestObject) (repairsapi.PreviewScheduleChangeResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) ProposeChangeOrder(context.Context, repairsapi.ProposeChangeOrderRequestObject) (repairsapi.ProposeChangeOrderResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) PutMeasurement(context.Context, repairsapi.PutMeasurementRequestObject) (repairsapi.PutMeasurementResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) RecallEstimate(context.Context, repairsapi.RecallEstimateRequestObject) (repairsapi.RecallEstimateResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) ReceivePurchase(context.Context, repairsapi.ReceivePurchaseRequestObject) (repairsapi.ReceivePurchaseResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) RejectChangeOrder(context.Context, repairsapi.RejectChangeOrderRequestObject) (repairsapi.RejectChangeOrderResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) RequestDocumentSignature(context.Context, repairsapi.RequestDocumentSignatureRequestObject) (repairsapi.RequestDocumentSignatureResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) ReserveSupplyRequest(context.Context, repairsapi.ReserveSupplyRequestRequestObject) (repairsapi.ReserveSupplyRequestResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) ReturnProjectStock(context.Context, repairsapi.ReturnProjectStockRequestObject) (repairsapi.ReturnProjectStockResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) RevokeClientLink(context.Context, repairsapi.RevokeClientLinkRequestObject) (repairsapi.RevokeClientLinkResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) SaveProjectAsTemplate(context.Context, repairsapi.SaveProjectAsTemplateRequestObject) (repairsapi.SaveProjectAsTemplateResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) SendEstimate(context.Context, repairsapi.SendEstimateRequestObject) (repairsapi.SendEstimateResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) SetScheduleStageExecutor(context.Context, repairsapi.SetScheduleStageExecutorRequestObject) (repairsapi.SetScheduleStageExecutorResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) SetSubcontractorAccess(context.Context, repairsapi.SetSubcontractorAccessRequestObject) (repairsapi.SetSubcontractorAccessResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) SignDocumentByClient(context.Context, repairsapi.SignDocumentByClientRequestObject) (repairsapi.SignDocumentByClientResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) TransferProjectStock(context.Context, repairsapi.TransferProjectStockRequestObject) (repairsapi.TransferProjectStockResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) UpdateEstimateDraft(context.Context, repairsapi.UpdateEstimateDraftRequestObject) (repairsapi.UpdateEstimateDraftResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) UpdatePriceItem(context.Context, repairsapi.UpdatePriceItemRequestObject) (repairsapi.UpdatePriceItemResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) UpdateTemplate(context.Context, repairsapi.UpdateTemplateRequestObject) (repairsapi.UpdateTemplateResponseObject, error) {
	return nil, errRepairsNotImplemented
}
