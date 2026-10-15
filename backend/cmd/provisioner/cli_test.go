package main

import (
	"bytes"
	"strings"
	"testing"
)

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
			t.Errorf("%v: code %d", args, code)
		}
		if first, _, _ := strings.Cut(out, "\n"); first != "provisioner — создание организаций Ортус: база данных, sentinel, миграции" {
			t.Errorf("%v: first line %q", args, first)
		}
		for _, want := range []string{"provisioner create", "provisioner run", "--once", "PROVISIONER_DB_URL", "MIGRATOR_DB_URL",
			"PROVISIONER_CONNECT_ROLES", "database → grants → migrate → bootstrap → activate", "Коды выхода"} {
			if !strings.Contains(out, want) {
				t.Errorf("%v: help lacks %q", args, want)
			}
		}
	}
}

func TestUsageErrors(t *testing.T) {
	t.Parallel()
	env := map[string]string{ //nolint:gosec // G101: fake test DSN
		"MIGRATOR_DB_URL":    "postgres://ortus_migrator:x@127.0.0.1:1/ortus_control",
		"PROVISIONER_DB_URL": "postgres://ortus_provisioner:x@127.0.0.1:1/postgres",
	}
	cases := []struct {
		name string
		args []string
		want string
	}{
		{"no args", nil, "usage"},
		{"unknown command", []string{"destroy"}, "unknown command"},
		{"create without name", []string{"create", "--owner-email", "o@x.example", "--time-zone", "Europe/Moscow", "--plan", "pilot"}, "name"},
		{"create with a bad e-mail", []string{"create", "--name", "Альта", "--owner-email", "nope", "--time-zone", "Europe/Moscow", "--plan", "pilot"}, "ownerEmail"},
		{"create with a bad zone", []string{"create", "--name", "Альта", "--owner-email", "o@x.example", "--time-zone", "Mars/Base", "--plan", "pilot"}, "timeZone"},
		{"bad interval", []string{"run", "--interval", "often"}, "--interval"},
		{"zero interval", []string{"run", "--interval", "0s"}, "--interval"},
		{"stray argument", []string{"run", "--once", "extra"}, "unexpected argument"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			code, _, errOut := invoke(t, env, tc.args...)
			if code != exitUsage || !strings.Contains(errOut, tc.want) {
				t.Errorf("code %d (want %d), stderr %q lacks %q", code, exitUsage, errOut, tc.want)
			}
		})
	}
}

// Возврат 1 (ревью, major): PROVISIONER_CONNECT_ROLES — только роли мониторинга; ortus_provisioner CONNECT к базам
// организаций не получает, даже если его перечислили.
func TestConnectRoles(t *testing.T) {
	t.Parallel()
	for list, want := range map[string]string{
		"":                                 "pg_monitor",
		" ":                                "pg_monitor",
		"-":                                "",
		"pg_monitor, ortus_backup":         "pg_monitor ortus_backup",
		"ortus_provisioner,pg_monitor":     "pg_monitor",
		"ortus_provisioner":                "",
		"pg_monitor,,ortus_provisioner , ": "pg_monitor",
	} {
		if got := strings.Join(connectRoles(list), " "); got != want {
			t.Errorf("connectRoles(%q) = %q, want %q", list, got, want)
		}
	}
}

// Нет переменной или соединения — код 4; DSN и пароль в выводе не появляются.
func TestConfigErrors(t *testing.T) {
	t.Parallel()
	full := map[string]string{ //nolint:gosec // G101: fake test DSN
		"MIGRATOR_DB_URL":    "postgres://ortus_migrator:s3cr3t-pass@127.0.0.1:1/ortus_control?connect_timeout=2",
		"PROVISIONER_DB_URL": "postgres://ortus_provisioner:s3cr3t-prov@127.0.0.1:1/postgres?connect_timeout=2",
	}
	for _, missing := range []string{"MIGRATOR_DB_URL", "PROVISIONER_DB_URL"} {
		env := map[string]string{}
		for k, v := range full {
			if k != missing {
				env[k] = v
			}
		}
		code, _, errOut := invoke(t, env, "run", "--once")
		if code != exitConfig || !strings.Contains(errOut, missing) {
			t.Errorf("without %s: code %d, stderr %q", missing, code, errOut)
		}
	}
	code, out, errOut := invoke(t, full, "run", "--once")
	if code != exitConfig {
		t.Errorf("unreachable: code %d", code)
	}
	for _, secret := range []string{"s3cr3t-pass", "s3cr3t-prov", "postgres://"} {
		if strings.Contains(out+errOut, secret) {
			t.Errorf("output contains %q: %s %s", secret, out, errOut)
		}
	}
}
