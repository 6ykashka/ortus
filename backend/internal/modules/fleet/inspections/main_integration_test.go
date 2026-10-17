//go:build integration

package inspections_test

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

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/inspections" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"              //nolint:depguard // integration test: role names of the test cluster
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: clock and PostgreSQL of the suites
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04
)

// The world of the package: the isolation fixtures (W1.04) without content; every test seeds its own vehicles,
// trips, reservations and photos (the trip states of W2.02 and W2.05 are written directly).
var (
	world *fixtures.World
	dbs   = map[string]*sql.DB{} // the tenant DBs as the superuser, one pool each
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
	if world, err = fixtures.Load(ctx, c, "inspections", harness.Now()); err != nil {
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

// env is the module wired like cmd/api: tenant pools of ortus_api, the evaluator on the fixtures' clock, the
// memberships of the control DB and the audience of the inbox (W1.10).
type env struct {
	dir   *tenantctx.PGDirectory
	pools *tenantctx.Pools
	svc   *inspections.Service
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
	svc := &inspections.Service{Pools: pools, Authz: ev, Recipients: inbox.PGRecipients{Control: control},
		Audience: inbox.AuthzAudience{E: ev}, Now: harness.Now}
	return env{dir: dir, pools: pools, svc: svc}
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

// db is the tenant DB as the superuser to seed and to look at what the module wrote.
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

func wantCode(t *testing.T, err error, code string) {
	t.Helper()
	if !problem.Is(err, code) {
		t.Fatalf("error %v, want %s", err, code)
	}
}

func isCode(err error, code string) bool {
	var pe *problem.Error
	return errors.As(err, &pe) && pe.Code == code
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

// trip is a seeded trip with its vehicle and, for a departure, its held reservation.
type trip struct {
	tenant                     string
	ID, Vehicle, Reservation   uuid.UUID
	Number, Plate, VehicleName string
	Unit                       uuid.UUID
	Driver                     uuid.UUID
	resource                   uuid.UUID
	odometer                   float64
}

// seedTrip writes a vehicle of unit (odometer 48210 km), a trip of the driver in state «inspection» with the
// vehicle and a held reservation of 30 minutes (what W2.02 leaves after reserveVehicle).
func seedTrip(t *testing.T, tenant, unit string, driver uuid.UUID) trip {
	t.Helper()
	d := db(t, tenant)
	n := seq.Add(1)
	tr := trip{tenant: tenant, ID: uuid.New(), Vehicle: uuid.New(), Reservation: uuid.New(), resource: uuid.New(),
		Number: "Р-" + strconv.FormatInt(400+n, 10), Plate: fmt.Sprintf("М %03d КТ 77", n), VehicleName: "Газель Next",
		Unit: ref("unit:" + tenant + "." + unit), Driver: driver, odometer: 48210}
	now := harness.Now()
	exec(t, d, `insert into fleet.vehicles (id, unit_id, plate, body_type, payload_kg, volume_m3, cargo_length_mm, odometer_km, display_name)
	            values ($1, $2, $3, 'van', 1500, 12, 3200, $4, $5)`, tr.Vehicle, tr.Unit, tr.Plate, tr.odometer, tr.VehicleName)
	exec(t, d, `insert into sched.resources (id, kind, ref_id, home_unit_id) values ($1, 'vehicle', $2, $3)`, tr.resource, tr.Vehicle, tr.Unit)
	var drv any
	if driver != uuid.Nil {
		drv = driver
	}
	exec(t, d, `insert into fleet.trips (id, number, unit_id, state, vehicle_id, driver_person_id, planned, title)
	            values ($1, $2, $3, 'inspection', $4, $5, tstzrange($6, $7), 'Склад → магазин')`,
		tr.ID, tr.Number, tr.Unit, tr.Vehicle, drv, now, now.Add(8*time.Hour))
	exec(t, d, `insert into sched.reservations (id, resource_id, bundle_id, during, occupied, state, hold_expires_at,
	                                            source_type, source_id, created_by)
	            values ($1, $2, gen_random_uuid(), tstzrange($3, $4), tstzrange($3, $4), 'hold', $5, 'fleet.trip', $6, $7)`,
		tr.Reservation, tr.resource, now, now.Add(8*time.Hour), now.Add(30*time.Minute), tr.ID, coalesce(driver, person("a.manager-msk1")))
	return tr
}

func coalesce(id, fallback uuid.UUID) uuid.UUID {
	if id == uuid.Nil {
		return fallback
	}
	return id
}

// photoFile writes an inspection photo of the parent (files.objects) in state.
func photoFile(t *testing.T, tenant, ownerType string, owner uuid.UUID, state string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	exec(t, db(t, tenant), `insert into files.objects (id, object_key, state, purpose, owner_type, owner_id, declared_mime,
	                                                   bytes, uploaded_by, ready_at)
	     values ($1::uuid, 'files/'||$1::text, $2::text, 'inspection', $3, $4, 'image/jpeg', 2048, $5, case when $2::text = 'ready' then now() end)`,
		id, state, ownerType, owner, person("a.driver-msk1"))
	return id
}

// photos returns the five photos of the checklist roles attached to the parent, all ready.
func photos(t *testing.T, tenant, ownerType string, owner uuid.UUID) []fleetapi.InspectionPhoto {
	t.Helper()
	out := []fleetapi.InspectionPhoto{}
	for _, role := range []string{"front", "rear", "left", "right", "odometer"} {
		out = append(out, fleetapi.InspectionPhoto{Role: fleetapi.InspectionPhotoRole(role),
			FileId: photoFile(t, tenant, ownerType, owner, "ready"), CapturedAt: harness.Now().Add(-10 * time.Minute)})
	}
	return out
}

func checks(keys ...string) []fleetapi.InspectionCheck {
	out := []fleetapi.InspectionCheck{}
	for _, k := range keys {
		out = append(out, fleetapi.InspectionCheck{Key: k, Result: "pass"})
	}
	return out
}

var (
	depChecks = []string{"body", "tires", "docs"}
	retChecks = []string{"cargo", "personal", "keys"}
)

// departure is a complete departure inspection body of tr by the current checklist.
func (e env) departure(t *testing.T, tr trip, defects ...fleetapi.InspectionDefectReport) fleetapi.InspectionCreate {
	t.Helper()
	list, err := e.svc.Checklist(t.Context(), e.tc(t, "a.owner", tr.tenant), tr.Vehicle, "departure")
	if err != nil {
		t.Fatalf("Checklist: %v", err)
	}
	res := tr.Reservation
	b := fleetapi.InspectionCreate{
		ChecklistVersionId: list.VersionId, VehicleId: tr.Vehicle, ReservationId: &res, Kind: "departure",
		OdometerKm: "48250", FuelPercent: 75, Checks: checks(depChecks...),
		Photos: photos(t, tr.tenant, "fleet.reservation", tr.Reservation), CapturedAt: harness.Now().Add(-5 * time.Minute),
	}
	if len(defects) > 0 {
		b.Defects = &defects
	}
	return b
}

// critical is a blocking defect («Критический — машина не может выехать»).
func critical(zone string) fleetapi.InspectionDefectReport {
	return fleetapi.InspectionDefectReport{Zone: zone, Description: "Порез боковины переднего левого колеса", Severity: "blocking"}
}

// blocked submits a departure of tr with one blocking defect as its driver and returns the inspection.
func (e env) blocked(t *testing.T, tr trip) fleetapi.Inspection {
	t.Helper()
	got, err := e.svc.Submit(t.Context(), e.tc(t, "a.driver-msk1", tr.tenant), e.departure(t, tr, critical("Шины и колёса")))
	if err != nil {
		t.Fatalf("Submit: %v", err)
	}
	if got.Defects == nil || len(*got.Defects) != 1 {
		t.Fatalf("defects of %+v", got)
	}
	return got
}

// notices returns the titles of the notifications of kind about trip for person in tenant.
func notices(t *testing.T, tenant string, who uuid.UUID, kind string, trip uuid.UUID) []string {
	t.Helper()
	rows, err := db(t, tenant).QueryContext(t.Context(), `select title from notify.notifications
	  where recipient_person_id = $1 and kind = $2 and entity_type = 'trip' and entity_id = $3 order by created_at, id`, who, kind, trip)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			t.Fatal(err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}
