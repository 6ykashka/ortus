// Package oidc is the OpenID Connect side of the BFF sign-in (W1.03, S1-05): an OIDC provider client for the
// Authorization Code flow with PKCE (discovery, authorization URL, code exchange, ID token verification, RP-initiated
// logout), and the durable stores of the BFF in the control DB (sessions, one-time sign-in records, accounts of
// provider identities). Tokens of the provider never leave the server: the BFF keeps only its own session.
//
// The ID token is verified with the standard library (JWS compact, RS256 and ES256 keys of the JWKS); no third-party
// JOSE library is needed.
package oidc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Errors of the provider. ErrUnavailable maps to 503 dependency_unavailable (provider down or misconfigured),
// ErrRejected to 401 session_expired (the code, the state or the ID token is not valid: sign in again).
var (
	ErrUnavailable = errors.New("oidc: identity provider unavailable")
	ErrRejected    = errors.New("oidc: sign-in rejected")
)

// Defaults of Config.
const (
	DefaultLeeway   = time.Minute
	discoveryTTL    = time.Hour
	jwksRefetchWait = 30 * time.Second
	maxResponse     = 1 << 20
)

// Config of one provider (realm).
type Config struct {
	Key                   string // users | operators: the realm the BFF picks in startLogin
	Issuer                string // OIDC_ISSUER: exact issuer of the realm
	ClientID              string
	ClientSecret          string
	RedirectURL           string // OIDC_REDIRECT_URL: …/api/v1/auth/callback on the SPA origin
	PostLogoutRedirectURL string // where the provider returns after RP-initiated logout
	Scopes                []string
	HTTP                  *http.Client     // nil: a client with a 10 s timeout
	Now                   func() time.Time // nil: time.Now
	Leeway                time.Duration    // clock skew for exp and iat; 0: DefaultLeeway
}

// Identity is the verified identity of an ID token.
type Identity struct {
	Issuer        string
	Subject       string
	Email         string // normalized: trimmed, lower case
	EmailVerified bool
	Name          string // name, else preferred_username, else the e-mail
	AuthTime      time.Time
}

type metadata struct {
	Issuer                string `json:"issuer"`
	AuthorizationEndpoint string `json:"authorization_endpoint"`
	TokenEndpoint         string `json:"token_endpoint"`
	JWKSURI               string `json:"jwks_uri"`
	EndSessionEndpoint    string `json:"end_session_endpoint"`
}

// Provider is a client of one OIDC provider; it is safe for concurrent use.
type Provider struct {
	cfg Config

	mu       sync.Mutex
	meta     *metadata
	metaAt   time.Time
	keys     map[string]any // kid → *rsa.PublicKey | *ecdsa.PublicKey
	keysAt   time.Time
	keysSet  bool
	lastMiss string // the last kid not found in the JWKS
}

// NewProvider returns a provider client; discovery happens on first use.
func NewProvider(c Config) *Provider {
	if c.HTTP == nil {
		c.HTTP = &http.Client{Timeout: 10 * time.Second}
	}
	if len(c.Scopes) == 0 {
		c.Scopes = []string{"openid", "email", "profile"}
	}
	if c.Leeway <= 0 {
		c.Leeway = DefaultLeeway
	}
	return &Provider{cfg: c}
}

// Key returns the provider key of the configuration (users | operators).
func (p *Provider) Key() string { return p.cfg.Key }

// Issuer returns the issuer of the provider.
func (p *Provider) Issuer() string { return p.cfg.Issuer }

func (p *Provider) now() time.Time {
	if p.cfg.Now != nil {
		return p.cfg.Now()
	}
	return time.Now()
}

func unavailable(format string, a ...any) error {
	return fmt.Errorf("%w: "+format, append([]any{ErrUnavailable}, a...)...)
}

func rejected(format string, a ...any) error {
	return fmt.Errorf("%w: "+format, append([]any{ErrRejected}, a...)...)
}

// getJSON fetches a JSON document of the provider.
func (p *Provider) getJSON(ctx context.Context, rawURL string, v any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return unavailable("%v", err)
	}
	req.Header.Set("Accept", "application/json")
	resp, err := p.cfg.HTTP.Do(req)
	if err != nil {
		return unavailable("GET %s: %v", rawURL, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return unavailable("GET %s: %s", rawURL, resp.Status)
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxResponse)).Decode(v); err != nil {
		return unavailable("GET %s: %v", rawURL, err)
	}
	return nil
}

