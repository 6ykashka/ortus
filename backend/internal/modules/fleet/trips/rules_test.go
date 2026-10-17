package trips

import (
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

func wantProblem(t *testing.T, err error, code, detail string) {
	t.Helper()
	pe, ok := errors.AsType[*problem.Error](err)
	if !ok {
		t.Fatalf("error %v (%T), want %s %q", err, err, code, detail)
	}
	if pe.Code != code || (detail != "" && pe.Detail != detail) {
		t.Fatalf("error %s %q, want %s %q", pe.Code, pe.Detail, code, detail)
	}
}

func TestTripStatus(t *testing.T) {
	t.Parallel()
	cases := map[string]fleetapi.TripStatus{
		"on_route":  fleetapi.TripStatusInProgress,
		"returning": fleetapi.TripStatusInProgress,
		"rework":    fleetapi.TripStatusInProgress,
		"submitted": fleetapi.TripStatusReturnedPendingReview,
		"accepted":  fleetapi.TripStatusApproved,
	}
	for state, want := range cases {
		got, ok := tripStatus(state)
		if !ok || got != want {
			t.Errorf("tripStatus(%s) = %s, %v; want %s", state, got, ok, want)
		}
	}
	for _, state := range []string{"planned", "assigned", "inspection", "defect_review", "cancelled", "?"} {
		if _, ok := tripStatus(state); ok {
			t.Errorf("tripStatus(%s): a trip before the start has no Trip 0.1", state)
		}
	}
}

func TestCheckStart(t *testing.T) {
	t.Parallel()
	wantProblem(t, checkStart(nil), problem.CodeMalformedRequest, "")
	wantProblem(t, checkStart(&fleetapi.TripStart{DepartureInspectionId: uuid.New()}), codeValidation, textReservationNeeded)
	wantProblem(t, checkStart(&fleetapi.TripStart{ReservationId: uuid.New()}), codeValidation, textInspectionNeeded)
	if err := checkStart(&fleetapi.TripStart{ReservationId: uuid.New(), DepartureInspectionId: uuid.New()}); err != nil {
		t.Fatal(err)
	}
}

func TestCheckReturn(t *testing.T) {
	t.Parallel()
	wantProblem(t, checkReturn(nil), problem.CodeMalformedRequest, "")
	wantProblem(t, checkReturn(&fleetapi.TripReturn{Action: "return"}), codeValidation, textReturnInspection)
	wantProblem(t, checkReturn(&fleetapi.TripReturn{Action: "close", ReturnInspectionId: uuid.New()}), codeValidation, "")
	if err := checkReturn(&fleetapi.TripReturn{Action: "return", ReturnInspectionId: uuid.New()}); err != nil {
		t.Fatal(err)
	}
}

// ready is a trip waiting for its start: the departure inspection is in, the reservation is held.
func ready() (tripRow, uuid.UUID, *inspRow) {
	trip, vehicle, bundle, dep := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	t := tripRow{id: trip, state: "inspection", vehicle: &vehicle, bundle: &bundle, departure: &dep}
	return t, bundle, &inspRow{id: dep, trip: trip, vehicle: vehicle, kind: "departure", state: "submitted"}
}

func TestStartable(t *testing.T) {
	t.Parallel()
	tr, bundle, insp := ready()
	if err := tr.startable(bundle, insp, false); err != nil {
		t.Fatalf("ready trip: %v", err)
	}
	approved := *insp
	approved.state = "approved"
	if err := tr.startable(bundle, &approved, false); err != nil {
		t.Fatalf("approved inspection (allowed departure): %v", err)
	}
	wantProblem(t, tr.startable(uuid.New(), insp, false), codeInvalidTransition, textReservationUsed)
	wantProblem(t, tr.startable(bundle, nil, false), codeValidation, textInspectionNeeded)
	other := *insp
	other.trip = uuid.New()
	wantProblem(t, tr.startable(bundle, &other, false), codeValidation, textInspectionNeeded)
	ret := *insp
	ret.kind = "return"
	wantProblem(t, tr.startable(bundle, &ret, false), codeValidation, textInspectionNeeded)
	older := *insp
	older.id = uuid.New()
	wantProblem(t, tr.startable(bundle, &older, false), codeValidation, textInspectionNeeded)
	wantProblem(t, tr.startable(bundle, insp, true), codeBlocking, textBlocked)
	blocked := *insp
	blocked.state = "blocked"
	wantProblem(t, tr.startable(bundle, &blocked, false), codeBlocking, textBlocked)
	review := tr
	review.state = "defect_review"
	wantProblem(t, review.startable(bundle, insp, false), codeBlocking, textBlocked)
	started := tr
	started.state = "on_route"
	wantProblem(t, started.startable(bundle, insp, false), codeInvalidTransition, textReservationUsed)
	none := tr
	none.bundle = nil
	wantProblem(t, none.startable(bundle, insp, false), codeInvalidTransition, textReservationUsed)
}

func TestFinishable(t *testing.T) {
	t.Parallel()
	tr, _, _ := ready()
	tr.state = "on_route"
	if err := tr.finishable(); err != nil {
		t.Fatal(err)
	}
	for _, s := range []string{"inspection", "returning", "submitted", "rework", "accepted"} {
		tr.state = s
		wantProblem(t, tr.finishable(), codeInvalidTransition, textNotOnRoute)
	}
}

func TestReturnable(t *testing.T) {
	t.Parallel()
	tr, _, _ := ready()
	tr.state = "returning"
	ret := uuid.New()
	tr.ret = &ret
	insp := &inspRow{id: ret, trip: tr.id, vehicle: *tr.vehicle, kind: "return", state: "submitted", odometer: 84420,
		submittedAt: time.Date(2026, 10, 1, 16, 0, 0, 0, time.UTC)}
	if err := tr.returnable(insp, 84370, nil); err != nil {
		t.Fatalf("returning trip: %v", err)
	}
	equal := *insp
	equal.odometer = 84370
	if err := tr.returnable(&equal, 84370, nil); err != nil {
		t.Fatalf("odometer equal to the start: %v", err)
	}
	less := *insp
	less.odometer = 84369
	wantProblem(t, tr.returnable(&less, 84370, nil), codeOdometer, "Пробег не может быть меньше 84 370 км")
	wantProblem(t, tr.returnable(nil, 84370, nil), codeValidation, textReturnNotDone)
	older := *insp
	older.id = uuid.New()
	wantProblem(t, tr.returnable(&older, 84370, nil), codeValidation, textReturnNotDone)
	dep := *insp
	dep.kind = "departure"
	wantProblem(t, tr.returnable(&dep, 84370, nil), codeValidation, textReturnNotDone)
	foreign := *insp
	foreign.vehicle = uuid.New()
	wantProblem(t, tr.returnable(&foreign, 84370, nil), codeValidation, textReturnNotDone)

	rework := tr
	rework.state = "rework"
	after := insp.submittedAt.Add(-time.Minute)
	if err := rework.returnable(insp, 84370, &after); err != nil {
		t.Fatalf("new return inspection after the rework: %v", err)
	}
	before := insp.submittedAt.Add(time.Minute)
	wantProblem(t, rework.returnable(insp, 84370, &before), codeValidation, textReworkInspection)

	for _, s := range []string{"inspection", "on_route", "submitted", "accepted"} {
		other := tr
		other.state = s
		wantProblem(t, other.returnable(insp, 84370, nil), codeInvalidTransition, textNotReturning)
	}
}

func TestTripOf(t *testing.T) {
	t.Parallel()
	vehicle, driver, dep, ret := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	started := time.Date(2026, 10, 1, 9, 5, 0, 0, time.UTC)
	returned := started.Add(4 * time.Hour)
	p := fleetapi.TripPlan{Id: uuid.New(), OrgUnitId: uuid.New(), State: "submitted", VehicleId: &vehicle,
		DriverMemberId: &driver, DepartureInspectionId: &dep, ReturnInspectionId: &ret, StartedAt: &started,
		ReturnedAt: &returned, Revision: 7}
	got, ok := tripOf(p)
	if !ok {
		t.Fatal("a submitted trip has a Trip 0.1")
	}
	want := fleetapi.Trip{Id: p.Id, OrgUnitId: p.OrgUnitId, VehicleId: vehicle, DriverMemberId: driver,
		DepartureInspectionId: dep, ReturnInspectionId: &ret, Status: fleetapi.TripStatusReturnedPendingReview,
		StartedAt: started, ReturnedAt: &returned, Revision: 7}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("tripOf = %+v, want %+v", got, want)
	}
	p.State = "inspection"
	if _, ok := tripOf(p); ok {
		t.Fatal("a trip before the start has no Trip 0.1")
	}
	p.State, p.StartedAt = "on_route", nil
	if _, ok := tripOf(p); ok {
		t.Fatal("a trip without startedAt has no Trip 0.1")
	}
}

func TestNoticeTitles(t *testing.T) {
	t.Parallel()
	if got := startedTitle("Р-208", "ГАЗель Next"); got != "Рейс Р-208 начат · ГАЗель Next" {
		t.Errorf("startedTitle = %q", got)
	}
	if got := startedTitle("Р-208", ""); got != "Рейс Р-208 начат" {
		t.Errorf("startedTitle without a vehicle = %q", got)
	}
	if got := submittedTitle("Р-208", "ГАЗель Next", "А 412 МР 77"); got != "Смена Р-208 сдана на приёмку · ГАЗель Next А 412 МР 77" {
		t.Errorf("submittedTitle = %q", got)
	}
}
