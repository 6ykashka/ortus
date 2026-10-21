// Command worker delivers the transactional outbox of every tenant DB (W1.01, S1-24): lease, retries with backoff,
// dead-letter after WORKER_MAX_ATTEMPTS and a manual retry. Role ortus_worker (DML only). The consumers of stage 1
// (W1.42): realtime hints (W1.07), the inbox (W1.10), the files (W1.09); next to the delivery it cleans the expired
// people imports every WORKER_PURGE_INTERVAL (W1.05, Q-W1.05-17).
//
//	worker [run]                                   deliver until SIGINT/SIGTERM
//	worker dead  --tenant <uuid> [--limit N]       list the dead-letter of a tenant (JSON lines)
//	worker retry --tenant <uuid> --event <uuid>    return a dead-letter event to delivery (audited)
//
// Configuration: CONTROL_DB_URL, TENANT_DB_HOST, the secret named by tenant_routing.secret_ref (TENANT_DB_URL with
// role ortus_worker), WORKER_POLL_INTERVAL, WORKER_BATCH, WORKER_LEASE, WORKER_MAX_ATTEMPTS, WORKER_PURGE_INTERVAL
// (1m; 0 — off), WORKER_POOL_INTERVAL (the driver pool, W2.07: 30s; 0 — off), WORKER_EXPORT_INTERVAL (the export
// jobs of «Данные», W4.50: 2s; 0 — off), S3_* (the files of W1.09 and of the export jobs), APP_FIXED_NOW (not with
// APP_ENV=prod), LOG_LEVEL.
//
// Exit codes: 0 — done or stopped by a signal; 1 — failure; 2 — configuration, arguments or database unreachable at
// start; 3 — the event is not in the dead-letter.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

const (
	exitOK      = 0
	exitFailed  = 1
	exitConfig  = 2
	exitNotDead = 3
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	code := run(ctx, os.Args[1:], os.Getenv, os.Stdout, os.Stderr)
	stop()
	os.Exit(code)
}

func run(ctx context.Context, args []string, getenv func(string) string, stdout, stderr io.Writer) int {
	cmd, err := parseCommand(args)
	if err != nil {
		fmt.Fprintf(stderr, "worker: %v\n", err)
		return exitConfig
	}
	cfg, err := loadConfig(getenv)
	if err != nil {
		fmt.Fprintf(stderr, "worker: configuration: %v\n", err)
		return exitConfig
	}
	logOut := stdout // run logs to stdout like cmd/api; the CLI commands print their result there
	if cmd.name != cmdRun {
		logOut = stderr
	}
	log := slog.New(slog.NewJSONHandler(logOut, &slog.HandlerOptions{Level: cfg.LogLevel}))
	pcfg, err := pgxpool.ParseConfig(cfg.ControlDBURL)
	if err != nil {
		fmt.Fprintln(stderr, "worker: CONTROL_DB_URL is not a valid PostgreSQL DSN") // the parse error quotes the DSN
		return exitConfig
	}
	control, err := pgxpool.NewWithConfig(ctx, pcfg)
	if err == nil {
		err = control.Ping(ctx)
	}
	if err != nil {
		if control != nil {
			control.Close()
		}
		fmt.Fprintf(stderr, "worker: control DB %s/%s unreachable: %v\n", pcfg.ConnConfig.Host, pcfg.ConnConfig.Database, err)
		return exitConfig
	}
	defer control.Close()
	pools := tenantctx.NewPools(tenantctx.NewPGDirectory(control), getenv, cfg.TenantDBHost)
	defer pools.Close()

	switch cmd.name {
	case cmdDead:
		return dead(ctx, pools, cmd, stdout, stderr)
	case cmdRetry:
		return retry(ctx, pools, cmd, stdout, stderr)
	}
	// W1.42: the consumers of stage 1; the audience of the inbox is the evaluator of W1.04 on the clock of the application.
	src := authz.PGSource{Pools: pools}
	reg := newRegistry(registryDeps{
		control: control, pools: pools, audience: inbox.AuthzAudience{E: authz.New(src, src, cfg.clock())}, log: log,
	})
	settlePool, poolErr := poolJob(getenv, listTenants(control), pools, cfg.clock(), log) // W2.07: the driver pool (pool.go)
	// W4.50: the export jobs of «Данные» (exports.go).
	runExports, exportErr := exportJob(exportDeps{getenv: getenv, tenants: listTenants(control), control: control, pools: pools,
		now: cfg.clock(), log: log})
	if err := errors.Join(registerFiles(reg, pools, getenv, log), poolErr, exportErr); err != nil { // W1.09
		fmt.Fprintf(stderr, "worker: configuration: %v\n", err)
		return exitConfig
	}
	w := &events.Worker{
		Tenants: listTenants(control), Pools: pools, Registry: reg, Batch: cfg.Batch,
		Interval: cfg.Interval, Lease: cfg.Lease, MaxAttempts: cfg.MaxAttempts, Log: log,
	}
	log.InfoContext(ctx, "worker: started", slog.Duration("interval", cfg.Interval), slog.Int("batch", cfg.Batch),
		slog.Int("max_attempts", cfg.MaxAttempts), slog.Duration("purge_interval", cfg.PurgeInterval))
	jobs, stop := context.WithCancel(ctx) // the jobs end with the delivery, whatever stops it
	var purging sync.WaitGroup
	if cfg.PurgeInterval > 0 { // W1.42: the expired people imports (Q-W1.05-17)
		p := importPurge{tenants: listTenants(control), purge: pgPurge(pools), now: cfg.clock(), every: cfg.PurgeInterval, log: log}
		purging.Go(func() { p.run(jobs) })
	}
	purging.Go(func() { settlePool(jobs) }) // W2.07: the time of the driver pool (WORKER_POOL_INTERVAL; 0 — returns at once)
	purging.Go(func() { runExports(jobs) }) // W4.50: the export jobs (WORKER_EXPORT_INTERVAL; 0 — returns at once)
	err = w.Run(ctx)
	stop()
	purging.Wait()
	if err != nil {
		log.ErrorContext(ctx, "worker: stopped", slog.String("error", err.Error()))
		return exitFailed
	}
	return exitOK
}

