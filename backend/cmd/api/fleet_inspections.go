package main

import (
	"time"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/inspections"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
)

// fleetInspections overlays the inspection operations of the module fleet/inspections (W2.04: checklists,
// inspections, the queue of blocking defects and its decision) on base, the server of the tag Fleet the other modules
// of the tag build (nil: their operations answer 501). Notifications go through the inbox port (W1.10): the
// membership of a recipient from the control DB, the audience by the evaluator; the clock is the one of the
// application (APP_FIXED_NOW outside prod), as the holds of reservations.
func fleetInspections(base fleetapi.StrictServerInterface, pools inspections.Pools, ev *authz.Evaluator, control inbox.ControlDB, now func() time.Time) fleetapi.StrictServerInterface {
	return inspections.NewServer(base, &inspections.Service{
		Pools: pools, Authz: ev, Recipients: inbox.PGRecipients{Control: control}, Audience: inbox.AuthzAudience{E: ev}, Now: now,
	})
}
