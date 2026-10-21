//go:build integration

package main

import (
	"crypto/sha256"
	"io"
	"testing"

	"github.com/ortus/ortus-crm/backend/internal/modules/files"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage/miniotest"
)

// W4.11 возврат 1 (ревью, major): with the S3 of the stand (MinIO of testcontainers) the seed puts the bytes of the
// T-65 invoice into the bucket — creating the bucket when minio-init has not run (stand.mjs all) — under the key of
// its row, with the checksum and the size of the row: the object exists and reads back.
func TestWriteTasksToStorage(t *testing.T) {
	t.Parallel()
	cfg, stop, err := miniotest.Start(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(stop)
	cfg.Bucket = "seed-fresh-bucket" // not created yet
	env := map[string]string{"S3_ENDPOINT": cfg.Endpoint, "S3_REGION": cfg.Region, "S3_BUCKET": cfg.Bucket,
		"S3_ACCESS_KEY": cfg.AccessKey, "S3_SECRET_KEY": cfg.SecretKey}
	objs, err := newObjects(t.Context(), func(k string) string { return env[k] })
	if err != nil || objs == nil {
		t.Fatalf("objects: %v %v", objs, err)
	}
	db := seedTasksDB(t, "tasks_seed_storage", alta, objs)
	file := seedID(alta.tenant.proto, "file:T-65:f-1")
	var (
		sum []byte
		n   int64
	)
	if err := db.QueryRowContext(t.Context(), `select sha256, bytes from files.objects where id = $1`, file).Scan(&sum, &n); err != nil {
		t.Fatal(err)
	}
	s3, err := storage.NewS3(cfg, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	body, info, err := s3.Open(t.Context(), files.FileKey(alta.tenant.id(), file))
	if err != nil {
		t.Fatalf("object of T-65: %v", err)
	}
	defer body.Close()
	data, err := io.ReadAll(body)
	if err != nil {
		t.Fatal(err)
	}
	got := sha256.Sum256(data)
	if int64(len(data)) != n || n != 184320 || string(got[:]) != string(sum) || info.ContentType != "application/pdf" {
		t.Fatalf("object of T-65: %d bytes (row %d), %s, checksum of the row matches %v", len(data), n, info.ContentType,
			string(got[:]) == string(sum))
	}
}
