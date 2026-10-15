// Package provisioning creates tenants (W1.02, S1-01): the API registers a tenant in the control DB (state
// provisioning, route, audit); the provisioner process creates its database as ortus_provisioner, grants CONNECT
// explicitly (PUBLIC has none, Q-W0.06-2), migrates it through the migration controller (sentinel), writes the
// initial data and moves the tenant to trial. Every step is idempotent, so a failed run is resumed by the next one.
package provisioning

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// grantSetRole lets ortus_provisioner run CREATE DATABASE … OWNER ortus_migrator, which needs the right to SET ROLE
// to the owner (PostgreSQL 16+). INHERIT FALSE only means the privileges are not used implicitly. SET TRUE makes
// the provisioner role EQUIVALENT to the migrator: a session as ortus_provisioner may SET ROLE ortus_migrator
// (in the maintenance database it can then grant itself CONNECT on any tenant database the migrator owns, or drop
// it). Accepted risk, recorded for the security owner (report W1.02, «Возврат 1»): the provisioner process holds
// MIGRATOR_DB_URL anyway, so PROVISIONER_DB_URL must be protected like MIGRATOR_DB_URL. What the code does keep:
// ortus_provisioner has no CONNECT on tenant databases (provisioner.go, grantConnect), so it reads no tenant data
// without an explicit SET ROLE.
var grantSetRole = fmt.Sprintf(`grant %s to %s with inherit false, set true`, migrations.RoleMigrator, migrations.RoleProvisioner)

// EnsureRoleGrants gives ortus_provisioner its membership in ortus_migrator. It is idempotent and runs as a
// superuser (dev, tests) or a DBA (stage, prod), after migrations.EnsureRoles.
func EnsureRoleGrants(ctx context.Context, super *sql.DB) error {
	var err error
	for attempt := range 10 {
		if _, err = super.ExecContext(ctx, grantSetRole); err == nil || !catalogRace(err) {
			break
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Duration(attempt+1) * 50 * time.Millisecond):
		}
	}
	if err != nil {
		return fmt.Errorf("provisioning: %s: %w", grantSetRole, err)
	}
	return nil
}

// catalogRace reports a concurrent change of the same pg_auth_members row (several suites ensure the roles of one
// cluster at once).
func catalogRace(err error) bool {
	pgErr, ok := errors.AsType[*pgconn.PgError](err)
	if !ok {
		return false
	}
	return pgErr.Code == "23505" || (pgErr.Code == "XX000" && strings.HasPrefix(pgErr.Message, "tuple concurrently "))
}
