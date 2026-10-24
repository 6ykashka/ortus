//go:build integration

package fleet_test

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	dataapi "github.com/ortus/ortus-crm/backend/internal/api/data"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: clock of the suites
)

// files is the object storage of the export files in the tests: presigned links name the key, deletions are kept.
type files struct {
	mu      sync.Mutex
	deleted []string
	fail    error // the error of Delete
}

func (f *files) PresignGet(key, fileName string, ttl time.Duration) (string, error) {
	return "https://storage.test.invalid/" + key + "?name=" + fileName + "&ttl=" + ttl.String(), nil
}

func (f *files) Delete(_ context.Context, key string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.fail != nil {
		return f.fail
	}
	f.deleted = append(f.deleted, key)
	return nil
}

func (f *files) gone() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.deleted)
}

// withFiles gives the service of e the storage f.
func (e env) withFiles(f *files) env {
	e.svc.Files = f
	return e
}

// startJob starts an export of set as actor with the spec raw (a DatasetExportJobCreate).
func (e env) startJob(t *testing.T, actor, set, raw string) (dataapi.CreateDatasetExportJobResponseObject, error) {
	t.Helper()
	var b dataapi.DatasetExportJobCreate
	if err := json.Unmarshal([]byte(raw), &b); err != nil {
		t.Fatalf("%s: %v", raw, err)
	}
	return e.srv().CreateDatasetExportJob(e.ctx(t, actor, "a"), dataapi.CreateDatasetExportJobRequestObject{
		DatasetId: set, Body: &b, Params: dataapi.CreateDatasetExportJobParams{IdempotencyKey: "w450-" + uuid.NewString()},
	})
}

// job starts an export as startJob does and returns the queued job (202) or fails.
func (e env) job(t *testing.T, actor, set, raw string) dataapi.DatasetExportJob {
	t.Helper()
	res, err := e.startJob(t, actor, set, raw)
	if err != nil {
		t.Fatalf("createDatasetExportJob: %v", err)
	}
	r, ok := res.(dataapi.CreateDatasetExportJob202JSONResponse)
	if !ok {
		t.Fatalf("createDatasetExportJob: %#v, want 202", res)
	}
	if r.Headers.ETag == nil || *r.Headers.ETag != `"1"` || r.Headers.CacheControl == nil || *r.Headers.CacheControl != "private, no-store" {
		t.Fatalf("headers %+v", r.Headers)
	}
	t.Cleanup(func() { finish(t, r.Body.Id) })
	return r.Body
}

// finish ends a job of the tests (failed): the next test of the same member is not limited by it.
func finish(t *testing.T, id uuid.UUID) {
	t.Helper()
	if _, err := dbs["a"].ExecContext(context.WithoutCancel(t.Context()), `update data.export_jobs
		set state = 'failed', failure_code = 'internal', revoke_reason = null, revoked_at = null
		where id = $1 and state in ('queued', 'running')`, id); err != nil {
		t.Errorf("finish job %s: %v", id, err)
	}
}

// ready makes a queued job ready as the worker does: 3 rows, a file key, kept until expires.
func ready(t *testing.T, id uuid.UUID, expires time.Time) {
	t.Helper()
	now := harness.Now()
	if _, err := dbs["a"].ExecContext(t.Context(), `update data.export_jobs set state = 'ready', started_at = $2, snapshot_at = $2,
		row_count = 3, truncated = false, file_name = dataset_name || '-2026-10-01.csv', object_key = 'exports/test/' || id || '.csv',
		size_bytes = 120, finished_at = $2, expires_at = $3, revision = revision + 1 where id = $1`, id, now, expires); err != nil {
		t.Fatal(err)
	}
}

// getJob reads a job as actor.
func (e env) getJob(t *testing.T, actor string, id uuid.UUID) (dataapi.DatasetExportJob, error) {
	t.Helper()
	res, err := e.srv().GetDatasetExportJob(e.ctx(t, actor, "a"), dataapi.GetDatasetExportJobRequestObject{ExportJobId: id})
	if err != nil {
		return dataapi.DatasetExportJob{}, err
	}
	r, ok := res.(dataapi.GetDatasetExportJob200JSONResponse)
	if !ok {
		t.Fatalf("getDatasetExportJob: %#v", res)
	}
	return r.Body, nil
}

