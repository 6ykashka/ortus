package main

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	"github.com/ortus/ortus-crm/backend/internal/modules/docs"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

var quiet = slog.New(slog.DiscardHandler)

func docsEnv(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

const secret32 = "0123456789abcdef0123456789abcdef"

// W7.23 (D-32, ADR-0016): the document server is configuration — none until chosen, then one URL with the shared secret.
func TestDocsEngine(t *testing.T) {
	t.Parallel()
	e, err := docsEngine(docsEnv(nil), quiet)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := e.(docs.NoEngine); !ok || e.Configured() {
		t.Fatalf("no variables: %T, want NoEngine", e)
	}
	e, err = docsEngine(docsEnv(map[string]string{"DOCS_SERVER_URL": "https://docs.example", "DOCS_SERVER_JWT_SECRET": secret32,
		"DOCS_SERVER_INTERNAL_URL": "http://docs:80"}), quiet)
	if err != nil || !e.Configured() {
		t.Fatalf("a server: %v %v", e, err)
	}
	if oo, ok := e.(*docs.OnlyOffice); !ok || oo.InternalURL != "http://docs:80" {
		t.Fatalf("engine %#v", e)
	}
	for name, vars := range map[string]map[string]string{
		"url without a secret": {"DOCS_SERVER_URL": "https://docs.example"},
		"secret without a url": {"DOCS_SERVER_JWT_SECRET": secret32},
		"short secret":         {"DOCS_SERVER_URL": "https://docs.example", "DOCS_SERVER_JWT_SECRET": "short"},
	} {
		if _, err := docsEngine(env(vars), quiet); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestDocsLinkKey(t *testing.T) {
	t.Parallel()
	if _, err := docsLinkKey(docsEnv(nil), envProd, quiet); err == nil {
		t.Error("prod without DOCS_LINK_KEY")
	}
	if _, err := docsLinkKey(docsEnv(map[string]string{"DOCS_LINK_KEY": "short"}), envDev, quiet); err == nil {
		t.Error("a short key")
	}
	k, err := docsLinkKey(docsEnv(map[string]string{"DOCS_LINK_KEY": secret32}), envProd, quiet)
	if err != nil || string(k.LinkKey()) != secret32 {
		t.Fatalf("key %q %v", k, err)
	}
	a, err := docsLinkKey(docsEnv(nil), envDev, quiet)
	if err != nil || len(a.LinkKey()) != minSecret {
		t.Fatalf("dev key: %v %v", a, err)
	}
	b, _ := docsLinkKey(docsEnv(nil), envDev, quiet)
	if string(a) == string(b) {
		t.Error("the keys of two processes are equal")
	}
}

// The module gets the control DB, the inbox and the places of folders and documents for the evaluator.
func TestNewDocs(t *testing.T) {
	t.Parallel()
	ev := authz.New(nil, nil, time.Now)
	w, err := newDocs(noPools{}, nil, ev, docsEnv(nil), envDev, quiet, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := w.docs.(docs.Server); !ok || w.public == nil || w.callback == nil {
		t.Fatalf("wiring %+v", w)
	}
	if _, ok := ev.Places[authz.KindDoc].(docs.DocResolver); !ok {
		t.Errorf("place of a document: %T", ev.Places[authz.KindDoc])
	}
	if _, ok := ev.Places[authz.KindFolder].(docs.FolderResolver); !ok {
		t.Errorf("place of a folder: %T", ev.Places[authz.KindFolder])
	}
	if r := ev.NodeRules[authz.KindDoc]; r.Manage != "docs.share" || r.Create != "docs.create" {
		t.Errorf("node rule of a document: %+v", r)
	}
	if _, err := newDocs(noPools{}, nil, ev, docsEnv(map[string]string{"DOCS_SERVER_URL": "https://x"}), envDev, quiet, time.Now); err == nil {
		t.Error("half a configuration of the document server was accepted")
	}
}

// The 45 operations of the tag Docs reach the module through the router: without a tenant the module answers 404; the
// sync of datasets waits for its stream (501); the route, the signature and the acknowledgement are W7.24.
func TestDocsRoutes(t *testing.T) {
	t.Parallel()
	w, err := newDocs(noPools{}, nil, authz.New(nil, nil, time.Now), docsEnv(nil), envDev, quiet, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	later := map[string]bool{"syncDocDataset": true}
	h := newRouter(deps{servers: Servers{Docs: w.docs, PublicDocs: w.public}})
	n := 0
	for _, op := range catalog.Operations {
		if op.Tag != "Docs" {
			continue
		}
		n++
		path := op.Path
		for _, p := range []string{"{tenantId}", "{documentId}", "{folderId}", "{jobId}", "{commentId}", "{linkId}", "{wordId}"} {
			path = strings.ReplaceAll(path, p, "10000000-0000-4000-8000-000000000001")
		}
		path = strings.ReplaceAll(path, "{version}", "1")
		req := httptest.NewRequestWithContext(t.Context(), op.Method, path+"?q=x", strings.NewReader(`{}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", "w723-docs-routes")
		req.Header.Set("If-Match", `"rev-1"`)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		want := http.StatusNotFound
		if later[op.ID] {
			want = http.StatusNotImplemented
		}
		if rec.Code != want {
			t.Errorf("%s %s (%s): %d, want %d", op.Method, op.Path, op.ID, rec.Code, want)
		}
	}
	if n != 45 {
		t.Errorf("operations of the tag Docs: %d, want 45 (contract 0.12.0-stage7)", n)
	}
}

// The guest's opening and the call of the document server reach the module: a link unknown to the index is 404, a call
// the gateway did not check is 401.
func TestPublicDocsRoutes(t *testing.T) {
	t.Parallel()
	w, err := newDocs(noPools{}, nil, authz.New(nil, nil, time.Now), docsEnv(nil), envDev, quiet, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	h := newRouter(deps{servers: Servers{Docs: w.docs, PublicDocs: w.public}})
	for _, c := range []struct {
		method, path string
		want         int
	}{
		{http.MethodPost, "/api/v1/public/doc-links/some-token/open", http.StatusNotFound},
		{http.MethodPost, "/api/v1/internal/docs/callback", http.StatusUnauthorized},
	} {
		req := httptest.NewRequestWithContext(t.Context(), c.method, c.path, strings.NewReader(`{"key":"x","status":1}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", "w723-public")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != c.want {
			t.Errorf("%s %s: %d, want %d", c.method, c.path, rec.Code, c.want)
		}
	}
}

// The gateway lets the call of the document server in on its JWT: no session, the key of idempotency is made of the
// body, a refused call never reaches the handler (ADR-0016).
func TestServerCall(t *testing.T) {
	t.Parallel()
	var seen struct {
		key, body string
		authed    bool
	}
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		seen.key, seen.body, seen.authed = r.Header.Get("Idempotency-Key"), string(b), docs.ServerAuthed(r.Context())
		w.WriteHeader(http.StatusOK)
	})
	allow := func(r *http.Request) (context.Context, error) { return r.Context(), nil }
	call := func(g *gateway, body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		g.serverCall(rec, httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/internal/docs/callback", strings.NewReader(body)), next)
		return rec
	}
	if rec := call(&gateway{docsCallback: allow}, `{"key":"k","status":2}`); rec.Code != http.StatusOK || seen.body != `{"key":"k","status":2}` ||
		!strings.HasPrefix(seen.key, "docs-callback-") {
		t.Fatalf("allowed call: %d body %q key %q", rec.Code, seen.body, seen.key)
	}
	first := seen.key
	call(&gateway{docsCallback: allow}, `{"key":"k","status":2}`)
	if seen.key != first {
		t.Errorf("a repeat of the call has another key: %q, %q", seen.key, first)
	}
	call(&gateway{docsCallback: allow}, `{"key":"k","status":6}`)
	if seen.key == first {
		t.Error("another call has the same key")
	}
	seen.body = ""
	refuse := func(*http.Request) (context.Context, error) { return nil, problem.New("session_expired", "") }
	if rec := call(&gateway{docsCallback: refuse}, `{}`); rec.Code != http.StatusUnauthorized || seen.body != "" {
		t.Fatalf("refused call: %d, reached the handler: %q", rec.Code, seen.body)
	}
	if rec := call(&gateway{}, `{}`); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("no document server: %d, want 503", rec.Code)
	}
}
