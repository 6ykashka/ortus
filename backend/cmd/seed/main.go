// Command seed fills the local stand with the demo holding of the prototype (design/ortus/mock-data.js):
// the platform (control DB), «Альта Групп» and SPA «Лотос» (one tenant DB each). It is idempotent.
//
// Identifiers are UUID v5 of the prototype ids (PD-30, see seedID). The seed grows by one file per module
// (cmd/seed/<m>.go, plan §3.5); this skeleton (W0.06) covers the platform, org structure and people.
//
// Environment: MIGRATOR_DB_URL (control DB as ortus_migrator), PG_SUPER_URL (dev: create tenant databases),
// TENANT_DB_HOST (optional host:port of tenant DBs). Exit codes: 0 ok · 1 failed · 4 configuration or connection.
package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"

	_ "github.com/jackc/pgx/v5/stdlib" // database/sql driver "pgx"

	"github.com/ortus/ortus-crm/backend/migrations"
)

const (
	exitOK     = 0
	exitFailed = 1
	exitConfig = 4
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	code := run(ctx, os.Args[1:], os.Getenv, os.Stdout, os.Stderr)
	stop()
	os.Exit(code)
}

// configError marks failures that are fixed by the environment, not by the code (exit 4).
type configError struct{ msg string }

func (e *configError) Error() string { return e.msg }

func configErr(format string, args ...any) error {
	return &configError{msg: fmt.Sprintf(format, args...)}
}

func run(ctx context.Context, args []string, getenv func(string) string, stdout, stderr io.Writer) int {
	if len(args) > 0 {
		fmt.Fprintf(stderr, "seed: unexpected argument %q (seed takes no arguments)\n", args[0])
		return exitConfig
	}
	err := seed(ctx, getenv, stdout)
	if err == nil {
		return exitOK
	}
	fmt.Fprintf(stderr, "seed: %v\n", err)
	if ce := (*configError)(nil); errors.As(err, &ce) {
		return exitConfig
	}
	return exitFailed
}

func seed(ctx context.Context, getenv func(string) string, out io.Writer) error {
	migDSN, superDSN := getenv("MIGRATOR_DB_URL"), getenv("PG_SUPER_URL")
	if migDSN == "" {
		return configErr("MIGRATOR_DB_URL is not set (see deploy/compose/.env.example)")
	}
	if superDSN == "" {
		return configErr("PG_SUPER_URL is not set: in dev the seed creates tenant databases t_alta, t_lotos")
	}
	control, err := open(ctx, "MIGRATOR_DB_URL", migDSN)
	if err != nil {
		return err
	}
	defer control.Close()
	v, err := migrations.Version(ctx, control, migrations.Control)
	if err != nil {
		return configErr("control DB: %v", err)
	}
	if latest := migrations.Latest(migrations.Control); v != latest {
		return configErr("control DB is at version %d, want %d: run `node deploy/compose/stand.mjs migrate` (migrate all up) first", v, latest)
	}

	if err := seedPlatform(ctx, control); err != nil {
		return err
	}
	// Operators have accounts too (issuer urn:ortus:dev-operators): the accounts total includes them.
	fmt.Fprintf(out, "platform: %d tenants, %d accounts (%d users, %d operators), %d memberships\n",
		len(tenants), len(accounts)+len(operators), len(accounts), len(operators), len(memberships()))

	super, err := open(ctx, "PG_SUPER_URL", superDSN)
	if err != nil {
		return err
	}
	defer super.Close()
	for _, td := range tenantDBs() {
		dsn, err := migrations.TenantDSN(migDSN, getenv("TENANT_DB_HOST"), td.tenant.database)
		if err != nil {
			return configErr("MIGRATOR_DB_URL: %v", err)
		}
		res, err := seedTenantDB(ctx, super, control, dsn, td)
		if err != nil {
			return fmt.Errorf("tenant %s (%s): %w", td.tenant.slug, td.tenant.database, err)
		}
		fmt.Fprintf(out, "tenant %s (%s): %d units, %d people (schema %d → %d)\n",
			td.tenant.slug, td.tenant.database, len(td.units), len(td.members), res.From, res.To)
	}
	return nil
}

// open connects to dsn; DSNs are never printed (they carry passwords).
func open(ctx context.Context, name, dsn string) (*sql.DB, error) {
	if u, err := url.Parse(dsn); err != nil || !strings.HasPrefix(u.Scheme, "postgres") {
		return nil, configErr("%s is not a postgres:// URL", name)
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, configErr("%s: %v", name, err)
	}
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, configErr("connect %s: %v", name, err)
	}
	return db, nil
}
