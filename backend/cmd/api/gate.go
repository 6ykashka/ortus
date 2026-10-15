package main

import (
	"context"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strings"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/httpx"
	"github.com/ortus/ortus-crm/backend/internal/platform/idem"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

const (
	apiPrefix      = "/api/v1/"
	tenantPrefix   = "/api/v1/tenants/{tenantId}/"
	platformPrefix = "/api/v1/platform/"
)

// route is a compiled operation of the catalog.
type route struct {
	op       catalog.Operation
	segments []string
	literals int
}

// opIndex finds the operation of a request by method and path template (static segments win over parameters,
// as in chi), before chi binds parameters: the gateway answers 401/404 before a malformed parameter gives 400.
type opIndex struct{ routes []route }

func newOpIndex(ops []catalog.Operation) *opIndex {
	idx := &opIndex{}
	for _, op := range ops {
		segs := strings.Split(strings.Trim(op.Path, "/"), "/")
		lit := 0
		for _, s := range segs {
			if !isParam(s) {
				lit++
			}
		}
		idx.routes = append(idx.routes, route{op: op, segments: segs, literals: lit})
	}
	return idx
}

func isParam(seg string) bool { return strings.HasPrefix(seg, "{") && strings.HasSuffix(seg, "}") }

// routePath is the path chi routes by: the escaped r.URL.RawPath when set, else r.URL.Path. The gateway must match
// exactly what the router matches, or an encoded slash (%2F) would change the number of segments for one of them
// and let a request reach a handler without the gateway (review of W0.09).
func routePath(r *http.Request) string {
	if r.URL.RawPath != "" {
		return r.URL.RawPath
	}
	return r.URL.Path
}

// match returns the operation of method and route path (see routePath) with its unescaped path parameters. Like
// chi, it compares segments as they are on the wire: no trimming of extra or trailing slashes.
func (idx *opIndex) match(method, path string) (catalog.Operation, map[string]string, bool) {
	rest, ok := strings.CutPrefix(path, "/")
	if !ok {
		return catalog.Operation{}, nil, false
	}
	parts := strings.Split(rest, "/")
	var (
		best   *route
		params map[string]string
	)
	for i := range idx.routes {
		rt := &idx.routes[i]
		if rt.op.Method != method || len(rt.segments) != len(parts) || (best != nil && rt.literals <= best.literals) {
			continue
		}
		if p, ok := bind(rt.segments, parts); ok {
			best, params = rt, p
		}
	}
	if best == nil {
		return catalog.Operation{}, nil, false
	}
	return best.op, params, true
}

func bind(segments, parts []string) (map[string]string, bool) {
	params := map[string]string{}
	for i, s := range segments {
		switch {
		case isParam(s):
			v, err := url.PathUnescape(parts[i])
			if parts[i] == "" || err != nil {
				return nil, false
			}
			params[s[1:len(s)-1]] = v
		case s != parts[i]:
			return nil, false
		}
	}
	return params, true
}

// gateway is the access pipeline of every contract operation (plan 27 stage 0: "browser → BFF → API → tenant DB
// with a permission check"): session (401) → CSRF and Origin of mutations (403) → platform operator (404) or
// membership and tenant state (404/403) → x-permissions (403) → Idempotency-Key of mutations (idem.Guard, W1.01)
// → handler. Public operations (security: []) skip it.
// It fails closed: a request under /api/v1/ that matches no operation and no extra route gets 404 without reaching
// the router, so a router match the gateway missed can never skip the checks.
type gateway struct {
	ops      *opIndex
	sessions *session.Manager
	dir      tenantctx.Directory
	authz    tenantctx.Authorizer
	extra    []string    // routes under /api/v1/ outside the contract (dev provider), passed to the router as is
	idem     *idem.Guard // nil: no idempotency (unit tests of the gateway)
	// replays answer a repeat of an operation whose first call ended the session (logout, Q-W1.01-10): the
	// session is gone, so the answer comes before the 401 of the gateway, or not at all.
	replays map[string]replayFunc
}

func (g *gateway) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := routePath(r)
		op, params, ok := g.ops.match(r.Method, path)
		if !ok {
			if underAPI(r) && !slices.Contains(g.extra, path) {
				notFound(w, r)
				return
			}
			next.ServeHTTP(w, r)
			return
		}
		if op.Public {
			next.ServeHTTP(w, r)
			return
		}
		r, err := g.admit(r, op, params)
		if err != nil {
			if replay, ok := g.replays[op.ID]; ok && problem.Is(err, problem.CodeSessionExpired) && replay(w, r) {
				return
			}
			problem.Write(w, r, err)
			return
		}
		if g.idem != nil && op.Mutating {
			g.idem.Serve(w, r, namespace(r, op), next) // S1-25: after the permission check (W1.01)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// namespace is the idempotency scope of an admitted request: tenant of the path (none for identity and platform
// operations), account of the session and operationId.
func namespace(r *http.Request, op catalog.Operation) idem.Namespace {
	ns := idem.Namespace{Operation: op.ID}
	if s, ok := session.FromContext(r.Context()); ok {
		ns.ActorID = s.AccountID
	}
	if tc, ok := tenantctx.FromContext(r.Context()); ok {
		ns.TenantID = tc.TenantID
	}
	return ns
}

// underAPI reports whether the request targets the API namespace in its decoded or its escaped form.
func underAPI(r *http.Request) bool {
	return strings.HasPrefix(r.URL.Path, apiPrefix) || strings.HasPrefix(r.URL.RawPath, apiPrefix)
}

// operationAdmitter is an authorizer that also weighs the x-scope of the operation (authz.Gateway, W1.04).
type operationAdmitter interface {
	Admit(ctx context.Context, tc tenantctx.TenantContext, op authz.Operation) error
}

// permit checks x-permissions of op: with its x-scope when the authorizer knows scopes (the evaluator of W1.04),
// with the permissions alone otherwise.
func (g *gateway) permit(ctx context.Context, tc tenantctx.TenantContext, op catalog.Operation) error {
	if a, ok := g.authz.(operationAdmitter); ok {
		return a.Admit(ctx, tc, authz.Operation{ID: op.ID, Permissions: op.Permissions, Mode: op.PermissionsMode, Scope: op.Scope})
	}
	return g.authz.Permit(ctx, tc, op.Permissions, op.PermissionsMode)
}

func (g *gateway) admit(r *http.Request, op catalog.Operation, params map[string]string) (*http.Request, error) {
	s, err := g.sessions.Authenticate(r)
	if err != nil {
		return r, err
	}
	if op.Mutating {
		if err := g.sessions.CheckCSRF(r, s); err != nil {
			return r, err
		}
	}
	ctx := session.WithSession(r.Context(), s)
	httpx.AddAttrs(ctx, slog.String("actor_id", s.AccountID.String()), slog.String("operation", op.ID))
	switch {
	case strings.HasPrefix(op.Path, platformPrefix):
		isOp, err := g.dir.IsPlatformOperator(ctx, s.AccountID)
		if err != nil {
			return r, problem.Wrap(problem.CodeDependencyUnavailable, err)
		}
		if !isOp {
			return r, problem.New(problem.CodeNotFound, "")
		}
	case strings.HasPrefix(op.Path, tenantPrefix):
		tc, err := tenantctx.Resolve(ctx, g.dir, s.AccountID, params["tenantId"], op.Mutating)
		if err != nil {
			return r, err
		}
		httpx.AddAttrs(ctx, slog.String("tenant_id", tc.TenantID.String()))
		if err := g.permit(ctx, tc, op); err != nil {
			return r, err
		}
		ctx = tenantctx.WithTenant(ctx, tc)
	}
	return r.WithContext(ctx), nil
}
