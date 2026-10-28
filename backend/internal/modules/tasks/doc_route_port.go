package tasks

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// The port of the module «Документы» (W7.24, Q-W4.00-documents-3, -18): the route of a document keeps a mirror task —
// «Согласовать: …» with the card of the route (tasks.tasks.doc_route). The route moves the status and the assignee of
// the task, nobody moves it by hand (409 invalid_transition, reason doc_route); cmd/api adapts it to docs.RouteTasks.
// Every call runs in the transaction of the route.

// Sources and names of the mirror task and of the system project of the routes.
const (
	sourceDocs     = "docs"
	sourceRoute    = "route"
	docProjectName = "ДОК · Документы · маршруты"
	docProjectKey  = "ДОК"
	docLabel       = "документ"
	routeReview    = "На проверке"
	textNoDocFlow  = "В проекте нет процесса задач. Выберите проект с процессом"
	textNoDocProj  = "Выберите проект задач с процессом"
	textDocForbid  = "Нет права создавать задачи в проекте «"
)

// Statuses of a route (docs.routes.status).
const (
	routeReturned  = "returned"
	routeDone      = "done"
	routeCancelled = "cancelled"
)

// DocRouteState is what a route tells its task: the status of the route, the step and who waits, the assignee and the
// term of the step, and the member whose decision moved it (Actor — the author of the line of the history).
type DocRouteState struct {
	Status       string
	Title        string
	Version      int
	Step, Steps  int
	StepName     string
	Waiting      []uuid.UUID
	WaitingNames []string
	Assignee     uuid.UUID // uuid.Nil: keep
	Due          *time.Time
	Actor        uuid.UUID // uuid.Nil: the system
}

// DocRouteTask is the mirror task of a route: the project (uuid.Nil — the system project), the author of the route and
// whether he owns the business, the document, the route, the title, the description and the first state.
type DocRouteTask struct {
	Project     uuid.UUID
	Author      uuid.UUID
	AuthorOwner bool
	AuthorName  string
	Document    uuid.UUID
	Route       uuid.UUID
	Title       string
	Description string
	State       DocRouteState
}

// DocRouteTaskResult is the task made — its id, number and project — or the cause of a refusal.
type DocRouteTaskResult struct {
	ID        uuid.UUID
	Key       string
	Project   uuid.UUID
	Refused   string
	Forbidden bool // the refusal is «нет права»
}

// CreateDocRouteTask makes the mirror task of a route in tx: in the chosen project (the author needs «Создавать»
// there) or, without one, in the system project «ДОК · Документы · маршруты», made on first use with the process «С
// согласованием», open for all. The rules «Задача создана» do not run: the route makes the task (Q-W4.11-3). A refusal
// is DocRouteTaskResult.Refused, not an error.
func (s *Service) CreateDocRouteTask(ctx context.Context, tx pgx.Tx, tenant uuid.UUID, t DocRouteTask) (DocRouteTaskResult, error) {
	r := s.request(tenantctx.TenantContext{TenantID: tenant, PersonID: t.Author, Owner: t.AuthorOwner}, tx)
	p, refused, err := r.routeProject(ctx, t)
	if err != nil || refused.text != "" {
		return DocRouteTaskResult{Refused: refused.text, Forbidden: refused.forbidden}, err
	}
	cur, err := r.current(ctx, p)
	if err != nil {
		return DocRouteTaskResult{}, err
	}
	if cur == nil {
		return DocRouteTaskResult{Refused: textNoDocFlow}, nil
	}
	author, assignee := t.Author, t.State.Assignee
	if assignee == uuid.Nil {
		assignee = author
	}
	module, typ, source := sourceDocs, sourceRoute, t.Route
	x := &task{ID: uuid.New(), Project: p.ID, Title: clip(trimmed(t.Title), titleMax), Description: clip(trimmed(t.Description), descriptionMax),
		StatusID: routeStatus(cur, t.State.Status), WorkflowVersion: &cur.Number, Priority: "high", Labels: []string{docLabel}, Assignee: &assignee,
		Author: &author, DueAt: utcOrNil(t.State.Due), Checklist: []tasksapi.TaskChecklistItem{},
		Related: []tasksapi.ObjectRef{docRef(t.Document)}, Revision: 1, CreatedAt: r.tick(), UpdatedAt: r.now,
		source: sourceRef{module: &module, typ: &typ, id: &source}}
	if p.funnel() {
		x.WorkflowVersion = nil
	}
	if runes(x.Title) < titleMin {
		x.Title = clip(x.Title+" — документ", titleMax)
	}
	if err := r.insertTask(ctx, p, x); err != nil {
		return DocRouteTaskResult{}, err
	}
	if err := r.writeDocRoute(ctx, x.ID, t.Document, t.State); err != nil {
		return DocRouteTaskResult{}, err
	}
	if _, err := r.log(ctx, x.ID, triggerCreated, clip("Маршрут запущен: v"+strconv.Itoa(t.State.Version), 5000), r.meActor(), ""); err != nil {
		return DocRouteTaskResult{}, err
	}
	if _, err := r.publish(ctx, evTaskCreated, aggTask, x.ID, map[string]any{keyTaskID: x.ID, keyProjectID: p.ID, "documentId": t.Document}); err != nil {
		return DocRouteTaskResult{}, err
	}
	return DocRouteTaskResult{ID: x.ID, Key: keyOf(x, p), Project: p.ID}, nil
}

