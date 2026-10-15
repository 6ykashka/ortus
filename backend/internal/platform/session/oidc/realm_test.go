package oidc_test

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// T-11 of the brief W1.03: the realm exports of the compose profile keycloak (deploy/compose/keycloak/, D-03 by
// default: a realm of clients and a separate realm of operators, ADR-0004) agree with what the BFF expects.

type realmFile struct {
	Realm               string        `json:"realm"`
	Enabled             bool          `json:"enabled"`
	SSLRequired         string        `json:"sslRequired"`
	RegistrationAllowed bool          `json:"registrationAllowed"`
	VerifyEmail         bool          `json:"verifyEmail"`
	BruteForceProtected bool          `json:"bruteForceProtected"`
	Clients             []realmClient `json:"clients"`
	Users               []realmUser   `json:"users"`
}

type realmClient struct {
	ClientID                  string            `json:"clientId"`
	Enabled                   bool              `json:"enabled"`
	PublicClient              bool              `json:"publicClient"`
	ClientAuthenticatorType   string            `json:"clientAuthenticatorType"`
	Secret                    string            `json:"secret"`
	StandardFlowEnabled       bool              `json:"standardFlowEnabled"`
	ImplicitFlowEnabled       bool              `json:"implicitFlowEnabled"`
	DirectAccessGrantsEnabled bool              `json:"directAccessGrantsEnabled"`
	ServiceAccountsEnabled    bool              `json:"serviceAccountsEnabled"`
	RedirectURIs              []string          `json:"redirectUris"`
	WebOrigins                []string          `json:"webOrigins"`
	Attributes                map[string]string `json:"attributes"`
}

type realmUser struct {
	Username      string `json:"username"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"emailVerified"`
	Enabled       bool   `json:"enabled"`
	FirstName     string `json:"firstName"`
	LastName      string `json:"lastName"`
	Credentials   []struct {
		Type      string `json:"type"`
		Value     string `json:"value"`
		Temporary bool   `json:"temporary"`
	} `json:"credentials"`
}

func readRealm(t *testing.T, name string) realmFile {
	t.Helper()
	dir := filepath.Join("..", "..", "..", "..", "..", "deploy", "compose", "keycloak")
	b, err := fs.ReadFile(os.DirFS(dir), name)
	must(t, err)
	var r realmFile
	must(t, json.Unmarshal(b, &r))
	return r
}

// callbacks are the redirect URIs the BFF can send: the Vite dev server (5173) and the Vite of every slot 0…20
// (5200 + slot, plan v2 §3.6), on localhost and 127.0.0.1, path /api/v1/auth/callback (contract completeLogin).
func callbacks() []string {
	var out []string
	ports := []int{5173}
	for slot := range 21 {
		ports = append(ports, 5200+slot)
	}
	for _, p := range ports {
		for _, host := range []string{"localhost", "127.0.0.1"} {
			out = append(out, fmt.Sprintf("http://%s:%d/api/v1/auth/callback", host, p))
		}
	}
	slices.Sort(out)
	return out
}

func TestRealmFiles(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct {
		file, realm  string
		registration bool
		users        []string
	}{
		{"realm-ortus.json", "ortus", true, []string{"d.zimina@alta.example", "o.petrova@alta.example"}},
		{"realm-ortus-operators.json", "ortus-operators", false, []string{"e.lapteva@ortus.example"}},
	} {
		t.Run(tt.realm, func(t *testing.T) {
			t.Parallel()
			r := readRealm(t, tt.file)
			expect(t, r.Realm == tt.realm && r.Enabled && r.SSLRequired == "external" && r.BruteForceProtected,
				"realm %q enabled=%t sslRequired=%q bruteForce=%t", r.Realm, r.Enabled, r.SSLRequired, r.BruteForceProtected)
			expect(t, r.RegistrationAllowed == tt.registration && r.VerifyEmail == tt.registration,
				"registration %t, verifyEmail %t; want %t (invited people register in the client realm only)",
				r.RegistrationAllowed, r.VerifyEmail, tt.registration)
			if len(r.Clients) != 1 {
				t.Fatalf("clients: %d, want only ortus-web", len(r.Clients))
			}
			checkClient(t, r.Clients[0])
			checkUsers(t, r.Users, tt.users)
		})
	}
}

func checkClient(t *testing.T, c realmClient) {
	t.Helper()
	expect(t, c.ClientID == "ortus-web" && c.Enabled && !c.PublicClient && c.ClientAuthenticatorType == "client-secret",
		"client %+v: want enabled confidential ortus-web", c)
	expect(t, c.Secret == "change-me-local", "secret %q, want the placeholder of deploy/compose/.env.example", c.Secret)
	expect(t, c.StandardFlowEnabled && !c.ImplicitFlowEnabled && !c.DirectAccessGrantsEnabled && !c.ServiceAccountsEnabled,
		"flows: standard=%t implicit=%t direct=%t service=%t; want the authorization code flow only",
		c.StandardFlowEnabled, c.ImplicitFlowEnabled, c.DirectAccessGrantsEnabled, c.ServiceAccountsEnabled)
	expect(t, c.Attributes["pkce.code.challenge.method"] == "S256", "PKCE method %q, want S256", c.Attributes["pkce.code.challenge.method"])
	want := callbacks()
	got := slices.Sorted(slices.Values(c.RedirectURIs))
	expect(t, slices.Equal(got, want), "redirect URIs:\n got %v\nwant %v", got, want)
	post := strings.Split(c.Attributes["post.logout.redirect.uris"], "##")
	expect(t, len(post) == len(want), "post-logout redirect URIs: %d, want %d (the root of every callback origin)", len(post), len(want))
	for _, u := range slices.Concat(got, post, c.WebOrigins) {
		expect(t, !strings.Contains(u, "*"), "wildcard %q: redirects must be exact", u)
	}
}

func checkUsers(t *testing.T, users []realmUser, want []string) {
	t.Helper()
	emails := map[string]bool{}
	for _, u := range users {
		emails[u.Email] = true
		ok := u.Enabled && u.EmailVerified && u.Username == u.Email && len(u.Credentials) == 1 &&
			u.Credentials[0].Type == "password" && !u.Credentials[0].Temporary
		expect(t, ok, "user %s: want enabled, verified e-mail as username, one permanent password", u.Email)
	}
	for _, e := range want {
		expect(t, emails[e], "user %s is missing", e)
	}
}
