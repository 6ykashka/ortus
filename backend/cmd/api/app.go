package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"reflect"

	"github.com/go-chi/chi/v5"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	"github.com/ortus/ortus-crm/backend/internal/control/branding"
	"github.com/ortus/ortus-crm/backend/internal/modules/chats"
	"github.com/ortus/ortus-crm/backend/internal/modules/forms"
	"github.com/ortus/ortus-crm/backend/internal/platform/httpx"
	"github.com/ortus/ortus-crm/backend/internal/platform/idem"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/realtime"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
	"github.com/ortus/ortus-crm/backend/internal/platform/session/dev"
	"github.com/ortus/ortus-crm/backend/internal/platform/session/oidc/authhttp"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// csrfCookie is the double-submit cookie read by the SPA (A-23 of the load profile W0.16).
const csrfCookie = "ortus_csrf"

// deps is everything the handler needs; main builds it from the environment, tests from fakes.
type deps struct {
	cfg      config
	log      *slog.Logger
	dir      tenantctx.Directory
	sessions *session.Manager
	authz    tenantctx.Authorizer
	servers  Servers
	ready    func(context.Context) error // nil: always ready
	idem     *idem.Guard                 // nil: no idempotency (unit tests)
	replays  map[string]replayFunc       // operationId → answer for a revoked session (logout, W1.03)
	modules  moduleGate                  // nil: no module check (unit tests); W1.08
	// platformRoles is the role of an operator for the x-permissions of /platform/** (W4.60); nil — no role check.
	platformRoles platformRoles
	// newcomers creates the account of a first dev login outside the seed (W1.50, APP_ENV dev | e2e); nil — none.
	newcomers dev.Creator
	// background runs until its context ends: the subscription lifecycle of W1.08 and the LISTEN of the realtime
	// channel of W1.42; runServer cancels it and waits for it before closing the pools. nil — nothing.
	background func(context.Context)
	// realtime is the WebSocket gateway GET /api/v1/realtime (ADR-0015, W1.42); nil — the route is not mounted.
	realtime http.Handler
	// brandAssets serves the public files of the branding GET /brand-assets/{file} (W4.60); nil — not mounted.
	brandAssets http.Handler
	// stopping runs before the HTTP server shuts down: it closes the hijacked sockets and waits for them until ctx
	// ends; nil — nothing.
	stopping func(ctx context.Context)
	// docsCallback checks the JWT of a call of the document server (W7.23, ADR-0016); nil — the operation answers 503.
	docsCallback func(*http.Request) (context.Context, error)
	// chats is the service of the tag Chats (W7.11): the stack tests run its jobs by term (Sweep) the way the background
	// job of the process does; nil — not wired (unit tests).
	chats *chats.Service
}

// replayFunc answers a repeated command whose session the first call ended; false — not a replay (401).
type replayFunc func(w http.ResponseWriter, r *http.Request) bool

// newHandler is the HTTP handler of cmd/api: request id → access log → panic recovery → security headers →
// gateway → router.
func newHandler(d deps) http.Handler {
	g := &gateway{
		ops: newOpIndex(catalog.Operations), sessions: d.sessions, dir: d.dir, authz: d.authz,
		// The router answers 404 itself when dev or the realtime channel is not mounted; the WebSocket path is outside
		// the contract paths, its authentication is the ticket of the first frame (ADR-0015).
		extra:   []string{dev.LoginPath, dev.LogoutPath, realtime.Path},
		idem:    d.idem,
		replays: d.replays,
		modules: d.modules,       // W1.08
		roles:   d.platformRoles, // W4.60
		// W7.23: the call of the document server carries no session, its JWT is checked instead
		docsCallback: d.docsCallback,
	}
	// authhttp.WithExchange: the strict server of the tag Auth reads and sets cookies (W1.03).
	return requestid.Middleware(httpx.Logging(d.log)(httpx.Recover(d.log)(httpx.SecurityHeaders(
		g.middleware(authhttp.WithExchange(newRouter(d)))))))
}

func notFound(w http.ResponseWriter, r *http.Request) {
	problem.Write(w, r, problem.New(problem.CodeNotFound, ""))
}

// newRouter mounts the contract (generated mountTags), the dev provider and the health checks.
func newRouter(d deps) chi.Router {
	r := chi.NewRouter()
	// An unknown route and a known path with another method are the same 404 (12 §5 item 1).
	r.NotFound(notFound)
	r.MethodNotAllowed(notFound)
	r.Use(forms.NullsMiddleware) // W4.21: the explicit nulls of the patches of a form and of a response

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		httpx.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	r.Get("/readyz", func(w http.ResponseWriter, req *http.Request) {
		if d.ready != nil {
			if err := d.ready(req.Context()); err != nil {
				problem.Write(w, req, problem.Wrap(problem.CodeDependencyUnavailable, err))
				return
			}
		}
		httpx.JSON(w, http.StatusOK, map[string]string{"status": "ready"})
	})
	if d.cfg.AuthProvider == envDev && d.cfg.AppEnv != envProd {
		dev.Routes(r, d.sessions, d.dir, dev.Newcomers(d.cfg.AppEnv, d.newcomers))
	}
	if d.realtime != nil {
		r.Get(realtime.Path, d.realtime.ServeHTTP) // W1.42: the WebSocket gateway of the realtime channel
	}
	if d.brandAssets != nil {
		r.Get(branding.PublicPrefix+"{file}", d.brandAssets.ServeHTTP) // W4.60: logos and signs, public and immutable
	}
	mountTags(r, d.servers, mountOptions{
		requestError: func(w http.ResponseWriter, req *http.Request, err error) {
			if missingHeader(err) == headerIfMatch { // Q-W1.11-9 (W1.48): PreconditionRequired of the contract
				problem.Write(w, req, problem.Wrap(codeRevisionRequired, err))
				return
			}
			problem.Write(w, req, problem.Wrap(problem.CodeMalformedRequest, err))
		},
		responseError: problem.Write,
		notImplemented: func(r chi.Router, tag string) {
			for _, op := range catalog.Operations {
				if op.Tag == tag {
					r.MethodFunc(op.Method, op.Path, notImplemented)
				}
			}
		},
	})
	if d.servers.Access != nil {
		mountAccessPending(r) // W1.05: operations of the tag without an owner yet stay 501 (access.go)
	}
	if d.servers.Fleet != nil {
		mountFleetPending(r, d.servers.Fleet) // W2.02: operations the composed server does not serve stay 501 (fleet.go)
	}
	if d.servers.Repairs != nil {
		mountRepairsPending(r) // W6.11: operations of the tag without an owner yet stay 501 (repairs.go)
	}
	return r
}

func notImplemented(w http.ResponseWriter, r *http.Request) {
	problem.Write(w, r, problem.New(problem.CodeNotImplemented, ""))
}

// headerIfMatch and codeRevisionRequired: a command without If-Match is 428 revision_required (api/errors.yaml).
const (
	headerIfMatch        = "If-Match"
	codeRevisionRequired = "revision_required"
)

// missingHeader returns the header a generated strict server found missing (its *RequiredHeaderError, one type per
// tag package with the field ParamName), "" for any other error.
func missingHeader(err error) string {
	for ; err != nil; err = errors.Unwrap(err) {
		v := reflect.ValueOf(err)
		if v.Kind() != reflect.Pointer || v.IsNil() || v.Elem().Kind() != reflect.Struct || v.Elem().Type().Name() != "RequiredHeaderError" {
			continue
		}
		if f := v.Elem().FieldByName("ParamName"); f.IsValid() && f.Kind() == reflect.String {
			return f.String()
		}
	}
	return ""
}
