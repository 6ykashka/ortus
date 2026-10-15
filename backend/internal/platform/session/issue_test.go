package session

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
)

// W1.03: a session remembers its identity provider and the time of authentication at the provider (fresh sign-in
// of AUTH-08 compares auth_time, not the time the BFF issued the cookie).
func TestIssueForKeepsProviderAndAuthTime(t *testing.T) {
	t.Parallel()
	m, _ := newManager()
	account := uuid.New()
	authTime := t0.Add(-3 * time.Minute)
	rec := httptest.NewRecorder()
	s, err := m.IssueFor(rec, req(t, http.MethodGet), account, "http://idp.test/realms/ortus", authTime)
	if err != nil {
		t.Fatal(err)
	}
	if s.AccountID != account || s.Provider != "http://idp.test/realms/ortus" || !s.AuthTime.Equal(authTime) {
		t.Fatalf("session = %+v", s)
	}
	if !s.IssuedAt.Equal(t0) || !s.ExpiresAt.Equal(t0.Add(12*time.Hour)) {
		t.Fatalf("issued %v expires %v", s.IssuedAt, s.ExpiresAt)
	}
	got, err := m.Store.Get(t.Context(), s.ID)
	if err != nil || got != s {
		t.Fatalf("stored %+v, %v; want %+v", got, err, s)
	}
	if c := cookies(rec)[m.CookieName]; c == nil || c.Value != s.ID {
		t.Fatalf("session cookie %s", describe(c))
	}
}

// Issue (dev provider) authenticates now and has no provider.
func TestIssueAuthenticatesNow(t *testing.T) {
	t.Parallel()
	m, _ := newManager()
	s, _ := issue(t, m, req(t, http.MethodPost))
	if s.Provider != "" || !s.AuthTime.Equal(t0) {
		t.Fatalf("provider %q auth_time %v, want \"\" and %v", s.Provider, s.AuthTime, t0)
	}
}

// Q-W0.09-4: in prod the cookies are always Secure (__Host- requires it), even when TLS ends before the API and
// the proxy does not say so.
func TestSecureForcesCookies(t *testing.T) {
	t.Parallel()
	m, _ := newManager()
	m.Secure = true
	m.CookieName = "__Host-ortus_session"
	_, cs := issue(t, m, req(t, http.MethodPost))
	for _, name := range []string{m.CookieName, m.CSRFCookieName} {
		if c := cs[name]; c == nil || !c.Secure || c.Path != "/" {
			t.Errorf("%s: %s, want Secure Path=/", name, describe(c))
		}
	}
	rec := httptest.NewRecorder()
	if err := m.Clear(rec, req(t, http.MethodPost)); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{m.CookieName, m.CSRFCookieName} {
		if c := cookies(rec)[name]; c == nil || !c.Secure || c.MaxAge >= 0 {
			t.Errorf("cleared %s: %s, want Secure and expired", name, describe(c))
		}
	}
}
