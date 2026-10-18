package main

import (
	"testing"
	"time"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/pool"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
)

// Operations of the tag Fleet of W2.07: the publications, the catalog and the transfers of the driver pool
// (fleet/pool). The overlay also passes reserveVehicle, releaseReservation, startTrip and reviewTrip down to their
// owners and settles the pool after them — those stay with W2.02, W2.05 and W2.06.
var fleetW207 = []string{
	"listDriverPoolPublications", "publishDriverToPool", "getDriverPoolPublication", "withdrawDriverPoolPublication",
	"listAvailableDrivers", "listDriverTransfers", "getDriverTransfer", "requestDriverTransfer", "decideDriverTransfer",
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
	if len(pending) != 39-len(fleetW207) {
		t.Errorf("%d pending, want %d", len(pending), 39-len(fleetW207))
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
