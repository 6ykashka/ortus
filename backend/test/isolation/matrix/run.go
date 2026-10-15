package matrix

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	harness "github.com/ortus/ortus-crm/backend/test"
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures"
)

// Target is the API under test. Requests go straight to Handler (httptest), so the suite needs no port.
type Target struct {
	Handler http.Handler
	// Authenticate attaches the credentials of actor to r (the dev session of W0.09). It is not called for
	// anonymous rows.
	Authenticate func(r *http.Request, a fixtures.Actor) error
}

// Env is what a target is built from.
type Env struct {
	World  *fixtures.World
	Clock  func() time.Time    // the fixed «now» of the suite (harness.Now); grant periods are relative to it
	Getenv func(string) string // keys of deploy/compose/.env.example (fixtures.World.Env)
}

// Factory builds the target of the suite; stop releases its resources.
type Factory func(ctx context.Context, env Env) (t Target, stop func(), err error)

// Resolver resolves fixture references and actors (fixtures.Catalog, fixtures.World).
type Resolver interface {
	ID(ref string) (uuid.UUID, error)
	Actor(key string) (fixtures.Actor, error)
}

// Suite is what rows run against.
type Suite struct {
	Refs   Resolver
	Target Target
	// Strict makes pending rows check their real expectations (build tag isolation_pending).
	Strict bool
}

// NewSuite returns a suite whose Strict follows the build tag isolation_pending.
func NewSuite(refs Resolver, t Target) *Suite {
	return &Suite{Refs: refs, Target: t, Strict: strictPending}
}

// CodeNotImplemented is the Problem code of NotImplemented.
const CodeNotImplemented = "not_implemented"

// NotImplemented is the target of a suite without an API yet: every request answers 501, which a pending row
// accepts. The strict server of W0.09 answers 501 for an operation without a handler only after its gateway:
// anonymous, foreign-tenant and no-right requests get 401/404/403 first, and a pending row accepts those too
// when they match the row (checkPending).
func NotImplemented() Target {
	return Target{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", harness.ProblemContentType)
			w.WriteHeader(http.StatusNotImplemented)
			_, _ = io.WriteString(w, notImplementedBody)
		}),
		Authenticate: func(*http.Request, fixtures.Actor) error { return nil },
	}
}

// notImplementedBody is the constant Problem of NotImplemented.
const notImplementedBody = `{"type":"about:blank","title":"Not Implemented","status":501,"code":"` +
	CodeNotImplemented + `","requestId":"isolation-stub"}`

// missingID is an id that names nothing in the fixtures: a foreign object must answer like it (AC-01).
var missingID = uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:isolation:missing"))

var bodyRefRe = regexp.MustCompile(`\{\{([^{}]+)\}\}`)

// BodyRefs returns the {{reference}} placeholders of a request body.
func BodyRefs(body string) []string {
	var out []string
	for _, m := range bodyRefRe.FindAllStringSubmatch(body, -1) {
		out = append(out, m[1])
	}
	return out
}

// Run runs every row of f as a parallel subtest: Test…/<op>/<row>.
func Run(t *testing.T, s *Suite, f File) {
	t.Helper()
	for _, ep := range f.Endpoints {
		t.Run(ep.Op, func(t *testing.T) {
			t.Parallel()
			for _, r := range ep.Rows {
				t.Run(RowName(r), func(t *testing.T) {
					t.Parallel()
					for _, v := range Check(t.Context(), s, ep, r) {
						t.Errorf("%s.yaml %s %s, actor %s: %s", f.Module, ep.Method, ep.Path, r.Actor, v)
					}
				})
			}
		})
	}
}

