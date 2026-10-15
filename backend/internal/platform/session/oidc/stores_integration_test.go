//go:build integration

package oidc_test

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/session"
	"github.com/ortus/ortus-crm/backend/internal/platform/session/oidc"
	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// T-03 of the brief W1.03: durable stores of the BFF on the control DB (testcontainers, role ortus_api).

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

// controlPool returns a pool of role ortus_api on a fresh migrated control DB.
func controlPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	name := cluster.NewDatabase(t, "ctl")
	_, err := migrations.Up(t.Context(), cluster.DB(t, name, migrations.RoleMigrator), migrations.Control)
	must(t, err)
	pool, err := pgxpool.New(t.Context(), cluster.URL(name, migrations.RoleAPI))
	must(t, err)
	t.Cleanup(pool.Close)
	return pool
}

func account(t *testing.T, db *pgxpool.Pool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	_, err := db.Exec(t.Context(), `insert into accounts (id, issuer, subject, email_norm, display_name)
		values ($1, 'urn:ortus:dev', $2, 'x@alta.example', 'X')`, id, id.String())
	must(t, err)
	return id
}

func hash(s string) []byte {
	sum := sha256.Sum256([]byte(s))
	return sum[:]
}

func count(t *testing.T, db *pgxpool.Pool, sql string, args ...any) int {
	t.Helper()
	var n int
	must(t, db.QueryRow(t.Context(), sql, args...).Scan(&n))
	return n
}

func liveSession(acc uuid.UUID, id string) session.Session {
	now := time.Now().UTC().Truncate(time.Microsecond)
	return session.Session{
		ID: id, AccountID: acc, CSRF: "csrf-1", Provider: "http://idp.test/realms/ortus",
		AuthTime: now.Add(-time.Minute), IssuedAt: now, ExpiresAt: now.Add(12 * time.Hour),
	}
}

func sameSession(a, b session.Session) bool {
	return a.ID == b.ID && a.AccountID == b.AccountID && a.CSRF == b.CSRF && a.Provider == b.Provider &&
		a.AuthTime.Equal(b.AuthTime) && a.IssuedAt.Equal(b.IssuedAt) && a.ExpiresAt.Equal(b.ExpiresAt)
}

func TestPGSessionStore(t *testing.T) {
	t.Parallel()
	db := controlPool(t)
	st := oidc.NewPGSessionStore(db)
	ctx := t.Context()
	s := liveSession(account(t, db), "sid-"+uuid.NewString())
	must(t, st.Create(ctx, s))
	expect(t, count(t, db, `select count(*) from auth_sessions where id_hash = $1`, hash(s.ID)) == 1,
		"the store keeps the SHA-256 of the id")
	got, err := st.Get(ctx, s.ID)
	must(t, err)
	expect(t, sameSession(got, s), "Get = %+v, want %+v", got, s)
	_, err = st.Get(ctx, "unknown")
	expectIs(t, err, session.ErrNotFound, "unknown id")
}

// Logout revokes softly: the session no longer authenticates, the replay data stays.
func TestPGSessionStoreRevoke(t *testing.T) {
	t.Parallel()
	db := controlPool(t)
	st := oidc.NewPGSessionStore(db)
	ctx := t.Context()
	s := liveSession(account(t, db), "sid-revoke")
	must(t, st.Create(ctx, s))
	url := "http://idp.test/logout"
	must(t, st.Revoke(ctx, s.ID, "logout-key-0000001", &url))
	_, err := st.Get(ctx, s.ID)
	expectIs(t, err, session.ErrNotFound, "revoked session")
	rv, err := st.Revoked(ctx, s.ID)
	must(t, err)
	expect(t, rv.LogoutKey == "logout-key-0000001" && rv.EndSessionURL != nil && *rv.EndSessionURL == url &&
		rv.CSRF == "csrf-1" && rv.AccountID == s.AccountID, "Revoked = %+v", rv)
	expectIs(t, st.Revoke(ctx, s.ID, "another-key-000002", nil), session.ErrNotFound, "second revoke")
	_, err = st.Revoked(ctx, "unknown")
	expectIs(t, err, session.ErrNotFound, "Revoked(unknown)")
}

// Delete (dev logout, expired session, new sign-in) revokes without a logout key.
func TestPGSessionStoreDelete(t *testing.T) {
	t.Parallel()
	db := controlPool(t)
	st := oidc.NewPGSessionStore(db)
	ctx := t.Context()
	s := liveSession(account(t, db), "sid-del")
	must(t, st.Create(ctx, s))
	must(t, st.Delete(ctx, s.ID))
	_, err := st.Get(ctx, s.ID)
	expectIs(t, err, session.ErrNotFound, "deleted")
	rv, err := st.Revoked(ctx, s.ID)
	must(t, err)
	expect(t, rv.LogoutKey == "", "Revoked after Delete = %+v; want no logout key", rv)
	must(t, st.Delete(ctx, "unknown"))
}

// An operator locks the account: its sessions stop authenticating at once.
func TestPGSessionStoreLockedAccount(t *testing.T) {
	t.Parallel()
	db := controlPool(t)
	st := oidc.NewPGSessionStore(db)
	ctx := t.Context()
	s := liveSession(account(t, db), "sid-lock")
	must(t, st.Create(ctx, s))
	_, err := db.Exec(ctx, `update accounts set status = 'locked', locked_at = now(), lock_reason = 'test' where id = $1`, s.AccountID)
	must(t, err)
	_, err = st.Get(ctx, s.ID)
	expectIs(t, err, session.ErrNotFound, "locked account")
}

