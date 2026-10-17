//go:build integration

package finance_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib" // database/sql driver "pgx"

	"github.com/ortus/ortus-crm/backend/internal/modules/finance" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"              //nolint:depguard // integration test: role names of the test cluster
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: clock and PostgreSQL of the suites
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04
)

// The world of the package: the isolation fixtures (W1.04) without content; every test seeds its own trips as W2.06
// leaves them after reviewTrip.
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
	if world, err = fixtures.Load(ctx, c, "finance", harness.Now()); err != nil {
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

// env is the module wired like cmd/api: tenant pools of ortus_api and the evaluator on the fixtures' clock.
type env struct {
	dir *tenantctx.PGDirectory
	svc *finance.Service
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
	svc := &finance.Service{Pools: pools, Authz: ev, Now: harness.Now}
	return env{dir: dir, svc: svc, now: harness.Now()}
}

// tc resolves the tenant context of actor in tenant («a» or «b»), as the gateway does.
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

func db(t *testing.T, tenant string) *sql.DB {
	t.Helper()
	d, ok := dbs[tenant]
	if !ok {
		t.Fatalf("no tenant %q", tenant)
	}
	return d
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

// wantProblem fails unless err is a Problem with code (and detail, when not empty).
func wantProblem(t *testing.T, err error, code, detail string) {
	t.Helper()
	pe, ok := errors.AsType[*problem.Error](err)
	if !ok || pe.Code != code || (detail != "" && pe.Detail != detail) {
		t.Fatalf("error %v, want %s %q", err, code, detail)
	}
}

// expect fails the test at the first false check, printing what was checked.
func expect(t *testing.T, what string, got any, checks ...bool) {
	t.Helper()
	for i, ok := range checks {
		if !ok {
			t.Fatalf("%s: check %d of %d failed: %+v", what, i+1, len(checks), got)
		}
	}
}

var seq atomic.Int64

// trip is a seeded trip of a driver in a unit, accepted by reviewer half an hour ago unless its state says otherwise.
type trip struct {
	tenant           string
	ID, Unit, Driver uuid.UUID
	Reviewer         uuid.UUID
	Number           string
	ReviewedAt       time.Time
}

// seedTrip writes a trip of driver in unit (fixture key) in state with its vehicle; an accepted one is reviewed by
// reviewer reviewedAgo before now.
func seedTrip(t *testing.T, tenant, unit, state string, driver, reviewer uuid.UUID, reviewedAgo time.Duration) trip {
	t.Helper()
	d := db(t, tenant)
	n := seq.Add(1)
	now := harness.Now()
	tr := trip{tenant: tenant, ID: uuid.New(), Unit: ref("unit:" + tenant + "." + unit), Driver: driver, Reviewer: reviewer,
		Number: "Р-" + strconv.FormatInt(900+n, 10), ReviewedAt: now.Add(-reviewedAgo)}
	vehicle := uuid.New()
	exec(t, d, `insert into fleet.vehicles (id, unit_id, plate, body_type, payload_kg, volume_m3, cargo_length_mm, odometer_km)
	            values ($1, $2, $3, 'van', 1500, 12, 3200, 48210)`, vehicle, tr.Unit, fmt.Sprintf("Н %03d ЧС 77", n))
	var reviewedAt, reviewedBy any
	if state == "accepted" {
		reviewedAt, reviewedBy = tr.ReviewedAt, reviewer
	}
	exec(t, d, `insert into fleet.trips (id, number, unit_id, state, vehicle_id, driver_person_id, planned, started_at, returned_at,
	                                     reviewed_at, reviewed_by)
	            values ($1, $2, $3, $4, $5, $6, tstzrange($7, $8), $7, $8, $9, $10)`,
		tr.ID, tr.Number, tr.Unit, state, vehicle, driver, now.Add(-5*time.Hour), now.Add(-time.Hour), reviewedAt, reviewedBy)
	return tr
}

func etag(rev int64) string { return `"` + strconv.FormatInt(rev, 10) + `"` }
