package main

import (
	"time"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/expenses"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/trips"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
)

// fleetTrips overlays the operations of W2.05 on base, the server of the tag Fleet the other modules build (nil:
// their operations answer 501): the trip of the driver (fleet/trips: startTrip, getTrip, listTrips, finishTripRoute,
// returnTrip; the trip card getTripPlan/listTripPlans stays with W2.03 in the base) and its expenses (fleet/expenses: createTripExpense, listTripExpenses,
// getTripExpense). The managers of the area learn about a started trip and a submitted shift through the inbox port
// (W1.10): the membership of a recipient from the control DB, the audience by the evaluator; the clock is the one of
// the application (APP_FIXED_NOW outside prod), as the holds of reservations.
func fleetTrips(base fleetapi.StrictServerInterface, pools trips.Pools, ev *authz.Evaluator, control inbox.ControlDB, now func() time.Time) fleetapi.StrictServerInterface {
	t := trips.NewServer(base, &trips.Service{
		Pools: pools, Authz: ev, Recipients: inbox.PGRecipients{Control: control}, Audience: inbox.AuthzAudience{E: ev}, Now: now,
	})
	return expenses.NewServer(t, &expenses.Service{Pools: pools, Authz: ev, Now: now})
}
