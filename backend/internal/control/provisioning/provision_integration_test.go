//go:build integration

package provisioning

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/control/tenants"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// clusters: every image of migratetest.Images() (17.11 and 16.4 by default): role membership options and
// CREATE DATABASE … OWNER differ between versions. Most tests use the first one.
var clusters []*migratetest.Cluster

func TestMain(m *testing.M) {
	cs, stop, err := migratetest.StartAll(context.Background())
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	clusters = cs
	for _, c := range cs {
		if err := grantProvisioner(c); err != nil {
			fmt.Fprintln(os.Stderr, err)
			stop()
			os.Exit(1)
		}
	}
	code := m.Run()
	stop()
	os.Exit(code)
}

func grantProvisioner(c *migratetest.Cluster) error {
	db, err := sql.Open("pgx", c.URL("postgres", migratetest.Super))
	if err != nil {
		return err
	}
	defer db.Close()
	return EnsureRoleGrants(context.Background(), db)
}

// stand is a migrated control DB and a provisioner over one cluster.
type stand struct {
	t         *testing.T
	c         *migratetest.Cluster
	controlDB string
	control   *sql.DB // ortus_migrator
	api       *sql.DB // ortus_api: what cmd/api registers with
	connect   *flakyConnector
	prov      *Provisioner
}

func newStand(t *testing.T, c *migratetest.Cluster) *stand {
	t.Helper()
	name := c.NewDatabase(t, "ctl")
	control := c.DB(t, name, migrations.RoleMigrator)
	if _, err := migrations.Up(t.Context(), control, migrations.Control); err != nil {
		t.Fatal(err)
	}
	s := &stand{
		t: t, c: c, controlDB: name, control: control, api: c.DB(t, name, migrations.RoleAPI),
		connect: &flakyConnector{inner: tenants.DSNConnector{DSN: c.URL(name, migrations.RoleMigrator), Reserved: []string{name}}},
	}
	s.prov = &Provisioner{
		Control: control,
		Admin:   c.DB(t, "postgres", migrations.RoleProvisioner),
		Connect: s.connect,
	}
	return s
}

// flakyConnector fails the next n opens (a tenant database that is briefly unreachable); onOpen, when set, runs
// before open number n (1-based) of the stand.
type flakyConnector struct {
	inner  tenants.Connector
	fail   atomic.Int32
	opens  atomic.Int32
	onOpen func(n int32)
}

func (f *flakyConnector) Open(ctx context.Context, r tenants.Ref) (*sql.DB, error) {
	if n := f.opens.Add(1); f.onOpen != nil {
		f.onOpen(n)
	}
	if f.fail.Load() > 0 {
		f.fail.Add(-1)
		return nil, errors.New("connect tenant DB " + r.Database + ": connection refused")
	}
	return f.inner.Open(ctx, r)
}

// register creates the control rows the way createPlatformTenant does (as ortus_api).
func (s *stand) register(name, key string) tenants.Tenant {
	s.t.Helper()
	req := validRequest()
	req.Name, req.IdempotencyKey = name, key
	tn, replayed, err := Registrar{Control: s.api}.Register(s.t.Context(), req)
	if err != nil || replayed {
		s.t.Fatalf("register %s: %v (replayed %v)", name, err, replayed)
	}
	return tn
}

func (s *stand) one(q string, args ...any) string {
	s.t.Helper()
	var v sql.NullString
	if err := s.control.QueryRowContext(s.t.Context(), q, args...).Scan(&v); err != nil {
		s.t.Fatalf("%s: %v", q, err)
	}
	return v.String
}

func (s *stand) database(id uuid.UUID) string {
	return s.one(`select database_name from tenant_routing where tenant_id = $1`, id)
}

// S1-01: регистрация пишет tenants (provisioning, industry_pack custom), tenant_routing (secret_ref ортус_api,
// sentinel, версия 0) и platform_audit tenant.create с параметрами заявки; API хватает DML (ortus_api).
func TestRegisterWritesControlRows(t *testing.T) {
	t.Parallel()
	s := newStand(t, clusters[0])
	tn := s.register("Альта Логистика", "create-alta-0001-key")
	if tn.State != "provisioning" || tn.Name != "Альта Логистика" || len(tn.OwnerAccountIDs) != 0 || tn.Revision != 1 {
		t.Errorf("tenant %+v", tn)
	}
	if !strings.HasPrefix(tn.Slug, "alta-logistika-") {
		t.Errorf("slug %q", tn.Slug)
	}
	if got := s.one(`select industry_pack || ' ' || state::text from tenants where id = $1`, tn.ID); got != "custom provisioning" {
		t.Errorf("tenants row: %s", got)
	}
	if got := s.one(`select secret_ref || ' ' || schema_version || ' ' || database_name from tenant_routing where tenant_id = $1`,
		tn.ID); got != "env:TENANT_DB_URL 0 "+DatabaseName(tn.Slug) {
		t.Errorf("routing: %s", got)
	}
	details := s.one(`select details::text from platform_audit where action = 'tenant.create' and target_id = $1
		and actor_kind = 'operator' and result = 'ok'`, tn.ID)
	for _, want := range []string{`"ownerEmail": "owner@alta.example"`, `"timeZone": "Europe/Moscow"`, `"planKey": "pilot"`, `"requestHash"`} {
		if !strings.Contains(details, want) {
			t.Errorf("audit details lack %s: %s", want, details)
		}
	}
}

