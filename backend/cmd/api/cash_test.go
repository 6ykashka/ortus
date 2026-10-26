package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	"github.com/ortus/ortus-crm/backend/internal/modules/cash"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
)

// The tag Cash is the module cash of W5.31: wired on the pools, the evaluator and the clock of main.
func TestNewCash(t *testing.T) {
	t.Parallel()
	ev := authz.New(nil, nil, time.Now)
	at := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	srv := newCash(noPools{}, ev, func() time.Time { return at })
	s, ok := srv.(cash.Server)
	if !ok || s.S == nil || s.S.Authz != ev || s.S.Pools == nil || s.S.Now == nil || !s.S.Now().Equal(at) {
		t.Fatalf("cash server %#v, want the module cash of W5.31 on the evaluator and the clock of main", srv)
	}
}

// Every operation of the tag Cash reaches the module through the router, none answers 501 any more.
func TestCashRoutes(t *testing.T) {
	t.Parallel()
	h := newRouter(deps{servers: Servers{Cash: newCash(noPools{}, authz.New(nil, nil, time.Now), time.Now)}})
	n := 0
	for _, op := range catalog.Operations {
		if op.Tag != "Cash" {
			continue
		}
		n++
		path := fleetPathParam.ReplaceAllStringFunc(op.Path, func(string) string { return uuid.NewString() })
		req := httptest.NewRequestWithContext(t.Context(), op.Method, path, strings.NewReader(`{}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code == http.StatusNotImplemented {
			t.Errorf("%s %s (%s): 501, want the module cash", op.Method, op.Path, op.ID)
		}
	}
	if n != 26 {
		t.Errorf("operations of the tag Cash: %d, want 26 (contract 0.12.0-stage5)", n)
	}
}
