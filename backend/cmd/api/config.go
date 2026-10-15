package main

import (
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"slices"
	"strings"
	"time"
)

// config of cmd/api, read from the environment (deploy/compose/.env.example).
type config struct {
	AppEnv         string          // APP_ENV: dev | e2e | prod
	HTTPAddr       string          // HTTP_ADDR: 127.0.0.1:(8100 + slot) for an agent
	AuthProvider   string          // AUTH_PROVIDER: dev (seed accounts, never prod) | oidc
	ControlDBURL   string          // CONTROL_DB_URL: role ortus_api
	TenantDBHost   string          // TENANT_DB_HOST: overrides the host of tenant DB secrets
	SessionCookie  string          // SESSION_COOKIE_NAME: ortus_sid; prod __Host-ortus_session (Q-W0.09-4)
	CookieSecure   bool            // cookies always Secure: prod or a __Host- cookie name
	SessionTTL     time.Duration   // SESSION_TTL
	AllowedOrigins []string        // ALLOWED_ORIGINS: comma-separated exact origins of the SPA
	LogLevel       slog.Level      // LOG_LEVEL
	FixedNow       *time.Time      // APP_FIXED_NOW: the clock of the evaluator outside prod (isolation suite, e2e)
	Users          *providerConfig // OIDC_*: realm of clients (required with AUTH_PROVIDER=oidc)
	Operators      *providerConfig // OPERATOR_OIDC_*: realm of operators (D-03 by default, ADR-0004), optional
}

// providerConfig is one OIDC client of the BFF (W1.03).
type providerConfig struct {
	Issuer                string // OIDC_ISSUER
	ClientID              string // OIDC_CLIENT_ID
	ClientSecret          string // OIDC_CLIENT_SECRET
	RedirectURL           string // OIDC_REDIRECT_URL: <SPA origin>/api/v1/auth/callback (proxied to the BFF)
	PostLogoutRedirectURL string // [OPERATOR_]OIDC_POST_LOGOUT_REDIRECT_URL: default the root of the redirect origin
}

// clock is the «now» of the permission evaluator: APP_FIXED_NOW when set, the system clock otherwise.
func (c config) clock() func() time.Time {
	if c.FixedNow == nil {
		return time.Now
	}
	at := *c.FixedNow
	return func() time.Time { return at }
}

// fixedNow reads APP_FIXED_NOW (RFC 3339): grant periods of fixtures are relative to their own «now»
// (harness.Now of the isolation suite), so the suite and e2e need the clock of the application, never prod.
func fixedNow(c *config, raw string) error {
	if raw = strings.TrimSpace(raw); raw == "" {
		return nil
	}
	if c.AppEnv == envProd {
		return errors.New("APP_FIXED_NOW is not allowed with APP_ENV=prod")
	}
	at, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil {
		return fmt.Errorf("APP_FIXED_NOW=%q: want RFC 3339, e.g. 2026-10-01T10:30:00+03:00", raw)
	}
	c.FixedNow = &at
	return nil
}

const (
	envDev  = "dev"
	envE2E  = "e2e"
	envProd = "prod"
	envOIDC = "oidc"

	// prodSessionCookie is the session cookie of the contract (securitySchemes sessionCookie).
	prodSessionCookie = "__Host-ortus_session"
	hostPrefix        = "__Host-"
	callbackPath      = "/api/v1/auth/callback"
)

func orDefault(v, def string) string {
	if v = strings.TrimSpace(v); v != "" {
		return v
	}
	return def
}

// loadConfig reads and validates the configuration; every problem is reported at start (12 §5 item 29).
func loadConfig(getenv func(string) string) (config, error) {
	c := config{
		AppEnv:       orDefault(getenv("APP_ENV"), envDev),
		HTTPAddr:     orDefault(getenv("HTTP_ADDR"), "127.0.0.1:8080"),
		AuthProvider: orDefault(getenv("AUTH_PROVIDER"), envDev),
		ControlDBURL: strings.TrimSpace(getenv("CONTROL_DB_URL")),
		TenantDBHost: strings.TrimSpace(getenv("TENANT_DB_HOST")),
	}
	var errs []error
	if !slices.Contains([]string{envDev, envE2E, envProd}, c.AppEnv) {
		errs = append(errs, fmt.Errorf("APP_ENV=%q: want dev, e2e or prod", c.AppEnv))
	}
	switch {
	case c.AuthProvider != envDev && c.AuthProvider != envOIDC:
		errs = append(errs, fmt.Errorf("AUTH_PROVIDER=%q: want dev or oidc", c.AuthProvider))
	case c.AuthProvider == envDev && c.AppEnv == envProd:
		errs = append(errs, errors.New("AUTH_PROVIDER=dev is not allowed with APP_ENV=prod (PD-18)"))
	}
	if c.ControlDBURL == "" {
		errs = append(errs, errors.New("CONTROL_DB_URL is not set (see deploy/compose/.env.example)"))
	}
	errs = append(errs, c.loadSession(getenv)...)
	errs = append(errs, c.loadOIDC(getenv)...)
	if err := c.LogLevel.UnmarshalText([]byte(orDefault(getenv("LOG_LEVEL"), "info"))); err != nil {
		errs = append(errs, fmt.Errorf("LOG_LEVEL=%q: want debug, info, warn or error", getenv("LOG_LEVEL")))
	}
	if err := fixedNow(&c, getenv("APP_FIXED_NOW")); err != nil {
		errs = append(errs, err)
	}
	for o := range strings.SplitSeq(orDefault(getenv("ALLOWED_ORIGINS"), "http://localhost:5173"), ",") {
		if o = strings.TrimSpace(o); o != "" {
			c.AllowedOrigins = append(c.AllowedOrigins, o)
		}
	}
	return c, errors.Join(errs...)
}

