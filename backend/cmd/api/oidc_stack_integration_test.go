//go:build integration

package main

// T-10 of the brief W1.03 (S1-05…S1-07): the whole sign-in on the seeded stack — startLogin → identity provider
// (fake, oidctest) → completeLogin → durable session in the control DB → acceptInvitation (seed «Альта Групп»,
// invited Олеся Петрова) → /me/context with lastTenantId → selectTenant → a new API process keeps the session →
// logout and its replay.

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/modules/access/invitations"
	"github.com/ortus/ortus-crm/backend/internal/platform/session/oidc/oidctest"
	"github.com/ortus/ortus-crm/backend/migrations"
)

const stackOrigin = "http://127.0.0.1:5213"

// oidcServer starts cmd/api over the stack like main (build) with the OIDC provider idp.
func oidcServer(t *testing.T, idp *oidctest.IDP) *httptest.Server {
	t.Helper()
	cfg := config{
		AppEnv: envE2E, AuthProvider: envOIDC, ControlDBURL: stack.URL(controlDB, migrations.RoleAPI),
		SessionCookie: "ortus_sid", SessionTTL: time.Hour, AllowedOrigins: []string{stackOrigin},
		Users: &providerConfig{
			Issuer: idp.Issuer, ClientID: idp.ClientID, ClientSecret: idp.ClientSecret,
			RedirectURL: stackOrigin + "/api/v1/auth/callback", PostLogoutRedirectURL: stackOrigin + "/",
		},
	}
	getenv := func(k string) string {
		if k == "TENANT_DB_URL" {
			return stack.URL("postgres", migrations.RoleAPI)
		}
		return ""
	}
	d, closeDeps, err := build(t.Context(), cfg, slog.New(slog.DiscardHandler), getenv)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(newHandler(d))
	t.Cleanup(func() {
		srv.Close()
		closeDeps()
	})
	return srv
}

// spa is the browser of the SPA: cookies of one origin, no automatic redirects.
type spa struct {
	t    *testing.T
	base string
	jar  http.CookieJar
	http *http.Client
	csrf string
}

