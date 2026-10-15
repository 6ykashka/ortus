//go:build integration

package tenants

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// The controller is checked on the first image of migratetest.Images() (PostgreSQL 17.11 by default); the
// migrations themselves are covered on 17.11 and 16.4 by the package migrations.
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

var latest = migrations.Latest(migrations.Tenant)

// stand is a migrated control DB of one test and the controller over it.
type stand struct {
	t         *testing.T
	controlDB string
	control   *sql.DB // as ortus_migrator
	connect   *countingConnector
	runner    *failingRunner
	ctrl      *Controller
	created   time.Time
}

func newStand(t *testing.T) *stand {
	t.Helper()
	name := cluster.NewDatabase(t, "ctl")
	control := cluster.DB(t, name, migrations.RoleMigrator)
	if _, err := migrations.Up(t.Context(), control, migrations.Control); err != nil {
		t.Fatal(err)
	}
	s := &stand{
		t: t, controlDB: name, control: control,
		connect: &countingConnector{inner: DSNConnector{DSN: cluster.URL(name, migrations.RoleMigrator)}},
		runner:  &failingRunner{fail: map[string]bool{}},
		created: time.Date(2026, time.October, 1, 10, 30, 0, 0, time.UTC),
	}
	s.ctrl = s.controller()
	return s
}

func (s *stand) controller() *Controller {
	return &Controller{Control: s.control, Connect: s.connect, Runner: s.runner}
}

// tenant registers a tenant with an empty database; tenants are created one minute apart.
func (s *stand) tenant(slug string) Ref {
	s.t.Helper()
	db := cluster.NewDatabase(s.t, "t_"+slug)
	s.created = s.created.Add(time.Minute)
	r := Ref{TenantID: uuid.New(), Slug: slug, Database: db, Sentinel: uuid.New(), CreatedAt: s.created}
	_, err := s.control.ExecContext(s.t.Context(), `
with t as (
  insert into tenants (id, slug, display_name, industry_pack, state, created_at)
  values ($1, $2, $2, 'logistics', 'active', $5) returning id
)
insert into tenant_routing (tenant_id, cluster_ref, database_name, secret_ref, sentinel)
select id, 'local', $3, 'env:TENANT_DB_URL', $4 from t`, r.TenantID, slug, db, r.Sentinel, r.CreatedAt)
	if err != nil {
		s.t.Fatalf("register %s: %v", slug, err)
	}
	return r
}

// pending registers a tenant the way createPlatformTenant does: state provisioning and a route (version 0) to a
// database the provisioner has not created yet.
func (s *stand) pending(slug string) Ref {
	s.t.Helper()
	s.created = s.created.Add(time.Minute)
	r := Ref{TenantID: uuid.New(), Slug: slug, Database: "t_" + slug + "_not_created", Sentinel: uuid.New(), CreatedAt: s.created}
	_, err := s.control.ExecContext(s.t.Context(), `
with t as (
  insert into tenants (id, slug, display_name, industry_pack, state, created_at)
  values ($1, $2, $2, 'custom', 'provisioning', $5) returning id
)
insert into tenant_routing (tenant_id, cluster_ref, database_name, secret_ref, sentinel)
select id, 'local', $3, 'env:TENANT_DB_URL', $4 from t`, r.TenantID, slug, r.Database, r.Sentinel, r.CreatedAt)
	if err != nil {
		s.t.Fatalf("register pending %s: %v", slug, err)
	}
	return r
}

// at migrates the database of r to version v outside the controller and records it in tenant_routing, like a stand
// that was migrated before; identity is written when withIdentity.
func (s *stand) at(r Ref, v int64, withIdentity bool, sentinel uuid.UUID) {
	s.t.Helper()
	db := cluster.DB(s.t, r.Database, migrations.RoleMigrator)
	if _, err := migrations.UpTo(s.t.Context(), db, migrations.Tenant, v); err != nil {
		s.t.Fatal(err)
	}
	if withIdentity {
		if _, err := db.ExecContext(s.t.Context(), `insert into core.tenant_identity (tenant_id, sentinel) values ($1, $2)`,
			r.TenantID, sentinel); err != nil {
			s.t.Fatal(err)
		}
	}
	s.exec(`update tenant_routing set schema_version = $2 where tenant_id = $1`, r.TenantID, v)
}

