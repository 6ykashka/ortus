package main

import (
	"context"
	"errors"
	"maps"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/control/subscriptions"
	"github.com/ortus/ortus-crm/backend/internal/modules/home"
	homefleet "github.com/ortus/ortus-crm/backend/internal/modules/home/fleet"
	homeorg "github.com/ortus/ortus-crm/backend/internal/modules/home/org"
	"github.com/ortus/ortus-crm/backend/internal/modules/modulesreg"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// W2.09: the tag Home is served by the module home — the registry of sources with the source of logistics over the
// tenant pools and the evaluator, then (W2.54) the source of the organization over the same pools, the control DB and
// the subscriptions of W1.08; the memberships of the control DB, the module states of the registry W1.08 and the clock
// of the application.
func TestHome(t *testing.T) {
	t.Parallel()
	ev := authz.New(nil, nil, time.Now)
	at := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	dir := tenantctx.NewPGDirectory(nil)
	states := moduleStates{S: &modulesreg.Service{}}
	control := &pgxpool.Pool{}
	srv := homeServer(dir, noPools{}, ev, states, orgFacts{control: control}, func() time.Time { return at })
	s, ok := srv.(home.Server)
	if !ok || s.S == nil {
		t.Fatalf("home server %#v", srv)
	}
	if s.S.Dir != dir || s.S.Modules != states || s.S.Now == nil || !s.S.Now().Equal(at) {
		t.Fatalf("service %+v", s.S)
	}
	checkSources(t, s.S.Registry.Sources(), ev, control)
}

// checkSources checks the registry of homeServer: logistics, then the organization, over the pools and ev.
func checkSources(t *testing.T, src []home.Source, ev *authz.Evaluator, control *pgxpool.Pool) {
	t.Helper()
	if len(src) != 2 {
		t.Fatalf("sources %#v, want logistics and the organization", src)
	}
	f, ok := src[0].(homefleet.Source)
	if !ok || f.Authz != ev || f.Pools != (noPools{}) || f.Module() != modulesreg.KeyFleet {
		t.Fatalf("logistics source %#v", src[0])
	}
	o, ok := src[1].(homeorg.Source)
	if !ok || o.Authz != ev || o.Pools != (noPools{}) || o.Control != control || o.Subscriptions == nil || o.Module() != "" {
		t.Fatalf("organization source %#v", src[1])
	}
}

// The source of the organization reads the subscription of W1.08 (status of the contract, end of the trial); a
// failure of the store is its failure.
func TestOrgSubscriptions(t *testing.T) {
	t.Parallel()
	end := time.Date(2026, 10, 13, 21, 0, 0, 0, time.UTC)
	got, err := orgSubscriptions{current: func(context.Context, uuid.UUID) (subscriptions.Subscription, error) {
		return subscriptions.Subscription{Status: subscriptions.StatusTrialing, TrialEndsAt: &end}, nil
	}}.Subscription(t.Context(), uuid.New())
	if err != nil || got.Status != "trialing" || got.TrialEndsAt == nil || !got.TrialEndsAt.Equal(end) {
		t.Fatalf("subscription %+v %v", got, err)
	}
	down := errors.New("control DB down")
	if _, err := (orgSubscriptions{current: func(context.Context, uuid.UUID) (subscriptions.Subscription, error) {
		return subscriptions.Subscription{}, down
	}}).Subscription(t.Context(), uuid.New()); !errors.Is(err, down) {
		t.Fatalf("error %v, want %v", err, down)
	}
}

// installations is a module store with fixed installations (or an error); a draining module is not here, so the
// registry never settles anything (Apply, Querier are not called).
type installations struct {
	modulesreg.Store
	rows map[string]modulesreg.Installation
	err  error
}

func (s installations) Installations(context.Context, uuid.UUID) (map[string]modulesreg.Installation, error) {
	return s.rows, s.err
}

// The module states of home are the states of the registry W1.08 by contract key (a synonym of an old row is
// already the contract key there).
func TestModuleStates(t *testing.T) {
	t.Parallel()
	store := installations{rows: map[string]modulesreg.Installation{
		"fleet": {Key: "fleet", StoredKey: "logistics", State: modulesreg.StateActive},
		"spa":   {Key: "spa", StoredKey: "spa", State: modulesreg.StateDisabled},
	}}
	got, err := moduleStates{S: &modulesreg.Service{Store: store}}.States(t.Context(), uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	if want := map[string]string{"fleet": "active", "spa": "disabled"}; !maps.Equal(got, want) {
		t.Fatalf("states %v, want %v", got, want)
	}
	if _, err := (moduleStates{S: &modulesreg.Service{Store: installations{err: errors.New("down")}}}).States(t.Context(), uuid.New()); err == nil {
		t.Fatal("a failing registry gives states")
	}
}
