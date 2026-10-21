package tasks

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
)

// ---------------------------------------------------------------------------------------------------------------------
// Projects.

const projectCols = `id, key, name, org_unit_id, coalesce(access, ''), flow, workflow_key, owner_id, current_version,
	workflow_revision, task_seq, revision, created_at`

func scanProject(row pgx.Row) (*project, error) {
	var p project
	err := row.Scan(&p.ID, &p.Key, &p.Name, &p.Unit, &p.Access, &p.Flow, &p.WorkflowKey, &p.Owner, &p.CurrentVersion,
		&p.WorkflowRevision, &p.TaskSeq, &p.Revision, &p.CreatedAt)
	return &p, err
}

// loadProjects reads every active project of the tenant, oldest first.
func (r *request) loadProjects(ctx context.Context) ([]*project, error) {
	if r.projects != nil {
		return r.projects, nil
	}
	rows, err := r.tx.Query(ctx, `select `+projectCols+` from tasks.projects where status = 'active' order by created_at, id`)
	if err != nil {
		return nil, store("projects", err)
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (*project, error) { return scanProject(row) })
	if err != nil {
		return nil, store("projects", err)
	}
	if out == nil {
		out = []*project{}
	}
	r.projects = out
	return out, nil
}

// project returns the active project id (nil — none).
func (r *request) project(ctx context.Context, id uuid.UUID) (*project, error) {
	ps, err := r.loadProjects(ctx)
	if err != nil {
		return nil, err
	}
	for _, p := range ps {
		if p.ID == id {
			return p, nil
		}
	}
	return nil, nil
}

// lockProject takes the row of a project for the rest of the transaction and refreshes it.
func (r *request) lockProject(ctx context.Context, p *project) error {
	fresh, err := scanProject(r.tx.QueryRow(ctx, `select `+projectCols+` from tasks.projects where id = $1 for update`, p.ID))
	if err != nil {
		return store("lock project", err)
	}
	*p = *fresh
	return nil
}

// lockedProject is visibleProject taken for the rest of the transaction (lockProject): the visibility is checked
// first, so a project the member does not see answers 404 without waiting on its lock (AC-01). The moment of the
// request is taken again once it holds the project (retime): what the holders of the lock wrote while it waited is not
// in its future.
func (r *request) lockedProject(ctx context.Context, id uuid.UUID) (*project, error) {
	p, err := r.visibleProject(ctx, id)
	if err != nil {
		return nil, err
	}
	if err := r.lockProject(ctx, p); err != nil {
		return nil, err
	}
	r.retime()
	return p, nil
}

// retime moves the moment of the request to now (never back) and forgets what was read at the old one: the people,
// their grants and the access of the requester, and the evaluator frozen at the old moment.
func (r *request) retime() {
	if now := r.s.now(); now.After(r.now) {
		r.now = now
		r.ev = r.s.within(r.tx, now)
		r.forget()
	}
}

