//go:build integration

package knowledge

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"              //nolint:depguard // integration test: role names of the test cluster
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"  //nolint:depguard // integration test: the superuser that writes the seed
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: clock and PostgreSQL of the suites
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04
)

// The world of the integration tests: the isolation fixtures (W1.04) and, in tenant A, «Альта» of the seed 14.10 —
// its units, people, roles, groups and assignments as cmd/seed writes them (ids of PD-30 of t-alta) — with the
// knowledge base of the seed (WriteDemo). The memberships of the people of «Альта» come from memberships below (the
// control DB of the fixtures does not know them); the objects of repairs — from relations (as MSW, ALTA_REPAIR_OBJECTS).
var (
	fx      *fixtures.World
	superA  *pgxpool.Pool // tenant DB of A as the superuser
	pools   *tenantctx.Pools
	tenantA uuid.UUID
	svc     *Service
	srv     Server
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
	if fx, err = fixtures.Load(ctx, c, "knowledge", harness.Now()); err != nil {
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
	if err := seedAlta(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "alta:", err)
		return 1
	}
	svc = &Service{Pools: pools, Memberships: memberships, Relations: relations{}, Now: harness.Now}
	srv = Server{S: svc}
	return m.Run()
}

// exec runs a statement on the tenant DB of A as the superuser.
func exec(ctx context.Context, sql string, args ...any) error {
	_, err := superA.Exec(ctx, sql, args...)
	return err
}

// membershipOf is the id of the membership of a person of «Альта» (the control DB of the fixtures does not hold it).
func membershipOf(proto string) uuid.UUID { return pid("membership:" + proto) }

// fakeMemberships answers the memberships of the people of «Альта» (statuses of the seed: Олеся Петрова and Сергей
// Ильин invited, Кирилл Громов suspended, Дарья Зимина the owner).
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

var memberships = func() fakeMemberships {
	out := fakeMemberships{}
	for _, p := range altaPeople {
		st := p.status
		if st == memberBlocked {
			st = "suspended"
		}
		out[membershipOf(p.proto)] = Membership{Status: st, Owner: p.owner}
	}
	return out
}()

// relations are the objects of repairs of «Альта» the reference reads (extra-data.js:81–101): obj-42 and obj-38 of
// Алексей Соколов, obj-45 without a foreman.
type relations struct{}

func (relations) Objects(context.Context, uuid.UUID) ([]RepairObject, error) {
	o42 := demoObj42
	o42.ID, o42.Foreman, o42.Stage = pid("obj-42"), pid("m-sokolov"), "Черновая отделка"
	return []RepairObject{
		o42,
		{ID: pid("obj-38"), Name: "ЖК Северный парк · квартира 117", Stage: "Чистовая отделка", Foreman: pid("m-sokolov"),
			ForemanName: "Алексей Соколов", Address: "Москва, Дмитровское ш., 107к2, кв. 117", Area: "74 м², 3 комнаты",
			Kind: "капитальный ремонт", Client: "Игорь Лебедев"},
		{ID: pid("obj-45"), Name: "Кофейня на Покровке", Stage: "Подготовка", Address: "Москва, ул. Покровка, 17, стр. 1",
			Area: "64 м², зал и кухня", Kind: "коммерческий ремонт", Client: "ООО «Зерно»"},
	}, nil
}

// seedAlta writes «Альта» into the tenant DB of A: units, people with their memberships and functions, roles,
// groups, assignments (as cmd/seed) and the knowledge base of the seed.
func seedAlta(ctx context.Context) error {
	for _, step := range []func(context.Context) error{seedUnits, seedPeople, seedRoles, seedGroups, seedGrants, seedKnowledge} {
		if err := step(ctx); err != nil {
			return err
		}
	}
	return nil
}

func seedUnits(ctx context.Context) error {
	for _, u := range []struct{ proto, parent, kind, name string }{
		{"r-msk", "", "region", "Москва"}, {"r-smr", "", "region", "Самара"},
		{"f-msk-sever", "r-msk", "company", "Север Логистик"}, {"f-msk-yug", "r-msk", "company", "Юг Транс"},
		{"f-smr-volga", "r-smr", "company", "Волга Логистик"},
	} {
		var parent any
		if u.parent != "" {
			parent = pid(u.parent)
		}
		if err := exec(ctx, `insert into org.units (id, parent_id, kind, name, time_zone) values ($1, $2, $3, $4, 'Europe/Moscow')`,
			pid(u.proto), parent, u.kind, u.name); err != nil {
			return err
		}
		if err := exec(ctx, `insert into org.unit_closure (ancestor_id, descendant_id, depth)
			select $1::uuid, $1::uuid, 0 union all select $2::uuid, $1::uuid, 1 where $2::uuid is not null`, pid(u.proto), parent); err != nil {
			return err
		}
	}
	return nil
}

