package main

import (
	"time"

	inventoryapi "github.com/ortus/ortus-crm/backend/internal/api/inventory"
	"github.com/ortus/ortus-crm/backend/internal/modules/inventory"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
)

// newInventory is the server of the tag Inventory (W5.10, D-20): warehouses of org units, the nomenclature, lots with
// expiry dates, immutable movements with FEFO issues, and reservations — over the tenant pools, the evaluator of
// W1.04 (scope kinds unit and warehouse) and the clock of the application (APP_FIXED_NOW outside prod).
func newInventory(pools inventory.Pools, ev *authz.Evaluator, now func() time.Time) inventoryapi.StrictServerInterface {
	return inventory.Server{S: &inventory.Service{Pools: pools, Authz: ev, Now: now}}
}
