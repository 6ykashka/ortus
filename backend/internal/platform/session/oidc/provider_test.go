package oidc_test

import (
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/ortus/ortus-crm/backend/internal/platform/session/oidc"
	"github.com/ortus/ortus-crm/backend/internal/platform/session/oidc/oidctest"
)

const (
	clientID    = "ortus-web"
	secret      = "s3cret/with+chars"
	redirectURL = "http://localhost:5207/api/v1/auth/callback"
	afterLogout = "http://localhost:5207/"
)

func newProvider(t *testing.T) (*oidc.Provider, *oidctest.IDP) {
	t.Helper()
	idp := oidctest.New(t, clientID, secret)
	return oidc.NewProvider(oidc.Config{
		Key: "users", Issuer: idp.Issuer, ClientID: clientID, ClientSecret: secret,
		RedirectURL: redirectURL, PostLogoutRedirectURL: afterLogout,
	}), idp
}

var zimina = oidctest.User{Subject: "kc-1", Email: " D.Zimina@Alta.Example ", EmailVerified: true, Name: "Дарья Зимина"}

// signIn runs the browser part: authorization URL → IdP → code and state.
func signIn(t *testing.T, p *oidc.Provider, idp *oidctest.IDP, u oidctest.User) (code, verifier, nonce string) {
	t.Helper()
	verifier, challenge, err := oidc.NewPKCE()
	if err != nil {
		t.Fatal(err)
	}
	nonce = "nonce-" + verifier[:8]
	authURL, err := p.AuthURL(t.Context(), "state-1234567890abcdef", nonce, challenge)
	if err != nil {
		t.Fatal(err)
	}
	q, err := idp.Authorize(authURL, u)
	if err != nil {
		t.Fatal(err)
	}
	return q.Get("code"), verifier, nonce
}

func TestPKCE(t *testing.T) {
	t.Parallel()
	v1, c1, err := oidc.NewPKCE()
	if err != nil {
		t.Fatal(err)
	}
	v2, _, _ := oidc.NewPKCE()
	if len(v1) != 43 || v1 == v2 {
		t.Fatalf("verifier %q (len %d), second %q: want 43 random characters", v1, len(v1), v2)
	}
	sum := sha256.Sum256([]byte(v1))
	if c1 != base64.RawURLEncoding.EncodeToString(sum[:]) {
		t.Fatalf("challenge %q is not S256 of the verifier", c1)
	}
	tok, err := oidc.RandomToken()
	if err != nil || len(tok) != 43 {
		t.Fatalf("RandomToken = %q, %v", tok, err)
	}
}

// S1-05: the BFF sends the user to the authorization endpoint of the discovery document with response_type=code,
// PKCE S256, state, nonce, its client id and redirect URI.
func TestProviderAuthURL(t *testing.T) {
	t.Parallel()
	p, idp := newProvider(t)
	raw, err := p.AuthURL(t.Context(), "state-1", "nonce-1", "challenge-1")
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(raw)
	if got := u.Scheme + "://" + u.Host + u.Path; got != idp.Issuer+"/protocol/openid-connect/auth" {
		t.Fatalf("endpoint %s", got)
	}
	q := u.Query()
	want := map[string]string{
		"response_type": "code", "client_id": clientID, "redirect_uri": redirectURL, "scope": "openid email profile",
		"state": "state-1", "nonce": "nonce-1", "code_challenge": "challenge-1", "code_challenge_method": "S256",
	}
	for k, v := range want {
		if q.Get(k) != v {
			t.Errorf("%s = %q, want %q", k, q.Get(k), v)
		}
	}
}