func (s *stand) exec(q string, args ...any) {
	s.t.Helper()
	if _, err := s.control.ExecContext(s.t.Context(), q, args...); err != nil {
		s.t.Fatalf("%s: %v", q, err)
	}
}

func (s *stand) count(q string, args ...any) int {
	s.t.Helper()
	var n int
	if err := s.control.QueryRowContext(s.t.Context(), q, args...).Scan(&n); err != nil {
		s.t.Fatalf("%s: %v", q, err)
	}
	return n
}

func (s *stand) routing(r Ref) int64 {
	s.t.Helper()
	var v int64
	if err := s.control.QueryRowContext(s.t.Context(), `select schema_version from tenant_routing where tenant_id = $1`,
		r.TenantID).Scan(&v); err != nil {
		s.t.Fatal(err)
	}
	return v
}

func (s *stand) actual(r Ref) int64 {
	s.t.Helper()
	v, err := migrations.Version(s.t.Context(), cluster.DB(s.t, r.Database, migratetest.Super), migrations.Tenant)
	if err != nil {
		s.t.Fatal(err)
	}
	return v
}

func (s *stand) identity(r Ref) (tenant, sentinel uuid.UUID) {
	s.t.Helper()
	db := cluster.DB(s.t, r.Database, migratetest.Super)
	if err := db.QueryRowContext(s.t.Context(), `select tenant_id, sentinel from core.tenant_identity`).
		Scan(&tenant, &sentinel); err != nil {
		s.t.Fatalf("identity of %s: %v", r.Slug, err)
	}
	return tenant, sentinel
}

// countingConnector counts Open calls per database.
type countingConnector struct {
	inner Connector
	mu    sync.Mutex
	opens map[string]int
}

func (c *countingConnector) Open(ctx context.Context, r Ref) (*sql.DB, error) {
	c.mu.Lock()
	if c.opens == nil {
		c.opens = map[string]int{}
	}
	c.opens[r.Database]++
	c.mu.Unlock()
	return c.inner.Open(ctx, r)
}

func (c *countingConnector) total() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	n := 0
	for _, v := range c.opens {
		n += v
	}
	return n
}

func (c *countingConnector) of(db string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.opens[db]
}

// failingRunner is the goose runner except for the databases in fail: their UpTo fails before any change, like a
// migration whose transaction rolled back.
type failingRunner struct {
	GooseRunner
	mu   sync.Mutex
	fail map[string]bool
}

func (f *failingRunner) failOn(db string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.fail[db] = true
}

func (f *failingRunner) UpTo(ctx context.Context, db *sql.DB, v int64) (migrations.Result, error) {
	var name string
	if err := db.QueryRowContext(ctx, `select current_database()`).Scan(&name); err != nil {
		return migrations.Result{}, err
	}
	f.mu.Lock()
	failing := f.fail[name]
	f.mu.Unlock()
	if failing {
		cur, _ := f.Version(ctx, db)
		return migrations.Result{From: cur, To: cur}, errors.New("migrations: tenant up: ERROR: division by zero (SQLSTATE 22012)")
	}
	return f.GooseRunner.UpTo(ctx, db, v)
}

func done(rep Report) []string     { return resultSlugs(rep.Done) }
func failedOf(rep Report) []string { return resultSlugs(rep.Failed) }

