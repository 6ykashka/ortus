// Package authhttp implements the OpenAPI tag Auth (W1.03, S1-05, S1-06): sign-in through the BFF with OIDC
// Authorization Code + PKCE (startLogin, completeLogin), the CSRF token of the session, logout with its replay,
// and the invitation endpoints (inspectInvitation, acceptInvitation) on top of an Invitations service.
//
// The strict server returns response objects only, while sign-in and logout must read and set several cookies:
// WithExchange puts the request and the response writer of the call into the context for this package.
package authhttp

import (
	"context"
	"crypto/subtle"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	authapi "github.com/ortus/ortus-crm/backend/internal/api/auth"
	"github.com/ortus/ortus-crm/backend/internal/platform/idem"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
	"github.com/ortus/ortus-crm/backend/internal/platform/session/oidc"
)

// Provider keys of startLogin.
const (
	ProviderUsers     = "users"
	ProviderOperators = "operators"
)

// Defaults and limits.
const (
	LoginTTL      = 10 * time.Minute // contract: the pre-auth cookie lives 10 minutes
	loginPath     = "/api/v1/auth"
	noStore       = "private, no-store"
	maxReturnTo   = 512
	minTokenLen   = 32
	maxTokenLen   = 256
	codeValidaton = "validation_failed"
)

// returnToRE is the pattern of startLogin.returnTo (auth.yaml): a same-origin relative path.
var returnToRE = regexp.MustCompile(`^/(?:[^/\\\s\x00-\x1f\x7f][^\\\s\x00-\x1f\x7f]*)?$`)

// Providers are the configured OIDC providers (realms).
type Providers []*oidc.Provider

// ByKey returns the provider of key (users | operators) or nil.
func (ps Providers) ByKey(key string) *oidc.Provider {
	for _, p := range ps {
		if p != nil && p.Key() == key {
			return p
		}
	}
	return nil
}

// ByIssuer returns the provider of issuer or nil.
func (ps Providers) ByIssuer(issuer string) *oidc.Provider {
	for _, p := range ps {
		if p != nil && issuer != "" && p.Issuer() == issuer {
			return p
		}
	}
	return nil
}

// Accounts finds or creates the account of a verified identity.
type Accounts interface {
	Upsert(ctx context.Context, id oidc.Identity) (oidc.AccountRef, error)
}

// Revoker ends sessions by logout and keeps what a logout replay needs (oidc.PGSessionStore).
type Revoker interface {
	Revoke(ctx context.Context, id, logoutKey string, endSessionURL *string) error
	Revoked(ctx context.Context, id string) (oidc.RevokedSession, error)
}

// Invitations is the invitation service (modules/access/invitations). Its errors are problem errors.
type Invitations interface {
	Inspect(ctx context.Context, token string) (authapi.InvitationPreview, error)
	Accept(ctx context.Context, accountID uuid.UUID, token string) (authapi.InvitationAcceptance, error)
}

// RealtimeTickets issues tickets of the realtime channel (createRealtimeTicket, ADR-0015 / PD-58) — W1.07.
type RealtimeTickets interface {
	Issue(ctx context.Context, sess session.Session) (authapi.RealtimeTicket, error)
}

// Server is the strict server of the tag Auth.
type Server struct {
	Sessions    *session.Manager
	Logins      oidc.LoginStore
	Providers   Providers
	Accounts    Accounts
	Revoker     Revoker         // nil: logout deletes the session, no replay after it
	Invitations Invitations     // nil: invitation endpoints answer 501
	Realtime    RealtimeTickets // nil: createRealtimeTicket answers 501 until the channel of W1.07
	Log         *slog.Logger
	Now         func() time.Time
}

var _ authapi.StrictServerInterface = (*Server)(nil)

func (s *Server) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func (s *Server) log() *slog.Logger {
	if s.Log != nil {
		return s.Log
	}
	return slog.Default()
}

type exchangeKey struct{}

type exchange struct {
	w http.ResponseWriter
	r *http.Request
}