func TestProviderDiscoveryFailures(t *testing.T) {
	t.Parallel()
	t.Run("issuer mismatch", func(t *testing.T) {
		t.Parallel()
		idp := oidctest.New(t, clientID, secret)
		p := oidc.NewProvider(oidc.Config{Issuer: idp.Issuer + "-other", ClientID: clientID, RedirectURL: redirectURL})
		if _, err := p.AuthURL(t.Context(), "s", "n", "c"); !errors.Is(err, oidc.ErrUnavailable) {
			t.Fatalf("err = %v, want ErrUnavailable", err)
		}
	})
	t.Run("provider down", func(t *testing.T) {
		t.Parallel()
		idp := oidctest.New(t, clientID, secret)
		idp.Server.Close()
		p := oidc.NewProvider(oidc.Config{Issuer: idp.Issuer, ClientID: clientID, RedirectURL: redirectURL})
		if _, err := p.AuthURL(t.Context(), "s", "n", "c"); !errors.Is(err, oidc.ErrUnavailable) {
			t.Fatalf("err = %v, want ErrUnavailable", err)
		}
	})
}

// The code is exchanged with the PKCE verifier and client credentials; the ID token is verified and mapped.
func TestExchange(t *testing.T) {
	t.Parallel()
	p, idp := newProvider(t)
	auth := time.Now().Add(-2 * time.Minute).Truncate(time.Second)
	u := zimina
	u.AuthTime = auth
	code, verifier, nonce := signIn(t, p, idp, u)
	id, err := p.Exchange(t.Context(), code, verifier, nonce)
	must(t, err)
	expect(t, id.Issuer == idp.Issuer && id.Subject == "kc-1" && id.Email == "d.zimina@alta.example" && id.EmailVerified &&
		id.Name == "Дарья Зимина" && id.AuthTime.Equal(auth), "identity = %+v", id)
	reqs := idp.TokenRequests()
	expect(t, len(reqs) == 1 && reqs[0].Get("code_verifier") == verifier && reqs[0].Get("redirect_uri") == redirectURL &&
		reqs[0].Get("grant_type") == "authorization_code", "token requests = %v", reqs)
	expect(t, !strings.Contains(reqs[0].Encode(), "s3cret"), "client secret must go in Authorization, not in the form")
	// The code is single use.
	_, err = p.Exchange(t.Context(), code, verifier, nonce)
	expectIs(t, err, oidc.ErrRejected, "second exchange")
}
func TestExchangeRejects(t *testing.T) {
	t.Parallel()
	t.Run("wrong verifier", func(t *testing.T) {
		t.Parallel()
		p, idp := newProvider(t)
		code, _, nonce := signIn(t, p, idp, zimina)
		other, _, _ := oidc.NewPKCE()
		if _, err := p.Exchange(t.Context(), code, other, nonce); !errors.Is(err, oidc.ErrRejected) {
			t.Fatalf("err = %v, want ErrRejected", err)
		}
	})
	t.Run("wrong nonce", func(t *testing.T) {
		t.Parallel()
		p, idp := newProvider(t)
		code, verifier, _ := signIn(t, p, idp, zimina)
		if _, err := p.Exchange(t.Context(), code, verifier, "another-nonce"); !errors.Is(err, oidc.ErrRejected) {
			t.Fatalf("err = %v, want ErrRejected", err)
		}
	})
	t.Run("token endpoint down", func(t *testing.T) {
		t.Parallel()
		p, idp := newProvider(t)
		code, verifier, nonce := signIn(t, p, idp, zimina)
		idp.TokenStatus = 503
		if _, err := p.Exchange(t.Context(), code, verifier, nonce); !errors.Is(err, oidc.ErrUnavailable) {
			t.Fatalf("err = %v, want ErrUnavailable", err)
		}
	})
}

