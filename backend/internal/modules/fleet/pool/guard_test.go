package pool

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Правило надстройки пула для рейса перевода (W2.57, Q-W2.07-1; AC-06, D09): водитель, которого перевод поставил на
// рейс, видит его и его объекты только пока назначение действует; после окна или отзыва начатого рейса — только
// продолжение (сдача, осмотр сдачи, расходы и фото этого рейса); остальное — 404, как несуществующий объект (AC-01).

// fakeTrips is the trip guard of a unit test: the access to each trip, the trips of the objects, the hidden trips.
type fakeTrips struct {
	access  map[uuid.UUID]Access
	objects map[uuid.UUID]uuid.UUID
	hidden  map[uuid.UUID]bool
	err     error
	calls   int
}

func (f *fakeTrips) TripAccess(_ context.Context, _ tenantctx.TenantContext, trip uuid.UUID) (Access, error) {
	f.calls++
	return f.access[trip], f.err
}

func (f *fakeTrips) TripOf(_ context.Context, _ tenantctx.TenantContext, _ Object, id uuid.UUID) (uuid.UUID, error) {
	f.calls++
	return f.objects[id], f.err
}

// TripAccesses are the trips of access that are not at AccessBase and the hidden ones (AccessNone).
func (f *fakeTrips) TripAccesses(context.Context, tenantctx.TenantContext) (map[uuid.UUID]Access, error) {
	f.calls++
	out := map[uuid.UUID]Access{}
	for id, a := range f.access {
		if a != AccessBase {
			out[id] = a
		}
	}
	for id := range f.hidden {
		out[id] = AccessNone
	}
	return out, f.err
}

// servingBase answers every guarded operation of the tag with success and lists holding the trips of trips.
type servingBase struct {
	unimplemented
	trips  []uuid.UUID
	served map[string]int
}

func (b *servingBase) hit(op string) { b.served[op]++ }

func (b *servingBase) GetTrip(context.Context, fleetapi.GetTripRequestObject) (fleetapi.GetTripResponseObject, error) {
	b.hit("getTrip")
	return fleetapi.GetTrip200JSONResponse{}, nil
}

func (b *servingBase) GetTripPlan(context.Context, fleetapi.GetTripPlanRequestObject) (fleetapi.GetTripPlanResponseObject, error) {
	b.hit("getTripPlan")
	return fleetapi.GetTripPlan200JSONResponse{}, nil
}

func (b *servingBase) ReturnTrip(context.Context, fleetapi.ReturnTripRequestObject) (fleetapi.ReturnTripResponseObject, error) {
	b.hit("returnTrip")
	return fleetapi.ReturnTrip200JSONResponse{}, nil
}

func (b *servingBase) FinishTripRoute(context.Context, fleetapi.FinishTripRouteRequestObject) (fleetapi.FinishTripRouteResponseObject, error) {
	b.hit("finishTripRoute")
	return fleetapi.FinishTripRoute200JSONResponse{}, nil
}

func (b *servingBase) CreateTripExpense(context.Context, fleetapi.CreateTripExpenseRequestObject) (fleetapi.CreateTripExpenseResponseObject, error) {
	b.hit("createTripExpense")
	return fleetapi.CreateTripExpense201JSONResponse{}, nil
}

func (b *servingBase) GetInspection(context.Context, fleetapi.GetInspectionRequestObject) (fleetapi.GetInspectionResponseObject, error) {
	b.hit("getInspection")
	return fleetapi.GetInspection200JSONResponse{}, nil
}

func (b *servingBase) SubmitInspection(context.Context, fleetapi.SubmitInspectionRequestObject) (fleetapi.SubmitInspectionResponseObject, error) {
	b.hit("submitInspection")
	return fleetapi.SubmitInspection201JSONResponse{}, nil
}

func (b *servingBase) StartTrip(context.Context, fleetapi.StartTripRequestObject) (fleetapi.StartTripResponseObject, error) {
	b.hit("startTrip")
	return fleetapi.StartTrip201JSONResponse{}, nil
}

