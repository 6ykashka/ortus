package migrations

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/lock"
)

// Result is the version range a run moved a database through.
type Result struct{ From, To int64 }

// ErrNotMigrator is returned when the connection does not run as ortus_migrator: migrations are applied
// by the migrator role only (design/docs/db/control_0001_init.sql:4), so runtime roles never own schema objects.
var ErrNotMigrator = errors.New("migrations: connection must run as " + RoleMigrator)

// Up migrates db to the latest embedded version of kind k and re-applies runtime grants.
func Up(ctx context.Context, db *sql.DB, k Kind) (Result, error) {
	return UpTo(ctx, db, k, Latest(k))
}

// UpTo migrates db up to version v (no-op when db is already there) and re-applies runtime grants.
func UpTo(ctx context.Context, db *sql.DB, k Kind, v int64) (Result, error) {
	p, from, err := prepare(ctx, db, k)
	if err != nil {
		return Result{}, err
	}
	if from < v {
		if _, err := p.UpTo(ctx, v); err != nil {
			return Result{From: from, To: from}, fmt.Errorf("migrations: %s up to %d: %w", k, v, err)
		}
	}
	to, err := p.GetDBVersion(ctx)
	if err != nil {
		return Result{From: from}, fmt.Errorf("migrations: %s version: %w", k, err)
	}
	if err := Grant(ctx, db); err != nil {
		return Result{From: from, To: to}, err
	}
	return Result{From: from, To: to}, nil
}

// DownTo rolls db back to version v (0 = empty schema), one migration at a time.
func DownTo(ctx context.Context, db *sql.DB, k Kind, v int64) (Result, error) {
	p, from, err := prepare(ctx, db, k)
	if err != nil {
		return Result{}, err
	}
	if from > v {
		if _, err := p.DownTo(ctx, v); err != nil {
			cur, _ := p.GetDBVersion(ctx)
			return Result{From: from, To: cur}, fmt.Errorf("migrations: %s down to %d: %w", k, v, err)
		}
	}
	to, err := p.GetDBVersion(ctx)
	if err != nil {
		return Result{From: from}, fmt.Errorf("migrations: %s version: %w", k, err)
	}
	return Result{From: from, To: to}, nil
}

// Version returns the version applied to db (0 when goose_db_version does not exist yet). Any role may call it.
func Version(ctx context.Context, db *sql.DB, k Kind) (int64, error) {
	var exists bool
	if err := db.QueryRowContext(ctx, `select to_regclass('public.goose_db_version') is not null`).Scan(&exists); err != nil {
		return 0, fmt.Errorf("migrations: %s version: %w", k, err)
	}
	if !exists {
		return 0, nil
	}
	var v int64
	err := db.QueryRowContext(ctx,
		`select coalesce(max(version_id), 0) from public.goose_db_version where is_applied and version_id > 0`).Scan(&v)
	if err != nil {
		return 0, fmt.Errorf("migrations: %s version: %w", k, err)
	}
	return v, nil
}

// prepare checks the role and returns a goose provider and the current version.
func prepare(ctx context.Context, db *sql.DB, k Kind) (*goose.Provider, int64, error) {
	if err := checkMigrator(ctx, db); err != nil {
		return nil, 0, err
	}
	locker, err := lock.NewPostgresSessionLocker()
	if err != nil {
		return nil, 0, fmt.Errorf("migrations: session locker: %w", err)
	}
	// Two concurrent runs on one database are serialised by a session-level advisory lock.
	p, err := goose.NewProvider(goose.DialectPostgres, db, FS(k), goose.WithSessionLocker(locker))
	if err != nil {
		return nil, 0, fmt.Errorf("migrations: %s provider: %w", k, err)
	}
	from, err := p.GetDBVersion(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("migrations: %s version: %w", k, err)
	}
	return p, from, nil
}

func checkMigrator(ctx context.Context, db *sql.DB) error {
	var user string
	if err := db.QueryRowContext(ctx, `select current_user`).Scan(&user); err != nil {
		return fmt.Errorf("migrations: current_user: %w", err)
	}
	if user != RoleMigrator {
		return fmt.Errorf("%w (current_user is %s)", ErrNotMigrator, user)
	}
	return nil
}
