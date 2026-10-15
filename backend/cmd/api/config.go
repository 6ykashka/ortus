package main

import (
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"time"
)

// config of cmd/api, read from the environment (deploy/compose/.env.example).
type config struct {
	AppEnv         string        // APP_ENV: dev | e2e | prod
	HTTPAddr       string        // HTTP_ADDR: 127.0.0.1:(8100 + slot) for an agent
	AuthProvider   string        // AUTH_PROVIDER: dev (oidc — W1.03)
	ControlDBURL   string        // CONTROL_DB_URL: role ortus_api
	TenantDBHost   string        // TENANT_DB_HOST: overrides the host of tenant DB secrets
	SessionCookie  string        // SESSION_COOKIE_NAME
	SessionTTL     time.Duration // SESSION_TTL
	AllowedOrigins []string      // ALLOWED_ORIGINS: comma-separated exact origins of the SPA
	LogLevel       slog.Level    // LOG_LEVEL
}

const (
	envDev  = "dev"
	envE2E  = "e2e"
	envProd = "prod"
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
		AppEnv:        orDefault(getenv("APP_ENV"), envDev),
		HTTPAddr:      orDefault(getenv("HTTP_ADDR"), "127.0.0.1:8080"),
		AuthProvider:  orDefault(getenv("AUTH_PROVIDER"), envDev),
		ControlDBURL:  strings.TrimSpace(getenv("CONTROL_DB_URL")),
		TenantDBHost:  strings.TrimSpace(getenv("TENANT_DB_HOST")),
		SessionCookie: orDefault(getenv("SESSION_COOKIE_NAME"), "ortus_sid"),
	}
	var errs []error
	if !slices.Contains([]string{envDev, envE2E, envProd}, c.AppEnv) {
		errs = append(errs, fmt.Errorf("APP_ENV=%q: want dev, e2e or prod", c.AppEnv))
	}
	switch {
	case c.AuthProvider != envDev:
		errs = append(errs, fmt.Errorf("AUTH_PROVIDER=%q: only dev is implemented (oidc — W1.03)", c.AuthProvider))
	case c.AppEnv == envProd:
		errs = append(errs, errors.New("AUTH_PROVIDER=dev is not allowed with APP_ENV=prod (PD-18)"))
	}
	if c.ControlDBURL == "" {
		errs = append(errs, errors.New("CONTROL_DB_URL is not set (see deploy/compose/.env.example)"))
	}
	ttl, err := time.ParseDuration(orDefault(getenv("SESSION_TTL"), "12h"))
	if err != nil || ttl <= 0 {
		errs = append(errs, fmt.Errorf("SESSION_TTL=%q: want a positive Go duration such as 12h", getenv("SESSION_TTL")))
	}
	c.SessionTTL = ttl
	if err := c.LogLevel.UnmarshalText([]byte(orDefault(getenv("LOG_LEVEL"), "info"))); err != nil {
		errs = append(errs, fmt.Errorf("LOG_LEVEL=%q: want debug, info, warn or error", getenv("LOG_LEVEL")))
	}
	for o := range strings.SplitSeq(orDefault(getenv("ALLOWED_ORIGINS"), "http://localhost:5173"), ",") {
		if o = strings.TrimSpace(o); o != "" {
			c.AllowedOrigins = append(c.AllowedOrigins, o)
		}
	}
	return c, errors.Join(errs...)
}
