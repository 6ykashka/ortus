package tasks

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/google/uuid"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W4.11: shared command helpers of the modules (Audit, Complete; Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Workflow is the published workflow of a project and, for tasks.workflow.manage, its draft (getTaskWorkflow); a
// funnel answers its fixed stages; a project without a workflow — 404 «Процесс не настроен».
func (s *Service) Workflow(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (tasksapi.TaskWorkflow, error) {
	var out tasksapi.TaskWorkflow
	err := s.run(ctx, tc, false, func(r *request) error {
		p, err := r.visibleProject(ctx, id)
		if err != nil {
			return err
		}
		out, err = r.workflowDTO(ctx, p)
		return err
	})
	return out, err
}

// editable is the common part of the commands of «Процесс»: the visible project, «Настраивать», not a funnel, a
// workflow, the row of the project locked and its workflow revision against If-Match.
func (r *request) editable(ctx context.Context, id uuid.UUID, ifMatch string, needDraft bool) (*project, *draft, error) {
	p, err := r.visibleProject(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	if _, err := r.need(ctx, p, actWorkflowManage); err != nil {
		return nil, nil, err
	}
	if p.funnel() {
		return nil, nil, conflict(reasonFunnel, textFunnelFixed)
	}
	if err := r.lockProject(ctx, p); err != nil {
		return nil, nil, err
	}
	if p.CurrentVersion == nil {
		return nil, nil, notFound(textNoWorkflow)
	}
	d, err := r.draftOf(ctx, p)
	if err != nil {
		return nil, nil, err
	}
	if needDraft && d == nil {
		return nil, nil, notFound(textNoDraft)
	}
	if err := checkRevision(ifMatch, p.WorkflowRevision, textStale); err != nil {
		return nil, nil, err
	}
	return p, d, nil
}

// bumpWorkflow raises the revision of the workflow of p (the ETag of getTaskWorkflow).
func (r *request) bumpWorkflow(ctx context.Context, p *project) error {
	p.WorkflowRevision++
	_, err := r.tx.Exec(ctx, `update tasks.projects set workflow_revision = $2, updated_at = $3 where id = $1`, p.ID, p.WorkflowRevision, r.now)
	return store("workflow revision", err)
}

// SaveDraft replaces the draft of the workflow (saveTaskWorkflowDraft — every edit of «Процесс»).
func (s *Service) SaveDraft(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b tasksapi.TaskWorkflowDraftInput) (tasksapi.TaskWorkflow, error) {
	var out tasksapi.TaskWorkflow
	err := s.run(ctx, tc, true, func(r *request) error {
		p, _, err := r.editable(ctx, id, ifMatch, false)
		if err != nil {
			return err
		}
		normalize(b.Transitions)
		if err := validDraft(b); err != nil {
			return err
		}
		if err := checkDraft(workflow{Statuses: b.Statuses, Transitions: b.Transitions}); err != nil {
			return err
		}
		st, err := json.Marshal(b.Statuses)
		if err != nil {
			return store("statuses", err)
		}
		tr, err := json.Marshal(nonNil(b.Transitions))
		if err != nil {
			return store("transitions", err)
		}
		if _, err := r.tx.Exec(ctx, `insert into tasks.workflow_drafts (project_id, base_version, statuses, transitions, updated_at, updated_by)
			values ($1, $2, $3, $4, $5, $6)
			on conflict (project_id) do update set base_version = excluded.base_version, statuses = excluded.statuses,
			   transitions = excluded.transitions, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
			p.ID, *p.CurrentVersion, st, tr, r.now, r.tc.PersonID); err != nil {
			return store("save draft", err)
		}
		if err := r.bumpWorkflow(ctx, p); err != nil {
			return err
		}
		if out, err = r.workflowDTO(ctx, p); err != nil {
			return err
		}
		return kit.Complete(ctx, r.tx, http.StatusOK, etag(out.Revision), out)
	})
	return out, err
}

// DiscardDraft removes the draft (discardTaskWorkflowDraft, «Сбросить черновик»); no draft — 404 «Черновика нет».
func (s *Service) DiscardDraft(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string) (tasksapi.TaskWorkflow, error) {
	var out tasksapi.TaskWorkflow
	err := s.run(ctx, tc, true, func(r *request) error {
		p, _, err := r.editable(ctx, id, ifMatch, true)
		if err != nil {
			return err
		}
		if _, err := r.tx.Exec(ctx, `delete from tasks.workflow_drafts where project_id = $1`, p.ID); err != nil {
			return store("discard draft", err)
		}
		if err := r.bumpWorkflow(ctx, p); err != nil {
			return err
		}
		if out, err = r.workflowDTO(ctx, p); err != nil {
			return err
		}
		return kit.Complete(ctx, r.tx, http.StatusOK, etag(out.Revision), out)
	})
	return out, err
}

// Publish publishes the draft as version N+1 in one transaction (publishTaskWorkflow): the tasks stay in their
// statuses and follow the new version, the rounds of approval follow the transitions of the new version. The tasks of
// the project are locked before their statuses are checked (lockedTasks), so a transition in flight is not missed.
func (s *Service) Publish(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string) (tasksapi.TaskWorkflow, error) {
	var out tasksapi.TaskWorkflow
	err := s.run(ctx, tc, true, func(r *request) error {
		p, d, err := r.editable(ctx, id, ifMatch, false)
		if err != nil {
			return err
		}
		if d == nil {
			return checkPublish(nil, nil, nil)
		}
		ts, err := r.lockedTasks(ctx, p)
		if err != nil {
			return err
		}
		used, refs, err := r.inUse(ctx, p, ts)
		if err != nil {
			return err
		}
		wf := workflow{Statuses: d.Statuses, Transitions: d.Transitions}
		if err := checkPublish(&wf, used, refs); err != nil {
			return err
		}
		n := *p.CurrentVersion + 1
		me := r.tc.PersonID
		if err := r.insertVersion(ctx, p, n, wf, &me); err != nil {
			return err
		}
		if err := r.movePublished(ctx, p, n, ts); err != nil {
			return err
		}
		ev, err := r.publish(ctx, evPublished, aggProject, p.ID, map[string]any{keyProjectID: p.ID, keyWorkflowVer: n})
		if err != nil {
			return err
		}
		r.toOwners("workflow.published", "Опубликован процесс проекта «"+p.Name+"» v"+strconv.Itoa(n)+". Задачи остаются в своих статусах", ev)
		if err := kit.Audit(ctx, r.tx, audit.Event{Action: "tasks.workflow.publish", TargetType: targetProject, TargetID: p.ID,
			UnitID: unitOrNil(p.Unit), Diff: map[string]any{keyWorkflowVer: n}}); err != nil {
			return err
		}
		if out, err = r.workflowDTO(ctx, p); err != nil {
			return err
		}
		return kit.Complete(ctx, r.tx, http.StatusOK, etag(out.Revision), out)
	})
	return out, err
}

// lockedTasks are the live tasks of p taken for the rest of the transaction (in the order of their ids) and read after
// the lock: a transition in flight is waited for, so the check of the statuses in use sees the status it ends in.
func (r *request) lockedTasks(ctx context.Context, p *project) ([]*task, error) {
	if _, err := r.tx.Exec(ctx, `select id from tasks.tasks where project_id = $1 and deleted_at is null order by id for update`,
		p.ID); err != nil {
		return nil, store("lock project tasks", err)
	}
	return r.projectTasks(ctx, p)
}

// inUse are the statuses the tasks ts of p are in and the rules of p entering a status.
func (r *request) inUse(ctx context.Context, p *project, ts []*task) ([]usedStatus, []ruleRef, error) {
	used := make([]usedStatus, 0, len(ts))
	for _, t := range ts {
		name := t.StatusID
		if st, ok, err := r.statusOf(ctx, p, t); err != nil {
			return nil, nil, err
		} else if ok {
			name = st.Name
		}
		used = append(used, usedStatus{ID: t.StatusID, Name: name})
	}
	rules, err := r.automations(ctx, p.ID)
	if err != nil {
		return nil, nil, err
	}
	var refs []ruleRef
	for _, a := range rules {
		if a.Trigger == string(tasksapi.TaskAutomationTriggerKindStatusEntered) && a.TriggerTo != nil {
			refs = append(refs, ruleRef{Name: a.Name, StatusID: *a.TriggerTo})
		}
	}
	return used, refs, nil
}

// movePublished makes version n the current one of p: the draft goes, the live tasks follow n and their rounds of
// approval follow the transitions of n.
func (r *request) movePublished(ctx context.Context, p *project, n int, ts []*task) error {
	if _, err := r.tx.Exec(ctx, `delete from tasks.workflow_drafts where project_id = $1`, p.ID); err != nil {
		return store("draft", err)
	}
	if _, err := r.tx.Exec(ctx, `update tasks.projects set current_version = $2, workflow_revision = workflow_revision + 1,
		updated_at = $3 where id = $1`, p.ID, n, r.now); err != nil {
		return store("current version", err)
	}
	if _, err := r.tx.Exec(ctx, `update tasks.tasks set workflow_version = $2 where project_id = $1 and deleted_at is null`,
		p.ID, n); err != nil {
		return store("tasks to the new version", err)
	}
	p.CurrentVersion, p.WorkflowRevision = &n, p.WorkflowRevision+1
	for _, t := range ts {
		t.WorkflowVersion = &n
		if err := r.syncRound(ctx, p, t); err != nil {
			return err
		}
	}
	return nil
}
