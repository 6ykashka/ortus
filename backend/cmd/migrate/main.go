// Command migrate applies the goose migrations of the control DB and of every tenant DB (W0.06).
//
// The canary → batches migration controller with sentinel checks is W1.02; here tenants are migrated
// one by one in tenant_routing order. See usage below and deploy/compose/README.md.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// Exit codes (stable contract, used by scripts and CI).
const (
	exitOK          = 0
	exitFailed      = 1 // a migration failed
	exitUsage       = 2 // wrong arguments
	exitDrift       = 3 // tenants status --fail-on-drift found a drift
	exitConfig      = 4 // missing or wrong environment, no connection
	exitNotMigrator = 5 // the connection does not run as ortus_migrator
)

const usage = `migrate — миграции control DB и tenant DB Ортус (goose)

migrate control up [--to N] | down --to N --yes | status
migrate tenant  up [--to N] | down --to N --yes | status   --db <database_name>
migrate tenants up | status [--fail-on-drift]   (все БД из tenant_routing, по порядку created_at)
migrate roles   ensure                          (PG_SUPER_URL; dev: роли и владелец control DB)
migrate all     up                              (roles ensure при PG_SUPER_URL → control up → tenants up)
down удаляет схемы и данные: нужен --yes; при APP_ENV=prod|production down запрещён (откат — контроллер W1.02).
Переменные: APP_ENV, MIGRATOR_DB_URL, TENANT_DB_HOST, PG_SUPER_URL, PG_MIGRATOR_PASS, PG_API_PASS, PG_WORKER_PASS, PG_PROVISIONER_PASS
Коды выхода: 0 ок · 1 ошибка миграции · 2 неверные аргументы · 3 дрейф · 4 конфигурация или соединение · 5 не ortus_migrator
`

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	code := run(ctx, os.Args[1:], os.Getenv, os.Stdout, os.Stderr)
	stop()
	os.Exit(code)
}

// cliError carries an exit code; its message is printed to stderr.
type cliError struct {
	code int
	err  error
}

func (e *cliError) Error() string { return e.err.Error() }
func (e *cliError) Unwrap() error { return e.err }

func fail(code int, format string, args ...any) error {
	return &cliError{code: code, err: fmt.Errorf(format, args...)}
}

// run is the testable entry point: arguments, environment lookup and output streams are injected.
func run(ctx context.Context, args []string, getenv func(string) string, stdout, stderr io.Writer) int {
	env := newEnv(getenv)
	red := newRedactor(env)
	out := &redactWriter{w: stdout, r: red}
	errOut := &redactWriter{w: stderr, r: red}

	if len(args) == 1 && (args[0] == "-h" || args[0] == "--help" || args[0] == "help") {
		_, _ = io.WriteString(out, usage)
		return exitOK
	}
	cmd, err := parse(args)
	if err == nil {
		err = cmd.exec(ctx, env, out)
	}
	if err == nil {
		return exitOK
	}
	fmt.Fprintf(errOut, "migrate: %v\n", err)
	var ce *cliError
	switch {
	case errors.As(err, &ce):
		if ce.code == exitUsage {
			_, _ = io.WriteString(errOut, "\n"+usage)
		}
		return ce.code
	case errors.Is(err, migrations.ErrNotMigrator):
		return exitNotMigrator
	default:
		return exitFailed
	}
}
