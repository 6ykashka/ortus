package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	"github.com/ortus/ortus-crm/backend/internal/modules/modulesreg"
	"github.com/ortus/ortus-crm/backend/internal/modules/sched/calendar"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
)

// W4.40: the tag Calendar is served by the calendar of resources over the tenant pools, the evaluator of W1.04, the
// module states of the registry W1.08 (the vehicles and the trips need «Логистика», the visits SPA) and the clock of
// the application.
func TestNewCalendar(t *testing.T) {
	t.Parallel()
	ev := authz.New(nil, nil, time.Now)
	at := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	states := moduleStates{S: &modulesreg.Service{}}
	s, ok := newCalendar(noPools{}, ev, states, func() time.Time { return at }).(calendar.Server)
	if !ok || s.S == nil {
		t.Fatalf("calendar server %#v, want the server of W4.40", s)
	}
	if s.S.Pools != (noPools{}) || s.S.Authz != ev || s.S.Modules != states || s.S.Now == nil || !s.S.Now().Equal(at) {
		t.Fatalf("service %+v", s.S)
	}
}

// The operations of the tag Calendar reach the module through the router: without a tenant in the context the module
// answers 404; createCalendarBooking answers 501 (bookings are made by their modules, stage 5).
func TestCalendarRoutes(t *testing.T) {
	t.Parallel()
	h := newRouter(deps{servers: Servers{Calendar: newCalendar(noPools{}, authz.New(nil, nil, time.Now), nil, time.Now)}})
	n := 0
	for _, op := range catalog.Operations {
		if op.Tag != "Calendar" {
			continue
		}
		n++
		path := strings.NewReplacer("{tenantId}", "10000000-0000-4000-8000-000000000001",
			"{bookingId}", "10000000-0000-4000-8000-000000000002").Replace(op.Path)
		req := httptest.NewRequestWithContext(t.Context(), op.Method, path, strings.NewReader(`{"action": "cancel"}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", "w440-calendar-routes")
		req.Header.Set("If-Match", `"rev-1"`)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		want, why := http.StatusNotFound, "404 of the module without a tenant"
		if op.ID == "createCalendarBooking" {
			want, why = http.StatusNotImplemented, "501: bookings are made by their modules"
		}
		if rec.Code != want {
			t.Errorf("%s %s (%s): %d, want %s", op.Method, op.Path, op.ID, rec.Code, why)
		}
	}
	if n != 6 {
		t.Errorf("operations of the tag Calendar: %d, want 6 (contract 0.7.0-stage4)", n)
	}
}
