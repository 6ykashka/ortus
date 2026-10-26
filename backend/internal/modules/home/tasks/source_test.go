package tasks

import (
	"context"
	"errors"
	"maps"
	"testing"
	"time"

	"github.com/google/uuid"

	homeapi "github.com/ortus/ortus-crm/backend/internal/api/home"
	"github.com/ortus/ortus-crm/backend/internal/modules/home" //nolint:depguard // the registry this source plugs into
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

var (
	tenant  = uuid.MustParse("10000000-0000-4000-8000-0000000000f1")
	project = uuid.MustParse("10000000-0000-4000-8000-0000000000e1")
	leads   = uuid.MustParse("10000000-0000-4000-8000-0000000000e2")
	t64     = uuid.MustParse("10000000-0000-4000-8000-000000000064")
	t63     = uuid.MustParse("10000000-0000-4000-8000-000000000063")
	l31     = uuid.MustParse("10000000-0000-4000-8000-000000000031")
	due     = time.Date(2026, 10, 1, 21, 0, 0, 0, time.UTC)
)

// reader is a fake port of «Задачи»: its view or its error, and the requests it got.
type reader struct {
	view  View
	err   error
	got   []tenantctx.TenantContext
	limit []int
}

func (r *reader) Home(_ context.Context, tc tenantctx.TenantContext, limit int) (View, error) {
	r.got, r.limit = append(r.got, tc), append(r.limit, limit)
	return r.view, r.err
}

func query() home.Query {
	return home.Query{Tenant: tenantctx.TenantContext{TenantID: tenant, PersonID: uuid.New()}, Now: due}
}

// W4.81 · The source of tasks is a core source (the module «Задачи» is always installed): the first three tasks of the
// member «Новая» (tasks.task_new) and «На проверке» (tasks.task_review) in the order of the port; urgent — danger,
// otherwise neutral; the object is the task; params taskKey, title, projectId, dueAt, fromForm, funnel (the contract
// 0.11.1-stage4, homeVM :4081–4084).
func TestCards(t *testing.T) {
	t.Parallel()
	r := &reader{view: View{Mine: []Task{
		{ID: t64, Project: project, Key: "T-64", Title: "Найти водителя на рейс Р-211", Place: PlaceNew, Urgent: true, DueAt: &due},
		{ID: t63, Project: project, Key: "T-63", Title: "Обновить регламент приёмки смены", Place: PlaceReview, FromForm: true},
		{ID: l31, Project: leads, Key: "L-31", Title: "Квартира 64 м², Химки", Place: PlaceNew, Funnel: true},
	}}}
	src := Source{Tasks: r}
	if src.Module() != "" {
		t.Fatalf("module %q, want a core source", src.Module())
	}
	q := query()
	got, err := src.Cards(t.Context(), q)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.got) != 1 || r.got[0] != q.Tenant || r.limit[0] != Limit {
		t.Fatalf("port asked %+v limit %v, want the member of the query and %d", r.got, r.limit, Limit)
	}
	ref := func(id uuid.UUID) *homeapi.ObjectRef {
		return &homeapi.ObjectRef{ModuleKey: "tasks", EntityType: "task", EntityId: id}
	}
	want := []homeapi.DecisionItem{
		{Key: "tasks.task_new:" + t64.String(), Kind: KindNew, ModuleKey: "tasks", Tone: homeapi.Danger, Object: ref(t64),
			Params: map[string]string{"taskKey": "T-64", "title": "Найти водителя на рейс Р-211", "projectId": project.String(),
				"dueAt": "2026-10-01T21:00:00Z"}},
		{Key: "tasks.task_review:" + t63.String(), Kind: KindReview, ModuleKey: "tasks", Tone: homeapi.Neutral, Object: ref(t63),
			Params: map[string]string{"taskKey": "T-63", "title": "Обновить регламент приёмки смены", "projectId": project.String(),
				"fromForm": "true"}},
		{Key: "tasks.task_new:" + l31.String(), Kind: KindNew, ModuleKey: "tasks", Tone: homeapi.Neutral, Object: ref(l31),
			Params: map[string]string{"taskKey": "L-31", "title": "Квартира 64 м², Химки", "projectId": leads.String(), "funnel": "true"}},
	}
	if len(got) != len(want) {
		t.Fatalf("cards %+v, want %d", got, len(want))
	}
	for i := range want {
		sameCard(t, i, got[i], want[i])
	}

	empty, err := Source{Tasks: &reader{}}.Cards(t.Context(), q)
	if err != nil || empty == nil || len(empty) != 0 {
		t.Fatalf("no tasks: %v %v, want an empty list", empty, err)
	}
}

// sameCard requires card i to be w (the object and the params by value).
func sameCard(t *testing.T, i int, g, w homeapi.DecisionItem) {
	t.Helper()
	same := g.Key == w.Key && g.Kind == w.Kind && g.ModuleKey == w.ModuleKey && g.Tone == w.Tone
	if !same || g.Object == nil || *g.Object != *w.Object || !maps.Equal(g.Params, w.Params) {
		t.Fatalf("card %d %+v, want %+v", i, g, w)
	}
}

// The counters of getMyTaskSummary are those of the port; a failure of the port is the failure of the source.
func TestTaskCounts(t *testing.T) {
	t.Parallel()
	r := &reader{view: View{Summary: home.TaskCounts{New: 2, InProgress: 2, Review: 2, MyNew: 1}}}
	got, err := Source{Tasks: r}.TaskCounts(t.Context(), query())
	if err != nil || got != (home.TaskCounts{New: 2, InProgress: 2, Review: 2, MyNew: 1}) {
		t.Fatalf("counts %+v %v", got, err)
	}
	down := errors.New("tenant DB down")
	if _, err := (Source{Tasks: &reader{err: down}}).TaskCounts(t.Context(), query()); !errors.Is(err, down) {
		t.Fatalf("error %v, want %v", err, down)
	}
	if _, err := (Source{Tasks: &reader{err: down}}).Cards(t.Context(), query()); !errors.Is(err, down) {
		t.Fatalf("error %v, want %v", err, down)
	}
}
