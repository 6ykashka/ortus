package inspections

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// vehiclesBase is a base server of the tag that answers listVehicles (as W2.02 will).
type vehiclesBase struct{ unimplemented }

func (vehiclesBase) ListVehicles(context.Context, fleetapi.ListVehiclesRequestObject) (fleetapi.ListVehiclesResponseObject, error) {
	return fleetapi.ListVehicles200JSONResponse{}, nil
}

// The overlay serves the eight inspection operations and the assignment of a defect (W2.46) and leaves the rest of the tag to its base: without a base
// they answer 501 like a tag without a server; reviewInspection is outside the card of W2.04.
func TestServerOverlay(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	s := NewServer(nil, &Service{})
	if _, err := s.ListVehicles(ctx, fleetapi.ListVehiclesRequestObject{}); !problem.Is(err, problem.CodeNotImplemented) {
		t.Errorf("listVehicles without a base: %v", err)
	}
	if _, err := s.ReviewInspection(ctx, fleetapi.ReviewInspectionRequestObject{}); !problem.Is(err, problem.CodeNotImplemented) {
		t.Errorf("reviewInspection: %v", err)
	}
	with := NewServer(vehiclesBase{}, &Service{})
	if r, err := with.ListVehicles(ctx, fleetapi.ListVehiclesRequestObject{}); err != nil || r == nil {
		t.Errorf("listVehicles of the base: %v %v", r, err)
	}
	// The operations of the module answer themselves: without the tenant of the gateway the tenant does not exist.
	id := uuid.New()
	calls := map[string]func() error{
		"getInspectionChecklist": func() error {
			_, err := s.GetInspectionChecklist(ctx, fleetapi.GetInspectionChecklistRequestObject{Params: fleetapi.GetInspectionChecklistParams{VehicleId: id, Kind: "departure"}})
			return err
		},
		"listInspections": func() error { _, err := s.ListInspections(ctx, fleetapi.ListInspectionsRequestObject{}); return err },
		"getInspection": func() error {
			_, err := s.GetInspection(ctx, fleetapi.GetInspectionRequestObject{InspectionId: id})
			return err
		},
		"submitInspection": func() error {
			_, err := s.SubmitInspection(ctx, fleetapi.SubmitInspectionRequestObject{Body: &fleetapi.SubmitInspectionJSONRequestBody{}})
			return err
		},
		"listInspectionDefects": func() error {
			_, err := s.ListInspectionDefects(ctx, fleetapi.ListInspectionDefectsRequestObject{})
			return err
		},
		"getInspectionDefect": func() error {
			_, err := s.GetInspectionDefect(ctx, fleetapi.GetInspectionDefectRequestObject{DefectId: id})
			return err
		},
		"decideInspectionDefect": func() error {
			_, err := s.DecideInspectionDefect(ctx, fleetapi.DecideInspectionDefectRequestObject{DefectId: id, Body: &fleetapi.DefectDecision{Decision: "allow_departure"}})
			return err
		},
		"assignInspectionDefect": func() error { // W2.46 (D-29 комплекта)
			_, err := s.AssignInspectionDefect(ctx, fleetapi.AssignInspectionDefectRequestObject{DefectId: id,
				Body: &fleetapi.DefectAssignment{AssigneeMemberId: id, DueAt: time.Now().Add(time.Hour)}})
			return err
		},
	}
	for name, call := range calls {
		if err := call(); !problem.Is(err, problem.CodeNotFound) {
			t.Errorf("%s without a tenant: %v, want not_found", name, err)
		}
	}
}

// Parameters and bodies the strict server lets through: a missing body, a page size out of 1…200, an unknown
// state of the queue (400 malformed_request, as the other modules).
func TestServerRejectsRequests(t *testing.T) {
	t.Parallel()
	ctx := tenantctx.WithTenant(t.Context(), tenantctx.TenantContext{TenantID: uuid.New(), PersonID: uuid.New()})
	s := NewServer(nil, &Service{})
	zero, big := 0, 201
	cases := map[string]func() error{
		"submit without a body": func() error {
			_, err := s.SubmitInspection(ctx, fleetapi.SubmitInspectionRequestObject{})
			return err
		},
		"decide without a body": func() error {
			_, err := s.DecideInspectionDefect(ctx, fleetapi.DecideInspectionDefectRequestObject{DefectId: uuid.New()})
			return err
		},
		"assign without a body": func() error {
			_, err := s.AssignInspectionDefect(ctx, fleetapi.AssignInspectionDefectRequestObject{DefectId: uuid.New()})
			return err
		},
		"limit 0": func() error {
			_, err := s.ListInspections(ctx, fleetapi.ListInspectionsRequestObject{Params: fleetapi.ListInspectionsParams{Limit: &zero}})
			return err
		},
		"limit 201": func() error {
			_, err := s.ListInspectionDefects(ctx, fleetapi.ListInspectionDefectsRequestObject{Params: fleetapi.ListInspectionDefectsParams{Limit: &big}})
			return err
		},
		"unknown state": func() error {
			states := []fleetapi.ListInspectionDefectsParamsState{"lost"}
			_, err := s.ListInspectionDefects(ctx, fleetapi.ListInspectionDefectsRequestObject{Params: fleetapi.ListInspectionDefectsParams{State: &states}})
			return err
		},
	}
	for name, call := range cases {
		if err := call(); !problem.Is(err, problem.CodeMalformedRequest) {
			t.Errorf("%s: %v, want malformed_request", name, err)
		}
	}
}
