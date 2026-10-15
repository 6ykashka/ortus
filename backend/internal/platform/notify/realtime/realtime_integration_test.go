//go:build integration

package realtime

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// Тесты R-7 и R-8 брифа W1.07 на PostgreSQL (testcontainers): строки изоляции канала и сквозной отзыв роли
// S1-15 — «новые запросы блокируются сразу, интерфейс получает context.changed ≤ 5 с».

var cluster *migratetest.Cluster

func TestMain(m *testing.M) {
	c, stop, err := migratetest.Start(context.Background(), migratetest.Images()[0])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	cluster = c
	code := m.Run()
	stop()
	os.Exit(code)
}

// migrated returns pools of ortus_api and ortus_worker on a fresh database of kind.
func migrated(t *testing.T, kind migrations.Kind) (api, worker *pgxpool.Pool) {
	t.Helper()
	name := cluster.NewDatabase(t, "rt_"+string(kind))
	if _, err := migrations.Up(t.Context(), cluster.DB(t, name, migrations.RoleMigrator), kind); err != nil {
		t.Fatalf("migrate %s: %v", kind, err)
	}
	open := func(role string) *pgxpool.Pool {
		p, err := pgxpool.New(t.Context(), cluster.URL(name, role))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(p.Close)
		return p
	}
	return open(migrations.RoleAPI), open(migrations.RoleWorker)
}

// pools is a fixed tenant → pool map (tenantctx.Pools in production).
type pools map[uuid.UUID]*pgxpool.Pool

func (p pools) For(_ context.Context, id uuid.UUID) (*pgxpool.Pool, error) {
	if pool, ok := p[id]; ok {
		return pool, nil
	}
	return nil, errors.New("dependency_unavailable: tenant DB")
}

func scalar[T any](t *testing.T, pool *pgxpool.Pool, sql string, args ...any) T {
	t.Helper()
	var v T
	if err := pool.QueryRow(t.Context(), sql, args...).Scan(&v); err != nil {
		t.Fatalf("%s: %v", strings.Fields(sql)[0], err)
	}
	return v
}

// controlFixture is the control DB with tenants and accounts.
type controlFixture struct {
	t           *testing.T
	api, worker *pgxpool.Pool
}

func newControl(t *testing.T) *controlFixture {
	t.Helper()
	api, worker := migrated(t, migrations.Control)
	return &controlFixture{t: t, api: api, worker: worker}
}

func (c *controlFixture) tenant(slug string) uuid.UUID {
	return scalar[uuid.UUID](c.t, c.api, `insert into tenants (slug, display_name, industry_pack, state)
values ($1, $1, 'logistics', 'active') returning id`, slug)
}

func (c *controlFixture) account(name string) uuid.UUID {
	return scalar[uuid.UUID](c.t, c.api, `insert into accounts (issuer, subject, email_norm, display_name)
values ('dev', $1, $1 || '@example.test', $1) returning id`, name+"-"+uuid.NewString())
}

func (c *controlFixture) member(tenant, account, person uuid.UUID, status string) {
	c.t.Helper()
	if _, err := c.api.Exec(c.t.Context(), `insert into memberships (tenant_id, account_id, status, person_profile_id)
values ($1, $2, $3::membership_status, $4)`, tenant, account, status, person); err != nil {
		c.t.Fatalf("membership: %v", err)
	}
}

// tenantFixture is a tenant DB with one unit and a role carrying action.
type tenantFixture struct {
	t           *testing.T
	api, worker *pgxpool.Pool
	unit, role  uuid.UUID
}

func newTenant(t *testing.T) *tenantFixture {
	t.Helper()
	api, worker := migrated(t, migrations.Tenant)
	d := &tenantFixture{t: t, api: api, worker: worker}
	d.unit = scalar[uuid.UUID](t, api, `insert into org.units (kind, name, time_zone) values ('company', 'Альта', 'Europe/Moscow') returning id`)
	if _, err := api.Exec(t.Context(), `insert into access.policy_state default values on conflict do nothing`); err != nil {
		t.Fatal(err)
	}
	return d
}

