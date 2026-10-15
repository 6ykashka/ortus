package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strconv"
	"strings"
	"text/tabwriter"

	"github.com/ortus/ortus-crm/backend/internal/control/provisioning"
	"github.com/ortus/ortus-crm/backend/internal/control/tenants"
	"github.com/ortus/ortus-crm/backend/migrations"
)

// migrateOne runs up, down or status on the control DB (db == "") or on one tenant DB. Up and down of a database
// routed in tenant_routing go through the controller (tenantOne); a database without a route is migrated directly
// and the output says that tenant_routing was not updated (manual repair, a database outside the registry).
func migrateOne(ctx context.Context, e env, out io.Writer, label, db string, c command) error {
	note := ""
	if db != "" && c.action != actStatus {
		routed, err := tenantOne(ctx, e, out, label, db, c)
		if routed || err != nil {
			return err
		}
		note = " (no route in tenant_routing: tenant_routing not updated)"
	}
	return migrateDirect(ctx, e, out, label, db, note, c)
}

// migrateDirect runs goose on the control DB or on database db as it is, outside the controller.
func migrateDirect(ctx context.Context, e env, out io.Writer, label, db, note string, c command) error {
	kind := migrations.Control
	dsn, err := e.require("MIGRATOR_DB_URL")
	if err != nil {
		return err
	}
	if db != "" {
		kind = migrations.Tenant
		if dsn, err = migrations.TenantDSN(dsn, e["TENANT_DB_HOST"], db); err != nil {
			return fail(exitConfig, "MIGRATOR_DB_URL: %v", err)
		}
	}
	conn, err := open(ctx, "MIGRATOR_DB_URL", dsn)
	if err != nil {
		return err
	}
	defer conn.Close()

	var res migrations.Result
	switch c.action {
	case actStatus:
		v, err := migrations.Version(ctx, conn, kind)
		if err != nil {
			return err
		}
		fmt.Fprintf(out, "%s: version %d (latest %d)\n", label, v, migrations.Latest(kind))
		return nil
	case actUp:
		target := c.to
		if target < 0 {
			target = migrations.Latest(kind)
		}
		res, err = migrations.UpTo(ctx, conn, kind, target)
	case actDown:
		res, err = migrations.DownTo(ctx, conn, kind, c.to)
	}
	if err != nil {
		return err
	}
	fmt.Fprintf(out, "%s: %d → %d%s\n", label, res.From, res.To, note)
	return nil
}

// tenantOne migrates or rolls back the tenant routed to database db through the controller: tenant lock, drift and
// sentinel checks, tenant_routing and platform_audit. routed is false when no tenant is routed to db.
func tenantOne(ctx context.Context, e env, out io.Writer, label, db string, c command) (routed bool, err error) {
	ctrl, closeFn, err := controller(ctx, e)
	if err != nil {
		return false, err
	}
	defer closeFn()
	ref, err := tenants.LookupDatabase(ctx, ctrl.Control, db)
	if errors.Is(err, tenants.ErrUnknownTenant) {
		return false, nil
	}
	if err != nil {
		return true, err
	}
	if ref.Provisioning() {
		return true, planError(fmt.Errorf("%w: %q (database %s)", tenants.ErrProvisioning, ref.Slug, db))
	}
	res, err := tenantAction(ctx, ctrl, ref, c)
	if err != nil {
		return true, err
	}
	fmt.Fprintf(out, "%s: %d → %d (tenant %s, tenant_routing updated)\n", label, res.From, res.To, ref.Slug)
	return true, nil
}

// tenantAction runs c (up or down) on one routed tenant.
func tenantAction(ctx context.Context, ctrl *tenants.Controller, ref tenants.Ref, c command) (tenants.Result, error) {
	if c.action == actUp {
		latest := migrations.Latest(migrations.Tenant)
		target := c.to
		if target < 0 {
			target = latest
		}
		if target < 1 || target > latest {
			return tenants.Result{}, fail(exitUsage, "tenant up: --to must be 1…%d (rollback is tenant down)", latest)
		}
		res := ctrl.Migrate(ctx, ref, target, tenants.NewRunID("migrate"))
		return res, res.Err
	}
	rep, err := ctrl.Rollback(ctx, c.to, []string{ref.Slug})
	if rep.RunID == "" {
		return tenants.Result{}, planError(err)
	}
	for _, rs := range [][]tenants.Result{rep.Failed, rep.Done, rep.Skipped} {
		if len(rs) > 0 {
			return rs[0], rs[0].Err
		}
	}
	return tenants.Result{Ref: ref, From: ref.SchemaVersion, To: ref.SchemaVersion}, err
}

