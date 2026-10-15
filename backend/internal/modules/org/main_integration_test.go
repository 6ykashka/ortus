//go:build integration

package org

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"              //nolint:depguard // integration test: roles of the fixture databases
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: PostgreSQL in testcontainers
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04 (3 regions × 4 firms)
)

// world is the fixture world of the isolation suite (W1.04): tenant A «Холдинг» — Москва, Самара, Петербург × 4
// firms; tenant B — namesakes. Tests that change it create their own units.
var world *fixtures.World

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
	if world, err = fixtures.Load(ctx, c, "org", harness.Now()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	return m.Run()
}

type env struct {
	dir   *tenantctx.PGDirectory
	pools *tenantctx.Pools
	ev    *authz.Evaluator
	srv   *Server
}

func newEnv(t *testing.T) env {
	t.Helper()
	control, err := pgxpool.New(t.Context(), world.ControlURL(migrations.RoleAPI))
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
	return env{dir: dir, pools: pools, ev: ev, srv: &Server{Pools: pools, Authz: ev, Now: harness.Now}}
}

// tc is the tenant context of actor in tenant t ("a" or "b"), as the gateway builds it.
func (e env) tc(t *testing.T, actor, tenant string) tenantctx.TenantContext {
	t.Helper()
	a, err := world.Actor(actor)
	if err != nil {
		t.Fatal(err)
	}
	tc, err := tenantctx.Resolve(t.Context(), e.dir, a.AccountID, id(t, "tenant:"+tenant).String(), false)
	if err != nil {
		t.Fatal(err)
	}
	return tc
}

// as is the context of a request of actor in tenant A.
func (e env) as(t *testing.T, actor string) context.Context {
	t.Helper()
	return tenantctx.WithTenant(t.Context(), e.tc(t, actor, fixtures.TenantA))
}

func id(t *testing.T, ref string) uuid.UUID {
	t.Helper()
	v, err := world.ID(ref)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func tenantA(t *testing.T) uuid.UUID {
	t.Helper()
	return id(t, "tenant:a")
}

// grant is a custom role with actions on a unit with its subtree (uuid.Nil: the whole tenant).
type grant struct {
	unit    uuid.UUID
	actions []string
}

// person is the context of a new person of tenant A with a custom role per grant, as the gateway would build it:
// the fixtures have no org_units.manage on a unit (W1.04), the rights of a parent are tested with these people.
func (e env) person(t *testing.T, grants ...grant) context.Context {
	t.Helper()
	ctx, pool := t.Context(), e.pool(t)
	person := uuid.New()
	_, err := pool.Exec(ctx, `insert into people.person_profiles (id, full_name, home_unit_id) values ($1, 'Структура', $2)`,
		person, id(t, "unit:a.msk"))
	require.NoError(t, err)
	since := harness.Now().Add(-24 * time.Hour)
	for _, g := range grants {
		role := uuid.New()
		kind, ref := "unit", &g.unit
		if g.unit == uuid.Nil {
			kind, ref = "tenant", nil
		}
		for _, s := range []struct {
			sql  string
			args []any
		}{
			{`insert into access.roles (id, name, kind) values ($1, $2, 'custom')`, []any{role, "Структура " + role.String()[:8]}},
			{`insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`, []any{role, g.actions, person}},
			{`insert into access.role_assignments (principal_kind, principal_id, role_id, role_version, scope_kind, scope_ref,
				include_descendants, valid, granted_by) values ('person', $1, $2, 1, $3, $4, $5, tstzrange($6, null), $1)`,
				[]any{person, role, kind, ref, kind == "unit", since}},
		} {
			_, err := pool.Exec(ctx, s.sql, s.args...)
			require.NoError(t, err)
		}
	}
	tc := tenantctx.TenantContext{TenantID: tenantA(t), MembershipID: uuid.New(), AccountID: uuid.New(), PersonID: person}
	return tenantctx.WithTenant(ctx, tc)
}

// pool is the tenant DB of A as ortus_api, for checks the API does not expose.
func (e env) pool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	p, err := e.pools.For(t.Context(), tenantA(t))
	if err != nil {
		t.Fatal(err)
	}
	return p
}