// deadLetter is one line of `worker dead`.
type deadLetter struct {
	EventID     uuid.UUID `json:"eventId"`
	Type        string    `json:"type"`
	Aggregate   string    `json:"aggregate"`
	AggregateID uuid.UUID `json:"aggregateId"`
	OccurredAt  string    `json:"occurredAt"`
	Attempts    int       `json:"attempts"`
	LastError   string    `json:"lastError"`
}

func dead(ctx context.Context, pools *tenantctx.Pools, cmd command, stdout, stderr io.Writer) int {
	pool, err := pools.For(ctx, cmd.tenant)
	if err != nil {
		fmt.Fprintf(stderr, "worker: tenant %s: %v\n", cmd.tenant, err)
		return exitFailed
	}
	list, err := (&events.Outbox{DB: pool}).DeadLetters(ctx, cmd.limit)
	if err != nil {
		fmt.Fprintf(stderr, "worker: %v\n", err)
		return exitFailed
	}
	enc := json.NewEncoder(stdout)
	for _, d := range list {
		line := deadLetter{EventID: d.EventID, Type: d.Type, Aggregate: d.Aggregate, AggregateID: d.AggregateID,
			OccurredAt: d.OccurredAt.UTC().Format(time.RFC3339), Attempts: d.Attempts, LastError: d.LastError}
		if err := enc.Encode(line); err != nil {
			fmt.Fprintf(stderr, "worker: %v\n", err)
			return exitFailed
		}
	}
	return exitOK
}

// retry returns a dead-letter event to delivery and records the manual retry in audit.events, in one transaction.
func retry(ctx context.Context, pools *tenantctx.Pools, cmd command, stdout, stderr io.Writer) int {
	pool, err := pools.For(ctx, cmd.tenant)
	if err != nil {
		fmt.Fprintf(stderr, "worker: tenant %s: %v\n", cmd.tenant, err)
		return exitFailed
	}
	err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		if err := (&events.Outbox{DB: tx}).Retry(ctx, cmd.event); err != nil {
			return err
		}
		return audit.Record(ctx, tx, audit.Event{
			ActorKind: audit.ActorService, Action: "outbox.event.retry", TargetType: "outbox.event", TargetID: cmd.event, Result: audit.OK,
			RequestID: "worker-retry:" + uuid.NewString(), Diff: map[string]any{"eventId": cmd.event.String()},
		})
	})
	switch {
	case errors.Is(err, events.ErrNotDead):
		fmt.Fprintf(stderr, "worker: event %s is not in the dead-letter of tenant %s\n", cmd.event, cmd.tenant)
		return exitNotDead
	case err != nil:
		fmt.Fprintf(stderr, "worker: retry: %v\n", err)
		return exitFailed
	}
	fmt.Fprintf(stdout, "retried %s\n", cmd.event)
	return exitOK
}