func (b *servingBase) ReserveVehicle(context.Context, fleetapi.ReserveVehicleRequestObject) (fleetapi.ReserveVehicleResponseObject, error) {
	b.hit("reserveVehicle")
	return fleetapi.ReserveVehicle201JSONResponse{}, nil
}

func (b *servingBase) ListTrips(context.Context, fleetapi.ListTripsRequestObject) (fleetapi.ListTripsResponseObject, error) {
	b.hit("listTrips")
	out := fleetapi.ListTrips200JSONResponse{}
	for _, id := range b.trips {
		out.Body.Items = append(out.Body.Items, fleetapi.Trip{Id: id})
	}
	return out, nil
}

func (b *servingBase) ListTripPlans(context.Context, fleetapi.ListTripPlansRequestObject) (fleetapi.ListTripPlansResponseObject, error) {
	b.hit("listTripPlans")
	out := fleetapi.ListTripPlans200JSONResponse{}
	for _, id := range b.trips {
		out.Body.Items = append(out.Body.Items, fleetapi.TripPlan{Id: id})
	}
	return out, nil
}

func (b *servingBase) ListInspections(context.Context, fleetapi.ListInspectionsRequestObject) (fleetapi.ListInspectionsResponseObject, error) {
	b.hit("listInspections")
	out := fleetapi.ListInspections200JSONResponse{}
	for _, id := range b.trips {
		out.Body.Items = append(out.Body.Items, fleetapi.Inspection{Id: uuid.New(), TripId: &id})
	}
	out.Body.Items = append(out.Body.Items, fleetapi.Inspection{Id: uuid.New()})
	return out, nil
}

func (b *servingBase) ListReservations(context.Context, fleetapi.ListReservationsRequestObject) (fleetapi.ListReservationsResponseObject, error) {
	b.hit("listReservations")
	out := fleetapi.ListReservations200JSONResponse{}
	for _, id := range b.trips {
		out.Body.Items = append(out.Body.Items, fleetapi.Reservation{Id: uuid.New(), TripId: &id})
	}
	return out, nil
}

// driverCtx is the context of a member with a person (the temporary driver of the trips of the test).
func driverCtx() context.Context {
	return tenantctx.WithTenant(context.Background(), tenantctx.TenantContext{TenantID: uuid.New(), PersonID: uuid.New()})
}

func guardedServer(f *fakeTrips, trips ...uuid.UUID) (Server, *servingBase) {
	b := &servingBase{trips: trips, served: map[string]int{}}
	h := NewServer(b, &Service{})
	h.Trips = f
	return h, b
}

// wantHidden requires 404 with detail and no call of the base.
func wantHidden(t *testing.T, op string, err error, detail string, b *servingBase) {
	t.Helper()
	pe, ok := errors.AsType[*problem.Error](err)
	if !ok || pe.Code != problem.CodeNotFound || pe.Detail != detail {
		t.Errorf("%s: %v, want not_found %q", op, err, detail)
	}
	if b.served[op] != 0 {
		t.Errorf("%s reached the base", op)
	}
}

// TestGuardClosedTrip: до окна и после него рейс перевода и его объекты отвечают водителю 404 с текстом модуля рейса.
func TestGuardClosedTrip(t *testing.T) {
	t.Parallel()
	trip, insp := uuid.New(), uuid.New()
	f := &fakeTrips{access: map[uuid.UUID]Access{trip: AccessNone}, objects: map[uuid.UUID]uuid.UUID{insp: trip}}
	h, b := guardedServer(f)
	ctx := driverCtx()
	_, err := h.GetTrip(ctx, fleetapi.GetTripRequestObject{TripId: trip})
	wantHidden(t, "getTrip", err, textTripNotFound, b)
	_, err = h.GetTripPlan(ctx, fleetapi.GetTripPlanRequestObject{TripId: trip})
	wantHidden(t, "getTripPlan", err, textTripNotFound, b)
	_, err = h.ReturnTrip(ctx, fleetapi.ReturnTripRequestObject{TripId: trip})
	wantHidden(t, "returnTrip", err, textTripNotFound, b)
	_, err = h.CreateTripExpense(ctx, fleetapi.CreateTripExpenseRequestObject{TripId: trip})
	wantHidden(t, "createTripExpense", err, textTripNotFound, b)
	_, err = h.GetInspection(ctx, fleetapi.GetInspectionRequestObject{InspectionId: insp})
	wantHidden(t, "getInspection", err, "", b)
}