// RowName is the subtest name of a row: actor[,param=ref…]→status.
func RowName(r Row) string {
	var b strings.Builder
	b.WriteString(r.Actor)
	keys := make([]string, 0, len(r.Params))
	for k := range r.Params {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	for _, k := range keys {
		b.WriteString("," + k + "=" + r.Params[k])
	}
	fmt.Fprintf(&b, "→%d", r.Status)
	return b.String()
}

type response struct {
	status int
	header http.Header
	body   string
}

// Check runs one row against the target and returns its violations (none when the row holds).
func Check(ctx context.Context, s *Suite, ep Endpoint, r Row) []string {
	resp, err := s.do(ctx, ep, r, nil)
	if err != nil {
		return []string{err.Error()}
	}
	if ep.Pending != "" && !s.Strict {
		return s.checkPending(ctx, ep, r, resp)
	}
	return s.verify(ctx, ep, r, resp)
}

// checkPending checks a row written before its handler. The operation gateway of W0.09 answers before the
// handler (session 401 → CSRF/Origin 403 → membership 404/403 → right 403), and only a request it lets through
// reaches the 501 of an operation without a handler. So the row passes on 501 or when the answer already holds
// against the row's own expectations. A 2xx answer to a positive row means the handler exists: pending must go.
func (s *Suite) checkPending(ctx context.Context, ep Endpoint, r Row, resp response) []string {
	if resp.status == http.StatusNotImplemented {
		return nil
	}
	v := s.verify(ctx, ep, r, resp)
	if isSuccess(r.Status) && isSuccess(resp.status) {
		return append([]string{fmt.Sprintf("pending %s: got %d, want 501 (no handler yet) — the handler exists: "+
			"remove `pending: %s` from the row file and run go generate ./test/isolation", ep.Pending, resp.status, ep.Pending)}, v...)
	}
	if len(v) == 0 {
		return nil
	}
	return append([]string{fmt.Sprintf("pending %s: got %d — neither 501 (no handler yet) nor the row's expectations",
		ep.Pending, resp.status)}, v...)
}

func isSuccess(status int) bool { return status >= 200 && status < 300 }

// verify checks the answer against the row: status, Problem body of an error, present and absent ids, AC-01.
func (s *Suite) verify(ctx context.Context, ep Endpoint, r Row, resp response) []string {
	var v []string
	if resp.status != r.Status {
		v = append(v, fmt.Sprintf("status %d, want %d (body %s)", resp.status, r.Status, clip(resp.body)))
	}
	if resp.status >= 400 {
		if _, err := harness.ParseProblem(resp.header.Get("Content-Type"), []byte(resp.body)); err != nil {
			v = append(v, fmt.Sprintf("error status %d without a valid problem body: %v", resp.status, err))
		}
	}
	v = append(v, s.leaks(resp, r)...)
	if r.Status == http.StatusNotFound && len(r.Params) > 0 && resp.status == http.StatusNotFound {
		v = append(v, s.sameAsMissing(ctx, ep, r, resp)...)
	}
	return v
}

func (s *Suite) leaks(resp response, r Row) []string {
	var v []string
	body := strings.ToLower(resp.body)
	for _, ref := range r.Present {
		id, err := s.Refs.ID(ref)
		if err != nil {
			v = append(v, err.Error())
			continue
		}
		if !strings.Contains(body, id.String()) {
			v = append(v, fmt.Sprintf("present %s (%s) is missing from the body", ref, id))
		}
	}
	for _, ref := range r.Absent {
		id, err := s.Refs.ID(ref)
		if err != nil {
			v = append(v, err.Error())
			continue
		}
		if strings.Contains(body, id.String()) {
			v = append(v, fmt.Sprintf("leak: body contains %s (%s)", ref, id))
		}
		for name, values := range resp.header {
			if slices.ContainsFunc(values, func(h string) bool { return strings.Contains(strings.ToLower(h), id.String()) }) {
				v = append(v, fmt.Sprintf("leak: header %s contains %s (%s)", name, ref, id))
			}
		}
	}
	return v
}

// sameAsMissing repeats a 404 row with every object id replaced by an unknown one: status and Problem code
// must not tell a foreign object from a missing one (AC-01, «Foreign and invisible object IDs return the same 404»).
func (s *Suite) sameAsMissing(ctx context.Context, ep Endpoint, r Row, foreign response) []string {
	missing := map[string]uuid.UUID{}
	for p := range r.Params {
		missing[p] = missingID
	}
	twin, err := s.do(ctx, ep, r, missing)
	if err != nil {
		return []string{err.Error()}
	}
	fc, mc := problemCode(foreign), problemCode(twin)
	if twin.status != foreign.status || fc != mc {
		return []string{fmt.Sprintf("AC-01: a foreign id answers %d %s, an unknown id answers %d %s — the answers must be the same",
			foreign.status, fc, twin.status, mc)}
	}
	return nil
}

func problemCode(r response) string {
	p, err := harness.ParseProblem(r.header.Get("Content-Type"), []byte(r.body))
	if err != nil {
		return "(no problem body)"
	}
	return p.Code
}

// do sends the request of a row; override replaces the ids of path params.
func (s *Suite) do(ctx context.Context, ep Endpoint, r Row, override map[string]uuid.UUID) (response, error) {
	path := ep.Path
	for p, ref := range r.Params {
		id, ok := override[p]
		if !ok {
			var err error
			if id, err = s.Refs.ID(ref); err != nil {
				return response{}, err
			}
		}
		path = strings.ReplaceAll(path, "{"+p+"}", id.String())
	}
	body, err := s.body(r.Body)
	if err != nil {
		return response{}, err
	}
	req := httptest.NewRequestWithContext(ctx, ep.Method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if r.Actor != fixtures.Anonymous {
		a, err := s.Refs.Actor(r.Actor)
		if err != nil {
			return response{}, err
		}
		if err := s.Target.Authenticate(req, a); err != nil {
			return response{}, fmt.Errorf("authenticate %s: %w", r.Actor, err)
		}
	}
	rec := record(s.Target.Handler, req)
	return response{status: rec.Code, header: rec.Header(), body: rec.Body.String()}, nil
}

func (s *Suite) body(tmpl string) (string, error) {
	var err error
	out := bodyRefRe.ReplaceAllStringFunc(tmpl, func(m string) string {
		id, e := s.Refs.ID(m[2 : len(m)-2])
		if e != nil {
			err = e
			return m
		}
		return id.String()
	})
	return out, err
}

func record(h http.Handler, req *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func clip(s string) string {
	const limit = 300
	if len(s) <= limit {
		return s
	}
	return s[:limit] + "…"
}
