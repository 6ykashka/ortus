//go:build integration

package cash_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib" // database/sql driver "pgx"

	cashapi "github.com/ortus/ortus-crm/backend/internal/api/cash"
	"github.com/ortus/ortus-crm/backend/internal/modules/cash" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
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
	if world, err = fixtures.Load(ctx, c, "cash", harness.Now()); err != nil {
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

// fakeLimits gives the roles of a person the limits of a test (role limits have no storage yet).
type fakeLimits map[uuid.UUID]cash.Limits

func (f fakeLimits) Limits(_ context.Context, _ cash.Querier, w cash.Who, _ uuid.UUID) (cash.Limits, error) {
	return f[w.Person], nil
}

type env struct {
	dir *tenantctx.PGDirectory
	svc *cash.Service
	now time.Time
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
	ev := authz.New(src, src, harness.Now)
	return env{dir: dir, svc: &cash.Service{Pools: pools, Authz: ev, Now: harness.Now}, now: harness.Now()}
}

func (e env) tc(t *testing.T, actor, tenant string) tenantctx.TenantContext {
	t.Helper()
	a, err := world.Actor(actor)
	if err != nil {
		t.Fatal(err)
	}
	tc, err := tenantctx.Resolve(t.Context(), e.dir, a.AccountID, ref("tenant:"+tenant).String(), false)
	if err != nil {
		t.Fatal(err)
	}
	return tc
}

func exec(t *testing.T, d *sql.DB, q string, args ...any) {
	t.Helper()
	if _, err := d.ExecContext(t.Context(), q, args...); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
}

func scalar[T any](t *testing.T, d *sql.DB, q string, args ...any) T {
	t.Helper()
	var v T
	if err := d.QueryRowContext(t.Context(), q, args...).Scan(&v); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
	return v
}

func wantProblem(t *testing.T, err error, code string) {
	t.Helper()
	pe, ok := errors.AsType[*problem.Error](err)
	if !ok || pe.Code != code {
		t.Fatalf("error %v, want %s", err, code)
	}
}

var seq atomic.Int64

// unique names an account of a test: account names are unique in a tenant.
func unique(prefix string) string { return fmt.Sprintf("%s %d", prefix, seq.Add(1)) }

// role grants actions to an actor of tenant A in a scope («tenant», «unit» + ref, «account» + ref, «self»).
func role(t *testing.T, actor string, actions []string, scopeKind string, scopeRef any) {
	t.Helper()
	d := dbs["a"]
	id := uuid.New()
	by := person("a.owner")
	exec(t, d, `insert into access.roles (id, name, kind) values ($1, $2, 'custom')`, id, unique("Касса "+actor))
	exec(t, d, `insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`, id, actions, by)
	exec(t, d, `insert into access.role_assignments (principal_kind, principal_id, role_id, role_version, scope_kind, scope_ref, granted_by, valid)
	            values ('person', $1, $2, 1, $3, $4, $5, tstzrange('2020-01-01', null))`, person(actor), id, scopeKind, scopeRef, by)
}

// All the actions of the module but the ones that need a person of their own.
var (
	cashier  = []string{"cash.read", "cash.post", "cash.proposals.post", "cash.shift.operate"}
	manager  = []string{"cash.read", "cash.balance.read", "cash.post", "cash.proposals.post", "cash.shift.operate", "cash.refund", "cash.transfer", "cash.advance.issue", "cash.approve", "cash.reconcile", "cash.reverse"}
	holderRo = []string{"cash.advance.self"}
)

func money(minor int) cashapi.Money { return cashapi.Money{AmountMinor: minor, Currency: "RUB"} }

// newAccount writes an account of tenant A directly (the way the seed does) and returns its id.
func newAccount(t *testing.T, kind, name string, unit *uuid.UUID, set string, args ...any) uuid.UUID {
	t.Helper()
	id := uuid.New()
	cols, ph, vals := []string{"id", "name", "kind", "org_unit_id"}, []string{"$1", "$2", "$3", "$4"}, []any{id, name, kind, unit}
	if set != "" {
		for i, c := range strings.Split(set, ",") {
			cols = append(cols, strings.TrimSpace(c))
			ph = append(ph, fmt.Sprintf("$%d", 5+i))
		}
		vals = append(vals, args...)
	}
	exec(t, dbs["a"], `insert into cash.accounts (`+strings.Join(cols, ", ")+`) values (`+strings.Join(ph, ", ")+`)`, vals...)
	return id
}
func setBalance(t *testing.T, id uuid.UUID, minor int) {
	t.Helper()
	exec(t, dbs["a"], `update cash.accounts set balance_minor = $2 where id = $1`, id, minor)
}

func balance(t *testing.T, id uuid.UUID) int {
	t.Helper()
	return int(scalar[int64](t, dbs["a"], `select balance_minor from cash.accounts where id = $1`, id))
}

func unit(name string) *uuid.UUID { u := ref("unit:a." + name); return &u }

func post(t *testing.T, e env, tc tenantctx.TenantContext, account uuid.UUID, dir cashapi.CashOperationCreateDirection, cat cashapi.CashOperationCreateCategory, minor int, basis string) (*cashapi.CashOperation, *cashapi.CashApprovalRequest, error) {
	t.Helper()
	return e.svc.PostOperation(t.Context(), tc, &cashapi.CashOperationCreate{AccountId: account, Amount: money(minor), Basis: &basis, Category: cat,
		Direction: dir, OccurredAt: e.now})
}

func ids(p cashapi.CashAccountPage) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(p.Items))
	for _, a := range p.Items {
		out = append(out, a.Id)
	}
	return out
}
