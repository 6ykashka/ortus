//go:build integration

package chats

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"              //nolint:depguard // integration test: role names of the test cluster
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"  //nolint:depguard // integration test: the superuser that writes the seed
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: clock and PostgreSQL of the suites
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04
)

// The world of the integration tests: the isolation fixtures (W1.04) and, in tenant A, a small «Альта»: a region with two
// companies, eight people, a group and one role with the module «Чаты» at the level of the organization. The statuses of
// the memberships come from a fake of the control DB; the evaluator is a table of grants.
var (
	fx      *fixtures.World
	superA  *pgxpool.Pool
	pools   *tenantctx.Pools
	tenantA uuid.UUID
	svc     *Service
	srv     Server

	clock    = &testClock{t: harness.Now()}
	grants   = fakePerm{}
	statuses = fakeMemberships{}
	tasks    = &fakeTasks{}
	files    = &fakeFiles{}
	hints    = &fakeHints{}
)

type testClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *testClock) now() time.Time      { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *testClock) set(t time.Time)     { c.mu.Lock(); c.t = t; c.mu.Unlock() }
func (c *testClock) add(d time.Duration) { c.mu.Lock(); c.t = c.t.Add(d); c.mu.Unlock() }

func TestMain(m *testing.M) { os.Exit(runMain(m)) }

func runMain(m *testing.M) int {
	ctx := context.Background()
	c, stop, err := harness.StartPostgres(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer stop()
	if fx, err = fixtures.Load(ctx, c, "chats", harness.Now()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if superA, err = pgxpool.New(ctx, fx.TenantURL(fixtures.TenantA, migratetest.Super)); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer superA.Close()
	control, err := pgxpool.New(ctx, fx.ControlURL(migrations.RoleAPI))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer control.Close()
	vars := fx.Env()
	pools = tenantctx.NewPools(tenantctx.NewPGDirectory(control), func(k string) string { return vars[k] }, vars["TENANT_DB_HOST"])
	defer pools.Close()
	if tenantA, err = fx.ID("tenant:a"); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if err := seedWorld(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "seed:", err)
		return 1
	}
	svc = &Service{Pools: pools, Memberships: statuses, Perm: grants, Tasks: tasks, Files: files, Hints: hints,
		PollKey: []byte("test-poll-voter-key-32-bytes-long!!"), Now: clock.now}
	srv = Server{S: svc}
	return m.Run()
}

// pid is the id of a person or object of the test world by its short name (deterministic).
func pid(name string) uuid.UUID { return uuid.NewSHA1(uuid.NameSpaceURL, []byte("chats-test:"+name)) }

// People of the world; the second column is the unit, the third the status of the membership.
var people = []struct {
	proto, name, unit, status string
	owner, driver, module     bool
}{
	{"owner", "Дарья Зимина", "f-sever", "active", true, false, true},
	{"logist", "Марина Котова", "f-sever", "active", false, false, true},
	{"driver", "Илья Васильев", "f-sever", "active", false, true, true},
	{"foreman", "Алексей Соколов", "f-sever", "active", false, false, true},
	{"vera", "Вера Котельникова", "f-sever", "active", false, false, true},
	{"outsider", "Игорь Яхонтов", "f-yug", "active", false, false, true},
	{"blocked", "Кирилл Громов", "f-sever", "suspended", false, false, true},
	{"invited", "Сергей Ильин", "f-sever", "invited", false, false, true},
	{"nomodule", "Пётр Лазарев", "f-sever", "active", false, false, false},
}

func exec(ctx context.Context, sql string, args ...any) error {
	_, err := superA.Exec(ctx, sql, args...)
	return err
}

func seedWorld(ctx context.Context) error { //nolint:gocyclo // one scenario with its checks
	for _, u := range []struct{ proto, parent, kind, name string }{
		{"r-msk", "", "region", "Москва"}, {"f-sever", "r-msk", "company", "Север Логистик"}, {"f-yug", "r-msk", "company", "Юг Транс"},
	} {
		var parent any
		if u.parent != "" {
			parent = pid(u.parent)
		}
		if err := exec(ctx, `insert into org.units (id, parent_id, kind, name, time_zone) values ($1, $2, $3, $4, 'Europe/Moscow')`, pid(u.proto), parent, u.kind, u.name); err != nil {
			return err
		}
		if err := exec(ctx, `insert into org.unit_closure (ancestor_id, descendant_id, depth)
			select $1::uuid, $1::uuid, 0 union all select $2::uuid, $1::uuid, 1 where $2::uuid is not null`, pid(u.proto), parent); err != nil {
			return err
		}
	}
	if err := exec(ctx, `insert into access.roles (id, name, kind, template_key) values ($1, 'Чаты · тест', 'custom', null)`, pid("role-chat")); err != nil {
		return err
	}
	if err := exec(ctx, `insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`, pid("role-chat"),
		[]string{"chat.read", "chat.write", "chat.files.send", "chat.polls.create", "chat.create", "chat.direct"}, pid("owner")); err != nil {
		return err
	}
	for _, p := range people {
		if err := exec(ctx, `insert into people.person_profiles (id, membership_id, full_name, home_unit_id) values ($1, $2, $3, $4)`,
			pid(p.proto), pid("membership:"+p.proto), p.name, pid(p.unit)); err != nil {
			return err
		}
		statuses[pid("membership:"+p.proto)] = Membership{Status: p.status, Owner: p.owner}
		if p.driver {
			if err := exec(ctx, `insert into people.work_profiles (person_id, function, unit_id, valid) values ($1, 'driver', $2, tstzrange('2026-09-01 00:00+03', null))`,
				pid(p.proto), pid(p.unit)); err != nil {
				return err
			}
		}
		if p.module {
			if err := exec(ctx, `insert into access.role_assignments (principal_kind, principal_id, role_id, role_version, scope_kind, valid, granted_by)
				values ('person', $1, $2, 1, 'tenant', tstzrange('2026-09-01 00:00+03', null), $3)`, pid(p.proto), pid("role-chat"), pid("owner")); err != nil {
				return err
			}
		}
	}
	if err := exec(ctx, `insert into access.groups (id, name) values ($1, 'Диспетчеры Север')`, pid("group-disp")); err != nil {
		return err
	}
	for _, m := range []string{"logist", "foreman"} {
		if err := exec(ctx, `insert into access.group_members (group_id, person_id) values ($1, $2)`, pid("group-disp"), pid(m)); err != nil {
			return err
		}
	}
	grants.allow("logist", "chat.create", "chat.direct", "chat.export")
	return nil
}

// fakePerm is the evaluator of the tests: a table of the actions of the people (the owner of the business has all).
type fakePerm map[uuid.UUID]map[string]bool

func (f fakePerm) allow(proto string, actions ...string) {
	if f[pid(proto)] == nil {
		f[pid(proto)] = map[string]bool{}
	}
	for _, a := range actions {
		f[pid(proto)][a] = true
	}
}

func (f fakePerm) deny(proto string, actions ...string) {
	for _, a := range actions {
		delete(f[pid(proto)], a)
	}
}

func (f fakePerm) Permit(_ context.Context, tc tenantctx.TenantContext, action string, _ authz.Resource) error {
	if f[tc.PersonID][action] {
		return nil
	}
	return problem.New(problem.CodeForbiddenAction, "")
}

type fakeMemberships map[uuid.UUID]Membership

func (f fakeMemberships) Memberships(_ context.Context, _ uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]Membership, error) {
	out := map[uuid.UUID]Membership{}
	for _, id := range ids {
		if m, ok := f[id]; ok {
			out[id] = m
		}
	}
	return out, nil
}