func (d *tenantFixture) person(name string) uuid.UUID {
	return scalar[uuid.UUID](d.t, d.api, `insert into people.person_profiles (full_name, home_unit_id) values ($1, $2) returning id`, name, d.unit)
}

// assign gives person a role with action in the whole tenant and returns the assignment. It is valid since an hour
// ago: the evaluator compares periods with the clock of the application, and the clock of the container may run
// ahead of it (Q-W0.09-11).
func (d *tenantFixture) assign(person uuid.UUID) uuid.UUID {
	d.t.Helper()
	if d.role == uuid.Nil {
		d.role = scalar[uuid.UUID](d.t, d.api, `insert into access.roles (name, kind) values ('Диспетчер', 'custom') returning id`)
		if _, err := d.api.Exec(d.t.Context(), `insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`,
			d.role, []string{action}, person); err != nil {
			d.t.Fatal(err)
		}
	}
	return scalar[uuid.UUID](d.t, d.api, `insert into access.role_assignments
  (principal_kind, principal_id, role_id, role_version, scope_kind, granted_by, valid)
values ('person', $1, $2, 1, 'tenant', $1, tstzrange(now() - interval '1 hour', null)) returning id`, person, d.role)
}

// revoke revokes assignment and bumps the policy in one transaction, as a command of W1.06 does.
func (d *tenantFixture) revoke(tenant, assignment, person uuid.UUID) int64 {
	d.t.Helper()
	var v int64
	err := pgx.BeginFunc(d.t.Context(), d.api, func(tx pgx.Tx) error {
		if _, err := tx.Exec(d.t.Context(), `update access.role_assignments set state = 'revoked', revoked_at = now() where id = $1`, assignment); err != nil {
			return err
		}
		var err error
		v, err = BumpPolicy(d.t.Context(), tx, tenant, []uuid.UUID{person}, "access.assignment.revoked")
		return err
	})
	if err != nil {
		d.t.Fatalf("revoke: %v", err)
	}
	return v
}

// listen runs a Listener on the control DB into sink until the test ends; it returns after the first LISTEN.
func listen(t *testing.T, control *pgxpool.Pool, sink func(Hint), resync func()) {
	t.Helper()
	ready := make(chan struct{}, 1)
	l := &Listener{
		Dial: PoolDialer(control), Sink: sink, Resync: resync, Log: slog.New(slog.DiscardHandler),
		Listening: func() {
			select {
			case ready <- struct{}{}:
			default:
			}
		},
	}
	ctx, cancel := context.WithCancel(context.WithoutCancel(t.Context()))
	done := make(chan struct{})
	go func() { _ = l.Run(ctx); close(done) }()
	t.Cleanup(func() { cancel(); <-done })
	select {
	case <-ready:
	case <-time.After(10 * time.Second):
		t.Fatal("the listener did not LISTEN")
	}
}

// expectHint waits up to 5 s for exactly one hint of typ and tenant on c.
func expectHint(t *testing.T, step, name string, c *client, typ string, tenant uuid.UUID) {
	t.Helper()
	var got []ServerMessage
	for deadline := time.Now().Add(5 * time.Second); len(got) == 0 && time.Now().Before(deadline); time.Sleep(10 * time.Millisecond) {
		got = received(c)
	}
	if len(got) != 1 || got[0].Type != typ || got[0].TenantID == nil || *got[0].TenantID != tenant {
		t.Fatalf("%s: %s got %+v, want one %s of tenant %s", step, name, got, typ, tenant)
	}
}

// expectNone checks that the named connections hold no hint. One notification carries the whole audience of a
// hint, so once an addressee has it the others are final.
func expectNone(t *testing.T, step string, conns map[string]*client, names ...string) {
	t.Helper()
	for _, name := range names {
		if got := received(conns[name]); len(got) != 0 {
			t.Fatalf("%s: %s got a hint meant for others: %+v", step, name, got)
		}
	}
}

