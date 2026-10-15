package authhttp_test

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	authapi "github.com/ortus/ortus-crm/backend/internal/api/auth"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
	"github.com/ortus/ortus-crm/backend/internal/platform/session/oidc"
	"github.com/ortus/ortus-crm/backend/internal/platform/session/oidc/authhttp"
	"github.com/ortus/ortus-crm/backend/internal/platform/session/oidc/oidctest"
)

const (
	origin      = "http://localhost:5207"
	clientID    = "ortus-web"
	secret      = "change-me-local"
	logoutKey   = "logout-key-0000000001"
	csrfPath    = "/api/v1/auth/csrf"
	logoutPath  = "/api/v1/auth/logout"
	loginPath   = "/api/v1/auth/login"
	callback    = "/api/v1/auth/callback"
	inspectPath = "/api/v1/auth/invitations/inspect"
	acceptPath  = "/api/v1/auth/invitations/accept"
)

type fakeAccounts struct {
	mu     sync.Mutex
	status string // "" = active
	seen   []oidc.Identity
	ids    map[string]uuid.UUID
}

func (a *fakeAccounts) Upsert(_ context.Context, id oidc.Identity) (oidc.AccountRef, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.seen = append(a.seen, id)
	if a.ids == nil {
		a.ids = map[string]uuid.UUID{}
	}
	k := id.Issuer + "|" + id.Subject
	if _, ok := a.ids[k]; !ok {
		a.ids[k] = uuid.New()
	}
	st := a.status
	if st == "" {
		st = "active"
	}
	return oidc.AccountRef{ID: a.ids[k], Status: st}, nil
}

type fakeInvitations struct {
	err      error
	accepted []string
}

func (f *fakeInvitations) Inspect(context.Context, string) (authapi.InvitationPreview, error) {
	if f.err != nil {
		return authapi.InvitationPreview{}, f.err
	}
	return authapi.InvitationPreview{TenantName: "Альта Групп", InvitedEmailMasked: "o•••••@alta.example",
		Status: authapi.Pending, ExpiresAt: time.Date(2026, 10, 8, 7, 30, 0, 0, time.UTC)}, nil
}

func (f *fakeInvitations) Accept(_ context.Context, account uuid.UUID, token string) (authapi.InvitationAcceptance, error) {
	if f.err != nil {
		return authapi.InvitationAcceptance{}, f.err
	}
	f.accepted = append(f.accepted, account.String()+"|"+token)
	return authapi.InvitationAcceptance{TenantId: uuid.New(), MembershipId: uuid.New(), TenantName: "Альта Групп",
		MembershipStatus: authapi.Active}, nil
}

type env struct {
	t        *testing.T
	srv      *authhttp.Server
	sessions *oidc.MemSessionStore
	manager  *session.Manager
	logins   *oidc.MemLoginStore
	accounts *fakeAccounts
	inv      *fakeInvitations
	users    *oidctest.IDP
	ops      *oidctest.IDP
	handler  http.Handler
}

func newEnv(t *testing.T) *env {
	t.Helper()
	e := &env{t: t, sessions: &oidc.MemSessionStore{}, logins: &oidc.MemLoginStore{}, accounts: &fakeAccounts{}, inv: &fakeInvitations{}}
	e.users = oidctest.New(t, clientID, secret)
	e.ops = oidctest.New(t, clientID, secret)
	provider := func(key string, idp *oidctest.IDP) *oidc.Provider {
		return oidc.NewProvider(oidc.Config{Key: key, Issuer: idp.Issuer, ClientID: clientID, ClientSecret: secret,
			RedirectURL: origin + callback, PostLogoutRedirectURL: origin + "/"})
	}
	e.manager = &session.Manager{CookieName: "ortus_sid", CSRFCookieName: "ortus_csrf", TTL: 12 * time.Hour,
		AllowedOrigins: []string{origin}, Store: e.sessions}
	e.srv = &authhttp.Server{
		Sessions: e.manager, Logins: e.logins,
		Providers: authhttp.Providers{provider("users", e.users), provider("operators", e.ops)},
		Accounts:  e.accounts, Revoker: e.sessions, Invitations: e.inv,
		Log: slog.New(slog.DiscardHandler),
	}
	e.handler = e.build()
	return e
}