// journal lists the jobs actor sees with the parameters p.
func (e env) journal(t *testing.T, actor string, p dataapi.ListDatasetExportJobsParams) dataapi.DatasetExportJobPage {
	t.Helper()
	res, err := e.srv().ListDatasetExportJobs(e.ctx(t, actor, "a"), dataapi.ListDatasetExportJobsRequestObject{Params: p})
	if err != nil {
		t.Fatalf("listDatasetExportJobs: %v", err)
	}
	r, ok := res.(dataapi.ListDatasetExportJobs200JSONResponse)
	if !ok {
		t.Fatalf("listDatasetExportJobs: %#v", res)
	}
	return r.Body
}

func jobIDs(p dataapi.DatasetExportJobPage) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(p.Items))
	for _, j := range p.Items {
		out = append(out, j.Id)
	}
	return out
}

// download asks the link to the file of a job as actor.
func (e env) download(t *testing.T, actor string, id uuid.UUID) (dataapi.DatasetExportDownload, error) {
	t.Helper()
	res, err := e.srv().GetDatasetExportDownload(e.ctx(t, actor, "a"), dataapi.GetDatasetExportDownloadRequestObject{ExportJobId: id})
	if err != nil {
		return dataapi.DatasetExportDownload{}, err
	}
	r, ok := res.(dataapi.GetDatasetExportDownload200JSONResponse)
	if !ok || r.Headers.CacheControl == nil || *r.Headers.CacheControl != "private, no-store" {
		t.Fatalf("getDatasetExportDownload: %#v", res)
	}
	return r.Body, nil
}

// revoke stops or revokes a job as actor with If-Match ifMatch.
func (e env) revoke(t *testing.T, actor string, id uuid.UUID, ifMatch string) (dataapi.DatasetExportJob, error) {
	t.Helper()
	res, err := e.srv().RevokeDatasetExportJob(e.ctx(t, actor, "a"), dataapi.RevokeDatasetExportJobRequestObject{
		ExportJobId: id, Params: dataapi.RevokeDatasetExportJobParams{IdempotencyKey: "w450-" + uuid.NewString(), IfMatch: ifMatch},
	})
	if err != nil {
		return dataapi.DatasetExportJob{}, err
	}
	r, ok := res.(dataapi.RevokeDatasetExportJob200JSONResponse)
	if !ok {
		t.Fatalf("revokeDatasetExportJob: %#v", res)
	}
	return r.Body, nil
}

// wantDetail fails unless err is the Problem code with the detail.
func wantDetail(t *testing.T, err error, code, detail string) {
	t.Helper()
	pe, ok := errors.AsType[*problem.Error](err)
	if !ok {
		wantCode(t, err, code)
		return
	}
	if pe.Code != code || pe.Detail != detail {
		t.Fatalf("error %s %q, want %s %q", pe.Code, pe.Detail, code, detail)
	}
}

const vehiclesSpec = `{"select": ["displayName", "registrationNumber"], "filters": [], "search": "газ", "sort": [{"fieldKey": "registrationNumber", "direction": "asc"}]}`

