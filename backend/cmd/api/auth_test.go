package main

import (
	"context"
	"maps"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/session/oidc"
	"github.com/ortus/ortus-crm/backend/internal/platform/session/oidc/authhttp"
	"github.com/ortus/ortus-crm/backend/internal/platform/session/oidc/oidctest"
)

// W1.03: configuration of the OIDC provider (AUTH_PROVIDER=oidc, deploy/compose/.env.example) and the prod cookie.

func oidcEnv(extra map[string]string) map[string]string {
	m := map[string]string{
		"CONTROL_DB_URL": "postgres://x@h/c", "AUTH_PROVIDER": "oidc",
		"OIDC_ISSUER": "http://localhost:8781/realms/ortus", "OIDC_CLIENT_ID": "ortus-web", "OIDC_CLIENT_SECRET": "s3cret",
		"OIDC_REDIRECT_URL":    "http://localhost:5207/api/v1/auth/callback",
		"OPERATOR_OIDC_ISSUER": "http://localhost:8781/realms/ortus-operators",
	}
	maps.Copy(m, extra)
	return m
}

func TestLoadConfigOIDC(t *testing.T) {
	t.Parallel()
	c, err := loadConfig(env(oidcEnv(nil)))
	if err != nil {
		t.Fatal(err)
	}
	users := providerConfig{
		Issuer: "http://localhost:8781/realms/ortus", ClientID: "ortus-web", ClientSecret: "s3cret",
		RedirectURL: "http://localhost:5207/api/v1/auth/callback", PostLogoutRedirectURL: "http://localhost:5207/",
	}
	ops := users
	ops.Issuer = "http://localhost:8781/realms/ortus-operators"
	if c.AuthProvider != "oidc" || c.Users == nil || *c.Users != users || c.Operators == nil || *c.Operators != ops {
		t.Fatalf("config %+v users %+v operators %+v", c, c.Users, c.Operators)
	}
	if c.SessionCookie != "ortus_sid" || c.CookieSecure {
		t.Fatalf("dev cookie %q secure=%t", c.SessionCookie, c.CookieSecure)
	}
	c, err = loadConfig(env(oidcEnv(map[string]string{
		"OPERATOR_OIDC_CLIENT_ID": "ops-web", "OPERATOR_OIDC_CLIENT_SECRET": "ops", "OIDC_POST_LOGOUT_REDIRECT_URL": "http://localhost:5207/bye",
	})))
	if err != nil || c.Operators.ClientID != "ops-web" || c.Operators.ClientSecret != "ops" || c.Users.PostLogoutRedirectURL != "http://localhost:5207/bye" {
		t.Fatalf("overrides: %+v, %v", c.Operators, err)
	}
}

// The post-logout redirect: OIDC_POST_LOGOUT_REDIRECT_URL applies to both realms (operators inherit it like the
// client id and secret), OPERATOR_OIDC_POST_LOGOUT_REDIRECT_URL overrides it for operators; both must be absolute
// http(s) URLs (review W1.03, return 2).
func TestLoadConfigPostLogoutRedirect(t *testing.T) {
	t.Parallel()
	for name, tc := range map[string]struct {
		env             map[string]string
		users, operator string
	}{
		"default: the root of the redirect origin": {nil, "http://localhost:5207/", "http://localhost:5207/"},
		"OIDC_POST_LOGOUT_REDIRECT_URL for both realms": {
			map[string]string{"OIDC_POST_LOGOUT_REDIRECT_URL": "http://localhost:5207/bye"},
			"http://localhost:5207/bye", "http://localhost:5207/bye",
		},
		"OPERATOR_OIDC_POST_LOGOUT_REDIRECT_URL for operators": {
			map[string]string{"OPERATOR_OIDC_POST_LOGOUT_REDIRECT_URL": "http://localhost:5207/platform"},
			"http://localhost:5207/", "http://localhost:5207/platform",
		},
	} {
		c, err := loadConfig(env(oidcEnv(tc.env)))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if c.Users.PostLogoutRedirectURL != tc.users || c.Operators.PostLogoutRedirectURL != tc.operator {
			t.Errorf("%s: users %q, operators %q; want %q, %q", name, c.Users.PostLogoutRedirectURL,
				c.Operators.PostLogoutRedirectURL, tc.users, tc.operator)
		}
	}
	for _, key := range []string{"OIDC_POST_LOGOUT_REDIRECT_URL", "OPERATOR_OIDC_POST_LOGOUT_REDIRECT_URL"} {
		_, err := loadConfig(env(oidcEnv(map[string]string{key: "/bye"})))
		if err == nil || !strings.Contains(err.Error(), key) {
			t.Errorf("%s=/bye: %v, want an error about %s", key, err, key)
		}
	}
}

