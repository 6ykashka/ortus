// Package oidctest is a fake OpenID Connect provider for tests of the BFF sign-in (W1.03): discovery, an
// authorization endpoint driven by the test (Authorize plays the browser and the user), a token endpoint that
// checks the client, the redirect URI and the PKCE verifier and issues signed ID tokens, JWKS and an end-session
// endpoint. It is test support only; nothing in production imports it.
package oidctest

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

// errKey is the error member of an OAuth 2.0 error response.
const errKey = "error"

// User is the person who signs in at the provider.
type User struct {
	Subject       string
	Email         string
	EmailVerified bool
	Name          string
	AuthTime      time.Time // zero: now
}

type grant struct {
	challenge, redirectURI, nonce string
	user                          User
}

// IDP is the fake provider. Fields may be changed between requests under the test's own synchronization.
type IDP struct {
	Server       *httptest.Server
	Issuer       string
	ClientID     string
	ClientSecret string
	// Now is the clock of issued tokens (nil: time.Now).
	Now func() time.Time
	// NoEndSession hides end_session_endpoint from discovery.
	NoEndSession bool
	// TokenStatus forces the status of the token endpoint (0: normal behaviour), e.g. 503.
	TokenStatus int
	// Claims are merged into every issued ID token (override or add claims).
	Claims map[string]any

	mu        sync.Mutex
	alg       string
	kid       string
	rsaKey    *rsa.PrivateKey
	ecKey     *ecdsa.PrivateKey
	codes     map[string]grant
	tokenReqs []url.Values
	jwksHits  int
}

// New starts a provider whose issuer is its own URL plus /realms/test; it is closed with the test.
func New(tb testing.TB, clientID, clientSecret string) *IDP {
	tb.Helper()
	p := &IDP{ClientID: clientID, ClientSecret: clientSecret, codes: map[string]grant{}}
	p.RotateKey("RS256")
	mux := http.NewServeMux()
	mux.HandleFunc("GET /realms/test/.well-known/openid-configuration", p.discovery)
	mux.HandleFunc("POST /realms/test/protocol/openid-connect/token", p.token)
	mux.HandleFunc("GET /realms/test/protocol/openid-connect/certs", p.jwks)
	p.Server = httptest.NewServer(mux)
	p.Issuer = p.Server.URL + "/realms/test"
	tb.Cleanup(p.Server.Close)
	return p
}

// RotateKey replaces the signing key (alg RS256 or ES256) with a new key id.
func (p *IDP) RotateKey(alg string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.alg = alg
	p.kid = randomString(8)
	switch alg {
	case "ES256":
		k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			panic(err)
		}
		p.ecKey, p.rsaKey = k, nil
	default:
		k, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			panic(err)
		}
		p.rsaKey, p.ecKey = k, nil
	}
}

func (p *IDP) now() time.Time {
	if p.Now != nil {
		return p.Now()
	}
	return time.Now()
}

func (p *IDP) discovery(w http.ResponseWriter, _ *http.Request) {
	doc := map[string]any{
		"issuer":                           p.Issuer,
		"authorization_endpoint":           p.Issuer + "/protocol/openid-connect/auth",
		"token_endpoint":                   p.Issuer + "/protocol/openid-connect/token",
		"jwks_uri":                         p.Issuer + "/protocol/openid-connect/certs",
		"code_challenge_methods_supported": []string{"plain", "S256"},
	}
	if !p.NoEndSession {
		doc["end_session_endpoint"] = p.Issuer + "/protocol/openid-connect/logout"
	}
	writeJSON(w, http.StatusOK, doc)
}

// Authorize plays the browser at the authorization endpoint: it checks the request of the BFF (client,
// response type, redirect URI, PKCE S256, state, nonce), signs user in and returns the query of the redirect back
// to the BFF (code and state).
func (p *IDP) Authorize(authURL string, user User) (url.Values, error) {
	u, err := url.Parse(authURL)
	if err != nil {
		return nil, err
	}
	if got, want := u.Scheme+"://"+u.Host+u.Path, p.Issuer+"/protocol/openid-connect/auth"; got != want {
		return nil, fmt.Errorf("authorization endpoint %s, want %s", got, want)
	}
	q := u.Query()
	switch {
	case q.Get("client_id") != p.ClientID:
		return nil, fmt.Errorf("client_id %q", q.Get("client_id"))
	case q.Get("response_type") != "code":
		return nil, fmt.Errorf("response_type %q", q.Get("response_type"))
	case q.Get("code_challenge_method") != "S256" || q.Get("code_challenge") == "":
		return nil, errors.New("PKCE S256 is required")
	case q.Get("state") == "" || q.Get("nonce") == "" || q.Get("redirect_uri") == "":
		return nil, errors.New("state, nonce and redirect_uri are required")
	case !strings.Contains(" "+q.Get("scope")+" ", " openid "):
		return nil, fmt.Errorf("scope %q lacks openid", q.Get("scope"))
	}
	code := randomString(24)
	p.mu.Lock()
	p.codes[code] = grant{challenge: q.Get("code_challenge"), redirectURI: q.Get("redirect_uri"), nonce: q.Get("nonce"), user: user}
	p.mu.Unlock()
	return url.Values{"code": {code}, "state": {q.Get("state")}}, nil
}

