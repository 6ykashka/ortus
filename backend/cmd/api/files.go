package main

import (
	"fmt"
	"log/slog"
	"time"

	billingapi "github.com/ortus/ortus-crm/backend/internal/api/billing"
	filesapi "github.com/ortus/ortus-crm/backend/internal/api/files"
	"github.com/ortus/ortus-crm/backend/internal/modules/files"
	"github.com/ortus/ortus-crm/backend/internal/modules/tasks"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
)

// filesServers wires the module files (W1.09): the tag Files and the storage part of the tag Billing over the tenant
// pools, the evaluator and the object storage of S3_* (deploy/compose/.env.example). Without S3_ENDPOINT the reads
// still work and uploads and downloads answer 503 dependency_unavailable; a half-configured storage stops the start.
// The Billing server is the base of the tag: its subscription operations answer 501 until W1.08 overlays them
// (subshttp.NewBillingServer(billing, subs) in main.go). W2.57 (AC-06): the parents of a trip leave out the trips the
// driver pool closes to the subject on the clock of the application (poolTrips, fleet_pool.go). W4.11: the attachments of
// tasks (parent tasks/task) leave out the tasks the subject does not read (hiddenTasks, tasks.go). W4.21, return 2: the
// files of the answers (parent forms/form) leave out those of the answers the subject does not read (hiddenFormFiles).
func filesServers(pools files.Pools, ev *authz.Evaluator, getenv func(string) string, log *slog.Logger, now func() time.Time) (filesapi.StrictServerInterface, billingapi.StrictServerInterface, error) {
	svc, err := filesService(pools, ev, now)
	if err != nil {
		return nil, nil, err
	}
	cfg, ok, err := storage.ConfigFromEnv(getenv)
	switch {
	case err != nil:
		return nil, nil, fmt.Errorf("object storage: %w", err)
	case ok:
		s3, err := storage.NewS3(cfg, nil, nil)
		if err != nil {
			return nil, nil, err
		}
		svc.Store = s3
	default:
		log.Warn("api: S3_ENDPOINT is not set — file uploads and downloads answer 503 dependency_unavailable")
	}
	return files.Server{S: svc}, files.Billing{S: svc}, nil
}

// filesService is the service of the module of files with its parents and what closes them, without the object storage.
func filesService(pools files.Pools, ev *authz.Evaluator, now func() time.Time) (*files.Service, error) {
	parents, err := files.NewParents(append(files.FleetParents(), taskParent(), formParent())...)
	if err != nil {
		return nil, err
	}
	hidden := closedParents{newPoolTrips(pools, now), hiddenTasks{H: tasks.HiddenTasks{Pools: pools, Authz: ev}},
		formFilesAccess(pools, ev, now)}
	return &files.Service{Pools: pools, Authz: ev, Parents: parents, Hidden: hidden}, nil
}
