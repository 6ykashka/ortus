package main

// W1.08: the module registry and the subscription in cmd/api — the module gate of the gateway (AC-12), the parts of
// /me/context owned by W1.08 (modules, tenantState) and the background lifecycle of subscriptions (AC-11).

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	contextapi "github.com/ortus/ortus-crm/backend/internal/api/context"
	"github.com/ortus/ortus-crm/backend/internal/control/subscriptions"
	"github.com/ortus/ortus-crm/backend/internal/modules/modulesreg"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx/mehttp"
)

// moduleGate is the module check of the gateway (modulesreg.Gate): operations of installable modules need the module
// installed; read_only and draining close changes (AC-12).
type moduleGate interface {
	Admit(ctx context.Context, tc tenantctx.TenantContext, op catalog.Operation) error
}

// newModules is the module registry over the tenant pools with the clock of the application.
func newModules(pools *tenantctx.Pools, cfg config) *modulesreg.Service {
	return &modulesreg.Service{Store: modulesreg.PGStore{Pools: pools}, Activity: modulesreg.DefaultRegistry(), Now: cfg.clock()}
}

// meExtras implements mehttp.Extras: tenantState from the control DB (tenants.state, the subscription) and the
// tenant DB (files.usage), module availability from the registry and the capabilities of the member.
type meExtras struct {
	subs    subscriptions.Store
	modules *modulesreg.Service
	pools   *tenantctx.Pools
}

var _ mehttp.Extras = meExtras{}

// TenantState implements mehttp.Extras: trialEndsAt in trial, graceEndsAt in grace, storage blocked when committed
// and reserved bytes reached the quota of files.usage (measured only for a tenant whose DB may be read).
func (e meExtras) TenantState(ctx context.Context, m tenantctx.Membership, withDB bool) (*contextapi.TenantState, error) {
	st := &contextapi.TenantState{Status: contextapi.TenantStateStatus(m.TenantState), StorageWriteStatus: contextapi.TenantStateStorageWriteStatus("allowed")}
	if m.TenantState == "trial" || m.TenantState == "grace" {
		sub, err := e.subs.Current(ctx, m.TenantID)
		if err != nil {
			return nil, err
		}
		if m.TenantState == "trial" && sub.Status == subscriptions.StatusTrialing {
			st.TrialEndsAt = sub.TrialEndsAt
		}
		if m.TenantState == "grace" && sub.Status == subscriptions.StatusGrace {
			st.GraceEndsAt = sub.GraceEndsAt
		}
	}
	if !withDB {
		return st, nil
	}
	blocked, err := storageBlocked(ctx, e.pools, m.TenantID)
	if err != nil {
		return nil, err
	}
	if blocked {
		st.StorageWriteStatus = "blocked"
	}
	return st, nil
}

// storageBlocked reads files.usage (the quota counter of tenant 0001; its owner is W1.09): no row — not blocked.
func storageBlocked(ctx context.Context, pools *tenantctx.Pools, tenantID uuid.UUID) (bool, error) {
	pool, err := pools.For(ctx, tenantID)
	if err != nil {
		return false, err
	}
	var blocked bool
	err = pool.QueryRow(ctx, `select committed_bytes + reserved_bytes >= limit_bytes from files.usage where singleton`).Scan(&blocked)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("storage usage: %w", err)
	}
	return blocked, nil
}

// Modules implements mehttp.Extras.
func (e meExtras) Modules(ctx context.Context, tc tenantctx.TenantContext, tenantState string, caps []contextapi.ScopedCapability) ([]contextapi.ModuleAvailability, error) {
	inst, err := e.modules.Installations(ctx, tc.TenantID)
	if err != nil {
		return nil, err
	}
	keys := make([]string, 0, len(caps))
	for _, c := range caps {
		keys = append(keys, c.Permission)
	}
	return modulesreg.Availability(tenantState, inst, keys), nil
}

// sweepEnv sets the interval of the subscription lifecycle (Go duration; 0 — off). Default: every minute in prod;
// off elsewhere, so that the stand keeps the seed state of 01.10.2026 (the trial of «Альта» ends 13.10).
const sweepEnv = "SUBSCRIPTION_SWEEP_INTERVAL"

// sweepInterval reads sweepEnv.
func sweepInterval(getenv func(string) string, appEnv string) (time.Duration, error) {
	raw := getenv(sweepEnv)
	if raw == "" {
		if appEnv == envProd {
			return time.Minute, nil
		}
		return 0, nil
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d < 0 {
		return 0, fmt.Errorf("%s=%q: want a Go duration ≥ 0 (1m, 30s; 0 — off)", sweepEnv, raw)
	}
	return d, nil
}

// lifecycle returns the background job of the subscription lifecycle (nil when off).
func lifecycle(store subscriptions.Store, every time.Duration, log *slog.Logger) func(context.Context) {
	if every <= 0 {
		return nil
	}
	return func(ctx context.Context) { store.Run(ctx, every, log) }
}