// loadSession: TTL and the cookie (Q-W0.09-4): dev and e2e use ortus_sid over http on loopback; prod uses the
// __Host- cookie of the contract, always Secure.
func (c *config) loadSession(getenv func(string) string) []error {
	var errs []error
	ttl, err := time.ParseDuration(orDefault(getenv("SESSION_TTL"), "12h"))
	if err != nil || ttl <= 0 {
		errs = append(errs, fmt.Errorf("SESSION_TTL=%q: want a positive Go duration such as 12h", getenv("SESSION_TTL")))
	}
	c.SessionTTL = ttl
	def := "ortus_sid"
	if c.AppEnv == envProd {
		def = prodSessionCookie
	}
	c.SessionCookie = orDefault(getenv("SESSION_COOKIE_NAME"), def)
	c.CookieSecure = c.AppEnv == envProd || strings.HasPrefix(c.SessionCookie, hostPrefix)
	if c.AppEnv == envProd && !strings.HasPrefix(c.SessionCookie, hostPrefix) {
		errs = append(errs, fmt.Errorf("SESSION_COOKIE_NAME=%q: prod requires a %s cookie (%s)", c.SessionCookie, hostPrefix, prodSessionCookie))
	}
	return errs
}

// loadOIDC reads the realm of clients (OIDC_*, required) and of operators (OPERATOR_OIDC_*, optional) with
// AUTH_PROVIDER=oidc. With the dev provider OIDC_* are ignored: the stand of executors and e2e signs in through
// the dev provider and keeps the placeholders of .env.example.
func (c *config) loadOIDC(getenv func(string) string) []error {
	if c.AuthProvider != envOIDC {
		return nil
	}
	var errs []error
	issuer := strings.TrimSpace(getenv("OIDC_ISSUER"))
	opIssuer := strings.TrimSpace(getenv("OPERATOR_OIDC_ISSUER"))
	if issuer == "" {
		return []error{errors.New("OIDC_ISSUER is not set: AUTH_PROVIDER=oidc needs the realm of clients")}
	}
	users := providerConfig{
		Issuer:       issuer,
		ClientID:     strings.TrimSpace(getenv("OIDC_CLIENT_ID")),
		ClientSecret: getenv("OIDC_CLIENT_SECRET"),
		RedirectURL:  strings.TrimSpace(getenv("OIDC_REDIRECT_URL")),
	}
	errs = append(errs, c.checkProvider("OIDC", &users)...)
	post := strings.TrimSpace(getenv("OIDC_POST_LOGOUT_REDIRECT_URL"))
	errs = append(errs, c.postLogout("OIDC_POST_LOGOUT_REDIRECT_URL", post, &users)...)
	c.Users = &users
	if opIssuer != "" {
		ops := users
		ops.Issuer = opIssuer
		ops.ClientID = orDefault(getenv("OPERATOR_OIDC_CLIENT_ID"), users.ClientID)
		if s := getenv("OPERATOR_OIDC_CLIENT_SECRET"); s != "" {
			ops.ClientSecret = s
		}
		errs = append(errs, c.checkProvider("OPERATOR_OIDC", &ops)...)
		// Operators inherit OIDC_POST_LOGOUT_REDIRECT_URL like the client id and secret; their own variable wins.
		if op := strings.TrimSpace(getenv("OPERATOR_OIDC_POST_LOGOUT_REDIRECT_URL")); op != "" {
			errs = append(errs, c.postLogout("OPERATOR_OIDC_POST_LOGOUT_REDIRECT_URL", op, &ops)...)
		} else if post != "" && users.PostLogoutRedirectURL == post {
			ops.PostLogoutRedirectURL = post
		}
		c.Operators = &ops
	}
	return errs
}

// postLogout overrides the post-logout redirect of p (checkProvider set the root of the redirect origin) with raw,
// an absolute http(s) URL; an empty raw keeps the default.
func (c *config) postLogout(name, raw string, p *providerConfig) []error {
	if raw == "" {
		return nil
	}
	if err := c.checkURL(name, raw, ""); err != nil {
		return []error{err}
	}
	p.PostLogoutRedirectURL = raw
	return nil
}

// checkProvider validates a provider and derives its post-logout redirect (the root of the redirect origin).
func (c *config) checkProvider(prefix string, p *providerConfig) []error {
	var errs []error
	if err := c.checkURL(prefix+"_ISSUER", p.Issuer, ""); err != nil {
		errs = append(errs, err)
	}
	if p.ClientID == "" {
		errs = append(errs, fmt.Errorf("%s_CLIENT_ID is not set", prefix))
	}
	if p.ClientSecret == "" {
		errs = append(errs, fmt.Errorf("%s_CLIENT_SECRET is not set (the BFF is a confidential client)", prefix))
	}
	if err := c.checkURL("OIDC_REDIRECT_URL", p.RedirectURL, callbackPath); err != nil {
		return append(errs, err)
	}
	red, _ := url.Parse(p.RedirectURL)
	p.PostLogoutRedirectURL = red.Scheme + "://" + red.Host + "/"
	return errs
}

// checkURL requires an absolute http(s) URL (https in prod) and, when path is set, exactly that path.
func (c *config) checkURL(name, raw, path string) error {
	u, err := url.Parse(raw)
	switch {
	case err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http"):
		return fmt.Errorf("%s=%q: want an absolute http(s) URL", name, raw)
	case path != "" && u.Path != path:
		return fmt.Errorf("%s=%q: want <SPA origin>%s", name, raw, path)
	case c.AppEnv == envProd && u.Scheme != "https":
		return fmt.Errorf("%s=%q: prod requires https", name, raw)
	}
	return nil
}
