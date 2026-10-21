//go:build integration

package tasks

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"              //nolint:depguard // integration test: role names of the test cluster
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"  //nolint:depguard // integration test: the superuser that writes the data of the tests
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: clock and PostgreSQL of the suites
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04 with the content of tasks
)

// The world of the package: the isolation fixtures of W1.04 with their content (W4.11: «Автопарк» limited and
// «Стройка» closed in Москва-1, three tasks and a rule each tenant), the roles of projects «Исполнитель» and
// «Наблюдатель проекта» added to tenant A, and the service wired like cmd/api. Tests that change data create their own
// projects (as the owner) and never touch the projects of the fixtures.
var (
	world                                           *fixtures.World
	superA                                          *pgxpool.Pool // tenant DB of A as the superuser
	control                                         *pgxpool.Pool // control DB as ortus_api
	pools                                           *tenantctx.Pools
	dir                                             *tenantctx.PGDirectory
	ev                                              *authz.Evaluator
	roleExec, roleViewer, roleApprover, roleManager uuid.UUID
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
	if world, err = fixtures.Load(ctx, c, "tasks", harness.Now(), fixtures.WithContent()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if superA, err = pgxpool.New(ctx, world.TenantURL(fixtures.TenantA, migratetest.Super)); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer superA.Close()
	if control, err = pgxpool.New(ctx, world.ControlURL(migrations.RoleAPI)); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer control.Close()
	vars := world.Env()
	dir = tenantctx.NewPGDirectory(control)
	pools = tenantctx.NewPools(dir, func(k string) string { return vars[k] }, vars["TENANT_DB_HOST"])
	defer pools.Close()
	src := authz.PGSource{Pools: pools}
	ev = authz.New(src, src, clock) // the clock of the service: what a request writes is valid for the next one
	ev.ContainerReads = map[string][]string{authz.KindProject: ContainerReads()}
	ev.Places = map[string]authz.ObjectResolver{authz.KindProject: ProjectPlaces{Pools: pools}}
	if err := projectRoles(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "roles:", err)
		return 1
	}
	return m.Run()
}

// projectRoles adds the templates «Исполнитель» and «Наблюдатель проекта» to tenant A (the fixtures have the manager
// and the approver only).
func projectRoles(ctx context.Context) error {
	roleManager, roleApprover = ref("role:a.project_manager"), ref("role:a.project_approver")
	roleExec, roleViewer = uuid.New(), uuid.New()
	for _, r := range []struct {
		id             uuid.UUID
		name, template string
		actions        []string
	}{
		{roleExec, "Исполнитель", tmplExecutor, execActions},
		{roleViewer, "Наблюдатель проекта", tmplViewer, viewerActions},
	} {
		if _, err := superA.Exec(ctx, `insert into access.roles (id, name, kind, template_key) values ($1, $2, 'template', $3)`,
			r.id, r.name, r.template); err != nil {
			return err
		}
		if _, err := superA.Exec(ctx, `insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`,
			r.id, r.actions, person("a.owner")); err != nil {
			return err
		}
	}
	return nil
}

func ref(r string) uuid.UUID {
	id, err := world.ID(r)
	if err != nil {
		panic(err)
	}
	return id
}

func person(actor string) uuid.UUID { return ref("person:" + actor + "@a") }

func unit(key string) uuid.UUID { return ref("unit:a." + key) }

// service is the module wired like cmd/api: the evaluator, the directory of the control DB and the inbox.
func service() *Service {
	return &Service{Pools: pools, Authz: ev, Directory: ControlDirectory{DB: control}, Audience: inbox.AuthzAudience{E: ev}, Now: clock}
}

var ticks atomic.Int64

// clock is the clock of the suites moving a millisecond a call: the requests of a test follow each other in the
// history (in production the wall clock does).
func clock() time.Time { return harness.Now().Add(time.Duration(ticks.Add(1)) * time.Millisecond) }

// as resolves the tenant context of actor in tenant A, as the gateway does.
func as(t *testing.T, actor string) tenantctx.TenantContext {
	t.Helper()
	a, err := world.Actor(actor)
	if err != nil {
		t.Fatal(err)
	}
	tc, err := tenantctx.Resolve(t.Context(), dir, a.AccountID, ref("tenant:a").String(), true)
	if err != nil {
		t.Fatal(err)
	}
	return tc
}

