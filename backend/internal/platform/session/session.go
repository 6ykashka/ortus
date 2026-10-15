// Package session is the BFF session of cmd/api (W0.09): an opaque id in an HttpOnly cookie, a double-submit
// CSRF token in a readable cookie, exact Origin checks for cookie mutations. The identity provider (dev in W0.09,
// OIDC in W1.03) only decides which account gets a session; this package never sees passwords or tokens.
package session

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// CSRFHeader carries the double-submit token on mutations.
const CSRFHeader = "X-CSRF-Token"

// Session is one browser session.
type Session struct {
	ID        string
	AccountID uuid.UUID
	CSRF      string
	IssuedAt  time.Time
	ExpiresAt time.Time
}

// Manager issues, reads and clears sessions.
type Manager struct {
	CookieName     string        // SESSION_COOKIE_NAME, default ortus_sid
	CSRFCookieName string        // ortus_csrf
	TTL            time.Duration // SESSION_TTL
	AllowedOrigins []string      // ALLOWED_ORIGINS: exact origins of the SPA
	Now            func() time.Time
	Store          Store
}

func (m *Manager) now() time.Time {
	if m.Now != nil {
		return m.Now()
	}
	return time.Now()
}

func token() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("session: random: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// secure reports whether cookies must carry Secure: TLS here or at the proxy.
func secure(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

func (m *Manager) setCookies(w http.ResponseWriter, r *http.Request, sid, csrf string, maxAge int) {
	sec := secure(r)
	// Secure follows the transport: the local stand serves http://127.0.0.1:<port>, where a Secure cookie is dropped.
	http.SetCookie(w, &http.Cookie{ //nolint:gosec // G124: Secure is set whenever the request came over TLS
		Name: m.CookieName, Value: sid, Path: "/", MaxAge: maxAge,
		HttpOnly: true, Secure: sec, SameSite: http.SameSiteLaxMode,
	})
	// Double-submit token: JavaScript must read it to send X-CSRF-Token, so it is not HttpOnly by design.
	http.SetCookie(w, &http.Cookie{ //nolint:gosec // G124: the double-submit CSRF cookie is readable by design
		Name: m.CSRFCookieName, Value: csrf, Path: "/", MaxAge: maxAge,
		Secure: sec, SameSite: http.SameSiteLaxMode,
	})
}

// Issue creates a session for accountID and sets both cookies.
func (m *Manager) Issue(w http.ResponseWriter, r *http.Request, accountID uuid.UUID) (Session, error) {
	id, err := token()
	if err != nil {
		return Session{}, err
	}
	csrf, err := token()
	if err != nil {
		return Session{}, err
	}
	now := m.now()
	s := Session{ID: id, AccountID: accountID, CSRF: csrf, IssuedAt: now, ExpiresAt: now.Add(m.TTL)}
	if err := m.Store.Create(r.Context(), s); err != nil {
		return Session{}, fmt.Errorf("session: create: %w", err)
	}
	m.setCookies(w, r, id, csrf, int(m.TTL/time.Second))
	return s, nil
}

// Clear deletes the session of r (if any) from the store and expires both cookies.
func (m *Manager) Clear(w http.ResponseWriter, r *http.Request) error {
	if c, err := r.Cookie(m.CookieName); err == nil && c.Value != "" {
		if err := m.Store.Delete(r.Context(), c.Value); err != nil && !errors.Is(err, ErrNotFound) {
			return fmt.Errorf("session: delete: %w", err)
		}
	}
	m.setCookies(w, r, "", "", -1)
	return nil
}

// Authenticate returns the live session of r. No, unknown or expired session (and a bearer token, which W0.09 does
// not accept) → session_expired; a session cookie together with a bearer token → malformed_request.
func (m *Manager) Authenticate(r *http.Request) (Session, error) {
	c, cerr := r.Cookie(m.CookieName)
	hasCookie := cerr == nil && c.Value != ""
	if r.Header.Get("Authorization") != "" {
		if hasCookie {
			return Session{}, problem.New(problem.CodeMalformedRequest, "")
		}
		return Session{}, problem.New(problem.CodeSessionExpired, "")
	}
	if !hasCookie {
		return Session{}, problem.New(problem.CodeSessionExpired, "")
	}
	s, err := m.Store.Get(r.Context(), c.Value)
	if errors.Is(err, ErrNotFound) {
		return Session{}, problem.New(problem.CodeSessionExpired, "")
	}
	if err != nil {
		return Session{}, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	if !m.now().Before(s.ExpiresAt) {
		_ = m.Store.Delete(r.Context(), s.ID) // best effort: an expired session is unusable either way
		return Session{}, problem.New(problem.CodeSessionExpired, "")
	}
	return s, nil
}

// CheckOrigin requires an Origin header equal to one of AllowedOrigins.
func (m *Manager) CheckOrigin(r *http.Request) error {
	if o := r.Header.Get("Origin"); o == "" || !slices.Contains(m.AllowedOrigins, o) {
		return problem.New(problem.CodeOriginNotAllowed, "")
	}
	return nil
}

// CheckCSRF validates a cookie-authenticated mutation: exact Origin, then X-CSRF-Token equal to the session token.
func (m *Manager) CheckCSRF(r *http.Request, s Session) error {
	if err := m.CheckOrigin(r); err != nil {
		return err
	}
	got := r.Header.Get(CSRFHeader)
	if got == "" || subtle.ConstantTimeCompare([]byte(got), []byte(s.CSRF)) != 1 {
		return problem.New(problem.CodeCSRFFailed, "")
	}
	return nil
}

type ctxKey struct{}

// WithSession returns ctx carrying s.
func WithSession(ctx context.Context, s Session) context.Context {
	return context.WithValue(ctx, ctxKey{}, s)
}

// FromContext returns the session put by the gateway.
func FromContext(ctx context.Context) (Session, bool) {
	s, ok := ctx.Value(ctxKey{}).(Session)
	return s, ok
}
