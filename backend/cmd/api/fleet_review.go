package main

import (
	"time"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/review"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
)

// fleetReview overlays the operations of W2.06 on base, the server of the tag Fleet the other modules build (nil:
// their operations answer 501): the acceptance of a shift and the check of an expense (fleet/review: reviewTrip,
// reviewTripExpense). The driver learns the decision through the inbox port (W1.10): the membership of a recipient
// from the control DB, the audience by the evaluator; the clock is the one of the application (APP_FIXED_NOW outside
// prod), as the holds of reservations.
func fleetReview(base fleetapi.StrictServerInterface, pools review.Pools, ev *authz.Evaluator, control inbox.ControlDB, now func() time.Time) fleetapi.StrictServerInterface {
	return review.NewServer(base, &review.Service{
		Pools: pools, Authz: ev, Recipients: inbox.PGRecipients{Control: control}, Audience: inbox.AuthzAudience{E: ev}, Now: now,
	})
}
