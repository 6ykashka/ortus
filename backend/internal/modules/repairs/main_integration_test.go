//go:build integration

package repairs

import (
	"context"
	"errors"
	"fmt"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/modules/cash" //nolint:depguard // integration test: the real proposals of the cash desks

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"              //nolint:depguard // integration test: role names of the test cluster
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"  //nolint:depguard // integration test: the superuser that writes the data of the tests
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: clock and PostgreSQL of the suites
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04
)

// The world of the package: the isolation fixtures of W1.04 and, in tenant A, the roles of repairs — «Ремонт: офис»
// (a.region-msk over Москва with its firms), «Прораб» in the scope «своё» (a.manager-msk1) and «Ремонт: чтение»
// (a.manager-msk2 over Москва-2: sees objects, no marks, no review). Every test makes its own objects.
var (
	world   *fixtures.World
	superA  *pgxpool.Pool // tenant DB of A as the superuser
	control *pgxpool.Pool // control DB as ortus_api
	pools   *tenantctx.Pools
	dir     *tenantctx.PGDirectory
)

var (
	roleOffice  = uuid.New()
	roleForeman = uuid.New()
	roleReader  = uuid.New()
	roleDesk    = uuid.New() // office without finance
	// photos are two checked files of tenant A (files.objects, ready): the evidence of a mark names files of its tenant.
	photos = []uuid.UUID{uuid.New(), uuid.New()}
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
	if world, err = fixtures.Load(ctx, c, "repairs", harness.Now()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if superA, err = pgxpool.New(ctx, world.TenantURL(fixtures.TenantA, migratetest.Super)); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer superA.Close()
	if control, err = pgxpool.New(ctx, world.ControlURL(migrations.RoleAPI)); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer control.Close()
	vars := world.Env()
	dir = tenantctx.NewPGDirectory(control)
	pools = tenantctx.NewPools(dir, func(k string) string { return vars[k] }, vars["TENANT_DB_HOST"])
	defer pools.Close()
	if err := repairRoles(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "roles:", err)
		return 1
	}
	if err := seedPhotos(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "photos:", err)
		return 1
	}
	return m.Run()
}

var (
	roleOfficeKeys = []string{actRead, actManage, actLogsRead, actReview, actFinance, actEstimates, actHandOver, actCatalog, actMeasure, actDocSend,
		actCrewAccrue, actCrewPay, actSubs, actClientLink}
	deskActions   = []string{actRead, actManage, actLogsRead, actReview}
	foremanKeys   = []string{actRead, actLogsRead, actSubmit, actChanges, actMeasure}
	readerActions = []string{actRead}
)

// seedPhotos writes the files of photos as the uploads of the owner of A (state ready).
func seedPhotos(ctx context.Context) error {
	for i, id := range photos {
		key := fmt.Sprintf("repairs/%s.jpg", id)
		if _, err := superA.Exec(ctx, `insert into files.objects (id, object_key, state, purpose, owner_type, owner_id, declared_mime,
			detected_mime, bytes, sha256, uploaded_by, created_at, ready_at) values ($1, $2, $3, 'inspection', 'fleet.vehicle', $4,
			'image/jpeg', 'image/jpeg', 2048, sha256(convert_to($2, 'UTF8')), $5, $6, $6)`,
			id, key, "ready", uuid.New(), person("a.owner"), harness.Now().Add(-time.Duration(i+1)*time.Hour)); err != nil {
			return err
		}
	}
	return nil
}