// 07-ux-and-data §3 (W4.06): createDatasetExportJob fixes the spec, the column labels, the versions, the time zone and
// the author and answers 202 with the queued job; the journal — the own jobs of a member, the owner — all.
func TestExportJobIsQueued(t *testing.T) {
	t.Parallel()
	e := newEnv(t, "active").exporting("a.manager-msk1", "a.manager-msk2")
	j := e.job(t, "a.manager-msk1", vehiclesSet, vehiclesSpec)
	wantQueued(t, j)
	other := e.job(t, "a.manager-msk2", vehiclesSet, `{"select": ["displayName"], "filters": [], "sort": []}`)
	if ids := jobIDs(e.journal(t, "a.manager-msk1", dataapi.ListDatasetExportJobsParams{})); !slices.Contains(ids, j.Id) || slices.Contains(ids, other.Id) {
		t.Fatalf("the journal of the author %v", ids)
	}
	all := jobIDs(e.journal(t, "a.owner", dataapi.ListDatasetExportJobsParams{}))
	if !slices.Contains(all, j.Id) || !slices.Contains(all, other.Id) || slices.Index(all, other.Id) > slices.Index(all, j.Id) {
		t.Fatalf("the journal of the owner %v: both jobs, newest first", all)
	}
	if _, err := e.getJob(t, "a.manager-msk2", j.Id); !problem.Is(err, problem.CodeNotFound) {
		t.Fatalf("the job of another member: %v, want 404", err)
	}
	if got, err := e.getJob(t, "a.owner", j.Id); err != nil || got.Id != j.Id {
		t.Fatalf("the owner reads any job: %+v, %v", got, err)
	}
	var count int
	if err := dbs["a"].QueryRowContext(t.Context(), `select count(*) from audit.events where action = 'data.export.requested'
		and target_id = $1 and diff->>'datasetId' = 'fleet.vehicles'`, j.Id).Scan(&count); err != nil || count != 1 {
		t.Fatalf("audit data.export.requested: %d, %v", count, err)
	}
}

// wantQueued checks the queued job of vehiclesSpec of a.manager-msk1.
func wantQueued(t *testing.T, j dataapi.DatasetExportJob) {
	t.Helper()
	if j.State != dataapi.DatasetExportJobStateQueued || j.DatasetId != vehiclesSet || j.DatasetName != "Автомобили" ||
		!slices.Equal(j.ColumnLabels, []string{"Машина", "Номер"}) || j.TimeZone != "Europe/Moscow" || j.RowLimit != 100000 {
		t.Fatalf("job %+v", j)
	}
	if j.RequestedByMemberId != person("a.manager-msk1", "a") || j.RequestedByDisplayName != "Менеджер Москва-1" ||
		j.Revision != 1 || j.SnapshotAt != nil || j.RowCount != nil || j.FileName != nil {
		t.Fatalf("author and progress of the job %+v", j)
	}
	wantVehiclesSpec(t, j.Spec)
}

// wantVehiclesSpec checks the spec of a job of vehiclesSpec.
func wantVehiclesSpec(t *testing.T, s dataapi.DatasetExportCreate) {
	t.Helper()
	if s.Search == nil || *s.Search != "газ" || !slices.Equal(s.Select, []string{"displayName", "registrationNumber"}) || len(s.Sort) != 1 {
		t.Fatalf("spec %+v", s)
	}
}

// limiter is the member of TestExportJobChecks: no other test of the package starts exports of him, so his queued or
// running jobs are the test's own and the limit of 3 is reached by the test alone. W2.83: with a.manager-msk1 the
// parallel tests of the package (TestExportJobIsQueued, TestExportJobDownload, TestExportJobRevoke) held jobs of the
// same member in the same database and the third own job already got 429. a.two-roles manages Москва-1 as
// a.manager-msk1 does (and observes Самара-2).
const limiter = "a.two-roles"

