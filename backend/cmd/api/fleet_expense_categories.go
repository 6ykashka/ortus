package main

import (
	"time"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/expenses"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
)

// fleetExpenseCategories overlays the catalogue of expense categories of W2.41 on base, the server of the tag Fleet
// the other modules build (nil: their operations answer 501): listExpenseCategories, createExpenseCategory,
// archiveExpenseCategory (fleet/expenses, tenant 0015). It sits on top of newFleet: the overlays below never serve
// these operations. The clock is the one of the application (APP_FIXED_NOW outside prod) — the time of an archive.
func fleetExpenseCategories(base fleetapi.StrictServerInterface, pools expenses.Pools, ev *authz.Evaluator, now func() time.Time) fleetapi.StrictServerInterface {
	return expenses.NewCategoryServer(base, &expenses.Service{Pools: pools, Authz: ev, Now: now})
}
