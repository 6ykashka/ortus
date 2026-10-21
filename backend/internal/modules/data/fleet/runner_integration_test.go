//go:build integration

package fleet_test

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	dataapi "github.com/ortus/ortus-crm/backend/internal/api/data"
	"github.com/ortus/ortus-crm/backend/internal/modules/data"      //nolint:depguard // the worker of the export jobs (W4.50)
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/csv" //nolint:depguard // the CSV of exportDataset (W2.50) the worker writes
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: clock of the suites
)

// W4.50 (07-ux-and-data §3): the worker of the export jobs. The tests of the worker are not parallel: Runner.Once takes
// every queued job of the tenant, and the parallel tests of the package keep theirs queued (Go runs the sequential
// top-level tests before it releases the parallel ones).

// bucket is the object storage of the worker in the tests.
type bucket struct {
	mu      sync.Mutex
	objects map[string][]byte
	types   map[string]string
	deleted []string
}

func newBucket() *bucket { return &bucket{objects: map[string][]byte{}, types: map[string]string{}} }

func (b *bucket) Upload(_ context.Context, key, contentType string, body []byte) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.objects[key], b.types[key] = append([]byte(nil), body...), contentType
	return nil
}

func (b *bucket) Delete(_ context.Context, key string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	delete(b.objects, key)
	b.deleted = append(b.deleted, key)
	return nil
}

func (b *bucket) object(key string) ([]byte, string, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	o, ok := b.objects[key]
	return o, b.types[key], ok
}

// members are the active memberships of the tests by person.
type members map[uuid.UUID]tenantctx.TenantContext

func (m members) Member(_ context.Context, tenantID, personID uuid.UUID) (tenantctx.TenantContext, bool, error) {
	tc, ok := m[personID]
	if !ok || tc.TenantID != tenantID {
		return tenantctx.TenantContext{}, false, nil
	}
	return tc, true, nil
}

// runner is the worker over the service of e with the active members actors of tenant a and the storage b (nil — none).
func (e env) runner(t *testing.T, b *bucket, actors ...string) *data.Runner {
	t.Helper()
	m := members{}
	for _, a := range actors {
		tc := e.tc(t, a, "a")
		m[tc.PersonID] = tc
	}
	r := &data.Runner{S: e.svc, Members: m, Format: csv.File, Log: slog.New(slog.DiscardHandler)}
	if b != nil {
		r.Store = b
	}
	return r
}

// tenantA is the id of tenant a.
func (e env) tenantA(t *testing.T) uuid.UUID {
	t.Helper()
	return e.tc(t, "a.owner", "a").TenantID
}

// once runs the worker over tenant a once.
func (e env) once(t *testing.T, r *data.Runner) data.RunResult {
	t.Helper()
	res, err := r.Once(t.Context(), e.tenantA(t))
	if err != nil {
		t.Fatalf("Runner.Once: %v", err)
	}
	return res
}

// vehicleRows is the number of the vehicles of tenant a the member sees.
func (e env) vehicleRows(t *testing.T, actor string) int64 {
	t.Helper()
	count := true
	res, err := e.srv().QueryDataset(e.ctx(t, actor, "a"), dataapi.QueryDatasetRequestObject{DatasetId: vehiclesSet, Body: &dataapi.DatasetQuery{
		Select: []string{"displayName"}, Filters: []dataapi.QueryFilter{}, Sort: []dataapi.QuerySort{}, Limit: 1, IncludeCount: &count,
	}})
	if err != nil {
		t.Fatal(err)
	}
	r, ok := res.(dataapi.QueryDataset200JSONResponse)
	if !ok || r.Body.VisibleCount == nil {
		t.Fatalf("queryDataset %#v", res)
	}
	return *r.Body.VisibleCount
}

const plainVehicles = `{"select": ["displayName", "registrationNumber"], "filters": [], "sort": [{"fieldKey": "registrationNumber", "direction": "asc"}]}`

// The worker takes a queued job, rechecks the rights of its author and writes the CSV of exportDataset with a BOM to
// exports/<tenant>/<job>.csv: the job is ready with its snapshot, rows, file name and size for 24 hours.
//
//nolint:paralleltest // Runner.Once takes every queued job of tenant a
func TestRunnerMakesJobReady(t *testing.T) {
	e := newEnv(t, "active").exporting("a.manager-msk1")
	b := newBucket()
	j := e.job(t, "a.manager-msk1", vehiclesSet, plainVehicles)
	if res := e.once(t, e.runner(t, b, "a.manager-msk1")); res.Ready < 1 {
		t.Fatalf("result %+v, want the job ready", res)
	}
	got, err := e.getJob(t, "a.manager-msk1", j.Id)
	if err != nil || got.State != dataapi.DatasetExportJobStateReady {
		t.Fatalf("job %+v, %v", got, err)
	}
	want := e.vehicleRows(t, "a.manager-msk1")
	wantReady(t, got, want)
	body, typ, ok := b.object(data.ExportKey(e.tenantA(t), j.Id))
	if !ok || typ != "text/csv; charset=utf-8" || got.SizeBytes == nil || *got.SizeBytes != int64(len(body)) {
		t.Fatalf("file %q %s %v, size %v", body, typ, ok, got.SizeBytes)
	}
	text := string(body)
	if !strings.HasPrefix(text, "\uFEFFМашина;Номер\r\n") || int64(strings.Count(text, "\r\n")) != want+1 {
		t.Fatalf("CSV %q, want a BOM, the header and %d rows", text, want)
	}
}

