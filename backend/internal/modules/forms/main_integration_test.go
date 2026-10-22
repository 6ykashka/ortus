//go:build integration

package forms

import (
	"context"
	"fmt"
	"os"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"              //nolint:depguard // integration test: role names of the test cluster
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"  //nolint:depguard // integration test: the superuser that writes the data of the tests
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: clock and PostgreSQL of the suites
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04
)

// The world of the package: the isolation fixtures of W1.04 and, in tenant A, the roles of the forms — «Формы:
// настраивать» (every key of core.forms) of a.region-msk over Москва with its firms, «Формы: ответы» (read, the
// responses read and reviewed) of a.manager-msk2 in Москва-2 and «Формы: отвечать» (forms.read) of a.driver-msk1 in
// Москва-1 — and the service wired like cmd/api with fakes of the ports of tasks, the knowledge base, the CRM objects
// and the public links (their real adapters are tested in their packages and in cmd/api). Every test makes its own
// forms (names unique by test).
var (
	world   *fixtures.World
	superA  *pgxpool.Pool // tenant DB of A as the superuser
	control *pgxpool.Pool // control DB as ortus_api
	pools   *tenantctx.Pools
	dir     *tenantctx.PGDirectory
	ev      *authz.Evaluator
	tasks   = &fakeTasks{}
	kb      = &fakeKB{}
	objects = &fakeObjects{labels: map[fapi.ObjectRef]string{}}
	links   = &fakeLinks{rows: map[string]Link{}}
	uploads = &fakeUploads{}
	purge   = &fakePurge{records: map[uuid.UUID][]string{}, files: map[uuid.UUID][]uuid.UUID{}, left: map[uuid.UUID]int{}}
)

// Roles of the forms of tenant A.
var (
	roleFormsAll    = uuid.New()
	roleFormsReview = uuid.New()
	roleFormsAnswer = uuid.New()
	allFormsActions = []string{actRead, actCreate, actManage, actPublish, actPublishPublic, actRespRead, actRespReview, actRespAssign}
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
	if world, err = fixtures.Load(ctx, c, "forms", harness.Now()); err != nil {
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
	src := authz.PGSource{Pools: pools}
	ev = authz.New(src, src, clock)
	if err := formsRoles(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "roles:", err)
		return 1
	}
	return m.Run()
}