func docRef(doc uuid.UUID) tasksapi.ObjectRef {
	return tasksapi.ObjectRef{ModuleKey: sourceDocs, EntityType: "document", EntityId: doc}
}

// refusal is the cause of a refusal to make the task.
type refusal struct {
	text      string
	forbidden bool
}

// routeProject is the project of the task of t, taken for the transaction, or the cause of a refusal.
func (r *request) routeProject(ctx context.Context, t DocRouteTask) (*project, refusal, error) {
	if t.Project == uuid.Nil {
		p, err := r.docProject(ctx)
		return p, refusal{}, err
	}
	p, err := r.project(ctx, t.Project)
	if err != nil || p == nil {
		return nil, refusal{text: textNoDocProj}, err
	}
	if ok, err := r.mayCreateIn(ctx, p); err != nil || !ok {
		return nil, refusal{text: textDocForbid + p.Name + "»", forbidden: true}, err
	}
	if err := r.lockProject(ctx, p); err != nil {
		return nil, refusal{}, err
	}
	return p, refusal{}, nil
}

// docProject is the system project of the routes; it is made on first use (documents.js installDocs: «ДОК · Документы ·
// маршруты», the process «С согласованием»; the owner of the project is the author of the first route — the column wants one). Two routes starting at once make one project: the lock is the one of the
// organization.
func (r *request) docProject(ctx context.Context) (*project, error) {
	if _, err := r.tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext('tasks.doc_route_project'))`); err != nil {
		return nil, store("project lock", err)
	}
	var id uuid.UUID
	err := r.tx.QueryRow(ctx, `select id from tasks.projects where name = $1 and flow = 'tasks' and status = 'active' order by created_at, id limit 1`, docProjectName).Scan(&id)
	switch {
	case err == nil:
		p, err := r.project(ctx, id)
		if err != nil || p == nil {
			return nil, err
		}
		return p, r.lockProject(ctx, p)
	case !noRows(err):
		return nil, store("system project", err)
	}
	key, err := r.docProjectKey(ctx)
	if err != nil {
		return nil, err
	}
	p := &project{ID: uuid.New(), Key: key, Name: docProjectName, Access: levelOpen, Flow: flowTasks, WorkflowKey: tmplApproval, Owner: r.tc.PersonID,
		WorkflowRevision: 1, TaskSeq: seqStart, Revision: 1, CreatedAt: r.now}
	if err := r.insertProject(ctx, p, template(tmplApproval), nil); err != nil {
		return nil, err
	}
	r.forget()
	r.projects = nil
	return r.project(ctx, p.ID)
}

// docProjectKey is the key «ДОК», or «ДОК2», «ДОК3» … when a project of the organization holds it.
func (r *request) docProjectKey(ctx context.Context) (string, error) {
	for n := 1; n < 100; n++ {
		key := docProjectKey
		if n > 1 {
			key += strconv.Itoa(n)
		}
		var taken bool
		if err := r.tx.QueryRow(ctx, `select exists (select 1 from tasks.projects where key = $1)`, key).Scan(&taken); err != nil {
			return "", store("key", err)
		}
		if !taken {
			return key, nil
		}
	}
	return "", store("key", errors.New("tasks: no free key for the system project"))
}

// SyncDocRouteTask moves the task after its route (syncTask): the status by the category of the route, the assignee and
// the term of the step, the card of the route and a system comment note (may be empty). A task that is gone is no
// error: the route goes on without it.
func (s *Service) SyncDocRouteTask(ctx context.Context, tx pgx.Tx, tenant, id uuid.UUID, st DocRouteState, note string) error {
	r := s.request(tenantctx.TenantContext{TenantID: tenant, PersonID: st.Actor}, tx)
	t, err := r.task(ctx, id, true)
	if err != nil || t == nil || t.Deleted {
		return err
	}
	p, err := r.project(ctx, t.Project)
	if err != nil || p == nil {
		return err
	}
	v, err := r.versionOf(ctx, p, t)
	if err != nil || v == nil {
		return err
	}
	if err := r.mirrorChange(ctx, t, v, st, note); err != nil {
		return err
	}
	if err := r.saveTask(ctx, t); err != nil {
		return err
	}
	doc := uuid.Nil
	if t.DocRoute != nil {
		doc = t.DocRoute.Document.EntityId
	}
	if err := r.writeDocRoute(ctx, t.ID, doc, st); err != nil {
		return err
	}
	_, err = r.publish(ctx, evTransitioned, aggTask, t.ID, map[string]any{keyTaskID: t.ID, keyProjectID: p.ID, "statusId": t.StatusID})
	return err
}

// mirrorChange applies the state of the route to t: the status (with a line in the history), the assignee, the term and
// the system comment note.
func (r *request) mirrorChange(ctx context.Context, t *task, v *version, st DocRouteState, note string) error {
	if to := routeStatus(v, st.Status); to != t.StatusID {
		w := workflow{Statuses: v.Statuses}
		from, _ := w.status(t.StatusID)
		next, _ := w.status(to)
		if _, err := r.log(ctx, t.ID, "transition", from.Name+" → "+next.Name+" (маршрут документа)", actor{label: actorSystem}, ""); err != nil {
			return err
		}
		t.StatusID = to
	}
	if st.Assignee != uuid.Nil {
		a := st.Assignee
		t.Assignee = &a
	}
	if st.Due != nil {
		t.DueAt = utcOrNil(st.Due)
	}
	if note == "" {
		return nil
	}
	_, err := r.log(ctx, t.ID, "comment", note, r.meActor(), "")
	return err
}

// writeDocRoute writes the card of the route of a task («Маршрут документа «…» v{v} · шаг {n} из {of} «{шаг}». Ждут: …»).
func (r *request) writeDocRoute(ctx context.Context, id, doc uuid.UUID, st DocRouteState) error {
	names := st.WaitingNames
	if names == nil {
		names = []string{}
	}
	raw, err := json.Marshal(tasksapi.TaskDocRoute{Document: docRef(doc), Step: st.Step, StepName: st.StepName, StepsTotal: st.Steps,
		Title: st.Title, Version: st.Version, WaitingDisplayNames: names})
	if err != nil {
		return store("doc route", err)
	}
	_, err = r.tx.Exec(ctx, `update tasks.tasks set doc_route = $2 where id = $1`, id, raw)
	return store("doc route", err)
}

// routeStatus is the status of the task for the status of the route: «На проверке» while it runs, «В работе» after a
// return, «Готово» at the end, «Отменена» after a cancel — or the first status of the category when the process has no
// such name.
func routeStatus(v *version, route string) string {
	name, cat := routeReview, tasksapi.Progress
	switch route {
	case routeReturned:
		name = stProgress
	case routeDone:
		name, cat = stDone, tasksapi.Done
	case routeCancelled:
		name, cat = stCancelled, tasksapi.Done
	}
	fallback := ""
	for _, s := range v.Statuses {
		if s.Name == name {
			return s.Id
		}
		if fallback == "" && s.Category == cat {
			fallback = s.Id
		}
	}
	if fallback == "" && len(v.Statuses) > 0 {
		fallback = v.Statuses[0].Id
	}
	return fallback
}
