//go:build integration

package main

// Тесты A-4, A-5 брифа W1.42 сквозь стек (testcontainers, Go-сид W0.06): cmd/api собран как в main (build, фоновые
// задания, newHandler) — билет createRealtimeTicket, сокет /api/v1/realtime, LISTEN подсказок. Worker в тесте —
// events.Worker с realtime.Relay над ролью ortus_worker, как его регистрирует cmd/worker (W1.42).

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/realtime"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"
)

var (
	seedBelova = uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:platform:acc-11"))
)

// channelServer starts cmd/api as run does: build, the background jobs (the LISTEN of the channel) and newHandler
// behind a real listener; it returns once the channel listens.
func channelServer(t *testing.T) *httptest.Server {
	t.Helper()
	cfg := config{
		AppEnv: envE2E, AuthProvider: envDev, ControlDBURL: stack.URL(controlDB, migrations.RoleAPI),
		SessionCookie: "ortus_sid", SessionTTL: time.Hour, AllowedOrigins: []string{stackOrigin},
	}
	getenv := func(k string) string {
		if k == "TENANT_DB_URL" {
			return stack.URL("postgres", migrations.RoleAPI)
		}
		return ""
	}
	d, closeDeps, err := build(t.Context(), cfg, slog.New(slog.DiscardHandler), getenv)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.WithoutCancel(t.Context()))
	done := make(chan struct{})
	go func() {
		defer close(done)
		if d.background != nil {
			d.background(ctx)
		}
	}()
	srv := httptest.NewServer(newHandler(d))
	t.Cleanup(func() {
		cancel()
		if d.stopping != nil {
			d.stopping(context.Background())
		}
		srv.Close()
		<-done
		closeDeps()
	})
	return srv
}

// relayOutbox runs the outbox delivery of the seeded tenants with the realtime relay, as cmd/worker does.
func relayOutbox(t *testing.T) {
	t.Helper()
	control, err := pgxpool.New(t.Context(), stack.URL(controlDB, migrations.RoleWorker))
	if err != nil {
		t.Fatal(err)
	}
	pools := tenantctx.NewPools(tenantctx.NewPGDirectory(control), func(k string) string {
		if k == "TENANT_DB_URL" {
			return stack.URL("postgres", migrations.RoleWorker)
		}
		return ""
	}, "")
	reg := events.NewRegistry()
	realtime.Relay{Control: control, Notifier: realtime.Notifier{DB: control}}.Register(reg)
	w := &events.Worker{
		Tenants: func(context.Context) ([]uuid.UUID, error) { return []uuid.UUID{seedAlta, seedLotos}, nil },
		Pools:   pools, Registry: reg, Interval: events.DefaultInterval, Log: slog.New(slog.DiscardHandler),
	}
	ctx, cancel := context.WithCancel(context.WithoutCancel(t.Context()))
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = w.Run(ctx)
	}()
	t.Cleanup(func() {
		cancel()
		<-done
		pools.Close()
		control.Close()
	})
}

// socket is an authenticated connection of the channel with its frames.
type socket struct {
	t      *testing.T
	conn   *websocket.Conn
	frames chan realtime.ServerMessage
}

// openSocket asks a ticket as the browser b (createRealtimeTicket must be 201), dials the channel with the
// subprotocol and the allowed Origin, sends the auth frame and waits until the gateway delivers to account.
func openSocket(t *testing.T, srv *httptest.Server, b *browser, account uuid.UUID) *socket {
	t.Helper()
	status, body := b.call(http.MethodPost, "/api/v1/auth/realtime-tickets", "")
	ticket, _ := body["ticket"].(string)
	if status != http.StatusCreated || ticket == "" || body["path"] != realtime.Path || body["protocol"] != realtime.Protocol {
		t.Fatalf("createRealtimeTicket: %d %v", status, body)
	}
	conn := dial(t, "ws"+strings.TrimPrefix(srv.URL, "http")+realtime.Path)
	s := &socket{t: t, conn: conn, frames: make(chan realtime.ServerMessage, 64)}
	go s.read()
	auth, _ := json.Marshal(realtime.ClientMessage{Type: realtime.TypeAuth, Ticket: ticket})
	if err := conn.Write(t.Context(), websocket.MessageText, auth); err != nil {
		t.Fatalf("auth frame: %v", err)
	}
	s.probe(account)
	return s
}