// TokenRequests returns the forms received by the token endpoint.
func (p *IDP) TokenRequests() []url.Values {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]url.Values(nil), p.tokenReqs...)
}

// JWKSHits returns how many times the JWKS was fetched.
func (p *IDP) JWKSHits() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.jwksHits
}

func (p *IDP) token(w http.ResponseWriter, r *http.Request) {
	if p.TokenStatus != 0 {
		writeJSON(w, p.TokenStatus, map[string]string{errKey: "temporarily_unavailable"})
		return
	}
	if err := r.ParseForm(); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{errKey: "invalid_request"})
		return
	}
	p.mu.Lock()
	p.tokenReqs = append(p.tokenReqs, r.PostForm)
	p.mu.Unlock()
	id, secret, ok := r.BasicAuth()
	if ok {
		id, _ = url.QueryUnescape(id)
		secret, _ = url.QueryUnescape(secret)
	}
	if !ok || id != p.ClientID || subtle.ConstantTimeCompare([]byte(secret), []byte(p.ClientSecret)) != 1 {
		writeJSON(w, http.StatusUnauthorized, map[string]string{errKey: "invalid_client"})
		return
	}
	f := r.PostForm
	p.mu.Lock()
	g, found := p.codes[f.Get("code")]
	delete(p.codes, f.Get("code")) // single use
	p.mu.Unlock()
	sum := sha256.Sum256([]byte(f.Get("code_verifier")))
	switch {
	case f.Get("grant_type") != "authorization_code", !found, f.Get("redirect_uri") != g.redirectURI,
		base64.RawURLEncoding.EncodeToString(sum[:]) != g.challenge:
		writeJSON(w, http.StatusBadRequest, map[string]string{errKey: "invalid_grant"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"access_token": randomString(16), "token_type": "Bearer", "expires_in": 300,
		"id_token": p.IDToken(g.user, g.nonce),
	})
}

// IDToken signs an ID token of user for the client with nonce, plus IDP.Claims.
func (p *IDP) IDToken(user User, nonce string) string {
	now := p.now()
	auth := user.AuthTime
	if auth.IsZero() {
		auth = now
	}
	claims := map[string]any{
		"iss": p.Issuer, "sub": user.Subject, "aud": p.ClientID, "azp": p.ClientID,
		"exp": now.Add(5 * time.Minute).Unix(), "iat": now.Unix(), "auth_time": auth.Unix(), "nonce": nonce,
		"email": user.Email, "email_verified": user.EmailVerified, "name": user.Name,
		"preferred_username": user.Email,
	}
	maps.Copy(claims, p.Claims)
	return p.Sign(claims)
}

// Sign signs claims with the current key of the provider.
func (p *IDP) Sign(claims map[string]any) string {
	p.mu.Lock()
	alg, kid := p.alg, p.kid
	p.mu.Unlock()
	return p.SignWith(map[string]any{"alg": alg, "kid": kid, "typ": "JWT"}, claims)
}

// SignWith signs claims under a given header with the current key (the header may lie about alg or kid).
func (p *IDP) SignWith(header, claims map[string]any) string {
	h, _ := json.Marshal(header)
	c, _ := json.Marshal(claims)
	input := b64(h) + "." + b64(c)
	sum := sha256.Sum256([]byte(input))
	p.mu.Lock()
	defer p.mu.Unlock()
	var sig []byte
	if p.ecKey != nil {
		r, s, err := ecdsa.Sign(rand.Reader, p.ecKey, sum[:])
		if err != nil {
			panic(err)
		}
		sig = append(r.FillBytes(make([]byte, 32)), s.FillBytes(make([]byte, 32))...)
	} else {
		var err error
		if sig, err = rsa.SignPKCS1v15(rand.Reader, p.rsaKey, crypto.SHA256, sum[:]); err != nil {
			panic(err)
		}
	}
	return input + "." + b64(sig)
}

func (p *IDP) jwks(w http.ResponseWriter, _ *http.Request) {
	p.mu.Lock()
	p.jwksHits++
	var key map[string]any
	if p.ecKey != nil {
		point, err := p.ecKey.PublicKey.Bytes() // 0x04 || X || Y
		if err != nil {
			panic(err)
		}
		key = map[string]any{
			"kty": "EC", "crv": "P-256", "kid": p.kid, "use": "sig", "alg": "ES256",
			"x": b64(point[1:33]), "y": b64(point[33:65]),
		}
	} else {
		key = map[string]any{
			"kty": "RSA", "kid": p.kid, "use": "sig", "alg": "RS256",
			"n": b64(p.rsaKey.N.Bytes()), "e": b64(big.NewInt(int64(p.rsaKey.E)).Bytes()),
		}
	}
	p.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"keys": []any{key}})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func randomString(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return b64(b)
}
