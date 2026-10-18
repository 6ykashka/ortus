package main

import (
	"testing"
	"time"

	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/review"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
)

// Operations of the tag Fleet of W2.06: the acceptance of a shift and the check of an expense (fleet/review).
var fleetW206 = []string{"reviewTrip", "reviewTripExpense"}

// fleetReview overlays the acceptance of W2.06 on the base of the tag: its operations reach the module, wired on the
// pools, the evaluator, the inbox port of W1.10 (the driver learns the decision) and the clock of the application;
// the others go down.
func TestFleetReview(t *testing.T) {
	t.Parallel()
	ev := authz.New(nil, nil, time.Now)
	at := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	srv := fleetReview(nil, noPools{}, ev, nil, func() time.Time { return at })
	r, ok := srv.(review.Server)
	if !ok || r.S == nil || r.S.Authz != ev || r.S.Now == nil || !r.S.Now().Equal(at) {
		t.Fatalf("fleet server %#v, want the review of W2.06 on the evaluator and the clock of main", srv)
	}
	if _, ok := r.S.Audience.(inbox.AuthzAudience); !ok || r.S.Recipients == nil {
		t.Fatalf("notifications of the review: %#v %#v", r.S.Recipients, r.S.Audience)
	}
	pending := fleetPendingOps(srv)
	for _, id := range fleetW206 {
		if pending[id] {
			t.Errorf("%s pending, want served by W2.06", id)
		}
	}
	if len(pending) != 48-len(fleetW206) {
		t.Errorf("%d pending, want %d", len(pending), 48-len(fleetW206))
	}
}