// WithExchange makes the request and the response writer of a call available to the handlers of this package.
func WithExchange(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ex := &exchange{w: w}
		r = r.WithContext(context.WithValue(r.Context(), exchangeKey{}, ex))
		ex.r = r
		next.ServeHTTP(w, r)
	})
}

func exchangeOf(ctx context.Context) (http.ResponseWriter, *http.Request, error) {
	ex, ok := ctx.Value(exchangeKey{}).(*exchange)
	if !ok {
		return nil, nil, problem.Wrap(problem.CodeDependencyUnavailable, errors.New("authhttp: WithExchange is not mounted"))
	}
	return ex.w, ex.r, nil
}

func headers(ctx context.Context) (cacheControl, requestID *string) {
	cc, rid := noStore, requestid.FromContext(ctx)
	return &cc, &rid
}

// loginCookieName is ortus_login, or __Secure-ortus_login when the session cookies are always Secure (prod).
// __Host- is impossible: the contract scopes the cookie to Path=/api/v1/auth.
func (s *Server) loginCookieName() string {
	if s.Sessions.Secure {
		return "__Secure-ortus_login"
	}
	return "ortus_login"
}

func (s *Server) setLoginCookie(w http.ResponseWriter, r *http.Request, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{ //nolint:gosec // G124: Secure follows Manager.SecureRequest (always in prod)
		Name: s.loginCookieName(), Value: value, Path: loginPath, MaxAge: maxAge,
		HttpOnly: true, Secure: s.Sessions.SecureRequest(r), SameSite: http.SameSiteLaxMode,
	})
}

// providerKey picks the realm of a sign-in: the operator console (/platform…, ADR-0001) signs in at the realm of
// operators when it is configured (D-03 by default, ADR-0004).
func (s *Server) providerKey(returnTo string) string {
	rest, ok := strings.CutPrefix(returnTo, "/platform")
	if ok && (rest == "" || strings.ContainsRune("/?#", rune(rest[0]))) && s.Providers.ByKey(ProviderOperators) != nil {
		return ProviderOperators
	}
	return ProviderUsers
}

// StartLogin implements authapi.StrictServerInterface.
func (s *Server) StartLogin(ctx context.Context, req authapi.StartLoginRequestObject) (authapi.StartLoginResponseObject, error) {
	w, r, err := exchangeOf(ctx)
	if err != nil {
		return nil, err
	}
	returnTo := "/"
	if req.Params.ReturnTo != nil {
		returnTo = *req.Params.ReturnTo
	}
	if len(returnTo) > maxReturnTo || !returnToRE.MatchString(returnTo) {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	key := s.providerKey(returnTo)
	p := s.Providers.ByKey(key)
	if p == nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, errors.New("authhttp: no OIDC provider "+key))
	}
	var st oidc.LoginState
	handle, err := oidc.RandomToken()
	if err == nil {
		st.State, err = oidc.RandomToken()
	}
	if err == nil {
		st.Nonce, err = oidc.RandomToken()
	}
	var challenge string
	if err == nil {
		st.Verifier, challenge, err = oidc.NewPKCE()
	}
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	authURL, err := p.AuthURL(ctx, st.State, st.Nonce, challenge)
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	st.Provider, st.ReturnTo, st.ExpiresAt = key, returnTo, s.now().Add(LoginTTL)
	if err := s.Logins.Put(ctx, handle, st); err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	s.setLoginCookie(w, r, handle, int(LoginTTL/time.Second))
	cc, rid := headers(ctx)
	return authapi.StartLogin302Response{Headers: authapi.StartLogin302ResponseHeaders{
		CacheControl: cc, Location: &authURL, XRequestId: rid,
	}}, nil
}