// ID token checks (OIDC Core 3.1.3.7): signature by a key of the JWKS, alg allowlist, iss, aud/azp, exp, iat,
// nonce, sub.
func TestVerifyIDToken(t *testing.T) {
	t.Parallel()
	p, idp := newProvider(t)
	now := time.Now()
	base := func() map[string]any {
		return map[string]any{
			"iss": idp.Issuer, "sub": "kc-1", "aud": clientID, "exp": now.Add(time.Minute).Unix(), "iat": now.Unix(),
			"nonce": "n-1", "email": "a@b.example", "email_verified": true,
		}
	}
	with := func(k string, v any) map[string]any {
		c := base()
		if v == nil {
			delete(c, k)
		} else {
			c[k] = v
		}
		return c
	}
	if _, err := p.VerifyIDToken(t.Context(), idp.Sign(base()), "n-1"); err != nil {
		t.Fatalf("valid token: %v", err)
	}
	if _, err := p.VerifyIDToken(t.Context(), idp.Sign(with("aud", []string{"other", clientID})), "n-1"); !errors.Is(err, oidc.ErrRejected) {
		t.Errorf("several audiences without azp: %v, want ErrRejected", err)
	}
	multi := with("aud", []string{"other", clientID})
	multi["azp"] = clientID
	if _, err := p.VerifyIDToken(t.Context(), idp.Sign(multi), "n-1"); err != nil {
		t.Errorf("several audiences with azp = client: %v", err)
	}
	bad := map[string]string{
		"foreign issuer":   idp.Sign(with("iss", "http://evil.example/realms/test")),
		"foreign audience": idp.Sign(with("aud", "other-client")),
		"foreign azp":      idp.Sign(with("azp", "other-client")),
		"expired":          idp.Sign(with("exp", now.Add(-2*time.Minute).Unix())),
		"issued in future": idp.Sign(with("iat", now.Add(10*time.Minute).Unix())),
		"no exp":           idp.Sign(with("exp", nil)),
		"no sub":           idp.Sign(with("sub", "")),
		"other nonce":      idp.Sign(with("nonce", "n-2")),
		"alg none":         idp.SignWith(map[string]any{"alg": "none"}, base()),
		"alg HS256":        idp.SignWith(map[string]any{"alg": "HS256", "kid": "x"}, base()),
		"unknown kid":      idp.SignWith(map[string]any{"alg": "RS256", "kid": "missing"}, base()),
		"not a JWT":        "abc.def",
		"tampered payload": tamper(idp.Sign(base())),
	}
	for name, raw := range bad {
		if _, err := p.VerifyIDToken(t.Context(), raw, "n-1"); !errors.Is(err, oidc.ErrRejected) {
			t.Errorf("%s: %v, want ErrRejected", name, err)
		}
	}
}

func tamper(raw string) string {
	parts := strings.Split(raw, ".")
	parts[1] = base64.RawURLEncoding.EncodeToString([]byte(`{"iss":"x","sub":"admin"}`))
	return strings.Join(parts, ".")
}

// A key rotation at the provider: an unknown kid refetches the JWKS once; ES256 keys are accepted.
func TestVerifyAfterKeyRotation(t *testing.T) {
	t.Parallel()
	p, idp := newProvider(t)
	code, verifier, nonce := signIn(t, p, idp, zimina)
	if _, err := p.Exchange(t.Context(), code, verifier, nonce); err != nil {
		t.Fatal(err)
	}
	hits := idp.JWKSHits()
	idp.RotateKey("ES256")
	code, verifier, nonce = signIn(t, p, idp, zimina)
	if _, err := p.Exchange(t.Context(), code, verifier, nonce); err != nil {
		t.Fatalf("after rotation: %v", err)
	}
	if got := idp.JWKSHits(); got != hits+1 {
		t.Fatalf("JWKS fetched %d times after rotation, want %d", got, hits+1)
	}
}

// Logout: RP-initiated logout URL of the provider with the client id and the post-logout redirect, or nil.
func TestEndSessionURL(t *testing.T) {
	t.Parallel()
	p, idp := newProvider(t)
	got, err := p.EndSessionURL(t.Context())
	if err != nil || got == nil {
		t.Fatalf("EndSessionURL = %v, %v", got, err)
	}
	u, _ := url.Parse(*got)
	if u.Path != "/realms/test/protocol/openid-connect/logout" || u.Query().Get("client_id") != clientID ||
		u.Query().Get("post_logout_redirect_uri") != afterLogout {
		t.Fatalf("end session URL %s", *got)
	}
	p2, idp2 := newProvider(t)
	idp2.NoEndSession = true
	if got, err := p2.EndSessionURL(t.Context()); err != nil || got != nil {
		t.Fatalf("without end_session_endpoint: %v, %v; want nil", got, err)
	}
	_ = idp
}
