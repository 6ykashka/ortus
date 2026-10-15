package main

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// Тест W-1 брифа W1.01: конфигурация и команды cmd/worker.

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func TestLoadConfigDefaults(t *testing.T) {
	t.Parallel()
	c, err := loadConfig(env(map[string]string{"CONTROL_DB_URL": "postgres://ortus_worker@localhost:5432/ortus_control"}))
	if err != nil {
		t.Fatal(err)
	}
	want := config{
		ControlDBURL: "postgres://ortus_worker@localhost:5432/ortus_control",
		Interval:     time.Second, Batch: 100, Lease: 30 * time.Second, MaxAttempts: 10, LogLevel: slog.LevelInfo,
	}
	if c != want {
		t.Fatalf("config = %+v, want %+v", c, want)
	}
	c, err = loadConfig(env(map[string]string{
		"CONTROL_DB_URL": "postgres://w@h/db", "TENANT_DB_HOST": "pg:5432", "WORKER_POLL_INTERVAL": "250ms",
		"WORKER_BATCH": "20", "WORKER_LEASE": "1m", "WORKER_MAX_ATTEMPTS": "3", "LOG_LEVEL": "debug",
	}))
	if err != nil {
		t.Fatal(err)
	}
	want = config{ControlDBURL: "postgres://w@h/db", TenantDBHost: "pg:5432", Interval: 250 * time.Millisecond, Batch: 20,
		Lease: time.Minute, MaxAttempts: 3, LogLevel: slog.LevelDebug}
	if c != want {
		t.Fatalf("config = %+v, want %+v", c, want)
	}
}

func TestLoadConfigErrors(t *testing.T) {
	t.Parallel()
	_, err := loadConfig(env(map[string]string{
		"WORKER_POLL_INTERVAL": "soon", "WORKER_BATCH": "0", "WORKER_LEASE": "-1s", "WORKER_MAX_ATTEMPTS": "many",
		"LOG_LEVEL": "loud",
	}))
	if err == nil {
		t.Fatal("invalid configuration accepted")
	}
	for _, name := range []string{"CONTROL_DB_URL", "WORKER_POLL_INTERVAL", "WORKER_BATCH", "WORKER_LEASE", "WORKER_MAX_ATTEMPTS", "LOG_LEVEL"} {
		if !strings.Contains(err.Error(), name) {
			t.Errorf("error does not name %s: %v", name, err)
		}
	}
}

func TestParseCommand(t *testing.T) {
	t.Parallel()
	tenant, event := uuid.New(), uuid.New()
	for _, tc := range []struct {
		args []string
		want command
	}{
		{nil, command{name: "run"}},
		{[]string{"run"}, command{name: "run"}},
		{[]string{"dead", "--tenant", tenant.String()}, command{name: "dead", tenant: tenant, limit: 100}},
		{[]string{"dead", "--tenant", tenant.String(), "--limit", "5"}, command{name: "dead", tenant: tenant, limit: 5}},
		{[]string{"retry", "--tenant", tenant.String(), "--event", event.String()}, command{name: "retry", tenant: tenant, event: event}},
	} {
		got, err := parseCommand(tc.args)
		if err != nil || got != tc.want {
			t.Errorf("parseCommand(%q) = %+v, %v; want %+v", tc.args, got, err, tc.want)
		}
	}
	for _, args := range [][]string{
		{"publish"},
		{"run", "extra"},
		{"dead"},
		{"dead", "--tenant", "alta"},
		{"dead", "--tenant", tenant.String(), "--limit", "0"},
		{"retry", "--tenant", tenant.String()},
		{"retry", "--tenant", tenant.String(), "--event", "x"},
		{"retry", "--tenant", tenant.String(), "--event", event.String(), "--unknown"},
	} {
		if got, err := parseCommand(args); err == nil {
			t.Errorf("parseCommand(%q) = %+v, want an error", args, got)
		}
	}
}

func TestRunExitCodes(t *testing.T) {
	t.Parallel()
	for name, tc := range map[string]struct {
		args []string
		env  map[string]string
	}{
		"no configuration": {nil, nil},
		"bad arguments":    {[]string{"publish"}, map[string]string{"CONTROL_DB_URL": "postgres://w@127.0.0.1:1/db"}},
		"invalid DSN":      {nil, map[string]string{"CONTROL_DB_URL": "::not a dsn"}},
		"unreachable DB":   {nil, map[string]string{"CONTROL_DB_URL": "postgres://w:secret@127.0.0.1:1/db?connect_timeout=1"}}, //nolint:gosec // G101: fake password, the test checks that stderr does not leak it
	} {
		var out, errOut bytes.Buffer
		if code := run(t.Context(), tc.args, env(tc.env), &out, &errOut); code != exitConfig {
			t.Errorf("%s: exit %d, want %d (stderr %q)", name, code, exitConfig, errOut.String())
		}
		if errOut.Len() == 0 {
			t.Errorf("%s: no message on stderr", name)
		}
		if strings.Contains(errOut.String(), "secret") {
			t.Errorf("%s: stderr leaks the DSN password: %q", name, errOut.String())
		}
	}
}
