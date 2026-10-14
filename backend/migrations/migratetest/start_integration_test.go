//go:build integration

package migratetest_test

import (
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// Integration-тесты — только testcontainers (CLAUDE.md). Внешний сервер из PG_TEST_URL не используется:
// EnsureRoles сбросил бы пароли ролей ortus_* всего кластера (например, стенда) и оставил бы там базы тестов.
func TestStartIgnoresExternalServer(t *testing.T) {
	t.Setenv("PG_TEST_URL", "postgres://postgres:postgres@127.0.0.1:1/postgres?sslmode=disable")
	c, stop, err := migratetest.Start(t.Context(), migratetest.Images()[0])
	if err != nil {
		t.Fatal(err)
	}
	defer stop()
	if u := c.URL("postgres", migratetest.Super); strings.Contains(u, "127.0.0.1:1/") {
		t.Fatalf("Start used PG_TEST_URL: %s", u)
	}
	db := c.DB(t, "postgres", migratetest.Super)
	var one int
	if err := db.QueryRowContext(t.Context(), `select 1`).Scan(&one); err != nil || one != 1 {
		t.Fatalf("container server: %d, %v", one, err)
	}
}
