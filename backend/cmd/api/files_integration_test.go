//go:build integration

package main

// Сквозной тест шага 1.8 (W1.09, S1-20…S1-22): браузер с cookie → BFF → шлюз (CSRF, право, Idempotency-Key) →
// модуль files → tenant DB «Альты» и MinIO (testcontainers). Загрузка до ready, скачивание, список, «Хранилище».

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/files"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage/miniotest"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"
)

// filesStack starts cmd/api over the seeded stack with the object storage of a MinIO container.
func filesStack(t *testing.T) (*httptest.Server, storage.Config, *tenantctx.Pools) {
	t.Helper()
	s3, stop, err := miniotest.Start(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(stop)
	cfg := config{
		AppEnv: envE2E, AuthProvider: envDev, ControlDBURL: stack.URL(controlDB, migrations.RoleAPI),
		SessionCookie: "ortus_sid", SessionTTL: time.Hour, AllowedOrigins: []string{"http://127.0.0.1:5213"},
	}
	vars := map[string]string{
		"TENANT_DB_URL": stack.URL("postgres", migrations.RoleAPI),
		"S3_ENDPOINT":   s3.Endpoint, "S3_REGION": s3.Region, "S3_BUCKET": s3.Bucket,
		"S3_ACCESS_KEY": s3.AccessKey, "S3_SECRET_KEY": s3.SecretKey,
	}
	getenv := func(k string) string { return vars[k] }
	d, closeDeps, err := build(t.Context(), cfg, slog.New(slog.DiscardHandler), getenv)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(newHandler(d))
	pools := tenantctx.NewPools(d.dir, getenv, "")
	t.Cleanup(func() {
		srv.Close()
		pools.Close()
		closeDeps()
	})
	return srv, s3, pools
}

// send is browser.call with an Idempotency-Key (commands of the contract require it).
func (b *browser) send(method, path string, body any) (int, map[string]any) {
	b.t.Helper()
	raw, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(b.t.Context(), method, b.base+path, bytes.NewReader(raw))
	if err != nil {
		b.t.Fatal(err)
	}
	req.Header.Set("Origin", "http://127.0.0.1:5213")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", b.csrf)
	req.Header.Set("Idempotency-Key", "w109-"+uuid.NewString())
	resp, err := b.http.Do(req)
	if err != nil {
		b.t.Fatal(err)
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	var m map[string]any
	_ = json.Unmarshal(out, &m)
	return resp.StatusCode, m
}

// S1-20…S1-22 through the whole API: the owner of «Альта» uploads a photo of a trip, the worker checks it, the file
// is downloadable and listed with its parent; the storage screen sees the bytes; subscriptions stay 501 (W1.08).
func TestStackFiles(t *testing.T) { //nolint:paralleltest // one seeded stack
	srv, s3cfg, pools := filesStack(t)
	db := super(t, "t_alta")
	trip := uuid.New()
	_, err := db.ExecContext(t.Context(), `insert into fleet.trips (id, number, unit_id, state, planned)
	    select $1, 'TR-W109-0001', id, 'planned', tstzrange(now(), now() + interval '1 day') from org.units limit 1`, trip)
	if err != nil {
		t.Fatal(err)
	}
	content := append([]byte{0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 'J', 'F', 'I', 'F', 0}, bytes.Repeat([]byte("alta"), 64)...)
	sum := sha256.Sum256(content)
	digest := hex.EncodeToString(sum[:])
	owner := newBrowser(t, srv).login("owner")
	base := "/api/v1/tenants/" + seedAlta.String()

	status, ticket := owner.send(http.MethodPost, base+"/files/uploads", map[string]any{
		"fileName": "Р-208 · спереди.jpg", "contentType": "image/jpeg", "sizeBytes": len(content), "sha256": digest,
		"purpose": "inspection", "owner": map[string]any{"moduleKey": "fleet", "entityType": "trip", "entityId": trip},
	})
	if status != http.StatusCreated {
		t.Fatalf("initiateUpload: %d %v", status, ticket)
	}
	putObject(t, ticket["uploadUrl"].(string), content) //nolint:forcetypeassert // checked by the status above
	upload := ticket["uploadId"].(string)               //nolint:forcetypeassert // checked by the status above
	status, file := owner.send(http.MethodPost, base+"/files/uploads/"+upload+"/complete", map[string]any{"sha256": digest})
	if status != http.StatusAccepted || file["status"] != "quarantined" {
		t.Fatalf("completeUpload: %d %v", status, file)
	}
	fileID := uuid.MustParse(file["id"].(string)) //nolint:forcetypeassert // checked by the status above
	scanInWorker(t, s3cfg, pools, fileID)

	for path, want := range map[string]int{
		"/files/" + fileID.String():               http.StatusOK,
		"/files/" + fileID.String() + "/download": http.StatusOK,
		"/files?status=ready":                     http.StatusOK,
		"/files/uploads/" + upload:                http.StatusOK,
		"/storage":                                http.StatusOK,
		"/storage/breakdown":                      http.StatusOK,
		"/subscription":                           http.StatusOK, // the overlay of W1.08 over files.Billing
	} {
		if status, body := owner.call(http.MethodGet, base+path, ""); status != want {
			t.Errorf("GET %s: %d %v, want %d", path, status, body, want)
		}
	}
	status, quote := owner.send(http.MethodPost, base+"/storage/changes", map[string]any{"requestedQuotaBytes": 150 << 30, "mode": "quote"})
	if status != http.StatusCreated || quote["state"] != "quoted" {
		t.Fatalf("requestStorageChange: %d %v", status, quote)
	}
}

func putObject(t *testing.T, url string, content []byte) {
	t.Helper()
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
		t.Fatalf("PUT: %d", resp.StatusCode)
	}
}

// scanInWorker delivers files.file.uploaded.v1 the way cmd/worker does (registerFiles).
func scanInWorker(t *testing.T, s3cfg storage.Config, pools *tenantctx.Pools, file uuid.UUID) {
	t.Helper()
	reg := events.NewRegistry()
	w := &files.Worker{Pools: pools, Scanner: files.BasicScanner{}}
	s3, err := storage.NewS3(s3cfg, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	w.Store = s3
	w.Register(reg)
	m := events.Message{TenantID: seedAlta, EventID: uuid.New(), Type: files.EventUploaded, Aggregate: "files.file", AggregateID: file}
	if err := reg.Dispatch(t.Context(), m); err != nil {
		t.Fatal(err)
	}
}