// wantReady checks a ready job of plainVehicles with rows rows, made at the clock of the suites.
func wantReady(t *testing.T, got dataapi.DatasetExportJob, rows int64) {
	t.Helper()
	now := harness.Now()
	moscow, err := time.LoadLocation("Europe/Moscow")
	if err != nil {
		t.Fatal(err)
	}
	name := "Автомобили-" + now.In(moscow).Format(time.DateOnly) + ".csv"
	if got.RowCount == nil || *got.RowCount != rows || got.Truncated == nil || *got.Truncated || got.FileName == nil || *got.FileName != name {
		t.Fatalf("ready job %+v (rows %d)", got, rows)
	}
	if got.SnapshotAt == nil || got.ExpiresAt == nil || !got.ExpiresAt.Equal(now.Add(24*time.Hour)) || got.Revision < 3 {
		t.Fatalf("times of the ready job %+v", got)
	}
}

// The row limit of the job: more rows — the file keeps rowLimit of them and the job is truncated.
//
//nolint:paralleltest // Runner.Once takes every queued job of tenant a
func TestRunnerTruncates(t *testing.T) {
	e := newEnv(t, "active").exporting("a.manager-msk1")
	b := newBucket()
	j := e.job(t, "a.manager-msk1", vehiclesSet, plainVehicles)
	if _, err := dbs["a"].ExecContext(t.Context(), `update data.export_jobs set row_limit = 1 where id = $1`, j.Id); err != nil {
		t.Fatal(err)
	}
	e.once(t, e.runner(t, b, "a.manager-msk1"))
	got, err := e.getJob(t, "a.manager-msk1", j.Id)
	if err != nil || got.State != dataapi.DatasetExportJobStateReady || got.RowCount == nil || *got.RowCount != 1 ||
		got.Truncated == nil || !*got.Truncated {
		t.Fatalf("truncated job %+v, %v", got, err)
	}
}

// The rights of the author are rechecked when the worker starts: he lost data.export or his membership — the job is
// revoked (permissions_changed); the module of the dataset is disabled — module_disabled; no file is written.
//
//nolint:paralleltest // Runner.Once takes every queued job of tenant a
func TestRunnerRevokesNarrowed(t *testing.T) {
	cases := []struct {
		name   string
		runner func(t *testing.T, b *bucket) *data.Runner
		reason dataapi.DatasetExportJobRevokeReason
	}{
		{"data.export lost", func(t *testing.T, b *bucket) *data.Runner {
			t.Helper()
			return newEnv(t, "active").runner(t, b, "a.manager-msk1")
		}, dataapi.PermissionsChanged},
		{"membership ended", func(t *testing.T, b *bucket) *data.Runner {
			t.Helper()
			return newEnv(t, "active").exporting("a.manager-msk1").runner(t, b)
		}, dataapi.PermissionsChanged},
		{"module disabled", func(t *testing.T, b *bucket) *data.Runner {
			t.Helper()
			return newEnv(t, "disabled").exporting("a.manager-msk1").runner(t, b, "a.manager-msk1")
		}, dataapi.ModuleDisabled},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			e := newEnv(t, "active").exporting("a.manager-msk1")
			b := newBucket()
			j := e.job(t, "a.manager-msk1", vehiclesSet, plainVehicles)
			if res := e.once(t, c.runner(t, b)); res.Revoked < 1 {
				t.Fatalf("result %+v, want the job revoked", res)
			}
			got, err := e.getJob(t, "a.manager-msk1", j.Id)
			if err != nil || got.State != dataapi.DatasetExportJobStateRevoked || got.RevokeReason == nil || *got.RevokeReason != c.reason {
				t.Fatalf("job %+v, %v, want revoked %s", got, err, c.reason)
			}
			if _, _, ok := b.object(data.ExportKey(e.tenantA(t), j.Id)); ok {
				t.Fatal("a file of a revoked job is written")
			}
		})
	}
}

