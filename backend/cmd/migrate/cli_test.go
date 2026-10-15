package main

import (
	"bytes"
	"strings"
	"testing"
)

// invoke runs the CLI with an environment map and returns the exit code, stdout and stderr.
func invoke(t *testing.T, env map[string]string, args ...string) (code int, stdout, stderr string) {
	t.Helper()
	var out, errOut bytes.Buffer
	code = run(t.Context(), args, func(k string) string { return env[k] }, &out, &errOut)
	return code, out.String(), errOut.String()
}

func TestHelp(t *testing.T) {
	t.Parallel()
	for _, args := range [][]string{{"--help"}, {"-h"}, {"help"}} {
		code, out, _ := invoke(t, nil, args...)
		if code != exitOK {
			t.Errorf("%v: code %d, want 0", args, code)
		}
		if first, _, _ := strings.Cut(out, "\n"); first != "migrate — миграции control DB и tenant DB Ортус (goose + контроллер canary → партии)" {
			t.Errorf("%v: first line %q", args, first)
		}
		for _, want := range []string{"migrate control", "migrate tenants", "migrate roles", "migrate all", "--yes", "APP_ENV", "Коды выхода",
			"--canary", "--batch", "--dry-run", "--continue-on-failure", "6 canary", "dev|test|e2e"} {
			if !strings.Contains(out, want) {
				t.Errorf("%v: help lacks %q", args, want)
			}
		}
	}
}

func TestUsageErrors(t *testing.T) {
	t.Parallel()
	env := map[string]string{"MIGRATOR_DB_URL": "postgres://ortus_migrator:x@127.0.0.1:1/ortus_control"} //nolint:gosec // G101: fake test DSN
	cases := []struct {
		name string
		args []string
		want string
	}{
		{"no args", nil, "usage"},
		{"unknown command", []string{"frobnicate"}, "unknown command"},
		{"unknown action", []string{"control", "sideways"}, "unknown action"},
		{"down without --to", []string{"control", "down"}, "--to"},
		{"tenant without --db", []string{"tenant", "up"}, "--db"},
		{"--to not a number", []string{"control", "up", "--to", "three"}, "--to"},
		{"negative --to", []string{"control", "down", "--to", "-1", "--yes"}, "--to"},
		{"control down without --yes", []string{"control", "down", "--to", "0"}, "--yes"},
		{"tenant down without --yes", []string{"tenant", "down", "--db", "t_x", "--to", "1"}, "--yes"},
		{"--yes is only for down", []string{"control", "up", "--yes"}, "-yes"},
		{"tenants down without --canary", []string{"tenants", "down", "--to", "1", "--yes"}, "--canary"},
		{"tenants down without --yes", []string{"tenants", "down", "--to", "1", "--canary", "alta"}, "--yes"},
		{"tenants down without --to", []string{"tenants", "down", "--canary", "alta", "--yes"}, "--to"},
		{"empty canary slug", []string{"tenants", "up", "--canary", "alta,"}, "--canary"},
		{"--batch not a number", []string{"tenants", "up", "--batch", "many"}, "--batch"},
		{"--batch zero", []string{"tenants", "up", "--batch", "0"}, "--batch"},
		{"--dry-run is only for up", []string{"tenants", "status", "--dry-run"}, "-dry-run"},
		{"stray argument", []string{"control", "up", "extra"}, "unexpected argument"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			code, _, errOut := invoke(t, env, tc.args...)
			if code != exitUsage {
				t.Errorf("code %d, want %d", code, exitUsage)
			}
			if !strings.Contains(errOut, tc.want) {
				t.Errorf("stderr %q lacks %q", errOut, tc.want)
			}
		})
	}
}

