package main

import (
	"time"

	earningsapi "github.com/ortus/ortus-crm/backend/internal/api/earnings"
	"github.com/ortus/ortus-crm/backend/internal/modules/finance"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
)

// newEarnings is the server of the tag Earnings (W2.06, S2-12): the earnings of a driver for an accepted trip over
// the tenant pools, the evaluator of W1.04 (the work function «Водитель» closes them, AC-05) and the clock of the
// application (APP_FIXED_NOW outside prod).
func newEarnings(pools finance.Pools, ev *authz.Evaluator, now func() time.Time) earningsapi.StrictServerInterface {
	return finance.Server{S: &finance.Service{Pools: pools, Authz: ev, Now: now}}
}