// Idempotency-Key: тот же ключ и тело — та же организация (replayed); тот же ключ, другое тело — конфликт.
func TestRegisterIsIdempotent(t *testing.T) {
	t.Parallel()
	s := newStand(t, clusters[0])
	first := s.register("Лотос", "create-lotos-0001-key")
	req := validRequest()
	req.Name, req.IdempotencyKey = "Лотос", "create-lotos-0001-key"
	again, replayed, err := Registrar{Control: s.api}.Register(t.Context(), req)
	if err != nil || !replayed || again.ID != first.ID {
		t.Fatalf("replay: %+v %v %v", again, replayed, err)
	}
	req.PlanKey = "business"
	if _, _, err := (Registrar{Control: s.api}).Register(t.Context(), req); !errors.Is(err, ErrIdempotencyConflict) {
		t.Errorf("same key, other body: %v, want ErrIdempotencyConflict", err)
	}
	if n := s.one(`select count(*) from tenants`); n != "1" {
		t.Errorf("tenants = %s, want 1", n)
	}
}

// Сага целиком: БД создана провиженером с владельцем ortus_migrator, CONNECT — без PUBLIC и без провиженера, у
// мониторинга и runtime-ролей (Q-W0.06-2, возврат 1); схема последней версии; sentinel = routing; корневое подразделение и профиль владельца;
// организация в trial; аудит tenant.provision; повтор — пропуск.
func TestProvisionCreatesTenant(t *testing.T) {
	t.Parallel()
	s := newStand(t, clusters[0])
	tn := s.register("Ремстрой", "create-remstroy-0001")
	out, err := s.prov.Provision(t.Context(), tn.ID)
	if err != nil {
		t.Fatal(err)
	}
	latest := migrations.Latest(migrations.Tenant)
	if out.State != "trial" || out.SchemaVersion != latest || out.Skipped || out.Database != DatabaseName(tn.Slug) {
		t.Errorf("outcome %+v", out)
	}
	checkDatabaseGrants(t, s, out.Database)
	checkIdentityAndBootstrap(t, s, tn, out.Database)
	if got := s.one(`select state::text || ' ' || revision from tenants where id = $1`, tn.ID); got != "trial 2" {
		t.Errorf("tenants: %s", got)
	}
	if n := s.one(`select count(*) from platform_audit where action = 'tenant.provision' and result = 'ok' and target_id = $1`, tn.ID); n != "1" {
		t.Errorf("tenant.provision audit rows = %s", n)
	}

	again, err := s.prov.Provision(t.Context(), tn.ID)
	if err != nil || !again.Skipped || again.State != "trial" {
		t.Errorf("second provision: %+v %v", again, err)
	}
}

// checkDatabaseGrants: owner ortus_migrator; CONNECT for monitoring and runtime roles, not PUBLIC, not the
// provisioner (it needs none: every step inside a tenant database runs as the migrator).
func checkDatabaseGrants(t *testing.T, s *stand, db string) {
	t.Helper()
	super := s.c.DB(t, "postgres", migratetest.Super)
	var owner string
	if err := super.QueryRowContext(t.Context(), `select pg_get_userbyid(datdba) from pg_database where datname = $1`, db).
		Scan(&owner); err != nil || owner != migrations.RoleMigrator {
		t.Errorf("owner of %s = %q (%v)", db, owner, err)
	}
	for role, want := range map[string]bool{
		"public": false, migrations.RoleProvisioner: false, "pg_monitor": true, migrations.RoleAPI: true, migrations.RoleWorker: true,
	} {
		var got bool
		if err := super.QueryRowContext(t.Context(), `select has_database_privilege($1, $2, 'CONNECT')`, role, db).Scan(&got); err != nil || got != want {
			t.Errorf("CONNECT of %s on %s = %v, want %v (%v)", role, db, got, want, err)
		}
	}
}

