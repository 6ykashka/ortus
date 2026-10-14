package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"strconv"
	"strings"
	"text/tabwriter"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// migrateOne runs up, down or status on the control DB (db == "") or on one tenant DB.
func migrateOne(ctx context.Context, e env, out io.Writer, label, db string, c command) error {
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
	fmt.Fprintf(out, "%s: %d → %d\n", label, res.From, res.To)
	return nil
}

// tenantRow is one tenant from tenant_routing.
type tenantRow struct {
	id, slug, database string
	schemaVersion      int64
}

func listTenants(ctx context.Context, control *sql.DB) ([]tenantRow, error) {
	rows, err := control.QueryContext(ctx, `
select t.id::text, t.slug, r.database_name, r.schema_version
  from tenant_routing r join tenants t on t.id = r.tenant_id
 order by t.created_at, t.id`)
	if err != nil {
		return nil, fmt.Errorf("list tenants: %w", err)
	}
	defer rows.Close()
	var list []tenantRow
	for rows.Next() {
		var r tenantRow
		if err := rows.Scan(&r.id, &r.slug, &r.database, &r.schemaVersion); err != nil {
			return nil, fmt.Errorf("list tenants: %w", err)
		}
		list = append(list, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list tenants: %w", err)
	}
	return list, nil
}

// openTenant connects to a tenant DB with the migrator credentials.
func openTenant(ctx context.Context, e env, database string) (*sql.DB, error) {
	dsn, err := migrations.TenantDSN(e["MIGRATOR_DB_URL"], e["TENANT_DB_HOST"], database)
	if err != nil {
		return nil, fail(exitConfig, "MIGRATOR_DB_URL: %v", err)
	}
	return open(ctx, "tenant DB "+database, dsn)
}

// tenantsUp migrates every tenant DB to the latest version, one by one, recording tenant_routing.schema_version
// and a platform_audit row per tenant. It stops at the first failure.
func tenantsUp(ctx context.Context, e env, out io.Writer) (int, error) {
	dsn, err := e.require("MIGRATOR_DB_URL")
	if err != nil {
		return 0, err
	}
	control, err := open(ctx, "MIGRATOR_DB_URL", dsn)
	if err != nil {
		return 0, err
	}
	defer control.Close()
	list, err := listTenants(ctx, control)
	if err != nil {
		return 0, err
	}
	runID := newRunID()
	migrated := 0
	for _, t := range list {
		res, err := migrateTenant(ctx, e, t)
		if auditErr := audit(ctx, e, control, runID, t, res, err); auditErr != nil && err == nil {
			err = auditErr
		}
		if err != nil {
			return migrated, fmt.Errorf("tenant %s (%s): %w", t.slug, t.database, err)
		}
		fmt.Fprintf(out, "tenant %s (%s): %d → %d\n", t.slug, t.database, res.From, res.To)
		migrated++
	}
	fmt.Fprintf(out, "tenants: %d migrated (run %s)\n", migrated, runID)
	return migrated, nil
}

func migrateTenant(ctx context.Context, e env, t tenantRow) (migrations.Result, error) {
	db, err := openTenant(ctx, e, t.database)
	if err != nil {
		return migrations.Result{}, err
	}
	defer db.Close()
	return migrations.Up(ctx, db, migrations.Tenant)
}

// audit records the run in tenant_routing (on success) and platform_audit (control_0001_init.sql:148).
func audit(ctx context.Context, e env, control *sql.DB, runID string, t tenantRow, res migrations.Result, runErr error) error {
	details := map[string]any{"database": t.database, "from": res.From, "to": res.To}
	result := "ok"
	if runErr != nil {
		result = "failed"
		details["error"] = e.redact(runErr.Error()) // defence in depth: errors carry no DSN (open)
	} else if _, err := control.ExecContext(ctx,
		`update tenant_routing set schema_version = $2, updated_at = now() where tenant_id = $1`, t.id, res.To); err != nil {
		return fmt.Errorf("update tenant_routing: %w", err)
	}
	b, err := json.Marshal(details)
	if err != nil {
		return fmt.Errorf("audit details: %w", err)
	}
	if _, err := control.ExecContext(ctx, `
insert into platform_audit (actor_kind, action, target_type, target_id, result, request_id, details)
values ('system', 'tenant.schema.migrate', 'tenant', $1, $2, $3, $4::jsonb)`,
		t.id, result, runID, string(b)); err != nil {
		return fmt.Errorf("platform_audit: %w", err)
	}
	return nil
}

// tenantsStatus prints routing and actual versions; drift = they differ (or the DB is unreachable).
func tenantsStatus(ctx context.Context, e env, out io.Writer, failOnDrift bool) error {
	dsn, err := e.require("MIGRATOR_DB_URL")
	if err != nil {
		return err
	}
	control, err := open(ctx, "MIGRATOR_DB_URL", dsn)
	if err != nil {
		return err
	}
	defer control.Close()
	list, err := listTenants(ctx, control)
	if err != nil {
		return err
	}
	tw := tabwriter.NewWriter(out, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "slug\tdatabase\trouting\tactual\tdrift")
	drift := 0
	for _, t := range list {
		actual := "n/a"
		isDrift := true
		if v, err := tenantVersion(ctx, e, t.database); err == nil {
			actual = strconv.FormatInt(v, 10)
			isDrift = v != t.schemaVersion
		}
		if isDrift {
			drift++
		}
		fmt.Fprintf(tw, "%s\t%s\t%d\t%s\t%t\n", t.slug, t.database, t.schemaVersion, actual, isDrift)
	}
	if err := tw.Flush(); err != nil {
		return err
	}
	if failOnDrift && drift > 0 {
		return fail(exitDrift, "%d tenant(s) drifted from tenant_routing.schema_version", drift)
	}
	return nil
}

func tenantVersion(ctx context.Context, e env, database string) (int64, error) {
	db, err := openTenant(ctx, e, database)
	if err != nil {
		return 0, err
	}
	defer db.Close()
	return migrations.Version(ctx, db, migrations.Tenant)
}

// ensureRoles creates the Ortus roles and makes ortus_migrator the owner of the control DB (dev).
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
	fmt.Fprintf(out, "roles: ensured (%s, %s, %s, %s); %s owner %s\n", migrations.RoleMigrator, migrations.RoleAPI,
		migrations.RoleWorker, migrations.RoleProvisioner, controlDB, migrations.RoleMigrator)
	return nil
}

// allUp is «make migrate»: roles (when PG_SUPER_URL is set), control DB, every tenant DB.
func allUp(ctx context.Context, e env, out io.Writer) error {
	if e["PG_SUPER_URL"] != "" {
		if err := ensureRoles(ctx, e, out); err != nil {
			return err
		}
	}
	if err := migrateOne(ctx, e, out, cmdControl, "", command{name: cmdControl, action: actUp, to: -1}); err != nil {
		return err
	}
	_, err := tenantsUp(ctx, e, out)
	return err
}

func newRunID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "migrate-unknown"
	}
	return "migrate-" + hex.EncodeToString(b)
}
