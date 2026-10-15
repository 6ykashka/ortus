package main

import (
	"log/slog"
	"maps"
	"slices"
	"strings"
	"testing"
	"time"
)

func env(kv map[string]string) func(string) string {
	return func(k string) string { return kv[k] }
}

// .env.example (W0.06): CONTROL_DB_URL обязателен, HTTP_ADDR по умолчанию 127.0.0.1:8080 (у агента — из env
// по слоту), SESSION_COOKIE_NAME=ortus_sid, SESSION_TTL=12h, ALLOWED_ORIGINS через запятую.
func TestLoadConfigDefaults(t *testing.T) {
	t.Parallel()
	c, err := loadConfig(env(map[string]string{"CONTROL_DB_URL": "postgres://x@h/ortus_control"}))
	if err != nil {
		t.Fatal(err)
	}
	if c.AppEnv != "dev" || c.HTTPAddr != "127.0.0.1:8080" || c.AuthProvider != "dev" || c.SessionCookie != "ortus_sid" ||
		c.SessionTTL != 12*time.Hour || !slices.Equal(c.AllowedOrigins, []string{"http://localhost:5173"}) || c.LogLevel != slog.LevelInfo {
		t.Fatalf("config = %+v", c)
	}
}

func TestLoadConfigValues(t *testing.T) {
	t.Parallel()
	c, err := loadConfig(env(map[string]string{
		"APP_ENV": "e2e", "HTTP_ADDR": "127.0.0.1:8113", "CONTROL_DB_URL": "postgres://x@h/c", "TENANT_DB_HOST": "h:1",
		"SESSION_COOKIE_NAME": "sid", "SESSION_TTL": "30m", "LOG_LEVEL": "debug",
		"ALLOWED_ORIGINS": " http://127.0.0.1:5213 , http://localhost:5213 ",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if c.AppEnv != "e2e" || c.HTTPAddr != "127.0.0.1:8113" || c.TenantDBHost != "h:1" || c.SessionCookie != "sid" ||
		c.SessionTTL != 30*time.Minute || c.LogLevel != slog.LevelDebug ||
		!slices.Equal(c.AllowedOrigins, []string{"http://127.0.0.1:5213", "http://localhost:5213"}) {
		t.Fatalf("config = %+v", c)
	}
}

// Ошибки конфигурации видны на старте (12 §5 п.29), а dev-провайдер в prod не запускается (PD-18).
func TestLoadConfigErrors(t *testing.T) {
	t.Parallel()
	base := map[string]string{"CONTROL_DB_URL": "postgres://x@h/c"}
	with := func(k, v string) map[string]string {
		m := maps.Clone(base)
		m[k] = v
		return m
	}
	cases := map[string]struct {
		env  map[string]string
		want string
	}{
		"нет CONTROL_DB_URL":     {map[string]string{}, "CONTROL_DB_URL"},
		"неизвестный APP_ENV":    {with("APP_ENV", "stage"), "APP_ENV"},
		"неизвестный провайдер":  {with("AUTH_PROVIDER", "ldap"), "AUTH_PROVIDER"},
		"oidc ещё не реализован": {with("AUTH_PROVIDER", "oidc"), "AUTH_PROVIDER"},
		"dev-провайдер в prod":   {map[string]string{"CONTROL_DB_URL": "postgres://x@h/c", "APP_ENV": "prod", "AUTH_PROVIDER": "dev"}, "AUTH_PROVIDER"},
		"битый SESSION_TTL":      {with("SESSION_TTL", "12 часов"), "SESSION_TTL"},
		"битый LOG_LEVEL":        {with("LOG_LEVEL", "loud"), "LOG_LEVEL"},
	}
	for name, tc := range cases {
		_, err := loadConfig(env(tc.env))
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: %v, want an error about %s", name, err, tc.want)
		}
	}
}
