package main

import (
	"context"
	"time"

	"github.com/google/uuid"

	homeapi "github.com/ortus/ortus-crm/backend/internal/api/home"
	"github.com/ortus/ortus-crm/backend/internal/control/subscriptions"
	"github.com/ortus/ortus-crm/backend/internal/modules/home"
	homefleet "github.com/ortus/ortus-crm/backend/internal/modules/home/fleet"
	homeorg "github.com/ortus/ortus-crm/backend/internal/modules/home/org"
	hometasks "github.com/ortus/ortus-crm/backend/internal/modules/home/tasks"
	"github.com/ortus/ortus-crm/backend/internal/modules/modulesreg"
	"github.com/ortus/ortus-crm/backend/internal/modules/tasks"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/scopeddb"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// homeServer is the server of the tag Home (W2.09, S2-18 «Требует решения»): the registry of sources in the order
// of the queue (logistics, the organization of W2.54, the tasks of W4.81; the modules of later stages register theirs
// here), the memberships of the control DB for the tenant of the query, the module states of the registry W1.08 and the
// clock of the application (APP_FIXED_NOW outside prod). The source of tasks also gives the counters of
// getMyTaskSummary; it reads through the port of the module «Задачи» on the same pools, evaluator and control DB.
func homeServer(dir tenantctx.Directory, pools scopeddb.Pools, ev *authz.Evaluator, states home.Modules, org orgFacts, now func() time.Time, extra ...home.Source) homeapi.StrictServerInterface {
	tk := hometasks.Source{Tasks: taskPort{S: &tasks.Service{Pools: pools, Authz: ev, Directory: tasks.ControlDirectory{DB: org.control}, Now: now}}}
	reg, err := home.NewRegistry(append([]home.Source{homefleet.Source{Pools: pools, Authz: ev},
		homeorg.Source{Pools: pools, Authz: ev, Control: org.control, Subscriptions: orgSubscriptions{current: org.subs.Current}}, tk}, extra...)...)
	if err != nil { // the sources above are never nil: a programming error
		panic(err)
	}
	return home.Server{S: &home.Service{Dir: dir, Registry: reg, Modules: states, Now: now, Tasks: tk}}
}

// taskPort adapts the port of «Главная» of the module «Задачи» (tasks.Service.Home) to the source of tasks (W4.81).
type taskPort struct{ S *tasks.Service }

var _ hometasks.Reader = taskPort{}

// Home implements hometasks.Reader.
func (p taskPort) Home(ctx context.Context, tc tenantctx.TenantContext, limit int) (hometasks.View, error) {
	v, err := p.S.Home(ctx, tc, limit)
	if err != nil {
		return hometasks.View{}, err
	}
	return viewOf(v), nil
}

// viewOf is the view of the port in the types of the source.
func viewOf(v tasks.HomeView) hometasks.View {
	out := hometasks.View{
		Summary: home.TaskCounts{New: v.Summary.New, InProgress: v.Summary.InProgress, Review: v.Summary.Review, MyNew: v.Summary.MyNew},
		Mine:    make([]hometasks.Task, 0, len(v.Mine)),
	}
	for _, t := range v.Mine {
		out.Mine = append(out.Mine, hometasks.Task{ID: t.ID, Project: t.Project, Key: t.Key, Title: t.Title, Place: t.Place,
			Urgent: t.Urgent, DueAt: t.DueAt, FromForm: t.FromForm, Funnel: t.Funnel})
	}
	return out
}

// moduleStates are the states of the installable modules of the registry W1.08 by contract key (home.Modules): a
// draining module without started work is settled first, as for the module gate.
type moduleStates struct{ S *modulesreg.Service }

var _ home.Modules = moduleStates{}

// States implements home.Modules.
func (m moduleStates) States(ctx context.Context, tenantID uuid.UUID) (map[string]string, error) {
	inst, err := m.S.Installations(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(inst))
	for key, in := range inst {
		out[key] = in.State
	}
	return out, nil
}

// orgFacts is what the source of the organization reads beyond the tenant DB: the memberships of the control DB and
// the subscriptions of W1.08.
type orgFacts struct {
	control homeorg.Control
	subs    subscriptions.Store
}

// orgSubscriptions adapts the subscription of W1.08 to the source of the organization.
type orgSubscriptions struct {
	current func(ctx context.Context, tenantID uuid.UUID) (subscriptions.Subscription, error)
}

// Subscription implements homeorg.Subscriptions: the status of the contract and the end of the trial.
func (o orgSubscriptions) Subscription(ctx context.Context, tenantID uuid.UUID) (homeorg.Subscription, error) {
	s, err := o.current(ctx, tenantID)
	if err != nil {
		return homeorg.Subscription{}, err
	}
	return homeorg.Subscription{Status: s.Status, TrialEndsAt: s.TrialEndsAt}, nil
}
