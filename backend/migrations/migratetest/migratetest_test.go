package migratetest_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// Тесты и стенд работают на одном образе PostgreSQL 17 (D-04).
func TestPostgres17MatchesComposeStand(t *testing.T) {
	t.Parallel()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "deploy", "compose", "docker-compose.yml"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), "x-pg-image: &pg-image "+migratetest.Postgres17+"\n") {
		t.Fatalf("deploy/compose/docker-compose.yml must pin %s", migratetest.Postgres17)
	}
}

func TestImagesFromEnv(t *testing.T) {
	t.Setenv("PG_TEST_IMAGES", "postgres:16.4, postgres:17.11 ,")
	got := migratetest.Images()
	if strings.Join(got, "|") != "postgres:16.4|postgres:17.11" {
		t.Fatalf("Images() = %q", got)
	}
	t.Setenv("PG_TEST_IMAGES", "")
	if got := migratetest.Images(); len(got) != 2 || got[0] != migratetest.Postgres17 || got[1] != migratetest.Postgres164 {
		t.Fatalf("default Images() = %q", got)
	}
}
