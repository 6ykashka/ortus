//go:build integration

package tasks

import (
	"context"
	"sync"
	"testing"
	"time"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
)

// together runs n calls of fn at once (a barrier before the first statement) and returns their errors.
func together(n int, fn func(i int) error) []error {
	var (
		start = make(chan struct{})
		wg    sync.WaitGroup
		errs  = make([]error, n)
	)
	for i := range n {
		wg.Go(func() {
			<-start
			errs[i] = fn(i)
		})
	}
	close(start)
	wg.Wait()
	return errs
}

// W4.11 возврат 1 (ревью, major): two managers — or a double click with different Idempotency-Keys — set the role of
// the same member in a project at once. access.role_assignments has no unique key on (person, project), so without a
// lock both see no assignment and insert two; the removal then revokes one and the member keeps access. The operation
// takes the project first: exactly one active direct assignment, and the removal leaves none.
func TestSetMemberRoleConcurrent(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	svc := service()
	msk1 := unit("msk1")
	p := fresh(t, "ГНК", &msk1, tasksapi.Limited, tasksapi.Simple)
	owner := as(t, "a.owner")
	member := person("a.manager-msk2")
	direct := `select count(*) from access.role_assignments where principal_kind = 'person' and principal_id = $1
		and scope_kind = 'project' and scope_ref = $2 and state = 'active'`
	for round := range 4 {
		errs := together(8, func(i int) error {
			role := roleExec
			if (i+round)%2 == 1 {
				role = roleViewer
			}
			_, err := svc.SetMemberRole(ctx, owner, p.Id, member, tasksapi.TaskProjectMemberRoleSet{RoleId: role})
			return err
		})
		for i, err := range errs {
			if err != nil {
				t.Fatalf("round %d, call %d: %v", round, i, err)
			}
		}
		if n := count(t, direct, member, p.Id); n != 1 {
			t.Fatalf("round %d: %d active direct assignments of the member, want 1", round, n)
		}
	}
	if err := svc.RemoveMember(ctx, owner, p.Id, member); err != nil {
		t.Fatal(err)
	}
	same(t, "after the removal", count(t, direct, member, p.Id), 0)
	_, err := svc.Project(ctx, as(t, "a.manager-msk2"), p.Id)
	wantCode(t, err, codeNotFound, textNoProject)
}

// W4.11 возврат 1: setTaskProjectMemberRole waits on the project while the holder of its lock assigns the member and
// commits. The moment of the waiting call is the one it gets the project at, not the one it started at: the
// assignment written meanwhile is not in its future, so the answer finds the member (before — 422 «Выберите
// сотрудника», the change rolled back; TestSetMemberRoleConcurrent met it once in eight calls).
func TestSetMemberRoleAfterLockWait(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	svc := service()
	msk1 := unit("msk1")
	p := fresh(t, "ЖДЗ", &msk1, tasksapi.Limited, tasksapi.Simple)
	owner, member := as(t, "a.owner"), person("a.manager-msk2")
	hold, err := superA.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = hold.Rollback(context.WithoutCancel(ctx)) }()
	var holder int
	if err := hold.QueryRow(ctx, `select pg_backend_pid() from tasks.projects where id = $1 for update`, p.Id).Scan(&holder); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		_, err := svc.SetMemberRole(ctx, owner, p.Id, member, tasksapi.TaskProjectMemberRoleSet{RoleId: roleViewer})
		done <- err
	}()
	for waiting := false; !waiting; time.Sleep(10 * time.Millisecond) {
		if err := superA.QueryRow(ctx, `select exists (select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid)))`,
			holder).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := hold.Exec(ctx, `insert into access.role_assignments (principal_kind, principal_id, role_id, role_version,
		scope_kind, scope_ref, include_descendants, valid, granted_by) values ('person', $1, $2, 1, 'project', $3, false,
		tstzrange($4::timestamptz, null), $5)`, member, roleExec, p.Id, clock(), person("a.owner")); err != nil {
		t.Fatal(err)
	}
	if err := hold.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatalf("setTaskProjectMemberRole after the wait: %v", err)
	}
	same(t, "one direct assignment", count(t, `select count(*) from access.role_assignments where principal_kind = 'person'
		and principal_id = $1 and scope_kind = 'project' and scope_ref = $2 and state = 'active'`, member, p.Id), 1)
}

