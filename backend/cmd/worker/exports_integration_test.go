//go:build integration

package main

// W4.50 (07-ux-and-data §3): `worker run` takes a queued export job of «Данные» under the role ortus_worker, rechecks
// the rights of its author (the membership of the control DB, the owner binding) and writes the CSV with a BOM to the
// object storage (MinIO, the image of the compose stand); the job is ready for 24 hours.

import (
	"bytes"
	"database/sql"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/data"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage/miniotest"
)

// queueExport queues an export of «Автомобили» (one column) by owner in db, as createDatasetExportJob does.
func queueExport(t *testing.T, db *sql.DB, owner uuid.UUID) uuid.UUID {
	t.Helper()
	var job uuid.UUID
	if err := db.QueryRowContext(t.Context(), `insert into data.export_jobs (dataset_id, dataset_name, requested_by, spec,
		column_labels, schema_version, permission_version, time_zone)
		values ('fleet.vehicles', 'Автомобили', $1, '{"select": ["displayName"], "filters": [], "sort": []}', '{Машина}',
		(select coalesce((select policy_version from access.policy_state), 0)::text),
		(select coalesce((select policy_version from access.policy_state), 0)::text), 'Europe/Moscow') returning id`, owner).Scan(&job); err != nil {
		t.Fatal(err)
	}
	return job
}

// readObject reads key from the storage of cfg.
func readObject(t *testing.T, cfg storage.Config, key string) ([]byte, storage.ObjectInfo) {
	t.Helper()
	s3, err := storage.NewS3(cfg, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	rc, info, err := s3.Open(t.Context(), key)
	if err != nil {
		t.Fatal(err)
	}
	defer rc.Close()
	body, err := io.ReadAll(rc)
	if err != nil {
		t.Fatal(err)
	}
	return body, info
}

//nolint:paralleltest // the worker takes the jobs of every seeded tenant
func TestRunWritesExport(t *testing.T) {
	s3cfg, stop, err := miniotest.Start(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(stop)
	alta := superDB(t, "t_alta")
	owner := personOf(t, seedZimina, seedAlta)
	if _, err := alta.ExecContext(t.Context(), `insert into modules.installations (module_key, state, manifest_version, updated_by)
		values ('logistics', 'enabled', '0.2', $1) on conflict do nothing`, owner); err != nil {
		t.Fatal(err)
	}
	job := queueExport(t, alta, owner)
	runWorker(t, map[string]string{
		"WORKER_EXPORT_INTERVAL": "50ms", "S3_ENDPOINT": s3cfg.Endpoint, "S3_REGION": s3cfg.Region, "S3_BUCKET": s3cfg.Bucket,
		"S3_ACCESS_KEY": s3cfg.AccessKey, "S3_SECRET_KEY": s3cfg.SecretKey,
	})
	var state string
	eventually(t, 20*time.Second, "the export job is done", func() bool {
		if err := alta.QueryRowContext(t.Context(), `select state from data.export_jobs where id = $1`, job).Scan(&state); err != nil {
			t.Fatal(err)
		}
		return state != "queued" && state != "running"
	})
	var (
		key  string
		size int64
	)
	if err := alta.QueryRowContext(t.Context(), `select state, coalesce(object_key, ''), coalesce(size_bytes, 0) from data.export_jobs
		where id = $1`, job).Scan(&state, &key, &size); err != nil || state != "ready" {
		var code, reason *string
		_ = alta.QueryRowContext(t.Context(), `select failure_code, revoke_reason from data.export_jobs where id = $1`, job).Scan(&code, &reason)
		t.Fatalf("job %s: %s (failure %v, revoked %v), %v", job, state, code, reason, err)
	}
	if key != data.ExportKey(seedAlta, job) {
		t.Fatalf("object key %q", key)
	}
	body, info := readObject(t, s3cfg, key)
	if !bytes.HasPrefix(body, []byte("\uFEFFМашина\r\n")) || int64(len(body)) != size || !strings.HasPrefix(info.ContentType, "text/csv") {
		t.Fatalf("file %q (%s), size %d", body, info.ContentType, size)
	}
}
