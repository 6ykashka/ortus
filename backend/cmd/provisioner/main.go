// Command provisioner creates the databases of new tenants (W1.02, S1-01). The API only registers a tenant in the
// control DB (state provisioning); this separate process holds the CREATE DATABASE role (ortus_provisioner) and
// the migrator credentials, which the API never has (02-architecture §2). It runs the saga of package provisioning
// for every pending tenant: database → grants → migrate → bootstrap → activate.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/signal"
	"regexp"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/control/provisioning"
	"github.com/ortus/ortus-crm/backend/internal/control/tenants"
	"github.com/ortus/ortus-crm/backend/migrations"
)

// Exit codes (as cmd/migrate).
const (
	exitOK     = 0
	exitFailed = 1 // a tenant could not be provisioned
	exitUsage  = 2 // wrong arguments or an invalid request
	exitConfig = 4 // missing or wrong environment, no connection
)

const defaultInterval = 10 * time.Second

const usage = `provisioner — создание организаций Ортус: база данных, sentinel, миграции

provisioner create --name "…" --owner-email … --time-zone Europe/Moscow --plan … [--key …]
                                  регистрирует организацию (как createPlatformTenant) и сразу создаёт её базу
provisioner run [--once] [--interval 10s]
                                  доводит организации в состоянии provisioning; без --once — по кругу до сигнала
Шаги: database → grants → migrate → bootstrap → activate; упавший шаг повторяется следующим запуском.
Переменные: MIGRATOR_DB_URL (control DB, ortus_migrator), PROVISIONER_DB_URL (служебная БД, ortus_provisioner),
TENANT_DB_HOST, TENANT_SECRET_REF (по умолчанию env:TENANT_DB_URL), PROVISIONER_CONNECT_ROLES (по умолчанию pg_monitor, «-» — никого; ortus_provisioner CONNECT не получает)
Коды выхода: 0 ок · 1 организация не создана · 2 неверные аргументы · 4 конфигурация или соединение
`

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	code := run(ctx, os.Args[1:], os.Getenv, os.Stdout, os.Stderr)
	stop()
	os.Exit(code)
}

type cliError struct {
	code int
	err  error
}

func (e *cliError) Error() string { return e.err.Error() }
func (e *cliError) Unwrap() error { return e.err }

func fail(code int, format string, args ...any) error {
	return &cliError{code: code, err: fmt.Errorf(format, args...)}
}

// run is the testable entry point.
func run(ctx context.Context, args []string, getenv func(string) string, stdout, stderr io.Writer) int {
	red := newRedactor(getenv)
	out, errOut := &redactWriter{w: stdout, r: red}, &redactWriter{w: stderr, r: red}
	if len(args) == 1 && (args[0] == "-h" || args[0] == "--help" || args[0] == "help") {
		_, _ = io.WriteString(out, usage)
		return exitOK
	}
	err := dispatch(ctx, args, getenv, out, errOut)
	if err == nil {
		return exitOK
	}
	fmt.Fprintf(errOut, "provisioner: %v\n", err)
	if ce, ok := errors.AsType[*cliError](err); ok {
		if ce.code == exitUsage {
			_, _ = io.WriteString(errOut, "\n"+usage)
		}
		return ce.code
	}
	return exitFailed
}

func dispatch(ctx context.Context, args []string, getenv func(string) string, out, errOut io.Writer) error {
	if len(args) == 0 {
		return fail(exitUsage, "usage: provisioner <create|run> [flags]")
	}
	switch args[0] {
	case "create":
		req, err := parseCreate(args[1:])
		if err != nil {
			return err
		}
		return create(ctx, getenv, out, req)
	case "run":
		once, interval, err := parseRun(args[1:])
		if err != nil {
			return err
		}
		return loop(ctx, getenv, out, errOut, once, interval)
	}
	return fail(exitUsage, "unknown command %q", args[0])
}

func newFlags(name string) *flag.FlagSet {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	return fs
}

func parseArgs(fs *flag.FlagSet, args []string) error {
	if err := fs.Parse(args); err != nil {
		return fail(exitUsage, "%s: %v", fs.Name(), err)
	}
	if fs.NArg() > 0 {
		return fail(exitUsage, "%s: unexpected argument %q", fs.Name(), fs.Arg(0))
	}
	return nil
}

func parseCreate(args []string) (provisioning.Request, error) {
	var req provisioning.Request
	fs := newFlags("create")
	fs.StringVar(&req.Name, "name", "", "tenant name")
	fs.StringVar(&req.OwnerEmail, "owner-email", "", "e-mail of the owner-to-be")
	fs.StringVar(&req.TimeZone, "time-zone", "", "IANA time zone")
	fs.StringVar(&req.PlanKey, "plan", "", "plan key")
	fs.StringVar(&req.IdempotencyKey, "key", "", "idempotency key (default: random)")
	if err := parseArgs(fs, args); err != nil {
		return req, err
	}
	if req.IdempotencyKey == "" {
		req.IdempotencyKey = "cli-" + strings.ReplaceAll(uuid.NewString(), "-", "")
	}
	if err := req.Validate(); err != nil {
		return req, fail(exitUsage, "create: %v", err)
	}
	return req, nil
}

func parseRun(args []string) (once bool, interval time.Duration, err error) {
	fs := newFlags("run")
	fs.BoolVar(&once, "once", false, "one pass")
	every := fs.String("interval", defaultInterval.String(), "pause between passes")
	if err := parseArgs(fs, args); err != nil {
		return false, 0, err
	}
	interval, perr := time.ParseDuration(*every)
	if perr != nil || interval <= 0 {
		return false, 0, fail(exitUsage, "run: --interval must be a positive duration, got %q", *every)
	}
	return once, interval, nil
}

