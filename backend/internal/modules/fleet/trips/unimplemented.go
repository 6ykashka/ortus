package trips

import (
	"context"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// unimplemented is the base of the tag Fleet when no other module serves it: every operation answers 501
// not_implemented, as a tag without a server does (cmd/api mountTags). The modules of the tag overlay their operations
// (W2.02 vehicles and reservations, W2.03 routes, W2.05 trips and expenses, W2.07 the pool).
type unimplemented struct{}

var _ fleetapi.StrictServerInterface = unimplemented{}

func notImplemented() error { return problem.New(problem.CodeNotImplemented, "") }

// ListInspectionDefects answers 501.
func (unimplemented) ListInspectionDefects(context.Context, fleetapi.ListInspectionDefectsRequestObject) (fleetapi.ListInspectionDefectsResponseObject, error) {
	return nil, notImplemented()
}

// GetInspectionDefect answers 501.
func (unimplemented) GetInspectionDefect(context.Context, fleetapi.GetInspectionDefectRequestObject) (fleetapi.GetInspectionDefectResponseObject, error) {
	return nil, notImplemented()
}

// DecideInspectionDefect answers 501.
func (unimplemented) DecideInspectionDefect(context.Context, fleetapi.DecideInspectionDefectRequestObject) (fleetapi.DecideInspectionDefectResponseObject, error) {
	return nil, notImplemented()
}

// ListAvailableDrivers answers 501.
func (unimplemented) ListAvailableDrivers(context.Context, fleetapi.ListAvailableDriversRequestObject) (fleetapi.ListAvailableDriversResponseObject, error) {
	return nil, notImplemented()
}

// ListDriverTransfers answers 501.
func (unimplemented) ListDriverTransfers(context.Context, fleetapi.ListDriverTransfersRequestObject) (fleetapi.ListDriverTransfersResponseObject, error) {
	return nil, notImplemented()
}

// RequestDriverTransfer answers 501.
func (unimplemented) RequestDriverTransfer(context.Context, fleetapi.RequestDriverTransferRequestObject) (fleetapi.RequestDriverTransferResponseObject, error) {
	return nil, notImplemented()
}

// GetDriverTransfer answers 501.
func (unimplemented) GetDriverTransfer(context.Context, fleetapi.GetDriverTransferRequestObject) (fleetapi.GetDriverTransferResponseObject, error) {
	return nil, notImplemented()
}

// DecideDriverTransfer answers 501.
func (unimplemented) DecideDriverTransfer(context.Context, fleetapi.DecideDriverTransferRequestObject) (fleetapi.DecideDriverTransferResponseObject, error) {
	return nil, notImplemented()
}

// GetInspectionChecklist answers 501.
func (unimplemented) GetInspectionChecklist(context.Context, fleetapi.GetInspectionChecklistRequestObject) (fleetapi.GetInspectionChecklistResponseObject, error) {
	return nil, notImplemented()
}

// ListInspections answers 501.
func (unimplemented) ListInspections(context.Context, fleetapi.ListInspectionsRequestObject) (fleetapi.ListInspectionsResponseObject, error) {
	return nil, notImplemented()
}

// SubmitInspection answers 501.
func (unimplemented) SubmitInspection(context.Context, fleetapi.SubmitInspectionRequestObject) (fleetapi.SubmitInspectionResponseObject, error) {
	return nil, notImplemented()
}

// GetInspection answers 501.
func (unimplemented) GetInspection(context.Context, fleetapi.GetInspectionRequestObject) (fleetapi.GetInspectionResponseObject, error) {
	return nil, notImplemented()
}

// ReviewInspection answers 501.
func (unimplemented) ReviewInspection(context.Context, fleetapi.ReviewInspectionRequestObject) (fleetapi.ReviewInspectionResponseObject, error) {
	return nil, notImplemented()
}

// ListReservations answers 501.
func (unimplemented) ListReservations(context.Context, fleetapi.ListReservationsRequestObject) (fleetapi.ListReservationsResponseObject, error) {
	return nil, notImplemented()
}

// ReserveVehicle answers 501.
func (unimplemented) ReserveVehicle(context.Context, fleetapi.ReserveVehicleRequestObject) (fleetapi.ReserveVehicleResponseObject, error) {
	return nil, notImplemented()
}

// GetReservation answers 501.
func (unimplemented) GetReservation(context.Context, fleetapi.GetReservationRequestObject) (fleetapi.GetReservationResponseObject, error) {
	return nil, notImplemented()
}

// ReleaseReservation answers 501.
func (unimplemented) ReleaseReservation(context.Context, fleetapi.ReleaseReservationRequestObject) (fleetapi.ReleaseReservationResponseObject, error) {
	return nil, notImplemented()
}

// ListRoutes answers 501.
func (unimplemented) ListRoutes(context.Context, fleetapi.ListRoutesRequestObject) (fleetapi.ListRoutesResponseObject, error) {
	return nil, notImplemented()
}

// CreateRoute answers 501.
func (unimplemented) CreateRoute(context.Context, fleetapi.CreateRouteRequestObject) (fleetapi.CreateRouteResponseObject, error) {
	return nil, notImplemented()
}

// ListTripPlans answers 501.
func (unimplemented) ListTripPlans(context.Context, fleetapi.ListTripPlansRequestObject) (fleetapi.ListTripPlansResponseObject, error) {
	return nil, notImplemented()
}

// CreateTripPlan answers 501.
func (unimplemented) CreateTripPlan(context.Context, fleetapi.CreateTripPlanRequestObject) (fleetapi.CreateTripPlanResponseObject, error) {
	return nil, notImplemented()
}

// GetTripPlan answers 501.
func (unimplemented) GetTripPlan(context.Context, fleetapi.GetTripPlanRequestObject) (fleetapi.GetTripPlanResponseObject, error) {
	return nil, notImplemented()
}

// ListTrips answers 501.
func (unimplemented) ListTrips(context.Context, fleetapi.ListTripsRequestObject) (fleetapi.ListTripsResponseObject, error) {
	return nil, notImplemented()
}

// StartTrip answers 501.
func (unimplemented) StartTrip(context.Context, fleetapi.StartTripRequestObject) (fleetapi.StartTripResponseObject, error) {
	return nil, notImplemented()
}

// GetTrip answers 501.
func (unimplemented) GetTrip(context.Context, fleetapi.GetTripRequestObject) (fleetapi.GetTripResponseObject, error) {
	return nil, notImplemented()
}

// ReturnTrip answers 501.
func (unimplemented) ReturnTrip(context.Context, fleetapi.ReturnTripRequestObject) (fleetapi.ReturnTripResponseObject, error) {
	return nil, notImplemented()
}

// ListTripExpenses answers 501.
func (unimplemented) ListTripExpenses(context.Context, fleetapi.ListTripExpensesRequestObject) (fleetapi.ListTripExpensesResponseObject, error) {
	return nil, notImplemented()
}

// CreateTripExpense answers 501.
func (unimplemented) CreateTripExpense(context.Context, fleetapi.CreateTripExpenseRequestObject) (fleetapi.CreateTripExpenseResponseObject, error) {
	return nil, notImplemented()
}

// GetTripExpense answers 501.
func (unimplemented) GetTripExpense(context.Context, fleetapi.GetTripExpenseRequestObject) (fleetapi.GetTripExpenseResponseObject, error) {
	return nil, notImplemented()
}

// ReviewTripExpense answers 501.
func (unimplemented) ReviewTripExpense(context.Context, fleetapi.ReviewTripExpenseRequestObject) (fleetapi.ReviewTripExpenseResponseObject, error) {
	return nil, notImplemented()
}

// ReviewTrip answers 501.
func (unimplemented) ReviewTrip(context.Context, fleetapi.ReviewTripRequestObject) (fleetapi.ReviewTripResponseObject, error) {
	return nil, notImplemented()
}

// FinishTripRoute answers 501.
func (unimplemented) FinishTripRoute(context.Context, fleetapi.FinishTripRouteRequestObject) (fleetapi.FinishTripRouteResponseObject, error) {
	return nil, notImplemented()
}

// AssignTripVehicle answers 501.
func (unimplemented) AssignTripVehicle(context.Context, fleetapi.AssignTripVehicleRequestObject) (fleetapi.AssignTripVehicleResponseObject, error) {
	return nil, notImplemented()
}

// ListVehicles answers 501.
func (unimplemented) ListVehicles(context.Context, fleetapi.ListVehiclesRequestObject) (fleetapi.ListVehiclesResponseObject, error) {
	return nil, notImplemented()
}

// CreateVehicle answers 501.
func (unimplemented) CreateVehicle(context.Context, fleetapi.CreateVehicleRequestObject) (fleetapi.CreateVehicleResponseObject, error) {
	return nil, notImplemented()
}

// ListDriverPoolPublications answers 501 (W2.51 contract 0.6.0-stage2; the pool — W2.07).
func (unimplemented) ListDriverPoolPublications(context.Context, fleetapi.ListDriverPoolPublicationsRequestObject) (fleetapi.ListDriverPoolPublicationsResponseObject, error) {
	return nil, notImplemented()
}

// PublishDriverToPool answers 501 (W2.51 contract 0.6.0-stage2; the pool — W2.07).
func (unimplemented) PublishDriverToPool(context.Context, fleetapi.PublishDriverToPoolRequestObject) (fleetapi.PublishDriverToPoolResponseObject, error) {
	return nil, notImplemented()
}

// GetDriverPoolPublication answers 501 (W2.51 contract 0.6.0-stage2; the pool — W2.07).
func (unimplemented) GetDriverPoolPublication(context.Context, fleetapi.GetDriverPoolPublicationRequestObject) (fleetapi.GetDriverPoolPublicationResponseObject, error) {
	return nil, notImplemented()
}

// WithdrawDriverPoolPublication answers 501 (W2.51 contract 0.6.0-stage2; the pool — W2.07).
func (unimplemented) WithdrawDriverPoolPublication(context.Context, fleetapi.WithdrawDriverPoolPublicationRequestObject) (fleetapi.WithdrawDriverPoolPublicationResponseObject, error) {
	return nil, notImplemented()
}

// ListExpenseCategories answers 501 (W2.52 contract 0.6.1-stage2; the handler — W2.41).
func (unimplemented) ListExpenseCategories(context.Context, fleetapi.ListExpenseCategoriesRequestObject) (fleetapi.ListExpenseCategoriesResponseObject, error) {
	return nil, notImplemented()
}

// CreateExpenseCategory answers 501 (W2.52 contract 0.6.1-stage2; the handler — W2.41).
func (unimplemented) CreateExpenseCategory(context.Context, fleetapi.CreateExpenseCategoryRequestObject) (fleetapi.CreateExpenseCategoryResponseObject, error) {
	return nil, notImplemented()
}

// ArchiveExpenseCategory answers 501 (W2.52 contract 0.6.1-stage2; the handler — W2.41).
func (unimplemented) ArchiveExpenseCategory(context.Context, fleetapi.ArchiveExpenseCategoryRequestObject) (fleetapi.ArchiveExpenseCategoryResponseObject, error) {
	return nil, notImplemented()
}

// ListVehicleAssignments answers 501 (W2.52 contract 0.6.1-stage2; the handler — W2.42).
func (unimplemented) ListVehicleAssignments(context.Context, fleetapi.ListVehicleAssignmentsRequestObject) (fleetapi.ListVehicleAssignmentsResponseObject, error) {
	return nil, notImplemented()
}

// MoveVehicle answers 501 (W2.52 contract 0.6.1-stage2; the handler — W2.42).
func (unimplemented) MoveVehicle(context.Context, fleetapi.MoveVehicleRequestObject) (fleetapi.MoveVehicleResponseObject, error) {
	return nil, notImplemented()
}

// AssignInspectionDefect answers 501 (W2.52 contract 0.6.1-stage2; the handler — W2.46).
func (unimplemented) AssignInspectionDefect(context.Context, fleetapi.AssignInspectionDefectRequestObject) (fleetapi.AssignInspectionDefectResponseObject, error) {
	return nil, notImplemented()
}

// CreateVehicleImport answers 501 (W2.52 contract 0.6.1-stage2; the handler — W2.50).
func (unimplemented) CreateVehicleImport(context.Context, fleetapi.CreateVehicleImportRequestObject) (fleetapi.CreateVehicleImportResponseObject, error) {
	return nil, notImplemented()
}

// GetVehicleImport answers 501 (W2.52 contract 0.6.1-stage2; the handler — W2.50).
func (unimplemented) GetVehicleImport(context.Context, fleetapi.GetVehicleImportRequestObject) (fleetapi.GetVehicleImportResponseObject, error) {
	return nil, notImplemented()
}

// CommitVehicleImport answers 501 (W2.52 contract 0.6.1-stage2; the handler — W2.50).
func (unimplemented) CommitVehicleImport(context.Context, fleetapi.CommitVehicleImportRequestObject) (fleetapi.CommitVehicleImportResponseObject, error) {
	return nil, notImplemented()
}
