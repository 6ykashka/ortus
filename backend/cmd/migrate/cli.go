package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"strconv"
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

// command is a parsed invocation: «<name> <action> [flags]».
type command struct {
	name, action string
	to           int64 // -1 when --to is not given
	db           string
	failOnDrift  bool
	yes          bool // down: the data loss is confirmed
}

// actions lists the allowed actions per command and the flags each one takes.
var actions = map[string]map[string][]string{
	cmdControl: {actUp: {"to"}, actDown: {"to", "yes"}, actStatus: nil},
	cmdTenant:  {actUp: {"to", "db"}, actDown: {"to", "db", "yes"}, actStatus: {"db"}},
	cmdTenants: {actUp: nil, actStatus: {"fail-on-drift"}},
	cmdRoles:   {actEnsure: nil},
	cmdAll:     {actUp: nil},
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

// parseFlags reads the flags the action takes; anything else is a usage error.
func (c *command) parseFlags(flags, args []string) error {
	fs := flag.NewFlagSet(c.name+" "+c.action, flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	var to string
	for _, f := range flags {
		switch f {
		case "to":
			fs.StringVar(&to, "to", "", "target version")
		case "db":
			fs.StringVar(&c.db, "db", "", "tenant database name")
		case "fail-on-drift":
			fs.BoolVar(&c.failOnDrift, "fail-on-drift", false, "exit 3 on drift")
		case "yes":
			fs.BoolVar(&c.yes, "yes", false, "confirm that down drops data")
		}
	}
	if err := fs.Parse(args); err != nil {
		return fail(exitUsage, "%s %s: %v", c.name, c.action, err)
	}
	if fs.NArg() > 0 {
		return fail(exitUsage, "%s %s: unexpected argument %q", c.name, c.action, fs.Arg(0))
	}
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

func (c command) validate() error {
	if c.action == actDown && c.to < 0 {
		return fail(exitUsage, "%s down: --to N is required (no implicit rollback)", c.name)
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
	if c.action == actDown && env.isProd() {
		return fail(exitConfig, "%s down is refused with APP_ENV=%s: roll back through the migration controller (W1.02)",
			c.name, env["APP_ENV"])
	}
	switch c.name {
	case cmdControl:
		return migrateOne(ctx, env, out, cmdControl, "", c)
	case cmdTenant:
		return migrateOne(ctx, env, out, cmdTenant+" "+c.db, c.db, c)
	case cmdTenants:
		if c.action == actStatus {
			return tenantsStatus(ctx, env, out, c.failOnDrift)
		}
		_, err := tenantsUp(ctx, env, out)
		return err
	case cmdRoles:
		return ensureRoles(ctx, env, out)
	case cmdAll:
		return allUp(ctx, env, out)
	}
	return fmt.Errorf("unreachable command %q", c.name)
}
