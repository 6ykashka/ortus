package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"strconv"
	"strings"
)

// Actions.
const (
	actUp     = "up"
	actDown   = "down"
	actStatus = "status"
	actEnsure = "ensure"
)

// Commands.
const (
	cmdControl = "control"
	cmdTenant  = "tenant"
	cmdTenants = "tenants"
	cmdRoles   = "roles"
	cmdAll     = "all"
)

// Flags.
const (
	flagTo          = "to"
	flagDB          = "db"
	flagFailOnDrift = "fail-on-drift"
	flagYes         = "yes"
	flagCanary      = "canary"
	flagBatch       = "batch"
	flagDryRun      = "dry-run"
	flagContinue    = "continue-on-failure"
)

// command is a parsed invocation: «<name> <action> [flags]».
type command struct {
	name, action string
	to           int64 // -1 when --to is not given
	db           string
	failOnDrift  bool
	yes          bool     // down: the data loss is confirmed
	canary       []string // tenants up: canary slugs; tenants down: the only tenants rolled back
	batch        int      // tenants up: batch size, 0 = controller default
	dryRun       bool
	continueOn   bool // tenants up: a failed batch does not stop the next ones
}

// actions lists the allowed actions per command and the flags each one takes.
var actions = map[string]map[string][]string{
	cmdControl: {actUp: {flagTo}, actDown: {flagTo, flagYes}, actStatus: nil},
	cmdTenant:  {actUp: {flagTo, flagDB}, actDown: {flagTo, flagDB, flagYes}, actStatus: {flagDB}},
	cmdTenants: {
		actUp:     {flagTo, flagCanary, flagBatch, flagDryRun, flagContinue},
		actDown:   {flagTo, flagCanary, flagYes},
		actStatus: {flagFailOnDrift},
	},
	cmdRoles: {actEnsure: nil},
	cmdAll:   {actUp: nil},
}

func parse(args []string) (command, error) {
	if len(args) == 0 {
		return command{}, fail(exitUsage, "usage: migrate <control|tenant|tenants|roles|all> <action> [flags]")
	}
	name := args[0]
	allowed, ok := actions[name]
	if !ok {
		return command{}, fail(exitUsage, "unknown command %q", name)
	}
	if len(args) < 2 {
		return command{}, fail(exitUsage, "%s: missing action", name)
	}
	flags, ok := allowed[args[1]]
	if !ok {
		return command{}, fail(exitUsage, "%s: unknown action %q", name, args[1])
	}
	c := command{name: name, action: args[1], to: -1}
	if err := c.parseFlags(flags, args[2:]); err != nil {
		return command{}, err
	}
	return c, c.validate()
}

// rawFlags are the flag values that need checking after parsing.
type rawFlags struct{ to, canary, batch string }

// parseFlags reads the flags the action takes; anything else is a usage error.
func (c *command) parseFlags(flags, args []string) error {
	fs := flag.NewFlagSet(c.name+" "+c.action, flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	var raw rawFlags
	for _, f := range flags {
		c.define(fs, f, &raw)
	}
	if err := fs.Parse(args); err != nil {
		return fail(exitUsage, "%s %s: %v", c.name, c.action, err)
	}
	if fs.NArg() > 0 {
		return fail(exitUsage, "%s %s: unexpected argument %q", c.name, c.action, fs.Arg(0))
	}
	if err := c.parseCanary(raw.canary); err != nil {
		return err
	}
	if err := c.parseBatch(raw.batch); err != nil {
		return err
	}
	return c.parseTo(raw.to)
}

// define registers flag f of the action on fs.
func (c *command) define(fs *flag.FlagSet, f string, raw *rawFlags) {
	switch f {
	case flagTo:
		fs.StringVar(&raw.to, flagTo, "", "target version")
	case flagDB:
		fs.StringVar(&c.db, flagDB, "", "tenant database name")
	case flagFailOnDrift:
		fs.BoolVar(&c.failOnDrift, flagFailOnDrift, false, "exit 3 on drift")
	case flagYes:
		fs.BoolVar(&c.yes, flagYes, false, "confirm that down drops data")
	case flagCanary:
		fs.StringVar(&raw.canary, flagCanary, "", "comma-separated tenant slugs")
	case flagBatch:
		fs.StringVar(&raw.batch, flagBatch, "", "batch size")
	case flagDryRun:
		fs.BoolVar(&c.dryRun, flagDryRun, false, "print the plan only")
	case flagContinue:
		fs.BoolVar(&c.continueOn, flagContinue, false, "a failed batch does not stop the next ones")
	}
}

func (c *command) parseTo(to string) error {
	if to == "" {
		return nil
	}
	v, err := strconv.ParseInt(to, 10, 64)
	if err != nil || v < 0 {
		return fail(exitUsage, "%s %s: --to must be a version number ≥ 0, got %q", c.name, c.action, to)
	}
	c.to = v
	return nil
}

func (c *command) parseBatch(batch string) error {
	if batch == "" {
		return nil
	}
	n, err := strconv.Atoi(batch)
	if err != nil || n < 1 {
		return fail(exitUsage, "%s %s: --batch must be a number ≥ 1, got %q", c.name, c.action, batch)
	}
	c.batch = n
	return nil
}
func (c *command) parseCanary(list string) error {
	if list == "" {
		return nil
	}
	for s := range strings.SplitSeq(list, ",") {
		if s = strings.TrimSpace(s); s == "" {
			return fail(exitUsage, "%s %s: --canary has an empty slug: %q", c.name, c.action, list)
		}
		c.canary = append(c.canary, s)
	}
	return nil
}

func (c command) validate() error {
	if c.action == actDown && c.to < 0 {
		return fail(exitUsage, "%s down: --to N is required (no implicit rollback)", c.name)
	}
	if c.name == cmdTenants && c.action == actDown && len(c.canary) == 0 {
		return fail(exitUsage, "tenants down: --canary slug,… is required (no rollback of all tenants)")
	}
	if c.action == actDown && !c.yes {
		return fail(exitUsage, "%s down drops schemas and data (0001: drop schema … cascade): add --yes to confirm", c.name)
	}
	if c.name == cmdTenant && c.db == "" {
		return fail(exitUsage, "tenant %s: --db <database_name> is required", c.action)
	}
	return nil
}

func (c command) exec(ctx context.Context, env env, out io.Writer) error {
	if c.action == actDown && !env.downAllowed() {
		return fail(exitConfig, "%s down is refused: APP_ENV=%s is not in the allowlist dev|test|e2e; "+
			"production fixes forward with a new migration (Q-W0.06-4)", c.name, env["APP_ENV"])
	}
	switch c.name {
	case cmdControl:
		return migrateOne(ctx, env, out, cmdControl, "", c)
	case cmdTenant:
		return migrateOne(ctx, env, out, cmdTenant+" "+c.db, c.db, c)
	case cmdTenants:
		switch c.action {
		case actStatus:
			return tenantsStatus(ctx, env, out, c.failOnDrift)
		case actDown:
			return tenantsDown(ctx, env, out, c)
		}
		return tenantsUp(ctx, env, out, c)
	case cmdRoles:
		return ensureRoles(ctx, env, out)
	case cmdAll:
		return allUp(ctx, env, out)
	}
	return fmt.Errorf("unreachable command %q", c.name)
}