// dial opens a socket of the channel; a handshake that times out on a loaded loopback is retried (as W1.07).
func dial(t *testing.T, url string) *websocket.Conn {
	t.Helper()
	for attempt := 1; ; attempt++ {
		c, err := dialOnce(t.Context(), url)
		if err == nil {
			t.Cleanup(func() { _ = c.CloseNow() })
			return c
		}
		if !errors.Is(err, context.DeadlineExceeded) || attempt == 3 {
			t.Fatalf("dial %s: %v", url, err)
		}
		t.Logf("dial %s: attempt %d timed out (loopback stall), retrying", url, attempt)
	}
}

// probe repeats a hint to account through pg_notify until the socket gets it: the LISTEN of cmd/api and the hub
// deliver to the authenticated connection.
func (s *socket) probe(account uuid.UUID) {
	s.t.Helper()
	payloads, err := realtime.EncodeHint(realtime.Hint{Type: realtime.TypeNotificationsChanged, Accounts: []uuid.UUID{account}})
	if err != nil {
		s.t.Fatal(err)
	}
	control := super(s.t, controlDB)
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := control.ExecContext(s.t.Context(), `select pg_notify($1, $2)`, realtime.Channel, payloads[0]); err != nil {
			s.t.Fatal(err)
		}
		if _, ok := s.await(realtime.TypeNotificationsChanged, 200*time.Millisecond); ok {
			return
		}
	}
	s.t.Fatal("the channel of cmd/api does not deliver: no probe hint within 10 s")
}
func dialOnce(ctx context.Context, url string) (*websocket.Conn, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	c, resp, err := websocket.Dial(ctx, url, &websocket.DialOptions{
		Subprotocols: []string{realtime.Protocol}, HTTPHeader: http.Header{"Origin": {stackOrigin}},
	})
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	return c, err
}

// read feeds frames until the socket closes (a read with a short context would close the socket).
func (s *socket) read() {
	defer close(s.frames)
	for {
		_, b, err := s.conn.Read(context.WithoutCancel(s.t.Context()))
		if err != nil {
			return
		}
		var m realtime.ServerMessage
		if json.Unmarshal(b, &m) == nil {
			s.frames <- m
		}
	}
}

// await returns the first frame of type typ within d.
func (s *socket) await(typ string, d time.Duration) (realtime.ServerMessage, bool) {
	timer := time.NewTimer(d)
	defer timer.Stop()
	for {
		select {
		case m, ok := <-s.frames:
			if !ok {
				return realtime.ServerMessage{}, false
			}
			if m.Type == typ {
				return m, true
			}
		case <-timer.C:
			return realtime.ServerMessage{}, false
		}
	}
}

// grantRoleAssignment gives the manager of «Альта» (acc-2) a role with actions at the tenant scope in t_alta and
// returns the assignment; like a command it raises policy_version. Cleanup removes the rows.
func grantRoleAssignment(t *testing.T, actions ...string) uuid.UUID {
	t.Helper()
	var personID string
	if err := super(t, controlDB).QueryRowContext(t.Context(),
		`select person_profile_id::text from memberships where account_id = $1 and tenant_id = $2`, seedKotova, seedAlta).
		Scan(&personID); err != nil {
		t.Fatal(err)
	}
	role, granter, assignment := uuid.New(), uuid.New(), uuid.New()
	db := super(t, "t_alta")
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{`insert into access.roles (id, name, kind) values ($1, 'W1.42 читатель', 'custom')`, []any{role}},
		{`insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`, []any{role, actions, granter}},
		{`insert into access.role_assignments (id, principal_kind, principal_id, role_id, role_version, scope_kind, granted_by,
		  valid) values ($4, 'person', $1, $2, 1, 'tenant', $3, tstzrange(now() - interval '1 hour', null))`,
			[]any{personID, role, granter, assignment}},
		{`update access.policy_state set policy_version = policy_version + 1`, nil},
	} {
		if _, err := db.ExecContext(t.Context(), q.sql, q.args...); err != nil {
			t.Fatalf("%s: %v", q.sql, err)
		}
	}
	t.Cleanup(func() {
		ctx := context.WithoutCancel(t.Context())
		for _, q := range []struct {
			sql string
			id  uuid.UUID
		}{
			{`delete from access.role_assignments where id = $1`, assignment},
			{`delete from access.role_versions where role_id = $1`, role},
			{`delete from access.roles where id = $1`, role},
		} {
			if _, err := db.ExecContext(ctx, q.sql, q.id); err != nil {
				t.Errorf("%s: %v", q.sql, err)
			}
		}
	})
	return assignment
}

