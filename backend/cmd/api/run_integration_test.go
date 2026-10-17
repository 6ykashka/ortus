//go:build integration

package main

// Доделка №2 W1.42 (16.10): run целиком — loadConfig, build, runServer, serve — над настоящими пулами pgx
// (testcontainers, сид W0.06). LISTEN канала держит соединение пула control, и pgxpool.Pool.Close ждёт его возврата:
// на обоих путях остановки процесс должен выйти в пределах бюджета остановки, сокет канала — закрыться, а
// соединение LISTEN — уйти из pg_stat_activity. Unit-тесты background_test.go и serve_test.go проверяют тот же порядок
// на подделках; здесь — без них.

import (
	"context"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ortus/ortus-crm/backend/internal/platform/notify/realtime"
	"github.com/ortus/ortus-crm/backend/migrations"
)

// runBudget bounds the stop of run: the shutdown budget and a margin for the pools to close.
const runBudget = shutdownTimeout + 10*time.Second

// startRun starts run as main does, with the environment of the slot stand, on addr; it returns the exit code channel,
// the cancel of the signal context and the output of run (lockedBuffer of invitation_mail_integration_test.go).
func startRun(t *testing.T, addr string) (<-chan int, context.CancelFunc, *lockedBuffer) {
	t.Helper()
	env := map[string]string{
		"APP_ENV": envE2E, "AUTH_PROVIDER": envDev, "HTTP_ADDR": addr, "ALLOWED_ORIGINS": stackOrigin,
		"CONTROL_DB_URL": stack.URL(controlDB, migrations.RoleAPI), "TENANT_DB_URL": stack.URL("postgres", migrations.RoleAPI),
	}
	ctx, cancel := context.WithCancel(context.WithoutCancel(t.Context()))
	out := &lockedBuffer{}
	code := make(chan int, 1)
	go func() { code <- run(ctx, func(k string) string { return env[k] }, out, out) }()
	t.Cleanup(cancel)
	return code, cancel, out
}

// listens counts the LISTEN connections of the channel opened by role ortus_api in the control DB since since.
func listens(t *testing.T, since time.Time) int {
	t.Helper()
	var n int
	if err := super(t, controlDB).QueryRowContext(t.Context(), `select count(*) from pg_stat_activity
		where datname = $1 and usename = $2 and query = 'listen '||$3 and backend_start >= $4`,
		controlDB, migrations.RoleAPI, realtime.Channel, since).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// dbNow is the clock of the database (the host and the container clocks may differ).
func dbNow(t *testing.T) time.Time {
	t.Helper()
	var now time.Time
	if err := super(t, controlDB).QueryRowContext(t.Context(), `select now()`).Scan(&now); err != nil {
		t.Fatal(err)
	}
	return now
}

// eventually polls cond every 100 ms for d.
func eventually(d time.Duration, cond func() bool) bool {
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		if cond() {
			return true
		}
		time.Sleep(100 * time.Millisecond)
	}
	return cond()
}

// awaitExit waits for the exit code of run within runBudget.
func awaitExit(t *testing.T, code <-chan int, out *lockedBuffer) int {
	t.Helper()
	select {
	case c := <-code:
		return c
	case <-time.After(runBudget):
		t.Fatalf("run did not return within %v (a pool waits for a connection?)\n%s", runBudget, out)
		return -1
	}
}

// freeAddr is a loopback address with a port nobody listens on.
func freeAddr(t *testing.T) string {
	t.Helper()
	l, err := (&net.ListenConfig{}).Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
	return addr
}

// Путь сигнала: процесс поднят, LISTEN держит соединение, у менеджера «Альты» открыт сокет канала. Сигнал → сокет
// закрыт, run возвращает 0 в пределах бюджета, соединение LISTEN закрыто вместе с пулом.
func TestRunStopsOnSignalWithRealPools(t *testing.T) { //nolint:paralleltest // one seeded stack
	since := dbNow(t)
	addr := freeAddr(t)
	code, signal, out := startRun(t, addr)
	base := "http://" + addr
	if !eventually(15*time.Second, func() bool {
		req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, base+"/readyz", http.NoBody)
		if err != nil {
			t.Fatal(err)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return false
		}
		_ = resp.Body.Close()
		return resp.StatusCode == http.StatusOK && listens(t, since) == 1
	}) {
		t.Fatalf("cmd/api is not ready with one LISTEN within 15 s (listens = %d)\n%s", listens(t, since), out)
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	manager := (&browser{t: t, base: base, http: &http.Client{Jar: jar}}).login("manager")
	sock := openSocket(t, &httptest.Server{URL: base}, manager, seedKotova)

	start := time.Now()
	signal()
	if c := awaitExit(t, code, out); c != exitOK {
		t.Fatalf("run on a signal = %d, want %d\n%s", c, exitOK, out)
	}
	t.Logf("signal path: run returned in %v", time.Since(start))
	select {
	case _, open := <-sock.frames:
		for open {
			_, open = <-sock.frames
		}
	case <-time.After(time.Second):
		t.Fatal("the socket of the channel is still open after run returned")
	}
	if !eventually(5*time.Second, func() bool { return listens(t, since) == 0 }) {
		t.Fatalf("the LISTEN connection outlived run: %d", listens(t, since))
	}
}

// Путь сбоя сервера: адрес занят, сервер падает сразу, сигнала нет — фон (LISTEN) отменяется и дожидается до
// closeDeps, run возвращает 1 в пределах бюджета и не висит в pgxpool.Pool.Close.
func TestRunStopsOnServerFailureWithRealPools(t *testing.T) { //nolint:paralleltest // one seeded stack
	since := dbNow(t)
	busy, err := (&net.ListenConfig{}).Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = busy.Close() })
	code, _, out := startRun(t, busy.Addr().String())
	start := time.Now()
	if c := awaitExit(t, code, out); c != exitFailed {
		t.Fatalf("run on a busy address = %d, want %d\n%s", c, exitFailed, out)
	}
	t.Logf("server failure path: run returned in %v", time.Since(start))
	if !eventually(5*time.Second, func() bool { return listens(t, since) == 0 }) {
		t.Fatalf("the LISTEN connection outlived run: %d", listens(t, since))
	}
}
