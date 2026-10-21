package main

import (
	"time"

	dataapi "github.com/ortus/ortus-crm/backend/internal/api/data"
	"github.com/ortus/ortus-crm/backend/internal/modules/data"
	datafleet "github.com/ortus/ortus-crm/backend/internal/modules/data/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/scopeddb"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
)

// exportFiles is the object storage of the export files of «Данные» (W4.50): the bucket of S3_* as the module files
// (W1.09); without S3_ENDPOINT — nil, and a half-configured storage is an error of the configuration.
func exportFiles(getenv func(string) string) (data.ExportFiles, error) {
	cfg, ok, err := storage.ConfigFromEnv(getenv)
	if err != nil || !ok {
		return nil, err
	}
	s3, err := storage.NewS3(cfg, nil, nil)
	if err != nil {
		return nil, err
	}
	return s3, nil
}

// newData is the server of the tag Data (W2.08, S2-16 «Данные»): the registry of the datasets of the modules
// (logistics; the modules of later stages register their providers here) over the tenant pools and the evaluator of
// W1.04, the module states of the registry W1.08 and the clock of the application (APP_FIXED_NOW outside prod). W2.57
// (AC-06): «Поездки» and «Расходы» leave out the trips the driver pool closes to the member (poolTrips, fleet_pool.go).
//
// W4.50: the saved views and the export jobs of the tag are served by the same service; files is the object storage of
// the export files (the link of a download, the deletion of a revoked file; nil — downloads answer 503), the worker
// writes them (cmd/worker/exports.go).
func newData(pools scopeddb.Pools, ev *authz.Evaluator, states data.Modules, files data.ExportFiles, now func() time.Time) dataapi.StrictServerInterface {
	reg, err := data.NewRegistry(datafleet.Provider{})
	if err != nil { // the providers above are never nil and their ids differ: a programming error
		panic(err)
	}
	// W2.50: exportDataset — the CSV export over the server (data_export.go).
	return withExport(data.Server{S: &data.Service{Pools: pools, Authz: ev, Registry: reg, Modules: states, Now: now,
		Hidden: newPoolTrips(pools, now), Files: files}})
}