func newSPA(t *testing.T, srv *httptest.Server) *spa {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	return &spa{t: t, base: srv.URL, jar: jar, http: &http.Client{
		Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

// to points the browser at another API process (same cookies).
func (b *spa) to(srv *httptest.Server) {
	u, _ := url.Parse(b.base)
	b.base = srv.URL
	nu, _ := url.Parse(srv.URL)
	b.jar.SetCookies(nu, b.jar.Cookies(u))
}

// reply is a read and closed response.
type reply struct {
	status int
	header http.Header
	body   map[string]any
}

func (b *spa) send(method, path, body string, hdr map[string]string) reply {
	b.t.Helper()
	req, err := http.NewRequestWithContext(b.t.Context(), method, b.base+path, strings.NewReader(body))
	if err != nil {
		b.t.Fatal(err)
	}
	req.Header.Set("Origin", stackOrigin)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if b.csrf != "" {
		req.Header.Set("X-CSRF-Token", b.csrf)
	}
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	resp, err := b.http.Do(req)
	if err != nil {
		b.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	out := reply{status: resp.StatusCode, header: resp.Header}
	_ = json.Unmarshal(raw, &out.body)
	return out
}

func check(t *testing.T, ok bool, format string, a ...any) {
	t.Helper()
	if !ok {
		t.Fatalf(format, a...)
	}
}

// signIn: startLogin → the provider signs user in → completeLogin; the CSRF token comes from getCsrfToken.
func (b *spa) signIn(idp *oidctest.IDP, u oidctest.User) {
	b.t.Helper()
	r := b.send(http.MethodGet, "/api/v1/auth/login?returnTo=%2F", "", nil)
	check(b.t, r.status == http.StatusFound, "startLogin: %d", r.status)
	q, err := idp.Authorize(r.header.Get("Location"), u)
	if err != nil {
		b.t.Fatal(err)
	}
	r = b.send(http.MethodGet, "/api/v1/auth/callback?"+q.Encode(), "", nil)
	check(b.t, r.status == http.StatusFound && r.header.Get("Location") == "/", "completeLogin: %d %v", r.status, r.header)
	r = b.send(http.MethodGet, "/api/v1/auth/csrf", "", nil)
	check(b.t, r.status == http.StatusOK, "csrf: %d %v", r.status, r.body)
	b.csrf, _ = r.body["csrfToken"].(string)
}

// inviteSeededPetrova issues an invitation for the seeded invited person of «Альта Групп» (the owner invites).
func inviteSeededPetrova(t *testing.T) (token, tenantID string) {
	t.Helper()
	ctx := t.Context()
	db, err := pgxpool.New(ctx, stack.URL(controlDB, migrations.RoleAPI))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var (
		d     invitations.Draft
		owner uuid.UUID
	)
	err = db.QueryRow(ctx, `
select p.tenant_id, p.person_profile_id, o.id
  from memberships p join accounts pa on pa.id = p.account_id and pa.subject = 'acc-6'
  join memberships o on o.tenant_id = p.tenant_id
  join accounts oa on oa.id = o.account_id and oa.subject = 'acc-1'`).Scan(&d.TenantID, &d.PersonProfileID, &owner)
	if err != nil {
		t.Fatal(err)
	}
	d.CreatedBy, d.Email = &owner, "o.petrova@alta.example"
	tok, _, err := invitations.Issue(ctx, db, d)
	if err != nil {
		t.Fatal(err)
	}
	return tok, d.TenantID.String()
}

func TestStackOIDCLogin(t *testing.T) { //nolint:paralleltest // one seeded stack shared with TestStack*
	idp := oidctest.New(t, "ortus-web", "s3cret")
	b := newSPA(t, oidcServer(t, idp))
	b.signIn(idp, oidctest.User{Subject: "kc-petrova", Email: "O.Petrova@alta.example", EmailVerified: true, Name: "Олеся Петрова"})
	r := b.send(http.MethodGet, "/api/v1/me/context", "", nil)
	check(t, r.status == http.StatusOK && r.body["displayName"] == "Олеся Петрова" && len(tenantNames(r.body)) == 0 &&
		r.body["lastTenantId"] == nil, "new identity: %d %v", r.status, r.body)

	alta := acceptSeededInvitation(t, b)

	// Q-W0.09-8: the session lives in the control DB — another API process accepts it.
	b.to(oidcServer(t, idp))
	r = b.send(http.MethodPut, "/api/v1/me/selected-tenant", `{"tenantId":"`+alta+`"}`,
		map[string]string{"Idempotency-Key": "select-key-000000001"})
	check(t, r.status == http.StatusOK && r.body["lastTenantId"] == alta, "selectTenant after restart: %d %v", r.status, r.body)

	logoutAndReplay(t, b, idp)
}

// acceptSeededInvitation: the new identity accepts the invitation of the seeded invited Олеся Петрова (S1-06).
func acceptSeededInvitation(t *testing.T, b *spa) string {
	t.Helper()
	token, alta := inviteSeededPetrova(t)
	r := b.send(http.MethodPost, "/api/v1/auth/invitations/inspect", `{"token":"`+token+`"}`, nil)
	check(t, r.status == http.StatusOK && r.body["status"] == "pending" && r.body["invitedEmailMasked"] == "o•••••@alta.example",
		"inspect: %d %v", r.status, r.body)
	r = b.send(http.MethodPost, "/api/v1/auth/invitations/accept", `{"token":"`+token+`"}`,
		map[string]string{"Idempotency-Key": "accept-key-000000001"})
	check(t, r.status == http.StatusOK && r.body["tenantId"] == alta && r.body["membershipStatus"] == "active", "accept: %d %v", r.status, r.body)
	r = b.send(http.MethodGet, "/api/v1/me/context", "", nil)
	check(t, r.status == http.StatusOK && r.body["lastTenantId"] == alta && len(tenantNames(r.body)) == 1,
		"after acceptance: %d %v", r.status, r.body)
	return alta
}

// logoutAndReplay: logout returns the end-session URL of the provider; the answer is lost, the browser repeats with
// the same key and the cookies it still has — the same 200 (Q-W1.01-10); then the session is gone.
func logoutAndReplay(t *testing.T, b *spa, idp *oidctest.IDP) {
	t.Helper()
	key := map[string]string{"Idempotency-Key": "logout-key-000000001"}
	base, _ := url.Parse(b.base)
	cookies := b.jar.Cookies(base)
	r := b.send(http.MethodPost, "/api/v1/auth/logout", "", key)
	end, _ := r.body["endSessionUrl"].(string)
	check(t, r.status == http.StatusOK && strings.HasPrefix(end, idp.Issuer+"/protocol/openid-connect/logout?"), "logout: %d %v", r.status, r.body)
	b.jar.SetCookies(base, cookies)
	r = b.send(http.MethodPost, "/api/v1/auth/logout", "", key)
	check(t, r.status == http.StatusOK && r.header.Get("Idempotency-Replayed") == "true", "logout replay: %d %v", r.status, r.header)
	r = b.send(http.MethodGet, "/api/v1/me/context", "", nil)
	check(t, r.status == http.StatusUnauthorized, "after logout: %d", r.status)
}
