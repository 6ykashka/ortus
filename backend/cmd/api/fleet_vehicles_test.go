package main

import (
	"context"
	"testing"
	"time"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// fleetW242 are the operations of the company history of a vehicle (W2.42, contract 0.6.1-stage2), served by the
// vehicles of W2.02 embedded in the base of the tag.
var fleetW242 = []string{"listVehicleAssignments", "moveVehicle"}

// The operations of W2.42 reach the module of the vehicles: without a tenant context they answer its 404, not 501.
func TestFleetVehicleAssignmentsRoutes(t *testing.T) {
	t.Parallel()
	var s fleetapi.StrictServerInterface = newFleetServer(nil, nil, time.Now)
	ctx := context.Background()
	ours := map[string]func() error{
		"ListVehicleAssignments": func() error {
			_, err := s.ListVehicleAssignments(ctx, fleetapi.ListVehicleAssignmentsRequestObject{})
			return err
		},
		"MoveVehicle": func() error { _, err := s.MoveVehicle(ctx, fleetapi.MoveVehicleRequestObject{}); return err },
	}
	for name, call := range ours {
		if err := call(); !problem.Is(err, problem.CodeNotFound) {
			t.Errorf("%s: %v, want not_found of its module", name, err)
		}
	}
	if len(ours) != len(fleetW242) {
		t.Errorf("W2.42 has %d operations, the test calls %d", len(fleetW242), len(ours))
	}
}
