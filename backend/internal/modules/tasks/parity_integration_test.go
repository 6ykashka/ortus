//go:build integration

package tasks

import (
	"testing"

	"github.com/google/uuid"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Q-W4.01-14: the module (projAccess, canTask) and the evaluator agree on every task of three levels for every actor of
// tenant A — Permit on the task (the container from Evaluator.Places) and the rows of ScopeQuery of tasks.read over
// tasks.tasks on live PostgreSQL. Their own role in a project replaces the inherited ones in both (RoleReplaces).
func TestAccessParity(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	msk1 := unit("msk1")
	var ids []uuid.UUID
	for _, lvl := range []struct {
		key   string
		level tasksapi.TaskProjectAccessLevel
	}{{"ПАО", tasksapi.Open}, {"ПАЛ", tasksapi.Limited}, {"ПАЗ", tasksapi.Closed}} {
		p := fresh(t, lvl.key, &msk1, lvl.level, tasksapi.Approval)
		assign(t, p.Id, "a.project-approver", roleApprover)
		assign(t, p.Id, "a.manager-msk1", roleViewer) // a role in the project replaces the role of the firm
		groupRole(t, "Исполнители "+lvl.key, p.Id, roleExec, "a.driver-msk2")
		member := newTask(t, "a.owner", p.Id, "Задача участника", func(b *tasksapi.TaskCreate) { b.AssigneeMemberId = new(person("a.driver-msk2")) })
		// A task of a driver who does not see the project (scope self: his own tasks wherever they are).
		own := newTask(t, "a.owner", p.Id, "Своя задача водителя")
		if _, err := superA.Exec(ctx, `update tasks.tasks set assignee_id = $2 where id = $1`, own.Id, person("a.driver-msk1")); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, member.Id, own.Id, newTask(t, "a.owner", p.Id, "Задача владельца").Id)
	}
	ids = append(ids, ref("task:a.fleet-1"), ref("task:a.fleet-2"), ref("task:a.build-1"))
	actors := []string{"a.owner", "a.region-msk", "a.manager-msk1", "a.manager-msk2", "a.two-roles", "a.driver-msk1", "a.driver-msk2",
		"a.project-lead", "a.project-approver", "a.admin"}
	actions := []string{actRead, actUpdate, actTransition, actApprove, actCreate}
	for _, actor := range actors {
		tc := as(t, actor)
		rows := scoped(t, tc, ids)
		err := service().run(ctx, tc, false, func(r *request) error {
			for _, id := range ids {
				if err := agree(t, r, actor, id, actions, rows[id]); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
}

// agree compares the module (canTask) with Permit for every action on the task id, and with the rows of ScopeQuery
// (scoped: the row of id is kept) for tasks.read.
func agree(t *testing.T, r *request, actor string, id uuid.UUID, actions []string, scoped bool) error {
	t.Helper()
	ctx := t.Context()
	x, err := r.task(ctx, id, false)
	if err != nil {
		return err
	}
	p, err := r.project(ctx, x.Project)
	if err != nil {
		return err
	}
	res := authz.Resource{Unit: val(p.Unit), Objects: map[string]uuid.UUID{authz.KindProject: p.ID}, ReadAction: actRead}
	if x.Assignee != nil {
		res.Persons = []uuid.UUID{*x.Assignee}
	}
	for _, action := range actions {
		mine, err := r.canTask(ctx, p, x, action)
		if err != nil {
			return err
		}
		what := actor + " " + action + " " + keyOf(x, p) + " (" + p.Access + ")"
		same(t, what+": module = Permit", mine, ev.Permit(ctx, r.tc, action, res) == nil)
		if action == actRead {
			same(t, what+": module = ScopeQuery", mine, scoped)
		}
	}
	return nil
}

// scoped is which of ids the rows of ScopeQuery of tasks.read for tc keep.
func scoped(t *testing.T, tc tenantctx.TenantContext, ids []uuid.UUID) map[uuid.UUID]bool {
	t.Helper()
	ctx := t.Context()
	pred, err := ev.ScopeQuery(ctx, tc, actRead, taskColumns, 1)
	if err != nil {
		t.Fatal(err)
	}
	pool, err := pools.For(ctx, tc.TenantID)
	if err != nil {
		t.Fatal(err)
	}
	args := append([]any{ids}, pred.Args...)
	rows, err := pool.Query(ctx, `select t.id from tasks.tasks t join tasks.projects p on p.id = t.project_id
		where t.id = any($1) and `+pred.SQL, args...)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[uuid.UUID]bool{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		out[id] = true
	}
	return out
}