// The stand of executors and e2e (AUTH_PROVIDER=dev) keeps the OIDC placeholders of .env.example, including the
// SPA callback path of W0.06: they are ignored, cmd/api starts.
func TestLoadConfigDevIgnoresOIDC(t *testing.T) {
	t.Parallel()
	c, err := loadConfig(env(oidcEnv(map[string]string{"AUTH_PROVIDER": "dev", "OIDC_REDIRECT_URL": "http://localhost:5173/auth/callback"})))
	if err != nil || c.Users != nil || c.Operators != nil {
		t.Fatalf("dev: %+v %+v, %v", c.Users, c.Operators, err)
	}
}

// Q-W0.09-4: in prod the session cookie is __Host-ortus_session (the name of the contract) and always Secure.
func TestLoadConfigProdCookie(t *testing.T) {
	t.Parallel()
	https := map[string]string{
		"APP_ENV": "prod", "OIDC_ISSUER": "https://id.ortus.example/realms/ortus", "OPERATOR_OIDC_ISSUER": "",
		"OIDC_REDIRECT_URL": "https://app.ortus.example/api/v1/auth/callback", "ALLOWED_ORIGINS": "https://app.ortus.example",
	}
	c, err := loadConfig(env(oidcEnv(https)))
	if err != nil {
		t.Fatal(err)
	}
	if c.SessionCookie != "__Host-ortus_session" || !c.CookieSecure || c.Operators != nil {
		t.Fatalf("prod: cookie %q secure=%t operators %+v", c.SessionCookie, c.CookieSecure, c.Operators)
	}
	c, err = loadConfig(env(map[string]string{"CONTROL_DB_URL": "postgres://x@h/c", "SESSION_COOKIE_NAME": "__Host-sid"}))
	if err != nil || !c.CookieSecure {
		t.Fatalf("__Host- cookie in dev: secure=%t, %v; want Secure (the prefix requires it)", c.CookieSecure, err)
	}
}

func TestLoadConfigOIDCErrors(t *testing.T) {
	t.Parallel()
	prod := map[string]string{"APP_ENV": "prod", "ALLOWED_ORIGINS": "https://app.ortus.example", "OPERATOR_OIDC_ISSUER": ""}
	with := func(extra ...map[string]string) map[string]string {
		m := map[string]string{}
		for _, e := range extra {
			maps.Copy(m, e)
		}
		return oidcEnv(m)
	}
	cases := map[string]struct {
		env  map[string]string
		want string
	}{
		"oidc без OIDC_ISSUER":           {with(map[string]string{"OIDC_ISSUER": ""}), "OIDC_ISSUER"},
		"нет OIDC_CLIENT_ID":             {with(map[string]string{"OIDC_CLIENT_ID": ""}), "OIDC_CLIENT_ID"},
		"нет OIDC_CLIENT_SECRET":         {with(map[string]string{"OIDC_CLIENT_SECRET": ""}), "OIDC_CLIENT_SECRET"},
		"относительный redirect":         {with(map[string]string{"OIDC_REDIRECT_URL": "/api/v1/auth/callback"}), "OIDC_REDIRECT_URL"},
		"redirect не на callback":        {with(map[string]string{"OIDC_REDIRECT_URL": "http://localhost:5207/auth/callback"}), "OIDC_REDIRECT_URL"},
		"issuer не URL":                  {with(map[string]string{"OIDC_ISSUER": "keycloak"}), "OIDC_ISSUER"},
		"prod без https":                 {with(prod), "OIDC_ISSUER"},
		"prod с cookie без __Host-":      {with(prod, map[string]string{"SESSION_COOKIE_NAME": "ortus_sid"}), "SESSION_COOKIE_NAME"},
		"operators без issuer клиентов":  {with(map[string]string{"OIDC_ISSUER": " "}), "OIDC_ISSUER"},
		"issuer операторов не URL":       {with(map[string]string{"OPERATOR_OIDC_ISSUER": "ops"}), "OPERATOR_OIDC_ISSUER"},
		"неизвестный провайдер (oidc2)":  {with(map[string]string{"AUTH_PROVIDER": "oidc2"}), "AUTH_PROVIDER"},
		"dev-провайдер в prod с OIDC_* ": {with(prod, map[string]string{"AUTH_PROVIDER": "dev"}), "AUTH_PROVIDER"},
	}
	for name, tc := range cases {
		_, err := loadConfig(env(tc.env))
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: %v, want an error about %s", name, err, tc.want)
		}
	}
}

