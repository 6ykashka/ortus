package tasks

import (
	"context"
	"encoding/json"
	"slices"
	"strconv"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// W4.24 (D-29 комплекта: «дефект → задача вместо очереди S2-17»): the check of the blocking defect of an inspection is
// one task — the task the rule «задача» of «Осмотр машины» made for the response of the inspection, as the reference
// has it (recordInspection, api.js:76: urgent with a critical defect), or, without one, the task of the defect of W4.11.
// The consumer of the inspection (forms.InspectionResponses, cmd/worker) calls it in the transaction of the response.

// labelDefect is the label of the task of a defect.
const labelDefect = "дефект"

// InspectionDefects makes the check of the first blocking defect of inspection still in the queue a task: the task of
// the response of the inspection (formTask; live, not done, not taken by another defect) takes it — urgent, the label
// «дефект», the vehicle and the defect among its related objects, the assignee and the deadline of the defect when it
// has them, a line of the history; otherwise the task of the defect of W4.11 is made. A defect with a task gets nothing.
func (s *Service) InspectionDefects(ctx context.Context, tx pgx.Tx, tenant, inspection uuid.UUID, formTask *uuid.UUID) error {
	r := s.request(tenantctx.TenantContext{TenantID: tenant}, tx)
	e, err := r.inspectionDefect(ctx, inspection)
	if err != nil || e == nil {
		return err
	}
	if formTask != nil {
		taken, err := r.takeTask(ctx, *e, *formTask)
		if err != nil || taken {
			return err
		}
	}
	return r.defectTask(ctx, *e)
}

// inspectionDefect is the first blocking defect of inspection still in the queue as the event of the queue names it
// (nil — none).
func (r *request) inspectionDefect(ctx context.Context, inspection uuid.UUID) (*defectEvent, error) {
	var e defectEvent
	err := r.tx.QueryRow(ctx, `select id, trip_id, vehicle_id from fleet.defects where inspection_id = $1 and severity = 'blocking'
		and state in ('open', 'in_review') order by created_at, id limit 1`, inspection).Scan(&e.Defect, &e.Trip, &e.Vehicle)
	switch {
	case noRows(err):
		return nil, nil
	case err != nil:
		return nil, store("defect of the inspection", err)
	}
	return &e, nil
}

// takeTask makes the task id of the response of the inspection the task of the defect of e (false — it cannot).
func (r *request) takeTask(ctx context.Context, e defectEvent, id uuid.UUID) (bool, error) {
	x, t, err := r.candidate(ctx, e, id)
	if err != nil || t == nil {
		return false, err
	}
	return true, r.adopt(ctx, t, x, e)
}

// candidate is the defect of e and the task id locked when the task may take the defect (t nil — it may not: the
// defect left the queue or has a task, the task is gone, done or of another defect). The project is taken before the
// task of the defect is looked for, as defectTask does: two calls for one defect make one task.
func (r *request) candidate(ctx context.Context, e defectEvent, id uuid.UUID) (*defectRow, *task, error) {
	x, err := r.defect(ctx, e.Defect)
	if err != nil || x == nil || x.decided() {
		return nil, nil, err
	}
	t, p, err := r.lockedTask(ctx, id)
	if err != nil || t == nil || slices.ContainsFunc(t.Related, isDefect) {
		return nil, nil, err
	}
	if have, err := r.sourceTask(ctx, e.Defect); err != nil || have != nil {
		return nil, nil, err
	}
	if done, err := r.done(ctx, p, t); err != nil || done {
		return nil, nil, err
	}
	return x, t, nil
}

// lockedTask is the live task id taken for the transaction after its project (nil — none).
func (r *request) lockedTask(ctx context.Context, id uuid.UUID) (*task, *project, error) {
	t, err := r.task(ctx, id, false)
	if err != nil || t == nil || t.Deleted {
		return nil, nil, err
	}
	p, err := r.project(ctx, t.Project)
	if err != nil || p == nil {
		return nil, nil, err
	}
	if err := r.lockProject(ctx, p); err != nil {
		return nil, nil, err
	}
	if t, err = r.task(ctx, id, true); err != nil || t == nil || t.Deleted {
		return nil, nil, err
	}
	return t, p, nil
}

// adopt writes t as the task of the defect x of e.
func (r *request) adopt(ctx context.Context, t *task, x *defectRow, e defectEvent) error {
	t.Priority = prioUrgent
	if !slices.Contains(t.Labels, labelDefect) {
		t.Labels = append(t.Labels, labelDefect)
	}
	if x.assignee != nil {
		t.Assignee, t.DueAt = x.assignee, x.due
	}
	for _, ref := range []tasksapi.ObjectRef{{ModuleKey: sourceFleet, EntityType: "vehicle", EntityId: e.Vehicle}, defectRef(e.Defect)} {
		if !slices.Contains(t.Related, ref) {
			t.Related = append(t.Related, ref)
		}
	}
	if _, err := r.tx.Exec(ctx, `update tasks.tasks set related_objects = $2::jsonb where id = $1`, t.ID, string(relatedJSON(t.Related))); err != nil {
		return store("related of the task of the defect", err)
	}
	if _, err := r.log(ctx, t.ID, "field", "Связана с дефектом осмотра: "+x.zone+" — "+x.description, actor{label: actorSystem}, ""); err != nil {
		return err
	}
	return r.saveTask(ctx, t)
}

// defectRef is the defect id among the related objects of its task.
func defectRef(id uuid.UUID) tasksapi.ObjectRef {
	return tasksapi.ObjectRef{ModuleKey: sourceFleet, EntityType: sourceDefect, EntityId: id}
}

func isDefect(ref tasksapi.ObjectRef) bool {
	return ref.ModuleKey == sourceFleet && ref.EntityType == sourceDefect
}

// formPriority is the priority of the task of a form: the one asked when it is known, else «Обычный».
func formPriority(p string) string {
	if slices.Contains(priorities, p) {
		return p
	}
	return prioNormal
}

// checklistOf is a checklist of the texts, not done, with the ids «ch-1», «ch-2»… (as the seed numbers T-65).
func checklistOf(texts []string) []tasksapi.TaskChecklistItem {
	out := make([]tasksapi.TaskChecklistItem, 0, len(texts))
	for i, text := range texts {
		out = append(out, tasksapi.TaskChecklistItem{Id: "ch-" + strconv.Itoa(i+1), Text: text})
	}
	return out
}

// writeChecklist writes the checklist of a task just inserted (insertTask writes none) without a new revision.
func (r *request) writeChecklist(ctx context.Context, t *task) error {
	if len(t.Checklist) == 0 {
		return nil
	}
	b, err := json.Marshal(t.Checklist)
	if err != nil {
		return store("checklist", err)
	}
	_, err = r.tx.Exec(ctx, `update tasks.tasks set checklist = $2::jsonb where id = $1`, t.ID, string(b))
	return store("checklist of a new task", err)
}