// refuse logs why a sign-in failed (never tokens) and returns the problem of the contract.
func (s *Server) refuse(ctx context.Context, code, reason string, err error) error {
	attrs := []any{slog.String("request_id", requestid.FromContext(ctx)), slog.String("reason", reason)}
	if err != nil {
		attrs = append(attrs, slog.String("error", err.Error()))
	}
	s.log().WarnContext(ctx, "auth: sign-in refused", attrs...)
	if err != nil {
		return problem.Wrap(code, err)
	}
	return problem.New(code, "")
}

// CompleteLogin implements authapi.StrictServerInterface.
func (s *Server) CompleteLogin(ctx context.Context, req authapi.CompleteLoginRequestObject) (authapi.CompleteLoginResponseObject, error) {
	w, r, err := exchangeOf(ctx)
	if err != nil {
		return nil, err
	}
	s.setLoginCookie(w, r, "", -1) // single use, whatever happens next
	st, err := s.takeLogin(ctx, r, req.Params.State)
	if err != nil {
		return nil, err
	}
	id, err := s.identity(ctx, st, req.Params)
	if err != nil {
		return nil, err
	}
	acc, err := s.Accounts.Upsert(ctx, id)
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	if acc.Status != "active" {
		return nil, s.refuse(ctx, problem.CodeForbiddenAction, "account "+acc.Status, nil)
	}
	if old, err := r.Cookie(s.Sessions.CookieName); err == nil && old.Value != "" {
		_ = s.Sessions.Store.Delete(ctx, old.Value) // session fixation: a sign-in never keeps the previous session
	}
	if _, err := s.Sessions.IssueFor(w, r, acc.ID, id.Issuer, id.AuthTime); err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	cc, rid := headers(ctx)
	return authapi.CompleteLogin302Response{Headers: authapi.CompleteLogin302ResponseHeaders{
		CacheControl: cc, Location: &st.ReturnTo, XRequestId: rid,
	}}, nil
}

