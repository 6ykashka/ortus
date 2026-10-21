package main

import (
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
	"go.yaml.in/yaml/v3"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/data"
	"github.com/ortus/ortus-crm/backend/internal/modules/files"
	fleetcsv "github.com/ortus/ortus-crm/backend/internal/modules/fleet/csv"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/pool"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Operations of the tag Fleet of W2.07: the publications, the catalog and the transfers of the driver pool
// (fleet/pool). The overlay also passes reserveVehicle, releaseReservation, startTrip and reviewTrip down to their
// owners and settles the pool after them — those stay with W2.02, W2.05 and W2.06.
var fleetW207 = []string{
	"listDriverPoolPublications", "publishDriverToPool", "getDriverPoolPublication", "withdrawDriverPoolPublication",
	"listAvailableDrivers", "listDriverTransfers", "getDriverTransfer", "requestDriverTransfer", "decideDriverTransfer",
	"chooseReservation", // W2.72 (S2-20): the choice among the vehicles offered for the trip of a temporary driver
}

// fleetPool overlays the pool of W2.07 on the base of the tag: its operations reach the module, wired on the pools,
// the evaluator, the inbox port of W1.10 (the requesting logists learn the decision) and the clock of the
// application; the others go down.
func TestFleetPool(t *testing.T) {
	t.Parallel()
	ev := authz.New(nil, nil, time.Now)
	at := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	srv := fleetPool(nil, noPools{}, ev, nil, func() time.Time { return at })
	p, ok := srv.(pool.Server)
	if !ok || p.S == nil || p.S.Authz != ev || p.S.Now == nil || !p.S.Now().Equal(at) || p.S.Pools == nil {
		t.Fatalf("fleet server %#v, want the pool of W2.07 on the evaluator and the clock of main", srv)
	}
	if _, ok := p.S.Audience.(inbox.AuthzAudience); !ok || p.S.Recipients == nil {
		t.Fatalf("notifications of the pool: %#v %#v", p.S.Recipients, p.S.Audience)
	}
	pending := fleetPendingOps(srv)
	for _, id := range fleetW207 {
		if pending[id] {
			t.Errorf("%s pending, want served by W2.07", id)
		}
	}
	// 48 operations of the tag Fleet (contract 0.6.1-stage2, W2.52).
	if len(pending) != 49-len(fleetW207) {
		t.Errorf("%d pending, want %d", len(pending), 49-len(fleetW207))
	}
}

// W2.57 (AC-06, Q-W2.07-1 «только рейс»): the files and «Данные» ask the pool which trips it closes to the subject
// (files.Hider, data.Hider; the files also which trips it leaves to their continuation, return 2) — the pool on the
// tenant pools and the clock of the application, like the overlay of the tag Fleet. An owner and a context without a person are never temporary drivers: nothing is hidden, no DB is read.
func TestPoolClosesTripsInFilesAndData(t *testing.T) {
	t.Parallel()
	ev := authz.New(nil, nil, time.Now)
	at := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	clock := func() time.Time { return at }
	fs, _, err := filesServers(noPools{}, ev, envOf(nil), slog.New(slog.DiscardHandler), clock)
	if err != nil {
		t.Fatal(err)
	}
	f, ok := fs.(files.Server)
	if !ok || f.S == nil {
		t.Fatalf("files server %#v", fs)
	}
	// W2.50: the CSV export on top of the tag Data reads its rows through the same service (Service.run), so the pool
	// hides the closed trips in the file too (Q-W2.57-14).
	x, ok := newData(noPools{}, ev, nil, nil, clock).(fleetcsv.DataServer)
	if !ok || x.Export == nil {
		t.Fatalf("data server %#v, want the CSV export of W2.50 on top", x)
	}
	ds, ok := x.StrictServerInterface.(data.Server)
	if !ok || ds.S == nil {
		t.Fatalf("under the export %#v", x.StrictServerInterface)
	}
	rows, ok := x.Export.Rows.(data.Server)
	if !ok || rows.S == nil {
		t.Fatalf("rows of the export %#v", x.Export.Rows)
	}
	// W4.11: the files join the pool with the tasks the subject does not read (closedParents, tasks.go); the pool first.
	hiders, ok := f.S.Hidden.(closedParents)
	if !ok || len(hiders) != 2 {
		t.Fatalf("files hider %#v, want the pool and the hidden tasks", f.S.Hidden)
	}
	for name, h := range map[string]any{"files": hiders[0], "data": ds.S.Hidden, "export": rows.S.Hidden} {
		wantPoolTrips(t, name, h, at)
	}
}

// wantPoolTrips requires h to be the pool on the pools and the clock at of main that hides nothing from an owner and
// a context without a person (no DB read: noPools fails every read).
func wantPoolTrips(t *testing.T, name string, h any, at time.Time) {
	t.Helper()
	p, ok := h.(poolTrips)
	if !ok || p.S == nil || p.S.Pools == nil || p.S.Now == nil || !p.S.Now().Equal(at) {
		t.Fatalf("%s: hider %#v, want the pool on the pools and the clock of main", name, h)
	}
	for _, tc := range []tenantctx.TenantContext{
		{TenantID: uuid.New(), PersonID: uuid.New(), Owner: true}, {TenantID: uuid.New()},
	} {
		if ids, err := p.Hidden(t.Context(), tc); err != nil || len(ids) != 0 {
			t.Errorf("%s %+v: %v %v, want nothing hidden", name, tc, ids, err)
		}
		if c, err := p.Closed(t.Context(), tc); err != nil || len(c.Hidden) != 0 || len(c.Continued) != 0 {
			t.Errorf("%s %+v: %+v %v, want nothing closed", name, tc, c, err)
		}
	}
}

// underPool requires the pool of W2.07 on top of srv, on the evaluator ev, and returns the server under it.
func underPool(t *testing.T, srv fleetapi.StrictServerInterface, ev *authz.Evaluator) fleetapi.StrictServerInterface {
	t.Helper()
	p, ok := srv.(pool.Server)
	if !ok || p.S == nil || p.S.Authz != ev {
		t.Fatalf("fleet server %#v, want the pool of W2.07 on top", srv)
	}
	return p.StrictServerInterface
}

// TestTemporaryDriverTemplate (W2.57, Q-W2.07-1): the system role «Временный водитель» the approval creates in a tenant
// carries the actions of role_templates.temporary_driver of api/permissions.yaml (internal/modules may not read YAML —
// depguard): the steward changes the template — the test turns red and pool.TemporaryDriverActions follows it.
func TestTemporaryDriverTemplate(t *testing.T) {
	t.Parallel()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "api", "permissions.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		RoleTemplates map[string]struct {
			Kind            string   `yaml:"kind"`
			DefaultScope    string   `yaml:"default_scope"`
			WorkFunction    string   `yaml:"work_function"`
			Actions         []string `yaml:"actions"`
			ResourceActions []string `yaml:"resource_actions"`
		} `yaml:"role_templates"`
	}
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	tpl, ok := doc.RoleTemplates["temporary_driver"]
	if !ok {
		t.Fatal("api/permissions.yaml: no role_templates.temporary_driver")
	}
	got, want := slices.Sorted(slices.Values(pool.TemporaryDriverActions)), slices.Sorted(slices.Values(tpl.Actions))
	if !slices.Equal(got, want) || !slices.Equal(pool.TemporaryDriverResourceActions, tpl.ResourceActions) {
		t.Errorf("pool: %v + resource %v, permissions.yaml: %v + resource %v", got, pool.TemporaryDriverResourceActions,
			want, tpl.ResourceActions)
	}
	if tpl.Kind != "system" || tpl.DefaultScope != "self" || tpl.WorkFunction != "driver" {
		t.Errorf("template %+v, want a system role in scope self with the function driver", tpl)
	}
}