// wantCode requires the Problem.code and, when detail is not empty, the detail of err.
func wantCode(t *testing.T, err error, code, detail string) {
	t.Helper()
	if err == nil {
		t.Fatalf("no error, want %s «%s»", code, detail)
	}
	if got := codeOf(err); got != code {
		t.Fatalf("%v: code %q, want %q", err, got, code)
	}
	if detail != "" && detailOf(err) != detail {
		t.Fatalf("detail «%s», want «%s»", detailOf(err), detail)
	}
}

// wantReason requires a 409 invalid_transition with reason.
func wantReason(t *testing.T, err error, reason, detail string) {
	t.Helper()
	f, ok := asFailure(err)
	if !ok || f.code != codeTransition || f.reason != reason || (detail != "" && f.detail != detail) {
		t.Fatalf("%v (%+v), want invalid_transition %s «%s»", err, f, reason, detail)
	}
}

// wantField requires a 422 validation_failed with a violation of field and its message.
func wantField(t *testing.T, err error, field, message string) {
	t.Helper()
	f, ok := asFailure(err)
	if !ok || f.code != codeValidation || len(f.violations) == 0 || f.violations[0].Field != field || f.violations[0].Message != message {
		t.Fatalf("%v (%+v), want validation_failed %s «%s»", err, f, field, message)
	}
}

// result is a value and its error: must(f()).of(t) fails the test on the error.
type result[T any] struct {
	v   T
	err error
}

func must[T any](v T, err error) result[T] { return result[T]{v, err} }

func (r result[T]) of(t *testing.T) T {
	t.Helper()
	if r.err != nil {
		t.Fatal(r.err)
	}
	return r.v
}

// fresh is a project of a test created by the owner: a unique key, the area unit (nil — the organization), the level
// and the template; the owner becomes its project manager.
func fresh(t *testing.T, key string, area *uuid.UUID, level tasksapi.TaskProjectAccessLevel, tmpl tasksapi.ProjectCreateWorkflowKey) tasksapi.Project {
	t.Helper()
	b := tasksapi.ProjectCreate{Name: "Проект " + key, Key: key, OrgUnitId: area, Access: &level, WorkflowKey: tmpl}
	return must(service().CreateProject(t.Context(), as(t, "a.owner"), b)).of(t)
}

// assign gives actor role in project p with the scope project (as setTaskProjectMemberRole does).
func assign(t *testing.T, p uuid.UUID, actor string, role uuid.UUID) {
	t.Helper()
	if _, err := superA.Exec(t.Context(), `insert into access.role_assignments (principal_kind, principal_id, role_id, role_version,
		scope_kind, scope_ref, include_descendants, valid, granted_by) values ('person', $1, $2, 1, 'project', $3, false,
		tstzrange($4::timestamptz, null), $5)`, person(actor), role, p, harness.Now().Add(-time.Hour), person("a.owner")); err != nil {
		t.Fatal(err)
	}
}

// newTask creates a task in p as actor.
func newTask(t *testing.T, actor string, p uuid.UUID, title string, mod ...func(*tasksapi.TaskCreate)) tasksapi.Task {
	t.Helper()
	b := tasksapi.TaskCreate{ProjectId: p, Title: title}
	for _, f := range mod {
		f(&b)
	}
	return must(service().CreateTask(t.Context(), as(t, actor), b)).of(t)
}

func rev(r int64) string { return etag(r) }

// val is *p, the zero value for nil.
func val[T any](p *T) T {
	var zero T
	if p == nil {
		return zero
	}
	return *p
}

// count is the number the query of the superuser of tenant A answers.
func count(t *testing.T, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := superA.QueryRow(t.Context(), sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// projectIDs are the ids of projects.
func projectIDs(items []tasksapi.Project) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(items))
	for _, p := range items {
		out = append(out, p.Id)
	}
	return out
}

func contains(s, sub string) bool { return strings.Contains(s, sub) }
