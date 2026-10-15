package session

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

const origin = "http://127.0.0.1:5213"

var t0 = time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)

type clock struct{ now time.Time }

func (c *clock) Now() time.Time { return c.now }

func newManager() (*Manager, *clock) {
	c := &clock{now: t0}
	return &Manager{
		CookieName:     "ortus_sid",
		CSRFCookieName: "ortus_csrf",
		TTL:            12 * time.Hour,
		AllowedOrigins: []string{origin},
		Now:            c.Now,
		Store:          NewMemStore(),
	}, c
}

func req(t *testing.T, method string) *http.Request {
	t.Helper()
	return httptest.NewRequestWithContext(t.Context(), method, "/api/v1/me/context", nil)
}

func cookies(rec *httptest.ResponseRecorder) map[string]*http.Cookie {
	out := map[string]*http.Cookie{}
	for _, c := range rec.Result().Cookies() {
		out[c.Name] = c
	}
	return out
}

func issue(t *testing.T, m *Manager, r *http.Request) (Session, map[string]*http.Cookie) {
	t.Helper()
	rec := httptest.NewRecorder()
	s, err := m.Issue(rec, r, uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	return s, cookies(rec)
}

// withCookies returns a request carrying the session and CSRF cookies of s.
func withCookies(t *testing.T, m *Manager, method string, s Session) *http.Request {
	t.Helper()
	r := req(t, method)
	r.AddCookie(reqCookie(m.CookieName, s.ID))
	r.AddCookie(reqCookie(m.CSRFCookieName, s.CSRF))
	return r
}

func describe(c *http.Cookie) string {
	if c == nil {
		return "<missing>"
	}
	same := map[http.SameSite]string{http.SameSiteLaxMode: "Lax"}[c.SameSite]
	return fmt.Sprintf("%s HttpOnly=%t Secure=%t SameSite=%s Path=%s", c.Value, c.HttpOnly, c.Secure, same, c.Path)
}

// reqCookie is a cookie sent by the browser (attributes are not sent; set for gosec G124).
func reqCookie(name, value string) *http.Cookie {
	return &http.Cookie{Name: name, Value: value, HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode}
}

// K-02 (WS-40; 12 §6 п.23): cookie сессии HttpOnly, SameSite=Lax, Path=/, Secure — только за TLS;
// CSRF-cookie double-submit не HttpOnly; id сессии ≥ 32 байт и не совпадает с CSRF.
func TestIssueCookies(t *testing.T) {
	t.Parallel()
	m, _ := newManager()
	s, c := issue(t, m, req(t, http.MethodPost))
	for name, want := range map[string]string{
		"ortus_sid":  s.ID + " HttpOnly=true Secure=false SameSite=Lax Path=/",
		"ortus_csrf": s.CSRF + " HttpOnly=false Secure=false SameSite=Lax Path=/",
	} {
		if got := describe(c[name]); got != want {
			t.Errorf("%s = %q, want %q", name, got, want)
		}
	}
	if len(s.ID) < 43 || s.ID == s.CSRF {
		t.Fatalf("session %+v", s)
	}
	if !s.ExpiresAt.Equal(t0.Add(12 * time.Hour)) {
		t.Fatalf("ExpiresAt = %v", s.ExpiresAt)
	}
}

func TestIssueSecureBehindTLS(t *testing.T) {
	t.Parallel()
	m, _ := newManager()
	https := req(t, http.MethodPost)
	https.Header.Set("X-Forwarded-Proto", "https")
	if _, c := issue(t, m, https); !c["ortus_sid"].Secure || !c["ortus_csrf"].Secure {
		t.Fatal("Secure is missing behind TLS")
	}
}

// K-01, K-06, K-23 (WS-40): нет сессии, чужой id, истёк срок, bearer без cookie → session_expired;
// cookie и bearer одновременно → malformed_request («Do not send this cookie with a bearer token»).
func TestAuthenticate(t *testing.T) {
	t.Parallel()
	m, c := newManager()
	s, _ := issue(t, m, req(t, http.MethodPost))

	got, err := m.Authenticate(withCookies(t, m, http.MethodGet, s))
	if err != nil || got.ID != s.ID || got.AccountID != s.AccountID {
		t.Fatalf("valid session: %+v, %v", got, err)
	}

	noCookie := req(t, http.MethodGet)
	unknown := req(t, http.MethodGet)
	unknown.AddCookie(reqCookie("ortus_sid", "nope"))
	bearer := req(t, http.MethodGet)
	bearer.Header.Set("Authorization", "Bearer x")
	both := withCookies(t, m, http.MethodGet, s)
	both.Header.Set("Authorization", "Bearer x")
	for name, tc := range map[string]struct {
		r    *http.Request
		code string
	}{
		"без cookie":      {noCookie, problem.CodeSessionExpired},
		"неизвестный id":  {unknown, problem.CodeSessionExpired},
		"только bearer":   {bearer, problem.CodeSessionExpired},
		"cookie и bearer": {both, problem.CodeMalformedRequest},
	} {
		if _, err := m.Authenticate(tc.r); !problem.Is(err, tc.code) {
			t.Errorf("%s: %v, want %s", name, err, tc.code)
		}
	}

	c.now = t0.Add(12*time.Hour - time.Minute)
	if _, err := m.Authenticate(withCookies(t, m, http.MethodGet, s)); err != nil {
		t.Fatalf("before TTL: %v", err)
	}
	c.now = t0.Add(12*time.Hour + time.Second)
	if _, err := m.Authenticate(withCookies(t, m, http.MethodGet, s)); !problem.Is(err, problem.CodeSessionExpired) {
		t.Fatalf("after TTL: %v", err)
	}
	if _, err := m.Store.Get(t.Context(), s.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expired session must be removed from the store: %v", err)
	}
}

// K-04, K-05 (WS-40; yaml:6662–6667): изменяющий запрос с cookie требует точный Origin из ALLOWED_ORIGINS
// и X-CSRF-Token, равный CSRF сессии.
func TestCheckCSRF(t *testing.T) {
	t.Parallel()
	m, _ := newManager()
	s, _ := issue(t, m, req(t, http.MethodPost))
	mk := func(org, token string) *http.Request {
		r := withCookies(t, m, http.MethodPost, s)
		if org != "" {
			r.Header.Set("Origin", org)
		}
		if token != "" {
			r.Header.Set(CSRFHeader, token)
		}
		return r
	}
	cases := []struct {
		name string
		r    *http.Request
		code string
	}{
		{"верный Origin и токен", mk(origin, s.CSRF), ""},
		{"нет токена", mk(origin, ""), problem.CodeCSRFFailed},
		{"чужой токен", mk(origin, strings.Repeat("x", len(s.CSRF))), problem.CodeCSRFFailed},
		{"чужой Origin", mk("https://evil.example", s.CSRF), problem.CodeOriginNotAllowed},
		{"нет Origin", mk("", s.CSRF), problem.CodeOriginNotAllowed},
	}
	for _, tc := range cases {
		err := m.CheckCSRF(tc.r, s)
		if tc.code == "" && err != nil || tc.code != "" && !problem.Is(err, tc.code) {
			t.Errorf("%s: %v, want %q", tc.name, err, tc.code)
		}
	}
}

// K-22 (WS-40): выход удаляет сессию в Store (а не только cookie) и сбрасывает обе cookie.
func TestClear(t *testing.T) {
	t.Parallel()
	m, _ := newManager()
	s, _ := issue(t, m, req(t, http.MethodPost))
	rec := httptest.NewRecorder()
	if err := m.Clear(rec, withCookies(t, m, http.MethodPost, s)); err != nil {
		t.Fatal(err)
	}
	c := cookies(rec)
	if c["ortus_sid"] == nil || c["ortus_sid"].MaxAge >= 0 || c["ortus_csrf"] == nil || c["ortus_csrf"].MaxAge >= 0 {
		t.Fatalf("cookies not expired: %v", rec.Header().Values("Set-Cookie"))
	}
	if _, err := m.Authenticate(withCookies(t, m, http.MethodGet, s)); !problem.Is(err, problem.CodeSessionExpired) {
		t.Fatalf("session survives logout: %v", err)
	}
}

func TestContext(t *testing.T) {
	t.Parallel()
	if _, ok := FromContext(t.Context()); ok {
		t.Fatal("empty context has a session")
	}
	s := Session{ID: "x", AccountID: uuid.New()}
	if got, ok := FromContext(WithSession(t.Context(), s)); !ok || got.ID != "x" {
		t.Fatalf("FromContext = %+v, %v", got, ok)
	}
}