type newAccounts struct{}

func (newAccounts) Upsert(context.Context, oidc.Identity) (oidc.AccountRef, error) {
	return oidc.AccountRef{ID: uuid.New(), Status: "active"}, nil
}

// authDeps mounts the tag Auth over a fake identity provider, with the session store that keeps revocations.
func authDeps(t *testing.T) (deps, *oidctest.IDP) {
	t.Helper()
	idp := oidctest.New(t, "ortus-web", "s3cret")
	d := testDeps(testConfig())
	store := &oidc.MemSessionStore{}
	d.sessions.Store = store
	srv := &authhttp.Server{
		Sessions: d.sessions, Logins: &oidc.MemLoginStore{}, Accounts: newAccounts{}, Revoker: store, Log: d.log,
		Providers: authhttp.Providers{oidc.NewProvider(oidc.Config{
			Key: authhttp.ProviderUsers, Issuer: idp.Issuer, ClientID: "ortus-web", ClientSecret: "s3cret",
			RedirectURL: testOrigin + "/api/v1/auth/callback",
		})},
	}
	d.servers.Auth = srv
	d.replays = map[string]replayFunc{"logout": srv.ReplayLogout}
	return d, idp
}

// signInOIDC runs startLogin → provider → completeLogin through the gateway and keeps the cookies of the BFF.
func (c *client) signInOIDC(idp *oidctest.IDP) {
	c.t.Helper()
	rec := c.do(http.MethodGet, "/api/v1/auth/login?returnTo=%2Ft%2Fx", "", nil)
	if rec.Code != http.StatusFound {
		c.t.Fatalf("startLogin: %d %s", rec.Code, rec.Body)
	}
	c.cookies = rec.Result().Cookies()
	q, err := idp.Authorize(rec.Header().Get("Location"), oidctest.User{Subject: "kc-1", Email: "d.zimina@alta.example", EmailVerified: true, Name: "Дарья"})
	if err != nil {
		c.t.Fatal(err)
	}
	rec = c.do(http.MethodGet, "/api/v1/auth/callback?"+q.Encode(), "", nil)
	if rec.Code != http.StatusFound || rec.Header().Get("Location") != "/t/x" {
		c.t.Fatalf("completeLogin: %d %s", rec.Code, rec.Body)
	}
	c.cookies = rec.Result().Cookies()
	for _, ck := range c.cookies {
		if ck.Name == csrfCookie {
			c.csrf = ck.Value
		}
	}
}

// S1-05 through the gateway: public sign-in, the CSRF token of the session, logout with CSRF and Origin, the replay
// of logout with the same key after the session is gone (Q-W1.01-10), and 401 with a new key.
func TestAuthFlowThroughGateway(t *testing.T) {
	t.Parallel()
	d, idp := authDeps(t)
	c := newClient(t, newHandler(d))
	c.signInOIDC(idp)
	if rec := c.do(http.MethodGet, "/api/v1/auth/csrf", "", nil); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), c.csrf) {
		t.Fatalf("csrf: %d %s", rec.Code, rec.Body)
	}
	key := map[string]string{"Origin": testOrigin, "Idempotency-Key": "logout-key-00000001"}
	if rec := c.do(http.MethodPost, "/api/v1/auth/logout", "", key); rec.Code != http.StatusForbidden || codeOf(rec) != problem.CodeCSRFFailed {
		t.Fatalf("logout without CSRF: %d %s", rec.Code, rec.Body)
	}
	key["X-CSRF-Token"] = c.csrf
	first := c.do(http.MethodPost, "/api/v1/auth/logout", "", key)
	if first.Code != http.StatusOK || !strings.Contains(first.Body.String(), url.QueryEscape("ortus-web")) {
		t.Fatalf("logout: %d %s", first.Code, first.Body)
	}
	again := c.do(http.MethodPost, "/api/v1/auth/logout", "", key)
	if again.Code != http.StatusOK || again.Header().Get("Idempotency-Replayed") != "true" || again.Body.String() != first.Body.String() {
		t.Fatalf("replay: %d %v %s", again.Code, again.Header(), again.Body)
	}
	key["Idempotency-Key"] = "logout-key-00000002"
	if rec := c.do(http.MethodPost, "/api/v1/auth/logout", "", key); rec.Code != http.StatusUnauthorized || codeOf(rec) != problem.CodeSessionExpired {
		t.Fatalf("new key after logout: %d %s", rec.Code, rec.Body)
	}
	if rec := c.do(http.MethodGet, "/api/v1/auth/csrf", "", nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("csrf after logout: %d", rec.Code)
	}
}
