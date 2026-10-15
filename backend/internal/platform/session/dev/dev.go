// Package dev is the dev identity provider of the BFF (W0.09, PD-18, PD-54): local and e2e only, never prod.
// POST /api/v1/dev/login {"persona"} starts a session for an account of the seed (issuer urn:ortus:dev or
// urn:ortus:dev-operators, subject = prototype id); POST /api/v1/dev/logout ends it. The routes are outside the
// OpenAPI contract (login, logout and CSRF are contract W0.08) and are replaced by OIDC in W1.03.
package dev

import (
	"context"
	"errors"
	"net/http"
	"regexp"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/httpx"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Dev identities of the seed (backend/cmd/seed) and the routes of the provider.
const (
	IssuerUsers     = "urn:ortus:dev"
	IssuerOperators = "urn:ortus:dev-operators"
	LoginPath       = "/api/v1/dev/login"
	LogoutPath      = "/api/v1/dev/logout"
)

// Accounts finds the account of a provider identity.
type Accounts interface {
	AccountBySubject(ctx context.Context, issuer, subject string) (tenantctx.Account, error)
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
	Persona string `json:"persona"`
}

type loginResponse struct {
	UserID    uuid.UUID `json:"userId"`
	CSRFToken string    `json:"csrfToken"`
}

// Routes mounts the dev provider on r. The caller mounts it only with AUTH_PROVIDER=dev outside prod.
func Routes(r chi.Router, m *session.Manager, accounts Accounts) {
	r.Post(LoginPath, func(w http.ResponseWriter, req *http.Request) {
		s, err := startSession(w, req, m, accounts)
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

// refused is the one answer for every failed login (12 R5): unknown persona, missing or locked account.
func refused() error { return problem.New(problem.CodeSessionExpired, "") }

func startSession(w http.ResponseWriter, r *http.Request, m *session.Manager, accounts Accounts) (session.Session, error) {
	// Login CSRF: a browser always sends Origin on POST; tools without it (k6, curl) are allowed in dev.
	if r.Header.Get("Origin") != "" {
		if err := m.CheckOrigin(r); err != nil {
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
	acc, err := accounts.AccountBySubject(r.Context(), id.issuer, id.subject)
	if errors.Is(err, tenantctx.ErrNotFound) {
		return session.Session{}, refused()
	}
	if err != nil {
		return session.Session{}, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	if acc.Status != "active" {
		return session.Session{}, refused()
	}
	if old, err := r.Cookie(m.CookieName); err == nil && old.Value != "" {
		_ = m.Store.Delete(r.Context(), old.Value) // a new login never reuses the previous session id
	}
	return m.Issue(w, r, acc.ID)
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
