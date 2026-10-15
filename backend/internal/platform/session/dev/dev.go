// Package dev is the dev identity provider of the BFF (W0.09, PD-18, PD-54): local and e2e only, never prod.
// POST /api/v1/dev/login {"persona"} starts a session for an account of the seed (issuer urn:ortus:dev or
// urn:ortus:dev-operators, subject = prototype id); POST /api/v1/dev/logout ends it. The routes are outside the
// OpenAPI contract (login, logout and CSRF are contract W0.08) and are replaced by OIDC in W1.03.
//
// With Newcomers (W1.50, APP_ENV dev | e2e) a login {"persona", "email", "displayName"} of a subject outside the
// seed creates its account as the first OIDC sign-in does, so a person who has never signed in can accept an
// invitation on a stand without Keycloak.
package dev

import (
	"context"
	"errors"
	"net/http"
	"net/mail"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/httpx"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
	"github.com/ortus/ortus-crm/backend/internal/platform/session/oidc"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Dev identities of the seed (backend/cmd/seed) and the routes of the provider.
const (
	IssuerUsers     = "urn:ortus:dev"
	IssuerOperators = "urn:ortus:dev-operators"
	LoginPath       = "/api/v1/dev/login"
	LogoutPath      = "/api/v1/dev/logout"
)

// Limits of a newcomer: an e-mail address (RFC 5321 path) and a display name.
const (
	maxEmail = 254
	maxName  = 200
)

// Accounts finds the account of a provider identity.
type Accounts interface {
	AccountBySubject(ctx context.Context, issuer, subject string) (tenantctx.Account, error)
}

// Creator creates the account of a provider identity on its first sign-in (oidc.PGAccounts, W1.03).
type Creator interface {
	Upsert(ctx context.Context, id oidc.Identity) (oidc.AccountRef, error)
}

type identity struct{ issuer, subject string }

// personas of the e2e harness (frontend/packages/e2e-kit/src/persona.ts) → identities of the seed W0.06.
var personas = map[string]identity{
	"operator":          {IssuerOperators, "op-1"}, // Евгения Лаптева
	"owner":             {IssuerUsers, "acc-1"},    // Дарья Зимина, «Альта Групп»
	"manager":           {IssuerUsers, "acc-2"},    // Марина Котова
	"driver":            {IssuerUsers, "acc-3"},    // Илья Васильев
	"therapist":         {IssuerUsers, "acc-4"},    // Анна Морозова
	"foreman":           {IssuerUsers, "acc-5"},    // Алексей Соколов
	"owner@t-lotos":     {IssuerUsers, "acc-11"},   // Ирина Белова, SPA «Лотос»
	"therapist@t-lotos": {IssuerUsers, "acc-4"},    // Анна Морозова (вторая организация)
}

var (
	userSubject     = regexp.MustCompile(`^[a-z0-9][a-z0-9@._-]{0,63}$`) // acc-N of the seed, iso-<actor> of W0.15
	operatorSubject = regexp.MustCompile(`^op-[0-9]{1,4}$`)
)

func lookup(persona string) (identity, bool) {
	if id, ok := personas[persona]; ok {
		return id, true
	}
	switch {
	case operatorSubject.MatchString(persona):
		return identity{IssuerOperators, persona}, true
	case userSubject.MatchString(persona):
		return identity{IssuerUsers, persona}, true
	}
	return identity{}, false
}

type loginRequest struct {
	Persona     string `json:"persona"`
	Email       string `json:"email"`       // W1.50: a newcomer only
	DisplayName string `json:"displayName"` // W1.50: a newcomer only; "" — the e-mail
}

type loginResponse struct {
	UserID    uuid.UUID `json:"userId"`
	CSRFToken string    `json:"csrfToken"`
}

// provider is the dev provider of one router.
type provider struct {
	m        *session.Manager
	accounts Accounts
	creator  Creator // nil: a subject outside the seed is refused
}

// Option configures the provider.
type Option func(*provider)

// Newcomers lets a login of a user subject outside the seed with an e-mail create its account (W1.50). It takes
// effect only with appEnv dev or e2e and a non-nil c; otherwise such a login is refused like any unknown persona.
func Newcomers(appEnv string, c Creator) Option {
	return func(p *provider) {
		if (appEnv == "dev" || appEnv == "e2e") && c != nil {
			p.creator = c
		}
	}
}

// Routes mounts the dev provider on r. The caller mounts it only with AUTH_PROVIDER=dev outside prod.
func Routes(r chi.Router, m *session.Manager, accounts Accounts, opts ...Option) {
	p := &provider{m: m, accounts: accounts}
	for _, o := range opts {
		o(p)
	}
	r.Post(LoginPath, func(w http.ResponseWriter, req *http.Request) {
		s, err := p.startSession(w, req)
		if err != nil {
			problem.Write(w, req, err)
			return
		}
		httpx.JSON(w, http.StatusOK, loginResponse{UserID: s.AccountID, CSRFToken: s.CSRF})
	})
	r.Post(LogoutPath, func(w http.ResponseWriter, req *http.Request) {
		if err := endSession(w, req, m); err != nil {
			problem.Write(w, req, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

// refused is the one answer for every failed login (12 R5): unknown persona, missing or locked account, a newcomer
// that may not be created.
func refused() error { return problem.New(problem.CodeSessionExpired, "") }

func (p *provider) startSession(w http.ResponseWriter, r *http.Request) (session.Session, error) {
	// Login CSRF: a browser always sends Origin on POST; tools without it (k6, curl) are allowed in dev.
	if r.Header.Get("Origin") != "" {
		if err := p.m.CheckOrigin(r); err != nil {
			return session.Session{}, err
		}
	}
	var body loginRequest
	if err := httpx.DecodeStrict(r, &body); err != nil {
		return session.Session{}, err
	}
	id, ok := lookup(body.Persona)
	if !ok {
		return session.Session{}, refused()
	}
	accountID, status, err := p.account(r.Context(), id, body)
	if err != nil {
		return session.Session{}, err
	}
	if status != "active" {
		return session.Session{}, refused()
	}
	if old, err := r.Cookie(p.m.CookieName); err == nil && old.Value != "" {
		_ = p.m.Store.Delete(r.Context(), old.Value) // a new login never reuses the previous session id
	}
	return p.m.Issue(w, r, accountID)
}

// account finds the account of the identity; a newcomer's account is created (W1.50). The e-mail and the name of a
// login never change an account that exists.
func (p *provider) account(ctx context.Context, id identity, body loginRequest) (uuid.UUID, string, error) {
	acc, err := p.accounts.AccountBySubject(ctx, id.issuer, id.subject)
	switch {
	case err == nil:
		return acc.ID, acc.Status, nil
	case !errors.Is(err, tenantctx.ErrNotFound):
		return uuid.Nil, "", problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	newcomer, ok := p.newcomer(id, body)
	if !ok {
		return uuid.Nil, "", refused()
	}
	ref, err := p.creator.Upsert(ctx, newcomer)
	if err != nil {
		return uuid.Nil, "", problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return ref.ID, ref.Status, nil
}

// newcomer is the identity of a first login as the first OIDC sign-in sees it (a verified e-mail; the name, else the
// e-mail); false when the provider creates no accounts, the persona is an alias of the seed or an operator, or the
// e-mail or the name is not acceptable.
func (p *provider) newcomer(id identity, body loginRequest) (oidc.Identity, bool) {
	if p.creator == nil || id.issuer != IssuerUsers {
		return oidc.Identity{}, false
	}
	if _, alias := personas[body.Persona]; alias {
		return oidc.Identity{}, false
	}
	email := oidc.NormalizeEmail(body.Email)
	name := strings.TrimSpace(body.DisplayName)
	if !validEmail(email) || utf8.RuneCountInString(name) > maxName || strings.ContainsFunc(name, unicode.IsControl) {
		return oidc.Identity{}, false
	}
	if name == "" {
		name = email
	}
	return oidc.Identity{Issuer: id.issuer, Subject: id.subject, Email: email, EmailVerified: true, Name: name}, true
}

// validEmail: a bare address local@domain (no display name, comments or spaces), at most 254 bytes.
func validEmail(s string) bool {
	if s == "" || len(s) > maxEmail || strings.ContainsFunc(s, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) }) {
		return false
	}
	a, err := mail.ParseAddress(s)
	return err == nil && a.Name == "" && a.Address == s
}

func endSession(w http.ResponseWriter, r *http.Request, m *session.Manager) error {
	s, err := m.Authenticate(r)
	if err != nil {
		return err
	}
	if err := m.CheckCSRF(r, s); err != nil {
		return err
	}
	return m.Clear(w, r)
}