// formsRoles writes the roles of the forms of tenant A and their assignments.
func formsRoles(ctx context.Context) error {
	for _, r := range []struct {
		id      uuid.UUID
		name    string
		actions []string
	}{
		{roleFormsAll, "Формы: настраивать", allFormsActions},
		{roleFormsReview, "Формы: ответы", []string{actRead, actRespRead, actRespReview}},
		{roleFormsAnswer, "Формы: отвечать", []string{actRead}},
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
		unit  string
	}{
		{"a.region-msk", roleFormsAll, "msk"}, {"a.manager-msk2", roleFormsReview, "msk2"}, {"a.driver-msk1", roleFormsAnswer, "msk1"},
		{"a.manager-msk1", roleFormsAll, "msk1"},
	} {
		if _, err := superA.Exec(ctx, `insert into access.role_assignments (principal_kind, principal_id, role_id, role_version,
			scope_kind, scope_ref, include_descendants, valid, granted_by) values ('person', $1, $2, 1, 'unit', $3, true,
			tstzrange($4::timestamptz, null), $5)`, person(g.actor), g.role, unit(g.unit), harness.Now().Add(-time.Hour),
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

// linkKey is the key of the public links of the tests (32 bytes).
var linkKey = []byte("0123456789abcdef0123456789abcdef")

// service is the module wired like cmd/api with the fakes of the ports.
func service() *Service {
	return &Service{Pools: pools, Directory: ControlDirectory{DB: control}, Tasks: tasks, Knowledge: kb, Objects: objects,
		Links: links, Uploads: uploads, Keys: Keys{Current: 1, ByVer: map[int][]byte{1: linkKey}}, Audience: inbox.AuthzAudience{E: ev},
		Purge: purge, Now: clock}
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

// wantCode requires the Problem.code and, when detail is not empty, the detail of err.
func wantCode(t *testing.T, err error, code, detail string) {
	t.Helper()
	if err == nil {
		t.Fatalf("no error, want %s «%s»", code, detail)
	}
	got, text := codeOf(err), detailOf(err)
	if got != code || (detail != "" && text != detail) {
		t.Fatalf("%v: %s «%s», want %s «%s»", err, got, text, code, detail)
	}
}

// wantReason requires a 409 invalid_transition with reason.
func wantReason(t *testing.T, err error, reason, detail string) {
	t.Helper()
	f, ok := asFailure(err)
	if !ok || f.code != codeTransition || f.reason != reason || (detail != "" && f.detail != detail) {
		t.Fatalf("%v (%+v), want invalid_transition %s «%s»", err, f, reason, detail)
	}
}

// wantField requires a 422 validation_failed with a violation of field with code and message.
func wantField(t *testing.T, err error, field, code, message string) {
	t.Helper()
	f, ok := asFailure(err)
	if !ok || f.code != codeValidation {
		t.Fatalf("%v, want validation_failed %s «%s»", err, field, message)
	}
	if !slices.Contains(f.violations, violation{field, code, message}) {
		t.Fatalf("violations %+v, want %s %s «%s»", f.violations, field, code, message)
	}
}

func codeOf(err error) string {
	if f, ok := asFailure(err); ok {
		return f.code
	}
	if p, ok := asProblem(err); ok {
		return p.Code
	}
	return ""
}

func detailOf(err error) string {
	if f, ok := asFailure(err); ok {
		return f.detail
	}
	if p, ok := asProblem(err); ok {
		return p.Detail
	}
	return ""
}

// count is the number the query of the superuser of tenant A answers.
func count(t *testing.T, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := superA.QueryRow(t.Context(), sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func rev(r int64) string { return etag(r) }

// ---- fakes of the ports ----

// fakeTasks creates the tasks of rules in memory: the projects in may accept the authors in may; a refusal — refuse.
type fakeTasks struct {
	mu      sync.Mutex
	created []FormTask
	may     map[uuid.UUID]bool // project → the members may create (any member when true for uuid.Nil)
	refuse  string
}

func (f *fakeTasks) CreateFormTask(_ context.Context, _ pgx.Tx, _ uuid.UUID, t FormTask) (TaskResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.refuse != "" {
		return TaskResult{Refused: f.refuse}, nil
	}
	f.created = append(f.created, t)
	return TaskResult{ID: uuid.New(), Key: fmt.Sprintf("LOG-%d", 100+len(f.created)), Status: "К выполнению", Assigned: "Исполнитель"}, nil
}

func (f *fakeTasks) MayCreate(_ context.Context, _ pgx.Tx, _, _ uuid.UUID, _ bool, project uuid.UUID) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.may[project], nil
}

func (f *fakeTasks) Keys(_ context.Context, _ pgx.Tx, _ uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]string, error) {
	out := map[uuid.UUID]string{}
	for _, id := range ids {
		out[id] = "LOG-1"
	}
	return out, nil
}

func (f *fakeTasks) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.created)
}

// fakeKB is the knowledge base of the tests: nodes by id, the records written; refuse — the refusal of a write.
type fakeKB struct {
	mu      sync.Mutex
	nodes   map[uuid.UUID]KBNode
	hidden  map[uuid.UUID]bool // nodes the viewers do not see
	written []KBRecord
	refuse  string
}

func (f *fakeKB) Nodes(_ context.Context, _ pgx.Tx, _ uuid.UUID, _ Viewer, ids []uuid.UUID) (map[uuid.UUID]KBNode, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[uuid.UUID]KBNode{}
	for _, id := range ids {
		if n, ok := f.nodes[id]; ok {
			n.Visible = !f.hidden[id]
			out[id] = n
		}
	}
	return out, nil
}

func (f *fakeKB) Write(_ context.Context, _ pgx.Tx, _ uuid.UUID, rec KBRecord) (KBResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.refuse != "" {
		return KBResult{Refused: f.refuse}, nil
	}
	f.written = append(f.written, rec)
	n := f.nodes[rec.Node]
	if rec.Table == uuid.Nil {
		return KBResult{Text: "Запись на странице «" + n.Title + "»"}, nil
	}
	return KBResult{Text: "Строка в таблице «Осмотры» · страница «" + n.Title + "»"}, nil
}

func (f *fakeKB) writes() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.written)
}

