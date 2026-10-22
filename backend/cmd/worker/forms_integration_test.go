//go:build integration

package main

// W4.21, return 1 (Q-W4.00-forms-22, D-26): `worker run` deletes a response older than «Хранить ответы» of its form
// with its journal, the rows and the records of the knowledge base written for it and the files of its answers — the
// row of the file stays rejected, its committed bytes are released and its bytes leave the object storage (MinIO).

import (
	"bytes"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/files"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage/miniotest"
)

//nolint:paralleltest // the worker retains every seeded tenant
func TestRunRetainsForms(t *testing.T) {
	s3cfg, stop, err := miniotest.Start(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(stop)
	s3, err := storage.NewS3(s3cfg, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx, alta := t.Context(), superDB(t, "t_alta")
	form := uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:t-alta:fm-insp"))
	var response, author uuid.UUID
	if err := alta.QueryRowContext(ctx, `select id, author_id from forms.responses where form_id = $1 and number = 988`, form).
		Scan(&response, &author); err != nil {
		t.Fatal(err)
	}
	// A photo of R-0988 in storage and in the quota, a row and a record of the knowledge base written for it.
	file, content := uuid.New(), bytes.Repeat([]byte("w421"), 256)
	key := files.FileKey(seedAlta, file)
	putBytes(t, s3, key, content)
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{`insert into files.objects (id, object_key, state, purpose, owner_type, owner_id, declared_mime, bytes, sha256, uploaded_by,
			ready_at) values ($1, $2, 'ready', 'form_attachment', 'forms.form', $3, 'image/jpeg', $4, sha256($5), $6, now())`,
			[]any{file, key, form, len(content), content, author}},
		{`insert into files.quota_ledger (file_id, kind, bytes) values ($1, 'commit', $2)`, []any{file, len(content)}},
		{`insert into files.usage (limit_bytes) values ($1) on conflict (singleton) do nothing`, []any{int64(10 << 30)}},
		{`update files.usage set committed_bytes = committed_bytes + $1`, []any{len(content)}},
		{`update forms.responses set submitted_at = now() - interval '10 years',
			answers = answers || jsonb_build_array(jsonb_build_object('fieldKey', 'q-w421-photos', 'value',
				jsonb_build_object('type', 'files', 'value', jsonb_build_array($2::text)))) where id = $1`, []any{response, file.String()}},
		{`insert into kb.table_rows (table_id, cells, form_id, response_number, form_version)
			select id, '{}', $1, 'R-0988', 1 from kb.tables limit 1`, []any{form}},
		{`insert into kb.entries (node_id, head, lines, form_id, response_number, form_version)
			select node_id, 'R-0988', '[]', $1, 'R-0988', 1 from kb.tables limit 1`, []any{form}},
	} {
		if _, err := alta.ExecContext(ctx, q.sql, q.args...); err != nil {
			t.Fatalf("%s: %v", q.sql, err)
		}
	}
	committed := count(t, alta, `select committed_bytes::int from files.usage`)
	others := count(t, alta, `select count(*) from kb.table_rows where response_number is distinct from 'R-0988'`)

	runWorker(t, map[string]string{
		"WORKER_FORMS_RETENTION_INTERVAL": "50ms", "S3_ENDPOINT": s3cfg.Endpoint, "S3_REGION": s3cfg.Region, "S3_BUCKET": s3cfg.Bucket,
		"S3_ACCESS_KEY": s3cfg.AccessKey, "S3_SECRET_KEY": s3cfg.SecretKey,
	})
	eventually(t, 20*time.Second, "R-0988 is deleted", func() bool {
		return count(t, alta, `select count(*) from forms.responses where id = $1`, response) == 0
	})
	eventually(t, 10*time.Second, "the bytes of its photo leave the storage", func() bool {
		_, _, err := s3.Open(ctx, key)
		return errors.Is(err, storage.ErrNotFound)
	})
	for _, c := range []struct {
		sql  string
		arg  any
		want int
	}{
		{`select count(*) from forms.response_actions where response_id = $1`, response, 0},
		{`select count(*) from kb.table_rows where form_id = $1 and response_number = 'R-0988'`, form, 0},
		{`select count(*) from kb.entries where form_id = $1 and response_number = 'R-0988'`, form, 0},
		{`select count(*) from forms.responses where form_id = $1 and number = 1012`, form, 1},
		{`select count(*) from files.objects where id = $1 and state = 'rejected'`, file, 1},
		{`select count(*) from files.quota_ledger where file_id = $1 and kind = 'release'`, file, 1},
		{`select count(*) from files.usage where committed_bytes = $1::bigint`, committed - len(content), 1},
		{`select count(*) from kb.table_rows where response_number is distinct from $1`, "R-0988", others},
	} {
		if got := count(t, alta, c.sql, c.arg); got != c.want {
			t.Errorf("%s = %d, want %d", c.sql, got, c.want)
		}
	}
}

// putBytes writes content at key of the storage, as a browser does with a presigned PUT.
func putBytes(t *testing.T, s3 *storage.S3, key string, content []byte) {
	t.Helper()
	url, err := s3.PresignPut(key, "image/jpeg", int64(len(content)), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPut, url, bytes.NewReader(content))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "image/jpeg")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("PUT %s: %d", key, resp.StatusCode)
	}
}
