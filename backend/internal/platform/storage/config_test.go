package storage_test

import (
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
)

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

// Keys of deploy/compose/.env.example (W0.06): S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY.
func TestConfigFromEnv(t *testing.T) {
	t.Parallel()
	vars := map[string]string{
		"S3_ENDPOINT": "http://localhost:9000", "S3_REGION": "ru-local", "S3_BUCKET": "ortus-files",
		"S3_ACCESS_KEY": "ortus", "S3_SECRET_KEY": "change-me-local",
	}
	cfg, ok, err := storage.ConfigFromEnv(env(vars))
	if err != nil || !ok {
		t.Fatalf("ConfigFromEnv: ok=%v err=%v", ok, err)
	}
	want := storage.Config{
		Endpoint: "http://localhost:9000", PublicEndpoint: "http://localhost:9000", Region: "ru-local",
		Bucket: "ortus-files", AccessKey: "ortus", SecretKey: "change-me-local",
	}
	if cfg != want {
		t.Fatalf("config %+v, want %+v", cfg, want)
	}

	vars["S3_PUBLIC_ENDPOINT"] = "http://127.0.0.1:19015"
	cfg, _, _ = storage.ConfigFromEnv(env(vars))
	if cfg.PublicEndpoint != "http://127.0.0.1:19015" {
		t.Fatalf("public endpoint %q", cfg.PublicEndpoint)
	}
}

// Without S3_ENDPOINT the storage is not configured (ok=false, no error): reads of file metadata still work.
func TestConfigFromEnvNotConfigured(t *testing.T) {
	t.Parallel()
	_, ok, err := storage.ConfigFromEnv(env(nil))
	if ok || err != nil {
		t.Fatalf("ok=%v err=%v, want false, nil", ok, err)
	}
}

// Every problem is reported at start; secrets never appear in the message.
func TestConfigFromEnvErrors(t *testing.T) {
	t.Parallel()
	_, ok, err := storage.ConfigFromEnv(env(map[string]string{
		"S3_ENDPOINT": "ftp://storage", "S3_SECRET_KEY": "top-secret", "S3_PUBLIC_ENDPOINT": "::bad",
	}))
	if ok || err == nil {
		t.Fatalf("ok=%v err=%v, want an error", ok, err)
	}
	msg := err.Error()
	for _, want := range []string{"S3_ENDPOINT", "S3_PUBLIC_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY"} {
		if !strings.Contains(msg, want) {
			t.Errorf("error %q does not name %s", msg, want)
		}
	}
	if strings.Contains(msg, "top-secret") {
		t.Errorf("error leaks the secret: %q", msg)
	}
}
