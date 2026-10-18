package accesstest

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// W2.49 (D-04): тесты модуля access работают на образе стенда compose (тот же digest, что migratetest.Postgres17;
// depguard не пускает пакет migrations в internal/modules/**, поэтому константа своя и сверяется с compose).
func TestImageMatchesComposeStand(t *testing.T) {
	t.Parallel()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "..", "..", "deploy", "compose", "docker-compose.yml"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), "x-pg-image: &pg-image "+Image+"\n") {
		t.Fatalf("deploy/compose/docker-compose.yml must pin %s", Image)
	}
}

// Образ без digest из PG_TEST_IMAGES не запускается — ошибка до Docker.
// Не параллелен: меняет PG_TEST_IMAGES процесса (t.Setenv).
func TestStartRejectsImageWithoutDigest(t *testing.T) {
	t.Setenv("PG_TEST_IMAGES", "")
	for _, img := range []string{"postgres:17", "postgres:17.11, " + Image} {
		t.Setenv("PG_TEST_IMAGES", img)
		ctx, cancel := context.WithCancel(t.Context())
		cancel() // Start must fail on the image before it touches Docker.
		_, stop, err := Start(ctx)
		if err == nil {
			stop()
			t.Fatalf("Start with PG_TEST_IMAGES=%q succeeded, want an error", img)
		}
		if !strings.Contains(err.Error(), "digest") || strings.Contains(err.Error(), "Docker недоступен") {
			t.Fatalf("Start with PG_TEST_IMAGES=%q: %v, want «образ без digest» before Docker", img, err)
		}
	}
}
