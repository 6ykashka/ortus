package main

import (
	"fmt"
	"log/slog"

	"github.com/ortus/ortus-crm/backend/internal/modules/files"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
)

// registerFiles adds the handlers of the module files (W1.09) to reg: the check of uploaded files
// (files.file.uploaded.v1) and the expiry of upload sessions (files.upload.deadline_reached.v1). Without
// S3_ENDPOINT the checks fail and are retried (then dead-lettered); expiry works without storage.
func registerFiles(reg *events.Registry, pools files.Pools, getenv func(string) string, log *slog.Logger) error {
	w := &files.Worker{Pools: pools, Scanner: files.BasicScanner{}, Log: log}
	cfg, ok, err := storage.ConfigFromEnv(getenv)
	switch {
	case err != nil:
		return fmt.Errorf("object storage: %w", err)
	case ok:
		s3, err := storage.NewS3(cfg, nil, nil)
		if err != nil {
			return err
		}
		w.Store = s3
	default:
		log.Warn("worker: S3_ENDPOINT is not set — uploaded files are not checked")
	}
	w.Register(reg)
	return nil
}