// A-4 (S1-15): билет → сокет → владелец отзывает роль менеджера → следующий запрос менеджера 403 сразу, сокет
// менеджера получает context.changed «Альты» не позже 5 с (outbox → worker → pg_notify → шлюз cmd/api), замер — по
// монотонным часам теста от ответа на отзыв. Аккаунт другой организации (владелец «Лотоса») подсказку не получает.
func TestStackRealtimeS115(t *testing.T) { //nolint:paralleltest // one seeded stack; grants and revokes a role in t_alta
	srv := channelServer(t)
	assignment := grantRoleAssignment(t, "members.read")
	manager := newBrowser(t, srv).login("manager")
	mine := openSocket(t, srv, manager, seedKotova)
	theirs := openSocket(t, srv, newBrowser(t, srv).login("owner@t-lotos"), seedBelova)
	if status, body := manager.call(http.MethodGet, altaPath("/members"), ""); status != http.StatusOK {
		t.Fatalf("manager with the role: %d %v", status, body)
	}
	relayOutbox(t)
	owner := newBrowser(t, srv).login("owner")

	start := time.Now()
	status, body, _ := owner.callH(http.MethodDelete, altaPath("/assignments/"+assignment.String()), "",
		map[string]string{"Idempotency-Key": "w142-revoke-" + uuid.NewString()[:8]})
	if status != http.StatusNoContent {
		t.Fatalf("revokeAssignment: %d %v", status, body)
	}
	if status, body := manager.call(http.MethodGet, altaPath("/members"), ""); status != http.StatusForbidden ||
		body["code"] != problem.CodeForbiddenAction {
		t.Fatalf("the next request after the revocation: %d %v, want 403 at once", status, body)
	}
	denied := time.Since(start)
	m, ok := mine.await(realtime.TypeContextChanged, 5*time.Second)
	hinted := time.Since(start)
	if !ok || hinted > 5*time.Second {
		t.Fatalf("context.changed: %v after %v, want ≤ 5 s", ok, hinted)
	}
	if m.TenantID == nil || *m.TenantID != seedAlta || m.At.IsZero() {
		t.Fatalf("frame = %+v, want context.changed of «Альта» with at", m)
	}
	t.Logf("S1-15 via cmd/api: server denies after %v, the socket gets context.changed after %v", denied, hinted)
	if m, ok := theirs.await(realtime.TypeContextChanged, time.Second); ok {
		t.Fatalf("an account of another tenant got %+v", m)
	}
}

// A-5 (Q-W1.08-12): подключение модуля поднимает policy_version через realtime.BumpPolicy — в outbox «Альты»
// событие access.policy.bumped.v1 с причиной modules.module.enable и новой версией (worker раздаст context.changed
// всем участникам).
func TestStackModuleBumpsPolicy(t *testing.T) { //nolint:paralleltest // changes modules of t_alta
	srv := server(t)
	owner := newBrowser(t, srv).login("owner")
	tenantDB := super(t, "t_alta")
	t.Cleanup(func() {
		_, _ = tenantDB.ExecContext(context.WithoutCancel(t.Context()), `delete from modules.installations where module_key = 'fleet'`)
	})
	var before int64
	if err := tenantDB.QueryRowContext(t.Context(), `select coalesce((select policy_version from access.policy_state), 0)`).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if status, body := setFleet(t, owner, `{"enabled": true}`); status != http.StatusOK || body["state"] != "active" {
		t.Fatalf("enable: %d %v", status, body)
	}
	var after, events int64
	if err := tenantDB.QueryRowContext(t.Context(), `select coalesce((select policy_version from access.policy_state), 0)`).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if err := tenantDB.QueryRowContext(t.Context(), `select count(*) from outbox.events where type = $1 and aggregate_id = $2
		and payload->>'reason' = 'modules.module.enable' and (payload->>'policyVersion')::bigint = $3`,
		realtime.EventPolicyBumped, seedAlta, after).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if after != before+1 || events != 1 {
		t.Fatalf("policy_version %d → %d, events %d; want +1 and one access.policy.bumped.v1", before, after, events)
	}
}