// discover returns the discovery document, cached for an hour. Its issuer must equal the configured one.
func (p *Provider) discover(ctx context.Context) (*metadata, error) {
	p.mu.Lock()
	if p.meta != nil && p.now().Sub(p.metaAt) < discoveryTTL {
		m := p.meta
		p.mu.Unlock()
		return m, nil
	}
	p.mu.Unlock()
	var m metadata
	if err := p.getJSON(ctx, strings.TrimSuffix(p.cfg.Issuer, "/")+"/.well-known/openid-configuration", &m); err != nil {
		return nil, err
	}
	switch {
	case m.Issuer != p.cfg.Issuer:
		return nil, unavailable("discovery issuer %q, configured %q", m.Issuer, p.cfg.Issuer)
	case m.AuthorizationEndpoint == "" || m.TokenEndpoint == "" || m.JWKSURI == "":
		return nil, unavailable("discovery of %s lacks endpoints", p.cfg.Issuer)
	}
	p.mu.Lock()
	p.meta, p.metaAt = &m, p.now()
	p.mu.Unlock()
	return &m, nil
}

// AuthURL returns the authorization endpoint URL of the Authorization Code flow with PKCE S256.
func (p *Provider) AuthURL(ctx context.Context, state, nonce, challenge string) (string, error) {
	m, err := p.discover(ctx)
	if err != nil {
		return "", err
	}
	u, err := url.Parse(m.AuthorizationEndpoint)
	if err != nil {
		return "", unavailable("authorization endpoint: %v", err)
	}
	q := u.Query()
	q.Set("response_type", "code")
	q.Set("client_id", p.cfg.ClientID)
	q.Set("redirect_uri", p.cfg.RedirectURL)
	q.Set("scope", strings.Join(p.cfg.Scopes, " "))
	q.Set("state", state)
	q.Set("nonce", nonce)
	q.Set("code_challenge", challenge)
	q.Set("code_challenge_method", "S256")
	u.RawQuery = q.Encode()
	return u.String(), nil
}

type tokenResponse struct {
	IDToken string `json:"id_token"`
	Error   string `json:"error"`
}

// Exchange trades the authorization code for tokens with the PKCE verifier (client_secret_basic) and returns the
// verified identity of the ID token issued for nonce. Access and refresh tokens are discarded.
func (p *Provider) Exchange(ctx context.Context, code, verifier, nonce string) (Identity, error) {
	m, err := p.discover(ctx)
	if err != nil {
		return Identity{}, err
	}
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"redirect_uri":  {p.cfg.RedirectURL},
		"code_verifier": {verifier},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, m.TokenEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return Identity{}, unavailable("%v", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	// RFC 6749 §2.3.1: client id and secret are form-encoded before Basic.
	req.SetBasicAuth(url.QueryEscape(p.cfg.ClientID), url.QueryEscape(p.cfg.ClientSecret))
	resp, err := p.cfg.HTTP.Do(req)
	if err != nil {
		return Identity{}, unavailable("token endpoint: %v", err)
	}
	defer resp.Body.Close()
	var tr tokenResponse
	decodeErr := json.NewDecoder(io.LimitReader(resp.Body, maxResponse)).Decode(&tr)
	switch {
	case resp.StatusCode == http.StatusBadRequest && tr.Error == "invalid_grant":
		return Identity{}, rejected("token endpoint: invalid_grant")
	case resp.StatusCode != http.StatusOK:
		return Identity{}, unavailable("token endpoint: %s %s", resp.Status, tr.Error)
	case decodeErr != nil || tr.IDToken == "":
		return Identity{}, unavailable("token endpoint: no id_token")
	}
	return p.VerifyIDToken(ctx, tr.IDToken, nonce)
}

// EndSessionURL returns the RP-initiated logout URL (client_id and post_logout_redirect_uri), or nil when the
// provider has no end_session_endpoint.
func (p *Provider) EndSessionURL(ctx context.Context) (*string, error) {
	m, err := p.discover(ctx)
	if err != nil {
		return nil, err
	}
	if m.EndSessionEndpoint == "" {
		return nil, nil
	}
	u, err := url.Parse(m.EndSessionEndpoint)
	if err != nil {
		return nil, unavailable("end session endpoint: %v", err)
	}
	q := u.Query()
	q.Set("client_id", p.cfg.ClientID)
	if p.cfg.PostLogoutRedirectURL != "" {
		q.Set("post_logout_redirect_uri", p.cfg.PostLogoutRedirectURL)
	}
	u.RawQuery = q.Encode()
	s := u.String()
	return &s, nil
}
