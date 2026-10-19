package main

import (
	"time"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/csv"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
)

// fleetCSV overlays the CSV import of vehicles of W2.50 on base, the server of the tag Fleet the other modules build
// (nil: their operations answer 501): createVehicleImport, getVehicleImport and commitVehicleImport (D-11 комплекта
// «импорт CSV машин», fleet/csv) over the tenant pools, the evaluator of W1.04 and the clock of the application.
func fleetCSV(base fleetapi.StrictServerInterface, pools kit.Pools, ev *authz.Evaluator, now func() time.Time) fleetapi.StrictServerInterface {
	if base == nil {
		base = fleetPending{}
	}
	return csv.NewServer(base, &csv.Imports{Pools: pools, Authz: ev, Now: now})
}