// checkIdentityAndBootstrap: sentinel = tenant_routing; root unit with the name and zone of the request; owner profile.
func checkIdentityAndBootstrap(t *testing.T, s *stand, tn tenants.Tenant, db string) {
	t.Helper()
	tdb := s.c.DB(t, db, migrations.RoleAPI)
	var tenantID, sentinel uuid.UUID
	if err := tdb.QueryRowContext(t.Context(), `select tenant_id, sentinel from core.tenant_identity`).Scan(&tenantID, &sentinel); err != nil {
		t.Fatal(err)
	}
	if tenantID != tn.ID || sentinel.String() != s.one(`select sentinel::text from tenant_routing where tenant_id = $1`, tn.ID) {
		t.Errorf("identity %s/%s does not match the route", tenantID, sentinel)
	}
	var unit, zone, email string
	if err := tdb.QueryRowContext(t.Context(), `select u.name, u.time_zone, p.email from org.units u
		join people.person_profiles p on p.home_unit_id = u.id where u.id = $1 and p.id = $2`,
		RootUnitID(tn.ID), OwnerPersonID(tn.ID)).Scan(&unit, &zone, &email); err != nil {
		t.Fatalf("root unit and owner profile: %v", err)
	}
	if unit != "Ремстрой" || zone != "Europe/Moscow" || email != "owner@alta.example" {
		t.Errorf("bootstrap: %s %s %s", unit, zone, email)
	}
}

// Упавший шаг: аудит failed со ссылкой на шаг, организация остаётся в provisioning; следующий запуск доводит.
func TestProvisionResumesAfterFailure(t *testing.T) {
	t.Parallel()
	s := newStand(t, clusters[0])
	tn := s.register("Карго", "create-cargo-00001")
	s.connect.fail.Store(1)
	if _, err := s.prov.Provision(t.Context(), tn.ID); err == nil {
		t.Fatal("provision with an unreachable tenant DB succeeded")
	}
	if got := s.one(`select state::text from tenants where id = $1`, tn.ID); got != "provisioning" {
		t.Errorf("state after failure: %s", got)
	}
	if got := s.one(`select details->>'step' from platform_audit where action = 'tenant.provision' and result = 'failed'
		and target_id = $1`, tn.ID); got != StepGrants {
		t.Errorf("failed step %q, want %s", got, StepGrants)
	}
	pending, err := s.prov.Pending(t.Context())
	if err != nil || len(pending) != 1 || pending[0] != tn.ID {
		t.Fatalf("pending %v %v", pending, err)
	}
	sum, err := s.prov.RunOnce(t.Context())
	if err != nil || sum.Provisioned != 1 || sum.Failed != 0 {
		t.Fatalf("run once: %+v %v", sum, err)
	}
	if got := s.one(`select state::text from tenants where id = $1`, tn.ID); got != "trial" {
		t.Errorf("state after resume: %s", got)
	}
}

// База с именем организации уже есть и принадлежит не мигратору: провиженер её не «усыновляет».
func TestProvisionRefusesForeignDatabase(t *testing.T) {
	t.Parallel()
	s := newStand(t, clusters[0])
	tn := s.register("Чужая база", "create-foreign-0001")
	super := s.c.DB(t, "postgres", migratetest.Super)
	if _, err := super.ExecContext(t.Context(), `create database `+s.database(tn.ID)); err != nil {
		t.Fatal(err)
	}
	_, err := s.prov.Provision(t.Context(), tn.ID)
	if !errors.Is(err, ErrForeignDatabase) {
		t.Fatalf("err %v, want ErrForeignDatabase", err)
	}
	if got := s.one(`select details->>'step' from platform_audit where action = 'tenant.provision' and result = 'failed'
		and target_id = $1`, tn.ID); got != StepDatabase {
		t.Errorf("failed step %q", got)
	}
}