// TestGuardContinuation: после окна или отзыва начатого рейса — только его продолжение (D09); старт, бронь, осмотр
// выезда и решения менеджера — 404.
func TestGuardContinuation(t *testing.T) {
	t.Parallel()
	trip, insp, res := uuid.New(), uuid.New(), uuid.New()
	f := &fakeTrips{access: map[uuid.UUID]Access{trip: AccessContinuation},
		objects: map[uuid.UUID]uuid.UUID{insp: trip, res: trip}}
	h, b := guardedServer(f)
	ctx := driverCtx()
	ret, dep := fleetapi.InspectionCreateKindReturn, fleetapi.InspectionCreateKindDeparture
	for op, call := range map[string]func() error{
		"getTrip": func() error { _, err := h.GetTrip(ctx, fleetapi.GetTripRequestObject{TripId: trip}); return err },
		"returnTrip": func() error {
			_, err := h.ReturnTrip(ctx, fleetapi.ReturnTripRequestObject{TripId: trip})
			return err
		},
		"finishTripRoute": func() error {
			_, err := h.FinishTripRoute(ctx, fleetapi.FinishTripRouteRequestObject{TripId: trip})
			return err
		},
		"createTripExpense": func() error {
			_, err := h.CreateTripExpense(ctx, fleetapi.CreateTripExpenseRequestObject{TripId: trip})
			return err
		},
		"getInspection": func() error {
			_, err := h.GetInspection(ctx, fleetapi.GetInspectionRequestObject{InspectionId: insp})
			return err
		},
		"submitInspection": func() error {
			_, err := h.SubmitInspection(ctx, fleetapi.SubmitInspectionRequestObject{Body: &fleetapi.SubmitInspectionJSONRequestBody{
				Kind: ret, TripId: &trip}})
			return err
		},
	} {
		if err := call(); err != nil || b.served[op] != 1 {
			t.Errorf("%s in the continuation: %v, served %d, want the base (D09)", op, err, b.served[op])
		}
	}
	_, err := h.StartTrip(ctx, fleetapi.StartTripRequestObject{Body: &fleetapi.StartTripJSONRequestBody{ReservationId: res}})
	wantHidden(t, "startTrip", err, textReservationNotFound, b)
	_, err = h.ReserveVehicle(ctx, fleetapi.ReserveVehicleRequestObject{Body: &fleetapi.ReserveVehicleJSONRequestBody{TripId: &trip}})
	wantHidden(t, "reserveVehicle", err, textTripNotFound, b)
	b.served["submitInspection"] = 0
	_, err = h.SubmitInspection(ctx, fleetapi.SubmitInspectionRequestObject{Body: &fleetapi.SubmitInspectionJSONRequestBody{
		Kind: dep, ReservationId: &res}})
	wantHidden(t, "submitInspection", err, "", b)
	_, err = h.AssignTripVehicle(ctx, fleetapi.AssignTripVehicleRequestObject{TripId: trip})
	wantHidden(t, "assignTripVehicle", err, textTripNotFound, b)
}