// controller connects the control DB as the migrator and returns the migration controller over it. Tenant
// databases are opened with the same credentials (TENANT_DB_HOST overrides the host); the control DB itself is
// never taken for a tenant database.
func controller(ctx context.Context, e env) (*tenants.Controller, func(), error) {
	dsn, err := e.require("MIGRATOR_DB_URL")
	if err != nil {
		return nil, nil, err
	}
	u, err := url.Parse(dsn)
	if err != nil {
		return nil, nil, fail(exitConfig, "MIGRATOR_DB_URL is not a URL")
	}
	control, err := open(ctx, "MIGRATOR_DB_URL", dsn)
	if err != nil {
		return nil, nil, err
	}
	return &tenants.Controller{
		Control: control,
		Connect: tenants.DSNConnector{DSN: dsn, Host: e["TENANT_DB_HOST"], Reserved: []string{strings.TrimPrefix(u.Path, "/")}},
		Redact:  e.redact,
	}, func() { _ = control.Close() }, nil
}

// planError turns a request the controller refused before running into a usage error (code 2).
func planError(err error) error {
	if errors.Is(err, tenants.ErrUnknownTenant) || errors.Is(err, tenants.ErrBadTarget) || errors.Is(err, tenants.ErrNoTenants) ||
		errors.Is(err, tenants.ErrProvisioning) {
		return fail(exitUsage, "%v", err)
	}
	return err
}

// tenantsUp runs the controller: canary → batches (S1-03). Exit codes: 6 canary failed, 1 a batch failed.
func tenantsUp(ctx context.Context, e env, out io.Writer, c command) error {
	ctrl, closeFn, err := controller(ctx, e)
	if err != nil {
		return err
	}
	defer closeFn()
	plan := tenants.Plan{Canary: c.canary, BatchSize: c.batch, ContinueOnFailure: c.continueOn, DryRun: c.dryRun}
	if c.to >= 0 {
		plan.Target = c.to
		if c.to == 0 {
			return fail(exitUsage, "tenants up: --to must be ≥ 1 (rollback is tenants down)")
		}
	}
	rep, err := ctrl.Rollout(ctx, plan)
	if rep.RunID == "" {
		return planError(err)
	}
	printReport(out, "tenants", rep)
	return err
}

// tenantsDown rolls back only the tenants listed in --canary (down-guard).
func tenantsDown(ctx context.Context, e env, out io.Writer, c command) error {
	ctrl, closeFn, err := controller(ctx, e)
	if err != nil {
		return err
	}
	defer closeFn()
	rep, err := ctrl.Rollback(ctx, c.to, c.canary)
	if rep.RunID == "" {
		return planError(err)
	}
	printReport(out, "tenants", rep)
	return err
}

func printReport(out io.Writer, label string, rep tenants.Report) {
	fmt.Fprintf(out, "plan: target %d (run %s)\n", rep.Target, rep.RunID)
	for _, ph := range rep.Phases {
		names := make([]string, len(ph.Tenants))
		for i, r := range ph.Tenants {
			names[i] = r.Slug
		}
		fmt.Fprintf(out, "phase %s: %s\n", ph.Name, strings.Join(names, ", "))
	}
	if rep.DryRun {
		fmt.Fprintln(out, "dry-run: nothing changed")
		return
	}
	for _, r := range rep.Done {
		fmt.Fprintf(out, "tenant %s (%s): %d → %d\n", r.Ref.Slug, r.Ref.Database, r.From, r.To)
	}
	for _, r := range rep.Skipped {
		if r.Reason == tenants.ReasonProvisioning {
			fmt.Fprintf(out, "tenant %s (%s): provisioning, skipped\n", r.Ref.Slug, r.Ref.Database)
			continue
		}
		fmt.Fprintf(out, "tenant %s (%s): on %d, skipped\n", r.Ref.Slug, r.Ref.Database, r.To)
	}
	for _, r := range rep.Failed {
		fmt.Fprintf(out, "tenant %s (%s): failed (%d → %d): %v\n", r.Ref.Slug, r.Ref.Database, r.From, r.To, r.Err)
	}
	verb := "migrated"
	if strings.HasPrefix(rep.RunID, "rollback") {
		verb = "rolled back"
	}
	fmt.Fprintf(out, "%s: %d %s, %d skipped, %d failed (run %s)\n", label, len(rep.Done), verb, len(rep.Skipped), len(rep.Failed), rep.RunID)
}

