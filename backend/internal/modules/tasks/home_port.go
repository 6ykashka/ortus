package tasks

import (
	"context"
	"slices"
	"time"

	"github.com/google/uuid"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// The port of «Главная» (W4.81, contract 0.11.1-stage4): the source of tasks of the module home asks the tasks the
// member sees for the queue «Требует решения» (tasks.task_new, tasks.task_review) and the counters of the card «Задачи»
// and of the badge of the menu (getMyTaskSummary); cmd/api adapts it to home/tasks.

// Places of a status on «Главная» (tasks.md Р-27).
const (
	PlaceNone     = ""
	PlaceNew      = "new"      // «Новые»: a status of the category «К выполнению»
	PlaceProgress = "progress" // «В работе»: a status of the category «В работе» of a workflow that is not one of review
	PlaceReview   = "review"   // «На проверке»: a status of review of a workflow
)

// HomeTask is a task of the member for «Требует решения».
type HomeTask struct {
	ID, Project uuid.UUID
	Key, Title  string
	Place       string // PlaceNew | PlaceReview
	Urgent      bool
	DueAt       *time.Time
	FromForm    bool // made by a rule of a form (tasks.tasks.source forms/response)
	Funnel      bool // a request of a funnel (its board «Заявки»)
}

// HomeSummary counts the tasks the member sees (getMyTaskSummary): «Новые», «В работе», «На проверке» and the badge.
type HomeSummary struct {
	New, InProgress, Review, MyNew int
}

// HomeView is what «Главная» shows of the tasks of a member.
type HomeView struct {
	Summary HomeSummary
	Mine    []HomeTask // «Новая» and «На проверке» of the member, newest first
}

// Home reads the tasks tc sees as listTasks shows them (the scope predicate of tasks.read: the projects by their level
// of access and the own tasks elsewhere — scope self): the counters and the first limit tasks of the member «Новая»
// and «На проверке», newest first.
func (s *Service) Home(ctx context.Context, tc tenantctx.TenantContext, limit int) (HomeView, error) {
	out := HomeView{Mine: []HomeTask{}}
	err := s.run(ctx, tc, false, func(r *request) error {
		ts, err := r.scopedTasks(ctx, TaskQuery{})
		if err != nil {
			return err
		}
		for _, t := range ts {
			p, err := r.project(ctx, t.Project)
			if err != nil {
				return err
			}
			if p == nil {
				continue
			}
			place, first, err := r.place(ctx, p, t)
			if err != nil {
				return err
			}
			out.Summary.count(place)
			if !t.assignedTo(tc.PersonID) {
				continue
			}
			if first && !p.funnel() {
				out.Summary.MyNew++
			}
			if (place == PlaceNew || place == PlaceReview) && len(out.Mine) < limit {
				out.Mine = append(out.Mine, homeTask(t, p, place))
			}
		}
		return r.markForms(ctx, out.Mine)
	})
	return out, err
}

// count adds a task of place to the counters.
func (h *HomeSummary) count(place string) {
	switch place {
	case PlaceNew:
		h.New++
	case PlaceProgress:
		h.InProgress++
	case PlaceReview:
		h.Review++
	}
}

func homeTask(t *task, p *project, place string) HomeTask {
	return HomeTask{ID: t.ID, Project: p.ID, Key: keyOf(t, p), Title: t.Title, Place: place, Urgent: t.Priority == prioUrgent,
		DueAt: t.DueAt, Funnel: p.funnel()}
}

// place is the place of the status of t on «Главная» in the version t follows (the published one as a fallback, as
// statusOf).
func (r *request) place(ctx context.Context, p *project, t *task) (string, bool, error) {
	for _, get := range []func() (*version, error){
		func() (*version, error) { return r.versionOf(ctx, p, t) },
		func() (*version, error) { return r.current(ctx, p) },
	} {
		v, err := get()
		if err != nil {
			return PlaceNone, false, err
		}
		if v == nil {
			continue
		}
		w := workflow{Statuses: v.Statuses, Transitions: v.Transitions}
		if _, ok := w.status(t.StatusID); ok {
			place, first := w.place(t.StatusID, p.funnel())
			return place, first, nil
		}
	}
	return PlaceNone, false, nil
}

// markForms marks the cards made by a rule of a form (the source of the task — a response of «Формы»).
func (r *request) markForms(ctx context.Context, cards []HomeTask) error {
	if len(cards) == 0 {
		return nil
	}
	ids := make([]uuid.UUID, 0, len(cards))
	for _, c := range cards {
		ids = append(ids, c.ID)
	}
	forms, err := collect[uuid.UUID](ctx, r.tx, `select id from tasks.tasks where id = any($1) and source_module = $2 and source_type = $3`,
		ids, sourceForms, sourceResponse)
	if err != nil {
		return store("sources", err)
	}
	for i := range cards {
		cards[i].FromForm = slices.Contains(forms, cards[i].ID)
	}
	return nil
}

// place is the place of the status id of w on «Главная» (funnel — the stages of a funnel) and whether it is the first
// status of the category «К выполнению»: «Новые» — the category «К выполнению»; «На проверке» — a status of the category
// «В работе» that is not the first one of this category and has its own transition (not «Из любого») into «Готово»
// («Принять», «Согласовать»); «В работе» — the other statuses of the category; the stages of a funnel after «Новая»
// («Замер», «Смета», «Договор») and the category «Готово» — none.
func (w *workflow) place(id string, funnel bool) (string, bool) {
	s, ok := w.status(id)
	switch {
	case !ok:
		return PlaceNone, false
	case string(s.Category) == catTodo:
		return PlaceNew, id == w.firstTodo()
	case string(s.Category) != catProgress || funnel:
		return PlaceNone, false
	case w.review(id):
		return PlaceReview, false
	}
	return PlaceProgress, false
}

// review reports whether the status id (of the category «В работе») is a status of review: not the first status of
// its category, with its own transition into a status of the category «Готово».
func (w *workflow) review(id string) bool {
	for _, s := range w.Statuses {
		if string(s.Category) == catProgress {
			if s.Id == id {
				return false
			}
			break
		}
	}
	return slices.ContainsFunc(w.Transitions, func(t tasksapi.TaskWorkflowTransition) bool {
		if slices.Contains(t.From, "*") || !slices.Contains(t.From, id) {
			return false
		}
		to, ok := w.status(t.To)
		return ok && string(to.Category) == catDone
	})
}
