package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	"github.com/ortus/ortus-crm/backend/internal/modules/finance"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
)

// The tag Earnings is the module finance of W2.06 (S2-12): wired on the pools, the evaluator and the clock of main.
func TestNewEarnings(t *testing.T) {
	t.Parallel()
	ev := authz.New(nil, nil, time.Now)
	at := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	srv := newEarnings(noPools{}, ev, func() time.Time { return at })
	s, ok := srv.(finance.Server)
	if !ok || s.S == nil || s.S.Authz != ev || s.S.Pools == nil || s.S.Now == nil || !s.S.Now().Equal(at) {
		t.Fatalf("earnings server %#v, want finance of W2.06 on the evaluator and the clock of main", srv)
	}
}

// Every operation of the tag Earnings reaches the module through the router (a write without its Idempotency-Key
// is 400 of the strict server, a read without a tenant — 404 of the module), none answers 501 any more.
func TestEarningsRoutes(t *testing.T) {
	t.Parallel()
	h := newRouter(deps{servers: Servers{Earnings: newEarnings(noPools{}, authz.New(nil, nil, time.Now), time.Now)}})
	n := 0
	for _, op := range catalog.Operations {
		if op.Tag != "Earnings" {
			continue
		}
		n++
		path := fleetPathParam.ReplaceAllStringFunc(op.Path, func(string) string { return uuid.NewString() })
		req := httptest.NewRequestWithContext(t.Context(), op.Method, path, strings.NewReader(`{"amount": {"amountMinor": 1, "currency": "RUB"}}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code == http.StatusNotImplemented {
			t.Errorf("%s %s (%s): 501, want the module finance", op.Method, op.Path, op.ID)
		}
	}
	if n != 3 {
		t.Errorf("operations of the tag Earnings: %d, want 3 (contract 0.5.0-stage2)", n)
	}
}
