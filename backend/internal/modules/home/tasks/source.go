// Package tasks is the source of the module «Задачи» for «Главная» (W4.81, contract 0.11.1-stage4; homeVM :4081–4084,
// :4113): the tasks of the member «Новая» and «На проверке» for «Требует решения» (tasks.task_new, tasks.task_review)
// and the counters of the card «Задачи» and of the badge of the menu (getMyTaskSummary). The tasks come from the port
// of the module (tasks.Service.Home adapted in cmd/api); the client builds the texts.
package tasks

import (
	"context"
	"time"

	"github.com/google/uuid"

	homeapi "github.com/ortus/ortus-crm/backend/internal/api/home"
	"github.com/ortus/ortus-crm/backend/internal/modules/home" //nolint:depguard // the registry this source plugs into
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Kinds of the cards (api/openapi/components/home/schemas.yaml DecisionItem.kind) and the places of the port.
const (
	KindNew     = "tasks.task_new"
	KindReview  = "tasks.task_review"
	PlaceNew    = "new"
	PlaceReview = "review"
)

// Limit is the number of tasks of the member in «Требует решения» (homeVM :4083: mine.slice(0, 3)).
const Limit = 3

// Task is a task of the member for «Требует решения».
type Task struct {
	ID, Project uuid.UUID
	Key, Title  string
	Place       string
	Urgent      bool
	DueAt       *time.Time
	FromForm    bool
	Funnel      bool
}

// View is what the port gives: the counters and the first tasks of the member.
type View struct {
	Summary home.TaskCounts
	Mine    []Task
}

// Reader is the port of the module «Задачи».
type Reader interface {
	Home(ctx context.Context, tc tenantctx.TenantContext, limit int) (View, error)
}

// Source is the source of tasks.
type Source struct {
	Tasks Reader
}

var (
	_ home.Source      = Source{}
	_ home.TaskCounter = Source{}
)

// moduleTasks is the module key of the cards and of their object.
const moduleTasks = "tasks"

// Module implements home.Source: a core source — «Задачи» is a core module, always installed (CoreKeys of W1.08).
func (Source) Module() string { return "" }

// Cards implements home.Source: the first Limit tasks of the member «Новая» and «На проверке» in the order of the port;
// urgent — danger, otherwise neutral.
func (s Source) Cards(ctx context.Context, q home.Query) ([]homeapi.DecisionItem, error) {
	v, err := s.Tasks.Home(ctx, q.Tenant, Limit)
	if err != nil {
		return nil, err
	}
	out := make([]homeapi.DecisionItem, 0, len(v.Mine))
	for _, t := range v.Mine {
		out = append(out, card(t))
	}
	return out, nil
}

// TaskCounts implements home.TaskCounter: the counters of the port.
func (s Source) TaskCounts(ctx context.Context, q home.Query) (home.TaskCounts, error) {
	v, err := s.Tasks.Home(ctx, q.Tenant, Limit)
	if err != nil {
		return home.TaskCounts{}, err
	}
	return v.Summary, nil
}

// card is the card of a task (params of the contract: taskKey, title, projectId, dueAt, fromForm, funnel).
func card(t Task) homeapi.DecisionItem {
	kind := KindNew
	if t.Place == PlaceReview {
		kind = KindReview
	}
	tone := homeapi.Neutral
	if t.Urgent {
		tone = homeapi.Danger
	}
	params := map[string]string{"taskKey": t.Key, "title": t.Title, "projectId": t.Project.String()}
	if t.DueAt != nil {
		params["dueAt"] = t.DueAt.UTC().Format(time.RFC3339)
	}
	if t.FromForm {
		params["fromForm"] = "true"
	}
	if t.Funnel {
		params["funnel"] = "true"
	}
	return homeapi.DecisionItem{
		Key: kind + ":" + t.ID.String(), Kind: kind, ModuleKey: moduleTasks, Tone: tone, Params: params,
		Object: &homeapi.ObjectRef{ModuleKey: moduleTasks, EntityType: "task", EntityId: t.ID},
	}
}
