package pool

import (
	"context"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// TripGuard is what the overlay asks about the trips of the transfers of a subject (Service in cmd/api).
type TripGuard interface {
	// TripAccess is what the transfers of the subject of tc leave him on trip.
	TripAccess(ctx context.Context, tc tenantctx.TenantContext, trip uuid.UUID) (Access, error)
	// TripOf is the trip of object id of kind o (uuid.Nil: none).
	TripOf(ctx context.Context, tc tenantctx.TenantContext, o Object, id uuid.UUID) (uuid.UUID, error)
	// TripAccesses are the trips the transfers of the subject of tc narrow now (AccessNone, AccessContinuation).
	TripAccesses(ctx context.Context, tc tenantctx.TenantContext) (map[uuid.UUID]Access, error)
}

var _ TripGuard = (*Service)(nil)

// The texts of the modules of the trip for a missing object: the overlay answers a hidden one like them (AC-01).
const (
	textReservationNotFound = "Бронь не найдена."
	textObjectNotFound      = "" // the inspections and the defects answer without a detail
)

// guardFor is the subject the overlay narrows (W2.57: a member with a person) and whether there is a guard at all.
func (h Server) guardFor(ctx context.Context) (tenantctx.TenantContext, bool) {
	tc, ok := tenantctx.FromContext(ctx)
	return tc, ok && h.Trips != nil && guarded(tc)
}

// trip lets operation op (kind — the kind of an inspection) on trip through to the base unless the transfer of the
// subject closes the trip to him: AccessNone — 404 with detail; AccessContinuation — 404 unless op continues the trip
// (Continues, D09).
func (h Server) trip(ctx context.Context, op, kind string, trip uuid.UUID, detail string) error {
	tc, ok := h.guardFor(ctx)
	if !ok || trip == uuid.Nil {
		return nil
	}
	a, err := h.Trips.TripAccess(ctx, tc, trip)
	switch {
	case err != nil:
		return err
	case a == AccessNone, a == AccessContinuation && !Continues(op, kind):
		return problem.New(problem.CodeNotFound, detail)
	}
	return nil
}

// object is trip for the trip of object id of kind o.
func (h Server) object(ctx context.Context, op, kind string, o Object, id uuid.UUID, detail string) error {
	tc, ok := h.guardFor(ctx)
	if !ok {
		return nil
	}
	trip, err := h.Trips.TripOf(ctx, tc, o, id)
	if err != nil {
		return err
	}
	return h.trip(ctx, op, kind, trip, detail)
}

// accesses returns the trips the transfers of the subject narrow now (none without a guard).
func (h Server) accesses(ctx context.Context) (map[uuid.UUID]Access, error) {
	tc, ok := h.guardFor(ctx)
	if !ok {
		return nil, nil
	}
	return h.Trips.TripAccesses(ctx, tc)
}

// shown reports whether an item of a trip at access a stays in a list whose items are read by op: as op itself would
// answer — a closed trip never, a continued one only when op continues it (a reservation of a started trip does not).
func shown(a Access, op string) bool {
	return a == AccessBase || a == AccessContinuation && Continues(op, "")
}

// listPage is a page of a list of the base: its items, the cursor of the next one and whether the base answered 200.
type listPage[T any] struct {
	items []T
	next  *string
	ok    bool
}

// visiblePage leaves out of the first page of the base the items of the trips the transfers of the subject close to
// him for op (the read of an item: getTrip, getReservation…) and fills it up before the pagination: for every item it
// left out it asks the base (more: from the cursor of the base, so many items) for the next ones, until the page holds
// as many items as the base gave or the list ends. The cursors of the base are keysets, not bound to the limit, so the
// next cursor is the one after the last item read, and a page is short only at the end of the list.
func visiblePage[T any](ctx context.Context, h Server, op string, first listPage[T], tripOf func(T) *uuid.UUID,
	more func(cursor string, limit int) (listPage[T], error)) (listPage[T], error) {
	acc, err := h.accesses(ctx)
	if err != nil || len(acc) == 0 || !first.ok {
		return first, err
	}
	keep := func(items []T) []T {
		out := make([]T, 0, len(items))
		for _, it := range items {
			if t := tripOf(it); t == nil || shown(acc[*t], op) {
				out = append(out, it)
			}
		}
		return out
	}
	out := listPage[T]{items: keep(first.items), next: first.next, ok: true}
	for need := len(first.items) - len(out.items); need > 0 && out.next != nil; {
		p, err := more(*out.next, need)
		if err != nil {
			return listPage[T]{}, err
		}
		if !p.ok {
			break // the page so far and the cursor before the failed read: the client asks again
		}
		kept := keep(p.items)
		out.items, out.next, need = append(out.items, kept...), p.next, need-len(kept)
		if len(p.items) == 0 {
			break
		}
	}
	return out, nil
}

// GetTrip implements fleetapi.StrictServerInterface: the guard of the trip of a transfer, then the base.
func (h Server) GetTrip(ctx context.Context, r fleetapi.GetTripRequestObject) (fleetapi.GetTripResponseObject, error) {
	if err := h.trip(ctx, "getTrip", "", r.TripId, textTripNotFound); err != nil {
		return nil, err
	}
	return h.StrictServerInterface.GetTrip(ctx, r)
}

// GetTripPlan implements fleetapi.StrictServerInterface: the guard of the trip of a transfer, then the base.
func (h Server) GetTripPlan(ctx context.Context, r fleetapi.GetTripPlanRequestObject) (fleetapi.GetTripPlanResponseObject, error) {
	if err := h.trip(ctx, "getTripPlan", "", r.TripId, textTripNotFound); err != nil {
		return nil, err
	}
	return h.StrictServerInterface.GetTripPlan(ctx, r)
}

// ReturnTrip implements fleetapi.StrictServerInterface: the guard of the trip of a transfer, then the base.
func (h Server) ReturnTrip(ctx context.Context, r fleetapi.ReturnTripRequestObject) (fleetapi.ReturnTripResponseObject, error) {
	if err := h.trip(ctx, "returnTrip", "", r.TripId, textTripNotFound); err != nil {
		return nil, err
	}
	return h.StrictServerInterface.ReturnTrip(ctx, r)
}

// FinishTripRoute implements fleetapi.StrictServerInterface: the guard of the trip of a transfer, then the base.
func (h Server) FinishTripRoute(ctx context.Context, r fleetapi.FinishTripRouteRequestObject) (fleetapi.FinishTripRouteResponseObject, error) {
	if err := h.trip(ctx, "finishTripRoute", "", r.TripId, textTripNotFound); err != nil {
		return nil, err
	}
	return h.StrictServerInterface.FinishTripRoute(ctx, r)
}

// ListTripExpenses implements fleetapi.StrictServerInterface: the guard of the trip of a transfer, then the base.
func (h Server) ListTripExpenses(ctx context.Context, r fleetapi.ListTripExpensesRequestObject) (fleetapi.ListTripExpensesResponseObject, error) {
	if err := h.trip(ctx, "listTripExpenses", "", r.TripId, textTripNotFound); err != nil {
		return nil, err
	}
	return h.StrictServerInterface.ListTripExpenses(ctx, r)
}

// CreateTripExpense implements fleetapi.StrictServerInterface: the guard of the trip of a transfer, then the base.
func (h Server) CreateTripExpense(ctx context.Context, r fleetapi.CreateTripExpenseRequestObject) (fleetapi.CreateTripExpenseResponseObject, error) {
	if err := h.trip(ctx, "createTripExpense", "", r.TripId, textTripNotFound); err != nil {
		return nil, err
	}
	return h.StrictServerInterface.CreateTripExpense(ctx, r)
}

// GetTripExpense implements fleetapi.StrictServerInterface: the guard of the trip of a transfer, then the base.
func (h Server) GetTripExpense(ctx context.Context, r fleetapi.GetTripExpenseRequestObject) (fleetapi.GetTripExpenseResponseObject, error) {
	if err := h.trip(ctx, "getTripExpense", "", r.TripId, textTripNotFound); err != nil {
		return nil, err
	}
	return h.StrictServerInterface.GetTripExpense(ctx, r)
}

// ReviewTripExpense implements fleetapi.StrictServerInterface: the guard of the trip of a transfer, then the base.
func (h Server) ReviewTripExpense(ctx context.Context, r fleetapi.ReviewTripExpenseRequestObject) (fleetapi.ReviewTripExpenseResponseObject, error) {
	if err := h.trip(ctx, "reviewTripExpense", "", r.TripId, textTripNotFound); err != nil {
		return nil, err
	}
	return h.StrictServerInterface.ReviewTripExpense(ctx, r)
}

// AssignTripVehicle implements fleetapi.StrictServerInterface: the guard of the trip of a transfer, the assignment of
// the base, then the settlement of the trip — the grant of its vehicle follows the vehicle the logist put on it.
func (h Server) AssignTripVehicle(ctx context.Context, r fleetapi.AssignTripVehicleRequestObject) (fleetapi.AssignTripVehicleResponseObject, error) {
	if err := h.trip(ctx, "assignTripVehicle", "", r.TripId, textTripNotFound); err != nil {
		return nil, err
	}
	out, err := h.StrictServerInterface.AssignTripVehicle(ctx, r)
	if err == nil {
		h.settleAfter(ctx, "assignTripVehicle", r.TripId)
	}
	return out, err
}

// GetInspection implements fleetapi.StrictServerInterface: the guard of the trip of the inspection, then the base.
func (h Server) GetInspection(ctx context.Context, r fleetapi.GetInspectionRequestObject) (fleetapi.GetInspectionResponseObject, error) {
	if err := h.object(ctx, "getInspection", "", ObjectInspection, r.InspectionId, textObjectNotFound); err != nil {
		return nil, err
	}
	return h.StrictServerInterface.GetInspection(ctx, r)
}

// ReviewInspection implements fleetapi.StrictServerInterface: the guard of the trip of the inspection, then the base.
func (h Server) ReviewInspection(ctx context.Context, r fleetapi.ReviewInspectionRequestObject) (fleetapi.ReviewInspectionResponseObject, error) {
	if err := h.object(ctx, "reviewInspection", "", ObjectInspection, r.InspectionId, textObjectNotFound); err != nil {
		return nil, err
	}
	return h.StrictServerInterface.ReviewInspection(ctx, r)
}

// SubmitInspection implements fleetapi.StrictServerInterface: the guard of the trip of the inspection (a return one —
// tripId, a departure one — the trip of reservationId), then the base.
func (h Server) SubmitInspection(ctx context.Context, r fleetapi.SubmitInspectionRequestObject) (fleetapi.SubmitInspectionResponseObject, error) {
	if b := r.Body; b != nil {
		var err error
		switch {
		case b.TripId != nil:
			err = h.trip(ctx, "submitInspection", string(b.Kind), *b.TripId, textObjectNotFound)
		case b.ReservationId != nil:
			err = h.object(ctx, "submitInspection", string(b.Kind), ObjectReservation, *b.ReservationId, textObjectNotFound)
		}
		if err != nil {
			return nil, err
		}
	}
	return h.StrictServerInterface.SubmitInspection(ctx, r)
}

// GetInspectionDefect implements fleetapi.StrictServerInterface: the guard of the trip of the defect, then the base.
func (h Server) GetInspectionDefect(ctx context.Context, r fleetapi.GetInspectionDefectRequestObject) (fleetapi.GetInspectionDefectResponseObject, error) {
	if err := h.object(ctx, "getInspectionDefect", "", ObjectDefect, r.DefectId, textObjectNotFound); err != nil {
		return nil, err
	}
	return h.StrictServerInterface.GetInspectionDefect(ctx, r)
}

// AssignInspectionDefect implements fleetapi.StrictServerInterface: the guard of the trip of the defect, then the base.
func (h Server) AssignInspectionDefect(ctx context.Context, r fleetapi.AssignInspectionDefectRequestObject) (fleetapi.AssignInspectionDefectResponseObject, error) {
	if err := h.object(ctx, "assignInspectionDefect", "", ObjectDefect, r.DefectId, textObjectNotFound); err != nil {
		return nil, err
	}
	return h.StrictServerInterface.AssignInspectionDefect(ctx, r)
}

// DecideInspectionDefect implements fleetapi.StrictServerInterface: the guard of the trip of the defect, then the base.
func (h Server) DecideInspectionDefect(ctx context.Context, r fleetapi.DecideInspectionDefectRequestObject) (fleetapi.DecideInspectionDefectResponseObject, error) {
	if err := h.object(ctx, "decideInspectionDefect", "", ObjectDefect, r.DefectId, textObjectNotFound); err != nil {
		return nil, err
	}
	return h.StrictServerInterface.DecideInspectionDefect(ctx, r)
}

// GetReservation implements fleetapi.StrictServerInterface: the guard of the trip of the hold, then the base.
func (h Server) GetReservation(ctx context.Context, r fleetapi.GetReservationRequestObject) (fleetapi.GetReservationResponseObject, error) {
	if err := h.object(ctx, "getReservation", "", ObjectReservation, r.ReservationId, textReservationNotFound); err != nil {
		return nil, err
	}
	return h.StrictServerInterface.GetReservation(ctx, r)
}

// follow is the read of a follow-up page of the base for visiblePage.
func follow[R, T any](call func(cursor *string, limit *int) (R, listPage[T], error)) func(string, int) (listPage[T], error) {
	return func(cursor string, limit int) (listPage[T], error) {
		_, p, err := call(&cursor, &limit)
		return p, err
	}
}

// ListTrips implements fleetapi.StrictServerInterface: the base without the trips the transfers of the subject close
// to him, before the pagination.
func (h Server) ListTrips(ctx context.Context, r fleetapi.ListTripsRequestObject) (fleetapi.ListTripsResponseObject, error) { //nolint:dupl // one method per list operation of the strict server: the types differ
	call := func(c *string, n *int) (fleetapi.ListTripsResponseObject, listPage[fleetapi.Trip], error) {
		q := r
		q.Params.Cursor, q.Params.Limit = c, n
		out, err := h.StrictServerInterface.ListTrips(ctx, q)
		p, ok := out.(fleetapi.ListTrips200JSONResponse)
		return out, listPage[fleetapi.Trip]{items: p.Body.Items, next: p.Body.NextCursor, ok: ok && err == nil}, err
	}
	out, first, err := call(r.Params.Cursor, r.Params.Limit)
	if !first.ok {
		return out, err
	}
	v, err := visiblePage(ctx, h, "getTrip", first, func(t fleetapi.Trip) *uuid.UUID { return &t.Id }, follow(call))
	if err != nil {
		return nil, err
	}
	page, _ := out.(fleetapi.ListTrips200JSONResponse) // first.ok
	page.Body.Items, page.Body.NextCursor = v.items, v.next
	return page, nil
}

// ListTripPlans implements fleetapi.StrictServerInterface: the base without the trips the transfers of the subject
// close to him, before the pagination.
func (h Server) ListTripPlans(ctx context.Context, r fleetapi.ListTripPlansRequestObject) (fleetapi.ListTripPlansResponseObject, error) { //nolint:dupl // one method per list operation of the strict server: the types differ
	call := func(c *string, n *int) (fleetapi.ListTripPlansResponseObject, listPage[fleetapi.TripPlan], error) {
		q := r
		q.Params.Cursor, q.Params.Limit = c, n
		out, err := h.StrictServerInterface.ListTripPlans(ctx, q)
		p, ok := out.(fleetapi.ListTripPlans200JSONResponse)
		return out, listPage[fleetapi.TripPlan]{items: p.Body.Items, next: p.Body.NextCursor, ok: ok && err == nil}, err
	}
	out, first, err := call(r.Params.Cursor, r.Params.Limit)
	if !first.ok {
		return out, err
	}
	v, err := visiblePage(ctx, h, "getTripPlan", first, func(t fleetapi.TripPlan) *uuid.UUID { return &t.Id }, follow(call))
	if err != nil {
		return nil, err
	}
	page, _ := out.(fleetapi.ListTripPlans200JSONResponse) // first.ok
	page.Body.Items, page.Body.NextCursor = v.items, v.next
	return page, nil
}

// ListInspections implements fleetapi.StrictServerInterface: the base without the inspections of the trips the
// transfers of the subject close to him, before the pagination.
func (h Server) ListInspections(ctx context.Context, r fleetapi.ListInspectionsRequestObject) (fleetapi.ListInspectionsResponseObject, error) { //nolint:dupl // one method per list operation of the strict server: the types differ
	call := func(c *string, n *int) (fleetapi.ListInspectionsResponseObject, listPage[fleetapi.Inspection], error) {
		q := r
		q.Params.Cursor, q.Params.Limit = c, n
		out, err := h.StrictServerInterface.ListInspections(ctx, q)
		p, ok := out.(fleetapi.ListInspections200JSONResponse)
		return out, listPage[fleetapi.Inspection]{items: p.Body.Items, next: p.Body.NextCursor, ok: ok && err == nil}, err
	}
	out, first, err := call(r.Params.Cursor, r.Params.Limit)
	if !first.ok {
		return out, err
	}
	v, err := visiblePage(ctx, h, "getInspection", first, func(i fleetapi.Inspection) *uuid.UUID { return i.TripId }, follow(call))
	if err != nil {
		return nil, err
	}
	page, _ := out.(fleetapi.ListInspections200JSONResponse) // first.ok
	page.Body.Items, page.Body.NextCursor = v.items, v.next
	return page, nil
}

// ListReservations implements fleetapi.StrictServerInterface: the base without the holds of the trips the transfers
// of the subject close to him — and of the trips in their continuation, as getReservation (D09) — before the
// pagination.
func (h Server) ListReservations(ctx context.Context, r fleetapi.ListReservationsRequestObject) (fleetapi.ListReservationsResponseObject, error) { //nolint:dupl // one method per list operation of the strict server: the types differ
	call := func(c *string, n *int) (fleetapi.ListReservationsResponseObject, listPage[fleetapi.Reservation], error) {
		q := r
		q.Params.Cursor, q.Params.Limit = c, n
		out, err := h.StrictServerInterface.ListReservations(ctx, q)
		p, ok := out.(fleetapi.ListReservations200JSONResponse)
		return out, listPage[fleetapi.Reservation]{items: p.Body.Items, next: p.Body.NextCursor, ok: ok && err == nil}, err
	}
	out, first, err := call(r.Params.Cursor, r.Params.Limit)
	if !first.ok {
		return out, err
	}
	v, err := visiblePage(ctx, h, "getReservation", first, func(b fleetapi.Reservation) *uuid.UUID { return b.TripId }, follow(call))
	if err != nil {
		return nil, err
	}
	page, _ := out.(fleetapi.ListReservations200JSONResponse) // first.ok
	page.Body.Items, page.Body.NextCursor = v.items, v.next
	return page, nil
}

// ListInspectionDefects implements fleetapi.StrictServerInterface: the base without the defects of the trips the
// transfers of the subject close to him, before the pagination.
func (h Server) ListInspectionDefects(ctx context.Context, r fleetapi.ListInspectionDefectsRequestObject) (fleetapi.ListInspectionDefectsResponseObject, error) { //nolint:dupl // one method per list operation of the strict server: the types differ
	call := func(c *string, n *int) (fleetapi.ListInspectionDefectsResponseObject, listPage[fleetapi.InspectionDefect], error) {
		q := r
		q.Params.Cursor, q.Params.Limit = c, n
		out, err := h.StrictServerInterface.ListInspectionDefects(ctx, q)
		p, ok := out.(fleetapi.ListInspectionDefects200JSONResponse)
		return out, listPage[fleetapi.InspectionDefect]{items: p.Body.Items, next: p.Body.NextCursor, ok: ok && err == nil}, err
	}
	out, first, err := call(r.Params.Cursor, r.Params.Limit)
	if !first.ok {
		return out, err
	}
	v, err := visiblePage(ctx, h, "getInspectionDefect", first, func(d fleetapi.InspectionDefect) *uuid.UUID { return d.TripId },
		follow(call))
	if err != nil {
		return nil, err
	}
	page, _ := out.(fleetapi.ListInspectionDefects200JSONResponse) // first.ok
	page.Body.Items, page.Body.NextCursor = v.items, v.next
	return page, nil
}