// repairRoles writes the roles of repairs of tenant A and their assignments.
func repairRoles(ctx context.Context) error {
	for _, r := range []struct {
		id      uuid.UUID
		name    string
		actions []string
	}{
		{roleOffice, "Ремонт: офис", roleOfficeKeys},
		{roleDesk, "Ремонт: офис без финансов", deskActions},
		{roleForeman, "Прораб", foremanKeys},
		{roleReader, "Ремонт: чтение", readerActions},
	} {
		if _, err := superA.Exec(ctx, `insert into access.roles (id, name, kind) values ($1, $2, 'custom')`, r.id, r.name); err != nil {
			return err
		}
		if _, err := superA.Exec(ctx, `insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`,
			r.id, r.actions, person("a.owner")); err != nil {
			return err
		}
	}
	for _, g := range []struct {
		actor string
		role  uuid.UUID
		kind  string
		unit  string
	}{
		{"a.region-msk", roleOffice, "unit", "msk"},
		{"a.manager-msk1", roleForeman, "self", ""},
		{"a.manager-msk2", roleReader, "unit", "msk2"},
		{"ab.member", roleDesk, "unit", "msk"},
	} {
		var ref any
		if g.unit != "" {
			ref = unit(g.unit)
		}
		if _, err := superA.Exec(ctx, `insert into access.role_assignments (principal_kind, principal_id, role_id, role_version,
			scope_kind, scope_ref, include_descendants, valid, granted_by) values ('person', $1, $2, 1, $3, $4, true,
			tstzrange($5::timestamptz, null), $6)`, person(g.actor), g.role, g.kind, ref, harness.Now().Add(-time.Hour),
			person("a.owner")); err != nil {
			return err
		}
	}
	return nil
}

func ref(r string) uuid.UUID {
	id, err := world.ID(r)
	if err != nil {
		panic(err)
	}
	return id
}

func person(actor string) uuid.UUID { return ref("person:" + actor + "@a") }

func unit(key string) uuid.UUID { return ref("unit:a." + key) }

var ticks atomic.Int64

// clock is the clock of the suites moving a millisecond a call: the requests of a test follow each other.
func clock() time.Time { return harness.Now().Add(time.Duration(ticks.Add(1)) * time.Millisecond) }

// inbox is the code delivery port of the suites (D-31): the codes of the signatures by the phone they went to.
var inbox = &codeInbox{}

type codeInbox struct {
	mu    sync.Mutex
	codes map[string][]string
}

func (c *codeInbox) SendSignCode(_ context.Context, phone, code string, _ time.Time) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.codes == nil {
		c.codes = map[string][]string{}
	}
	c.codes[phone] = append(c.codes[phone], code)
	return nil
}

// SendClientLink records the link of the cabinet that went to the phone (the same inbox: a link starts with «http»).
func (c *codeInbox) SendClientLink(_ context.Context, phone, url string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.codes == nil {
		c.codes = map[string][]string{}
	}
	c.codes[phone] = append(c.codes[phone], url)
	return nil
}

// lastLink is the latest link of the cabinet sent to phone.
func (c *codeInbox) lastLink(phone string) string {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, v := range slices.Backward(c.codes[phone]) {
		if strings.HasPrefix(v, "http") {
			return v
		}
	}
	return ""
}

// last is the latest code sent to phone ("" — none) and sent is how many went.
func (c *codeInbox) last(phone string) string {
	c.mu.Lock()
	defer c.mu.Unlock()
	all := c.codes[phone]
	for _, v := range slices.Backward(all) {
		if !strings.HasPrefix(v, "http") {
			return v
		}
	}
	return ""
}

func (c *codeInbox) sent(phone string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.codes[phone])
}

func service() *Service {
	return &Service{Pools: pools, Now: clock, Codes: inbox, SignKey: []byte("key-of-the-suites"), Links: PGLinks{DB: control},
		Offers: cashOffers{svc: &cash.Service{Pools: pools, Now: clock}}, PublicBase: "https://crm.suites.example"}
}

// cashOffers is the port of the payouts over the proposals of the real cash desks (W5.31), in the transaction of the payout.
type cashOffers struct{ svc *cash.Service }

func (c cashOffers) OfferPayroll(ctx context.Context, tx pgx.Tx, o PayrollOffer) error {
	label := o.SourceLabel
	_, err := c.svc.Offer(ctx, tx, cash.Offer{Key: o.Key, Kind: "payroll", Title: o.Title, Amount: o.AmountMinor, Direction: "out",
		SourceKind: o.SourceKind, SourceID: o.SourceID, SourceLabel: &label})
	return err
}

