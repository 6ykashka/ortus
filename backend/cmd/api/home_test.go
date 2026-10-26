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
	hometasks "github.com/ortus/ortus-crm/backend/internal/modules/home/tasks"
	"github.com/ortus/ortus-crm/backend/internal/modules/modulesreg"
	"github.com/ortus/ortus-crm/backend/internal/modules/tasks"
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
	// W4.81: the counters of getMyTaskSummary come from the source of tasks of the registry.
	if src := s.S.Registry.Sources(); len(src) < 3 || s.S.Tasks == nil || any(s.S.Tasks) != any(src[2]) {
		t.Fatalf("task counter %#v, want the source of tasks", s.S.Tasks)
	}
}

// W4.81: the port of «Главная» of the module «Задачи» is adapted to the source of tasks field by field.
func TestTaskPortView(t *testing.T) {
	t.Parallel()
	id, project := uuid.New(), uuid.New()
	due := time.Date(2026, 10, 1, 21, 0, 0, 0, time.UTC)
	got := viewOf(tasks.HomeView{
		Summary: tasks.HomeSummary{New: 2, InProgress: 3, Review: 4, MyNew: 1},
		Mine: []tasks.HomeTask{{ID: id, Project: project, Key: "T-64", Title: "Найти водителя", Place: tasks.PlaceNew, Urgent: true,
			DueAt: &due, FromForm: true, Funnel: true}},
	})
	if got.Summary != (home.TaskCounts{New: 2, InProgress: 3, Review: 4, MyNew: 1}) || len(got.Mine) != 1 {
		t.Fatalf("view %+v", got)
	}
	want := hometasks.Task{ID: id, Project: project, Key: "T-64", Title: "Найти водителя", Place: hometasks.PlaceNew, Urgent: true,
		DueAt: &due, FromForm: true, Funnel: true}
	if got.Mine[0] != want {
		t.Fatalf("task %+v, want %+v", got.Mine[0], want)
	}
}

// checkSources checks the registry of homeServer: logistics, then the organization, over the pools and ev, then (W4.81)
// the tasks over the port of the module «Задачи» on the same pools, evaluator and control DB.
func checkSources(t *testing.T, src []home.Source, ev *authz.Evaluator, control *pgxpool.Pool) {
	t.Helper()
	if len(src) != 3 {
		t.Fatalf("sources %#v, want logistics, the organization and the tasks", src)
	}
	checkTaskSource(t, src[2], ev, control)
	f, ok := src[0].(homefleet.Source)
	if !ok || f.Authz != ev || f.Pools != (noPools{}) || f.Module() != modulesreg.KeyFleet {
		t.Fatalf("logistics source %#v", src[0])
	}
	o, ok := src[1].(homeorg.Source)
	if !ok || o.Authz != ev || o.Pools != (noPools{}) || o.Control != control || o.Subscriptions == nil || o.Module() != "" {
		t.Fatalf("organization source %#v", src[1])
	}
}

// checkTaskSource checks the source of tasks (W4.81): a core source over the port of «Задачи» on the pools, ev and the
// control DB.
func checkTaskSource(t *testing.T, src home.Source, ev *authz.Evaluator, control *pgxpool.Pool) {
	t.Helper()
	tk, ok := src.(hometasks.Source)
	port, isPort := tk.Tasks.(taskPort)
	if !ok || !isPort || port.S == nil || tk.Module() != "" {
		t.Fatalf("tasks source %#v", src)
	}
	if port.S.Authz != ev || port.S.Pools != (noPools{}) || port.S.Directory != (tasks.ControlDirectory{DB: control}) {
		t.Fatalf("tasks service %#v", port.S)
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
