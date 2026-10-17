package main

import (
	"context"
	"slices"
	"testing"
	"time"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// Operations of the tag Fleet of W2.03 (trip planning, S2-13) and the operations the base of the tag serves
// (fleetServer: W2.02 and W2.03).
var (
	fleetW203 = []string{"listTripPlans", "createTripPlan", "getTripPlan", "assignTripVehicle"}
	fleetBase = slices.Concat(fleetW202, fleetW203)
)

// The operations of W2.03 reach the module fleet/routes in the base of the tag: without a tenant context they answer
// the 404 of the module, not 501.
func TestFleetRoutesServerRoutes(t *testing.T) {
	t.Parallel()
	var s fleetapi.StrictServerInterface = newFleetServer(nil, nil, time.Now)
	ctx := context.Background()
	ours := map[string]func() error{
		"ListTripPlans": func() error { _, err := s.ListTripPlans(ctx, fleetapi.ListTripPlansRequestObject{}); return err },
		"CreateTripPlan": func() error {
			_, err := s.CreateTripPlan(ctx, fleetapi.CreateTripPlanRequestObject{})
			return err
		},
		"GetTripPlan": func() error { _, err := s.GetTripPlan(ctx, fleetapi.GetTripPlanRequestObject{}); return err },
		"AssignTripVehicle": func() error {
			_, err := s.AssignTripVehicle(ctx, fleetapi.AssignTripVehicleRequestObject{})
			return err
		},
	}
	for name, call := range ours {
		if err := call(); !problem.Is(err, problem.CodeNotFound) {
			t.Errorf("%s: %v, want not_found of its module", name, err)
		}
	}
	if len(ours) != len(fleetW203) {
		t.Errorf("W2.03 has %d operations, the test calls %d", len(fleetW203), len(ours))
	}
	pending := fleetPendingOps(newFleet(nil, authz.New(nil, nil, time.Now), nil, time.Now))
	for _, id := range fleetW203 {
		if pending[id] {
			t.Errorf("%s pending in the composed server of main, want served by fleet/routes", id)
		}
	}
}