// W4.11 возврат 1 (ревью): setTaskParent A→B and B→A at once each lock only their own task and both pass the cycle
// check. The changes of the hierarchy of the organization go one after another: one of the pair is refused as a cycle.
func TestSetParentConcurrent(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	svc := service()
	msk1 := unit("msk1")
	p := fresh(t, "ЦКЛ", &msk1, tasksapi.Open, tasksapi.Simple)
	owner := as(t, "a.owner")
	for pair := range 6 {
		a := newTask(t, "a.owner", p.Id, "Задача A")
		b := newTask(t, "a.owner", p.Id, "Задача B")
		ids := [2]tasksapi.Task{a, b}
		errs := together(2, func(i int) error {
			x, y := ids[i], ids[1-i]
			_, err := svc.SetParent(ctx, owner, x.Id, rev(x.Revision), tasksapi.TaskParentSet{ParentTaskId: &y.Id})
			return err
		})
		ca, cb := card(t, "a.owner", a.Id), card(t, "a.owner", b.Id)
		if val(ca.ParentTaskId) == b.Id && val(cb.ParentTaskId) == a.Id {
			t.Fatalf("pair %d: a cycle was committed (%v)", pair, errs)
		}
		refused := 0
		for _, err := range errs {
			if err != nil {
				f, ok := asFailure(err)
				if !ok || f.code != codeValidation || len(f.violations) == 0 || f.violations[0].Field != "parentTaskId" ||
					!contains(f.violations[0].Message, "Получится цикл") {
					t.Fatalf("pair %d: %v (%+v), want the cycle refused", pair, err, f)
				}
				refused++
			}
		}
		same(t, "one of the pair is refused", refused, 1)
	}
}

// W4.11 возврат 1 (ревью): publishTaskWorkflow while a transition of a task of the project is in flight (its row
// locked, its new status not committed yet). The publication waits for the transition and checks the status the task
// ends in: the draft without «Отменена» is refused once the task is cancelled, instead of publishing a version the task
// has no status in.
func TestPublishWaitsForTransition(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	svc := service()
	msk1 := unit("msk1")
	p := fresh(t, "ПБЛГ", &msk1, tasksapi.Open, tasksapi.Simple)
	owner := as(t, "a.owner")
	task := newTask(t, "a.owner", p.Id, "Задача в полёте")
	wf := must(svc.Workflow(ctx, owner, p.Id)).of(t)
	d := tasksapi.TaskWorkflowDraftInput{}
	for _, s := range wf.Statuses {
		if s.Id != "s5" {
			d.Statuses = append(d.Statuses, s)
		}
	}
	for _, tr := range wf.Transitions {
		if tr.To != "s5" {
			d.Transitions = append(d.Transitions, tr)
		}
	}
	saved := must(svc.SaveDraft(ctx, owner, p.Id, rev(wf.Revision), d)).of(t)
	hold, err := superA.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = hold.Rollback(context.WithoutCancel(ctx)) }()
	var holder int
	if err := hold.QueryRow(ctx, `select pg_backend_pid() from tasks.tasks where id = $1 for update`, task.Id).Scan(&holder); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		_, err := svc.Publish(ctx, owner, p.Id, rev(saved.Revision))
		done <- err
	}()
	for waiting := false; !waiting; time.Sleep(10 * time.Millisecond) {
		if err := superA.QueryRow(ctx, `select exists (select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid)))`,
			holder).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := hold.Exec(ctx, `update tasks.tasks set status_id = 's5', revision = revision + 1 where id = $1`, task.Id); err != nil {
		t.Fatal(err)
	}
	if err := hold.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	wantField(t, <-done, "statuses", "Есть задачи в статусах, которых нет в новой версии: "+stCancelled+
		". Переведите их или верните статус")
	got := must(svc.Workflow(ctx, owner, p.Id)).of(t)
	same(t, "the version stays", got.Version, wf.Version)
}

// W4.11 возврат 1 (ревью): two createTaskProject with the same key at once — the second meets the unique index after
// the check of freeKey and answers «Ключ … уже занят» (422), not 503.
func TestCreateProjectSameKeyConcurrent(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	svc := service()
	msk1 := unit("msk1")
	owner := as(t, "a.owner")
	errs := together(6, func(int) error {
		_, err := svc.CreateProject(ctx, owner, tasksapi.ProjectCreate{Name: "Гонка ключей", Key: "ГНКЛ", OrgUnitId: &msk1,
			WorkflowKey: tasksapi.Simple})
		return err
	})
	created := 0
	for _, err := range errs {
		if err == nil {
			created++
			continue
		}
		wantField(t, err, "key", "Ключ ГНКЛ уже занят")
	}
	same(t, "created once", created, 1)
}
