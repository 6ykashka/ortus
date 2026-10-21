package tasks

import (
	"context"
	"net/http"

	"github.com/google/uuid"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W4.11: shared command helpers of the modules (Audit, Complete; Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// SetParent sets or removes the parent of a task (setTaskParent of the prototype — «Входит в задачу…», «Убрать
// связь», «Добавить существующую…», «Исключить из состава»): the histories of the task and of the old and the new
// parent get their lines. The changes of the hierarchy go one after another (lockHierarchy).
func (s *Service) SetParent(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b tasksapi.TaskParentSet) (tasksapi.Task, error) {
	var out tasksapi.Task
	err := s.run(ctx, tc, true, func(r *request) error {
		if err := r.lockHierarchy(ctx); err != nil {
			return err
		}
		t, p, err := r.visibleTask(ctx, id, true)
		if err != nil {
			return err
		}
		if err := r.needTask(ctx, p, t, actUpdate); err != nil {
			return err
		}
		if err := checkRevision(ifMatch, t.Revision, staleTask); err != nil {
			return err
		}
		var old *task
		if t.Parent != nil {
			if old, err = r.task(ctx, *t.Parent, false); err != nil {
				return err
			}
		}
		if b.ParentTaskId == nil {
			if t.Parent == nil {
				if out, err = r.taskDTO(ctx, p, t, true); err != nil {
					return err
				}
				return kit.Complete(ctx, r.tx, http.StatusOK, etag(out.Revision), out)
			}
			t.Parent = nil
			if err := r.unlinkLines(ctx, t, p, old); err != nil {
				return err
			}
			return r.finish(ctx, p, t, &out, evParentChanged)
		}
		par, err := r.checkParent(ctx, t, *b.ParentTaskId)
		if err != nil {
			return err
		}
		t.Parent = &par.ID
		if err := r.linkLines(ctx, t, p, par, old); err != nil {
			return err
		}
		return r.finish(ctx, p, t, &out, evParentChanged)
	})
	return out, err
}

// keyOfTask is the number of a task of any project («—» for an unknown project).
func (r *request) keyOfTask(ctx context.Context, t *task) string {
	if t == nil {
		return unknownName
	}
	p, err := r.project(ctx, t.Project)
	if err != nil || p == nil {
		return unknownName
	}
	return keyOf(t, p)
}

// linkLines writes the lines of a new parent par of t (old — the previous one, nil if none).
func (r *request) linkLines(ctx context.Context, t *task, p *project, par, old *task) error {
	key, parKey := keyOf(t, p), r.keyOfTask(ctx, par)
	line := "входит в " + parKey
	if old != nil {
		line += " (было " + r.keyOfTask(ctx, old) + ")"
	}
	me := r.meActor()
	if _, err := r.log(ctx, t.ID, "parent", line, me, ""); err != nil {
		return err
	}
	if _, err := r.log(ctx, par.ID, "child", "добавлена подзадача "+key, me, ""); err != nil {
		return err
	}
	if old != nil {
		if _, err := r.log(ctx, old.ID, "child", "из состава исключена "+key, me, ""); err != nil {
			return err
		}
	}
	return nil
}

// unlinkLines writes the lines of «Убрать связь» of t from old.
func (r *request) unlinkLines(ctx context.Context, t *task, p *project, old *task) error {
	me := r.meActor()
	if _, err := r.log(ctx, t.ID, "parent", "больше не входит в "+r.keyOfTask(ctx, old), me, ""); err != nil {
		return err
	}
	if old == nil {
		return nil
	}
	_, err := r.log(ctx, old.ID, "child", "из состава исключена "+keyOf(t, p), me, "")
	return err
}

// checkParent is checkParent of the prototype for the parent id of t (nil — a new task): a missing parent — 422
// «Задача не найдена»; a parent the member may not see or of a project without a workflow — 404 (Q-W4.10-3); then
// itself, a cycle, three levels and a finished parent (checkHierarchy).
func (r *request) checkParent(ctx context.Context, t *task, id uuid.UUID) (*task, error) {
	par, pp, err := r.parentOf(ctx, id)
	if err != nil {
		return nil, err
	}
	chain, err := collect[uuid.UUID](ctx, r.tx, `with recursive up(id, parent, depth) as (
			select id, parent_task_id, 0 from tasks.tasks where id = $1
			union all
			select x.id, x.parent_task_id, up.depth + 1 from tasks.tasks x join up on x.id = up.parent where up.depth < 10)
		select id from up where depth > 0 order by depth`, par.ID)
	if err != nil {
		return nil, store("ancestors", err)
	}
	l := link{Parent: par.ID, ParentKey: keyOf(par, pp), Chain: chain, Below: 1}
	if t != nil {
		l.Task, l.TaskKey = &t.ID, r.keyOfTask(ctx, t)
		if err := r.tx.QueryRow(ctx, `with recursive down(id, depth) as (
				select $1::uuid, 1
				union all
				select x.id, down.depth + 1 from tasks.tasks x join down on x.parent_task_id = down.id
				 where x.deleted_at is null and down.depth < 10)
			select max(depth) from down`, t.ID).Scan(&l.Below); err != nil {
			return nil, store("subtree", err)
		}
	}
	if l.ParentDone, err = r.done(ctx, pp, par); err != nil {
		return nil, err
	}
	if err := checkHierarchy(l); err != nil {
		return nil, err
	}
	return par, nil
}

// parentOf is the parent id with its project: 422 «Задача не найдена» when it does not exist, 404 when the member does
// not see it or its project is the funnel.
func (r *request) parentOf(ctx context.Context, id uuid.UUID) (*task, *project, error) {
	par, err := r.task(ctx, id, false)
	if err != nil {
		return nil, nil, err
	}
	if par == nil || par.Deleted {
		return nil, nil, invalid(fieldParent, "not_found", textTaskNotFound)
	}
	pp, err := r.project(ctx, par.Project)
	if err != nil {
		return nil, nil, err
	}
	vis, err := r.visible(ctx, par)
	if err != nil {
		return nil, nil, err
	}
	if pp == nil || pp.funnel() || !vis {
		return nil, nil, notFound(textTaskNotFound)
	}
	return par, pp, nil
}
