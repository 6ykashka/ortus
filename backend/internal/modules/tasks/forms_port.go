package tasks

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// The port of the module «Формы» (W4.21, Q-W4.05-27): the action «Создать задачу» of a rule of a form creates the task
// in the transaction of the response, on behalf of the author of the rule (D-27); cmd/api adapts it to forms.Tasks.

// FormTask is the task of a rule of a form: the project, the author of the rule (and whether he owns the business),
// the assignee, the title, the description, the response it comes from and its line in the history («Ответ R-… формы
// «…»»).
type FormTask struct {
	Project, Author, Assignee uuid.UUID
	AuthorOwner               bool
	AuthorName                string
	Title, Description        string
	Response                  uuid.UUID
	Origin                    string
}

// FormTaskResult is the task created — its number «LOG-101», the name of its status and of its assignee — or the
// cause of a refusal for the journal of the response.
type FormTaskResult struct {
	ID                    uuid.UUID
	Key, Status, Assigned string
	Refused               string
}

// Sources of a task of a form (tasks.tasks.source_*).
const (
	sourceForms    = "forms"
	sourceResponse = "response"
)

// CreateFormTask creates the task t in tx of the tenant: the author needs tasks.create in the project, the assignee
// must see it; the first status of «К выполнению», the response among the related objects. The rules «Задача создана»
// do not run: the task is made by the process of the form, as the task of a defect (Q-W4.11-3). A refusal is
// FormTaskResult.Refused, not an error.
func (s *Service) CreateFormTask(ctx context.Context, tx pgx.Tx, tenant uuid.UUID, t FormTask) (FormTaskResult, error) {
	r := s.request(tenantctx.TenantContext{TenantID: tenant, PersonID: t.Author, Owner: t.AuthorOwner}, tx)
	p, refused, err := r.formProject(ctx, t)
	if err != nil || refused != "" {
		return FormTaskResult{Refused: refused}, err
	}
	cur, err := r.current(ctx, p)
	if err != nil {
		return FormTaskResult{}, err
	}
	x := r.formTask(p, cur, t)
	if err := r.insertTask(ctx, p, x); err != nil {
		return FormTaskResult{}, err
	}
	if _, err := r.log(ctx, x.ID, triggerCreated, clip("Создана действием формы: "+t.Origin, 5000), r.meActor(), ""); err != nil {
		return FormTaskResult{}, err
	}
	if err := r.syncRound(ctx, p, x); err != nil {
		return FormTaskResult{}, err
	}
	if _, err := r.publish(ctx, evTaskCreated, aggTask, x.ID, map[string]any{keyTaskID: x.ID, keyProjectID: p.ID, "responseId": t.Response}); err != nil {
		return FormTaskResult{}, err
	}
	if err := r.flushNotices(ctx); err != nil {
		return FormTaskResult{}, err
	}
	return FormTaskResult{ID: x.ID, Key: keyOf(x, p), Status: statusName(cur, x.StatusID), Assigned: r.nameOf(ctx, &t.Assignee)}, nil
}

// formProject is the project of t taken for the transaction, or the cause of a refusal: the project is gone, the
// author may not create tasks there, the assignee does not see it.
func (r *request) formProject(ctx context.Context, t FormTask) (*project, string, error) {
	p, err := r.project(ctx, t.Project)
	if err != nil || p == nil {
		return nil, "проект задач удалён", err
	}
	if ok, err := r.mayCreateIn(ctx, p); err != nil || !ok {
		return nil, "у автора правила " + t.AuthorName + " нет права «Создавать» в проекте «" + p.Name + "»", err
	}
	if err := r.lockProject(ctx, p); err != nil {
		return nil, "", err
	}
	if err := r.assignable(ctx, p, t.Assignee); err != nil {
		if codeOf(err) != codeValidation {
			return nil, "", err
		}
		return nil, "исполнитель " + r.nameOf(ctx, &t.Assignee) + " не видит проект «" + p.Name + "»", nil
	}
	return p, "", nil
}

// formTask is the row of the task t in p (cur — the current version of its workflow, nil — none).
func (r *request) formTask(p *project, cur *version, t FormTask) *task {
	status := "s1"
	if cur != nil {
		w := workflow{Statuses: cur.Statuses}
		status = w.firstTodo()
	}
	title := clip(trimmed(t.Title), titleMax)
	if runes(title) < titleMin {
		title = clip(title+" — "+t.Origin, titleMax)
	}
	module, typ, source := sourceForms, sourceResponse, t.Response
	author, assignee := t.Author, t.Assignee
	x := &task{ID: uuid.New(), Project: p.ID, Title: title, Description: clip(trimmed(t.Description), descriptionMax),
		StatusID: status, Priority: prioNormal, Labels: []string{}, Assignee: &assignee, Author: &author,
		Checklist: []tasksapi.TaskChecklistItem{}, Related: []tasksapi.ObjectRef{{ModuleKey: sourceForms, EntityType: sourceResponse,
			EntityId: t.Response}}, Revision: 1, CreatedAt: r.tick(), UpdatedAt: r.now,
		source: sourceRef{module: &module, typ: &typ, id: &source}}
	if !p.funnel() && cur != nil {
		x.WorkflowVersion = &cur.Number
	}
	return x
}

// statusName is the name of the status id of cur (the id itself when unknown).
func statusName(cur *version, id string) string {
	if cur != nil {
		for _, st := range cur.Statuses {
			if st.Id == id {
				return st.Name
			}
		}
	}
	return id
}

// mayCreateIn reports whether the requesting member holds tasks.create in p.
func (r *request) mayCreateIn(ctx context.Context, p *project) (bool, error) {
	if _, err := r.need(ctx, p, actCreate); err != nil {
		if codeOf(err) == codeForbidden {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// MayCreate reports whether member (owner — the owner of the business) may create tasks in project: the editor of the
// rule «Создать задачу» offers and accepts only such projects.
func (s *Service) MayCreate(ctx context.Context, tx pgx.Tx, tenant, member uuid.UUID, owner bool, project uuid.UUID) (bool, error) {
	r := s.request(tenantctx.TenantContext{TenantID: tenant, PersonID: member, Owner: owner}, tx)
	p, err := r.project(ctx, project)
	if err != nil || p == nil {
		return false, err
	}
	return r.mayCreateIn(ctx, p)
}

// FormTaskKeys are the numbers («LOG-101», «T-65» of the seed) of the tasks ids, for the journal of a response; a task
// deleted since keeps its number.
func (s *Service) FormTaskKeys(ctx context.Context, tx pgx.Tx, ids []uuid.UUID) (map[uuid.UUID]string, error) {
	out := map[uuid.UUID]string{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := tx.Query(ctx, `select t.id, coalesce(t.legacy_key, p.key || '-' || t.number) from tasks.tasks t
		join tasks.projects p on p.id = t.project_id where t.id = any($1)`, ids)
	if err != nil {
		return nil, store("form task keys", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			id  uuid.UUID
			key string
		)
		if err := rows.Scan(&id, &key); err != nil {
			return nil, store("form task keys", err)
		}
		out[id] = key
	}
	return out, store("form task keys", rows.Err())
}