// M-12, M-13, M-14 WS-41: две tenant DB разных версий доходят до последней; tenant_routing.schema_version и
// platform_audit обновлены; в свежей БД sentinel записан из tenant_routing сразу после 0001.
func TestRolloutBringsTenantsToLatest(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	fresh, older := s.tenant("fresh"), s.tenant("older")
	s.at(older, 2, true, older.Sentinel)

	rep, err := s.ctrl.Rollout(t.Context(), Plan{})
	if err != nil {
		t.Fatal(err)
	}
	if rep.Target != latest || rep.RunID == "" {
		t.Errorf("report target %d run %q", rep.Target, rep.RunID)
	}
	if got := done(rep); !slices.Equal(got, []string{"fresh", "older"}) {
		t.Fatalf("done %v, failed %v", got, rep.Failed)
	}
	for _, r := range []Ref{fresh, older} {
		if s.routing(r) != latest || s.actual(r) != latest {
			t.Errorf("%s: routing %d actual %d, want %d", r.Slug, s.routing(r), s.actual(r), latest)
		}
		if id, sentinel := s.identity(r); id != r.TenantID || sentinel != r.Sentinel {
			t.Errorf("%s: identity %s/%s, want %s/%s", r.Slug, id, sentinel, r.TenantID, r.Sentinel)
		}
	}
	if n := s.count(`select count(*) from platform_audit where action = 'tenant.schema.migrate' and result = 'ok'
		and actor_kind = 'system' and request_id = $1 and target_id = $2 and details->>'from' = '0' and details->>'to' = $3`,
		rep.RunID, fresh.TenantID, strconv.FormatInt(latest, 10)); n != 1 {
		t.Errorf("audit of fresh = %d rows", n)
	}
	if n := s.count(`select count(*) from platform_audit where target_id = $1 and details->>'from' = '2'`, older.TenantID); n != 1 {
		t.Errorf("audit of older = %d rows", n)
	}
	// Runtime roles keep their grants on the new tables (migrations.Grant after every Up).
	api := cluster.DB(t, fresh.Database, migrations.RoleAPI)
	if _, err := api.ExecContext(t.Context(), `select count(*) from core.tenant_identity`); err != nil {
		t.Errorf("ortus_api reads the migrated database: %v", err)
	}
}

// M-15: sentinel tenant DB ≠ tenant_routing — тенант не мигрируется, версия не меняется, аудит failed с «sentinel».
func TestRolloutSentinelMismatch(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	r := s.tenant("alien")
	s.at(r, 2, true, uuid.New())

	rep, err := s.ctrl.Rollout(t.Context(), Plan{})
	if !errors.Is(err, ErrCanaryFailed) || !errors.Is(err, ErrSentinelMismatch) {
		t.Fatalf("err %v, want ErrCanaryFailed wrapping ErrSentinelMismatch", err)
	}
	if len(rep.Failed) != 1 || !errors.Is(rep.Failed[0].Err, ErrSentinelMismatch) {
		t.Fatalf("failed %+v, want ErrSentinelMismatch", rep.Failed)
	}
	if s.actual(r) != 2 || s.routing(r) != 2 {
		t.Errorf("version changed: actual %d routing %d", s.actual(r), s.routing(r))
	}
	if n := s.count(`select count(*) from platform_audit where target_id = $1 and result = 'failed'
		and details->>'error' like '%sentinel%'`, r.TenantID); n != 1 {
		t.Errorf("failed audit rows = %d", n)
	}
}

// M-16: отказ canary — партии не стартуют: их базы не открываются, версии и routing не меняются.
func TestRolloutCanaryFailureStopsBatches(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	canary, b1, b2 := s.tenant("canary"), s.tenant("bb1"), s.tenant("bb2")
	s.runner.failOn(canary.Database)

	rep, err := s.ctrl.Rollout(t.Context(), Plan{Canary: []string{"canary"}, BatchSize: 1})
	if !errors.Is(err, ErrCanaryFailed) {
		t.Fatalf("err %v, want ErrCanaryFailed", err)
	}
	if s.connect.total() != 1 || s.connect.of(canary.Database) != 1 {
		t.Errorf("opens %v, want only the canary", s.connect.opens)
	}
	for _, r := range []Ref{b1, b2} {
		if s.routing(r) != 0 || s.actual(r) != 0 {
			t.Errorf("%s touched: routing %d actual %d", r.Slug, s.routing(r), s.actual(r))
		}
	}
	if got := failedOf(rep); !slices.Equal(got, []string{"canary"}) {
		t.Errorf("failed %v", got)
	}
	if n := s.count(`select count(*) from platform_audit where result = 'failed'`); n != 1 {
		t.Errorf("failed audit rows = %d, want 1", n)
	}
	if n := s.count(`select count(*) from platform_audit where result = 'ok'`); n != 0 {
		t.Errorf("ok audit rows = %d, want 0", n)
	}
}

