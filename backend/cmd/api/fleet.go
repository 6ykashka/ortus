package main

import (
	"context"
	"reflect"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/reservations"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/vehicles"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Aliases give the embedded servers of the modules distinct field names (both types are named Server).
type (
	vehiclesServer     = vehicles.Server     // W2.02: the fleet (S2-01, S2-02)
	reservationsServer = reservations.Server // W2.02: holds of a vehicle with its driver (S2-03, AC-03)
)

// fleetServer is the base strict server of the tag Fleet — the point the modules of the tag are connected at. The
// tag has several owners: W2.02 (vehicles, reservations), W2.03 (trip planning, assignTripVehicle, routes), W2.04
// (inspections, defects: an overlay over this base, fleet_inspections.go), W2.05 (trips, expenses), W2.06 (review),
// W2.07 (the driver pool). Every owner embeds its server here (one line and one line in newFleetServer) or overlays
// it in newFleet; the operations without an owner yet answer 501 not_implemented through fleetPending, whose methods
// are one level deeper than the methods of the embedded servers and therefore never shadow them.
type fleetServer struct {
	*vehiclesServer
	*reservationsServer
	*routesServer // W2.03: trip planning (fleet_routes.go)
	fleetPending
}

var _ fleetapi.StrictServerInterface = (*fleetServer)(nil)

// newFleetServer wires the embedded modules of the tag over the tenant pools, the evaluator of W1.04 and the clock of
// the application (APP_FIXED_NOW outside prod).
func newFleetServer(pools *tenantctx.Pools, ev *authz.Evaluator, now func() time.Time) *fleetServer {
	return &fleetServer{
		vehiclesServer:     &vehicles.Server{Pools: pools, Authz: ev, Now: now},
		reservationsServer: &reservations.Server{Pools: pools, Evaluator: ev, Now: now},
		routesServer:       newRoutesServer(pools, ev, now),
	}
}

// newFleet is the server of the tag Fleet as main wires it: the embedded modules (newFleetServer) under the trips
// and expenses of W2.05 (fleet_trips.go) under the inspections of W2.04 under the review of W2.06 (fleet_review.go)
// under the driver pool of W2.07 (fleet_pool.go) under the expense categories of W2.41 (fleet_expense_categories.go)
// under the CSV import of W2.50 (fleet_csv.go); each overlay serves its own operations and passes the others down.
func newFleet(pools *tenantctx.Pools, ev *authz.Evaluator, control inbox.ControlDB, now func() time.Time) fleetapi.StrictServerInterface {
	reviewed := fleetReview(fleetInspections(fleetTrips(newFleetServer(pools, ev, now), pools, ev, control, now), pools, ev, control, now), pools, ev, control, now)
	// W2.50: the CSV import of vehicles on top (fleet_csv.go).
	return fleetCSV(fleetExpenseCategories(fleetPool(reviewed, pools, ev, control, now), pools, ev, now), pools, ev, now)
}

// fleetPendingOps are the operations of the tag Fleet srv does not serve: a direct call without a tenant context
// answers 501 not_implemented (fleetPending, the base of an overlay). A module answers such a call before it reads
// anything — the 404 of a missing tenant, a malformed request — so the probe touches no database; a panic means the
// call reached a module too. The list follows the composed server: an owner who wires its module adds nothing here.
func fleetPendingOps(srv fleetapi.StrictServerInterface) map[string]bool {
	iface := reflect.TypeFor[fleetapi.StrictServerInterface]()
	v := reflect.ValueOf(srv)
	pending := map[string]bool{}
	for m := range iface.Methods() {
		if answers501(v.MethodByName(m.Name), m.Type.In(1)) {
			pending[strings.ToLower(m.Name[:1])+m.Name[1:]] = true
		}
	}
	return pending
}

func answers501(method reflect.Value, req reflect.Type) (pending bool) {
	defer func() {
		if recover() != nil {
			pending = false
		}
	}()
	out := method.Call([]reflect.Value{reflect.ValueOf(context.Background()), reflect.Zero(req)})
	err, _ := reflect.TypeAssert[error](out[1])
	return problem.Is(err, problem.CodeNotImplemented)
}

// mountFleetPending answers 501 for the operations srv does not serve over the routes of the generated strict
// handler (chi replaces the endpoint): they answer before their parameters are bound, as a tag without a server does,
// so the pending isolation rows of their owners keep seeing 501.
func mountFleetPending(r chi.Router, srv fleetapi.StrictServerInterface) {
	pending := fleetPendingOps(srv)
	for _, op := range catalog.Operations {
		if op.Tag == "Fleet" && pending[op.ID] {
			r.MethodFunc(op.Method, op.Path, notImplemented)
		}
	}
}

// fleetPending puts the stubs one level below the embedded servers.
type fleetPending struct{ fleetNotImplemented }

type fleetNotImplemented struct{}

var errFleetNotImplemented = problem.New(problem.CodeNotImplemented, "")

func (fleetNotImplemented) AssignTripVehicle(context.Context, fleetapi.AssignTripVehicleRequestObject) (fleetapi.AssignTripVehicleResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) CreateRoute(context.Context, fleetapi.CreateRouteRequestObject) (fleetapi.CreateRouteResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) CreateTripExpense(context.Context, fleetapi.CreateTripExpenseRequestObject) (fleetapi.CreateTripExpenseResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) CreateTripPlan(context.Context, fleetapi.CreateTripPlanRequestObject) (fleetapi.CreateTripPlanResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) CreateVehicle(context.Context, fleetapi.CreateVehicleRequestObject) (fleetapi.CreateVehicleResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) DecideDriverTransfer(context.Context, fleetapi.DecideDriverTransferRequestObject) (fleetapi.DecideDriverTransferResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) DecideInspectionDefect(context.Context, fleetapi.DecideInspectionDefectRequestObject) (fleetapi.DecideInspectionDefectResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) FinishTripRoute(context.Context, fleetapi.FinishTripRouteRequestObject) (fleetapi.FinishTripRouteResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) GetDriverTransfer(context.Context, fleetapi.GetDriverTransferRequestObject) (fleetapi.GetDriverTransferResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) GetDriverPoolPublication(context.Context, fleetapi.GetDriverPoolPublicationRequestObject) (fleetapi.GetDriverPoolPublicationResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) GetInspection(context.Context, fleetapi.GetInspectionRequestObject) (fleetapi.GetInspectionResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) GetInspectionChecklist(context.Context, fleetapi.GetInspectionChecklistRequestObject) (fleetapi.GetInspectionChecklistResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) GetInspectionDefect(context.Context, fleetapi.GetInspectionDefectRequestObject) (fleetapi.GetInspectionDefectResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) GetReservation(context.Context, fleetapi.GetReservationRequestObject) (fleetapi.GetReservationResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) GetTrip(context.Context, fleetapi.GetTripRequestObject) (fleetapi.GetTripResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) GetTripExpense(context.Context, fleetapi.GetTripExpenseRequestObject) (fleetapi.GetTripExpenseResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) GetTripPlan(context.Context, fleetapi.GetTripPlanRequestObject) (fleetapi.GetTripPlanResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) ListAvailableDrivers(context.Context, fleetapi.ListAvailableDriversRequestObject) (fleetapi.ListAvailableDriversResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) ListDriverPoolPublications(context.Context, fleetapi.ListDriverPoolPublicationsRequestObject) (fleetapi.ListDriverPoolPublicationsResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) ListDriverTransfers(context.Context, fleetapi.ListDriverTransfersRequestObject) (fleetapi.ListDriverTransfersResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) ListInspectionDefects(context.Context, fleetapi.ListInspectionDefectsRequestObject) (fleetapi.ListInspectionDefectsResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) ListInspections(context.Context, fleetapi.ListInspectionsRequestObject) (fleetapi.ListInspectionsResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) ListReservations(context.Context, fleetapi.ListReservationsRequestObject) (fleetapi.ListReservationsResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) ListRoutes(context.Context, fleetapi.ListRoutesRequestObject) (fleetapi.ListRoutesResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) ListTripExpenses(context.Context, fleetapi.ListTripExpensesRequestObject) (fleetapi.ListTripExpensesResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) ListTripPlans(context.Context, fleetapi.ListTripPlansRequestObject) (fleetapi.ListTripPlansResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) ListTrips(context.Context, fleetapi.ListTripsRequestObject) (fleetapi.ListTripsResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) ListVehicles(context.Context, fleetapi.ListVehiclesRequestObject) (fleetapi.ListVehiclesResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) PublishDriverToPool(context.Context, fleetapi.PublishDriverToPoolRequestObject) (fleetapi.PublishDriverToPoolResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) ReleaseReservation(context.Context, fleetapi.ReleaseReservationRequestObject) (fleetapi.ReleaseReservationResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) RequestDriverTransfer(context.Context, fleetapi.RequestDriverTransferRequestObject) (fleetapi.RequestDriverTransferResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) ReserveVehicle(context.Context, fleetapi.ReserveVehicleRequestObject) (fleetapi.ReserveVehicleResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) ReturnTrip(context.Context, fleetapi.ReturnTripRequestObject) (fleetapi.ReturnTripResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) ReviewInspection(context.Context, fleetapi.ReviewInspectionRequestObject) (fleetapi.ReviewInspectionResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) ReviewTrip(context.Context, fleetapi.ReviewTripRequestObject) (fleetapi.ReviewTripResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) ReviewTripExpense(context.Context, fleetapi.ReviewTripExpenseRequestObject) (fleetapi.ReviewTripExpenseResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) StartTrip(context.Context, fleetapi.StartTripRequestObject) (fleetapi.StartTripResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) SubmitInspection(context.Context, fleetapi.SubmitInspectionRequestObject) (fleetapi.SubmitInspectionResponseObject, error) {
	return nil, errFleetNotImplemented
}

func (fleetNotImplemented) WithdrawDriverPoolPublication(context.Context, fleetapi.WithdrawDriverPoolPublicationRequestObject) (fleetapi.WithdrawDriverPoolPublicationResponseObject, error) {
	return nil, errFleetNotImplemented
}

// ListExpenseCategories answers 501 until W2.41 (W2.52, contract 0.6.1-stage2).
func (fleetNotImplemented) ListExpenseCategories(context.Context, fleetapi.ListExpenseCategoriesRequestObject) (fleetapi.ListExpenseCategoriesResponseObject, error) {
	return nil, errFleetNotImplemented
}

// CreateExpenseCategory answers 501 until W2.41 (W2.52, contract 0.6.1-stage2).
func (fleetNotImplemented) CreateExpenseCategory(context.Context, fleetapi.CreateExpenseCategoryRequestObject) (fleetapi.CreateExpenseCategoryResponseObject, error) {
	return nil, errFleetNotImplemented
}

// ArchiveExpenseCategory answers 501 until W2.41 (W2.52, contract 0.6.1-stage2).
func (fleetNotImplemented) ArchiveExpenseCategory(context.Context, fleetapi.ArchiveExpenseCategoryRequestObject) (fleetapi.ArchiveExpenseCategoryResponseObject, error) {
	return nil, errFleetNotImplemented
}

// ListVehicleAssignments answers 501 until W2.42 (W2.52, contract 0.6.1-stage2).
func (fleetNotImplemented) ListVehicleAssignments(context.Context, fleetapi.ListVehicleAssignmentsRequestObject) (fleetapi.ListVehicleAssignmentsResponseObject, error) {
	return nil, errFleetNotImplemented
}

// MoveVehicle answers 501 until W2.42 (W2.52, contract 0.6.1-stage2).
func (fleetNotImplemented) MoveVehicle(context.Context, fleetapi.MoveVehicleRequestObject) (fleetapi.MoveVehicleResponseObject, error) {
	return nil, errFleetNotImplemented
}

// AssignInspectionDefect answers 501 until W2.46 (W2.52, contract 0.6.1-stage2).
func (fleetNotImplemented) AssignInspectionDefect(context.Context, fleetapi.AssignInspectionDefectRequestObject) (fleetapi.AssignInspectionDefectResponseObject, error) {
	return nil, errFleetNotImplemented
}

// CreateVehicleImport answers 501 until W2.50 (W2.52, contract 0.6.1-stage2).
func (fleetNotImplemented) CreateVehicleImport(context.Context, fleetapi.CreateVehicleImportRequestObject) (fleetapi.CreateVehicleImportResponseObject, error) {
	return nil, errFleetNotImplemented
}

// GetVehicleImport answers 501 until W2.50 (W2.52, contract 0.6.1-stage2).
func (fleetNotImplemented) GetVehicleImport(context.Context, fleetapi.GetVehicleImportRequestObject) (fleetapi.GetVehicleImportResponseObject, error) {
	return nil, errFleetNotImplemented
}

// CommitVehicleImport answers 501 until W2.50 (W2.52, contract 0.6.1-stage2).
func (fleetNotImplemented) CommitVehicleImport(context.Context, fleetapi.CommitVehicleImportRequestObject) (fleetapi.CommitVehicleImportResponseObject, error) {
	return nil, errFleetNotImplemented
}
