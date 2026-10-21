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
	fleetcsv "github.com/ortus/ortus-crm/backend/internal/modules/fleet/csv"
	"github.com/ortus/ortus-crm/backend/internal/modules/modulesreg"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
)

// W2.08: the tag Data is served by the module data — the registry with the datasets of logistics («Автомобили»,
// «Поездки», «Расходы») over the tenant pools and the evaluator, the module states of the registry W1.08 and the
// clock of the application.
func TestNewData(t *testing.T) {
	t.Parallel()
	ev := authz.New(nil, nil, time.Now)
	at := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	states := moduleStates{S: &modulesreg.Service{}}
	store := storage.NewMem()
	srv := newData(noPools{}, ev, states, store, func() time.Time { return at })
	x, ok := srv.(fleetcsv.DataServer)
	if !ok || x.Export == nil {
		t.Fatalf("data server %#v, want the CSV export of W2.50 on top", srv)
	}
	s, ok := x.StrictServerInterface.(data.Server)
	if !ok || s.S == nil {
		t.Fatalf("under the export %#v, want the server of W2.08", x.StrictServerInterface)
	}

	// W4.50: the object storage of the export jobs (the link of a download, the deletion of a revoked file).
	if s.S.Pools != (noPools{}) || s.S.Authz != ev || s.S.Modules != states || s.S.Now == nil || !s.S.Now().Equal(at) || s.S.Files != store {
		t.Fatalf("service %+v", s.S)
	}
	if got := s.S.Registry.IDs(); !slices.Equal(got, []string{"fleet.vehicles", "fleet.trips", "fleet.expenses"}) {
		t.Fatalf("datasets %v", got)
	}
}

// W2.50: the export reads the catalog of the server and the rows through the same service whose evaluator narrows the
// scope of the dataset permission by data.export (data_export.go).
func TestNewDataExport(t *testing.T) {
	t.Parallel()
	ev := authz.New(nil, nil, time.Now)
	at := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	states := moduleStates{S: &modulesreg.Service{}}
	x, ok := newData(noPools{}, ev, states, nil, func() time.Time { return at }).(fleetcsv.DataServer)
	if !ok || x.Export == nil {
		t.Fatal("want the CSV export of W2.50 on top of the tag Data")
	}
	s, _ := x.StrictServerInterface.(data.Server)
	rows, ok := x.Export.Rows.(data.Server)
	if !ok || x.Export.Catalog != s || rows.S == nil || rows.S.Registry != s.S.Registry || rows.S.Pools != s.S.Pools ||
		rows.S.Modules != states || rows.S.Authz != (fleetcsv.ExportScope{Scoper: ev}) || x.Export.Pools == nil {
		t.Fatalf("export %+v", x.Export)
	}
	if x.Export.Now == nil || !x.Export.Now().Equal(at) {
		t.Fatalf("the clock of the export %+v", x.Export)
	}
}

// dataPendingOps are the operations of the tag Data the module does not serve yet: they answer 501 not_implemented.
// W2.50 serves exportDataset (the CSV export over queryDataset, fleet/csv), W4.50 the saved views (data/views.go) and
// the export jobs (data/jobs.go): none is pending.
var dataPendingOps = map[string]bool{}

// The operations of the tag Data reach the module through the router: without a tenant in the context the module
// answers 404; the operations of dataPendingOps answer 501 until their owners.
func TestDataRoutes(t *testing.T) {
	t.Parallel()
	h := newRouter(deps{servers: Servers{Data: newData(noPools{}, authz.New(nil, nil, time.Now), nil, nil, time.Now)}})
	n := 0
	for _, op := range catalog.Operations {
		if op.Tag != "Data" {
			continue
		}
		n++
		path := strings.NewReplacer("{tenantId}", "10000000-0000-4000-8000-000000000001", "{datasetId}", "fleet.trips",
			"{viewId}", "10000000-0000-4000-8000-000000000002", "{exportJobId}", "10000000-0000-4000-8000-000000000003").Replace(op.Path)
		req := httptest.NewRequestWithContext(t.Context(), op.Method, path,
			strings.NewReader(`{"select": ["trip"], "filters": [], "sort": [], "limit": 50}`))
		req.Header.Set("Content-Type", "application/json")
		// W4.06: the commands of the views and the export jobs carry Idempotency-Key and If-Match (the generated
		// wrapper answers 400 without a required header before the module).
		req.Header.Set("Idempotency-Key", "w406-data-routes")
		req.Header.Set("If-Match", `"1"`)
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
	if n != 12 {
		t.Errorf("operations of the tag Data: %d, want 12 (contract 0.7.0-stage4)", n)
	}
}