// Возврат 1 W4.50: the rights of the author of a ready job are rechecked by the worker too — the gate of
// getDatasetExportDownload answers 403 to an author without data.export before the download rechecks the job, so the
// job would stay ready with its file. He lost data.export or his membership — the worker revokes the ready job
// (permissions_changed) and deletes its file; his rights hold — the job stays ready with its file.
//
//nolint:paralleltest // Runner.Once takes every queued job of tenant a
func TestRunnerRevokesReadyNarrowed(t *testing.T) {
	cases := []struct {
		name   string
		runner func(t *testing.T, b *bucket) *data.Runner
		reason dataapi.DatasetExportJobRevokeReason // "" — the job stays ready
	}{
		{"rights hold", func(t *testing.T, b *bucket) *data.Runner {
			t.Helper()
			return newEnv(t, "active").exporting("a.manager-msk1").runner(t, b, "a.manager-msk1")
		}, ""},
		{"data.export lost", func(t *testing.T, b *bucket) *data.Runner {
			t.Helper()
			return newEnv(t, "active").runner(t, b, "a.manager-msk1")
		}, dataapi.PermissionsChanged},
		{"membership ended", func(t *testing.T, b *bucket) *data.Runner {
			t.Helper()
			return newEnv(t, "active").exporting("a.manager-msk1").runner(t, b)
		}, dataapi.PermissionsChanged},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			e := newEnv(t, "active").exporting("a.manager-msk1")
			b := newBucket()
			j := e.job(t, "a.manager-msk1", vehiclesSet, plainVehicles)
			if res := e.once(t, e.runner(t, b, "a.manager-msk1")); res.Ready < 1 {
				t.Fatalf("result %+v, want the job ready", res)
			}
			res := e.once(t, c.runner(t, b))
			got, err := e.getJob(t, "a.manager-msk1", j.Id)
			if err != nil {
				t.Fatal(err)
			}
			_, _, kept := b.object(data.ExportKey(e.tenantA(t), j.Id))
			if c.reason == "" {
				if got.State != dataapi.DatasetExportJobStateReady || !kept {
					t.Fatalf("job %+v (file kept %v), want it ready with its file", got, kept)
				}
				return
			}
			if res.Revoked < 1 || got.State != dataapi.DatasetExportJobStateRevoked || got.RevokeReason == nil ||
				*got.RevokeReason != c.reason || kept {
				t.Fatalf("result %+v, job %+v (file kept %v), want it revoked %s without its file", res, got, kept, c.reason)
			}
		})
	}
}

// Without the object storage the job fails with source_unavailable (the code only, no details).
//
//nolint:paralleltest // Runner.Once takes every queued job of tenant a
func TestRunnerFailsWithoutStorage(t *testing.T) {
	e := newEnv(t, "active").exporting("a.manager-msk1")
	j := e.job(t, "a.manager-msk1", vehiclesSet, plainVehicles)
	if res := e.once(t, e.runner(t, nil, "a.manager-msk1")); res.Failed < 1 {
		t.Fatalf("result %+v, want the job failed", res)
	}
	got, err := e.getJob(t, "a.manager-msk1", j.Id)
	if err != nil || got.State != dataapi.DatasetExportJobStateFailed || got.FailureCode == nil || *got.FailureCode != dataapi.SourceUnavailable {
		t.Fatalf("job %+v, %v", got, err)
	}
}

// A ready job past expiresAt: the worker deletes its file and the job stays expired in the journal.
//
//nolint:paralleltest // Runner.Once takes every queued job of tenant a
func TestRunnerExpires(t *testing.T) {
	e := newEnv(t, "active").exporting("a.manager-msk1")
	b := newBucket()
	j := e.job(t, "a.manager-msk1", vehiclesSet, plainVehicles)
	ready(t, j.Id, harness.Now().Add(-time.Minute))
	if res := e.once(t, e.runner(t, b, "a.manager-msk1")); res.Expired < 1 {
		t.Fatalf("result %+v, want the job expired", res)
	}
	var state string
	var key *string
	if err := dbs["a"].QueryRowContext(t.Context(), `select state, object_key from data.export_jobs where id = $1`, j.Id).Scan(&state, &key); err != nil {
		t.Fatal(err)
	}
	if state != "expired" || key != nil {
		t.Fatalf("expired job: %s, key %v", state, key)
	}
	b.mu.Lock()
	gone := b.deleted
	b.mu.Unlock()
	if len(gone) != 1 || gone[0] != "exports/test/"+j.Id.String()+".csv" {
		t.Fatalf("deleted %v", gone)
	}
}

// errBroken is the failure of a storage that does not answer.
var errBroken = errors.New("storage is down")

// broken is a storage whose uploads fail.
type broken struct{ *bucket }

func (b *broken) Upload(context.Context, string, string, []byte) error { return errBroken }

// A storage that does not take the file: the job fails with source_unavailable.
//
//nolint:paralleltest // Runner.Once takes every queued job of tenant a
func TestRunnerFailsOnUpload(t *testing.T) {
	e := newEnv(t, "active").exporting("a.manager-msk1")
	j := e.job(t, "a.manager-msk1", vehiclesSet, plainVehicles)
	r := e.runner(t, nil, "a.manager-msk1")
	r.Store = &broken{bucket: newBucket()}
	e.once(t, r)
	got, err := e.getJob(t, "a.manager-msk1", j.Id)
	if err != nil || got.State != dataapi.DatasetExportJobStateFailed || got.FailureCode == nil || *got.FailureCode != dataapi.SourceUnavailable {
		t.Fatalf("job %+v, %v", got, err)
	}
}