// tenantsStatus prints routing and actual versions; drift = they differ (or the DB is unreachable).
func tenantsStatus(ctx context.Context, e env, out io.Writer, failOnDrift bool) error {
	ctrl, closeFn, err := controller(ctx, e)
	if err != nil {
		return err
	}
	defer closeFn()
	list, err := ctrl.Status(ctx)
	if err != nil {
		return err
	}
	tw := tabwriter.NewWriter(out, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "slug\tdatabase\trouting\tactual\tdrift")
	drift := 0
	for _, s := range list {
		actual := "n/a"
		switch {
		case s.Ref.Provisioning():
			actual = tenants.StateProvisioning // the provisioner's database: not opened, not a drift
		case s.Actual >= 0:
			actual = strconv.FormatInt(s.Actual, 10)
		}
		if s.Drift {
			drift++
		}
		fmt.Fprintf(tw, "%s\t%s\t%d\t%s\t%t\n", s.Ref.Slug, s.Ref.Database, s.Ref.SchemaVersion, actual, s.Drift)
	}
	if err := tw.Flush(); err != nil {
		return err
	}
	if failOnDrift && drift > 0 {
		return fail(exitDrift, "%d tenant(s) drifted from tenant_routing.schema_version", drift)
	}
	return nil
}

// ensureRoles creates the Ortus roles, makes ortus_migrator the owner of the control DB (dev) and lets
// ortus_provisioner create databases owned by the migrator (Q-W0.06-2).
func ensureRoles(ctx context.Context, e env, out io.Writer) error {
	superDSN, err := e.require("PG_SUPER_URL")
	if err != nil {
		return err
	}
	p, err := e.passwords()
	if err != nil {
		return err
	}
	migDSN, err := e.require("MIGRATOR_DB_URL")
	if err != nil {
		return err
	}
	u, err := url.Parse(migDSN)
	if err != nil {
		return fail(exitConfig, "MIGRATOR_DB_URL is not a URL")
	}
	controlDB := strings.TrimPrefix(u.Path, "/")
	super, err := open(ctx, "PG_SUPER_URL", superDSN)
	if err != nil {
		return err
	}
	defer super.Close()
	if err := migrations.EnsureRoles(ctx, super, p); err != nil {
		return err
	}
	if err := migrations.AdoptDatabase(ctx, super, controlDB); err != nil {
		return err
	}
	if err := provisioning.EnsureRoleGrants(ctx, super); err != nil {
		return err
	}
	fmt.Fprintf(out, "roles: ensured (%s, %s, %s, %s); %s owner %s; %s may set role %s\n", migrations.RoleMigrator,
		migrations.RoleAPI, migrations.RoleWorker, migrations.RoleProvisioner, controlDB, migrations.RoleMigrator,
		migrations.RoleProvisioner, migrations.RoleMigrator)
	return nil
}

// allUp is «make migrate»: roles (when PG_SUPER_URL is set), control DB, every tenant DB through the controller.
func allUp(ctx context.Context, e env, out io.Writer) error {
	if e["PG_SUPER_URL"] != "" {
		if err := ensureRoles(ctx, e, out); err != nil {
			return err
		}
	}
	if err := migrateOne(ctx, e, out, cmdControl, "", command{name: cmdControl, action: actUp, to: -1}); err != nil {
		return err
	}
	return tenantsUp(ctx, e, out, command{name: cmdTenants, action: actUp, to: -1})
}
