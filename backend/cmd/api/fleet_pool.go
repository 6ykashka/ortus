package main

import (
	"time"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/pool"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
)

// fleetPool overlays the driver pool of W2.07 on base, the server of the tag Fleet the other modules build (nil:
// their operations answer 501): the publications of the releasing company, the catalog, the requests and the
// decisions with the temporary assignment (fleet/pool). The overlay passes reserveVehicle, releaseReservation,
// startTrip and reviewTrip down unchanged and settles the pool of the tenant after them (the grant of a temporary
// driver opens at the start of his trip and closes at its acceptance, Q-W2.51-15); the worker settles it on its
// schedule too. The requesting logists and the owners (owner bindings of the control DB) learn the decision through
// the inbox port (W1.10); the clock is the one of the application (APP_FIXED_NOW outside prod).
func fleetPool(base fleetapi.StrictServerInterface, pools pool.Pools, ev *authz.Evaluator, control inbox.ControlDB, now func() time.Time) fleetapi.StrictServerInterface {
	return pool.NewServer(base, &pool.Service{
		Pools: pools, Authz: ev, Recipients: inbox.PGRecipients{Control: control}, Owners: pool.ControlOwners{Control: control},
		Audience: inbox.AuthzAudience{E: ev}, Now: now,
	})
}
