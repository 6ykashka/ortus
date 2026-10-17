package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/inspections"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// Operations of the tag Fleet by owner that have a server in cmd/api.
var (
	fleetW202 = []string{"listVehicles", "createVehicle", "listReservations", "reserveVehicle", "getReservation", "releaseReservation"}
	fleetW204 = []string{
		"getInspectionChecklist", "listInspections", "submitInspection", "getInspection",
		"listInspectionDefects", "getInspectionDefect", "decideInspectionDefect",
	}
)

// The tag Fleet has several owners (W2.02 vehicles and reservations; W2.03…W2.07 the rest): the operations of W2.02
// reach their modules — without a tenant context they answer the 404 of the module, not 501.
func TestFleetServerRoutes(t *testing.T) {
	t.Parallel()
	var s fleetapi.StrictServerInterface = newFleetServer(nil, nil, time.Now)
	ctx := context.Background()
	ours := map[string]func() error{
		"ListVehicles":  func() error { _, err := s.ListVehicles(ctx, fleetapi.ListVehiclesRequestObject{}); return err },
		"CreateVehicle": func() error { _, err := s.CreateVehicle(ctx, fleetapi.CreateVehicleRequestObject{}); return err },
		"ListReservations": func() error {
			_, err := s.ListReservations(ctx, fleetapi.ListReservationsRequestObject{})
			return err
		},
		"ReserveVehicle": func() error {
			_, err := s.ReserveVehicle(ctx, fleetapi.ReserveVehicleRequestObject{})
			return err
		},
		"GetReservation": func() error {
			_, err := s.GetReservation(ctx, fleetapi.GetReservationRequestObject{})
			return err
		},
		"ReleaseReservation": func() error {
			_, err := s.ReleaseReservation(ctx, fleetapi.ReleaseReservationRequestObject{})
			return err
		},
	}
	for name, call := range ours {
		if err := call(); !problem.Is(err, problem.CodeNotFound) {
			t.Errorf("%s: %v, want not_found of its module", name, err)
		}
	}
	if len(ours) != len(fleetW202) {
		t.Errorf("W2.02 has %d operations, the test calls %d", len(fleetW202), len(ours))
	}
}

// main wires the tag as newFleet: the embedded modules (W2.02) under the inspections of W2.04, on the pools, the
// evaluator, the memberships of the control DB and the clock of the application.
func TestNewFleetComposesTheModules(t *testing.T) {
	t.Parallel()
	ev := authz.New(nil, nil, time.Now)
	srv := newFleet(nil, ev, nil, time.Now)
	s, ok := srv.(inspections.Server)
	if !ok || s.S == nil || s.S.Authz != ev {
		t.Fatalf("fleet server %#v, want the inspections of W2.04 on top", srv)
	}
	if base, ok := s.StrictServerInterface.(*fleetServer); !ok || base.Authz != ev || base.Evaluator != ev {
		t.Fatalf("base %#v, want fleetServer of W2.02", s.StrictServerInterface)
	}
}

// fleetPendingOps follows the composed server: the base alone serves W2.02, the composed one W2.02 and W2.04 too;
// the rest of the 35 operations of the tag (contract 0.5.0-stage2) are pending, and every name is an operation of the
// tag.
func TestFleetPendingOps(t *testing.T) {
	t.Parallel()
	tags := map[string]string{}
	all := 0
	for _, op := range catalog.Operations {
		tags[op.ID] = op.Tag
		if op.Tag == "Fleet" {
			all++
		}
	}
	if all != 35 {
		t.Errorf("operations of the tag Fleet: %d, want 35 (contract 0.5.0-stage2)", all)
	}
	for name, c := range map[string]struct {
		srv    fleetapi.StrictServerInterface
		served []string
	}{
		"база W2.02":   {newFleetServer(nil, nil, time.Now), fleetW202},
		"сборка main":  {newFleet(nil, authz.New(nil, nil, time.Now), nil, time.Now), slices.Concat(fleetW202, fleetW204)},
		"только W2.04": {fleetInspections(nil, noPools{}, authz.New(nil, nil, time.Now), nil, time.Now), fleetW204},
	} {
		pending := fleetPendingOps(c.srv)
		for id := range pending {
			if tags[id] != "Fleet" {
				t.Errorf("%s: pending %s has tag %q, want Fleet", name, id, tags[id])
			}
		}
		for _, id := range c.served {
			if pending[id] {
				t.Errorf("%s: %s pending, want served", name, id)
			}
		}
		if len(pending) != all-len(c.served) {
			t.Errorf("%s: %d pending, want %d", name, len(pending), all-len(c.served))
		}
	}
}

var fleetPathParam = regexp.MustCompile(`\{[^}]+\}`)

// fleetRoutes sends every operation of the tag through the router over srv and requires the operations of served to
// reach the strict server (it binds the parameters: a command without its Idempotency-Key is 400) and the others to
// answer 501 before their parameters are bound (mountFleetPending), as when the whole tag had no server, so the
// pending isolation rows of their owners keep seeing 501.
func fleetRoutes(t *testing.T, srv fleetapi.StrictServerInterface, served []string) {
	t.Helper()
	h := newRouter(deps{servers: Servers{Fleet: srv}})
	for _, op := range catalog.Operations {
		if op.Tag != "Fleet" {
			continue
		}
		path := fleetPathParam.ReplaceAllStringFunc(op.Path, func(string) string { return uuid.NewString() })
		req := httptest.NewRequestWithContext(t.Context(), op.Method, path, strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		ours := slices.Contains(served, op.ID)
		switch {
		case ours && rec.Code == http.StatusNotImplemented:
			t.Errorf("%s %s (%s): 501, want its module", op.Method, op.Path, op.ID)
		case !ours && rec.Code != http.StatusNotImplemented:
			t.Errorf("%s %s (%s): %d %s, want 501 until its owner", op.Method, op.Path, op.ID, rec.Code, rec.Body)
		}
	}
}

func TestFleetPendingBeforeBinding(t *testing.T) {
	t.Parallel()
	fleetRoutes(t, newFleetServer(nil, nil, time.Now), fleetW202)
}

// The tag Fleet as main wires it (W2.02 under the inspections of W2.04): the inspections reach their module through
// the router too (review of W2.02, round 2: mountFleetPending hid the routes of W2.04 behind 501).
func TestFleetComposedServesEveryModule(t *testing.T) {
	t.Parallel()
	fleetRoutes(t, newFleet(nil, authz.New(nil, nil, time.Now), nil, time.Now), slices.Concat(fleetW202, fleetW204))
}