// connections opens the control DB (migrator) and the maintenance DB (provisioner) and builds the provisioner.
func connections(ctx context.Context, getenv func(string) string) (*provisioning.Provisioner, func(), error) {
	migDSN, provDSN := strings.TrimSpace(getenv("MIGRATOR_DB_URL")), strings.TrimSpace(getenv("PROVISIONER_DB_URL"))
	for name, v := range map[string]string{"MIGRATOR_DB_URL": migDSN, "PROVISIONER_DB_URL": provDSN} {
		if v == "" {
			return nil, nil, fail(exitConfig, "%s is not set (see deploy/compose/.env.example)", name)
		}
	}
	u, err := url.Parse(migDSN)
	if err != nil {
		return nil, nil, fail(exitConfig, "MIGRATOR_DB_URL is not a URL")
	}
	control, err := tenants.OpenDB(ctx, "MIGRATOR_DB_URL", migDSN)
	if err != nil {
		return nil, nil, &cliError{code: exitConfig, err: err}
	}
	admin, err := tenants.OpenDB(ctx, "PROVISIONER_DB_URL", provDSN)
	if err != nil {
		_ = control.Close()
		return nil, nil, &cliError{code: exitConfig, err: err}
	}
	roles := connectRoles(getenv("PROVISIONER_CONNECT_ROLES"))
	red := newRedactor(getenv)
	p := &provisioning.Provisioner{
		Control:      control,
		Admin:        admin,
		Connect:      tenants.DSNConnector{DSN: migDSN, Host: getenv("TENANT_DB_HOST"), Reserved: []string{strings.TrimPrefix(u.Path, "/")}},
		ConnectRoles: roles,
		Redact:       red.Replace,
	}
	return p, func() { _ = admin.Close(); _ = control.Close() }, nil
}

// connectRoles lists the monitoring roles that get CONNECT on a new tenant database (comma separated, default
// pg_monitor; «-» — none). ortus_provisioner is dropped from the list: it never gets CONNECT on a tenant database.
func connectRoles(list string) []string {
	roles := []string{}
	switch list = strings.TrimSpace(list); list {
	case "":
		list = "pg_monitor"
	case "-":
		return roles
	}
	for r := range strings.SplitSeq(list, ",") {
		if r = strings.TrimSpace(r); r != "" && r != migrations.RoleProvisioner {
			roles = append(roles, r)
		}
	}
	return roles
}

func create(ctx context.Context, getenv func(string) string, out io.Writer, req provisioning.Request) error {
	p, closeFn, err := connections(ctx, getenv)
	if err != nil {
		return err
	}
	defer closeFn()
	reg := provisioning.Registrar{Control: p.Control, SecretRef: getenv("TENANT_SECRET_REF")}
	tn, replayed, err := reg.Register(ctx, req)
	if err != nil {
		return err
	}
	o, err := p.Provision(ctx, tn.ID)
	if err != nil {
		return err
	}
	note := ""
	if replayed {
		note = ", replayed"
	}
	fmt.Fprintf(out, "tenant %s (%s): %s, schema %d (id %s%s)\n", o.Slug, o.Database, o.State, o.SchemaVersion, o.TenantID, note)
	return nil
}

func loop(ctx context.Context, getenv func(string) string, out, errOut io.Writer, once bool, interval time.Duration) error {
	p, closeFn, err := connections(ctx, getenv)
	if err != nil {
		return err
	}
	defer closeFn()
	for {
		s, err := p.RunOnce(ctx)
		if err != nil && !errors.Is(err, context.Canceled) {
			return err
		}
		for _, e := range s.Errors {
			fmt.Fprintf(errOut, "provisioner: %v\n", e)
		}
		fmt.Fprintf(out, "provisioner: %d provisioned, %d failed\n", s.Provisioned, s.Failed)
		if once {
			if s.Failed > 0 {
				return fmt.Errorf("%d tenant(s) failed", s.Failed)
			}
			return nil
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(interval):
		}
	}
}

// redactor masks the passwords of the DSNs of the environment and of any URL in text.
type redactor struct{ secrets []string }

var urlPassword = regexp.MustCompile(`([A-Za-z][A-Za-z0-9+.-]*://[^\s:/?#@]*):[^\s@/]*@`)

func newRedactor(getenv func(string) string) *redactor {
	r := &redactor{}
	for _, k := range []string{"MIGRATOR_DB_URL", "PROVISIONER_DB_URL"} {
		if u, err := url.Parse(getenv(k)); err == nil && u.User != nil {
			if p, ok := u.User.Password(); ok && len(p) >= 3 {
				r.secrets = append(r.secrets, p, url.QueryEscape(p))
			}
		}
	}
	return r
}

// Replace masks secrets in s.
func (r *redactor) Replace(s string) string {
	s = urlPassword.ReplaceAllString(s, "$1:***@")
	for _, secret := range r.secrets {
		s = strings.ReplaceAll(s, secret, "***")
	}
	return s
}

type redactWriter struct {
	w io.Writer
	r *redactor
}

func (rw *redactWriter) Write(p []byte) (int, error) {
	if _, err := io.WriteString(rw.w, rw.r.Replace(string(p))); err != nil {
		return 0, err
	}
	return len(p), nil
}