// M-17: отказ в партии — текущая партия дорабатывает, следующие не стартуют; ContinueOnFailure — стартуют.
func TestRolloutBatchFailure(t *testing.T) {
	t.Parallel()
	for _, cont := range []bool{false, true} {
		t.Run(fmt.Sprintf("continue=%v", cont), func(t *testing.T) {
			t.Parallel()
			s := newStand(t)
			s.tenant("can")
			_, bad := s.tenant("pp1"), s.tenant("pp2")
			n1, n2 := s.tenant("nn1"), s.tenant("nn2")
			s.runner.failOn(bad.Database)

			rep, err := s.ctrl.Rollout(t.Context(), Plan{BatchSize: 2, ContinueOnFailure: cont})
			if !errors.Is(err, ErrBatchFailed) {
				t.Fatalf("err %v, want ErrBatchFailed", err)
			}
			if got := failedOf(rep); !slices.Equal(got, []string{"pp2"}) {
				t.Errorf("failed %v", got)
			}
			want := []string{"can", "pp1"}
			if cont {
				want = append(want, "nn1", "nn2")
			}
			if got := done(rep); !slices.Equal(got, want) {
				t.Errorf("done %v, want %v", got, want)
			}
			opened := s.connect.of(n1.Database) + s.connect.of(n2.Database)
			if (opened > 0) != cont {
				t.Errorf("next batch opened %d times with continue=%v", opened, cont)
			}
		})
	}
}

// M-18: повтор — все на цели: ничего не мигрируется, аудит не пишется, updated_at не меняется.
func TestRolloutIsIdempotent(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	s.tenant("one")
	s.tenant("two")
	if _, err := s.ctrl.Rollout(t.Context(), Plan{}); err != nil {
		t.Fatal(err)
	}
	audit := s.count(`select count(*) from platform_audit`)
	var before time.Time
	if err := s.control.QueryRowContext(t.Context(), `select max(updated_at) from tenant_routing`).Scan(&before); err != nil {
		t.Fatal(err)
	}
	rep, err := s.ctrl.Rollout(t.Context(), Plan{})
	if err != nil {
		t.Fatal(err)
	}
	if len(rep.Done) != 0 || len(rep.Skipped) != 2 {
		t.Errorf("second run: done %v skipped %v", done(rep), resultSlugs(rep.Skipped))
	}
	if n := s.count(`select count(*) from platform_audit`); n != audit {
		t.Errorf("audit grew from %d to %d", audit, n)
	}
	var after time.Time
	if err := s.control.QueryRowContext(t.Context(), `select max(updated_at) from tenant_routing`).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if !after.Equal(before) {
		t.Errorf("updated_at moved: %s → %s", before, after)
	}
}