// build mounts the Auth tag like cmd/api: generated strict server, WithExchange, and a gate that puts the session
// of session-bound operations into the context (the gateway of cmd/api does it there, with CSRF and Origin).
func (e *env) build() http.Handler {
	r := chi.NewRouter()
	reqErr := func(w http.ResponseWriter, r *http.Request, err error) {
		problem.Write(w, r, problem.Wrap(problem.CodeMalformedRequest, err))
	}
	authapi.HandlerWithOptions(authapi.NewStrictHandlerWithOptions(e.srv, nil, authapi.StrictHTTPServerOptions{
		RequestErrorHandlerFunc: reqErr, ResponseErrorHandlerFunc: problem.Write,
	}), authapi.ChiServerOptions{BaseRouter: r, ErrorHandlerFunc: reqErr})
	gate := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			switch req.URL.Path {
			case csrfPath, logoutPath, acceptPath, "/api/v1/auth/realtime-tickets":
				s, err := e.manager.Authenticate(req)
				if err != nil {
					problem.Write(w, req, err)
					return
				}
				req = req.WithContext(session.WithSession(req.Context(), s))
			}
			next.ServeHTTP(w, req)
		})
	}
	return requestid.Middleware(gate(authhttp.WithExchange(r)))
}

func (e *env) do(r *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	e.handler.ServeHTTP(rec, r)
	return rec
}

func (e *env) get(target string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	r := httptest.NewRequestWithContext(e.t.Context(), http.MethodGet, target, nil)
	for _, c := range cookies {
		r.AddCookie(c)
	}
	return e.do(r)
}

