package home

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	homeapi "github.com/ortus/ortus-crm/backend/internal/api/home"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
)

// inRequest runs fn with ctx and the request id id, as requestid.Middleware sets it.
func inRequest(ctx context.Context, id string, fn func(ctx context.Context)) {
	r := httptest.NewRequestWithContext(ctx, http.MethodGet, "/api/v1/me/decisions", nil)
	r.Header.Set(requestid.Header, id)
	requestid.Middleware(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { fn(r.Context()) })).
		ServeHTTP(httptest.NewRecorder(), r)
}

// The server reads the account of the session the gateway admitted, the default limit is 8, the answer is never
// cached and carries the request id.
func TestServer(t *testing.T) {
	t.Parallel()
	cards := make([]homeapi.DecisionItem, 0, 10)
	for range 10 {
		cards = append(cards, card("tenant.trial_ending", homeapi.Neutral))
	}
	srv := Server{S: service(t, directory{m: membership("active", "active", false)}, nil, &source{items: cards})}

	_, err := srv.GetMyDecisionQueue(t.Context(), homeapi.GetMyDecisionQueueRequestObject{Params: homeapi.GetMyDecisionQueueParams{TenantId: tenantA}})
	wantCode(t, err, problem.CodeSessionExpired)

	inRequest(session.WithSession(t.Context(), session.Session{AccountID: account}), "req-1", func(ctx context.Context) {
		checkServer(ctx, t, srv)
	})
}

func checkServer(ctx context.Context, t *testing.T, srv Server) {
	t.Helper()
	resp, err := srv.GetMyDecisionQueue(ctx, homeapi.GetMyDecisionQueueRequestObject{Params: homeapi.GetMyDecisionQueueParams{TenantId: tenantA}})
	if err != nil {
		t.Fatal(err)
	}
	ok, isOK := resp.(homeapi.GetMyDecisionQueue200JSONResponse)
	if !isOK || len(ok.Body.Items) != DefaultLimit || ok.Body.Total != 10 {
		t.Fatalf("response %#v", resp)
	}
	w := httptest.NewRecorder()
	if err := ok.VisitGetMyDecisionQueueResponse(w); err != nil {
		t.Fatal(err)
	}
	if cc := w.Header().Get("Cache-Control"); cc != "private, no-store" {
		t.Errorf("Cache-Control %q", cc)
	}
	if id := w.Header().Get("X-Request-Id"); id != "req-1" {
		t.Errorf("X-Request-Id %q", id)
	}

	three := 3
	resp, err = srv.GetMyDecisionQueue(ctx, homeapi.GetMyDecisionQueueRequestObject{Params: homeapi.GetMyDecisionQueueParams{TenantId: tenantA, Limit: &three}})
	if err != nil {
		t.Fatal(err)
	}
	if ok, _ := resp.(homeapi.GetMyDecisionQueue200JSONResponse); len(ok.Body.Items) != 3 {
		t.Fatalf("limit 3: %#v", resp)
	}
	zero := 0
	_, err = srv.GetMyDecisionQueue(ctx, homeapi.GetMyDecisionQueueRequestObject{Params: homeapi.GetMyDecisionQueueParams{TenantId: tenantA, Limit: &zero}})
	wantCode(t, err, problem.CodeMalformedRequest)

	// A foreign tenant is the 404 of a missing one.
	_, err = srv.GetMyDecisionQueue(ctx, homeapi.GetMyDecisionQueueRequestObject{Params: homeapi.GetMyDecisionQueueParams{TenantId: person}})
	wantCode(t, err, problem.CodeNotFound)
}