// newWorker is the outbox worker of tenant with the handlers of relay (cmd/worker).
func newWorker(tenant uuid.UUID, pool *pgxpool.Pool, relay Relay) *events.Worker {
	reg := events.NewRegistry()
	relay.Register(reg)
	return &events.Worker{
		Tenants: func(context.Context) ([]uuid.UUID, error) { return []uuid.UUID{tenant}, nil },
		Pools:   pools{tenant: pool}, Registry: reg, Interval: events.DefaultInterval, Log: slog.New(slog.DiscardHandler),
	}
}

// Строки изоляции канала: подсказку организации A получают только аккаунты затронутых людей A.
func TestIsolationRealtimeRelay(t *testing.T) {
	t.Parallel()
	ctl := newControl(t)
	db := newTenant(t)
	a, b := ctl.tenant("alta-"+uuid.NewString()[:8]), ctl.tenant("lotos-"+uuid.NewString()[:8])
	pA1, pA2 := db.person("Котова"), db.person("Орлов")
	accA1, accA2, accB, accX := ctl.account("a1"), ctl.account("a2"), ctl.account("b"), ctl.account("x")
	ctl.member(a, accA1, pA1, "active")
	ctl.member(a, accA2, pA2, "active")
	ctl.member(b, accB, pA1, "active") // the same person id in another tenant (ids are per tenant DB)

	hub := NewHub(HubOptions{})
	conns := map[string]*client{}
	for name, acc := range map[string]uuid.UUID{"a1": accA1, "a2": accA2, "b": accB, "x": accX} {
		conns[name] = mustRegister(t, hub, acc, SessionKey(name))
	}
	sink, resync := Fanout(hub, nil)
	listen(t, ctl.api, sink, resync)
	relay := Relay{Control: ctl.worker, Notifier: Notifier{DB: ctl.worker}, Log: slog.New(slog.DiscardHandler)}

	// HintPersons directly (the path of W1.10).
	if err := relay.HintPersons(t.Context(), a, []uuid.UUID{pA1}, TypeContextChanged); err != nil {
		t.Fatalf("HintPersons: %v", err)
	}
	expectHint(t, "HintPersons", "a1", conns["a1"], TypeContextChanged, a)
	expectNone(t, "HintPersons", conns, "a2", "b", "x")

	// Through the outbox: BumpPolicy in the transaction of the change, the worker delivers with the relay.
	db.revoke(a, db.assign(pA1), pA1)
	if st, err := newWorker(a, db.worker, relay).RunOnce(t.Context()); err != nil || st.Published != 1 || st.Errors+st.Retried+st.Dead != 0 {
		t.Fatalf("worker pass = %+v, %v", st, err)
	}
	expectHint(t, "outbox", "a1", conns["a1"], TypeContextChanged, a)
	expectNone(t, "outbox", conns, "a2", "b", "x")

	// An empty audience means every active member of the tenant, and still nobody else.
	if err := relay.HintPersons(t.Context(), a, nil, TypeNotificationsChanged); err != nil {
		t.Fatal(err)
	}
	expectHint(t, "whole tenant", "a1", conns["a1"], TypeNotificationsChanged, a)
	expectHint(t, "whole tenant", "a2", conns["a2"], TypeNotificationsChanged, a)
	expectNone(t, "whole tenant", conns, "b", "x")
	if err := relay.HintPersons(t.Context(), uuid.Nil, []uuid.UUID{pA1}, TypeContextChanged); err == nil {
		t.Fatal("a hint without a tenant must be refused")
	}
}

