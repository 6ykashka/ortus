package main

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	"github.com/ortus/ortus-crm/backend/internal/platform/httpx"
	"github.com/ortus/ortus-crm/backend/internal/platform/idem"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
	"github.com/ortus/ortus-crm/backend/internal/platform/session/dev"
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
}

// newHandler is the HTTP handler of cmd/api: request id → access log → panic recovery → security headers →
// gateway → router.
func newHandler(d deps) http.Handler {
	g := &gateway{
		ops: newOpIndex(catalog.Operations), sessions: d.sessions, dir: d.dir, authz: d.authz,
		extra: []string{dev.LoginPath, dev.LogoutPath}, // the router answers 404 itself when dev is not mounted
		idem:  d.idem,
	}
	return requestid.Middleware(httpx.Logging(d.log)(httpx.Recover(d.log)(httpx.SecurityHeaders(g.middleware(newRouter(d))))))
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
		dev.Routes(r, d.sessions, d.dir)
	}
	mountTags(r, d.servers, mountOptions{
		requestError: func(w http.ResponseWriter, req *http.Request, err error) {
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
	return r
}

func notImplemented(w http.ResponseWriter, r *http.Request) {
	problem.Write(w, r, problem.New(problem.CodeNotImplemented, ""))
}
