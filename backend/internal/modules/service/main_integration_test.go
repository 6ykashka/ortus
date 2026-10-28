//go:build integration

package service_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib" // database/sql driver "pgx"

	"github.com/ortus/ortus-crm/backend/internal/modules/service" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"              //nolint:depguard // integration test: role names of the test cluster
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: clock and PostgreSQL of the suites
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04
)

var (
	world *fixtures.World
	dbs   = map[string]*sql.DB{}
)

func TestMain(m *testing.M) { os.Exit(runMain(m)) }

func runMain(m *testing.M) int {
	ctx := context.Background()
	c, stop, err := harness.StartPostgres(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer stop()
	if world, err = fixtures.Load(ctx, c, "service", harness.Now()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	for _, t := range []string{"a", "b"} {
		d, err := sql.Open("pgx", world.TenantURL(t, "super"))
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		d.SetMaxOpenConns(8)
		defer d.Close()
		dbs[t] = d
	}
	if err := writeDemo(ctx); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	return m.Run()
}

func ref(r string) uuid.UUID {
	id, err := world.ID(r)
	if err != nil {
		panic(err)
	}
	return id
}

func person(actor string) uuid.UUID { return ref("person:" + actor + "@a") }

// Actors of the tests: the owner of the demo, two dispatchers of ГРЗ, the masseuse the complaint МАС-41 is about.
const (
	owner      = "a.owner"
	kotova     = "a.manager-msk1"
	kotelnikov = "a.manager-msk2"
	morozova   = "a.region-msk"
	nobody     = "a.driver-msk1"
)

// demoID maps the prototype ids of the demo to the people of the fixtures (the others get an id of their own).
func demoID(proto string) uuid.UUID {
	switch proto {
	case "m-owner":
		return person(owner)
	case "m-kotova":
		return person(kotova)
	case "m-kotelnikova":
		return person(kotelnikov)
	case "m-morozova":
		return person(morozova)
	}
	return uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:t-alta:"+proto))
}

func writeDemo(ctx context.Context) error {
	ex := func(ctx context.Context, q string, args ...any) error {
		_, err := dbs["a"].ExecContext(ctx, q, args...)
		return err
	}
	if err := service.WriteDemo(ctx, ex, demoID); err != nil {
		return err
	}
	// The roles of the demo (r-agent): ГРЗ for the dispatchers, МАС for the masseuse (she sees the direction, not the complaint about her).
	by := person(owner)
	for _, g := range []struct {
		who     string
		project string
		actions []string
	}{
		{kotova, "svc-grz", agent}, {kotelnikov, "svc-grz", agent}, {morozova, "svc-mas", []string{"service.requests.read", "service.requests.reply"}},
	} {
		role := uuid.New()
		if _, err := dbs["a"].ExecContext(ctx, `insert into access.roles (id, name, kind) values ($1, $2, 'custom')`, role, "Обращения "+g.who); err != nil {
			return err
		}
		if _, err := dbs["a"].ExecContext(ctx, `insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`, role, g.actions, by); err != nil {
			return err
		}
		if _, err := dbs["a"].ExecContext(ctx, `insert into access.role_assignments (principal_kind, principal_id, role_id, role_version, scope_kind, scope_ref, granted_by, valid)
			values ('person', $1, $2, 1, 'project', $3, $4, tstzrange('2020-01-01', null))`, person(g.who), role, demoID(g.project), by); err != nil {
			return err
		}
	}
	return nil
}

var agent = []string{"service.requests.read", "service.requests.create", "service.requests.reply", "service.requests.resolve"}

type members map[uuid.UUID]service.Member

func (m members) Memberships(context.Context, uuid.UUID) (map[uuid.UUID]service.Member, error) {
	return m, nil
}

// fakeTasks is the port of «Задачи» of the tests.
type fakeTasks struct {
	refuse string
	made   []service.TaskInput
}

func (f *fakeTasks) CreateTask(_ context.Context, _ pgx.Tx, _ uuid.UUID, t service.TaskInput) (service.TaskResult, error) {
	if f.refuse != "" {
		return service.TaskResult{Refused: f.refuse}, nil
	}
	f.made = append(f.made, t)
	return service.TaskResult{ID: uuid.New(), Key: "SVC-101", Status: "Новая"}, nil
}

type env struct {
	dir   *tenantctx.PGDirectory
	svc   *service.Service
	tasks *fakeTasks
	now   time.Time
}

// newEnv is a service over the pools of the world with the clock of the demo (1.10.2026 16:24 Moscow).
func newEnv(t *testing.T) env {
	t.Helper()
	ctx := t.Context()
	control, err := pgxpool.New(ctx, world.ControlURL(migrations.RoleAPI))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(control.Close)
	vars := world.Env()
	dir := tenantctx.NewPGDirectory(control)
	pools := tenantctx.NewPools(dir, func(k string) string { return vars[k] }, vars["TENANT_DB_HOST"])
	t.Cleanup(pools.Close)
	src := authz.PGSource{Pools: pools}
	ev := authz.New(src, src, func() time.Time { return service.DemoBase })
	ft := &fakeTasks{}
	svc := &service.Service{Pools: pools, Authz: ev, Tasks: ft, Audience: inbox.AuthzAudience{E: ev}, Now: func() time.Time { return service.DemoBase },
		Directory: members{person(owner): {Active: true, Owner: true}}}
	return env{dir: dir, svc: svc, tasks: ft, now: service.DemoBase}
}

func (e env) tc(t *testing.T, actor string) tenantctx.TenantContext {
	t.Helper()
	a, err := world.Actor(actor)
	if err != nil {
		t.Fatal(err)
	}
	tc, err := tenantctx.Resolve(t.Context(), e.dir, a.AccountID, ref("tenant:a").String(), false)
	if err != nil {
		t.Fatal(err)
	}
	return tc
}

func exec(t *testing.T, q string, args ...any) {
	t.Helper()
	if _, err := dbs["a"].ExecContext(t.Context(), q, args...); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
}

func scalar[T any](t *testing.T, q string, args ...any) T {
	t.Helper()
	var v T
	if err := dbs["a"].QueryRowContext(t.Context(), q, args...).Scan(&v); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
	return v
}

func wantProblem(t *testing.T, err error, code string) *problem.Error {
	t.Helper()
	pe, ok := errors.AsType[*problem.Error](err)
	if !ok || pe.Code != code {
		t.Fatalf("error %v, want %s", err, code)
	}
	return pe
}

// requestID is the id of a request of the demo by its prototype id.
func requestID(proto string) uuid.UUID { return demoID(proto) }
