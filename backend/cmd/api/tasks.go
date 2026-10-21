package main

import (
	"context"
	"time"

	"github.com/google/uuid"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
	"github.com/ortus/ortus-crm/backend/internal/modules/files"
	"github.com/ortus/ortus-crm/backend/internal/modules/tasks"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// newTasks is the server of the tag Tasks (W4.11, S4-01…S4-09): projects, their workflow, members and rules, tasks,
// approval, hierarchy and attachments over the tenant pools, the evaluator of W1.04 (the container of a project is
// registered by registerProjects), the memberships of the control DB («Участники», the owner), the inbox of the owners
// and the clock of the application (APP_FIXED_NOW outside prod).
func newTasks(pools tasks.Pools, ev *authz.Evaluator, control tasks.ControlQuerier, now func() time.Time) tasksapi.StrictServerInterface {
	return tasks.Server{S: &tasks.Service{Pools: pools, Authz: ev, Directory: tasks.ControlDirectory{DB: control},
		Audience: inbox.AuthzAudience{E: ev}, Now: now}}
}

// registerProjects registers the projects of tasks in the evaluator (W4.01, RS-08): the reads a territorial grant keeps
// in a limited project and the place of a project — its area and level — for Permit on its objects (a task, a file of
// a task) wherever it is asked.
func registerProjects(ev *authz.Evaluator, pools tasks.Pools) {
	tasks.RegisterContainer(ev, pools) // the same registration as cmd/worker (projectsIn)
}

// taskParent is the parent «tasks/task» of the attachments of tasks (purpose task_attachment, W4.11).
func taskParent() files.ParentKind {
	return files.ParentKind{Module: tasks.FileModule, Entity: tasks.FileEntity, ReadAction: tasks.FileReadAction,
		Purposes: []files.Purpose{files.PurposeTaskAttachment}, Rows: tasks.FileRows}
}

// hiddenTasks closes to the subject the tasks he does not read (a closed project without his role in it, TP-03): their
// files are out of listFiles and answer 404.
type hiddenTasks struct{ H tasks.HiddenTasks }

var _ files.Hider = hiddenTasks{}

// Closed implements files.Hider.
func (h hiddenTasks) Closed(ctx context.Context, tc tenantctx.TenantContext) (files.Closed, error) {
	ids, err := h.H.Hidden(ctx, tc)
	if err != nil {
		return files.Closed{}, err
	}
	return files.Closed{Hidden: ids, Continued: []uuid.UUID{}}, nil
}

// closedParents joins the Hiders of the parents of files: what one closes is closed (ids of different tables do not
// collide, UUID).
type closedParents []files.Hider

var _ files.Hider = closedParents{}

// Closed implements files.Hider.
func (hs closedParents) Closed(ctx context.Context, tc tenantctx.TenantContext) (files.Closed, error) {
	out := files.Closed{Hidden: []uuid.UUID{}, Continued: []uuid.UUID{}}
	for _, h := range hs {
		c, err := h.Closed(ctx, tc)
		if err != nil {
			return files.Closed{}, err
		}
		out.Hidden = append(out.Hidden, c.Hidden...)
		out.Continued = append(out.Continued, c.Continued...)
	}
	return out, nil
}
