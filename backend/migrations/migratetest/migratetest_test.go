package migratetest_test

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"go.yaml.in/yaml/v3"

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

// W2.49 (D-04, ответ владельца 17.10): один образ — PostgreSQL 17 по digest, второго прогона на 16.4 нет.
func TestPostgres17IsPinnedByDigest(t *testing.T) {
	t.Parallel()
	name, digest, ok := strings.Cut(migratetest.Postgres17, "@sha256:")
	if !ok || !strings.HasPrefix(name, "postgres:17.") || len(digest) != 64 {
		t.Fatalf("Postgres17 = %q, want postgres:17.<minor>@sha256:<64 hex>", migratetest.Postgres17)
	}
}

func TestImagesFromEnv(t *testing.T) {
	t.Setenv("PG_TEST_IMAGES", "postgres:17.11@sha256:aa, postgres:17.12@sha256:bb ,")
	got := migratetest.Images()
	if strings.Join(got, "|") != "postgres:17.11@sha256:aa|postgres:17.12@sha256:bb" {
		t.Fatalf("Images() = %q", got)
	}
	t.Setenv("PG_TEST_IMAGES", "")
	if got := migratetest.Images(); len(got) != 1 || got[0] != migratetest.Postgres17 {
		t.Fatalf("default Images() = %q, want only %s (W2.49: no 16.4 run)", got, migratetest.Postgres17)
	}
}

// Образ без digest не запускается: тег можно перезаписать, прогон перестаёт быть воспроизводимым (D-04).
// Проверка — до Docker, поэтому тест unit.
func TestStartRejectsImageWithoutDigest(t *testing.T) {
	t.Parallel()
	for _, img := range []string{"postgres:17", "postgres:17.11", "postgres", " "} {
		ctx, cancel := context.WithCancel(t.Context())
		cancel() // Start must fail on the image before it touches Docker.
		c, stop, err := migratetest.Start(ctx, img)
		if err == nil {
			stop()
			t.Fatalf("Start(%q) = %v, want an error", img, c)
		}
		if !strings.Contains(err.Error(), "digest") || strings.Contains(err.Error(), "Docker недоступен") {
			t.Fatalf("Start(%q) error = %v, want «образ без digest» before Docker", img, err)
		}
	}
}

type workflow struct {
	Env  map[string]string `yaml:"env"`
	Jobs map[string]struct {
		Env   map[string]string `yaml:"env"`
		Steps []struct {
			Env map[string]string `yaml:"env"`
		} `yaml:"steps"`
	} `yaml:"jobs"`
}

// CI закрепляет тот же образ явно: jobs с testcontainers задают PG_TEST_IMAGES = Postgres17, другого значения нет.
func TestCIPinsPostgres17(t *testing.T) {
	t.Parallel()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", ".github", "workflows", "ci.yml"))
	if err != nil {
		t.Fatal(err)
	}
	var wf workflow
	if err := yaml.Unmarshal(b, &wf); err != nil {
		t.Fatalf("ci.yml: %v", err)
	}
	check := func(where string, env map[string]string) {
		if v, ok := env["PG_TEST_IMAGES"]; ok && v != migratetest.Postgres17 {
			t.Errorf("ci.yml %s: PG_TEST_IMAGES = %q, want %s", where, v, migratetest.Postgres17)
		}
	}
	check("env", wf.Env)
	for name, job := range wf.Jobs {
		check("jobs."+name+".env", job.Env)
		for i, s := range job.Steps {
			check("jobs."+name+".steps["+strconv.Itoa(i)+"].env", s.Env)
		}
	}
	for _, name := range []string{"integration", "isolation"} {
		job, ok := wf.Jobs[name]
		if !ok {
			t.Errorf("ci.yml: no job %s", name)
			continue
		}
		if job.Env["PG_TEST_IMAGES"] != migratetest.Postgres17 {
			t.Errorf("ci.yml jobs.%s.env.PG_TEST_IMAGES = %q, want %s", name, job.Env["PG_TEST_IMAGES"], migratetest.Postgres17)
		}
	}
}
