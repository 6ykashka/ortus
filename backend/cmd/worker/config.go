package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/events"
)

// config of cmd/worker, read from the environment (deploy/compose/.env.example).
type config struct {
	ControlDBURL string        // CONTROL_DB_URL: role ortus_worker
	TenantDBHost string        // TENANT_DB_HOST: overrides the host of tenant DB secrets
	Interval     time.Duration // WORKER_POLL_INTERVAL
	Batch        int           // WORKER_BATCH
	Lease        time.Duration // WORKER_LEASE
	MaxAttempts  int           // WORKER_MAX_ATTEMPTS
	LogLevel     slog.Level    // LOG_LEVEL
}

func orDefault(v, def string) string {
	if v = strings.TrimSpace(v); v != "" {
		return v
	}
	return def
}

// loadConfig reads and validates the configuration; every problem is reported at start.
func loadConfig(getenv func(string) string) (config, error) {
	c := config{
		ControlDBURL: strings.TrimSpace(getenv("CONTROL_DB_URL")),
		TenantDBHost: strings.TrimSpace(getenv("TENANT_DB_HOST")),
	}
	var errs []error
	if c.ControlDBURL == "" {
		errs = append(errs, errors.New("CONTROL_DB_URL is not set (see deploy/compose/.env.example)"))
	}
	duration := func(name string, def time.Duration) time.Duration {
		raw := orDefault(getenv(name), def.String())
		d, err := time.ParseDuration(raw)
		if err != nil || d <= 0 {
			errs = append(errs, fmt.Errorf("%s=%q: want a positive Go duration such as %s", name, raw, def))
		}
		return d
	}
	positive := func(name string, def int) int {
		raw := orDefault(getenv(name), strconv.Itoa(def))
		n, err := strconv.Atoi(raw)
		if err != nil || n <= 0 {
			errs = append(errs, fmt.Errorf("%s=%q: want a positive integer", name, raw))
		}
		return n
	}
	c.Interval = duration("WORKER_POLL_INTERVAL", events.DefaultInterval)
	c.Batch = positive("WORKER_BATCH", events.DefaultBatch)
	c.Lease = duration("WORKER_LEASE", events.DefaultLease)
	c.MaxAttempts = positive("WORKER_MAX_ATTEMPTS", events.DefaultMaxAttempts)
	if err := c.LogLevel.UnmarshalText([]byte(orDefault(getenv("LOG_LEVEL"), "info"))); err != nil {
		errs = append(errs, fmt.Errorf("LOG_LEVEL=%q: want debug, info, warn or error", getenv("LOG_LEVEL")))
	}
	return c, errors.Join(errs...)
}

// command is a parsed command line.
type command struct {
	name   string // run | dead | retry
	tenant uuid.UUID
	event  uuid.UUID
	limit  int
}

// Commands of cmd/worker.
const (
	cmdRun   = "run"
	cmdDead  = "dead"
	cmdRetry = "retry"
)

const usage = "usage: worker [run] | worker dead --tenant <uuid> [--limit N] | worker retry --tenant <uuid> --event <uuid>"

// parseCommand parses the command line (without the program name).
func parseCommand(args []string) (command, error) {
	if len(args) == 0 {
		return command{name: cmdRun}, nil
	}
	c := command{name: args[0]}
	fs := flag.NewFlagSet(c.name, flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	var tenant, event string
	switch c.name {
	case cmdRun:
	case cmdDead:
		fs.StringVar(&tenant, "tenant", "", "tenant id")
		fs.IntVar(&c.limit, "limit", 100, "rows")
	case cmdRetry:
		fs.StringVar(&tenant, "tenant", "", "tenant id")
		fs.StringVar(&event, "event", "", "event_id")
	default:
		return command{}, fmt.Errorf("unknown command %q; %s", c.name, usage)
	}
	if err := fs.Parse(args[1:]); err != nil {
		return command{}, fmt.Errorf("%s: %w; %s", c.name, err, usage)
	}
	if fs.NArg() > 0 {
		return command{}, fmt.Errorf("%s: unexpected arguments %q; %s", c.name, fs.Args(), usage)
	}
	var err error
	if c.name != cmdRun {
		if c.tenant, err = uuid.Parse(tenant); err != nil {
			return command{}, fmt.Errorf("%s: --tenant %q is not a UUID; %s", c.name, tenant, usage)
		}
	}
	switch {
	case c.name == cmdDead && c.limit <= 0:
		return command{}, fmt.Errorf("dead: --limit must be positive; %s", usage)
	case c.name == cmdRetry:
		if c.event, err = uuid.Parse(event); err != nil {
			return command{}, fmt.Errorf("retry: --event %q is not a UUID; %s", event, usage)
		}
	}
	return c, nil
}