func TestConfigErrors(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		env  map[string]string
		args []string
		want string
	}{
		{"no MIGRATOR_DB_URL", nil, []string{"control", "up"}, "MIGRATOR_DB_URL"},
		{"bad MIGRATOR_DB_URL", map[string]string{"MIGRATOR_DB_URL": "::not a url"}, []string{"control", "status"}, "MIGRATOR_DB_URL"},
		{"roles without PG_SUPER_URL", map[string]string{"MIGRATOR_DB_URL": "postgres://m@h/db"}, []string{"roles", "ensure"}, "PG_SUPER_URL"},
		{"roles without passwords", map[string]string{
			"MIGRATOR_DB_URL": "postgres://m@h/db", "PG_SUPER_URL": "postgres://s@h/db",
		}, []string{"roles", "ensure"}, "PG_MIGRATOR_PASS"},
		// Откат 0001 — drop schema … cascade: в prod только forward-fix новой миграцией (Q-W0.06-4).
		{"down in prod", map[string]string{"MIGRATOR_DB_URL": "postgres://m@h/db", "APP_ENV": "prod"},
			[]string{"control", "down", "--to", "0", "--yes"}, "APP_ENV=prod"},
		{"tenant down in production", map[string]string{"MIGRATOR_DB_URL": "postgres://m@h/db", "APP_ENV": "production"},
			[]string{"tenant", "down", "--db", "t_x", "--to", "1", "--yes"}, "APP_ENV=production"},
		{"tenants down in prod", map[string]string{"MIGRATOR_DB_URL": "postgres://m@h/db", "APP_ENV": "prod"},
			[]string{"tenants", "down", "--to", "1", "--canary", "alta", "--yes"}, "APP_ENV=prod"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			code, _, errOut := invoke(t, tc.env, tc.args...)
			if code != exitConfig {
				t.Errorf("code %d, want %d (stderr %q)", code, exitConfig, errOut)
			}
			if !strings.Contains(errOut, tc.want) {
				t.Errorf("stderr %q lacks %q", errOut, tc.want)
			}
		})
	}
}

// Нет соединения — код 4; пароль из DSN не попадает в вывод (14-engineering «Логи»). Текст ошибки называет
// переменную, хост и базу, но не DSN: та же ошибка уходит в platform_audit мимо маскирования вывода.
func TestUnreachableDatabaseRedactsSecrets(t *testing.T) {
	t.Parallel()
	env := map[string]string{ //nolint:gosec // G101: fake test DSN
		"MIGRATOR_DB_URL":  "postgres://ortus_migrator:s3cr3t-pass@127.0.0.1:1/ortus_control?sslmode=disable&connect_timeout=2",
		"PG_MIGRATOR_PASS": "s3cr3t-pass",
	}
	code, out, errOut := invoke(t, env, "control", "status")
	if code != exitConfig {
		t.Errorf("code %d, want %d", code, exitConfig)
	}
	if strings.Contains(out+errOut, "s3cr3t-pass") {
		t.Errorf("secret leaked: %q %q", out, errOut)
	}
	if !strings.Contains(errOut, "connect MIGRATOR_DB_URL (127.0.0.1:1/ortus_control)") {
		t.Errorf("stderr should name the variable, host and database, got %q", errOut)
	}
	if strings.Contains(errOut, "postgres://") {
		t.Errorf("stderr should not carry the DSN, got %q", errOut)
	}
}

// Ошибка соединения не несёт DSN даже до маскирования вывода.
func TestOpenErrorHasNoDSN(t *testing.T) {
	t.Parallel()
	const dsn = "postgres://ortus_migrator:s3cr3t-pass@127.0.0.1:1/t_ghost?sslmode=disable&connect_timeout=2" //nolint:gosec // G101: fake test DSN
	db, err := open(t.Context(), "tenant DB t_ghost", dsn)
	if err == nil {
		_ = db.Close()
		t.Fatal("open succeeded on port 1")
	}
	msg := err.Error()
	for _, s := range []string{"s3cr3t-pass", "postgres://", "ortus_migrator:"} {
		if strings.Contains(msg, s) {
			t.Errorf("error %q contains %q", msg, s)
		}
	}
	if !strings.Contains(msg, "127.0.0.1:1/t_ghost") {
		t.Errorf("error %q should name host and database", msg)
	}
}

