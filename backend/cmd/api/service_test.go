package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	"github.com/ortus/ortus-crm/backend/internal/modules/service"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
)

// The tags Service and PublicService are the module «Обращения» of W7.31: wired on the pools, the evaluator and the clock.
func TestNewService(t *testing.T) { //nolint:gocyclo // the tests share one seeded database and run in the order of the files
	t.Parallel()
	ev := authz.New(nil, nil, time.Now)
	at := time.Date(2026, 10, 1, 13, 24, 0, 0, time.UTC)
	s := newService(noPools{}, ev, nil, func() time.Time { return at })
	if s.Authz != ev || s.Pools == nil || s.Tasks == nil || s.Projects == nil || s.Index != nil || s.Directory != nil || s.Audience == nil || !s.Now().Equal(at) {
		t.Fatalf("service %#v, want the module of W7.31 on the evaluator, the clock and the ports of «Задачи»", s)
	}
	srv, pub := serviceServers(s, []string{"https://crm.example"})
	if got, ok := srv.(service.Server); !ok || got.S != s {
		t.Errorf("tag Service %#v", srv)
	}
	if got, ok := pub.(service.PublicServer); !ok || got.S != s || len(got.Origins) != 1 {
		t.Errorf("tag PublicService %#v", pub)
	}
}

// Every operation of the two tags reaches the module through the router, none answers 501 any more.
func TestServiceRoutes(t *testing.T) {
	t.Parallel()
	s := newService(noPools{}, authz.New(nil, nil, time.Now), nil, time.Now)
	srv, pub := serviceServers(s, nil)
	h := newRouter(deps{servers: Servers{Service: srv, PublicService: pub}})
	count := map[string]int{}
	for _, op := range catalog.Operations {
		if op.Tag != "Service" && op.Tag != "PublicService" {
			continue
		}
		count[op.Tag]++
		path := fleetPathParam.ReplaceAllStringFunc(op.Path, func(string) string { return uuid.NewString() })
		req := httptest.NewRequestWithContext(t.Context(), op.Method, path, strings.NewReader(`{}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code == http.StatusNotImplemented {
			t.Errorf("%s %s (%s): 501, want the module «Обращения»", op.Method, op.Path, op.ID)
		}
	}
	if count["Service"] != 21 || count["PublicService"] != 9 {
		t.Errorf("operations: %v, want 21 of Service and 9 of PublicService (contract 0.12.0-stage7)", count)
	}
}

func TestServiceSweepEvery(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name, raw, env string
		want           time.Duration
		bad            bool
	}{
		{"off outside prod", "", "dev", 0, false}, {"a minute in prod", "", envProd, time.Minute, false},
		{"set", "30s", "dev", 30 * time.Second, false}, {"zero is off", "0", envProd, 0, false}, {"garbage", "soon", "dev", 0, true}, {"negative", "-1m", "dev", 0, true},
	} {
		got, err := serviceSweepEvery(func(string) string { return c.raw }, c.env)
		if (err != nil) != c.bad || got != c.want {
			t.Errorf("%s: %v %v, want %v (bad %v)", c.name, got, err, c.want, c.bad)
		}
	}
	if serviceSweep(nil, nil, 0, nil) != nil {
		t.Error("an interval of 0 starts no job")
	}
}