// BumpPolicy: версия растёт в транзакции изменения, событие outbox — в той же транзакции (откат — ни того, ни другого).
func TestBumpPolicyInTransaction(t *testing.T) {
	t.Parallel()
	db := newTenant(t)
	tenant, person := uuid.New(), db.person("Котова")
	before := scalar[int64](t, db.api, `select policy_version from access.policy_state`)
	v, err := BumpPolicy(t.Context(), db.api, tenant, []uuid.UUID{person}, "access.assignment.revoked")
	if err != nil || v != before+1 {
		t.Fatalf("BumpPolicy = %d, %v; want %d", v, err, before+1)
	}
	payload := scalar[string](t, db.api, `select payload::text from outbox.events where type = $1 and aggregate_id = $2`, EventPolicyBumped, tenant)
	if !strings.Contains(payload, person.String()) || !strings.Contains(payload, fmt.Sprintf(`"policyVersion": %d`, v)) {
		t.Fatalf("payload = %s", payload)
	}

	err = pgx.BeginFunc(t.Context(), db.api, func(tx pgx.Tx) error {
		if _, err := BumpPolicy(t.Context(), tx, tenant, nil, "modules.installation.state_changed"); err != nil {
			t.Fatal(err)
		}
		return errors.New("rollback")
	})
	if err == nil {
		t.Fatal("the transaction was not rolled back")
	}
	if got := scalar[int64](t, db.api, `select policy_version from access.policy_state`); got != v {
		t.Fatalf("rolled back bump changed the version: %d", got)
	}
	if n := scalar[int](t, db.api, `select count(*) from outbox.events where type = $1`, EventPolicyBumped); n != 1 {
		t.Fatalf("%d bump events after a rollback, want 1", n)
	}
	if _, err := BumpPolicy(t.Context(), db.api, uuid.Nil, nil, ""); err == nil {
		t.Fatal("BumpPolicy without a tenant must fail")
	}
}

// Tenant DB без строки access.policy_state (ещё не подготовлена) — версия 0, BumpPolicy создаёт строку.
func TestBumpPolicyWithoutRow(t *testing.T) {
	t.Parallel()
	db := newTenant(t)
	tenant := uuid.New()
	if _, err := db.api.Exec(t.Context(), `delete from access.policy_state`); err != nil {
		t.Fatal(err)
	}
	versions := PGVersions{Pools: pools{tenant: db.api}}
	if v, err := versions.PolicyVersion(t.Context(), tenant); err != nil || v != 0 {
		t.Fatalf("version without the row = %d, %v", v, err)
	}
	if v, err := BumpPolicy(t.Context(), db.api, tenant, nil, ""); err != nil || v != 1 {
		t.Fatalf("BumpPolicy without the row = %d, %v", v, err)
	}
	if v, err := versions.PolicyVersion(t.Context(), tenant); err != nil || v != 1 {
		t.Fatalf("version after the bump = %d, %v", v, err)
	}
	if _, err := versions.PolicyVersion(t.Context(), uuid.New()); err == nil {
		t.Fatal("an unknown tenant must fail (dependency_unavailable), not read as version 0")
	}
}

// connect opens a gateway for hub with one live session of acc and returns its authenticated socket.
func connect(t *testing.T, hub *Hub, acc uuid.UUID) *websocket.Conn {
	t.Helper()
	tickets, store := NewMemTickets(nil), session.NewMemStore()
	s := session.Session{ID: uuid.NewString(), AccountID: acc, IssuedAt: time.Now(), ExpiresAt: time.Now().Add(time.Hour)}
	if err := store.Create(t.Context(), s); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(&Gateway{Hub: hub, Tickets: tickets, Sessions: store, AllowedOrigins: []string{spa}, Log: slog.New(slog.DiscardHandler)})
	t.Cleanup(srv.Close)
	tk, _ := tickets.Issue(t.Context(), Principal{AccountID: acc, SessionID: s.ID})
	conn, _, err := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+Path, spa, Protocol)
	if err != nil {
		t.Fatal(err)
	}
	send(t, conn, ClientMessage{Type: TypeAuth, Ticket: tk.Secret})
	eventually(t, "the gateway registers the socket", func() bool { return hub.Connections(acc) == 1 })
	return conn
}

