package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	spamodule "github.com/ortus/ortus-crm/backend/internal/modules/spa"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
)

// The tag Spa is the module spa of W5.20: wired on the pools, the evaluator, the stock, the cash desk and the clock of main.
func TestNewSpa(t *testing.T) {
	t.Parallel()
	ev := authz.New(nil, nil, time.Now)
	at := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	srv := newSpa(noPools{}, ev, func() time.Time { return at })
	s, ok := srv.(spamodule.Server)
	if !ok || s.S == nil || s.S.Authz != ev || s.S.Pools == nil || s.S.Stock == nil || s.S.Offers == nil || s.S.Now == nil || !s.S.Now().Equal(at) {
		t.Fatalf("spa server %#v, want the module spa of W5.20 on the evaluator, the stock, the cash desk and the clock of main", srv)
	}
}

// Every operation of the tag Spa reaches the module through the router, none answers 501 any more.
func TestSpaRoutes(t *testing.T) {
	t.Parallel()
	h := newRouter(deps{servers: Servers{Spa: newSpa(noPools{}, authz.New(nil, nil, time.Now), time.Now)}})
	n := 0
	for _, op := range catalog.Operations {
		if op.Tag != "Spa" {
			continue
		}
		n++
		path := fleetPathParam.ReplaceAllStringFunc(op.Path, func(string) string { return uuid.NewString() })
		req := httptest.NewRequestWithContext(t.Context(), op.Method, path, strings.NewReader(`{}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code == http.StatusNotImplemented {
			t.Errorf("%s %s (%s): 501, want the module spa", op.Method, op.Path, op.ID)
		}
	}
	if n != 11 {
		t.Errorf("operations of the tag Spa: %d, want 11 (contract 0.12.0-stage5)", n)
	}
}
