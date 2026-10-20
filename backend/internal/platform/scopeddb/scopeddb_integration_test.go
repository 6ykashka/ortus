//go:build integration

package scopeddb_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/scopeddb"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"
	harness "github.com/ortus/ortus-crm/backend/test"
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures"
)

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
	if world, err = fixtures.Load(ctx, c, "scoped", harness.Now()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	return m.Run()
}

type env struct {
	dir   *tenantctx.PGDirectory
	pools *tenantctx.Pools
	ev    *authz.Evaluator
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
	return env{dir: dir, pools: pools, ev: authz.New(src, src, harness.Now)}
}

func (e env) conn(t *testing.T, actor string) *scopeddb.Conn {
	t.Helper()
	a, err := world.Actor(actor)
	if err != nil {
		t.Fatal(err)
	}
	tc, err := tenantctx.Resolve(t.Context(), e.dir, a.AccountID, id(t, "tenant:a").String(), false)
	if err != nil {
		t.Fatal(err)
	}
	c, err := scopeddb.For(t.Context(), e.pools, e.ev, tc)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func id(t *testing.T, ref string) uuid.UUID {
	t.Helper()
	v, err := world.ID(ref)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

// people: the profiles of tenant A with their home unit; «own» is the person itself.
var people = authz.Columns{Unit: "p.home_unit_id", Persons: []string{"p.id"}}

// units: the org units of tenant A; a unit is in its own scope.
var units = authz.Columns{Unit: "u.id"}

func names(t *testing.T, c *scopeddb.Conn, action string) []string {
	t.Helper()
	return list(t, c, action, people, `select p.full_name from people.person_profiles p where p.archived_at is null and {{scope}}`)
}

func list(t *testing.T, c *scopeddb.Conn, action string, cols authz.Columns, sql string) []string {
	t.Helper()
	rows, err := c.Query(t.Context(), action, cols, sql)
	if err != nil {
		t.Fatal(err)
	}
	out, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	slices.Sort(out) // byte order, not the collation of the database
	if len(out) == 0 {
		return nil
	}
	return out
}

func sorted(s ...string) []string {
	slices.Sort(s)
	return s
}

// «Изменять Москва-1» и «читать Самара-2» не перемножаются: members.read есть только в роли на Москва-1,
// org_units.read — в обеих ролях.
func TestScopedUnitsTwoRoles(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	q := `select u.name from org.units u where {{scope}}`
	for _, tc := range []struct {
		actor, action string
		want          []string
	}{
		{"a.two-roles", "members.read", []string{"Москва-1"}},
		{"a.two-roles", "org_units.read", sorted("Москва-1", "Самара-2")},
		{"a.region-msk", "org_units.read", sorted("Москва", "Москва-1", "Москва-2", "Москва-3", "Москва-4")},
		{"a.driver-msk1", "files.read", nil},
	} {
		if got := list(t, e.conn(t, tc.actor), tc.action, units, q); !slices.Equal(got, tc.want) {
			t.Errorf("%s %s: %v, want %v", tc.actor, tc.action, got, tc.want)
		}
	}
}

func count(t *testing.T, c *scopeddb.Conn, action string) int {
	t.Helper()
	var n int
	if err := c.QueryRow(t.Context(), action, people,
		`select count(*) from people.person_profiles p where {{scope}}`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// Строки сужаются целыми грантами до пагинации и счётчиков: менеджер — своя фирма, регион — поддерево, две роли не
// перемножаются, водитель — себя, владелец — всех, без права — ничего (R-01: утечка через счётчики).
func TestScopedRows(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	all := names(t, e.conn(t, "a.owner"), "members.read")
	for _, tc := range []struct {
		actor, action string
		want          []string
	}{
		{"a.manager-msk1", "members.read", sorted(
			"Водитель Москва-1", "Водитель в группе Финансы", "Две роли", "Менеджер Москва-1", "Руководитель проекта",
			"Руководитель пространства", "Согласующий проекта")},
		{"a.region-msk", "members.read", sorted(
			"Администратор Холдинга", "Водитель Москва-1", "Водитель Москва-2", "Водитель в группе Финансы", "Владелец Холдинга",
			"Две роли", "Менеджер Москва-1", "Менеджер Москва-2", "Наблюдатель на объектах следующих этапов", "Руководитель проекта",
			"Руководитель пространства", "Руководитель региона Москва", "Согласующий проекта", "Участник двух организаций")},
		{"a.driver-msk1", "files.read", []string{"Водитель Москва-1"}},
		{"a.project-lead", "members.read", nil},
	} {
		got := names(t, e.conn(t, tc.actor), tc.action)
		if !slices.Equal(got, tc.want) {
			t.Errorf("%s %s:\n got %v\nwant %v", tc.actor, tc.action, got, tc.want)
		}
		if n := count(t, e.conn(t, tc.actor), tc.action); n != len(tc.want) {
			t.Errorf("%s %s: count %d, rows %d", tc.actor, tc.action, n, len(tc.want))
		}
	}
	// 11 + the managers of Петербург-1 with an expired and a future assignment (return 1) + the actors of the scope kinds
	// of stages 4–7 (W4.02): a.space-lead (Москва-1), a.later-scopes (Москва-2) + the approver of «Автопарк» (W4.03,
	// a.project-approver, Москва-1).
	if len(all) != 16 {
		t.Errorf("owner sees %d people of A, want 16: %v", len(all), all)
	}
}

// AC-01: чужой (вне области) и несуществующий объект — один запрос и один ответ not_found.
func TestOneForeignIsMissing(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	c := e.conn(t, "a.manager-msk1")
	get := func(person uuid.UUID) (string, error) {
		var name string
		err := c.One(t.Context(), "members.read", people, func(r pgx.Row) error { return r.Scan(&name) },
			`select p.full_name from people.person_profiles p where p.id = $1 and {{scope}}`, person)
		return name, err
	}
	if name, err := get(id(t, "person:a.manager-msk1@a")); err != nil || name != "Менеджер Москва-1" {
		t.Errorf("own profile: %q %v", name, err)
	}
	for what, person := range map[string]uuid.UUID{
		"соседняя фирма Москва-2": id(t, "person:a.driver-msk2@a"),
		"регион над фирмой":       id(t, "person:a.region-msk@a"),
		"нет такого":              uuid.New(),
	} {
		if _, err := get(person); !problem.Is(err, problem.CodeNotFound) {
			t.Errorf("%s: %v, want not_found", what, err)
		}
	}
	rows, err := c.Query(t.Context(), "members.read", people, `select 1`)
	if rows != nil {
		rows.Close()
	}
	if !errors.Is(err, scopeddb.ErrNoScope) {
		t.Errorf("query without the scope: %v, want ErrNoScope", err)
	}
}

// Изменение ограничено областью действия; транзакция видит ту же область и откатывается при ошибке.
func TestExecAndTx(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	bump := func(c *scopeddb.Conn, person uuid.UUID) int64 {
		tag, err := c.Exec(t.Context(), "members.manage", people,
			`update people.person_profiles p set revision = revision + 1 where p.id = $1 and {{scope}}`, person)
		if err != nil {
			t.Fatal(err)
		}
		return tag.RowsAffected()
	}
	target := id(t, "person:a.manager-msk2@a")
	if n := bump(e.conn(t, "a.admin"), target); n != 1 {
		t.Errorf("admin (members.manage on the tenant): %d rows, want 1", n)
	}
	if n := bump(e.conn(t, "a.manager-msk1"), target); n != 0 {
		t.Errorf("manager without members.manage: %d rows, want 0", n)
	}
	admin := e.conn(t, "a.admin")
	rollback := errors.New("rollback")
	err := admin.InTx(t.Context(), func(tx *scopeddb.Conn) error {
		if n := bump(tx, target); n != 1 {
			t.Errorf("in tx: %d rows", n)
		}
		return rollback
	})
	if !errors.Is(err, rollback) {
		t.Fatalf("InTx: %v", err)
	}
	var revision int
	if err := admin.One(t.Context(), "members.read", people, func(r pgx.Row) error { return r.Scan(&revision) },
		`select revision from people.person_profiles p where p.id = $1 and {{scope}}`, target); err != nil || revision != 2 {
		t.Errorf("revision after the rolled back tx = %d %v, want 2", revision, err)
	}
	if err := admin.InTx(t.Context(), func(tx *scopeddb.Conn) error { bump(tx, target); return nil }); err != nil {
		t.Fatal(err)
	}
}

// Паника в fn откатывает транзакцию: соединение пула не остаётся в открытой транзакции с блокировкой строки, и
// следующее изменение той же строки проходит, а изменение из транзакции не сохраняется.
func TestTxRollsBackOnPanic(t *testing.T) {
	t.Parallel()
	control, err := pgxpool.New(t.Context(), world.ControlURL(migrations.RoleAPI))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(control.Close)
	vars := world.Env()
	dir := tenantctx.NewPGDirectory(control)
	pools := tenantctx.NewPools(dir, func(k string) string { return vars[k] }, vars["TENANT_DB_HOST"])
	// A leaked transaction keeps its connection: Close would wait for it forever, so a failed run skips it.
	t.Cleanup(func() {
		if !t.Failed() {
			pools.Close()
		}
	})
	src := authz.PGSource{Pools: pools}
	e := env{dir: dir, pools: pools, ev: authz.New(src, src, harness.Now)}
	admin := e.conn(t, "a.admin")
	target := id(t, "person:a.two-roles@a")
	const bumpSQL = `update people.person_profiles p set revision = revision + 1 where p.id = $1 and {{scope}}`
	revision := func() int {
		var n int
		if err := admin.One(t.Context(), "members.read", people, func(r pgx.Row) error { return r.Scan(&n) },
			`select revision from people.person_profiles p where p.id = $1 and {{scope}}`, target); err != nil {
			t.Fatal(err)
		}
		return n
	}
	before := revision()
	func() {
		defer func() {
			if recover() == nil {
				t.Error("InTx swallowed the panic of fn")
			}
		}()
		_ = admin.InTx(t.Context(), func(tx *scopeddb.Conn) error {
			if _, err := tx.Exec(t.Context(), "members.manage", people, bumpSQL, target); err != nil {
				t.Error(err)
			}
			panic("fn panics holding a row lock")
		})
	}()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	tag, err := e.conn(t, "a.admin").Exec(ctx, "members.manage", people, bumpSQL, target)
	if err != nil || tag.RowsAffected() != 1 {
		t.Fatalf("update after the panic: %v rows %d — the transaction of the panicked fn is still open", err, tag.RowsAffected())
	}
	if got := revision(); got != before+1 {
		t.Errorf("revision %d, want %d: the change of the panicked fn must be rolled back", got, before+1)
	}
}
