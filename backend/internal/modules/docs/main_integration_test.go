//go:build integration

package docs

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"              //nolint:depguard // integration test: role names of the test cluster
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"  //nolint:depguard // integration test: the superuser that writes the seed
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: clock and PostgreSQL of the suites
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04
)

// The world of the integration tests: the isolation fixtures (W1.04) — tenant A with its owner, managers and
// drivers — and the documents the tests write as the superuser.
var (
	fx      *fixtures.World
	superA  *pgxpool.Pool // tenant DB of A as the superuser
	control *pgxpool.Pool // control DB as ortus_api
	pools   *tenantctx.Pools
	tenantA uuid.UUID
	blobs   MemBlobs
	svc     *Service
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
	if fx, err = fixtures.Load(ctx, c, "docs", harness.Now()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if superA, err = pgxpool.New(ctx, fx.TenantURL(fixtures.TenantA, migratetest.Super)); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer superA.Close()
	if control, err = pgxpool.New(ctx, fx.ControlURL(migrations.RoleAPI)); err != nil {
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
	blobs = MemBlobs{storage.NewMem()}
	svc = &Service{Pools: pools, Memberships: PGMemberships{DB: control}, Links: PGLinks{DB: control}, Blobs: blobs, Now: harness.Now,
		PublicBase: "https://ortus.example"}
	return m.Run()
}

// testNowDate is the date of the clock of the tests.
func testNowDate() time.Time { return dayOf(harness.Now()) }

// exec runs a statement on the tenant DB of A as the superuser.
func exec(ctx context.Context, sql string, args ...any) error {
	_, err := superA.Exec(ctx, sql, args...)
	return err
}

// actor is an actor of the fixtures in tenant A.
func actor(t *testing.T, key string) fixtures.Membership {
	t.Helper()
	a, err := fx.Actor(key)
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range a.Memberships {
		if m.Tenant == fixtures.TenantA {
			return m
		}
	}
	t.Fatalf("actor %s has no membership in tenant A", key)
	return fixtures.Membership{}
}

// as is the context of an actor in tenant A as the gateway makes it.
func as(t *testing.T, key string) (context.Context, tenantctx.TenantContext) {
	t.Helper()
	m := actor(t, key)
	tc := tenantctx.TenantContext{TenantID: m.TenantID, PersonID: m.PersonID, Owner: m.Owner}
	return tenantctx.WithTenant(t.Context(), tc), tc
}

// personOf is the person id of an actor of tenant A.
func personOf(t *testing.T, key string) uuid.UUID {
	t.Helper()
	return actor(t, key).PersonID
}

// problemOf is the code and the detail of a Problem error.
func problemOf(err error) (string, string) {
	if pe, ok := errors.AsType[*problem.Error](err); ok {
		return pe.Code, pe.Detail
	}
	if fe, ok := errors.AsType[*fieldsError](err); ok {
		return codeValidation, fe.detail
	}
	return "", ""
}

// wantCode fails unless err is a Problem with the code.
func wantCode(t *testing.T, err error, code string) {
	t.Helper()
	if got, detail := problemOf(err); got != code {
		t.Fatalf("error %v (code %q, %q), want code %q", err, got, detail, code)
	}
}

// seedFolder writes a folder as the superuser and returns its id.
func seedFolder(t *testing.T, name string, parent uuid.UUID, owner uuid.UUID, mode string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if err := exec(t.Context(), `insert into docs.folders (id, name, parent_id, owner_id, mode) values ($1, $2, $3, $4, $5)`,
		id, name, nullID(parent), owner, mode); err != nil {
		t.Fatal(err)
	}
	return id
}

// seedDoc writes a document with its version 1 as the superuser and returns its id.
func seedDoc(t *testing.T, folder uuid.UUID, owner uuid.UUID, title, kind string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if err := exec(t.Context(), `insert into docs.documents (id, kind, title, folder_id, owner_id) values ($1, $2, $3, $4, $5)`,
		id, kind, title, folder, owner); err != nil {
		t.Fatal(err)
	}
	if err := exec(t.Context(), `insert into docs.versions (document_id, number, source, authors) values ($1, 1, 'edit', $2)`, id, []uuid.UUID{owner}); err != nil {
		t.Fatal(err)
	}
	return id
}
