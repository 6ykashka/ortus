package main

import (
	"context"
	"database/sql"
	"io"
	"net/url"
	"regexp"
	"sort"
	"strings"

	_ "github.com/jackc/pgx/v5/stdlib" // database/sql driver "pgx"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// env is the configuration read from environment variables (deploy/compose/.env.example).
type env map[string]string

var envKeys = []string{
	"APP_ENV", "MIGRATOR_DB_URL", "TENANT_DB_HOST", "PG_SUPER_URL",
	"PG_MIGRATOR_PASS", "PG_API_PASS", "PG_WORKER_PASS", "PG_PROVISIONER_PASS",
}

func newEnv(getenv func(string) string) env {
	e := env{}
	for _, k := range envKeys {
		if v := strings.TrimSpace(getenv(k)); v != "" {
			e[k] = v
		}
	}
	return e
}

// isProd reports APP_ENV=prod (or production): destructive commands are refused there.
func (e env) isProd() bool {
	v := strings.ToLower(e["APP_ENV"])
	return v == "prod" || v == "production"
}

// require returns the value of key or a configuration error naming it.
func (e env) require(key string) (string, error) {
	if v := e[key]; v != "" {
		return v, nil
	}
	return "", fail(exitConfig, "%s is not set (see deploy/compose/.env.example)", key)
}

func (e env) passwords() (migrations.Passwords, error) {
	var p migrations.Passwords
	for _, f := range []struct {
		key string
		dst *string
	}{
		{"PG_MIGRATOR_PASS", &p.Migrator},
		{"PG_API_PASS", &p.API},
		{"PG_WORKER_PASS", &p.Worker},
		{"PG_PROVISIONER_PASS", &p.Provisioner},
	} {
		v, err := e.require(f.key)
		if err != nil {
			return p, err
		}
		*f.dst = v
	}
	return p, nil
}

// open connects to dsn. Errors name the variable, host and database but never the DSN: they are printed
// and also written to platform_audit, which the output redactor does not cover.
func open(ctx context.Context, name, dsn string) (*sql.DB, error) {
	u, err := url.Parse(dsn)
	if err != nil || !strings.HasPrefix(u.Scheme, "postgres") {
		return nil, fail(exitConfig, "%s is not a postgres:// URL", name)
	}
	target := u.Host + u.Path
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, fail(exitConfig, "%s (%s): %v", name, target, err)
	}
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fail(exitConfig, "connect %s (%s): %v", name, target, err)
	}
	return db, nil
}

// redact masks the passwords of e in s; for text that leaves the process other than through stdout and stderr
// (platform_audit).
func (e env) redact(s string) string {
	return newRedactor(e).Replace(s)
}

// redactor masks secrets in text: the password of any URL (scheme://user:password@), the value of password=…,
// and the known passwords of the environment as whole words. Matching whole words keeps simple dev passwords
// («postgres») from masking URL schemes, database and role names.
type redactor struct {
	secrets []string // longest first
}

var (
	urlPassword     = regexp.MustCompile(`([A-Za-z][A-Za-z0-9+.-]*://[^\s:/?#@]*):[^\s@/]*@`)
	keywordPassword = regexp.MustCompile(`(?i)(\bpassword\s*=\s*)('[^']*'|"[^"]*"|[^\s'"]+)`)
)

func (r *redactor) Replace(s string) string {
	s = urlPassword.ReplaceAllString(s, "$1:***@")
	s = keywordPassword.ReplaceAllString(s, "${1}***")
	for _, secret := range r.secrets {
		s = replaceWord(s, secret)
	}
	return s
}

// replaceWord replaces the occurrences of w that are delimited by isWordBoundary on both sides.
func replaceWord(s, w string) string {
	var b strings.Builder
	for {
		i := strings.Index(s, w)
		if i < 0 {
			b.WriteString(s)
			return b.String()
		}
		end := i + len(w)
		whole := (i == 0 || isWordBoundary(s[i-1])) && (end == len(s) || isWordBoundary(s[end]))
		b.WriteString(s[:i])
		if whole {
			b.WriteString("***")
		} else {
			b.WriteString(w)
		}
		s = s[end:]
	}
}

func isWordBoundary(c byte) bool {
	return strings.IndexByte(" \t\r\n'\"`,;()[]{}<>", c) >= 0
}

// newRedactor collects the passwords (raw and URL-escaped, also inside DSNs) of vars.
func newRedactor(vars map[string]string) *redactor {
	seen := map[string]bool{}
	add := func(s string) {
		if len(s) >= 3 {
			seen[s] = true
		}
	}
	for k, v := range vars {
		switch {
		case strings.HasSuffix(k, "_PASS"):
			add(v)
			add(url.QueryEscape(v))
		case strings.HasSuffix(k, "_URL"):
			u, err := url.Parse(v)
			if err != nil || u.User == nil {
				continue
			}
			if p, ok := u.User.Password(); ok {
				add(p)
				add(url.QueryEscape(p))
			}
			// The password as written in the DSN (percent-encoding preserved).
			if _, rest, ok := strings.Cut(v, "://"); ok {
				if userinfo, _, ok := strings.Cut(rest, "@"); ok {
					if _, raw, ok := strings.Cut(userinfo, ":"); ok {
						add(raw)
					}
				}
			}
		}
	}
	list := make([]string, 0, len(seen))
	for s := range seen {
		list = append(list, s)
	}
	// Longest first: a password that contains another one is replaced as a whole.
	sort.Slice(list, func(i, j int) bool { return len(list[i]) > len(list[j]) })
	return &redactor{secrets: list}
}

// redactWriter passes output through the redactor.
type redactWriter struct {
	w io.Writer
	r *redactor
}

func (rw *redactWriter) Write(p []byte) (int, error) {
	if _, err := io.WriteString(rw.w, rw.r.Replace(string(p))); err != nil {
		return 0, err
	}
	return len(p), nil
}