// S1-15 сквозь стек: отзыв роли → Permit отказывает сразу; worker (опрос 1 с) → relay → pg_notify → listener →
// шлюз → у клиента context.changed ≤ 5 с.
func TestS115RevocationWithinFiveSeconds(t *testing.T) {
	t.Parallel()
	ctl := newControl(t)
	db := newTenant(t)
	tenant := ctl.tenant("alta-" + uuid.NewString()[:8])
	person := db.person("Котова")
	acc := ctl.account("kotova")
	ctl.member(tenant, acc, person, "active")
	assignment := db.assign(person)

	tp := pools{tenant: db.api}
	src := authz.PGSource{Pools: tp}
	cache := &PolicyCache{Inner: src, Versions: PGVersions{Pools: tp}}
	ev := authz.New(cache, src, time.Now)
	tc := tenantctx.TenantContext{TenantID: tenant, AccountID: acc, PersonID: person}
	if err := ev.Permit(t.Context(), tc, action, authz.Resource{}); err != nil {
		t.Fatalf("before the revocation: %v", err)
	}

	hub := NewHub(HubOptions{})
	t.Cleanup(hub.Close)
	sink, resync := Fanout(hub, cache)
	listen(t, ctl.api, sink, resync)
	conn := connect(t, hub, acc)

	w := newWorker(tenant, db.worker, Relay{Control: ctl.worker, Notifier: Notifier{DB: ctl.worker}, Log: slog.New(slog.DiscardHandler)})
	wctx, stop := context.WithCancel(context.WithoutCancel(t.Context()))
	wdone := make(chan struct{})
	t.Cleanup(func() { stop(); <-wdone })
	go func() { _ = w.Run(wctx); close(wdone) }()
	time.Sleep(300 * time.Millisecond) // after the first pass: the revocation lands inside the poll interval of the worker

	t0 := time.Now()
	db.revoke(tenant, assignment, person)
	if err := ev.Permit(t.Context(), tc, action, authz.Resource{}); !isForbidden(err) {
		t.Fatalf("right after the revocation Permit = %v, want forbidden_action", err)
	}
	server := time.Since(t0)

	m, err := next(t, conn, 5*time.Second)
	for err == nil && m.Type == TypePing {
		m, err = next(t, conn, 5*time.Second)
	}
	ui := time.Since(t0)
	if err != nil || m.Type != TypeContextChanged || m.TenantID == nil || *m.TenantID != tenant || m.Seq < 1 {
		t.Fatalf("frame %+v, %v; want context.changed of the tenant", m, err)
	}
	if ui > 5*time.Second {
		t.Fatalf("context.changed after %v, want ≤ 5 s", ui)
	}
	t.Logf("S1-15: server denies after %v, the socket gets context.changed after %v", server, ui)
}

// Обрыв соединения LISTEN (перезапуск control DB, сбой сети): слушатель переподключается, хаб ресинхронизирует
// соединения (подсказки за время обрыва потеряны), новые подсказки снова доходят.
func TestListenerSurvivesLostConnection(t *testing.T) {
	t.Parallel()
	ctl := newControl(t)
	dbName := scalar[string](t, ctl.api, `select current_database()`)
	hub := NewHub(HubOptions{})
	acc := uuid.New()
	c := mustRegister(t, hub, acc, "k")
	sink, resync := Fanout(hub, nil)
	var resyncs atomic.Int32
	listen(t, ctl.api, sink, func() { resyncs.Add(1); resync() })

	super := cluster.DB(t, "postgres", migratetest.Super)
	var killed int
	if err := super.QueryRowContext(t.Context(), `select count(pg_terminate_backend(pid)) from pg_stat_activity
 where datname = $1 and query = 'listen `+Channel+`'`, dbName).Scan(&killed); err != nil || killed != 1 {
		t.Fatalf("terminated %d listening backends, %v; want 1", killed, err)
	}
	eventually(t, "Resync after the reconnection", func() bool { return resyncs.Load() == 1 })
	expect(t, "after the reconnection", c, TypeContextChanged, TypeNotificationsChanged)

	tenant := uuid.New()
	if err := (Notifier{DB: ctl.worker}).Publish(t.Context(), Hint{Type: TypeContextChanged, TenantID: tenant, Accounts: []uuid.UUID{acc}}); err != nil {
		t.Fatal(err)
	}
	expectHint(t, "new connection", "k", c, TypeContextChanged, tenant)
}