func TestRedact(t *testing.T) {
	t.Parallel()
	r := newRedactor(map[string]string{ //nolint:gosec // G101: fake test DSN
		"MIGRATOR_DB_URL": "postgres://ortus_migrator:p%40ss@h/db",
		"PG_API_PASS":     "api-secret",
		"PG_WORKER_PASS":  "",
	})
	in := "dial postgres://ortus_migrator:p%40ss@h/db as api-secret / p@ss" //nolint:gosec // G101: fake test DSN
	got := r.Replace(in)
	for _, s := range []string{"p%40ss", "p@ss", "api-secret"} {
		if strings.Contains(got, s) {
			t.Errorf("%q still contains %q", got, s)
		}
	}
}

// Простой dev-пароль («postgres») маскируется как слово, а не как подстрока: схема URL и имена остаются
// читаемыми. Пароль любого DSN маскируется, даже если переменная неизвестна.
func TestRedactKeepsTextReadable(t *testing.T) {
	t.Parallel()
	r := newRedactor(map[string]string{ //nolint:gosec // G101: fake test DSN
		"PG_SUPER_URL":   "postgres://postgres:postgres@h/postgres",
		"PG_WORKER_PASS": "work",
	})
	cases := map[string]string{ //nolint:gosec // G101: fake test passwords
		"connect postgres://ortus_migrator:other@h:5432/postgres?sslmode=disable": "connect postgres://ortus_migrator:***@h:5432/postgres?sslmode=disable",
		"password postgres rejected":                        "password *** rejected",
		"user=postgres database=postgres password=postgres": "user=postgres database=postgres password=***",
		"host=h password='two words'":                       "host=h password=***",
		"worker and ortus_worker: work":                     "worker and ortus_worker: ***",
		"(work)":                                            "(***)",
	}
	for in, want := range cases {
		if got := r.Replace(in); got != want {
			t.Errorf("Replace(%q) = %q, want %q", in, got, want)
		}
	}
}

// Down-guard по allowlist (W1.02): откат разрешён только при APP_ENV ∈ {dev, test, e2e}. Пустое значение, stage,
// иное написание prod — отказ с кодом 4 до соединения (запрет по списку «prod|production» пропускал «Prod», «prd»).
func TestDownGuard(t *testing.T) {
	t.Parallel()
	downs := [][]string{
		{"control", "down", "--to", "0", "--yes"},
		{"tenant", "down", "--db", "t_x", "--to", "1", "--yes"},
		{"tenants", "down", "--to", "1", "--canary", "alta", "--yes"},
	}
	for _, appEnv := range []string{"", "stage", "staging", "Prod", "PRODUCTION", "prd", "development", "Dev"} {
		for _, args := range downs {
			env := map[string]string{"MIGRATOR_DB_URL": "postgres://m@127.0.0.1:1/db", "APP_ENV": appEnv}
			code, _, errOut := invoke(t, env, args...)
			if code != exitConfig || !strings.Contains(errOut, "dev|test|e2e") {
				t.Errorf("APP_ENV=%q %v: code %d, stderr %q", appEnv, args, code, errOut)
			}
		}
	}
	// Allowed environments pass the guard and fail later, on the missing configuration.
	for _, appEnv := range []string{"dev", "test", "e2e"} {
		for _, args := range downs {
			code, _, errOut := invoke(t, map[string]string{"APP_ENV": appEnv}, args...)
			if code != exitConfig || !strings.Contains(errOut, "MIGRATOR_DB_URL") || strings.Contains(errOut, "dev|test|e2e") {
				t.Errorf("APP_ENV=%s %v: code %d, stderr %q", appEnv, args, code, errOut)
			}
		}
	}
}