// fakeObjects answers the CRM objects the members see: labels by ref (the same for everyone).
type fakeObjects struct {
	mu     sync.Mutex
	labels map[fapi.ObjectRef]string
}

func (f *fakeObjects) Options(_ context.Context, _ tenantctx.TenantContext, kind, q string) ([]fapi.FormFieldOption, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []fapi.FormFieldOption
	for ref, label := range f.labels {
		if refKinds[fapi.FormQuestionRefKind(kind)][1] == ref.EntityType && (q == "" || contains(label, q)) {
			out = append(out, fapi.FormFieldOption{Ref: ref, Label: label})
		}
	}
	return out, nil
}

func (f *fakeObjects) Labels(_ context.Context, _ tenantctx.TenantContext, refs []fapi.ObjectRef) (map[fapi.ObjectRef]string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[fapi.ObjectRef]string{}
	for _, r := range refs {
		if l, ok := f.labels[r]; ok {
			out[r] = l
		}
	}
	return out, nil
}

// Missing: the objects of the fake all exist.
func (f *fakeObjects) Missing(context.Context, tenantctx.TenantContext, []fapi.ObjectRef) ([]fapi.ObjectRef, error) {
	return nil, nil
}

func (f *fakeObjects) set(ref fapi.ObjectRef, label string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.labels[ref] = label
}

// fakeLinks is the control index in memory.
type fakeLinks struct {
	mu   sync.Mutex
	rows map[string]Link
}

func (f *fakeLinks) Issue(_ context.Context, l Link) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	l.TenantName = "Холдинг"
	f.rows[l.Digest] = l
	return nil
}

func (f *fakeLinks) Drop(_ context.Context, digest string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.rows, digest)
	return nil
}

func (f *fakeLinks) Find(_ context.Context, digest string) (Link, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	l, ok := f.rows[digest]
	return l, ok, nil
}

// fakePurge records what «Хранить ответы» deletes outside the module (the real ports — knowledge/forms_port.go,
// files/forms_port.go, cmd/worker): the numbers of the responses of a form whose rows and records of the knowledge base
// go, the files of their answers, and how many responses of the form were left when the bytes were removed — after the
// commit.
type fakePurge struct {
	mu      sync.Mutex
	records map[uuid.UUID][]string
	files   map[uuid.UUID][]uuid.UUID
	left    map[uuid.UUID]int
}

func (f *fakePurge) FormRecords(_ context.Context, _ pgx.Tx, form uuid.UUID, numbers []string) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.records[form] = append(f.records[form], numbers...)
	return len(numbers), nil
}

func (f *fakePurge) FormFiles(_ context.Context, _ pgx.Tx, _, form uuid.UUID, ids []uuid.UUID) (func(context.Context) error, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.files[form] = append(f.files[form], ids...)
	return func(ctx context.Context) error {
		var n int
		if err := superA.QueryRow(ctx, `select count(*) from forms.responses where form_id = $1`, form).Scan(&n); err != nil {
			return err
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		f.left[form] = n
		return nil
	}, nil
}

// of is what the purge got for form: the numbers, the files and the responses left after the commit (-1 — never).
func (f *fakePurge) of(form uuid.UUID) ([]string, []uuid.UUID, int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	left, ok := f.left[form]
	if !ok {
		left = -1
	}
	return slices.Clone(f.records[form]), slices.Clone(f.files[form]), left
}

// fakeUploads records the uploads of guests (the module of files is tested in cmd/api).
type fakeUploads struct {
	mu    sync.Mutex
	files []uuid.UUID
}

func (f *fakeUploads) Initiate(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, Upload) (pfTicket, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	id := uuid.New()
	f.files = append(f.files, id)
	return pfTicket{UploadId: uuid.New(), FileId: id, Method: "PUT"}, nil
}

func (f *fakeUploads) Complete(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, string) (pfFile, error) {
	return pfFile{Status: "scanning"}, nil
}

func (f *fakeUploads) Status(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (pfFile, error) {
	return pfFile{Status: "ready"}, nil
}
