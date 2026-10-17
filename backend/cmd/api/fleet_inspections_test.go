package main

import (
	"testing"
	"time"

	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/inspections"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
)

// W2.04: the inspection operations of the tag Fleet are served by the module fleet/inspections over the tenant
// pools, the evaluator, the memberships of the control DB and the audience of the inbox (W1.10), on the clock of the
// application; the other operations of the tag stay with the base (501 until W2.02 and the others overlay theirs).
func TestFleetInspections(t *testing.T) {
	t.Parallel()
	ev := authz.New(nil, nil, time.Now)
	at := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	srv := fleetInspections(nil, noPools{}, ev, nil, func() time.Time { return at })
	s, ok := srv.(inspections.Server)
	if !ok || s.S == nil || s.StrictServerInterface == nil {
		t.Fatalf("fleet server %#v", srv)
	}
	if s.S.Authz != ev || s.S.Pools == nil || s.S.Now == nil || !s.S.Now().Equal(at) {
		t.Fatalf("service %+v", s.S)
	}
	if _, ok := s.S.Recipients.(inbox.PGRecipients); !ok {
		t.Errorf("recipients %#v", s.S.Recipients)
	}
	if a, ok := s.S.Audience.(inbox.AuthzAudience); !ok || a.E != ev {
		t.Errorf("audience %#v", s.S.Audience)
	}
}
