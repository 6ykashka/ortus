package migrations

import (
	"context"
	"database/sql"
	_ "embed"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

// DB roles (design/docs/14-engineering.md:81: migrator / api_runtime / worker_runtime / provisioner).
const (
	RoleMigrator    = "ortus_migrator"    // DDL; owns every Ortus database and schema object
	RoleAPI         = "ortus_api"         // DML only
	RoleWorker      = "ortus_worker"      // DML only
	RoleProvisioner = "ortus_provisioner" // CREATE DATABASE (W1.02)
)

// Passwords of the Ortus DB roles. Values come from the environment (PG_*_PASS), never from the repository.
type Passwords struct{ Migrator, API, Worker, Provisioner string }

type roleSpec struct {
	name, attrs, password string
}

func (p Passwords) specs() []roleSpec {
	const base = "login nosuperuser nocreaterole noreplication nobypassrls"
	return []roleSpec{
		{RoleMigrator, base + " nocreatedb", p.Migrator},
		{RoleAPI, base + " nocreatedb", p.API},
		{RoleWorker, base + " nocreatedb", p.Worker},
		{RoleProvisioner, base + " createdb", p.Provisioner},
	}
}

// ErrEmptyPassword is returned by EnsureRoles when a role password is not set.
var ErrEmptyPassword = errors.New("migrations: empty role password")

// EnsureRoles creates the Ortus roles or, when they exist, resets their attributes and passwords.
// It is idempotent and must run as a superuser (dev) or a DBA (stage, prod). Roles are cluster-wide, so
// concurrent calls (several agents, CI) may collide on pg_authid; such a collision is retried.
func EnsureRoles(ctx context.Context, super *sql.DB, p Passwords) error {
	for _, r := range p.specs() {
		if r.password == "" {
			return fmt.Errorf("%w: %s", ErrEmptyPassword, r.name)
		}
	}
	var err error
	for attempt := range roleAttempts {
		if err = ensureRoles(ctx, super, p); err == nil || !isCatalogRace(err) {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Duration(attempt+1) * 50 * time.Millisecond):
		}
	}
	return err
}

const roleAttempts = 10

// isCatalogRace reports a concurrent update of the same pg_authid row («tuple concurrently updated» or
// «… deleted», SQLSTATE XX000) or a role created meanwhile (42710, 23505). Other internal errors are not retried.
func isCatalogRace(err error) bool {
	pgErr, ok := errors.AsType[*pgconn.PgError](err)
	if !ok {
		return false
	}
	switch pgErr.Code {
	case "42710", "23505":
		return true
	case "XX000":
		return strings.HasPrefix(pgErr.Message, "tuple concurrently ")
	}
	return false
}

func ensureRoles(ctx context.Context, super *sql.DB, p Passwords) error {
	for _, r := range p.specs() {
		var exists bool
		if err := super.QueryRowContext(ctx, `select exists (select 1 from pg_roles where rolname = $1)`, r.name).
			Scan(&exists); err != nil {
			return fmt.Errorf("migrations: role %s: %w", r.name, err)
		}
		verb := "create"
		if exists {
			verb = "alter"
		}
		// Identifiers and the password are quoted by the server (format %I, %L); attrs are constants.
		var stmt string
		if err := super.QueryRowContext(ctx, `select format('%s role %I with `+r.attrs+` password %L', $1::text, $2::text, $3::text)`,
			verb, r.name, r.password).Scan(&stmt); err != nil {
			return fmt.Errorf("migrations: role %s: %w", r.name, err)
		}
		if _, err := super.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("migrations: %s role %s: %w", verb, r.name, err)
		}
	}
	return nil
}

// CreateDatabase creates database name owned by ortus_migrator unless it already exists (dev and tests;
// in stage and prod databases are created by the provisioner, W1.02).
func CreateDatabase(ctx context.Context, super *sql.DB, name string) error {
	var exists bool
	if err := super.QueryRowContext(ctx, `select exists (select 1 from pg_database where datname = $1)`, name).
		Scan(&exists); err != nil {
		return fmt.Errorf("migrations: database %s: %w", name, err)
	}
	if exists {
		return AdoptDatabase(ctx, super, name)
	}
	return execFormatted(ctx, super, `select format('create database %I owner %I encoding ''UTF8''', $1::text, $2::text)`,
		name, RoleMigrator)
}

// AdoptDatabase makes ortus_migrator the owner of an existing database (e.g. ortus_control created by the
// postgres image), so the migrator may create objects in its public schema (pg_database_owner, PostgreSQL 15+).
func AdoptDatabase(ctx context.Context, super *sql.DB, name string) error {
	return execFormatted(ctx, super, `select format('alter database %I owner to %I', $1::text, $2::text)`,
		name, RoleMigrator)
}

func execFormatted(ctx context.Context, db *sql.DB, format string, args ...any) error {
	var stmt string
	if err := db.QueryRowContext(ctx, format, args...).Scan(&stmt); err != nil {
		return fmt.Errorf("migrations: format statement: %w", err)
	}
	if _, err := db.ExecContext(ctx, stmt); err != nil {
		return fmt.Errorf("migrations: %s: %w", stmt, err)
	}
	return nil
}

//go:embed roles/grants.sql
var grantsSQL string

// Grant gives ortus_api and ortus_worker CONNECT and DML on every schema of the current database and makes
// goose_db_version read-only for them. It runs as ortus_migrator after every Up (objects are created by the
// migrator, so the grants of new tables follow the migration that created them).
func Grant(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, grantsSQL); err != nil {
		return fmt.Errorf("migrations: grants: %w", err)
	}
	return nil
}
