//go:build integration

package importer

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W1.05: shared helpers of org, people, importer (integratorNotes)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"              //nolint:depguard // integration test: roles of the fixture databases
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: PostgreSQL in testcontainers
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04 (3 regions × 4 firms)
)

// world is the fixture world of the isolation suite (W1.04). Tests create their own people and imports.
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
	if world, err = fixtures.Load(ctx, c, "importer", harness.Now()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	return m.Run()
}

type env struct {
	dir     *tenantctx.PGDirectory
	pools   *tenantctx.Pools
	control *pgxpool.Pool
	srv     *Server
}

// newEnv wires the server with the clock of the fixtures, shifted by later.
func newEnv(t *testing.T, later time.Duration) env {
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
	now := func() time.Time { return harness.Now().Add(later) }
	src := authz.PGSource{Pools: pools}
	ev := authz.New(src, src, now)
	return env{dir: dir, pools: pools, control: control,
		srv: &Server{Pools: pools, Authz: ev, Directory: kit.ControlDirectory{DB: control}, Now: now}}
}

func (e env) as(t *testing.T, actor string) context.Context {
	t.Helper()
	a, err := world.Actor(actor)
	if err != nil {
		t.Fatal(err)
	}
	tc, err := tenantctx.Resolve(t.Context(), e.dir, a.AccountID, tenantA(t).String(), false)
	if err != nil {
		t.Fatal(err)
	}
	return tenantctx.WithTenant(t.Context(), tc)
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

func (e env) pool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	p, err := e.pools.For(t.Context(), tenantA(t))
	if err != nil {
		t.Fatal(err)
	}
	return p
}

// hr is a person of tenant A with a role «Кадровик» (members.read, members.manage, org_units.read) on unit with
// its subtree — the fixtures have no unit-scoped members.manage. The context is the one the gateway would build.
func (e env) hr(t *testing.T, unitRef string) (context.Context, uuid.UUID) {
	t.Helper()
	ctx, pool := t.Context(), e.pool(t)
	unit, person, role := id(t, unitRef), uuid.New(), uuid.New()
	since := harness.Now().Add(-24 * time.Hour)
	stmts := []struct {
		sql  string
		args []any
	}{
		{`insert into people.person_profiles (id, full_name, home_unit_id) values ($1, 'Кадровик', $2)`, []any{person, unit}},
		{`insert into access.roles (id, name, kind) values ($1, $2, 'custom')`, []any{role, "Кадровик " + role.String()[:8]}},
		{`insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`,
			[]any{role, []string{"members.read", "members.manage", "org_units.read"}, person}},
		{`insert into access.role_assignments (principal_kind, principal_id, role_id, role_version, scope_kind, scope_ref,
			include_descendants, valid, granted_by) values ('person', $1, $2, 1, 'unit', $3, true, tstzrange($4, null), $1)`,
			[]any{person, role, unit, since}},
	}
	for _, s := range stmts {
		_, err := pool.Exec(ctx, s.sql, s.args...)
		require.NoError(t, err)
	}
	tc := tenantctx.TenantContext{TenantID: tenantA(t), MembershipID: uuid.New(), AccountID: uuid.New(), PersonID: person}
	return tenantctx.WithTenant(ctx, tc), person
}