// Q-W0.09-8: a session survives the API process — a new Manager over the same store authenticates it.
func TestPGSessionStoreSurvivesRestart(t *testing.T) {
	t.Parallel()
	db := controlPool(t)
	acc := account(t, db)
	newManager := func() *session.Manager {
		return &session.Manager{CookieName: "ortus_sid", CSRFCookieName: "ortus_csrf", TTL: time.Hour, Store: oidc.NewPGSessionStore(db)}
	}
	rec := httptest.NewRecorder()
	s, err := newManager().Issue(rec, httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/", nil), acc)
	must(t, err)
	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
	for _, c := range rec.Result().Cookies() {
		r.AddCookie(c)
	}
	got, err := newManager().Authenticate(r)
	must(t, err)
	expect(t, got.ID == s.ID && got.AccountID == acc, "Authenticate after restart = %+v", got)
}

func TestPGLoginStore(t *testing.T) {
	t.Parallel()
	db := controlPool(t)
	st := oidc.NewPGLoginStore(db)
	ctx := t.Context()
	in := oidc.LoginState{
		State: "state-1", Nonce: "nonce-1", Verifier: "verifier-1", Provider: "users", ReturnTo: "/t/x/home",
		ExpiresAt: time.Now().Add(10 * time.Minute),
	}
	must(t, st.Put(ctx, "handle-1", in))
	expect(t, count(t, db, `select count(*) from auth_login_states where id_hash = $1`, hash("handle-1")) == 1,
		"the store keeps the SHA-256 of the handle")
	got, err := st.Take(ctx, "handle-1")
	must(t, err)
	expect(t, got.State == in.State && got.Nonce == in.Nonce && got.Verifier == in.Verifier &&
		got.Provider == in.Provider && got.ReturnTo == in.ReturnTo, "Take = %+v", got)
	_, err = st.Take(ctx, "handle-1")
	expectIs(t, err, oidc.ErrLoginNotFound, "second Take (single use)")
}

func TestPGLoginStoreExpired(t *testing.T) {
	t.Parallel()
	db := controlPool(t)
	st := oidc.NewPGLoginStore(db)
	ctx := t.Context()
	must(t, st.Put(ctx, "handle-2", oidc.LoginState{State: "s", Nonce: "n", Verifier: "v", Provider: "users", ReturnTo: "/",
		ExpiresAt: time.Now().Add(10 * time.Minute)}))
	_, err := db.Exec(ctx, `update auth_login_states set created_at = now() - interval '20 minutes',
		expires_at = now() - interval '10 minutes' where id_hash = $1`, hash("handle-2"))
	must(t, err)
	_, err = st.Take(ctx, "handle-2")
	expectIs(t, err, oidc.ErrLoginNotFound, "expired")
	expect(t, count(t, db, `select count(*) from auth_login_states`) == 0, "an expired record is gone after Take")
}

type accountRow struct {
	email, name string
	last        *time.Time
}

func readAccount(t *testing.T, db *pgxpool.Pool, id uuid.UUID) accountRow {
	t.Helper()
	var r accountRow
	must(t, db.QueryRow(t.Context(), `select email_norm, display_name, last_login_at from accounts where id = $1`, id).
		Scan(&r.email, &r.name, &r.last))
	return r
}

func TestPGAccounts(t *testing.T) {
	t.Parallel()
	db := controlPool(t)
	accs := oidc.NewPGAccounts(db)
	ctx := t.Context()
	id := oidc.Identity{Issuer: "http://idp.test/realms/ortus", Subject: "kc-1", Email: "d.zimina@alta.example", EmailVerified: true, Name: "Дарья Зимина"}
	a, err := accs.Upsert(ctx, id)
	must(t, err)
	expect(t, a.Status == "active" && a.ID != uuid.Nil, "Upsert = %+v", a)
	expect(t, count(t, db, `select count(*) from accounts where id = $1 and issuer = $2 and subject = $3`, a.ID, id.Issuer, id.Subject) == 1,
		"account of (issuer, subject)")
	row := readAccount(t, db, a.ID)
	expect(t, row.email == "d.zimina@alta.example" && row.name == "Дарья Зимина" && row.last != nil, "row %+v", row)
	// The next sign-in keeps the account and its name (edited in Ortus), follows the e-mail of the provider.
	id.Email, id.Name = "darya@alta.example", "Другое имя"
	b, err := accs.Upsert(ctx, id)
	must(t, err)
	expect(t, b.ID == a.ID, "second Upsert = %+v; want the same account", b)
	row = readAccount(t, db, a.ID)
	expect(t, row.email == "darya@alta.example" && row.name == "Дарья Зимина", "after second sign-in: %+v", row)
}

// A locked account is found but not refreshed.
func TestPGAccountsLocked(t *testing.T) {
	t.Parallel()
	db := controlPool(t)
	accs := oidc.NewPGAccounts(db)
	ctx := t.Context()
	id := oidc.Identity{Issuer: "http://idp.test/realms/ortus", Subject: "kc-2", Email: "x@alta.example", EmailVerified: true, Name: "X"}
	a, err := accs.Upsert(ctx, id)
	must(t, err)
	_, err = db.Exec(ctx, `update accounts set status = 'locked', locked_at = now(), lock_reason = 'test',
		last_login_at = '2026-01-01T00:00:00Z' where id = $1`, a.ID)
	must(t, err)
	id.Email = "changed@alta.example"
	c, err := accs.Upsert(ctx, id)
	must(t, err)
	expect(t, c.ID == a.ID && c.Status == "locked", "locked Upsert = %+v", c)
	row := readAccount(t, db, a.ID)
	expect(t, row.email == "x@alta.example" && row.last != nil && row.last.Year() == 2026 && row.last.Month() == time.January,
		"a locked account changed: %+v", row)
}