type fakeTasks struct{ made []TaskDraft }

func (f *fakeTasks) Create(_ context.Context, _ tenantctx.TenantContext, d TaskDraft) (TaskResult, error) {
	f.made = append(f.made, d)
	return TaskResult{ID: uuid.New(), Key: fmt.Sprintf("LOG-%d", 100+len(f.made))}, nil
}

type fakeFiles struct {
	mu      sync.Mutex
	removed []uuid.UUID
	moved   map[uuid.UUID]ObjectRef
	saved   []string
}

func (f *fakeFiles) Move(_ context.Context, _ pgx.Tx, id uuid.UUID, owner ObjectRef) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.moved == nil {
		f.moved = map[uuid.UUID]ObjectRef{}
	}
	f.moved[id] = owner
	return nil
}

func (f *fakeFiles) Remove(_ context.Context, _ pgx.Tx, ids []uuid.UUID) (func(context.Context), error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.removed = append(f.removed, ids...)
	return nil, nil
}

func (f *fakeFiles) ViewURL(_ context.Context, _ uuid.UUID, id uuid.UUID, _ time.Duration) (string, error) {
	return "https://files.test/view/" + id.String(), nil
}

func (f *fakeFiles) Save(_ context.Context, _ pgx.Tx, _ uuid.UUID, _ uuid.UUID, _ ObjectRef, name, _ string, data []byte) (uuid.UUID, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.saved = append(f.saved, name+":"+strconv.Itoa(len(data)))
	return uuid.Nil, nil
}

type fakeHints struct {
	mu   sync.Mutex
	seen []uuid.UUID
}

func (f *fakeHints) ChatChanged(_ context.Context, _, chat uuid.UUID, _ int64, _ []uuid.UUID) {
	f.mu.Lock()
	f.seen = append(f.seen, chat)
	f.mu.Unlock()
}

// as is the context of a person of the world in tenant A as the gateway makes it.
func as(t *testing.T, proto string) (context.Context, tenantctx.TenantContext) {
	t.Helper()
	tc := tenantctx.TenantContext{TenantID: tenantA, PersonID: pid(proto), Owner: proto == "owner"}
	return tenantctx.WithTenant(t.Context(), tc), tc
}

func problemOf(err error) (string, string) {
	if pe, ok := errors.AsType[*problem.Error](err); ok {
		return pe.Code, pe.Detail
	}
	return "", ""
}

// wantProblem fails the test unless err is the problem code (and, if given, the detail).
func wantProblem(t *testing.T, err error, code string, detail ...string) {
	t.Helper()
	c, d := problemOf(err)
	if c != code || (len(detail) > 0 && d != detail[0]) {
		t.Fatalf("err = %v (code %q, detail %q), want %q %v", err, c, d, code, detail)
	}
}

func must[T any](v T, err error) T {
	if err != nil {
		panic(fmt.Sprintf("unexpected error: %v", err))
	}
	return v
}