// TestGuardPassesTheRest: рейс без перевода, действующее назначение, владелец и контекст без человека — к базе без
// правила пула; ошибка правила не теряется.
func TestGuardPassesTheRest(t *testing.T) {
	t.Parallel()
	trip := uuid.New()
	f := &fakeTrips{access: map[uuid.UUID]Access{trip: AccessBase}}
	h, b := guardedServer(f)
	if _, err := h.GetTrip(driverCtx(), fleetapi.GetTripRequestObject{TripId: trip}); err != nil || b.served["getTrip"] != 1 {
		t.Fatalf("active grant: %v, want the base", err)
	}
	f.calls = 0
	owner := tenantctx.WithTenant(context.Background(), tenantctx.TenantContext{TenantID: uuid.New(), PersonID: uuid.New(), Owner: true})
	if _, err := h.GetTrip(owner, fleetapi.GetTripRequestObject{TripId: trip}); err != nil || f.calls != 0 {
		t.Fatalf("the owner: %v, %d calls of the guard, want none", err, f.calls)
	}
	f.err = errors.New("tenant DB unavailable")
	if _, err := h.GetTrip(driverCtx(), fleetapi.GetTripRequestObject{TripId: trip}); err == nil {
		t.Fatal("a failed guard let the request through")
	}
}

// answer is the success answer v of type T (else the test fails).
func answer[T any](t *testing.T, v any) T {
	t.Helper()
	out, ok := v.(T)
	if !ok {
		t.Fatalf("answer %#v, want %T", v, out)
	}
	return out
}

// oneTrip requires a list answer of the open trip only (ids — the trips of its items).
func oneTrip(t *testing.T, op string, err error, ids []*uuid.UUID, want uuid.UUID) {
	t.Helper()
	if err != nil || len(ids) != 1 || ids[0] == nil || *ids[0] != want {
		t.Errorf("%s: %v %v, want the item of the open trip only", op, err, ids)
	}
}

// TestGuardLists: списки рейсов, планов, осмотров и броней водителя без рейсов перевода, закрытых ему сейчас.
func TestGuardLists(t *testing.T) {
	t.Parallel()
	open, closed := uuid.New(), uuid.New()
	h, _ := guardedServer(&fakeTrips{hidden: map[uuid.UUID]bool{closed: true}}, open, closed)
	ctx := driverCtx()
	trips, err := h.ListTrips(ctx, fleetapi.ListTripsRequestObject{})
	var ids []*uuid.UUID
	for _, it := range answer[fleetapi.ListTrips200JSONResponse](t, trips).Body.Items {
		ids = append(ids, &it.Id)
	}
	oneTrip(t, "listTrips", err, ids, open)
	plans, err := h.ListTripPlans(ctx, fleetapi.ListTripPlansRequestObject{})
	ids = nil
	for _, it := range answer[fleetapi.ListTripPlans200JSONResponse](t, plans).Body.Items {
		ids = append(ids, &it.Id)
	}
	oneTrip(t, "listTripPlans", err, ids, open)
	insp, err := h.ListInspections(ctx, fleetapi.ListInspectionsRequestObject{})
	if got := answer[fleetapi.ListInspections200JSONResponse](t, insp).Body.Items; err != nil || len(got) != 2 {
		t.Errorf("listInspections: %v %+v, want the inspection of the open trip and the one without a trip", err, got)
	}
	res, err := h.ListReservations(ctx, fleetapi.ListReservationsRequestObject{})
	ids = nil
	for _, it := range answer[fleetapi.ListReservations200JSONResponse](t, res).Body.Items {
		ids = append(ids, it.TripId)
	}
	oneTrip(t, "listReservations", err, ids, open)
}

