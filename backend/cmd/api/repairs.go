package main

import (
	"context"
	"log/slog"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	repairsapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
	"github.com/ortus/ortus-crm/backend/internal/modules/cash"
	"github.com/ortus/ortus-crm/backend/internal/modules/repairs"
)

// repairsServer is the strict server of the tag Repairs. The tag has several owners: W6.11 (objects, the foreman and
// the crew, works, marks and their acceptance — modules/repairs), W6.12 (measurement and estimates), W6.13 (supply),
// W6.14 (schedule), W6.15 (finance, documents, the client cabinet). Every owner embeds its server here (one line and
// one line in newRepairs). With W6.15 every operation of the tag has a server; mountRepairsPending stays for the tags to come.
type repairsServer struct {
	repairs.Server         // W6.11
	repairs.SupplyServer   // W6.13
	repairs.ScheduleServer // W6.14
	repairs.FinanceServer  // W6.15
}

var _ repairsapi.StrictServerInterface = repairsServer{}

// newRepairs is the server of the tag Repairs over the tenant pools and the clock of the application (APP_FIXED_NOW
// outside prod).
func newRepairs(pools repairs.Pools, control *pgxpool.Pool, publicOrigin string, now func() time.Time) repairsapi.StrictServerInterface {
	// W6.12: the codes of the signatures by SMS go through the stub of the port (the log of the server: the inbox of the
	// developer on a stand) until the provider is chosen (D-31); REPAIRS_SIGN_KEY hashes them, without it the process
	// has a key of its own.
	// W6.15: the control index of the links of the cabinet of the client, the payouts to the crew go to the proposals of the
	// cash desks (W5.31), the address of the cabinet starts with PUBLIC_ORIGIN.
	svc := &repairs.Service{Pools: pools, Now: now, Codes: repairs.LogCodes{Log: slog.Default()}, SignKey: []byte(os.Getenv("REPAIRS_SIGN_KEY")),
		Offers: payrollOffers{cash: &cash.Service{Pools: pools, Now: now}}, PublicBase: publicOrigin}
	if control != nil {
		svc.Links = repairs.PGLinks{DB: control}
	}
	return repairsServer{Server: repairs.Server{S: svc}, SupplyServer: repairs.SupplyServer{S: svc}, ScheduleServer: repairs.ScheduleServer{S: svc}, FinanceServer: repairs.FinanceServer{S: svc}}
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
	// W6.15: documents, finance, the crew accruals and their payout, subcontractors, the link and the cabinet of the client.
	"listRepairDocuments": true, "getProjectFinance": true, "listCrewAccruals": true, "accrueByAct": true, "payoutAccruals": true, "listSubcontractors": true, "setSubcontractorAccess": true, "getClientLink": true, "issueClientLink": true, "revokeClientLink": true, "getClientCabinet": true, "approveEstimateByClient": true, "signDocumentByClient": true,
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

// payrollOffers hands the payouts to the crew of an object to the proposals of the cash desks in the transaction of the payout
// (W5.31): «payroll:<id>» is the key of idempotency, nothing moves until the cashier posts the proposal.
type payrollOffers struct{ cash *cash.Service }

// OfferPayroll implements repairs.PayrollOffers.
func (o payrollOffers) OfferPayroll(ctx context.Context, tx pgx.Tx, p repairs.PayrollOffer) error {
	label := p.SourceLabel
	_, err := o.cash.Offer(ctx, tx, cash.Offer{Key: p.Key, Kind: "payroll", Title: p.Title, Amount: p.AmountMinor, Direction: "out",
		SourceKind: p.SourceKind, SourceID: p.SourceID, SourceLabel: &label})
	return err
}
