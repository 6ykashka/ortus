//go:build integration

package tasks_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib" // database/sql driver "pgx"

	dataapi "github.com/ortus/ortus-crm/backend/internal/api/data"
	"github.com/ortus/ortus-crm/backend/internal/modules/data"           //nolint:depguard // the registry the provider plugs into
	"github.com/ortus/ortus-crm/backend/internal/modules/data/tasks"     //nolint:depguard // the package under test
	modtasks "github.com/ortus/ortus-crm/backend/internal/modules/tasks" //nolint:depguard // integration test: the projects of tasks in the evaluator, as cmd/api
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"              //nolint:depguard // integration test: role names of the test cluster
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: clock and PostgreSQL of the suites
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04
)

// The world of the package: the isolation fixtures (W1.04) with their content — in every tenant «Автопарк» of Москва-1
// (limited, АВТ-101 of the driver, АВТ-102 of the project lead waiting for approval) and the closed «Стройка» (СТР-101
// of the driver; nobody has a role in it) — plus, written once before the tests, the due of АВТ-101 and a deleted task
// of «Автопарк».
var (
	world *fixtures.World
	dbs   = map[string]*sql.DB{} // the tenant DBs as the superuser
)

func TestMain(m *testing.M) {
	os.Exit(runMain(m))
}

func runMain(m *testing.M) int {
	ctx := context.Background()
	c, stop, err := harness.StartPostgres(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer stop()
	if world, err = fixtures.Load(ctx, c, "datatasks", harness.Now(), fixtures.WithContent()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	for _, t := range []string{"a", "b"} {
		d, err := sql.Open("pgx", world.TenantURL(t, "super"))
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		d.SetMaxOpenConns(4)
		defer d.Close()
		dbs[t] = d
	}
	if err := seed(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "seed:", err)
		return 1
	}
	return m.Run()
}

// seed sets the due of АВТ-101 (the end of 05.10 by Moscow) and writes a deleted task АВТ-103 of «Автопарк».
func seed(ctx context.Context) error {
	if _, err := dbs["a"].ExecContext(ctx, `update tasks.tasks set due_at = '2026-10-05T21:00:00Z' where id = $1`,
		ref("task:a.fleet-1")); err != nil {
		return err
	}
	_, err := dbs["a"].ExecContext(ctx, `insert into tasks.tasks (project_id, number, title, status_id, workflow_version, assignee_id,
		deleted_at) values ($1, 103, 'Удалённая задача', 's1', 1, $2, $3)`, ref("project:a.fleet"), person("a.driver-msk1", "a"), harness.Now())
	return err
}

func ref(r string) uuid.UUID {
	id, err := world.ID(r)
	if err != nil {
		panic(err)
	}
	return id
}

func person(actor, tenant string) uuid.UUID { return ref("person:" + actor + "@" + tenant) }

// noModules is the module registry of the tests: nothing is installed (the module of tasks is of the core).
type noModules struct{}

func (noModules) States(context.Context, uuid.UUID) (map[string]string, error) {
	return map[string]string{}, nil
}

// env is the service wired like cmd/api: tenant pools of ortus_api, the evaluator on the fixtures' clock with the
// projects of tasks registered (the reads of a limited project, W4.01) and the registry with the provider of tasks.
type env struct {
	dir *tenantctx.PGDirectory
	svc *data.Service
}

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
	ev := modtasks.RegisterContainer(authz.New(src, src, harness.Now), pools)
	reg, err := data.NewRegistry(tasks.Provider{})
	if err != nil {
		t.Fatal(err)
	}
	return env{dir: dir, svc: &data.Service{
		Pools: pools, Authz: ev, Registry: reg, Modules: noModules{}, Now: harness.Now, Timeout: time.Minute,
	}}
}

// tc resolves the tenant context of actor in tenant («a» or «b»), as the gateway does.
func (e env) tc(t *testing.T, actor, tenant string) tenantctx.TenantContext {
	t.Helper()
	a, err := world.Actor(actor)
	if err != nil {
		t.Fatal(err)
	}
	tc, err := tenantctx.Resolve(t.Context(), e.dir, a.AccountID, ref("tenant:"+tenant).String(), true)
	if err != nil {
		t.Fatal(err)
	}
	return tc
}

// query runs raw (a DatasetQuery) over «Задачи» as actor of tenant.
func (e env) query(t *testing.T, actor, tenant, raw string) (dataapi.DatasetQueryResult, error) {
	t.Helper()
	var q dataapi.DatasetQuery
	if err := json.Unmarshal([]byte(raw), &q); err != nil {
		t.Fatalf("%s: %v", raw, err)
	}
	return e.svc.Query(t.Context(), e.tc(t, actor, tenant), tasks.Tasks, &q)
}

// cells returns the rows as the texts of their cells (a date as is, «∅» for a null), the record id first.
func cells(t *testing.T, res dataapi.DatasetQueryResult) [][]string {
	t.Helper()
	out := make([][]string, 0, len(res.Rows))
	for _, r := range res.Rows {
		row := []string{r.RecordId}
		for _, c := range r.Cells {
			raw, err := json.Marshal(c.Value)
			if err != nil {
				t.Fatal(err)
			}
			var v struct {
				Type  string `json:"type"`
				Value any    `json:"value"`
			}
			if err := json.Unmarshal(raw, &v); err != nil {
				t.Fatal(err)
			}
			if v.Type == "null" {
				row = append(row, "∅")
				continue
			}
			row = append(row, fmt.Sprint(v.Value))
		}
		out = append(out, row)
	}
	return out
}

func records(res dataapi.DatasetQueryResult) []string {
	out := make([]string, 0, len(res.Rows))
	for _, r := range res.Rows {
		out = append(out, r.RecordId)
	}
	slices.Sort(out)
	return out
}
