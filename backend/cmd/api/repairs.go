package main

import (
	"context"
	"log/slog"
	"os"
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
	repairs.Server         // W6.11
	repairs.SupplyServer   // W6.13
	repairs.ScheduleServer // W6.14
	repairsPending
}

var _ repairsapi.StrictServerInterface = repairsServer{}

// newRepairs is the server of the tag Repairs over the tenant pools and the clock of the application (APP_FIXED_NOW
// outside prod).
func newRepairs(pools repairs.Pools, now func() time.Time) repairsapi.StrictServerInterface {
	// W6.12: the codes of the signatures by SMS go through the stub of the port (the log of the server: the inbox of the
	// developer on a stand) until the provider is chosen (D-31); REPAIRS_SIGN_KEY hashes them, without it the process
	// has a key of its own.
	svc := &repairs.Service{Pools: pools, Now: now, Codes: repairs.LogCodes{Log: slog.Default()}, SignKey: []byte(os.Getenv("REPAIRS_SIGN_KEY"))}
	return repairsServer{Server: repairs.Server{S: svc}, SupplyServer: repairs.SupplyServer{S: svc}, ScheduleServer: repairs.ScheduleServer{S: svc}}
}

// repairsImplemented are the operations of the tag Repairs that have a server; an owner adds its own together with the
// embedded server.
var repairsImplemented = map[string]bool{
	// W6.11: objects, the foreman, works, marks.
	"listRepairProjects": true, "createRepairProject": true, "getRepairProject": true, "updateRepairProject": true, "getRepairProjectOverview": true, "assignRepairForeman": true, "activateRepairProject": true, "handOverRepairProject": true, "listRepairWorks": true, "listWorkLogs": true, "submitWorkLog": true, "acceptWorkLog": true, "returnWorkLog": true,
	// W6.12: measurement, estimates, change orders, price list, templates, the code of the signature.
	"listChangeOrders": true, "proposeChangeOrder": true, "rejectChangeOrder": true, "getMeasurement": true, "putMeasurement": true, "listEstimates": true, "getEstimate": true, "createEstimateFromTemplate": true, "createEstimateRevision": true, "updateEstimateDraft": true, "sendEstimate": true, "recallEstimate": true, "deleteEstimateDraft": true, "diffEstimates": true, "saveProjectAsTemplate": true, "listPriceItems": true, "createPriceItem": true, "updatePriceItem": true, "listTemplates": true, "getTemplate": true, "updateTemplate": true, "copyTemplate": true, "requestDocumentSignature": true,
	// W6.13: the supply over the warehouse.
	"listSupplyRequests": true, "createSupplyRequest": true, "reserveSupplyRequest": true, "issueSupplyRequest": true, "consumeSupplyRequest": true, "createPurchase": true, "listPurchases": true, "receivePurchase": true, "listProjectStock": true, "returnProjectStock": true, "transferProjectStock": true,
	// W6.14: the schedule.
	"getSchedule": true, "createScheduleFromEstimate": true, "previewScheduleChange": true, "applyScheduleChange": true, "setScheduleStageExecutor": true, "createScheduleBaseline": true,
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

func (repairsNotImplemented) ApproveEstimateByClient(context.Context, repairsapi.ApproveEstimateByClientRequestObject) (repairsapi.ApproveEstimateByClientResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) GetClientCabinet(context.Context, repairsapi.GetClientCabinetRequestObject) (repairsapi.GetClientCabinetResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) GetClientLink(context.Context, repairsapi.GetClientLinkRequestObject) (repairsapi.GetClientLinkResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) GetProjectFinance(context.Context, repairsapi.GetProjectFinanceRequestObject) (repairsapi.GetProjectFinanceResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) IssueClientLink(context.Context, repairsapi.IssueClientLinkRequestObject) (repairsapi.IssueClientLinkResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) ListCrewAccruals(context.Context, repairsapi.ListCrewAccrualsRequestObject) (repairsapi.ListCrewAccrualsResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) ListRepairDocuments(context.Context, repairsapi.ListRepairDocumentsRequestObject) (repairsapi.ListRepairDocumentsResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) ListSubcontractors(context.Context, repairsapi.ListSubcontractorsRequestObject) (repairsapi.ListSubcontractorsResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) PayoutAccruals(context.Context, repairsapi.PayoutAccrualsRequestObject) (repairsapi.PayoutAccrualsResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) RevokeClientLink(context.Context, repairsapi.RevokeClientLinkRequestObject) (repairsapi.RevokeClientLinkResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) SetSubcontractorAccess(context.Context, repairsapi.SetSubcontractorAccessRequestObject) (repairsapi.SetSubcontractorAccessResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) SignDocumentByClient(context.Context, repairsapi.SignDocumentByClientRequestObject) (repairsapi.SignDocumentByClientResponseObject, error) {
	return nil, errRepairsNotImplemented
}

func (repairsNotImplemented) UpdateTemplate(context.Context, repairsapi.UpdateTemplateRequestObject) (repairsapi.UpdateTemplateResponseObject, error) {
	return nil, errRepairsNotImplemented
}