func (e *env) post(target, body string, s *session.Session, hdr map[string]string) *httptest.ResponseRecorder {
	r := httptest.NewRequestWithContext(e.t.Context(), http.MethodPost, target, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", origin)
	if s != nil {
		r.AddCookie(sid(s.ID))
		r.Header.Set("X-CSRF-Token", s.CSRF)
	}
	for k, v := range hdr {
		r.Header.Set(k, v)
	}
	return e.do(r)
}

// sid is the session cookie a browser sends (attributes are not sent; set for gosec G124).
func sid(v string) *http.Cookie {
	return &http.Cookie{Name: "ortus_sid", Value: v, HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode}
}

func expect(t *testing.T, ok bool, format string, a ...any) {
	t.Helper()
	if !ok {
		t.Errorf(format, a...)
	}
}

func mustCookie(t *testing.T, rec *httptest.ResponseRecorder, name string) *http.Cookie {
	t.Helper()
	c := cookieOf(rec, name)
	if c == nil {
		t.Fatalf("no cookie %s", name)
	}
	return c
}

func cookieOf(rec *httptest.ResponseRecorder, name string) *http.Cookie {
	for _, c := range rec.Result().Cookies() {
		if c.Name == name {
			return c
		}
	}
	return nil
}

func problemCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var p struct {
		Code string `json:"code"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &p)
	return p.Code
}

func expectProblem(t *testing.T, rec *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if rec.Code != status || problemCode(t, rec) != code {
		t.Errorf("got %d %s (%s), want %d %s", rec.Code, problemCode(t, rec), rec.Body.String(), status, code)
	}
}

// start runs startLogin and returns the redirect to the provider and the pre-auth cookie.
func (e *env) start(returnTo string) (*url.URL, *http.Cookie) {
	e.t.Helper()
	rec := e.get(loginPath + "?returnTo=" + url.QueryEscape(returnTo))
	if rec.Code != http.StatusFound {
		e.t.Fatalf("startLogin: %d %s", rec.Code, rec.Body.String())
	}
	loc, err := url.Parse(rec.Header().Get("Location"))
	if err != nil {
		e.t.Fatal(err)
	}
	c := cookieOf(rec, "ortus_login")
	if c == nil {
		e.t.Fatal("no pre-auth cookie")
	}
	return loc, c
}

var zimina = oidctest.User{Subject: "kc-zimina", Email: "d.zimina@alta.example", EmailVerified: true, Name: "Дарья Зимина"}

// signIn runs the whole sign-in and returns the callback response.
func (e *env) signIn(idp *oidctest.IDP, u oidctest.User, returnTo string, extra ...*http.Cookie) *httptest.ResponseRecorder {
	e.t.Helper()
	loc, pre := e.start(returnTo)
	q, err := idp.Authorize(loc.String(), u)
	if err != nil {
		e.t.Fatal(err)
	}
	return e.get(callback+"?"+q.Encode(), append([]*http.Cookie{pre}, extra...)...)
}

func TestStartLoginRedirectsWithPKCE(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	rec := e.get(loginPath + "?returnTo=" + url.QueryEscape("/t/alta/home?tab=1"))
	expect(t, rec.Code == http.StatusFound && rec.Header().Get("Cache-Control") == "private, no-store",
		"%d, Cache-Control %q", rec.Code, rec.Header().Get("Cache-Control"))
	loc, _ := url.Parse(rec.Header().Get("Location"))
	expect(t, loc.Host == strings.TrimPrefix(e.users.Server.URL, "http://") && loc.Query().Get("code_challenge_method") == "S256" &&
		loc.Query().Get("redirect_uri") == origin+callback, "Location %s", loc)
	c := cookieOf(rec, "ortus_login")
	if c == nil {
		t.Fatal("no pre-auth cookie")
	}
	expect(t, c.HttpOnly && c.SameSite == http.SameSiteLaxMode && c.Path == "/api/v1/auth" && c.MaxAge == 600 && len(c.Value) >= 32,
		"pre-auth cookie %+v", c)
	expect(t, !strings.Contains(c.Value, loc.Query().Get("state")), "the pre-auth cookie must carry an opaque handle, not the state")
	expect(t, e.logins.Len() == 1, "sign-in records: %d", e.logins.Len())
}

// ADR-0004 (D-03 by default): the operator console under /platform signs in at the realm of operators.
func TestStartLoginPicksRealm(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	for returnTo, idp := range map[string]*oidctest.IDP{
		"/platform/tenants": e.ops, "/platform": e.ops, "/platformx": e.users, "/": e.users, "/t/a/platform": e.users,
	} {
		loc, _ := e.start(returnTo)
		if !strings.HasPrefix(loc.String(), idp.Issuer) {
			t.Errorf("returnTo %s → %s, want realm %s", returnTo, loc, idp.Issuer)
		}
	}
	// Without returnTo the application root opens.
	if rec := e.get(loginPath); rec.Code != http.StatusFound {
		t.Fatalf("no returnTo: %d", rec.Code)
	}
}

// CWE-601: returnTo is a same-origin relative path (pattern of the contract, checked again by the BFF).
func TestStartLoginRejectsForeignReturnTo(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	for _, bad := range []string{"//evil.example", `/\evil.example`, "https://evil.example/", "/a b", "home", "/a\tb",
		"/" + strings.Repeat("a", 512)} {
		rec := e.get(loginPath + "?returnTo=" + url.QueryEscape(bad))
		expectProblem(t, rec, http.StatusBadRequest, problem.CodeMalformedRequest)
	}
	if e.logins.Len() != 0 {
		t.Fatal("a rejected start must not store a sign-in record")
	}
}

func TestStartLoginWithoutProvider(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	e.srv.Providers = nil
	expectProblem(t, e.get(loginPath), http.StatusServiceUnavailable, problem.CodeDependencyUnavailable)
}

func TestCompleteLoginIssuesSession(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	old, _ := e.manager.Issue(httptest.NewRecorder(), httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil), uuid.New())
	auth := time.Now().Add(-time.Minute).Truncate(time.Second)
	u := zimina
	u.AuthTime = auth
	rec := e.signIn(e.users, u, "/t/alta/home", sid(old.ID))
	if rec.Code != http.StatusFound || rec.Header().Get("Location") != "/t/alta/home" {
		t.Fatalf("callback: %d Location %q %s", rec.Code, rec.Header().Get("Location"), rec.Body.String())
	}
	sc, csrf, pre := mustCookie(t, rec, "ortus_sid"), mustCookie(t, rec, "ortus_csrf"), mustCookie(t, rec, "ortus_login")
	expect(t, sc.HttpOnly && sc.Value != old.ID && !csrf.HttpOnly, "session cookies: %+v %+v", sc, csrf)
	expect(t, pre.MaxAge < 0 && pre.Path == "/api/v1/auth", "pre-auth cookie must be expired: %+v", pre)
	s, err := e.sessions.Get(t.Context(), sc.Value)
	expect(t, err == nil && s.Provider == e.users.Issuer && s.AuthTime.Equal(auth) && s.CSRF == csrf.Value, "session %+v, %v", s, err)
	_, err = e.sessions.Get(t.Context(), old.ID)
	expect(t, errors.Is(err, session.ErrNotFound), "the previous session must end on a new sign-in (session fixation)")
	seen := e.accounts.seen
	expect(t, len(seen) == 1 && seen[0].Subject == "kc-zimina" && seen[0].Issuer == e.users.Issuer, "accounts: %+v", seen)
}
func TestCompleteLoginRefusals(t *testing.T) {
	t.Parallel()
	t.Run("no pre-auth cookie", func(t *testing.T) {
		t.Parallel()
		e := newEnv(t)
		loc, _ := e.start("/")
		q, _ := e.users.Authorize(loc.String(), zimina)
		expectProblem(t, e.get(callback+"?"+q.Encode()), http.StatusUnauthorized, problem.CodeSessionExpired)
	})
	t.Run("foreign state", func(t *testing.T) {
		t.Parallel()
		e := newEnv(t)
		loc, pre := e.start("/")
		q, _ := e.users.Authorize(loc.String(), zimina)
		q.Set("state", "forged-state-0000000000000")
		expectProblem(t, e.get(callback+"?"+q.Encode(), pre), http.StatusUnauthorized, problem.CodeSessionExpired)
		if e.logins.Len() != 0 {
			t.Fatal("a failed callback must consume the record")
		}
	})
	t.Run("replayed callback", func(t *testing.T) {
		t.Parallel()
		e := newEnv(t)
		loc, pre := e.start("/")
		q, _ := e.users.Authorize(loc.String(), zimina)
		if rec := e.get(callback+"?"+q.Encode(), pre); rec.Code != http.StatusFound {
			t.Fatalf("first callback: %d", rec.Code)
		}
		expectProblem(t, e.get(callback+"?"+q.Encode(), pre), http.StatusUnauthorized, problem.CodeSessionExpired)
	})
	t.Run("access denied by the provider", func(t *testing.T) {
		t.Parallel()
		e := newEnv(t)
		loc, pre := e.start("/")
		q := url.Values{"state": {loc.Query().Get("state")}, "error": {"access_denied"}}
		expectProblem(t, e.get(callback+"?"+q.Encode(), pre), http.StatusForbidden, problem.CodeForbiddenAction)
	})
	t.Run("no code", func(t *testing.T) {
		t.Parallel()
		e := newEnv(t)
		loc, pre := e.start("/")
		q := url.Values{"state": {loc.Query().Get("state")}}
		expectProblem(t, e.get(callback+"?"+q.Encode(), pre), http.StatusBadRequest, problem.CodeMalformedRequest)
	})
}

func TestCompleteLoginRefusesAccounts(t *testing.T) {
	t.Parallel()
	t.Run("unverified e-mail", func(t *testing.T) {
		t.Parallel()
		e := newEnv(t)
		u := zimina
		u.EmailVerified = false
		expectProblem(t, e.signIn(e.users, u, "/"), http.StatusForbidden, problem.CodeForbiddenAction)
		if len(e.accounts.seen) != 0 {
			t.Fatal("no account for an unverified e-mail")
		}
	})
	t.Run("locked account", func(t *testing.T) {
		t.Parallel()
		e := newEnv(t)
		e.accounts.status = "locked"
		rec := e.signIn(e.users, zimina, "/")
		expectProblem(t, rec, http.StatusForbidden, problem.CodeForbiddenAction)
		if cookieOf(rec, "ortus_sid") != nil {
			t.Fatal("no session for a locked account")
		}
	})
	t.Run("provider down", func(t *testing.T) {
		t.Parallel()
		e := newEnv(t)
		e.users.TokenStatus = http.StatusServiceUnavailable
		expectProblem(t, e.signIn(e.users, zimina, "/"), http.StatusServiceUnavailable, problem.CodeDependencyUnavailable)
	})
}

// signedIn returns a live session of the users realm.
func (e *env) signedIn() session.Session {
	e.t.Helper()
	rec := e.signIn(e.users, zimina, "/")
	s, err := e.sessions.Get(e.t.Context(), cookieOf(rec, "ortus_sid").Value)
	if err != nil {
		e.t.Fatal(err)
	}
	return s
}

func TestGetCsrfToken(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	s := e.signedIn()
	rec := e.get(csrfPath, sid(s.ID))
	var body authapi.CsrfToken
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	if body.CsrfToken != s.CSRF || body.HeaderName != authapi.XCSRFToken || !body.ExpiresAt.Equal(s.ExpiresAt) ||
		rec.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("body %+v", body)
	}
	expectProblem(t, e.get(csrfPath), http.StatusUnauthorized, problem.CodeSessionExpired)
}

func logoutBody(t *testing.T, rec *httptest.ResponseRecorder) *string {
	t.Helper()
	var body authapi.LogoutResult
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("%d %s: %v", rec.Code, rec.Body.String(), err)
	}
	return body.EndSessionUrl
}

func TestLogout(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	s := e.signedIn()
	rec := e.post(logoutPath, "", &s, map[string]string{"Idempotency-Key": logoutKey})
	if rec.Code != http.StatusOK {
		t.Fatalf("logout: %d %s", rec.Code, rec.Body.String())
	}
	end := logoutBody(t, rec)
	if end == nil || !strings.HasPrefix(*end, e.users.Issuer+"/protocol/openid-connect/logout?") || !strings.Contains(*end, "client_id=ortus-web") {
		t.Fatalf("endSessionUrl %v", end)
	}
	if c := cookieOf(rec, "ortus_sid"); c == nil || c.MaxAge >= 0 {
		t.Fatalf("session cookie must be expired: %+v", c)
	}
	rv, err := e.sessions.Revoked(t.Context(), s.ID)
	if err != nil || rv.LogoutKey != logoutKey {
		t.Fatalf("revoked %+v, %v", rv, err)
	}
}

// A dev session has no provider: endSessionUrl is null.
func TestLogoutDevSession(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	s, err := e.manager.Issue(httptest.NewRecorder(), httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/", nil), uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	rec := e.post(logoutPath, "", &s, map[string]string{"Idempotency-Key": logoutKey})
	if rec.Code != http.StatusOK || logoutBody(t, rec) != nil || !strings.Contains(rec.Body.String(), `"endSessionUrl":null`) {
		t.Fatalf("dev logout: %d %s", rec.Code, rec.Body.String())
	}
}

// Q-W1.01-10: the gateway refuses a revoked session (401) before idem.Guard, so cmd/api asks ReplayLogout first.
func TestReplayLogout(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	s := e.signedIn()
	first := e.post(logoutPath, "", &s, map[string]string{"Idempotency-Key": logoutKey})
	replay := func(key, csrf, from string) (bool, *httptest.ResponseRecorder) {
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, logoutPath, nil)
		r.AddCookie(sid(s.ID))
		r.Header.Set("Idempotency-Key", key)
		r.Header.Set("X-CSRF-Token", csrf)
		r.Header.Set("Origin", from)
		rec := httptest.NewRecorder()
		return e.srv.ReplayLogout(rec, r), rec
	}
	ok, rec := replay(logoutKey, s.CSRF, origin)
	if !ok || rec.Code != http.StatusOK || rec.Body.String() != first.Body.String() ||
		rec.Header().Get("Idempotency-Replayed") != "true" || rec.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("replay: %t %d %s, want the first answer %s", ok, rec.Code, rec.Body.String(), first.Body.String())
	}
	if c := cookieOf(rec, "ortus_sid"); c == nil || c.MaxAge >= 0 {
		t.Fatal("a replay expires the cookies again")
	}
	for name, args := range map[string][3]string{
		"another key":    {"another-key-00000000001", s.CSRF, origin},
		"foreign CSRF":   {logoutKey, "forged", origin},
		"foreign Origin": {logoutKey, s.CSRF, "http://evil.example"},
	} {
		if ok, _ := replay(args[0], args[1], args[2]); ok {
			t.Errorf("%s: replayed, want 401 from the gateway", name)
		}
	}
	live := e.signedIn()
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, logoutPath, nil)
	r.AddCookie(sid(live.ID))
	r.Header.Set("Idempotency-Key", logoutKey)
	if e.srv.ReplayLogout(httptest.NewRecorder(), r) {
		t.Error("a live session is not a replay")
	}
}

const token = "invitation-token-0123456789abcdefghij"

func TestInspectInvitation(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	rec := e.post(inspectPath, `{"token":"`+token+`"}`, nil, nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "o•••••@alta.example") ||
		rec.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("inspect: %d %s", rec.Code, rec.Body.String())
	}
	expectProblem(t, e.post(inspectPath, `{"token":"short"}`, nil, nil), http.StatusUnprocessableEntity, "validation_failed")
	expectProblem(t, e.post(inspectPath, `{"token":"`+token+`"}`, nil, map[string]string{"Origin": "http://evil.example"}),
		http.StatusForbidden, problem.CodeOriginNotAllowed)
	e.inv.err = problem.New(problem.CodeNotFound, "")
	expectProblem(t, e.post(inspectPath, `{"token":"`+token+`"}`, nil, nil), http.StatusNotFound, problem.CodeNotFound)
}

func TestAcceptInvitation(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	s := e.signedIn()
	rec := e.post(acceptPath, `{"token":"`+token+`"}`, &s, map[string]string{"Idempotency-Key": "accept-key-000000001"})
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"membershipStatus":"active"`) {
		t.Fatalf("accept: %d %s", rec.Code, rec.Body.String())
	}
	if len(e.inv.accepted) != 1 || e.inv.accepted[0] != s.AccountID.String()+"|"+token {
		t.Fatalf("accepted %v", e.inv.accepted)
	}
	expectProblem(t, e.post(acceptPath, `{"token":"x"}`, &s, map[string]string{"Idempotency-Key": "accept-key-000000002"}),
		http.StatusUnprocessableEntity, "validation_failed")
	e.inv.err = problem.New("seats_exhausted", "")
	expectProblem(t, e.post(acceptPath, `{"token":"`+token+`"}`, &s, map[string]string{"Idempotency-Key": "accept-key-000000003"}),
		http.StatusConflict, "seats_exhausted")
}

type fakeTickets struct{}

func (fakeTickets) Issue(_ context.Context, sess session.Session) (authapi.RealtimeTicket, error) {
	return authapi.RealtimeTicket{Ticket: "ticket-of-" + sess.ID, Path: "/api/v1/realtime", Protocol: "ortus.realtime.v1",
		ExpiresAt: time.Now().Add(time.Minute), HeartbeatSeconds: 25}, nil
}

// createRealtimeTicket (contract 0.4.0-stage1) belongs to the realtime channel of W1.07: 501 until it is wired.
func TestCreateRealtimeTicket(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	s := e.signedIn()
	expectProblem(t, e.post("/api/v1/auth/realtime-tickets", "", &s, nil), http.StatusNotImplemented, problem.CodeNotImplemented)
	e.srv.Realtime = fakeTickets{}
	rec := e.post("/api/v1/auth/realtime-tickets", "", &s, nil)
	expect(t, rec.Code == http.StatusCreated && strings.Contains(rec.Body.String(), "ticket-of-"+s.ID) &&
		rec.Header().Get("Cache-Control") == "private, no-store", "ticket: %d %s", rec.Code, rec.Body.String())
}
