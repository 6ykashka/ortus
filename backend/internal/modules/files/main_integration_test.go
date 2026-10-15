//go:build integration

package files_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib" // database/sql driver "pgx"

	"github.com/ortus/ortus-crm/backend/internal/modules/files" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage/miniotest"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"              //nolint:depguard // integration test: role names of the test cluster
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: clock and PostgreSQL of the suites
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04
)

// The world of the package: the isolation fixtures (W1.04) with fleet parents in both tenants, and MinIO.
var (
	world  *fixtures.World
	s3cfg  storage.Config
	parent = map[string]uuid.UUID{} // trip:a1, trip:a2, vehicle:a1, reservation:a1, expense:a1, trip:b1
)

func TestMain(m *testing.M) {
	os.Exit(runMain(m))
}

func runMain(m *testing.M) int {
	ctx := context.Background()
	c, stopPG, err := harness.StartPostgres(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer stopPG()
	if world, err = fixtures.Load(ctx, c, "files", harness.Now()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if err := seedParents(ctx); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	cfg, stopS3, err := miniotest.Start(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer stopS3()
	s3cfg = cfg
	return m.Run()
}

func ref(r string) uuid.UUID {
	id, err := world.ID(r)
	if err != nil {
		panic(err)
	}
	return id
}

func pid(name string) uuid.UUID {
	return uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:files-test:"+name))
}

// seedParents writes the fleet objects files attach to (tenant 0002): trips in Москва-1 and Москва-2 of A (the trip
// of Москва-1 is driven by a.driver-msk1), a vehicle and its reservation, an expense; a trip in Москва-1 of B.
func seedParents(ctx context.Context) error {
	for _, t := range []string{"a", "b"} {
		db, err := sql.Open("pgx", world.TenantURL(t, "super"))
		if err != nil {
			return err
		}
		defer db.Close()
		for _, q := range parentSQL(t) {
			if _, err := db.ExecContext(ctx, q.sql, q.args...); err != nil {
				return fmt.Errorf("seed parents %s: %w", t, err)
			}
		}
	}
	return nil
}

type stmt struct {
	sql  string
	args []any
}

func parentSQL(t string) []stmt {
	now := harness.Now()
	trip := `insert into fleet.trips (id, number, unit_id, state, planned, driver_person_id)
	         values ($1, $2, $3, 'planned', tstzrange($4, $5), $6)`
	if t == "b" {
		parent["trip:b1"] = pid("trip:b1")
		return []stmt{{trip, []any{parent["trip:b1"], "TR-2026-000001", ref("unit:b.msk1"), now, now.Add(24 * time.Hour), nil}}}
	}
	for _, k := range []string{"trip:a1", "trip:a2", "vehicle:a1", "resource:a1", "reservation:a1", "expense:a1"} {
		parent[k] = pid(k)
	}
	return []stmt{
		{trip, []any{parent["trip:a1"], "TR-2026-000101", ref("unit:a.msk1"), now, now.Add(24 * time.Hour), ref("person:a.driver-msk1@a")}},
		{trip, []any{parent["trip:a2"], "TR-2026-000102", ref("unit:a.msk2"), now, now.Add(24 * time.Hour), nil}},
		{`insert into fleet.vehicles (id, unit_id, plate, body_type, payload_kg, volume_m3, cargo_length_mm)
		  values ($1, $2, 'Р-208', 'van', 1500, 12, 3200)`, []any{parent["vehicle:a1"], ref("unit:a.msk1")}},
		{`insert into sched.resources (id, kind, ref_id, home_unit_id) values ($1, 'vehicle', $2, $3)`,
			[]any{parent["resource:a1"], parent["vehicle:a1"], ref("unit:a.msk1")}},
		{`insert into sched.reservations (id, resource_id, bundle_id, during, occupied, state, hold_expires_at,
		                                  source_type, source_id, created_by)
		  values ($1, $2, gen_random_uuid(), tstzrange($3, $4), tstzrange($3, $4), 'hold', $4, 'fleet.trip', $5, $6)`,
			[]any{parent["reservation:a1"], parent["resource:a1"], now, now.Add(time.Hour), parent["trip:a1"], ref("person:a.manager-msk1@a")}},
		{`insert into fleet.expenses (id, trip_id, category, amount_minor, occurred_on, claimed_by)
		  values ($1, $2, 'wash', 50000, $3, $4)`,
			[]any{parent["expense:a1"], parent["trip:a1"], now, ref("person:a.driver-msk1@a")}},
	}
}

// env is the module wired like cmd/api: tenant pools of ortus_api, the evaluator on the fixtures' clock, MinIO.
type env struct {
	dir    *tenantctx.PGDirectory
	pools  *tenantctx.Pools
	svc    *files.Service
	worker *files.Worker
	s3     *storage.S3
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
	s3, err := storage.NewS3(s3cfg, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	parents, err := files.NewParents(files.FleetParents()...)
	if err != nil {
		t.Fatal(err)
	}
	svc := &files.Service{Pools: pools, Authz: authz.New(src, src, harness.Now), Store: s3, Parents: parents}
	// The worker connects as ortus_worker (its own DML grants, grants.sql).
	wvars := world.Env()
	wvars["TENANT_DB_URL"] = world.Cluster.URL("", migrations.RoleWorker)
	wpools := tenantctx.NewPools(dir, func(k string) string { return wvars[k] }, "")
	t.Cleanup(wpools.Close)
	worker := &files.Worker{Pools: wpools, Store: s3, Scanner: files.BasicScanner{}}
	return env{dir: dir, pools: pools, svc: svc, worker: worker, s3: s3}
}

// tc resolves the tenant context of actor in tenant t («a» or «b»), as the gateway does.
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

func digest(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

var jpeg = append([]byte{0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 'J', 'F', 'I', 'F', 0x00}, bytes.Repeat([]byte("ortus"), 100)...)

// newUpload is an initiateUpload body for content attached to the parent key.
func newUpload(owner, entity string, purpose files.Purpose, contentType, name string, content []byte) files.Upload {
	return files.Upload{
		FileName: name, ContentType: contentType, SizeBytes: int64(len(content)), SHA256: digest(content),
		Purpose: purpose, Owner: files.Ref{Module: "fleet", Entity: entity, ID: parent[owner]},
	}
}

// put sends content to the upload URL of a ticket as the browser does.
func put(t *testing.T, ticket files.Ticket, contentType string, content []byte) {
	t.Helper()
	if code, body := putStatus(t, ticket, contentType, content); code != http.StatusOK {
		t.Fatalf("PUT: %d %s", code, body)
	}
}

// putStatus sends content to the upload URL of a ticket and returns the answer of storage.
func putStatus(t *testing.T, ticket files.Ticket, contentType string, content []byte) (int, []byte) {
	t.Helper()
	r, err := http.NewRequestWithContext(t.Context(), http.MethodPut, ticket.URL, bytes.NewReader(content))
	if err != nil {
		t.Fatal(err)
	}
	r.Header.Set("Content-Type", contentType)
	resp, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, b
}

// uploaded runs initiate → PUT → complete for actor and returns the file in quarantine.
func (e env) uploaded(t *testing.T, tc tenantctx.TenantContext, u files.Upload, content []byte) (files.Ticket, files.File) {
	t.Helper()
	ticket, err := e.svc.Initiate(t.Context(), tc, u)
	if err != nil {
		t.Fatalf("Initiate: %v", err)
	}
	put(t, ticket, u.ContentType, content)
	f, err := e.svc.Complete(t.Context(), tc, ticket.UploadID, u.SHA256)
	if err != nil {
		t.Fatalf("Complete: %v", err)
	}
	return ticket, f
}

// scan delivers files.file.uploaded.v1 of a file to the worker.
func (e env) scan(t *testing.T, tenant string, file uuid.UUID) {
	t.Helper()
	m := events.Message{TenantID: ref("tenant:" + tenant), EventID: uuid.New(), Type: files.EventUploaded,
		Aggregate: "files.file", AggregateID: file, Attempts: 1}
	if err := e.worker.Scan(t.Context(), m); err != nil {
		t.Fatalf("Scan: %v", err)
	}
}

// ready uploads content and lets the worker check it.
func (e env) ready(t *testing.T, tc tenantctx.TenantContext, u files.Upload, content []byte) files.File {
	t.Helper()
	_, f := e.uploaded(t, tc, u, content)
	e.scan(t, tenantKey(tc), f.ID)
	return f
}

func tenantKey(tc tenantctx.TenantContext) string {
	if tc.TenantID == ref("tenant:b") {
		return "b"
	}
	return "a"
}

// db opens the tenant DB as the superuser to look at what the module wrote.
func db(t *testing.T, tenant string) *sql.DB {
	t.Helper()
	d, err := sql.Open("pgx", world.TenantURL(tenant, "super"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	return d
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
