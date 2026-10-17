package trips

import (
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/domain/fleetrules"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// Problem codes of the module (api/errors.yaml).
const (
	codeValidation        = "validation_failed"
	codeInvalidTransition = "invalid_transition"
	codeBlocking          = "blocking_defect_open"
	codeExpired           = "reservation_expired"
	codeOdometer          = "odometer_decrease"
	codeUnavailable       = "resources_unavailable"
	codeRevisionRequired  = "revision_required"
	codeRevisionMismatch  = "revision_mismatch"
	codeIdemInProgress    = "idempotency_in_progress"
)

// Texts of the answers: the mock W2.00 (adapter/src/msw/fleet/trips.ts) where it has one.
const (
	textTripNotFound        = "Рейс не найден."
	textNotStarted          = "Рейс ещё не начат."
	textReservationNotFound = "Бронь не найдена."
	textReservationNeeded   = "Укажите бронь рейса."
	textInspectionNeeded    = "Нужен осмотр перед выездом этого рейса."
	textReturnInspection    = "Укажите осмотр при сдаче."
	textReturnAction        = "Неизвестное действие со сменой."
	textReservationUsed     = "Бронь уже использована или снята."
	textExpired             = "Бронь истекла. Забронируйте машину снова."
	textBlocked             = "Выезд заблокирован: дефект на проверке менеджера."
	textDriverBusy          = "Водитель уже в другом рейсе."
	textDriverOnlyStart     = "Выезд оформляет водитель рейса."
	textDriverOnlyShift     = "Рейс ведёт водитель рейса."
	textNotOnRoute          = "Рейс ещё не в пути."
	textNotReturning        = "Сдать машину можно после «Завершить рейс»."
	textReturnNotDone       = "Сдача не завершена: нужен последний осмотр при сдаче."
	textReworkInspection    = "Сдача не завершена: после доработки нужен новый осмотр при сдаче."
	textStale               = "Данные изменились. Обновите страницу и повторите."
)

// States of fleet.trips.state the commands of the module look at.
const (
	stateInspection   = "inspection"
	stateDefectReview = "defect_review"
	stateOnRoute      = "on_route"
	stateReturning    = "returning"
	stateSubmitted    = "submitted"
	stateRework       = "rework"
	stateAccepted     = "accepted"
)

// Kinds and states of fleet.inspections.
const (
	kindDeparture  = "departure"
	kindReturn     = "return"
	inspectBlocked = "blocked"
)

// statuses is Trip.status of the 0.1 Trip: the projection of a started trip (TRIP_STATUS of the mock).
var statuses = map[string]fleetapi.TripStatus{
	stateOnRoute:   fleetapi.TripStatusInProgress,
	stateReturning: fleetapi.TripStatusInProgress,
	stateRework:    fleetapi.TripStatusInProgress,
	stateSubmitted: fleetapi.TripStatusReturnedPendingReview,
	stateAccepted:  fleetapi.TripStatusApproved,
}

// tripStatus is the Trip.status of a trip in state; false before the start.
func tripStatus(state string) (fleetapi.TripStatus, bool) {
	s, ok := statuses[state]
	return s, ok
}

func invalid(detail string) *problem.Error { return problem.New(codeValidation, detail) }

// checkStart checks the body of startTrip.
func checkStart(b *fleetapi.TripStart) error {
	switch {
	case b == nil:
		return problem.New(problem.CodeMalformedRequest, "")
	case b.ReservationId == uuid.Nil:
		return invalid(textReservationNeeded)
	case b.DepartureInspectionId == uuid.Nil:
		return invalid(textInspectionNeeded)
	}
	return nil
}

// checkReturn checks the body of returnTrip.
func checkReturn(b *fleetapi.TripReturn) error {
	switch {
	case b == nil:
		return problem.New(problem.CodeMalformedRequest, "")
	case b.Action != fleetapi.TripReturnActionReturn:
		return invalid(textReturnAction)
	case b.ReturnInspectionId == uuid.Nil:
		return invalid(textReturnInspection)
	}
	return nil
}

// tripRow is a trip a command locked.
type tripRow struct {
	id, unit                           uuid.UUID
	number, state                      string
	vehicle, driver, bundle, departure *uuid.UUID
	ret                                *uuid.UUID
	revision                           int64
}

// inspRow is an inspection a command locked.
type inspRow struct {
	id, trip, vehicle uuid.UUID
	kind, state       string
	odometer          float64
	submittedAt       time.Time
}

func same(p *uuid.UUID, id uuid.UUID) bool { return p != nil && *p == id }

// startable checks that the trip may start by reservation with the departure inspection insp (nil: none such)
// before the hold is consumed; blocking — an open blocking defect of the trip or its vehicle (AC-04).
func (t tripRow) startable(reservation uuid.UUID, insp *inspRow, blocking bool) error {
	switch {
	case !same(t.bundle, reservation):
		return problem.New(codeInvalidTransition, textReservationUsed)
	case insp == nil || insp.trip != t.id || insp.kind != kindDeparture || !same(t.departure, insp.id) ||
		!same(t.vehicle, insp.vehicle):
		return invalid(textInspectionNeeded)
	case blocking || insp.state == inspectBlocked || t.state == stateDefectReview:
		return problem.New(codeBlocking, textBlocked)
	case t.state != stateInspection:
		return problem.New(codeInvalidTransition, textReservationUsed)
	}
	return nil
}

// finishable checks «Завершить рейс»: only a trip on the route.
func (t tripRow) finishable() error {
	if t.state != stateOnRoute {
		return problem.New(codeInvalidTransition, textNotOnRoute)
	}
	return nil
}

// returnable checks «Сдать машину» with the return inspection insp (nil: none such): the latest return inspection of
// the trip and of its vehicle, after the rework (reworkSince: the latest review that sent the shift back), with an
// odometer not below the departure (startKm, LOG-09).
func (t tripRow) returnable(insp *inspRow, startKm float64, reworkSince *time.Time) error {
	switch {
	case t.state != stateReturning && t.state != stateRework:
		return problem.New(codeInvalidTransition, textNotReturning)
	case insp == nil || insp.trip != t.id || insp.kind != kindReturn || !same(t.ret, insp.id) || !same(t.vehicle, insp.vehicle):
		return invalid(textReturnNotDone)
	case t.state == stateRework && reworkSince != nil && !insp.submittedAt.After(*reworkSince):
		return invalid(textReworkInspection)
	case insp.odometer < startKm:
		return problem.New(codeOdometer, fleetrules.OdoError(strconv.FormatFloat(insp.odometer, 'f', -1, 64), startKm))
	}
	return nil
}

// tripOf is the 0.1 Trip of a plan: the projection of the same row from the start on (same id and revision).
func tripOf(p fleetapi.TripPlan) (fleetapi.Trip, bool) {
	status, ok := tripStatus(string(p.State))
	if !ok || p.VehicleId == nil || p.DriverMemberId == nil || p.DepartureInspectionId == nil || p.StartedAt == nil {
		return fleetapi.Trip{}, false
	}
	return fleetapi.Trip{
		Id: p.Id, VehicleId: *p.VehicleId, DriverMemberId: *p.DriverMemberId, OrgUnitId: p.OrgUnitId,
		DepartureInspectionId: *p.DepartureInspectionId, ReturnInspectionId: p.ReturnInspectionId, Status: status,
		StartedAt: *p.StartedAt, ReturnedAt: p.ReturnedAt, Revision: p.Revision,
	}, true
}

// startedTitle is the notification of the managers about a started trip (the mock: «Рейс {номер} начат · {машина}»).
func startedTitle(number, vehicle string) string {
	return strings.TrimSuffix(strings.TrimSpace("Рейс "+number+" начат · "+vehicle), " ·")
}

// submittedTitle is the notification of the managers about a submitted shift (the mock W2.00, returnTrip).
func submittedTitle(number, vehicle, plate string) string {
	return strings.TrimSuffix(strings.TrimSpace("Смена "+number+" сдана на приёмку · "+strings.TrimSpace(vehicle+" "+plate)), " ·")
}
