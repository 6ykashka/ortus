//go:build integration

package pool_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib" // database/sql driver "pgx"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/pool" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"              //nolint:depguard // integration test: role names of the test cluster
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: clock and PostgreSQL of the suites
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04
)

// The world of the package: the isolation fixtures (W1.04) without content. Every test publishes its own drivers —
// people of Москва-2 with the function «Водитель» and the role «Водитель» over their home company, as on the stand —
// and plans its own trips. The tests are not parallel: the settlement of the pool (SettleTenant) writes the whole
// tenant at the clock of its test.
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
	if world, err = fixtures.Load(ctx, c, "pool", harness.Now()); err != nil {
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

func unit(key string) uuid.UUID { return ref("unit:a." + key) }

func person(actor string) uuid.UUID { return ref("person:" + actor + "@a") }

// clock is the clock of the application in a test: the service and the evaluator read it.
type clock struct {
	mu sync.Mutex
	at time.Time
}

func (c *clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.at
}

func (c *clock) Set(t time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.at = t
}

// env is the module wired like cmd/api: tenant pools of ortus_api, the evaluator on the clock of the test, the
// memberships of the control DB and the audience of the inbox (W1.10).
type env struct {
	dir   *tenantctx.PGDirectory
	svc   *pool.Service
	ev    *authz.Evaluator
	clock *clock
	t0    time.Time
}

func newEnv(t *testing.T) *env {
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
	c := &clock{at: harness.Now()}
	src := authz.PGSource{Pools: pools}
	ev := authz.New(src, src, c.Now)
	svc := &pool.Service{Pools: pools, Authz: ev, Recipients: inbox.PGRecipients{Control: control},
		Owners: pool.ControlOwners{Control: control}, Audience: inbox.AuthzAudience{E: ev}, Now: c.Now}
	return &env{dir: dir, svc: svc, ev: ev, clock: c, t0: harness.Now()}
}

// tc resolves the tenant context of a fixture actor in tenant «a» (or tenant, when given), as the gateway does.
func (e *env) tc(t *testing.T, actor string, tenant ...string) tenantctx.TenantContext {
	t.Helper()
	tn := "a"
	if len(tenant) > 0 {
		tn = tenant[0]
	}
	a, err := world.Actor(actor)
	if err != nil {
		t.Fatal(err)
	}
	tc, err := tenantctx.Resolve(t.Context(), e.dir, a.AccountID, ref("tenant:"+tn).String(), false)
	if err != nil {
		t.Fatal(err)
	}
	return tc
}

// as is the tenant context of a person of tenant «a» without an account (a seeded driver or manager).
func as(p uuid.UUID) tenantctx.TenantContext {
	return tenantctx.TenantContext{TenantID: ref("tenant:a"), PersonID: p}
}

func db(t *testing.T) *sql.DB {
	t.Helper()
	return dbs["a"]
}

func exec(t *testing.T, q string, args ...any) {
	t.Helper()
	if _, err := db(t).ExecContext(t.Context(), q, args...); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
}

func scalar[T any](t *testing.T, q string, args ...any) T {
	t.Helper()
	var v T
	if err := db(t).QueryRowContext(t.Context(), q, args...).Scan(&v); err != nil {
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

// since is the start of the seeded functions and roles: a month before the clock of the fixtures.
func since() time.Time { return harness.Now().Add(-30 * 24 * time.Hour) }

// newDriver registers a person of company home with the work function «Водитель» and the role «Водитель» over
// home (as the driver group of the stand, cmd/seed access.go).
func newDriver(t *testing.T, home, name string) uuid.UUID {
	t.Helper()
	p := newPerson(t, home, name)
	exec(t, `insert into people.work_profiles (person_id, function, unit_id, valid) values ($1, 'driver', $2, tstzrange($3, null))`,
		p, unit(home), since())
	grant(t, p, "driver", home, false)
	return p
}

// newManager registers a person of company home with the role «Менеджер логистики» over home and its subtree.
func newManager(t *testing.T, home string) uuid.UUID {
	t.Helper()
	p := newPerson(t, home, "Менеджер "+home)
	grant(t, p, "manager", home, true)
	return p
}

func newPerson(t *testing.T, home, name string) uuid.UUID {
	t.Helper()
	return scalar[uuid.UUID](t, `insert into people.person_profiles (full_name, home_unit_id) values ($1, $2) returning id`,
		name, unit(home))
}

func grant(t *testing.T, p uuid.UUID, role, scope string, descendants bool) {
	t.Helper()
	exec(t, `insert into access.role_assignments (principal_kind, principal_id, role_id, role_version, scope_kind, scope_ref,
	          include_descendants, valid, granted_by, reason)
	         values ('person', $1, $2, 1, 'unit', $3, $4, tstzrange($5, null), $1, 'pool test')`,
		p, ref("role:a."+role), unit(scope), descendants, since())
}

// trip is a trip planned in a company.
type trip struct {
	ID     uuid.UUID
	Number string
	Unit   uuid.UUID
}

// newTrip plans a trip of company key for w (driver: uuid.Nil — none).
func newTrip(t *testing.T, key string, w pool.Window, driver uuid.UUID) trip {
	t.Helper()
	tr := trip{ID: uuid.New(), Number: "Р-" + strconv.FormatInt(9000+seq.Add(1), 10), Unit: unit(key)}
	var d any
	if driver != uuid.Nil {
		d = driver
	}
	exec(t, `insert into fleet.trips (id, number, unit_id, state, driver_person_id, planned)
	         values ($1, $2, $3, 'planned', $4, tstzrange($5, $6))`, tr.ID, tr.Number, tr.Unit, d, w.Start, w.End)
	return tr
}

// startTrip puts a vehicle of the company of tr on it and moves it to state (inspection … accepted), as W2.02–W2.06.
func startTrip(t *testing.T, tr trip, state string, at time.Time) {
	t.Helper()
	v := uuid.New()
	exec(t, `insert into fleet.vehicles (id, unit_id, plate, body_type, payload_kg, volume_m3, cargo_length_mm)
	         values ($1, $2, $3, 'van', 1500, 12, 3200)`, v, tr.Unit, fmt.Sprintf("П %03d УЛ 77", seq.Add(1)%1000))
	exec(t, `update fleet.trips set vehicle_id = $2, started_at = $3, state = $4 where id = $1`, tr.ID, v, at, state)
}

// window is [t0 + from, t0 + until).
func (e *env) window(from, until time.Duration) pool.Window {
	return pool.Window{Start: e.t0.Add(from), End: e.t0.Add(until)}
}

func api(w pool.Window) fleetapi.TimeWindow {
	return fleetapi.TimeWindow{StartsAt: w.Start, EndsAt: w.End, TimeZone: "Europe/Moscow"}
}

// publish publishes driver of company home for w by the actor of tc and requires success.
func (e *env) publish(t *testing.T, tc tenantctx.TenantContext, driver uuid.UUID, home string, w pool.Window) fleetapi.DriverPoolPublication {
	t.Helper()
	terms := "По соглашению фирм группы"
	p, err := e.svc.Publish(t.Context(), tc, fleetapi.DriverPoolPublicationCreate{
		DriverMemberId: driver, HomeOrgUnitId: unit(home), FreeWindow: api(w),
		Qualifications: []string{"Кат. C", "рефрижератор"}, Terms: &terms,
	})
	if err != nil {
		t.Fatalf("publishDriverToPool: %v", err)
	}
	return p
}

// transferOf is the body of a request of driver of source for target in w, for tr (nil — without a trip).
func transferOf(driver uuid.UUID, source, target string, w pool.Window, tr *trip) fleetapi.DriverTransferCreate {
	b := fleetapi.DriverTransferCreate{DriverMemberId: driver, SourceOrgUnitId: unit(source), TargetOrgUnitId: unit(target),
		Window: api(w), Reason: "Запрос на рейс"}
	if tr != nil {
		id := tr.ID
		b.TripId = &id
	}
	return b
}

// request requests and requires success.
func (e *env) request(t *testing.T, tc tenantctx.TenantContext, b fleetapi.DriverTransferCreate) fleetapi.DriverTransfer {
	t.Helper()
	x, err := e.svc.Request(t.Context(), tc, b)
	if err != nil {
		t.Fatalf("requestDriverTransfer: %v", err)
	}
	return x
}

// decide decides with the ETag of revision and requires success; a rejection gives its reason (W2.71, 0.6.3-stage2:
// reject without a comment is 422).
func (e *env) decide(t *testing.T, tc tenantctx.TenantContext, x fleetapi.DriverTransfer, d fleetapi.DriverTransferDecisionDecision) fleetapi.DriverTransfer {
	t.Helper()
	b := fleetapi.DriverTransferDecision{Decision: d}
	if d == fleetapi.DriverTransferDecisionDecisionReject {
		reason := "Водитель нужен своей фирме"
		b.Comment = &reason
	}
	out, err := e.svc.Decide(t.Context(), tc, x.Id, etag(x.Revision), b)
	if err != nil {
		t.Fatalf("decideDriverTransfer %s: %v", d, err)
	}
	return out
}

func etag(rev int64) string { return `"` + strconv.FormatInt(rev, 10) + `"` }