// takeLogin consumes the sign-in record of the pre-auth cookie and checks the state in constant time.
func (s *Server) takeLogin(ctx context.Context, r *http.Request, state string) (oidc.LoginState, error) {
	c, err := r.Cookie(s.loginCookieName())
	if err != nil || c.Value == "" {
		return oidc.LoginState{}, s.refuse(ctx, problem.CodeSessionExpired, "no pre-auth cookie", nil)
	}
	st, err := s.Logins.Take(ctx, c.Value)
	if errors.Is(err, oidc.ErrLoginNotFound) {
		return oidc.LoginState{}, s.refuse(ctx, problem.CodeSessionExpired, "unknown, used or expired sign-in", nil)
	}
	if err != nil {
		return oidc.LoginState{}, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	if subtle.ConstantTimeCompare([]byte(st.State), []byte(state)) != 1 {
		return oidc.LoginState{}, s.refuse(ctx, problem.CodeSessionExpired, "state mismatch", nil)
	}
	return st, nil
}

// identity handles the answer of the provider: an error, or the code exchanged for a verified identity with a
// verified e-mail (invitations compare it, an unverified address would open someone else's invitation).
func (s *Server) identity(ctx context.Context, st oidc.LoginState, params authapi.CompleteLoginParams) (oidc.Identity, error) {
	if params.Error != nil {
		switch *params.Error {
		case "access_denied":
			return oidc.Identity{}, s.refuse(ctx, problem.CodeForbiddenAction, "provider: access_denied", nil)
		case "server_error", "temporarily_unavailable":
			return oidc.Identity{}, s.refuse(ctx, problem.CodeDependencyUnavailable, "provider: "+*params.Error, nil)
		}
		return oidc.Identity{}, s.refuse(ctx, problem.CodeSessionExpired, "provider error", nil)
	}
	if params.Code == nil || *params.Code == "" {
		return oidc.Identity{}, problem.New(problem.CodeMalformedRequest, "")
	}
	p := s.Providers.ByKey(st.Provider)
	if p == nil {
		return oidc.Identity{}, s.refuse(ctx, problem.CodeSessionExpired, "provider "+st.Provider+" is not configured", nil)
	}
	id, err := p.Exchange(ctx, *params.Code, st.Verifier, st.Nonce)
	switch {
	case errors.Is(err, oidc.ErrRejected):
		return oidc.Identity{}, s.refuse(ctx, problem.CodeSessionExpired, "token rejected", err)
	case err != nil:
		return oidc.Identity{}, problem.Wrap(problem.CodeDependencyUnavailable, err)
	case !id.EmailVerified || id.Email == "":
		return oidc.Identity{}, s.refuse(ctx, problem.CodeForbiddenAction, "e-mail is not verified", nil)
	}
	return id, nil
}

func sessionOf(ctx context.Context) (session.Session, error) {
	sess, ok := session.FromContext(ctx)
	if !ok {
		return session.Session{}, problem.New(problem.CodeSessionExpired, "")
	}
	return sess, nil
}

// GetCsrfToken implements authapi.StrictServerInterface: the synchronizer token of the session.
func (s *Server) GetCsrfToken(ctx context.Context, _ authapi.GetCsrfTokenRequestObject) (authapi.GetCsrfTokenResponseObject, error) {
	sess, err := sessionOf(ctx)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return authapi.GetCsrfToken200JSONResponse{
		Body:    authapi.CsrfToken{CsrfToken: sess.CSRF, HeaderName: authapi.XCSRFToken, ExpiresAt: sess.ExpiresAt},
		Headers: authapi.GetCsrfToken200ResponseHeaders{CacheControl: cc, XRequestId: rid},
	}, nil
}

// endSessionURL is the RP-initiated logout URL of the provider of the session (nil for the dev provider).
func (s *Server) endSessionURL(ctx context.Context, sess session.Session) *string {
	p := s.Providers.ByIssuer(sess.Provider)
	if p == nil {
		return nil
	}
	u, err := p.EndSessionURL(ctx)
	if err != nil {
		s.log().WarnContext(ctx, "auth: end session URL unavailable", slog.String("error", err.Error()))
		return nil
	}
	return u
}

// Logout implements authapi.StrictServerInterface: the session is revoked under the Idempotency-Key of the call and
// both cookies are expired.
func (s *Server) Logout(ctx context.Context, req authapi.LogoutRequestObject) (authapi.LogoutResponseObject, error) {
	w, r, err := exchangeOf(ctx)
	if err != nil {
		return nil, err
	}
	sess, err := sessionOf(ctx)
	if err != nil {
		return nil, err
	}
	end := s.endSessionURL(ctx, sess)
	if s.Revoker != nil {
		err := s.Revoker.Revoke(ctx, sess.ID, req.Params.IdempotencyKey, end)
		if errors.Is(err, session.ErrNotFound) {
			return nil, problem.New(problem.CodeSessionExpired, "")
		}
		if err != nil {
			return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
		}
	}
	if err := s.Sessions.Clear(w, r); err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	cc, rid := headers(ctx)
	return authapi.Logout200JSONResponse{
		Body:    authapi.LogoutResult{EndSessionUrl: end},
		Headers: authapi.Logout200ResponseHeaders{CacheControl: cc, XRequestId: rid},
	}, nil
}

// ReplayLogout answers a repeated logout whose session the first call revoked (Q-W1.01-10): the gateway of cmd/api
// refuses the revoked session with 401 before idem.Guard, so it asks here first. It replays only for the same
// Idempotency-Key, with the CSRF token of that session and an allowed Origin; otherwise it writes nothing and returns
// false, and the gateway answers 401 (contract: "after the session is gone a new key returns 401").
func (s *Server) ReplayLogout(w http.ResponseWriter, r *http.Request) bool {
	if s.Revoker == nil {
		return false
	}
	c, err := r.Cookie(s.Sessions.CookieName)
	key := r.Header.Get(idem.HeaderKey)
	if err != nil || c.Value == "" || key == "" || s.Sessions.CheckOrigin(r) != nil {
		return false
	}
	rv, err := s.Revoker.Revoked(r.Context(), c.Value)
	if err != nil || rv.LogoutKey == "" ||
		subtle.ConstantTimeCompare([]byte(rv.LogoutKey), []byte(key)) != 1 ||
		subtle.ConstantTimeCompare([]byte(rv.CSRF), []byte(r.Header.Get(session.CSRFHeader))) != 1 {
		return false
	}
	if err := s.Sessions.Clear(w, r); err != nil {
		return false
	}
	cc, rid := headers(r.Context())
	replayed := true
	resp := authapi.Logout200JSONResponse{
		Body:    authapi.LogoutResult{EndSessionUrl: rv.EndSessionURL},
		Headers: authapi.Logout200ResponseHeaders{CacheControl: cc, IdempotencyReplayed: &replayed, XRequestId: rid},
	}
	if err := resp.VisitLogoutResponse(w); err != nil {
		s.log().WarnContext(r.Context(), "auth: logout replay", slog.String("error", err.Error()))
	}
	return true
}

// checkToken validates the invitation token of a body (InvitationToken: 32…256 characters).
func checkToken(body *authapi.InvitationToken) (string, error) {
	if body == nil || len(body.Token) < minTokenLen || len(body.Token) > maxTokenLen {
		return "", problem.New(codeValidaton, "")
	}
	return body.Token, nil
}

// InspectInvitation implements authapi.StrictServerInterface (public POST read; the Origin, when sent, must be
// allowed).
func (s *Server) InspectInvitation(ctx context.Context, req authapi.InspectInvitationRequestObject) (authapi.InspectInvitationResponseObject, error) {
	if s.Invitations == nil {
		return nil, problem.New(problem.CodeNotImplemented, "")
	}
	if req.Params.Origin != nil {
		_, r, err := exchangeOf(ctx)
		if err != nil {
			return nil, err
		}
		if err := s.Sessions.CheckOrigin(r); err != nil {
			return nil, err
		}
	}
	token, err := checkToken(req.Body)
	if err != nil {
		return nil, err
	}
	preview, err := s.Invitations.Inspect(ctx, token)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return authapi.InspectInvitation200JSONResponse{
		Body: preview, Headers: authapi.InspectInvitation200ResponseHeaders{CacheControl: cc, XRequestId: rid},
	}, nil
}

// AcceptInvitation implements authapi.StrictServerInterface (session of the invited person; CSRF, Origin and the
// Idempotency-Key are checked by the gateway).
func (s *Server) AcceptInvitation(ctx context.Context, req authapi.AcceptInvitationRequestObject) (authapi.AcceptInvitationResponseObject, error) {
	if s.Invitations == nil {
		return nil, problem.New(problem.CodeNotImplemented, "")
	}
	sess, err := sessionOf(ctx)
	if err != nil {
		return nil, err
	}
	token, err := checkToken(req.Body)
	if err != nil {
		return nil, err
	}
	res, err := s.Invitations.Accept(ctx, sess.AccountID, token)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return authapi.AcceptInvitation200JSONResponse{
		Body: res, Headers: authapi.AcceptInvitation200ResponseHeaders{CacheControl: cc, XRequestId: rid},
	}, nil
}

// CreateRealtimeTicket implements authapi.StrictServerInterface (contract 0.4.0-stage1): the ticket belongs to the
// realtime channel of W1.07 (ADR-0015); without it the operation answers 501 like a tag without implementation.
func (s *Server) CreateRealtimeTicket(ctx context.Context, _ authapi.CreateRealtimeTicketRequestObject) (authapi.CreateRealtimeTicketResponseObject, error) {
	if s.Realtime == nil {
		return nil, problem.New(problem.CodeNotImplemented, "")
	}
	sess, err := sessionOf(ctx)
	if err != nil {
		return nil, err
	}
	ticket, err := s.Realtime.Issue(ctx, sess)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return authapi.CreateRealtimeTicket201JSONResponse{
		Body: ticket, Headers: authapi.CreateRealtimeTicket201ResponseHeaders{CacheControl: cc, XRequestId: rid},
	}, nil
}
