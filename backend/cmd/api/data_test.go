package main

import (
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	"github.com/ortus/ortus-crm/backend/internal/modules/data"
	"github.com/ortus/ortus-crm/backend/internal/modules/modulesreg"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
)

// W2.08: the tag Data is served by the module data — the registry with the datasets of logistics («Автомобили»,
// «Поездки», «Расходы») over the tenant pools and the evaluator, the module states of the registry W1.08 and the
// clock of the application.
func TestNewData(t *testing.T) {
	t.Parallel()
	ev := authz.New(nil, nil, time.Now)
	at := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	states := moduleStates{S: &modulesreg.Service{}}
	srv := newData(noPools{}, ev, states, func() time.Time { return at })
	s, ok := srv.(data.Server)
	if !ok || s.S == nil {
		t.Fatalf("data server %#v", srv)
	}
	if s.S.Pools != (noPools{}) || s.S.Authz != ev || s.S.Modules != states || s.S.Now == nil || !s.S.Now().Equal(at) {
		t.Fatalf("service %+v", s.S)
	}
	if got := s.S.Registry.IDs(); !slices.Equal(got, []string{"fleet.vehicles", "fleet.trips", "fleet.expenses"}) {
		t.Fatalf("datasets %v", got)
	}
}

// dataPendingOps are the operations of the tag Data the module does not serve yet: they answer 501 not_implemented
// (W2.52, contract 0.6.1-stage2: exportDataset until W2.50).
var dataPendingOps = map[string]bool{"exportDataset": true}

// The operations of the tag Data reach the module through the router: without a tenant in the context the module
// answers 404; the operations of dataPendingOps answer 501 until their owners.
func TestDataRoutes(t *testing.T) {
	t.Parallel()
	h := newRouter(deps{servers: Servers{Data: newData(noPools{}, authz.New(nil, nil, time.Now), nil, time.Now)}})
	n := 0
	for _, op := range catalog.Operations {
		if op.Tag != "Data" {
			continue
		}
		n++
		path := strings.NewReplacer("{tenantId}", "10000000-0000-4000-8000-000000000001", "{datasetId}", "fleet.trips").Replace(op.Path)
		req := httptest.NewRequestWithContext(t.Context(), op.Method, path,
			strings.NewReader(`{"select": ["trip"], "filters": [], "sort": [], "limit": 50}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		want, why := http.StatusNotFound, "404 of the module without a tenant"
		if dataPendingOps[op.ID] {
			want, why = http.StatusNotImplemented, "501 until its owner"
		}
		if rec.Code != want {
			t.Errorf("%s %s (%s): %d, want %s", op.Method, op.Path, op.ID, rec.Code, why)
		}
	}
	if n != 3 {
		t.Errorf("operations of the tag Data: %d, want 3 (contract 0.6.1-stage2)", n)
	}
}
