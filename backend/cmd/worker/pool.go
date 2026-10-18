package main

// W2.07: the scheduled settlement of the driver pool (S2-14, Q-W2.51-4, Q-W2.51-15): open requests expire at the start
// of their window, approved transfers complete at its end (a started trip keeps its temporary driver until the
// acceptance), the grant of a temporary driver opens with the start of his trip and closes at its acceptance, a driver
// leaves a trip he did not start (pool.SettleDB). The commands of cmd/api that move a trip settle their tenant right
// after them; the schedule covers the tenants without such commands. The gateway closes the access of a trip not
// started at the end of the window by the validity of the grant alone, whatever the schedule.

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/pool"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// defaultPoolInterval is WORKER_POOL_INTERVAL by default.
const defaultPoolInterval = 30 * time.Second

// poolInterval reads WORKER_POOL_INTERVAL: a Go duration ≥ 0 (0 — off).
func poolInterval(getenv func(string) string) (time.Duration, error) {
	raw := orDefault(getenv("WORKER_POOL_INTERVAL"), defaultPoolInterval.String())
	d, err := time.ParseDuration(strings.TrimSpace(raw))
	if err != nil || d < 0 {
		return 0, fmt.Errorf("WORKER_POOL_INTERVAL=%q: want a Go duration ≥ 0 (30s, 1m; 0 — off)", raw)
	}
	return d, nil
}

// poolJob returns the scheduled settlement of the driver pool over the tenant pools of the worker, or a job that
// returns at once when WORKER_POOL_INTERVAL is 0; a malformed interval is an error of the configuration.
func poolJob(getenv func(string) string, tenants func(context.Context) ([]uuid.UUID, error), pools *tenantctx.Pools,
	now func() time.Time, log *slog.Logger) (func(context.Context), error) {
	every, err := poolInterval(getenv)
	if err != nil || every == 0 {
		return func(context.Context) {}, err
	}
	s := poolSettle{tenants: tenants, settle: pgSettle(pools), now: now, every: every, log: log}
	return s.run, nil
}

// poolSettle runs the settlement of the driver pool in the tenant DBs on a schedule (W2.07).
type poolSettle struct {
	tenants func(ctx context.Context) ([]uuid.UUID, error) // the tenants of the outbox delivery (listTenants)
	settle  func(ctx context.Context, tenantID uuid.UUID, now time.Time) (pool.Result, error)
	now     func() time.Time // the clock of the application (APP_FIXED_NOW outside prod)
	every   time.Duration
	log     *slog.Logger
}

// pgSettle is pool.SettleDB in the tenant DB through the pools of the worker (role ortus_worker).
func pgSettle(pools *tenantctx.Pools) func(ctx context.Context, tenantID uuid.UUID, now time.Time) (pool.Result, error) {
	return func(ctx context.Context, tenantID uuid.UUID, now time.Time) (pool.Result, error) {
		db, err := pools.For(ctx, tenantID)
		if err != nil {
			return pool.Result{}, err
		}
		return pool.SettleDB(ctx, db, tenantID, now)
	}
}

// once settles every tenant at one moment of the clock; a failing tenant does not stop the others, its error is
// returned with its id.
func (p poolSettle) once(ctx context.Context) error {
	ids, err := p.tenants(ctx)
	if err != nil {
		return fmt.Errorf("settle pool: %w", err)
	}
	now := p.now()
	var errs []error
	for _, id := range ids {
		res, err := p.settle(ctx, id, now)
		if err != nil {
			errs = append(errs, fmt.Errorf("settle pool of tenant %s: %w", id, err))
			continue
		}
		if res != (pool.Result{}) {
			p.log.InfoContext(ctx, "worker: pool settled", slog.String("tenant_id", id.String()),
				slog.Int("expired", res.Expired), slog.Int("completed", res.Completed), slog.Int("opened", res.Opened),
				slog.Int("closed", res.Closed), slog.Int("unassigned", res.Unassigned))
		}
	}
	return errors.Join(errs...)
}

// run settles at start and then every interval until ctx ends.
func (p poolSettle) run(ctx context.Context) {
	ticker := time.NewTicker(p.every)
	defer ticker.Stop()
	for {
		if err := p.once(ctx); err != nil && ctx.Err() == nil {
			p.log.WarnContext(ctx, "worker: settle pool", slog.String("error", err.Error()))
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
