package mail

import (
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	netmail "net/mail"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Config is the SMTP delivery of a process.
type Config struct {
	Host       string        // SMTP_HOST; "" — delivery is off (never in prod)
	Port       int           // SMTP_PORT
	From       string        // MAIL_FROM: the envelope and header address of the sender
	Origin     string        // PUBLIC_ORIGIN: the origin of the SPA the links of the letters point to
	Username   string        // SMTP_USERNAME: AUTH PLAIN, only over TLS or to localhost
	Password   string        // SMTP_PASSWORD
	AllowPlain bool          // APP_ENV dev or e2e: a server without STARTTLS is accepted
	Timeout    time.Duration // the whole conversation of one message
	TLS        *tls.Config   // nil: system roots, ServerName = Host (tests pass the root of their server)
}

// Enabled reports whether messages leave the process.
func (c Config) Enabled() bool { return c.Host != "" }

// Defaults of the stand (dev, e2e): deploy/compose/.env.example.
const (
	envProd       = "prod"
	defaultPort   = 25
	defaultFrom   = "no-reply@ortus.local"
	defaultOrigin = "http://localhost:5173"
	// DefaultTimeout bounds one message: a command that sends mail holds its locks no longer.
	DefaultTimeout = 10 * time.Second
)

// FromEnv reads the configuration of appEnv (dev | e2e | prod). Outside prod SMTP without TLS is allowed, and a
// missing SMTP_HOST turns the delivery off; prod needs SMTP_HOST, MAIL_FROM and an https PUBLIC_ORIGIN. PUBLIC_ORIGIN
// defaults to the first ALLOWED_ORIGINS (the SPA of the stand). Every problem is reported at once.
func FromEnv(getenv func(string) string, appEnv string) (Config, error) {
	prod := appEnv == envProd
	c := Config{
		Host: strings.TrimSpace(getenv("SMTP_HOST")), Port: defaultPort, AllowPlain: !prod, Timeout: DefaultTimeout,
		Username: strings.TrimSpace(getenv("SMTP_USERNAME")), Password: getenv("SMTP_PASSWORD"),
	}
	var errs []error
	if c.Host == "" && prod {
		errs = append(errs, errors.New("SMTP_HOST is not set: prod sends the invitation letters"))
	}
	if raw := strings.TrimSpace(getenv("SMTP_PORT")); raw != "" {
		p, err := strconv.Atoi(raw)
		if err != nil || p < 1 || p > 65535 {
			errs = append(errs, fmt.Errorf("SMTP_PORT=%q: want a port 1…65535", raw))
		}
		c.Port = p
	}
	if c.Password != "" && c.Username == "" {
		errs = append(errs, errors.New("SMTP_PASSWORD is set without SMTP_USERNAME"))
	}
	var err error
	if c.From, err = from(getenv("MAIL_FROM"), prod); err != nil {
		errs = append(errs, err)
	}
	if c.Origin, err = origin(getenv, prod); err != nil {
		errs = append(errs, err)
	}
	return c, errors.Join(errs...)
}

// from is MAIL_FROM: a bare address (the display name is the business of each letter).
func from(raw string, prod bool) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		if prod {
			return "", errors.New("MAIL_FROM is not set: prod needs the sender address of the letters")
		}
		return defaultFrom, nil
	}
	a, err := netmail.ParseAddress(raw)
	if err != nil || a.Name != "" || a.Address != raw {
		return "", fmt.Errorf("MAIL_FROM=%q: want a bare address such as no-reply@ortus.example", raw)
	}
	return raw, nil
}

// origin is PUBLIC_ORIGIN, else the first ALLOWED_ORIGINS, else (outside prod) the Vite of the stand: an absolute
// http(s) origin without a path; https in prod.
func origin(getenv func(string) string, prod bool) (string, error) {
	raw := strings.TrimSpace(getenv("PUBLIC_ORIGIN"))
	if raw == "" {
		first, _, _ := strings.Cut(getenv("ALLOWED_ORIGINS"), ",")
		raw = strings.TrimSpace(first)
	}
	if raw == "" {
		if prod {
			return "", errors.New("PUBLIC_ORIGIN is not set: prod needs the origin of the SPA for the links of the letters")
		}
		return defaultOrigin, nil
	}
	return checkOrigin(raw, prod)
}

// checkOrigin requires an absolute http(s) origin without a path (https in prod).
func checkOrigin(raw string, prod bool) (string, error) {
	u, err := url.Parse(raw)
	switch {
	case err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil:
		return "", fmt.Errorf("PUBLIC_ORIGIN=%q: want an absolute http(s) origin such as https://app.ortus.example", raw)
	case (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "":
		return "", fmt.Errorf("PUBLIC_ORIGIN=%q: want an origin without a path", raw)
	case prod && u.Scheme != "https":
		return "", fmt.Errorf("PUBLIC_ORIGIN=%q: prod requires https", raw)
	}
	return u.Scheme + "://" + u.Host, nil
}

// New is the sender of c: SMTP, or Off when the delivery is off.
func New(c Config, log *slog.Logger) Sender {
	if !c.Enabled() {
		return Off{Log: log}
	}
	return &SMTP{Config: c}
}
