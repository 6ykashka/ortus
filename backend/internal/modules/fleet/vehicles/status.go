package vehicles

import (
	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/domain/fleetrules"
)

// Service states of a vehicle (fleet.vehicles.service_state).
const (
	ServiceOK           = "ok"
	ServiceMaintenance  = "maintenance"
	ServiceOutOfService = "out_of_service"
)

// States of a blocking defect that keep the vehicle from leaving (fleet.defects.state).
const (
	DefectOpen      = "open"
	DefectInReview  = "in_review"
	DefectConfirmed = "confirmed_out_of_service"
)

// States of a trip that hold its vehicle (fleet.trips.state).
const (
	TripAssigned     = "assigned"
	TripInspection   = "inspection"
	TripDefectReview = "defect_review"
	TripOnRoute      = "on_route"
	TripReturning    = "returning"
	TripSubmitted    = "submitted"
	TripRework       = "rework"
)

// Notes of the status the server derives (Vehicle.statusNote: never free text of a driver).
const (
	NoteDefectInReview = "критический дефект на проверке"
	NoteOutOfService   = "неисправность подтверждена"
)

// State is what the status of a vehicle is derived from: its service state, its worst blocking defect, the trip
// that holds it and its live hold (a hold before its end or a confirmed reservation).
type State struct {
	Service     string // ok | maintenance | out_of_service
	ServiceNote string
	Defect      string     // "" | open | in_review | confirmed_out_of_service (blocking only)
	TripID      *uuid.UUID // the trip that holds the vehicle, if any
	TripState   string
	Held        bool       // a live hold or a confirmed reservation of the vehicle
	HoldTripID  *uuid.UUID // the trip of that hold (source fleet.trip)
}

// Status derives Vehicle.status (analysis 03 §17.3) with its note and the trip the vehicle is held for: maintenance
// and a blocking defect first (Недоступна), then the trip of the vehicle (on the route — in_use, waiting for the
// acceptance — blocked, planned with the vehicle — reserved), then a live hold (reserved), else available.
func (s State) Status() (status fleetapi.VehicleStatus, note string, heldBy *uuid.UUID) {
	switch {
	case s.Service == ServiceOutOfService && s.ServiceNote == "":
		return fleetapi.VehicleStatusMaintenance, NoteOutOfService, nil
	case s.Service != "" && s.Service != ServiceOK:
		return fleetapi.VehicleStatusMaintenance, s.ServiceNote, nil
	case s.Defect == DefectConfirmed:
		return fleetapi.VehicleStatusMaintenance, NoteOutOfService, nil
	case s.Defect == DefectOpen, s.Defect == DefectInReview:
		return fleetapi.VehicleStatusMaintenance, NoteDefectInReview, nil
	}
	switch s.TripState {
	case TripOnRoute, TripReturning:
		return fleetapi.VehicleStatusInUse, "", nil
	case TripSubmitted, TripRework:
		return fleetapi.VehicleStatusBlocked, "", nil
	case TripAssigned, TripInspection, TripDefectReview:
		return fleetapi.VehicleStatusReserved, "", s.TripID
	}
	if s.Held {
		return fleetapi.VehicleStatusReserved, "", s.HoldTripID
	}
	return fleetapi.VehicleStatusAvailable, "", nil
}

// ruleStates are the states of the prototype the rules of W2.01 know (free reserved on_route review unavailable).
var ruleStates = map[fleetapi.VehicleStatus]fleetrules.VehicleState{
	fleetapi.VehicleStatusAvailable:   fleetrules.VehicleFree,
	fleetapi.VehicleStatusReserved:    fleetrules.VehicleReserved,
	fleetapi.VehicleStatusInUse:       fleetrules.VehicleOnRoute,
	fleetapi.VehicleStatusBlocked:     fleetrules.VehicleReview,
	fleetapi.VehicleStatusMaintenance: fleetrules.VehicleUnavailable,
}