// activeJobs counts the queued or running jobs of actor in tenant a — what the limit of createDatasetExportJob counts.
func activeJobs(t *testing.T, actor string) int {
	t.Helper()
	var n int
	if err := dbs["a"].QueryRowContext(t.Context(), `select count(*) from data.export_jobs where requested_by = $1
		and state in ('queued', 'running')`, person(actor, "a")).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// The checks of createDatasetExportJob: data.export (403), the dataset (404), the fields as queryDataset (422), the view
// of the job (404 for a view the member does not see) and at most 3 queued or running jobs of a member (429).
func TestExportJobChecks(t *testing.T) {
	t.Parallel()
	e := newEnv(t, "active").exporting(limiter, "a.region-msk")
	_, err := newEnv(t, "active").startJob(t, limiter, tripsSet, `{"select": ["trip"], "filters": [], "sort": []}`)
	wantCode(t, err, problem.CodeForbiddenAction)
	_, err = e.startJob(t, limiter, "fleet.unknown", `{"select": ["trip"], "filters": [], "sort": []}`)
	wantCode(t, err, problem.CodeNotFound)
	res, err := e.startJob(t, limiter, tripsSet, `{"select": ["trip", "earnings"], "filters": [], "sort": []}`)
	if err != nil {
		t.Fatal(err)
	}
	if v := violationOf(t, res); v.Field != "select[1]" || v.Code != "unknown_field" {
		t.Fatalf("hidden field %+v", v)
	}
	// The views stay in the world after the test: a name of the run lets -count repeat the test.
	run := uuid.NewString()[:8]
	theirs := e.view(t, "a.region-msk", tripsSet, uniq(t, "Чужой вид "+run), false, `{"filters": [], "sort": []}`)
	_, err = e.startJob(t, limiter, tripsSet, `{"select": ["trip"], "filters": [], "sort": [], "viewId": "`+theirs.Id.String()+`"}`)
	wantCode(t, err, problem.CodeNotFound)
	if n := activeJobs(t, limiter); n != 0 {
		t.Fatalf("%s has %d queued or running jobs of other tests: the limit needs a member of its own", limiter, n)
	}
	mine := e.view(t, limiter, tripsSet, uniq(t, "Свой вид "+run), false, `{"filters": [], "sort": []}`)
	j := e.job(t, limiter, tripsSet, `{"select": ["trip"], "filters": [], "sort": [], "viewId": "`+mine.Id.String()+`"}`)
	if j.ViewId == nil || *j.ViewId != mine.Id {
		t.Fatalf("view of the job %+v", j.ViewId)
	}
	e.job(t, limiter, tripsSet, `{"select": ["trip"], "filters": [], "sort": []}`)
	e.job(t, limiter, tripsSet, `{"select": ["trip"], "filters": [], "sort": []}`)
	_, err = e.startJob(t, limiter, tripsSet, `{"select": ["trip"], "filters": [], "sort": []}`)
	wantDetail(t, err, "rate_limited", "Дождитесь завершения начатых выгрузок.")
	// Another member is not limited by the jobs of the first.
	e.job(t, "a.region-msk", tripsSet, `{"select": ["trip"], "filters": [], "sort": []}`)
}

// getDatasetExportDownload: only the author; a job not ready — 409; a ready one — a link of 5 minutes and the audit;
// after expiresAt — expired and 409.
func TestExportJobDownload(t *testing.T) {
	t.Parallel()
	f := &files{}
	e := newEnv(t, "active").exporting("a.manager-msk1").withFiles(f)
	j := e.job(t, "a.manager-msk1", vehiclesSet, vehiclesSpec)
	_, err := e.download(t, "a.manager-msk1", j.Id)
	wantDetail(t, err, "invalid_transition", "Выгрузка ещё не готова.")
	ready(t, j.Id, harness.Now().Add(24*time.Hour))
	_, err = e.download(t, "a.owner", j.Id)
	wantCode(t, err, problem.CodeNotFound)
	d, err := e.download(t, "a.manager-msk1", j.Id)
	if err != nil {
		t.Fatal(err)
	}
	if d.ExportJobId != j.Id || !strings.HasPrefix(d.DownloadUrl, "https://storage.test.invalid/exports/test/"+j.Id.String()+".csv?") ||
		!strings.Contains(d.DownloadUrl, "ttl=5m0s") || d.FileName != "Автомобили-2026-10-01.csv" || d.SizeBytes != 120 ||
		!d.ExpiresAt.Equal(harness.Now().Add(5*time.Minute)) {
		t.Fatalf("download %+v", d)
	}
	var count int
	if err := dbs["a"].QueryRowContext(t.Context(), `select count(*) from audit.events where action = 'data.export.downloaded' and target_id = $1`,
		j.Id).Scan(&count); err != nil || count != 1 {
		t.Fatalf("audit data.export.downloaded: %d, %v", count, err)
	}
	old := e.job(t, "a.manager-msk1", vehiclesSet, vehiclesSpec)
	ready(t, old.Id, harness.Now().Add(-time.Minute))
	got, err := e.getJob(t, "a.manager-msk1", old.Id)
	if err != nil || got.State != dataapi.DatasetExportJobStateExpired {
		t.Fatalf("a job past expiresAt: %+v, %v", got, err)
	}
	e.wantExpired(t, "a.manager-msk1", old.Id, j.Id)
	_, err = e.download(t, "a.manager-msk1", old.Id)
	wantDetail(t, err, "invalid_transition", "Выгрузка недоступна: срок хранения истёк или её отозвали.")
}

// wantExpired checks the journal of actor filtered by «expired»: the job old is there, the job live is not. The worker
// tests of the package leave expired jobs of the same member: every job of the filter is expired.
func (e env) wantExpired(t *testing.T, actor string, old, live uuid.UUID) {
	t.Helper()
	p := e.journal(t, actor, dataapi.ListDatasetExportJobsParams{State: &[]dataapi.ListDatasetExportJobsParamsState{"expired"}})
	if !slices.Contains(jobIDs(p), old) || slices.Contains(jobIDs(p), live) ||
		slices.ContainsFunc(p.Items, func(x dataapi.DatasetExportJob) bool { return x.State != dataapi.DatasetExportJobStateExpired }) {
		t.Fatalf("journal of expired jobs %v", jobIDs(p))
	}
}

// The rights are rechecked at every download: the author lost data.export — the job is revoked (permissions_changed),
// its file deleted, the answer 409.
func TestExportJobDownloadRevokesNarrowed(t *testing.T) {
	t.Parallel()
	f := &files{}
	e := newEnv(t, "active").exporting("a.manager-msk2").withFiles(f)
	j := e.job(t, "a.manager-msk2", vehiclesSet, vehiclesSpec)
	ready(t, j.Id, harness.Now().Add(24*time.Hour))
	narrowed := newEnv(t, "active").withFiles(f)
	_, err := narrowed.download(t, "a.manager-msk2", j.Id)
	wantDetail(t, err, "invalid_transition", "Права изменились — выгрузка отозвана. Запустите её снова.")
	got, err := e.getJob(t, "a.manager-msk2", j.Id)
	if err != nil || got.State != dataapi.DatasetExportJobStateRevoked || got.RevokeReason == nil ||
		*got.RevokeReason != dataapi.PermissionsChanged || got.RevokedAt == nil {
		t.Fatalf("revoked job %+v, %v", got, err)
	}
	if !slices.Contains(f.gone(), "exports/test/"+j.Id.String()+".csv") {
		t.Fatalf("the file is kept: deleted %v", f.gone())
	}
}

// revokeDatasetExportJob: the author (author) or the owner (owner) by If-Match; another member — 404; a finished job —
// 409; the file of a ready job is deleted.
func TestExportJobRevoke(t *testing.T) {
	t.Parallel()
	f := &files{}
	e := newEnv(t, "active").exporting("a.manager-msk1", "a.region-msk").withFiles(f)
	j := e.job(t, "a.manager-msk1", vehiclesSet, vehiclesSpec)
	_, err := e.revoke(t, "a.region-msk", j.Id, `"1"`)
	wantCode(t, err, problem.CodeNotFound)
	_, err = e.revoke(t, "a.manager-msk1", j.Id, `"2"`)
	wantCode(t, err, "revision_mismatch")
	got, err := e.revoke(t, "a.manager-msk1", j.Id, `"1"`)
	if err != nil || got.State != dataapi.DatasetExportJobStateRevoked || got.RevokeReason == nil ||
		*got.RevokeReason != dataapi.Author || got.Revision != 2 {
		t.Fatalf("revoked by the author %+v, %v", got, err)
	}
	_, err = e.revoke(t, "a.manager-msk1", j.Id, `"2"`)
	wantDetail(t, err, "invalid_transition", "Выгрузка уже завершена.")
	r := e.job(t, "a.region-msk", vehiclesSet, vehiclesSpec)
	ready(t, r.Id, harness.Now().Add(24*time.Hour))
	got, err = e.revoke(t, "a.owner", r.Id, `"2"`)
	if err != nil || got.RevokeReason == nil || *got.RevokeReason != dataapi.Owner {
		t.Fatalf("revoked by the owner %+v, %v", got, err)
	}
	if !slices.Contains(f.gone(), "exports/test/"+r.Id.String()+".csv") {
		t.Fatalf("the file of the revoked job is kept: %v", f.gone())
	}
	if _, err := e.download(t, "a.region-msk", r.Id); !problem.Is(err, "invalid_transition") {
		t.Fatalf("download of a revoked job: %v", err)
	}
}