// TestGuardListsContinuation (возврат 3, ревью): в продолжении рейс, его план, осмотры и дефекты остаются в списках
// (их чтение — продолжение, D09), а бронь рейса — нет: getReservation в продолжении 404, список не раскрывает её.
func TestGuardListsContinuation(t *testing.T) {
	t.Parallel()
	open, closing := uuid.New(), uuid.New()
	h, _ := guardedServer(&fakeTrips{access: map[uuid.UUID]Access{closing: AccessContinuation}}, open, closing)
	ctx := driverCtx()
	trips, err := h.ListTrips(ctx, fleetapi.ListTripsRequestObject{})
	if got := answer[fleetapi.ListTrips200JSONResponse](t, trips).Body.Items; err != nil || len(got) != 2 {
		t.Errorf("listTrips in the continuation: %v %+v, want both trips", err, got)
	}
	plans, err := h.ListTripPlans(ctx, fleetapi.ListTripPlansRequestObject{})
	if got := answer[fleetapi.ListTripPlans200JSONResponse](t, plans).Body.Items; err != nil || len(got) != 2 {
		t.Errorf("listTripPlans in the continuation: %v %+v, want both plans", err, got)
	}
	insp, err := h.ListInspections(ctx, fleetapi.ListInspectionsRequestObject{})
	if got := answer[fleetapi.ListInspections200JSONResponse](t, insp).Body.Items; err != nil || len(got) != 3 {
		t.Errorf("listInspections in the continuation: %v %+v, want all three", err, got)
	}
	res, err := h.ListReservations(ctx, fleetapi.ListReservationsRequestObject{})
	var ids []*uuid.UUID
	for _, it := range answer[fleetapi.ListReservations200JSONResponse](t, res).Body.Items {
		ids = append(ids, it.TripId)
	}
	oneTrip(t, "listReservations in the continuation", err, ids, open)
}

// pagingBase pages the reservations of its trips as the module does: a keyset cursor (the index of the next item), the
// limit of the request (default 50), nextCursor while items are left.
type pagingBase struct {
	unimplemented
	trips []uuid.UUID
	calls int
}

func (b *pagingBase) ListReservations(_ context.Context, r fleetapi.ListReservationsRequestObject) (fleetapi.ListReservationsResponseObject, error) {
	b.calls++
	from, limit := 0, 50
	if r.Params.Cursor != nil {
		from = int((*r.Params.Cursor)[0] - 'a')
	}
	if r.Params.Limit != nil {
		limit = *r.Params.Limit
	}
	out := fleetapi.ListReservations200JSONResponse{}
	for i := from; i < len(b.trips) && i < from+limit; i++ {
		out.Body.Items = append(out.Body.Items, fleetapi.Reservation{Id: uuid.New(), TripId: &b.trips[i]})
	}
	if from+limit < len(b.trips) {
		next := string(rune('a' + from + limit))
		out.Body.NextCursor = &next
	}
	return out, nil
}

// TestGuardListsBeforeThePagination (возврат 3, ревью): отбор списка — до пагинации. Страница без закрытых водителю
// броней добирается у базы с её курсора, короче limit она только в конце списка, и по курсорам страниц проходят все
// открытые брони ровно один раз.
func TestGuardListsBeforeThePagination(t *testing.T) {
	t.Parallel()
	trips := make([]uuid.UUID, 7)
	for i := range trips {
		trips[i] = uuid.New()
	}
	f := &fakeTrips{access: map[uuid.UUID]Access{trips[1]: AccessNone, trips[2]: AccessNone, trips[4]: AccessContinuation}}
	b := &pagingBase{trips: trips}
	h := NewServer(b, &Service{})
	h.Trips = f
	ctx := driverCtx()
	want := []uuid.UUID{trips[0], trips[3], trips[5], trips[6]}
	var got []uuid.UUID
	var cursor *string
	limit := 2
	for page := range 5 {
		res, err := h.ListReservations(ctx, fleetapi.ListReservationsRequestObject{
			Params: fleetapi.ListReservationsParams{Cursor: cursor, Limit: &limit}})
		body := answer[fleetapi.ListReservations200JSONResponse](t, res).Body
		if err != nil {
			t.Fatal(err)
		}
		if body.NextCursor != nil && len(body.Items) != limit {
			t.Errorf("page %d: %d items with a next cursor, want a full page of %d", page, len(body.Items), limit)
		}
		for _, it := range body.Items {
			got = append(got, *it.TripId)
		}
		if cursor = body.NextCursor; cursor == nil {
			break
		}
	}
	if !slices.Equal(got, want) {
		t.Fatalf("pages %v, want every open reservation once %v", got, want)
	}
}