// lockHierarchy takes the lock of the hierarchy of tasks of the organization (one tenant DB) for the rest of the
// transaction: setTaskParent and createTask with a parent check checkHierarchy one after another, so A→B and B→A at
// once cannot both pass the check of a cycle. It is taken before any row of a task, so it never waits behind them.
func (r *request) lockHierarchy(ctx context.Context) error {
	if _, err := r.tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended('tasks.hierarchy', 0))`); err != nil {
		return store("lock hierarchy", err)
	}
	return nil
}

// visibleProject returns the project id the requesting member has access to, else 404 «Проект не найден».
func (r *request) visibleProject(ctx context.Context, id uuid.UUID) (*project, error) {
	p, err := r.project(ctx, id)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, notFound(textNoProject)
	}
	a, err := r.access(ctx, p)
	if err != nil {
		return nil, err
	}
	if a == nil {
		return nil, notFound(textNoProject)
	}
	return p, nil
}

// ---------------------------------------------------------------------------------------------------------------------
// Workflow versions and drafts.

func (r *request) version(ctx context.Context, p *project, n int) (*version, error) {
	key := versionKey{p.ID, n}
	if v, ok := r.versions[key]; ok {
		return v, nil
	}
	if p.funnel() {
		wf := funnelWorkflow()
		v := &version{Number: 1, Statuses: wf.Statuses, Transitions: wf.Transitions, PublishedAt: p.CreatedAt}
		r.versions[key] = v
		return v, nil
	}
	var (
		v           version
		st, tr      []byte
		publishedBy *uuid.UUID
	)
	err := r.tx.QueryRow(ctx, `select version, statuses, transitions, published_at, published_by
		from tasks.workflow_versions where project_id = $1 and version = $2`, p.ID, n).Scan(&v.Number, &st, &tr, &v.PublishedAt, &publishedBy)
	switch {
	case noRows(err):
		return nil, nil
	case err != nil:
		return nil, store("workflow version", err)
	}
	v.PublishedBy = publishedBy
	if err := json.Unmarshal(st, &v.Statuses); err != nil {
		return nil, store("statuses", err)
	}
	if err := json.Unmarshal(tr, &v.Transitions); err != nil {
		return nil, store("transitions", err)
	}
	normalize(v.Transitions)
	r.versions[key] = &v
	return &v, nil
}

// normalize makes the arrays of the transitions non-null (the contract: from and who are arrays).
func normalize(trs []tasksapi.TaskWorkflowTransition) {
	for i := range trs {
		if trs[i].Who == nil {
			trs[i].Who = []tasksapi.TaskWorkflowTransitionWho{}
		}
		if trs[i].From == nil {
			trs[i].From = []string{}
		}
	}
}

// current is the published version of p (nil — no workflow); a funnel has its fixed stages as version 1.
func (r *request) current(ctx context.Context, p *project) (*version, error) {
	switch {
	case p.funnel():
		return r.version(ctx, p, 1)
	case p.CurrentVersion == nil:
		return nil, nil
	}
	return r.version(ctx, p, *p.CurrentVersion)
}

// versionOf is the version of the workflow t follows (its own, else the published one).
func (r *request) versionOf(ctx context.Context, p *project, t *task) (*version, error) {
	if t.WorkflowVersion != nil && !p.funnel() {
		v, err := r.version(ctx, p, *t.WorkflowVersion)
		if err != nil || v != nil {
			return v, err
		}
	}
	return r.current(ctx, p)
}

// statusOf is the status of t in its version (the published one as a fallback).
func (r *request) statusOf(ctx context.Context, p *project, t *task) (tasksapi.TaskWorkflowStatus, bool, error) {
	v, err := r.versionOf(ctx, p, t)
	if err != nil || v == nil {
		return tasksapi.TaskWorkflowStatus{}, false, err
	}
	w := workflow{Statuses: v.Statuses}
	if s, ok := w.status(t.StatusID); ok {
		return s, true, nil
	}
	cur, err := r.current(ctx, p)
	if err != nil || cur == nil {
		return tasksapi.TaskWorkflowStatus{}, false, err
	}
	w = workflow{Statuses: cur.Statuses}
	s, ok := w.status(t.StatusID)
	return s, ok, nil
}

// done reports whether t is in a status of the category «Готово».
func (r *request) done(ctx context.Context, p *project, t *task) (bool, error) {
	s, ok, err := r.statusOf(ctx, p, t)
	return ok && s.Category == tasksapi.Done, err
}

func (r *request) draftOf(ctx context.Context, p *project) (*draft, error) {
	var (
		d      draft
		st, tr []byte
	)
	err := r.tx.QueryRow(ctx, `select base_version, statuses, transitions, updated_at, updated_by
		from tasks.workflow_drafts where project_id = $1`, p.ID).Scan(&d.Base, &st, &tr, &d.UpdatedAt, &d.UpdatedBy)
	switch {
	case noRows(err):
		return nil, nil
	case err != nil:
		return nil, store("draft", err)
	}
	if err := json.Unmarshal(st, &d.Statuses); err != nil {
		return nil, store("draft statuses", err)
	}
	if err := json.Unmarshal(tr, &d.Transitions); err != nil {
		return nil, store("draft transitions", err)
	}
	normalize(d.Transitions)
	return &d, nil
}

func (r *request) insertVersion(ctx context.Context, p *project, n int, wf workflow, by *uuid.UUID) error {
	st, err := json.Marshal(wf.Statuses)
	if err != nil {
		return store("statuses", err)
	}
	tr, err := json.Marshal(nonNil(wf.Transitions))
	if err != nil {
		return store("transitions", err)
	}
	_, err = r.tx.Exec(ctx, `insert into tasks.workflow_versions (project_id, version, statuses, transitions, published_at, published_by)
		values ($1, $2, $3, $4, $5, $6)`, p.ID, n, st, tr, r.now, by)
	return store("insert version", err)
}

func nonNil[T any](xs []T) []T {
	if xs == nil {
		return []T{}
	}
	return xs
}

// ---------------------------------------------------------------------------------------------------------------------
// Tasks.

const taskCols = `t.id, t.project_id, t.number, t.legacy_key, t.title, t.description, t.status_id, t.workflow_version,
	t.priority, t.labels, t.assignee_id, t.author_id, t.due_at, t.parent_task_id, t.checklist, t.related_objects,
	t.doc_route, t.revision, t.created_at, t.updated_at, t.deleted_at is not null`

func scanTask(row pgx.Row) (*task, error) {
	var (
		t                      task
		checklist, related, dr []byte
	)
	err := row.Scan(&t.ID, &t.Project, &t.Number, &t.LegacyKey, &t.Title, &t.Description, &t.StatusID, &t.WorkflowVersion,
		&t.Priority, &t.Labels, &t.Assignee, &t.Author, &t.DueAt, &t.Parent, &checklist, &related, &dr, &t.Revision,
		&t.CreatedAt, &t.UpdatedAt, &t.Deleted)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(checklist, &t.Checklist); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(related, &t.Related); err != nil {
		return nil, err
	}
	if len(dr) > 0 {
		if err := json.Unmarshal(dr, &t.DocRoute); err != nil {
			return nil, err
		}
	}
	if t.Labels == nil {
		t.Labels = []string{}
	}
	return &t, nil
}

// task reads a task by id (nil — none); lock — for update.
func (r *request) task(ctx context.Context, id uuid.UUID, lock bool) (*task, error) {
	sql := `select ` + taskCols + ` from tasks.tasks t where t.id = $1`
	if lock {
		sql += ` for update`
	}
	t, err := scanTask(r.tx.QueryRow(ctx, sql, id))
	switch {
	case noRows(err):
		return nil, nil
	case err != nil:
		return nil, store("task", err)
	}
	return t, nil
}

// visibleTask returns the task id the requesting member sees with its project, else 404 «Задача не найдена»
// (Q-W4.10-3: a task the member may not see answers like a missing one).
func (r *request) visibleTask(ctx context.Context, id uuid.UUID, lock bool) (*task, *project, error) {
	t, err := r.task(ctx, id, lock)
	if err != nil {
		return nil, nil, err
	}
	if t == nil {
		return nil, nil, notFound(textTaskNotFound)
	}
	ok, err := r.visible(ctx, t)
	if err != nil {
		return nil, nil, err
	}
	if !ok {
		return nil, nil, notFound(textTaskNotFound)
	}
	p, err := r.project(ctx, t.Project)
	if err != nil {
		return nil, nil, err
	}
	return t, p, nil
}

// children reads the subtasks of t (not deleted), oldest first.
func (r *request) children(ctx context.Context, t *task) ([]*task, error) {
	rows, err := r.tx.Query(ctx, `select `+taskCols+` from tasks.tasks t where t.parent_task_id = $1 and t.deleted_at is null
		order by t.created_at, t.id`, t.ID)
	if err != nil {
		return nil, store("children", err)
	}
	out, err := collectTasks(rows)
	return out, store("children", err)
}

// collectTasks scans every row of a query of taskCols.
func collectTasks(rows pgx.Rows) ([]*task, error) {
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (*task, error) { return scanTask(row) })
}

// kids are the subtasks of t as the requesting member sees them (key, visible, done).
func (r *request) kids(ctx context.Context, t *task) ([]kid, error) {
	cs, err := r.children(ctx, t)
	if err != nil {
		return nil, err
	}
	out := make([]kid, 0, len(cs))
	for _, c := range cs {
		cp, err := r.project(ctx, c.Project)
		if err != nil {
			return nil, err
		}
		if cp == nil {
			out = append(out, kid{Key: unknownName})
			continue
		}
		vis, err := r.visible(ctx, c)
		if err != nil {
			return nil, err
		}
		d, err := r.done(ctx, cp, c)
		if err != nil {
			return nil, err
		}
		out = append(out, kid{Key: keyOf(c, cp), Visible: vis, Done: d})
	}
	return out, nil
}

// saveTask writes the changeable fields of t with a new revision.
func (r *request) saveTask(ctx context.Context, t *task) error {
	checklist, err := json.Marshal(nonNil(t.Checklist))
	if err != nil {
		return store("checklist", err)
	}
	t.Revision++
	t.UpdatedAt = r.now
	_, err = r.tx.Exec(ctx, `update tasks.tasks set title = $2, description = $3, status_id = $4, workflow_version = $5,
		priority = $6, labels = $7, assignee_id = $8, due_at = $9, parent_task_id = $10, checklist = $11, revision = $12,
		updated_at = $13 where id = $1`,
		t.ID, t.Title, t.Description, t.StatusID, t.WorkflowVersion, t.Priority, nonNil(t.Labels), t.Assignee, t.DueAt,
		t.Parent, checklist, t.Revision, t.UpdatedAt)
	return store("save task", err)
}

// ---------------------------------------------------------------------------------------------------------------------
// History.

// actor of a line of the history: the requesting member, or a label (system, process, automation).
type actor struct {
	person *uuid.UUID
	label  string
}

func (r *request) meActor() actor {
	if r.tc.PersonID == uuid.Nil {
		return actor{label: actorSystem}
	}
	id := r.tc.PersonID
	return actor{person: &id}
}

// historyRow is a line of tasks.task_events.
type historyRow struct {
	ID            uuid.UUID
	Task          uuid.UUID
	At            time.Time
	Kind          string
	Actor         *uuid.UUID
	Label         *string
	Text          string
	TransitionKey *string
}

// log adds a line to the history of task.
func (r *request) log(ctx context.Context, taskID uuid.UUID, kind, text string, a actor, transition string) (historyRow, error) {
	h := historyRow{ID: uuid.New(), Task: taskID, At: r.tick(), Kind: kind, Actor: a.person, Text: clip(text, 5000)}
	if a.person == nil {
		label := a.label
		h.Label = &label
	}
	if transition != "" {
		h.TransitionKey = &transition
	}
	_, err := r.tx.Exec(ctx, `insert into tasks.task_events (id, task_id, at, kind, actor_id, actor_label, text, transition_key)
		values ($1, $2, $3, $4, $5, $6, $7, $8)`, h.ID, h.Task, h.At, h.Kind, h.Actor, h.Label, h.Text, h.TransitionKey)
	return h, store("history", err)
}

// clip cuts s to n characters (a line of the history fits its column).
func clip(s string, n int) string {
	rs := []rune(s)
	if len(rs) <= n {
		return s
	}
	return string(rs[:n])
}

// ---------------------------------------------------------------------------------------------------------------------
// Approval rounds.

func (r *request) openRound(ctx context.Context, taskID uuid.UUID) (*round, error) {
	var rd round
	err := r.tx.QueryRow(ctx, `select id, transition_key, workflow_version, mode, approver_ids from tasks.approval_rounds
		where task_id = $1 and closed_at is null`, taskID).Scan(&rd.ID, &rd.TransitionKey, &rd.Version, &rd.Mode, &rd.Approvers)
	switch {
	case noRows(err):
		return nil, nil
	case err != nil:
		return nil, store("round", err)
	}
	rows, err := r.tx.Query(ctx, `select member_id, decided_at from tasks.approval_votes where round_id = $1 and decision = 'approve'
		order by decided_at, member_id`, rd.ID)
	if err != nil {
		return nil, store("votes", err)
	}
	rd.Votes, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (vote, error) {
		var v vote
		err := row.Scan(&v.Member, &v.At)
		return v, err
	})
	return &rd, store("votes", err)
}

func (r *request) closeRound(ctx context.Context, rd *round, outcome string) error {
	if rd == nil || rd.ID == uuid.Nil {
		return nil
	}
	_, err := r.tx.Exec(ctx, `update tasks.approval_rounds set closed_at = $2, outcome = $3 where id = $1 and closed_at is null`,
		rd.ID, r.now, outcome)
	return store("close round", err)
}

func (r *request) insertRound(ctx context.Context, taskID uuid.UUID, rd *round) error {
	rd.ID = uuid.New()
	_, err := r.tx.Exec(ctx, `insert into tasks.approval_rounds (id, task_id, transition_key, workflow_version, mode, approver_ids, opened_at)
		values ($1, $2, $3, $4, $5, $6, $7)`, rd.ID, taskID, rd.TransitionKey, rd.Version, rd.Mode, nonNil(rd.Approvers), r.now)
	return store("insert round", err)
}

// ---------------------------------------------------------------------------------------------------------------------
// Attachments.

// attachment is a file of a task with its uploader.
type attachment struct {
	File     uuid.UUID
	Name     string
	Size     int64
	Type     string
	By       uuid.UUID
	ByName   string
	Attached time.Time
}

func (r *request) files(ctx context.Context, taskID uuid.UUID) ([]attachment, error) {
	rows, err := r.tx.Query(ctx, `select f.id, f.declared_mime, coalesce(f.bytes, 0), tf.attached_by, coalesce(pp.full_name, ''),
		tf.attached_at
		  from tasks.task_files tf
		  join files.objects f on f.id = tf.file_id
		  left join people.person_profiles pp on pp.id = tf.attached_by
		 where tf.task_id = $1 order by tf.attached_at, f.id`, taskID)
	if err != nil {
		return nil, store("files", err)
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (attachment, error) {
		var (
			a        attachment
			declared string
		)
		err := row.Scan(&a.File, &declared, &a.Size, &a.By, &a.ByName, &a.Attached)
		a.Type, a.Name = decodeMIME(declared)
		return a, err
	})
	return out, store("files", err)
}

// ---------------------------------------------------------------------------------------------------------------------
// Automations.

const automationCols = `a.id, a.project_id, a.name, a.trigger_kind, a.trigger_status_id, a.condition_priority, a.action_kind,
	a.action_member_id, a.action_priority, a.action_text, a.enabled, a.version, a.author_id, a.run_count, a.revision,
	a.created_at, a.updated_at, coalesce(pp.full_name, '')`

func scanAutomation(row pgx.Row) (*automation, error) {
	var a automation
	err := row.Scan(&a.ID, &a.Project, &a.Name, &a.Trigger, &a.TriggerTo, &a.CondPrio, &a.ActionKind, &a.ActionWho, &a.ActionPrio,
		&a.ActionText, &a.Enabled, &a.Version, &a.Author, &a.RunCount, &a.Revision, &a.CreatedAt, &a.UpdatedAt, &a.AuthorLabel)
	return &a, err
}

func (r *request) automations(ctx context.Context, projectID uuid.UUID) ([]*automation, error) {
	rows, err := r.tx.Query(ctx, `select `+automationCols+` from tasks.automations a
		left join people.person_profiles pp on pp.id = a.author_id where a.project_id = $1 order by a.created_at, a.id`, projectID)
	if err != nil {
		return nil, store("automations", err)
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (*automation, error) { return scanAutomation(row) })
	return out, store("automations", err)
}

// ---------------------------------------------------------------------------------------------------------------------
// Helpers.

// placeholdersOf joins the statuses a set of strings into sorted unique ids.
func uniqueSorted(xs []string) []string {
	out := slices.Clone(xs)
	slices.Sort(out)
	return slices.Compact(out)
}

// relatedJSON is the jsonb of the related objects of a task.
func relatedJSON(rs []tasksapi.ObjectRef) []byte {
	b, err := json.Marshal(nonNil(rs))
	if err != nil {
		return []byte("[]")
	}
	return b
}

// trimmed is s without surrounding spaces.
func trimmed(s string) string { return strings.TrimSpace(s) }