// M-20: dry-run — только фазы с From/To: ни одного соединения с tenant DB, ни одной записи.
func TestRolloutDryRunTouchesNothing(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	s.tenant("dd1")
	s.tenant("dd2")
	rep, err := s.ctrl.Rollout(t.Context(), Plan{DryRun: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(rep.Phases) != 2 || rep.Phases[0].Name != PhaseCanary || !rep.DryRun {
		t.Errorf("phases %+v", rep.Phases)
	}
	if s.connect.total() != 0 {
		t.Errorf("dry-run opened %d tenant databases", s.connect.total())
	}
	if n := s.count(`select count(*) from platform_audit`) + s.count(`select count(*) from tenant_routing where schema_version <> 0`); n != 0 {
		t.Errorf("dry-run wrote %d rows", n)
	}
}

// M-21: база мигрирована мимо контроллера (routing 2, факт 3) — Status показывает дрейф, Rollout не «догоняет»
// routing молча: ErrSchemaDrift, routing не меняется.
func TestRolloutRefusesDrift(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	r := s.tenant("drift")
	s.at(r, 2, true, r.Sentinel)
	if _, err := migrations.UpTo(t.Context(), cluster.DB(t, r.Database, migrations.RoleMigrator), migrations.Tenant, 3); err != nil {
		t.Fatal(err)
	}
	st, err := s.ctrl.Status(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if len(st) != 1 || st[0].Actual != 3 || st[0].Ref.SchemaVersion != 2 || !st[0].Drift {
		t.Fatalf("status %+v", st)
	}
	rep, err := s.ctrl.Rollout(t.Context(), Plan{})
	if err == nil || len(rep.Failed) != 1 || !errors.Is(rep.Failed[0].Err, ErrSchemaDrift) {
		t.Fatalf("rollout err %v failed %+v, want ErrSchemaDrift", err, rep.Failed)
	}
	if s.routing(r) != 2 || s.actual(r) != 3 {
		t.Errorf("routing %d actual %d", s.routing(r), s.actual(r))
	}
}

// M-22: два контроллера одновременно — один мигрирует, второй пропускает; в аудите одна строка ok.
func TestConcurrentRolloutsSerialize(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	r := s.tenant("race")
	var (
		wg      sync.WaitGroup
		doneCnt atomic.Int64
		errs    = make(chan error, 2)
	)
	for range 2 {
		wg.Go(func() {
			rep, err := s.controller().Rollout(t.Context(), Plan{})
			if err != nil {
				errs <- err
				return
			}
			doneCnt.Add(int64(len(rep.Done)))
		})
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Errorf("rollout: %v", err)
	}
	if doneCnt.Load() != 1 {
		t.Errorf("done in total %d, want 1", doneCnt.Load())
	}
	if n := s.count(`select count(*) from platform_audit where result = 'ok' and target_id = $1`, r.TenantID); n != 1 {
		t.Errorf("ok audit rows = %d, want 1", n)
	}
	if s.actual(r) != latest {
		t.Errorf("actual %d", s.actual(r))
	}
}

// S1-02 в контроллере: маршрут в служебную БД не открывается (имя проверяется до соединения).
func TestRolloutRefusesServiceDatabase(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	r := s.tenant("svc")
	s.exec(`update tenant_routing set database_name = 'postgres' where tenant_id = $1`, r.TenantID)
	rep, err := s.ctrl.Rollout(t.Context(), Plan{})
	if !errors.Is(err, ErrCanaryFailed) || len(rep.Failed) != 1 || !errors.Is(rep.Failed[0].Err, tenantctx.ErrDatabaseName) {
		t.Fatalf("err %v failed %+v, want ErrDatabaseName", err, rep.Failed)
	}
	if s.connect.of("postgres") != 1 { // Open was asked, the connector refused before dialing
		t.Errorf("opens %v", s.connect.opens)
	}
}

// Откат (down-guard, Q-W0.06-4): только перечисленные slug — никаких «всех»; routing и аудит
// tenant.schema.rollback; пустой список и неизвестный slug — ошибка до действий.
func TestRollbackOnlyListedTenants(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	x, y := s.tenant("xxx"), s.tenant("yyy")
	if _, err := s.ctrl.Rollout(t.Context(), Plan{}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ctrl.Rollback(t.Context(), 1, nil); !errors.Is(err, ErrNoTenants) {
		t.Errorf("no slugs: %v, want ErrNoTenants", err)
	}
	if _, err := s.ctrl.Rollback(t.Context(), 1, []string{"xxx", "ghost"}); !errors.Is(err, ErrUnknownTenant) {
		t.Errorf("unknown slug: %v, want ErrUnknownTenant", err)
	}
	if s.actual(x) != latest {
		t.Fatalf("x rolled back although the request was refused")
	}
	rep, err := s.ctrl.Rollback(t.Context(), 1, []string{"xxx"})
	if err != nil {
		t.Fatal(err)
	}
	if got := done(rep); !slices.Equal(got, []string{"xxx"}) {
		t.Errorf("done %v", got)
	}
	if s.actual(x) != 1 || s.routing(x) != 1 || s.actual(y) != latest {
		t.Errorf("x %d/%d, y %d", s.actual(x), s.routing(x), s.actual(y))
	}
	if n := s.count(`select count(*) from platform_audit where action = 'tenant.schema.rollback' and result = 'ok'
		and target_id = $1 and details->>'to' = '1'`, x.TenantID); n != 1 {
		t.Errorf("rollback audit rows = %d", n)
	}
	// After a rollback the controller brings the tenant forward again (forward-fix path).
	if _, err := s.ctrl.Rollout(t.Context(), Plan{}); err != nil || s.actual(x) != latest {
		t.Errorf("rollout after rollback: %v, actual %d", err, s.actual(x))
	}
}

// Возврат 1 (ревью, major): организация в provisioning — её базу ещё создаёт провиженер (или он от неё отказался,
// ErrForeignDatabase). Контроллер её не трогает: tenants up не делает её canary и не открывает её базу, код 0;
// она в Skipped с причиной; Status не считает её дрейфом; откат её не касается. Доводит её только провиженер.
func TestRolloutSkipsProvisioningTenants(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	current := s.tenant("current")
	s.at(current, latest, true, current.Sentinel)
	pending := s.pending("pending")
	ready := s.tenant("ready")
	s.at(ready, 2, true, ready.Sentinel)

	rep, err := s.ctrl.Rollout(t.Context(), Plan{})
	if err != nil {
		t.Fatalf("rollout with a tenant in provisioning: %v (failed %+v)", err, rep.Failed)
	}
	if len(rep.Phases) == 0 || rep.Phases[0].Name != PhaseCanary || slugs(rep.Phases[0].Tenants)[0] != "ready" {
		t.Errorf("phases %+v, want canary ready", rep.Phases)
	}
	if got := done(rep); !slices.Equal(got, []string{"ready"}) {
		t.Errorf("done %v, want [ready]", got)
	}
	if got := resultSlugs(rep.Skipped); !slices.Equal(got, []string{"current", "pending"}) {
		t.Errorf("skipped %v, want [current pending]", got)
	}
	if s.connect.of(pending.Database) != 0 {
		t.Errorf("the database of a tenant in provisioning was opened %d times", s.connect.of(pending.Database))
	}
	if s.routing(pending) != 0 || s.count(`select count(*) from platform_audit where target_id = $1`, pending.TenantID) != 0 {
		t.Errorf("pending tenant touched: routing %d", s.routing(pending))
	}
	checkPendingOutsideStatusAndRollback(t, s, pending)
}

// checkPendingOutsideStatusAndRollback: Status lists the pending tenant without opening its database and without a
// drift; Rollback refuses it.
func checkPendingOutsideStatusAndRollback(t *testing.T, s *stand, pending Ref) {
	t.Helper()
	st, err := s.ctrl.Status(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	for _, x := range st {
		if x.Ref.TenantID == pending.TenantID && (x.Drift || x.Err != nil) {
			t.Errorf("status of the pending tenant: %+v, want no drift", x)
		}
	}
	if s.connect.of(pending.Database) != 0 {
		t.Errorf("status opened the database of a tenant in provisioning")
	}
	if _, err := s.ctrl.Rollback(t.Context(), 0, []string{"pending"}); !errors.Is(err, ErrProvisioning) {
		t.Errorf("rollback of a tenant in provisioning: %v, want ErrProvisioning", err)
	}
}

// Возврат 1 (ревью): база версии 0 не мигратора (её создал кто-то другой) — контроллер её не «усыновляет»: отказ
// ErrDatabaseOwner до goose, версия и routing не меняются (sentinel в такой базе ещё негде проверить).
func TestRolloutRefusesDatabaseOfAnotherOwner(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	r := s.tenant("alien0")
	foreign := "t_alien_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	if _, err := cluster.DB(t, "postgres", migratetest.Super).ExecContext(t.Context(), `create database `+foreign); err != nil {
		t.Fatal(err)
	}
	s.exec(`update tenant_routing set database_name = $2 where tenant_id = $1`, r.TenantID, foreign)
	r.Database = foreign

	rep, err := s.ctrl.Rollout(t.Context(), Plan{})
	if !errors.Is(err, ErrCanaryFailed) || len(rep.Failed) != 1 || !errors.Is(rep.Failed[0].Err, ErrDatabaseOwner) {
		t.Fatalf("err %v failed %+v, want ErrDatabaseOwner", err, rep.Failed)
	}
	if s.actual(r) != 0 || s.routing(r) != 0 {
		t.Errorf("foreign database migrated: actual %d routing %d", s.actual(r), s.routing(r))
	}
}

// Status: база без соединения — Actual -1 и дрейф с ошибкой, остальные — фактическая версия.
func TestStatusReportsUnreachableDatabase(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	ok, ghost := s.tenant("okk"), s.tenant("ghost")
	s.exec(`update tenant_routing set database_name = 't_ghost_missing' where tenant_id = $1`, ghost.TenantID)
	st, err := s.ctrl.Status(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if len(st) != 2 {
		t.Fatalf("status %+v", st)
	}
	for _, x := range st {
		switch x.Ref.TenantID {
		case ok.TenantID:
			if x.Actual != 0 || x.Drift || x.Err != nil {
				t.Errorf("ok: %+v", x)
			}
		case ghost.TenantID:
			if x.Actual != -1 || !x.Drift || x.Err == nil || strings.Contains(x.Err.Error(), "postgres://") {
				t.Errorf("ghost: %+v", x)
			}
		}
	}
}
