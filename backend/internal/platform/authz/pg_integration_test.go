//go:build integration

package authz_test

import (
	"context"
	"fmt"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
	harness "github.com/ortus/ortus-crm/backend/test"
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures"
)

// The isolation fixtures (W0.15, W1.04) in their own databases: the evaluator against the real tenant DB.
var (
	cluster *migratetest.Cluster
	world   *fixtures.World
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
	cluster = c
	if world, err = fixtures.Load(ctx, c, "authz", harness.Now()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	return m.Run()
}

func ref(t *testing.T, w *fixtures.World, r string) uuid.UUID {
	t.Helper()
	id, err := w.ID(r)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// pools opens tenant DBs of w as cmd/api does: control DB directory, secret_ref, sentinel; role ortus_api.
func pools(t *testing.T, w *fixtures.World) (*tenantctx.PGDirectory, *tenantctx.Pools) {
	t.Helper()
	control, err := pgxpool.New(t.Context(), w.ControlURL(migrations.RoleAPI))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(control.Close)
	env := w.Env()
	dir := tenantctx.NewPGDirectory(control)
	p := tenantctx.NewPools(dir, func(k string) string { return env[k] }, env["TENANT_DB_HOST"])
	p.RetryAfter = 0
	t.Cleanup(p.Close)
	return dir, p
}

// tc resolves the tenant context of an actor in tenant A as the gateway does.
func tc(t *testing.T, w *fixtures.World, dir tenantctx.Directory, actor string) tenantctx.TenantContext {
	t.Helper()
	a, err := w.Actor(actor)
	if err != nil {
		t.Fatal(err)
	}
	c, err := tenantctx.Resolve(t.Context(), dir, a.AccountID, ref(t, w, "tenant:a").String(), false)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func evaluator(t *testing.T, w *fixtures.World, at time.Time) (*authz.Evaluator, *tenantctx.PGDirectory) {
	t.Helper()
	dir, p := pools(t, w)
	src := authz.PGSource{Pools: p}
	return authz.New(src, src, func() time.Time { return at }), dir
}

func scopes(gs []authz.Grant) []string {
	var out []string
	for _, g := range gs {
		out = append(out, fmt.Sprintf("%s:%s:%v:%v", g.Scope.Kind, g.Scope.Ref, g.Scope.Descendants, g.Group != uuid.Nil))
	}
	slices.Sort(out)
	return out
}

// Гранты, функции и периоды читаются из tenant DB по часам приложения, а не now() базы (Q-W0.09-11).
func TestPGSourceSubject(t *testing.T) {
	t.Parallel()
	dir, p := pools(t, world)
	src := authz.PGSource{Pools: p}
	now := harness.Now()
	for _, tcase := range []struct {
		actor     string
		at        time.Time
		functions []string
		scopes    []string
	}{
		{"a.two-roles", now, nil, []string{
			"unit:" + ref(t, world, "unit:a.msk1").String() + ":true:false",
			"unit:" + ref(t, world, "unit:a.smr2").String() + ":true:false"}},
		{"a.driver-earnings", now, []string{authz.FunctionDriver}, []string{
			"self:" + uuid.Nil.String() + ":false:false",
			"unit:" + ref(t, world, "unit:a.msk1").String() + ":true:true"}},
		{"a.driver-msk2", now, []string{authz.FunctionDriver}, []string{
			"self:" + uuid.Nil.String() + ":false:false",
			"unit:" + ref(t, world, "unit:a.msk1").String() + ":false:false"}},
		{"a.driver-msk2", now.Add(fixtures.TemporaryFor + time.Hour), []string{authz.FunctionDriver}, []string{
			"self:" + uuid.Nil.String() + ":false:false"}},
		{"a.project-lead", now, nil, []string{"project:" + ref(t, world, "project:a.fleet").String() + ":false:false"}},
		{"a.owner", now, nil, nil},
	} {
		s, err := src.Subject(t.Context(), tc(t, world, dir, tcase.actor), tcase.at, true)
		if err != nil {
			t.Fatal(err)
		}
		slices.Sort(tcase.scopes)
		if !slices.Equal(s.Functions, tcase.functions) || !slices.Equal(scopes(s.Grants), tcase.scopes) {
			t.Errorf("%s at %s: functions %v grants %v\nwant %v %v", tcase.actor, tcase.at, s.Functions, scopes(s.Grants),
				tcase.functions, tcase.scopes)
		}
	}
	s, err := src.Subject(t.Context(), tc(t, world, dir, "a.two-roles"), now, false)
	if err != nil || len(s.Grants) != 0 {
		t.Errorf("without grants: %v %v", s.Grants, err)
	}
	g, _ := src.Subject(t.Context(), tc(t, world, dir, "a.manager-msk1"), now, true)
	if len(g.Grants) != 1 || !g.Grants[0].Has("fleet.vehicles.manage") || g.Grants[0].Has("fleet.earnings.read") {
		t.Errorf("a.manager-msk1 grants = %+v", g.Grants)
	}
}

func TestPGSourceModulesAndUnits(t *testing.T) {
	t.Parallel()
	dir, p := pools(t, world)
	src := authz.PGSource{Pools: p}
	owner := tc(t, world, dir, "a.owner")
	mods, err := src.InstalledModules(t.Context(), owner)
	if err != nil || !slices.Equal(mods, []string{"logistics"}) {
		t.Errorf("modules = %v %v", mods, err)
	}
	path, err := src.Ancestors(t.Context(), owner.TenantID, ref(t, world, "unit:a.msk1"))
	if err != nil || !slices.Equal(path, []uuid.UUID{ref(t, world, "unit:a.msk1"), ref(t, world, "unit:a.msk")}) {
		t.Errorf("ancestors of Москва-1 = %v %v", path, err)
	}
	unknown := uuid.New()
	if path, err := src.Ancestors(t.Context(), owner.TenantID, unknown); err != nil || !slices.Equal(path, []uuid.UUID{unknown}) {
		t.Errorf("ancestors of an unknown unit = %v %v", path, err)
	}
	if _, err := src.Ancestors(t.Context(), uuid.New(), unknown); !problem.Is(err, problem.CodeDependencyUnavailable) {
		t.Errorf("unknown tenant: %v, want dependency_unavailable", err)
	}
}

// Оценщик на фикстурах: две роли не перемножаются, регион через org.unit_closure, PD-53, функция driver, часы.
func TestEvaluatorOnFixtures(t *testing.T) {
	t.Parallel()
	now := harness.Now()
	ev, dir := evaluator(t, world, now)
	unit := func(u, read string) authz.Resource {
		return authz.Resource{Unit: ref(t, world, u), ReadAction: read}
	}
	project := authz.Resource{Objects: map[string]uuid.UUID{authz.KindProject: ref(t, world, "project:a.fleet")}}
	for _, c := range []struct {
		actor, action string
		r             authz.Resource
		code          string
	}{
		{"a.two-roles", "fleet.vehicles.manage", unit("unit:a.msk1", "fleet.vehicles.read"), ""},
		{"a.two-roles", "fleet.vehicles.read", unit("unit:a.smr2", "fleet.vehicles.read"), ""},
		{"a.two-roles", "fleet.vehicles.manage", unit("unit:a.smr2", "fleet.vehicles.read"), problem.CodeForbiddenAction},
		{"a.two-roles", "fleet.vehicles.manage", unit("unit:a.msk2", "fleet.vehicles.read"), problem.CodeNotFound},
		{"a.region-msk", "fleet.vehicles.manage", unit("unit:a.msk4", ""), ""},
		{"a.region-msk", "fleet.vehicles.manage", unit("unit:a.spb1", ""), problem.CodeNotFound},
		{"a.manager-msk1", "fleet.vehicles.manage", unit("unit:a.msk2", ""), problem.CodeNotFound},
		{"a.driver-earnings", "fleet.earnings.read", unit("unit:a.msk1", ""), authz.CodeFunctionBlocked},
		{"a.driver-msk2", "fleet.vehicles.read", unit("unit:a.msk1", ""), ""},
		{"a.project-lead", "tasks.projects.manage", authz.Resource{}, problem.CodeForbiddenAction},
		{"a.project-lead", "tasks.projects.manage", project, ""},
		{"a.admin", "modules.manage", authz.Resource{}, problem.CodeForbiddenAction},
		{"a.owner", "modules.manage", authz.Resource{}, ""},
	} {
		err := ev.Permit(t.Context(), tc(t, world, dir, c.actor), c.action, c.r)
		if (c.code == "" && err != nil) || (c.code != "" && !problem.Is(err, c.code)) {
			t.Errorf("%s %s: %v, want %q", c.actor, c.action, err, c.code)
		}
	}
	later, dir2 := evaluator(t, world, now.Add(fixtures.TemporaryFor+time.Hour))
	if err := later.Permit(t.Context(), tc(t, world, dir2, "a.driver-msk2"), "fleet.vehicles.read", unit("unit:a.msk1", "")); !problem.Is(err, problem.CodeNotFound) {
		t.Errorf("temporary grant after its end: %v, want not_found", err)
	}
}

// AC-10 (15-quality-security.md:44): «Отзыв роли во время экспорта → выдача файла 403». Оценщик не кеширует
// гранты: выдача файла перепроверяет право выгрузки, и отозванная роль больше не действует.
func TestAC10RevokedRoleDuringExport(t *testing.T) {
	t.Parallel()
	w, err := fixtures.Load(t.Context(), cluster, "ac10", harness.Now())
	if err != nil {
		t.Fatal(err)
	}
	ev, dir := evaluator(t, w, harness.Now())
	admin := tc(t, w, dir, "a.admin")
	export := authz.Resource{} // выгрузка списка участников всей организации
	if err := ev.Permit(t.Context(), admin, "members.read", export); err != nil {
		t.Fatalf("export start: %v", err)
	}
	super := w.Cluster.DB(t, w.TenantDBs[fixtures.TenantA], migratetest.Super)
	if _, err := super.ExecContext(t.Context(), `update access.role_assignments set state = 'revoked', revoked_at = now()
		where principal_kind = 'person' and principal_id = $1`, admin.PersonID); err != nil {
		t.Fatal(err)
	}
	if _, err := super.ExecContext(t.Context(), `update access.policy_state set policy_version = policy_version + 1`); err != nil {
		t.Fatal(err)
	}
	if err := ev.Permit(t.Context(), admin, "members.read", export); !problem.Is(err, problem.CodeForbiddenAction) {
		t.Fatalf("file delivery after the revocation: %v, want 403 forbidden_action", err)
	}
	if p, err := ev.ScopeQuery(t.Context(), admin, "members.read", authz.Columns{Unit: "p.home_unit_id"}, 0); err != nil || p.SQL != "false" {
		t.Errorf("scope after the revocation: %q %v, want false", p.SQL, err)
	}
}