// AC-02 для новых организаций: пул API (ortus_api, secret_ref env:TENANT_DB_URL) открывает базу своей
// организации по sentinel; маршрут одной организации в базу другой — отказ без пула.
func TestProvisionedTenantsAreIsolated(t *testing.T) {
	t.Parallel()
	s := newStand(t, clusters[0])
	x, y := s.register("Икс", "create-x-000000001"), s.register("Игрек", "create-y-000000001")
	if sum, err := s.prov.RunOnce(t.Context()); err != nil || sum.Provisioned != 2 {
		t.Fatalf("run once: %+v %v", sum, err)
	}
	pool, err := pgxpool.New(t.Context(), s.c.URL(s.controlDB, migrations.RoleAPI))
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	env := map[string]string{"TENANT_DB_URL": s.c.URL("", migrations.RoleAPI)}
	pools := tenantctx.NewPools(tenantctx.NewPGDirectory(pool), func(k string) string { return env[k] }, "")
	pools.RetryAfter = 0
	defer pools.Close()
	if _, err := pools.For(t.Context(), x.ID); err != nil {
		t.Fatalf("pool of x: %v", err)
	}
	dbY := s.database(y.ID)
	if _, err := s.control.ExecContext(t.Context(), `update tenant_routing set database_name = 'parked_y' where tenant_id = $1`, y.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.control.ExecContext(t.Context(), `update tenant_routing set database_name = $2 where tenant_id = $1`, x.ID, dbY); err != nil {
		t.Fatal(err)
	}
	other := tenantctx.NewPools(tenantctx.NewPGDirectory(pool), func(k string) string { return env[k] }, "")
	other.RetryAfter = 0
	defer other.Close()
	if _, err := other.For(t.Context(), x.ID); !problem.Is(err, problem.CodeDependencyUnavailable) {
		t.Errorf("x routed to y's database: %v, want dependency_unavailable", err)
	}
	if len(other.Opened()) != 0 {
		t.Errorf("misrouted pool cached: %v", other.Opened())
	}
}

// 17.11 и 16.4: членство с SET без INHERIT и CREATE DATABASE … OWNER ortus_migrator ролью ortus_provisioner.
// Возврат 1 (ревью, major): у ortus_provisioner нет CONNECT к базе организации — войти в неё и прочитать данные
// напрямую он не может (negative). Принятый риск, вынесенный в decisionsNeeded (владелец — security): членство с SET
// позволяет ortus_provisioner в служебной базе сделать SET ROLE ortus_migrator, то есть его учётка равносильна
// учётке мигратора. Тест фиксирует это как известное, чтобы смена схемы ролей не прошла незаметно.
func TestProvisionOnEveryImage(t *testing.T) {
	t.Parallel()
	for _, c := range clusters {
		image, _, _ := strings.Cut(c.Image, "@")
		t.Run(image, func(t *testing.T) {
			t.Parallel()
			s := newStand(t, c)
			tn := s.register("Образ", "create-image-00001")
			if out, err := s.prov.Provision(t.Context(), tn.ID); err != nil || out.State != "trial" {
				t.Fatalf("provision: %+v %v", out, err)
			}
			checkProvisionerHasNoTenantAccess(t, s, s.database(tn.ID))
		})
	}
}

// checkProvisionerHasNoTenantAccess: a login as ortus_provisioner to the tenant database is refused (42501, no
// CONNECT); SET ROLE ortus_migrator in the maintenance database works — the documented equivalence of the roles.
func checkProvisionerHasNoTenantAccess(t *testing.T, s *stand, db string) {
	t.Helper()
	prov, err := sql.Open("pgx", s.c.URL(db, migrations.RoleProvisioner))
	if err != nil {
		t.Fatal(err)
	}
	defer prov.Close()
	err = prov.PingContext(t.Context())
	if pgErr, ok := errors.AsType[*pgconn.PgError](err); !ok || pgErr.Code != "42501" {
		t.Errorf("ortus_provisioner connects to tenant database %s: %v, want SQLSTATE 42501 (no CONNECT)", db, err)
	}
	admin := s.c.DB(t, "postgres", migrations.RoleProvisioner)
	conn, err := admin.Conn(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := conn.ExecContext(t.Context(), `set role `+migrations.RoleMigrator); err != nil {
		t.Errorf("documented risk changed: ortus_provisioner can no longer SET ROLE %s (%v) — update roles.go, "+
			"the report and decisions.md", migrations.RoleMigrator, err)
	}
	_, _ = conn.ExecContext(t.Context(), `reset role`)
}

// Возврат 1 (ревью, minor): организацию, которую уже ведёт другой провиженер (замок организации в control DB),
// второй пропускает — ни базы, ни аудита failed из-за проигранной гонки CREATE DATABASE.
func TestProvisionSkipsTenantLockedByAnotherProvisioner(t *testing.T) {
	t.Parallel()
	s := newStand(t, clusters[0])
	tn := s.register("Занята", "create-locked-00001")
	other, err := s.control.Conn(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	const key = `hashtextextended('ortus:tenant-provision:' || $1::text, 0)`
	if _, err := other.ExecContext(t.Context(), `select pg_advisory_lock(`+key+`)`, tn.ID); err != nil {
		t.Fatal(err)
	}
	out, err := s.prov.Provision(t.Context(), tn.ID)
	if err != nil || !out.Skipped || out.State != "provisioning" {
		t.Errorf("provision of a locked tenant: %+v %v, want skipped in provisioning", out, err)
	}
	var exists bool
	if err := s.control.QueryRowContext(t.Context(), `select exists (select 1 from pg_database where datname = $1)`,
		s.database(tn.ID)).Scan(&exists); err != nil || exists {
		t.Errorf("database of a locked tenant created: %v %v", exists, err)
	}
	if n := s.one(`select count(*) from platform_audit where action = 'tenant.provision' and target_id = $1`, tn.ID); n != "0" {
		t.Errorf("tenant.provision audit rows = %s, want 0", n)
	}
	if _, err := other.ExecContext(t.Context(), `select pg_advisory_unlock(`+key+`)`, tn.ID); err != nil {
		t.Fatal(err)
	}
	if out, err := s.prov.Provision(t.Context(), tn.ID); err != nil || out.State != "trial" {
		t.Errorf("provision after unlock: %+v %v", out, err)
	}
}

// Возврат 1 (ревью, minor): состояние сменили во время саги (оператор приостановил организацию) — activate не
// трогает организацию и не пишет tenant.provision ok; итог — фактическое состояние, шаг пропущен.
func TestProvisionActivateKeepsConcurrentStateChange(t *testing.T) {
	t.Parallel()
	s := newStand(t, clusters[0])
	tn := s.register("Приостановлена", "create-suspended-01")
	s.connect.onOpen = func(n int32) {
		if n == 3 { // grants → migrate → bootstrap: the operator suspends the tenant meanwhile
			if _, err := s.control.ExecContext(context.Background(), `update tenants set state = 'suspended' where id = $1`, tn.ID); err != nil {
				t.Error(err)
			}
		}
	}
	out, err := s.prov.Provision(t.Context(), tn.ID)
	if err != nil {
		t.Fatal(err)
	}
	if out.State != "suspended" || !out.Skipped {
		t.Errorf("outcome %+v, want suspended and skipped", out)
	}
	if got := s.one(`select state::text from tenants where id = $1`, tn.ID); got != "suspended" {
		t.Errorf("state %s, want suspended", got)
	}
	if n := s.one(`select count(*) from platform_audit where action = 'tenant.provision' and result = 'ok' and target_id = $1`, tn.ID); n != "0" {
		t.Errorf("tenant.provision ok rows = %s, want 0", n)
	}
}

// Неизвестная организация — ошибка шага load без записи аудита о чужом id; роль мониторинга, которой нет в
// кластере, пропускается; RunOnce считает упавшие организации и продолжает остальные.
func TestProvisionEdges(t *testing.T) {
	t.Parallel()
	s := newStand(t, clusters[0])
	ghost := uuid.New()
	if _, err := s.prov.Provision(t.Context(), ghost); !errors.Is(err, tenants.ErrUnknownTenant) || !strings.Contains(err.Error(), StepLoad) {
		t.Errorf("unknown tenant: %v", err)
	}
	if n := s.one(`select count(*) from platform_audit where target_id = $1`, ghost); n != "0" {
		t.Errorf("audit rows for an unknown tenant: %s", n)
	}

	s.prov.ConnectRoles = []string{migrations.RoleProvisioner, "ortus_monitor_absent"}
	bad, good := s.register("Занятая база", "create-busy-000001"), s.register("Свободная", "create-free-000001")
	if _, err := s.c.DB(t, "postgres", migratetest.Super).ExecContext(t.Context(), `create database `+s.database(bad.ID)); err != nil {
		t.Fatal(err)
	}
	sum, err := s.prov.RunOnce(t.Context())
	if err != nil || sum.Provisioned != 1 || sum.Failed != 1 || len(sum.Errors) != 1 || !errors.Is(sum.Errors[0], ErrForeignDatabase) {
		t.Fatalf("run once: %+v %v", sum, err)
	}
	if got := s.one(`select state::text from tenants where id = $1`, good.ID); got != "trial" {
		t.Errorf("good tenant: %s", got)
	}
	// Возврат 1: ortus_provisioner in ConnectRoles is ignored — the provisioner never gets CONNECT on a tenant DB.
	if got := s.one(`select has_database_privilege($1, $2, 'CONNECT')::text`, migrations.RoleProvisioner, s.database(good.ID)); got != "false" {
		t.Errorf("CONNECT of %s on the good tenant = %s, want false", migrations.RoleProvisioner, got)
	}
	if !strings.Contains(Steps(), StepBootstrap) {
		t.Errorf("Steps() = %q", Steps())
	}
}
