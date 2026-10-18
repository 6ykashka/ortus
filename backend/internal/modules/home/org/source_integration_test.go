//go:build integration

package org_test

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib" // database/sql driver "pgx"

	homeapi "github.com/ortus/ortus-crm/backend/internal/api/home"
	"github.com/ortus/ortus-crm/backend/internal/modules/home"     //nolint:depguard // the registry this source plugs into
	"github.com/ortus/ortus-crm/backend/internal/modules/home/org" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"              //nolint:depguard // integration test: role names of the test cluster
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: clock and PostgreSQL of the suites
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04
)

// The world of the package: the isolation fixtures (W1.04) — two tenants with their people, memberships and grants.
// The tests change memberships and the storage of a tenant, so they run one after another.
var (
	world   *fixtures.World
	dbs     = map[string]*sql.DB{} // the tenant DBs as the superuser
	control *sql.DB                // the control DB as the superuser
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
	if world, err = fixtures.Load(ctx, c, "homeorg", harness.Now()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	for _, t := range []string{"a", "b"} {
		d, err := sql.Open("pgx", world.TenantURL(t, "super"))
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		defer d.Close()
		dbs[t] = d
	}
	if control, err = sql.Open("pgx", world.ControlURL("super")); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer control.Close()
	return m.Run()
}

func ref(r string) uuid.UUID {
	id, err := world.ID(r)
	if err != nil {
		panic(err)
	}
	return id
}

// trial is the subscription of every business in these tests: 12 days of trial left.
type trial struct{}

func (trial) Subscription(context.Context, uuid.UUID) (org.Subscription, error) {
	end := harness.Now().Add(12*24*time.Hour + time.Hour)
	return org.Subscription{Status: "trialing", TrialEndsAt: &end}, nil
}

// env is the source wired like cmd/api: tenant pools and the control DB of ortus_api, the evaluator on the fixtures'
// clock.
type env struct {
	dir *tenantctx.PGDirectory
	src org.Source
}

func newEnv(t *testing.T) env {
	t.Helper()
	ctx := t.Context()
	pool, err := pgxpool.New(ctx, world.ControlURL(migrations.RoleAPI))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	vars := world.Env()
	dir := tenantctx.NewPGDirectory(pool)
	pools := tenantctx.NewPools(dir, func(k string) string { return vars[k] }, vars["TENANT_DB_HOST"])
	t.Cleanup(pools.Close)
	src := authz.PGSource{Pools: pools}
	return env{dir: dir, src: org.Source{Pools: pools, Authz: authz.New(src, src, harness.Now), Control: pool, Subscriptions: trial{}}}
}

// cards are the cards of actor in tenant at the clock of the fixtures.
func (e env) cards(t *testing.T, actor, tenant string) []homeapi.DecisionItem {
	t.Helper()
	a, err := world.Actor(actor)
	if err != nil {
		t.Fatal(err)
	}
	tc, err := tenantctx.Resolve(t.Context(), e.dir, a.AccountID, ref("tenant:"+tenant).String(), false)
	if err != nil {
		t.Fatal(err)
	}
	items, err := e.src.Cards(t.Context(), home.Query{Tenant: tc, Now: harness.Now()})
	if err != nil {
		t.Fatalf("%s in %s: %v", actor, tenant, err)
	}
	return items
}

func kind(items []homeapi.DecisionItem, k string) (homeapi.DecisionItem, bool) {
	i := slices.IndexFunc(items, func(it homeapi.DecisionItem) bool { return it.Kind == k })
	if i < 0 {
		return homeapi.DecisionItem{}, false
	}
	return items[i], true
}

// name is the full name of the person of actor in tenant.
func name(t *testing.T, actor, tenant string) string {
	t.Helper()
	var n string
	if err := dbs[tenant].QueryRowContext(t.Context(), `select full_name from people.person_profiles where id = $1`,
		ref("person:"+actor+"@"+tenant)).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func names(card homeapi.DecisionItem) []string {
	if card.Params["names"] == "" {
		return nil
	}
	return strings.Split(card.Params["names"], ", ")
}

// peopleOf returns the full names of the people of tenant.
func peopleOf(t *testing.T, tenant string) []string {
	t.Helper()
	rows, err := dbs[tenant].QueryContext(t.Context(), `select full_name from people.person_profiles`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			t.Fatal(err)
		}
		out = append(out, n)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func execDB(t *testing.T, d *sql.DB, q string, args ...any) {
	t.Helper()
	if _, err := d.ExecContext(t.Context(), q, args...); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
}

// PD-53, S2-18 п. 1: the owner of A gets «N сотрудников без роли» with the active members of A that have no grant
// with the scope of the business, a unit or «своё» now — a project role (a.project-lead), an ended
// (a.manager-expired) or a future (a.manager-future) grant leave a member without a role; a grant through a group
// counts (a.driver-earnings). The owner is not counted, names are those of the people of A only, sorted as the list
// of people of the stand (by name); the count is the number of names.
func TestMembersWithoutRole(t *testing.T) {
	t.Parallel() // a parallel test runs after the sequential ones that change memberships and storage
	e := newEnv(t)
	card, ok := kind(e.cards(t, "a.owner", "a"), "access.members_without_role")
	if !ok {
		t.Fatal("owner of A: no card of members without a role")
	}
	got := names(card)
	for _, actor := range []string{"a.project-lead", "a.manager-expired", "a.manager-future"} {
		if !slices.Contains(got, name(t, actor, "a")) {
			t.Errorf("%s (%s) is not among %v", actor, name(t, actor, "a"), got)
		}
	}
	for _, actor := range []string{"a.owner", "a.manager-msk1", "a.driver-msk1", "a.driver-earnings", "ab.member", "a.two-roles"} {
		if slices.Contains(got, name(t, actor, "a")) {
			t.Errorf("%s (%s) has a role but is among %v", actor, name(t, actor, "a"), got)
		}
	}
	if !slices.IsSorted(got) || card.Params["count"] != strconv.Itoa(len(got)) || card.ModuleKey != "members" {
		t.Errorf("card %+v: sorted names and their count", card)
	}
	people := peopleOf(t, "a")
	for _, n := range got {
		if !slices.Contains(people, n) {
			t.Errorf("%q is not a person of A", n)
		}
	}
}

// Only an active membership counts: a suspended or invited member without a role is not on the card.
func TestMembersWithoutRoleAreActive(t *testing.T) { //nolint:paralleltest // changes memberships of tenant A
	e := newEnv(t)
	who := name(t, "a.project-lead", "a")
	membership := ref("membership:a.project-lead@a")
	for _, status := range []string{"suspended", "invited"} {
		execDB(t, control, `update memberships set status = $2::membership_status where id = $1`, membership, status)
		card, _ := kind(e.cards(t, "a.owner", "a"), "access.members_without_role")
		if slices.Contains(names(card), who) {
			t.Errorf("%s member %s is on the card %+v", status, who, card)
		}
	}
	execDB(t, control, `update memberships set status = 'active' where id = $1`, membership)
	if card, _ := kind(e.cards(t, "a.owner", "a"), "access.members_without_role"); !slices.Contains(names(card), who) {
		t.Errorf("active again, %s is not on the card %+v", who, card)
	}
}

// AC-02: the owner of B gets the people of B only, the owner of A those of A only; a member who is not the owner (a
// manager, an administrator with members.read over the business) gets no card of the organization. Every member of
// B has a role in the fixtures, so the grant of b.manager-msk1 sleeps for the test: B then has a member without a
// role, and the card of each owner must exist and name nobody of the other tenant.
func TestOrganizationCardsOfOneTenant(t *testing.T) { //nolint:paralleltest // changes a grant of tenant B
	e := newEnv(t)
	sleeper := ref("person:b.manager-msk1@b")
	execDB(t, dbs["b"], `update access.role_assignments set state = 'dormant' where principal_kind = 'person' and principal_id = $1`, sleeper)
	t.Cleanup(func() {
		if _, err := dbs["b"].ExecContext(context.WithoutCancel(t.Context()),
			`update access.role_assignments set state = 'active' where principal_kind = 'person' and principal_id = $1`, sleeper); err != nil {
			t.Error(err)
		}
	})
	onlyOf := func(tenant string) []string { // the names of the people of tenant that the other tenant does not have
		other := peopleOf(t, map[string]string{"a": "b", "b": "a"}[tenant])
		return slices.DeleteFunc(peopleOf(t, tenant), func(n string) bool { return slices.Contains(other, n) })
	}
	for _, c := range []struct{ owner, tenant, other, member string }{
		{"b.owner", "b", "a", "b.manager-msk1"},
		{"a.owner", "a", "b", "a.project-lead"},
	} {
		card, ok := kind(e.cards(t, c.owner, c.tenant), "access.members_without_role")
		if !ok {
			t.Fatalf("owner of %s: no card of members without a role", c.tenant)
		}
		if !slices.Contains(names(card), name(t, c.member, c.tenant)) {
			t.Errorf("owner of %s: %s is not on the card %+v", c.tenant, c.member, card)
		}
		foreign := onlyOf(c.other)
		if len(foreign) == 0 {
			t.Fatalf("no person of %s only: the check would be empty", c.other)
		}
		for _, n := range names(card) {
			if slices.Contains(foreign, n) {
				t.Errorf("owner of %s: the card shows %q of %s", c.tenant, n, c.other)
			}
		}
	}
	for _, c := range []struct{ actor, tenant string }{{"a.manager-msk1", "a"}, {"a.admin", "a"}, {"ab.member", "b"}} {
		if items := e.cards(t, c.actor, c.tenant); len(items) != 0 {
			t.Errorf("%s in %s: %+v, want no cards of the organization", c.actor, c.tenant, items)
		}
	}
}

// The count is the number of the members without a role, not of the names the card carries: with the names bounded to
// one, the card still counts all of them (ревью W2.54: count = len(names) under the limit of the names).
func TestMembersCountBeyondTheNames(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	all, ok := kind(e.cards(t, "a.owner", "a"), "access.members_without_role")
	if !ok || len(names(all)) < 3 {
		t.Fatalf("owner of A: card %+v, want at least three members without a role", all)
	}
	e.src.MaxNames = 1
	card, ok := kind(e.cards(t, "a.owner", "a"), "access.members_without_role")
	if !ok {
		t.Fatal("owner of A with one name: no card")
	}
	if got := names(card); len(got) != 1 || got[0] != names(all)[0] {
		t.Errorf("names %v, want the first of %v", got, names(all))
	}
	if card.Params["count"] != strconv.Itoa(len(names(all))) {
		t.Errorf("count %q with one name, want %d", card.Params["count"], len(names(all)))
	}
}

// An owner is not a member without a role: owning the business is not a role (control owner_bindings, AUTH-08), and
// an owner reaches every module. A second owner without a grant (a.project-lead bound as owner for the test) is not
// on the card of the first one; once the binding is revoked, the member is on it again.
func TestOwnersAreNotWithoutRole(t *testing.T) { //nolint:paralleltest // binds a second owner of tenant A
	e := newEnv(t)
	who := name(t, "a.project-lead", "a")
	binding := uuid.New()
	execDB(t, control, `insert into owner_bindings (id, tenant_id, membership_id) values ($1, $2, $3)`,
		binding, ref("tenant:a"), ref("membership:a.project-lead@a"))
	revoke := func() {
		if _, err := control.ExecContext(context.WithoutCancel(t.Context()),
			`update owner_bindings set revoked_at = now() where id = $1 and revoked_at is null`, binding); err != nil {
			t.Error(err)
		}
	}
	t.Cleanup(revoke)
	if card, _ := kind(e.cards(t, "a.owner", "a"), "access.members_without_role"); slices.Contains(names(card), who) {
		t.Errorf("the second owner %s is on the card %+v", who, card)
	}
	revoke()
	if card, _ := kind(e.cards(t, "a.owner", "a"), "access.members_without_role"); !slices.Contains(names(card), who) {
		t.Errorf("binding revoked, %s is not on the card %+v", who, card)
	}
}

// The owner gets the trial (12 days left) and, above 85 % of the limit of files.usage, «Место занято на N %»; the order
// is that of MSW: trial, storage, members.
func TestOwnerCards(t *testing.T) { //nolint:paralleltest // changes files.usage of tenant A
	e := newEnv(t)
	const gib = int64(1) << 30
	execDB(t, dbs["a"], `insert into files.usage (singleton, committed_bytes, limit_bytes) values (true, $1, $2)
		on conflict (singleton) do update set committed_bytes = excluded.committed_bytes, limit_bytes = excluded.limit_bytes`, 90*gib, 100*gib)
	t.Cleanup(func() {
		if _, err := dbs["a"].ExecContext(context.WithoutCancel(t.Context()), `delete from files.usage`); err != nil {
			t.Error(err)
		}
	})
	items := e.cards(t, "a.owner", "a")
	var kinds []string
	for _, it := range items {
		kinds = append(kinds, it.Kind)
	}
	if want := []string{"tenant.trial_ending", "tenant.storage_high", "access.members_without_role"}; !slices.Equal(kinds, want) {
		t.Fatalf("kinds %v, want %v", kinds, want)
	}
	if items[0].Params["daysLeft"] != "12" || items[1].Params["percent"] != "90" || items[1].Tone != homeapi.Warn {
		t.Errorf("cards %+v", items)
	}
	execDB(t, dbs["a"], `delete from files.usage`)
	if _, ok := kind(e.cards(t, "a.owner", "a"), "tenant.storage_high"); ok {
		t.Error("no usage row: a storage card")
	}
}
