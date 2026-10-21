package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	"github.com/ortus/ortus-crm/backend/internal/modules/knowledge"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
)

// W4.31: the tag Knowledge is served by the knowledge base over the tenant pools, the memberships and owner bindings
// of the control DB, the notifications of the inbox (the evaluator of W1.04 as their audience) and the clock of the
// application.
func TestNewKnowledge(t *testing.T) {
	t.Parallel()
	ev := authz.New(nil, nil, time.Now)
	at := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	s, ok := newKnowledge(noPools{}, nil, ev, func() time.Time { return at }).(knowledge.Server)
	if !ok || s.S == nil {
		t.Fatalf("knowledge server %#v, want the server of W4.31", s)
	}
	if s.S.Pools != (noPools{}) || s.S.Now == nil || !s.S.Now().Equal(at) || s.S.Relations != nil {
		t.Fatalf("service %+v", s.S)
	}
	if _, ok := s.S.Memberships.(knowledge.PGMemberships); !ok {
		t.Errorf("memberships %T, want the control DB", s.S.Memberships)
	}
	if _, ok := s.S.Recipients.(inbox.PGRecipients); !ok {
		t.Errorf("recipients %T, want the control DB", s.S.Recipients)
	}
	if a, ok := s.S.Audience.(inbox.AuthzAudience); !ok || a.E != ev {
		t.Errorf("audience %#v, want the evaluator", s.S.Audience)
	}
}

// The evaluator knows the places of spaces and pages (explainAccess of knowledge objects, W4.01 п.3) and what the
// actions of the knowledge base mean to the lists of pages and to a limited space.
func TestKnowledgeEvaluator(t *testing.T) {
	t.Parallel()
	ev := authz.New(nil, nil, time.Now)
	registerKnowledge(ev, noPools{})
	if _, ok := ev.Places[authz.KindSpace].(knowledge.SpaceResolver); !ok {
		t.Errorf("place of a space: %T", ev.Places[authz.KindSpace])
	}
	if _, ok := ev.Places[authz.KindPage].(knowledge.PageResolver); !ok {
		t.Errorf("place of a page: %T", ev.Places[authz.KindPage])
	}
	if r := ev.NodeRules[authz.KindPage]; r.Manage != "knowledge.access.manage" || r.Create != "knowledge.create" {
		t.Errorf("node rule of a page: %+v", r)
	}
	if got := ev.ContainerReads[authz.KindSpace]; len(got) != 1 || got[0] != "knowledge.read" {
		t.Errorf("reads of a limited space: %v", got)
	}
}

// The 36 operations of the tag Knowledge reach the module through the router: without a tenant in the context the
// module answers 404 (none is 501).
func TestKnowledgeRoutes(t *testing.T) {
	t.Parallel()
	h := newRouter(deps{servers: Servers{Knowledge: newKnowledge(noPools{}, nil, authz.New(nil, nil, time.Now), time.Now)}})
	n := 0
	for _, op := range catalog.Operations {
		if op.Tag != "Knowledge" {
			continue
		}
		n++
		path := op.Path
		for _, p := range []string{"{tenantId}", "{spaceId}", "{nodeId}", "{requestId}", "{ruleId}", "{memberId}", "{pageId}"} {
			path = strings.ReplaceAll(path, p, "10000000-0000-4000-8000-000000000001")
		}
		path = strings.ReplaceAll(path, "{version}", "1")
		req := httptest.NewRequestWithContext(t.Context(), op.Method, path+"?q=rules&memberId=10000000-0000-4000-8000-000000000001",
			strings.NewReader(`{}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", "w431-knowledge-routes")
		req.Header.Set("If-Match", `"rev-1"`)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s %s (%s): %d, want 404 of the module without a tenant", op.Method, op.Path, op.ID, rec.Code)
		}
	}
	if n != 36 {
		t.Errorf("operations of the tag Knowledge: %d, want 36 (contract 0.9.0-stage4)", n)
	}
}
