package main

import (
	"time"

	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/routes"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// routesServer is the trip planning of the tag Fleet (W2.03, S2-13): createTripPlan, getTripPlan, listTripPlans and
// assignTripVehicle, embedded in fleetServer.
type routesServer = routes.Server

// newRoutesServer wires the trip planning over the tenant pools, the evaluator of W1.04 and the clock of the
// application (APP_FIXED_NOW outside prod), as the reservations of W2.02: the holds of both modules share it.
func newRoutesServer(pools *tenantctx.Pools, ev *authz.Evaluator, now func() time.Time) *routesServer {
	return &routes.Server{Pools: pools, Evaluator: ev, Now: now}
}
