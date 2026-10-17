package main

// W1.42: the scheduled cleaner of the people imports (Q-W1.05-17, Q-W0.08-5, 152-FZ): the rows of a preview — the
// personal data — are deleted at its expiry, the header of an expired preview a week later, the rows of a committed
// import after 30 days (importer.Purge). createPeopleImport cleans its tenant too, the schedule covers tenants
// without new imports.

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/importer"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// importPurge runs importer.Purge in the tenant DBs on a schedule.
type importPurge struct {
	tenants func(ctx context.Context) ([]uuid.UUID, error) // the tenants of the outbox delivery (listTenants)
	purge   func(ctx context.Context, tenantID uuid.UUID, now time.Time) (importer.PurgeResult, error)
	now     func() time.Time // the clock of the application (APP_FIXED_NOW outside prod)
	every   time.Duration
	log     *slog.Logger
}

// pgPurge is importer.Purge in the tenant DB through the pools of the worker.
func pgPurge(pools *tenantctx.Pools) func(ctx context.Context, tenantID uuid.UUID, now time.Time) (importer.PurgeResult, error) {
	return func(ctx context.Context, tenantID uuid.UUID, now time.Time) (importer.PurgeResult, error) {
		pool, err := pools.For(ctx, tenantID)
		if err != nil {
			return importer.PurgeResult{}, err
		}
		return importer.Purge(ctx, pool, now)
	}
}

// once cleans every tenant at one moment of the clock; a failing tenant does not stop the others, its error is
// returned with its id.
func (p importPurge) once(ctx context.Context) error {
	ids, err := p.tenants(ctx)
	if err != nil {
		return fmt.Errorf("purge imports: %w", err)
	}
	now := p.now()
	var errs []error
	for _, id := range ids {
		res, err := p.purge(ctx, id, now)
		if err != nil {
			errs = append(errs, fmt.Errorf("purge imports of tenant %s: %w", id, err))
			continue
		}
		if res != (importer.PurgeResult{}) {
			p.log.InfoContext(ctx, "worker: imports purged", slog.String("tenant_id", id.String()),
				slog.Int64("expired", res.Expired), slog.Int64("deleted", res.Deleted), slog.Int64("rows_purged", res.Purged))
		}
	}
	return errors.Join(errs...)
}

// run cleans at start and then every interval until ctx ends.
func (p importPurge) run(ctx context.Context) {
	ticker := time.NewTicker(p.every)
	defer ticker.Stop()
	for {
		if err := p.once(ctx); err != nil && ctx.Err() == nil {
			p.log.WarnContext(ctx, "worker: purge imports", slog.String("error", err.Error()))
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
