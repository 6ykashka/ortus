package main

import (
	"testing"
	"time"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/expenses"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
)

// Operations of the tag Fleet of W2.41: the catalogue of expense categories of the tenant (fleet/expenses).
var fleetW241 = []string{"listExpenseCategories", "createExpenseCategory", "archiveExpenseCategory"}

// fleetExpenseCategories overlays the catalogue of W2.41 on the base of the tag: its operations reach the module,
// wired on the pools, the evaluator and the clock of the application; the others go down.
func TestFleetExpenseCategories(t *testing.T) {
	t.Parallel()
	ev := authz.New(nil, nil, time.Now)
	at := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	srv := fleetExpenseCategories(nil, noPools{}, ev, func() time.Time { return at })
	c, ok := srv.(expenses.CategoryServer)
	if !ok || c.S == nil || c.S.Authz != ev || c.S.Pools == nil || c.S.Now == nil || !c.S.Now().Equal(at) {
		t.Fatalf("fleet server %#v, want the catalogue of W2.41 on the evaluator and the clock of main", srv)
	}
	pending := fleetPendingOps(srv)
	for _, id := range fleetW241 {
		if pending[id] {
			t.Errorf("%s pending, want served by W2.41", id)
		}
	}
	if len(pending) != 48-len(fleetW241) {
		t.Errorf("%d pending, want %d", len(pending), 48-len(fleetW241))
	}
}

// underCategories requires the catalogue of W2.41 on top of srv, on the evaluator ev, and returns the server under it.
func underCategories(t *testing.T, srv fleetapi.StrictServerInterface, ev *authz.Evaluator) fleetapi.StrictServerInterface {
	t.Helper()
	c, ok := srv.(expenses.CategoryServer)
	if !ok || c.S == nil || c.S.Authz != ev {
		t.Fatalf("fleet server %#v, want the catalogue of W2.41 on top", srv)
	}
	return c.StrictServerInterface
}