func seedPeople(ctx context.Context) error {
	for _, p := range altaPeople {
		if err := exec(ctx, `insert into people.person_profiles (id, membership_id, full_name, home_unit_id) values ($1, $2, $3, $4)`,
			pid(p.proto), membershipOf(p.proto), p.name, pid("f-msk-sever")); err != nil {
			return err
		}
	}
	for _, p := range altaPeople {
		if !p.driver {
			continue
		}
		if err := exec(ctx, `insert into people.work_profiles (person_id, function, unit_id, valid)
			values ($1, 'driver', $2, tstzrange('2026-09-01 00:00+03', null))`, pid(p.proto), pid("f-msk-sever")); err != nil {
			return err
		}
	}
	return nil
}

// seedRoles writes the roles of «Альта» (cmd/seed access.go; the roles of spaces are written by WriteDemo). The roles
// and groups of the fixtures have the names of «Альта» («Водитель», «Наблюдатель», «Руководитель пространства»):
// names of live roles are unique, and the module tests do not use them — they are archived first.
func seedRoles(ctx context.Context) error {
	if err := exec(ctx, `update access.roles set archived_at = now()`); err != nil {
		return err
	}
	if err := exec(ctx, `update access.groups set archived_at = now()`); err != nil {
		return err
	}
	for _, r := range altaRoles() {
		if strings.HasPrefix(r.proto, "r-kb-") {
			continue
		}
		if err := exec(ctx, `insert into access.roles (id, name, kind, template_key) values ($1, $2, $3, nullif($4, ''))`,
			pid(r.proto), r.name, r.kind, r.template); err != nil {
			return err
		}
		if err := exec(ctx, `insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`,
			pid(r.proto), r.actions, pid("m-owner")); err != nil {
			return err
		}
	}
	return nil
}

func seedGroups(ctx context.Context) error {
	for proto, g := range altaGroups {
		if err := exec(ctx, `insert into access.groups (id, name) values ($1, $2)`, pid(proto), g.name); err != nil {
			return err
		}
		for _, m := range g.members {
			if err := exec(ctx, `insert into access.group_members (group_id, person_id) values ($1, $2)`, pid(proto), pid(m)); err != nil {
				return err
			}
		}
	}
	return nil
}

// seedGrants writes the assignments of «Альта» but those of spaces (WriteDemo).
func seedGrants(ctx context.Context) error {
	for _, g := range altaGrants() {
		if strings.HasPrefix(g.id, "akb-") {
			continue
		}
		kind, principal := "person", g.member
		if p, ok := strings.CutPrefix(g.member, "group:"); ok {
			kind, principal = "group", p
		}
		var ref any
		if g.ref != "" {
			ref = pid(g.ref)
		}
		if err := exec(ctx, `insert into access.role_assignments (id, principal_kind, principal_id, role_id, role_version, scope_kind,
			scope_ref, include_descendants, valid, granted_by) values ($1, $2, $3, $4, 1, $5, $6, $7, tstzrange('2026-09-01 00:00+03', null), $8)`,
			pid(g.id), kind, pid(principal), pid(g.role), g.kind, ref, g.kind == scopeUnit, pid("m-owner")); err != nil {
			return fmt.Errorf("assignment %s: %w", g.id, err)
		}
	}
	return nil
}

// seedKnowledge writes the knowledge base of the seed in one transaction, as cmd/seed: the parent of a node is
// checked at its end (the deferred FK of tenant 0024).
func seedKnowledge(ctx context.Context) error {
	names := map[uuid.UUID]string{}
	for _, p := range altaPeople {
		names[pid(p.proto)] = p.name
	}
	tx, err := superA.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	inTx := func(ctx context.Context, sql string, args ...any) error {
		_, err := tx.Exec(ctx, sql, args...)
		return err
	}
	if err := WriteDemo(ctx, inTx, "t-alta", pid, func(proto string) string { return names[pid(proto)] }); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// as is the context of a member of «Альта» in tenant A as the gateway makes it.
func as(t *testing.T, proto string) context.Context {
	t.Helper()
	return tenantctx.WithTenant(t.Context(), tenantctx.TenantContext{TenantID: tenantA, PersonID: pid(proto), Owner: proto == "m-owner"})
}

// problemOf is the code and the detail of a Problem error.
func problemOf(err error) (string, string) {
	if pe, ok := errors.AsType[*problem.Error](err); ok {
		return pe.Code, pe.Detail
	}
	return "", ""
}