// as resolves the tenant context of actor in tenant A, as the gateway does.
func as(t *testing.T, actor string) tenantctx.TenantContext {
	t.Helper()
	a, err := world.Actor(actor)
	if err != nil {
		t.Fatal(err)
	}
	tc, err := tenantctx.Resolve(t.Context(), dir, a.AccountID, ref("tenant:a").String(), true)
	if err != nil {
		t.Fatal(err)
	}
	return tc
}

// result is a value and its error: must(f()).of(t) fails the test on the error.
type result[T any] struct {
	v   T
	err error
}

func must[T any](v T, err error) result[T] { return result[T]{v, err} }

func (r result[T]) of(t *testing.T) T {
	t.Helper()
	if r.err != nil {
		t.Fatal(r.err)
	}
	return r.v
}

func rev(r int64) string { return `"rev-` + strconv.FormatInt(r, 10) + `"` }

// wantCode requires the Problem.code (and the detail when not empty) of err.
func wantCode(t *testing.T, err error, code, detail string) {
	t.Helper()
	if err == nil {
		t.Fatalf("no error, want %s «%s»", code, detail)
	}
	got, text := "", ""
	if f, ok := asFailure(err); ok {
		got, text = f.code, f.detail
	} else if p, ok := errors.AsType[*problem.Error](err); ok {
		got, text = p.Code, p.Detail
	}
	if got != code || (detail != "" && text != detail) {
		t.Fatalf("%v: %s «%s», want %s «%s»", err, got, text, code, detail)
	}
}

// wantReason requires a 409 invalid_transition with reason.
func wantReason(t *testing.T, err error, reason string) {
	t.Helper()
	f, ok := asFailure(err)
	if !ok || f.code != codeTransition || f.reason != reason {
		t.Fatalf("%v (%+v), want invalid_transition %s", err, f, reason)
	}
}

// wantField requires a 422 validation_failed with a violation of field (and the reason when not empty).
func wantField(t *testing.T, err error, field, reason string) {
	t.Helper()
	f, ok := asFailure(err)
	if !ok || f.code != codeValidation || !slices.ContainsFunc(f.violations, func(v violation) bool { return v.field == field }) {
		t.Fatalf("%v (%+v), want validation_failed on %s", err, f, field)
	}
	if reason != "" && f.reason != reason {
		t.Fatalf("reason %q, want %q", f.reason, reason)
	}
}

// ---- rows of the tests (the superuser writes what the later steps of stage 6 will write) ----

type seedOpts struct {
	status  string
	foreman *uuid.UUID
	unit    string
	lead    *uuid.UUID
	due     string
}

// project writes an object and returns its id.
func project(t *testing.T, name string, o seedOpts) uuid.UUID {
	t.Helper()
	if o.status == "" {
		o.status = "active"
	}
	if o.unit == "" {
		o.unit = "msk1"
	}
	id := uuid.New()
	var due any
	if o.due != "" {
		due = o.due
	}
	handed := any(nil)
	if o.status == "handed_over" {
		handed = "2026-10-01"
	}
	if _, err := superA.Exec(t.Context(), `insert into repairs.projects (id, org_unit_id, name, address, status, foreman_id, lead_task_id, due_on,
		handed_over_on, stage) values ($1, $2, $3, 'ул. Лесная, 1', $4, $5, $6, $7, $8, 'Подготовка')`,
		id, unit(o.unit), name, o.status, o.foreman, o.lead, due, handed); err != nil {
		t.Fatal(err)
	}
	return id
}

func work(t *testing.T, projectID uuid.UUID, name, unit string, plan, fact string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := superA.Exec(t.Context(), `insert into repairs.works (id, project_id, name, unit, plan_qty, fact_qty) values ($1, $2, $3, $4, $5, $6)`,
		id, projectID, name, unit, plan, fact); err != nil {
		t.Fatal(err)
	}
	return id
}

func crew(t *testing.T, projectID uuid.UUID, name string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := superA.Exec(t.Context(), `insert into repairs.workers (id, project_id, display_name, trade) values ($1, $2, $3, 'Маляр')`,
		id, projectID, name); err != nil {
		t.Fatal(err)
	}
	return id
}

func count(t *testing.T, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := superA.QueryRow(t.Context(), sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}
