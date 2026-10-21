package tasks

import (
	"context"
	"net/http"
	"time"

	"github.com/google/uuid"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W4.11: shared command helpers of the modules (Audit, Complete; Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Texts of the tasks (api.js:692–770 of the prototype, MSW tasks/index.ts).
const (
	textTitleShort  = "Тема — не короче 3 символов"
	textDescLong    = "Описание — не длиннее 5000 символов"
	textNotAssignee = "Исполнитель не видит проект — выберите участника проекта"
	titleMin        = 3
	titleMax        = 200
	scopeSQL        = "{{scope}}"
)

// TaskQuery is the filter of listTasks.
type TaskQuery struct {
	Project  *uuid.UUID // the board of a project
	Parent   *uuid.UUID // the subtasks of a task («Состоит из»)
	Mine     bool       // assignee=me («Мои»)
	Awaiting bool       // awaitingMyApproval («Ждут моего согласия»)
	Cursor   *string
	Limit    *int
}

// levelSQL is the level of the project of a row for the evaluator: a funnel is open (MSW accessOf).
const levelSQL = "(case when p.flow = 'leads' then 'open' else p.access end)"

// taskColumns are the columns of a task row for the scope predicate: the unit of its project, its project (a role of
// the project, RoleReplaces), its assignee (scope self) and the level of its project (TP-03, limited — reads).
var taskColumns = authz.Columns{
	Unit:      "p.org_unit_id",
	Objects:   map[string]string{authz.KindProject: "t.project_id"},
	Persons:   []string{"t.assignee_id"},
	Container: authz.ProjectColumns(levelSQL),
}

// Tasks lists the tasks the requesting member sees (listTasks): the rows come through the scope predicate of the
// evaluator for tasks.read (the projects the member has access to and its own tasks elsewhere — scope self).
func (s *Service) Tasks(ctx context.Context, tc tenantctx.TenantContext, q TaskQuery) (tasksapi.TaskPage, error) {
	var out tasksapi.TaskPage
	err := s.run(ctx, tc, false, func(r *request) error {
		ts, err := r.scopedTasks(ctx, q)
		if err != nil {
			return err
		}
		items := []tasksapi.Task{}
		for _, t := range ts {
			p, err := r.project(ctx, t.Project)
			if err != nil {
				return err
			}
			if p == nil {
				continue
			}
			if q.Awaiting {
				ok, err := r.awaiting(ctx, p, t)
				if err != nil {
					return err
				}
				if !ok {
					continue
				}
			}
			dto, err := r.taskDTO(ctx, p, t, false)
			if err != nil {
				return err
			}
			items = append(items, dto)
		}
		out.Items, out.NextCursor, err = pageOf(items, func(t tasksapi.Task) string { return t.Id.String() }, q.Cursor, q.Limit)
		return err
	})
	return out, err
}

// scopedTasks reads the live tasks of the filter the scope predicate of tasks.read lets through, newest first.
func (r *request) scopedTasks(ctx context.Context, q TaskQuery) ([]*task, error) {
	var mine *uuid.UUID
	if q.Mine {
		mine = &r.tc.PersonID
	}
	args := []any{q.Project, q.Parent, mine}
	pred, err := r.ev.ScopeQuery(ctx, r.tc, actRead, taskColumns, len(args))
	if err != nil {
		return nil, err
	}
	sql := `select ` + taskCols + ` from tasks.tasks t join tasks.projects p on p.id = t.project_id
		 where t.deleted_at is null and p.status = 'active'
		   and ($1::uuid is null or t.project_id = $1) and ($2::uuid is null or t.parent_task_id = $2)
		   and ($3::uuid is null or t.assignee_id = $3)
		   and (` + pred.SQL + `)
		 order by t.created_at desc, t.number desc, t.id`
	rows, err := r.tx.Query(ctx, sql, append(args, pred.Args...)...)
	if err != nil {
		return nil, store("tasks", err)
	}
	out, err := collectTasks(rows)
	return out, store("tasks", err)
}

// awaiting reports whether t waits for the vote of the requesting member («Ждут моего согласия»): a transition by
// approval from its status the member may vote now.
func (r *request) awaiting(ctx context.Context, p *project, t *task) (bool, error) {
	if p.funnel() {
		return false, nil
	}
	v, err := r.versionOf(ctx, p, t)
	if err != nil {
		return false, err
	}
	tr, ok := approvalHere(v, t)
	if !ok {
		return false, nil
	}
	sc, err := r.scene(ctx, p)
	if err != nil {
		return false, err
	}
	rd, err := r.openRound(ctx, t.ID)
	if err != nil {
		return false, err
	}
	kids, err := r.kids(ctx, t)
	if err != nil {
		return false, err
	}
	return sc.check(t, tr, r.tc.PersonID, rd, kids).ok, nil
}

// Task is the whole card of a task (getTask); a task the member may not see is 404 (Q-W4.10-3).
func (s *Service) Task(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (tasksapi.Task, error) {
	var out tasksapi.Task
	err := s.run(ctx, tc, false, func(r *request) error {
		t, p, err := r.visibleTask(ctx, id, false)
		if err != nil {
			return err
		}
		out, err = r.taskDTO(ctx, p, t, true)
		return err
	})
	return out, err
}

// assignable requires that the person id may be the assignee in p: an active member who sees the project (Р-16).
func (r *request) assignable(ctx context.Context, p *project, id uuid.UUID) error {
	sc, err := r.scene(ctx, p)
	if err != nil {
		return err
	}
	if ok, _, _ := sc.can(id, actRead); !ok {
		return invalid("assigneeMemberId", "not_in_project", textNotAssignee)
	}
	return nil
}

// checkTitle trims a title and checks it: 3…200 characters.
func checkTitle(title string) (string, error) {
	t := trimmed(title)
	switch n := runes(t); {
	case n < titleMin:
		return "", invalid("title", "too_short", textTitleShort)
	case n > titleMax:
		return "", invalid("title", "length", textLength)
	}
	return t, nil
}

// checkDescription trims a description and checks it: at most 5000 characters.
func checkDescription(d string) (string, error) {
	t := trimmed(d)
	if runes(t) > descriptionMax {
		return "", invalid("descriptionMarkdown", "too_long", textDescLong)
	}
	return t, nil
}

// CreateTask creates a task in a project (createTask, createProjectTask of the prototype): the number «{KEY}-{N}»,
// the first status of «К выполнению», the author — the requesting member, the assignee — the body or the author;
// the rules «Задача создана» run before the answer. A parent is checked under the lock of the hierarchy (taken first,
// as setTaskParent does); the project is taken before its current version is read, so a task created while the
// workflow is published follows the version that is current when it is numbered.
func (s *Service) CreateTask(ctx context.Context, tc tenantctx.TenantContext, b tasksapi.TaskCreate) (tasksapi.Task, error) {
	var out tasksapi.Task
	err := s.run(ctx, tc, true, func(r *request) error {
		p, err := r.createIn(ctx, b)
		if err != nil {
			return err
		}
		t, par, err := r.newTask(ctx, p, b)
		if err != nil {
			return err
		}
		if err := r.insertTask(ctx, p, t); err != nil {
			return err
		}
		if par != nil {
			if err := r.linkLines(ctx, t, p, par, nil); err != nil {
				return err
			}
		}
		if err := r.autoFire(ctx, p, t, string(tasksapi.TaskAutomationTriggerKindCreated), ""); err != nil {
			return err
		}
		if err := r.syncRound(ctx, p, t); err != nil {
			return err
		}
		if err := r.saveTaskSilently(ctx, t); err != nil {
			return err
		}
		if _, err := r.publish(ctx, evTaskCreated, aggTask, t.ID, map[string]any{keyTaskID: t.ID, keyProjectID: p.ID}); err != nil {
			return err
		}
		if out, err = r.taskDTO(ctx, p, t, true); err != nil {
			return err
		}
		return kit.Complete(ctx, r.tx, http.StatusCreated, etag(out.Revision), out)
	})
	return out, err
}

// createIn is the project of createTask taken for the transaction: the lock of the hierarchy first when the body names
// a parent, then the project the member sees with tasks.create, then its row.
func (r *request) createIn(ctx context.Context, b tasksapi.TaskCreate) (*project, error) {
	if b.ParentTaskId != nil {
		if err := r.lockHierarchy(ctx); err != nil {
			return nil, err
		}
	}
	p, err := r.visibleProject(ctx, b.ProjectId)
	if err != nil {
		return nil, err
	}
	if _, err := r.need(ctx, p, actCreate); err != nil {
		return nil, err
	}
	if err := r.lockProject(ctx, p); err != nil {
		return nil, err
	}
	return p, nil
}

// newTask checks the body of createTask in the order of the prototype and returns the task and its parent.
func (r *request) newTask(ctx context.Context, p *project, b tasksapi.TaskCreate) (*task, *task, error) {
	title, err := checkTitle(b.Title)
	if err != nil {
		return nil, nil, err
	}
	desc, labels, err := newContent(b)
	if err != nil {
		return nil, nil, err
	}
	assignee := r.tc.PersonID
	if b.AssigneeMemberId != nil {
		assignee = *b.AssigneeMemberId
	}
	if err := r.assignable(ctx, p, assignee); err != nil {
		return nil, nil, err
	}
	var par *task
	if b.ParentTaskId != nil {
		if par, err = r.checkParent(ctx, nil, *b.ParentTaskId); err != nil {
			return nil, nil, err
		}
	}
	cur, err := r.current(ctx, p)
	if err != nil {
		return nil, nil, err
	}
	status := "s1"
	if cur != nil {
		w := workflow{Statuses: cur.Statuses}
		status = w.firstTodo()
	}
	prio := prioNormal
	if b.Priority != nil {
		prio = string(*b.Priority)
	}
	me := r.tc.PersonID
	t := &task{ID: uuid.New(), Project: p.ID, Title: title, Description: desc, StatusID: status, Priority: prio, Labels: labels,
		Assignee: &assignee, Author: &me, DueAt: utcOrNil(b.DueAt), Checklist: []tasksapi.TaskChecklistItem{},
		Related: []tasksapi.ObjectRef{}, Revision: 1, CreatedAt: r.tick(), UpdatedAt: r.now}
	if par != nil {
		t.Parent = &par.ID
	}
	if !p.funnel() && cur != nil {
		t.WorkflowVersion = &cur.Number
	}
	return t, par, nil
}

// newContent is the description and the labels of a new task, checked in the order of the prototype with the priority.
func newContent(b tasksapi.TaskCreate) (string, []string, error) {
	desc := ""
	if b.DescriptionMarkdown != nil {
		var err error
		if desc, err = checkDescription(*b.DescriptionMarkdown); err != nil {
			return "", nil, err
		}
	}
	if err := validPriority("priority", b.Priority); err != nil {
		return "", nil, err
	}
	if b.Labels == nil {
		return desc, []string{}, nil
	}
	if err := validLabels(*b.Labels); err != nil {
		return "", nil, err
	}
	return desc, normLabels(*b.Labels), nil
}

func utcOrNil(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	u := t.UTC()
	return &u
}

// insertTask numbers t in its project (task_seq + 1 under the lock of the project) and writes it.
func (r *request) insertTask(ctx context.Context, p *project, t *task) error {
	if err := r.tx.QueryRow(ctx, `update tasks.projects set task_seq = task_seq + 1 where id = $1 returning task_seq`, p.ID).
		Scan(&t.Number); err != nil {
		return store("number", err)
	}
	if t.Author != nil && *t.Author == uuid.Nil {
		t.Author = nil
	}
	_, err := r.tx.Exec(ctx, `insert into tasks.tasks (id, project_id, number, legacy_key, title, description, status_id,
		workflow_version, priority, labels, assignee_id, author_id, due_at, parent_task_id, related_objects, source_module,
		source_type, source_id, revision, created_at, updated_at)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 1, $19, $19)`,
		t.ID, p.ID, t.Number, t.LegacyKey, t.Title, t.Description, t.StatusID, t.WorkflowVersion, t.Priority, nonNil(t.Labels),
		t.Assignee, t.Author, t.DueAt, t.Parent, relatedJSON(t.Related), t.source.module, t.source.typ, t.source.id, t.CreatedAt)
	return store("insert task", err)
}

// saveTaskSilently writes the fields of a task just created without a new revision (the rules of «Задача создана»).
func (r *request) saveTaskSilently(ctx context.Context, t *task) error {
	_, err := r.tx.Exec(ctx, `update tasks.tasks set priority = $2, assignee_id = $3 where id = $1`, t.ID, t.Priority, t.Assignee)
	return store("save new task", err)
}

// UpdateTask changes the fields of a card (updateTask, setTaskField of the prototype): checks first, then the
// change (PD-60). The status changes only by a transition.
func (s *Service) UpdateTask(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b tasksapi.TaskPatch) (tasksapi.Task, error) {
	var out tasksapi.Task
	err := s.run(ctx, tc, true, func(r *request) error {
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
		if err := r.patchTask(ctx, p, t, b); err != nil {
			return err
		}
		if err := r.saveTask(ctx, t); err != nil {
			return err
		}
		if out, err = r.taskDTO(ctx, p, t, true); err != nil {
			return err
		}
		return kit.Complete(ctx, r.tx, http.StatusOK, etag(out.Revision), out)
	})
	return out, err
}

// patchTask checks the patch whole, then applies it to t.
func (r *request) patchTask(ctx context.Context, p *project, t *task, b tasksapi.TaskPatch) error {
	title, desc, err := r.checkPatch(ctx, p, b)
	if err != nil {
		return err
	}
	applyPatch(t, b, title, desc)
	return nil
}

// checkPatch checks the fields of a patch in the order of the prototype and returns the trimmed title and description.
func (r *request) checkPatch(ctx context.Context, p *project, b tasksapi.TaskPatch) (title, desc string, err error) {
	if b.DescriptionMarkdown != nil {
		if desc, err = checkDescription(*b.DescriptionMarkdown); err != nil {
			return "", "", err
		}
	}
	if b.AssigneeMemberId != nil {
		if err := r.assignable(ctx, p, *b.AssigneeMemberId); err != nil {
			return "", "", err
		}
	}
	if b.Title != nil {
		if title, err = checkTitle(*b.Title); err != nil {
			return "", "", err
		}
	}
	if err := validPriority("priority", b.Priority); err != nil {
		return "", "", err
	}
	if b.Labels != nil {
		if err := validLabels(*b.Labels); err != nil {
			return "", "", err
		}
	}
	return title, desc, nil
}

// applyPatch writes a checked patch to t.
func applyPatch(t *task, b tasksapi.TaskPatch, title, desc string) {
	if b.Title != nil {
		t.Title = title
	}
	if b.DescriptionMarkdown != nil {
		t.Description = desc
	}
	if b.AssigneeMemberId != nil {
		a := *b.AssigneeMemberId
		t.Assignee = &a
	}
	if b.DueAt != nil {
		t.DueAt = utcOrNil(b.DueAt)
	}
	if b.Priority != nil {
		t.Priority = string(*b.Priority)
	}
	if b.Labels != nil {
		t.Labels = normLabels(*b.Labels)
	}
}

// Checklist checks or unchecks an item of the checklist (updateTaskChecklistItem, toggleTaskCheck of the prototype).
func (s *Service) Checklist(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, item, ifMatch string, b tasksapi.TaskChecklistItemPatch) (tasksapi.Task, error) {
	var out tasksapi.Task
	err := s.run(ctx, tc, true, func(r *request) error {
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
		i := -1
		for k, c := range t.Checklist {
			if c.Id == item {
				i = k
			}
		}
		if i < 0 {
			return notFound(textNoItem)
		}
		if t.Checklist[i].Done != b.Done {
			t.Checklist[i].Done = b.Done
			text := "снял(а) отметку: " + t.Checklist[i].Text
			if b.Done {
				text = "отметил(а): " + t.Checklist[i].Text
			}
			if _, err := r.log(ctx, t.ID, "checklist", text, r.meActor(), ""); err != nil {
				return err
			}
		}
		if err := r.saveTask(ctx, t); err != nil {
			return err
		}
		if out, err = r.taskDTO(ctx, p, t, true); err != nil {
			return err
		}
		return kit.Complete(ctx, r.tx, http.StatusOK, etag(out.Revision), out)
	})
	return out, err
}

// tick is the moment of the next row the request writes: now plus a microsecond per row, so the lines of one
// command keep their order (the history and the journal are newest first).
func (r *request) tick() time.Time {
	r.seq++
	return r.now.Add(time.Duration(r.seq) * time.Microsecond)
}
