//go:build integration

package dev

// W1.50 T-5: the first dev login of a newcomer creates its account in the control DB as the first OIDC sign-in does
// (testcontainers, role ortus_api; the directory of cmd/api and oidc.PGAccounts over the same pool).

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
	"github.com/ortus/ortus-crm/backend/internal/platform/session/oidc"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

var cluster *migratetest.Cluster

func TestMain(m *testing.M) {
	c, stop, err := migratetest.Start(context.Background(), migratetest.Images()[0])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	cluster = c
	code := m.Run()
	stop()
	os.Exit(code)
}

// controlProvider mounts the dev provider of appEnv over a fresh migrated control DB with durable sessions.
func controlProvider(t *testing.T, appEnv string) (http.Handler, *session.Manager, *pgxpool.Pool) {
	t.Helper()
	name := cluster.NewDatabase(t, "ctl")
	if _, err := migrations.Up(t.Context(), cluster.DB(t, name, migrations.RoleMigrator), migrations.Control); err != nil {
		t.Fatal(err)
	}
	pool, err := pgxpool.New(t.Context(), cluster.URL(name, migrations.RoleAPI))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	m := &session.Manager{
		CookieName: "ortus_sid", CSRFCookieName: "ortus_csrf", TTL: 12 * time.Hour,
		AllowedOrigins: []string{origin}, Store: oidc.NewPGSessionStore(pool),
	}
	r := chi.NewRouter()
	Routes(r, m, tenantctx.NewPGDirectory(pool), Newcomers(appEnv, oidc.NewPGAccounts(pool)))
	return requestid.Middleware(r), m, pool
}

func countRows(t *testing.T, db *pgxpool.Pool, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := db.QueryRow(t.Context(), sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

const newcomerRows = `select count(*) from accounts where issuer = 'urn:ortus:dev' and subject = 'new-i.novikov@alta.example'`

// Первый вход создаёт строку accounts (urn:ortus:dev, адрес нормализован, имя, active, last_login_at) без членств;
// повторный — тот же аккаунт, строка одна.
func TestNewcomerAccountInControlDB(t *testing.T) {
	t.Parallel()
	h, m, pool := controlProvider(t, "e2e")
	rec, first, acc := enter(t, h, m, novikov)
	if rec.Code != http.StatusOK || acc.String() != first.UserID {
		t.Fatalf("first login: %d %s", rec.Code, rec.Body)
	}
	if n := countRows(t, pool, newcomerRows+` and id = $1 and email_norm = 'i.novikov@alta.example'
		and display_name = 'Иван Новиков' and status = 'active' and last_login_at is not null`, acc); n != 1 {
		t.Fatalf("account row: %d", n)
	}
	if n := countRows(t, pool, `select count(*) from memberships where account_id = $1`, acc); n != 0 {
		t.Fatalf("memberships of a newcomer: %d", n)
	}
	rec, again, acc2 := enter(t, h, m, `{"persona":"new-i.novikov@alta.example"}`)
	if rec.Code != http.StatusOK || again.UserID != first.UserID || acc2 != acc {
		t.Fatalf("second login: %d %s, first %s", rec.Code, rec.Body, first.UserID)
	}
	if n := countRows(t, pool, newcomerRows); n != 1 {
		t.Fatalf("accounts of the subject: %d", n)
	}
}

// В prod аккаунт не создаётся: 401, строки нет.
func TestNewcomerProdRefused(t *testing.T) {
	t.Parallel()
	h, m, pool := controlProvider(t, "prod")
	if rec, _, acc := enter(t, h, m, novikov); rec.Code != http.StatusUnauthorized || acc != uuid.Nil {
		t.Fatalf("prod: %d %s", rec.Code, rec.Body)
	}
	if n := countRows(t, pool, `select count(*) from accounts`); n != 0 {
		t.Fatalf("accounts after a refused login: %d", n)
	}
}

// Параллельные первые входы одного subject сходятся на одном аккаунте.
func TestNewcomerConcurrentFirstLogins(t *testing.T) {
	t.Parallel()
	h, m, pool := controlProvider(t, "dev")
	const n = 8
	ids := make([]string, n)
	codes := make([]int, n)
	var wg sync.WaitGroup
	for i := range n {
		wg.Go(func() {
			rec, body, _ := enter(t, h, m, novikov)
			ids[i], codes[i] = body.UserID, rec.Code
		})
	}
	wg.Wait()
	for i := range n {
		if codes[i] != http.StatusOK || ids[i] != ids[0] {
			t.Fatalf("login %d: %d %s, first %s", i, codes[i], ids[i], ids[0])
		}
	}
	if c := countRows(t, pool, newcomerRows); c != 1 {
		t.Fatalf("accounts of the subject: %d", c)
	}
}
