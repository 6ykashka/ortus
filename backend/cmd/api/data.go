package main

import (
	"time"

	dataapi "github.com/ortus/ortus-crm/backend/internal/api/data"
	"github.com/ortus/ortus-crm/backend/internal/modules/data"
	datafleet "github.com/ortus/ortus-crm/backend/internal/modules/data/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/scopeddb"
)

// newData is the server of the tag Data (W2.08, S2-16 «Данные»): the registry of the datasets of the modules
// (logistics; the modules of later stages register their providers here) over the tenant pools and the evaluator of
// W1.04, the module states of the registry W1.08 and the clock of the application (APP_FIXED_NOW outside prod). W2.57
// (AC-06): «Поездки» and «Расходы» leave out the trips the driver pool closes to the member (poolTrips, fleet_pool.go).
func newData(pools scopeddb.Pools, ev *authz.Evaluator, states data.Modules, now func() time.Time) dataapi.StrictServerInterface {
	reg, err := data.NewRegistry(datafleet.Provider{})
	if err != nil { // the providers above are never nil and their ids differ: a programming error
		panic(err)
	}
	// W2.50: exportDataset — the CSV export over the server (data_export.go).
	return withExport(data.Server{S: &data.Service{Pools: pools, Authz: ev, Registry: reg, Modules: states, Now: now,
		Hidden: newPoolTrips(pools, now)}})
}
