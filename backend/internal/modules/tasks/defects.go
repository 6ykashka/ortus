package tasks

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Events of the queue of blocking defects (S2-17, fleet/inspections) the module turns into a task (D-29 of the set:
// «на шаге 4.1 — задача»; the queue itself stays until W4.24).
const (
	EventDefectBlocking = "fleet.defect.blocking_reported.v1"
	EventDefectAssigned = "fleet.defect.assigned.v1"
	EventDefectDecided  = "fleet.defect.decided.v1"
	// ConsumerDefects is the consumer of outbox.inbox: a repeated delivery changes nothing.
	ConsumerDefects = "tasks.defect_tasks"
	sourceFleet     = "fleet"
	sourceDefect    = "defect"
	decisionAllow   = "allow_departure"
)

// DefectTasks makes the check of a blocking defect a task of the project of tasks of the area of the vehicle: a
// blocking defect on departure creates the urgent task «Проверить дефект: {машина} {номер} — {зона}» (source
// fleet/defect, related — the vehicle and the trip), the assignment of the defect moves to the task, the decision on
// the defect finishes it. A tenant without a project of the area gets no task (the queue S2-17 works as before).
type DefectTasks struct {
	Pools Pools
	Now   func() time.Time // the clock of the application; nil: time.Now
}

// Register adds the handlers to reg (cmd/worker): the assignment and the decision of a defect. The task of a blocking
// defect is made with the response of its inspection (W4.24, InspectionDefects called by forms.InspectionResponses):
// one task, no race of two consumers of one inspection; Handle still makes it from blocking_reported when called.
func (d DefectTasks) Register(reg *events.Registry) {
	for _, typ := range []string{EventDefectAssigned, EventDefectDecided} {
		reg.Handle(typ, d.Handle)
	}
}

// defectEvent is the payload of the events of the queue.
type defectEvent struct {
	Defect   uuid.UUID  `json:"defectId"`
	Trip     *uuid.UUID `json:"tripId"`
	Vehicle  uuid.UUID  `json:"vehicleId"`
	Assignee *uuid.UUID `json:"assigneeMemberId"`
	DueAt    *time.Time `json:"dueAt"`
	Decision string     `json:"decision"`
}

// Handle consumes one event of the queue in one transaction of the tenant DB of the message.
func (d DefectTasks) Handle(ctx context.Context, m events.Message) error {
	var p defectEvent
	if err := json.Unmarshal(m.Payload, &p); err != nil {
		return fmt.Errorf("%s payload: %w", m.Type, err)
	}
	pool, err := d.Pools.For(ctx, m.TenantID)
	if err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		first, err := events.Once(ctx, tx, ConsumerDefects, m.EventID)
		if err != nil || !first {
			return err
		}
		r := (&Service{Now: d.Now}).request(tenantctx.TenantContext{TenantID: m.TenantID}, tx)
		switch m.Type {
		case EventDefectBlocking:
			return r.defectTask(ctx, p)
		case EventDefectAssigned:
			return r.defectAssigned(ctx, p)
		case EventDefectDecided:
			return r.defectDecided(ctx, p)
		}
		return nil
	})
}

// defectRow is what the task needs of a defect of the queue.
type defectRow struct {
	zone, description, vehicle, plate, state string
	trip                                     *string
	unit                                     uuid.UUID
	assignee                                 *uuid.UUID
	due                                      *time.Time
}

// decided reports whether the defect has left the queue (resolved or confirmed out of service): an event delivered
// after the decision makes no task.
func (x *defectRow) decided() bool { return x.state != "open" && x.state != "in_review" }

func (r *request) defect(ctx context.Context, id uuid.UUID) (*defectRow, error) {
	var x defectRow
	err := r.tx.QueryRow(ctx, `select d.zone, d.description, coalesce(v.display_name, ''), v.plate, d.state, t.number, v.unit_id,
		d.assignee_id, d.due_at
		  from fleet.defects d join fleet.vehicles v on v.id = d.vehicle_id left join fleet.trips t on t.id = d.trip_id
		 where d.id = $1`, id).Scan(&x.zone, &x.description, &x.vehicle, &x.plate, &x.state, &x.trip, &x.unit, &x.assignee, &x.due)
	switch {
	case noRows(err):
		return nil, nil
	case err != nil:
		return nil, store("defect", err)
	}
	return &x, nil
}

// areaProject is the project of tasks (with a workflow) whose area is the unit or its nearest ancestor; else a project
// of the whole organization, the oldest.
func (r *request) areaProject(ctx context.Context, unit uuid.UUID) (*project, error) {
	var id uuid.UUID
	err := r.tx.QueryRow(ctx, `select p.id from tasks.projects p
		  left join org.unit_closure c on c.ancestor_id = p.org_unit_id and c.descendant_id = $1
		 where p.status = 'active' and p.flow = 'tasks' and p.current_version is not null
		   and (p.org_unit_id is null or c.descendant_id is not null)
		 order by (p.org_unit_id is null), c.depth, p.created_at, p.id limit 1`, unit).Scan(&id)
	switch {
	case noRows(err):
		return nil, nil
	case err != nil:
		return nil, store("project of the area", err)
	}
	return r.project(ctx, id)
}

// sourceTask is the live task of the defect id (nil — none): made for it, or the task of the response of its inspection
// that took it (W4.24 — the defect among the related objects).
func (r *request) sourceTask(ctx context.Context, id uuid.UUID) (*task, error) {
	t, err := scanTask(r.tx.QueryRow(ctx, `select `+taskCols+` from tasks.tasks t where ((t.source_module = $1 and t.source_type = $2
		and t.source_id = $3) or (t.source_module = $4 and t.source_type = $5 and t.related_objects @> $6::jsonb))
		and t.deleted_at is null order by t.created_at limit 1 for update`, sourceFleet, sourceDefect, id, sourceForms, sourceResponse,
		string(relatedJSON([]tasksapi.ObjectRef{defectRef(id)}))))
	switch {
	case noRows(err):
		return nil, nil
	case err != nil:
		return nil, store("task of the defect", err)
	}
	return t, nil
}

// defectTask creates the task of a blocking defect still in the queue (a decided one gets none). The rules «Задача
// создана» of the project do not run for it: the task is made by the process, not by a member (Q-W4.11-3). The task of
// the defect is looked for under the lock of the project (defectPlace), so events of one defect at once make one task.
func (r *request) defectTask(ctx context.Context, e defectEvent) error {
	x, p, cur, err := r.defectPlace(ctx, e.Defect)
	if err != nil || cur == nil {
		return err
	}
	if have, err := r.sourceTask(ctx, e.Defect); err != nil || have != nil {
		return err
	}
	assignee := p.Owner
	if x.assignee != nil {
		assignee = *x.assignee
	}
	module, typ, source := sourceFleet, sourceDefect, e.Defect
	w := workflow{Statuses: cur.Statuses}
	t := &task{ID: uuid.New(), Project: p.ID, Title: clip(defectTitle(x), titleMax), Description: defectText(x), StatusID: w.firstTodo(),
		WorkflowVersion: &cur.Number, Priority: prioUrgent, Labels: []string{"дефект"}, Assignee: &assignee, DueAt: x.due,
		Checklist: []tasksapi.TaskChecklistItem{}, Related: defectRelated(e), CreatedAt: r.tick(), UpdatedAt: r.now,
		source: sourceRef{module: &module, typ: &typ, id: &source}}
	if err := r.insertTask(ctx, p, t); err != nil {
		return err
	}
	line := "Создана по дефекту осмотра: " + x.zone + " — " + x.description
	if _, err := r.log(ctx, t.ID, "created", line, actor{label: actorSystem}, ""); err != nil {
		return err
	}
	if err := r.syncRound(ctx, p, t); err != nil {
		return err
	}
	_, err = r.publish(ctx, evTaskCreated, aggTask, t.ID, map[string]any{keyTaskID: t.ID, keyProjectID: p.ID, "defectId": e.Defect})
	return err
}

// defectPlace is the defect id still in the queue, the project of the area of its vehicle and the current version of
// its workflow; cur is nil when there is no task to make (no defect, a decided one, no project or no workflow). The
// project is taken for the transaction before its version is read: a publication in flight is waited for.
func (r *request) defectPlace(ctx context.Context, id uuid.UUID) (x *defectRow, p *project, cur *version, err error) {
	if x, err = r.defect(ctx, id); err != nil || x == nil || x.decided() {
		return nil, nil, nil, err
	}
	if p, err = r.areaProject(ctx, x.unit); err != nil || p == nil {
		return nil, nil, nil, err
	}
	if err = r.lockProject(ctx, p); err != nil {
		return nil, nil, nil, err
	}
	cur, err = r.current(ctx, p)
	return x, p, cur, err
}

// defectTitle is «Проверить дефект: {машина} {номер} — {зона}».
func defectTitle(x *defectRow) string {
	return "Проверить дефект: " + strings.TrimSpace(x.vehicle+" "+x.plate) + " — " + x.zone
}

// defectText is the description of the task: the defect and the trip.
func defectText(x *defectRow) string {
	text := x.zone + ": " + x.description
	if x.trip != nil {
		text += "\nРейс " + *x.trip + ". Выезд заблокирован до решения по дефекту."
	}
	return clip(text, descriptionMax)
}

func defectRelated(e defectEvent) []tasksapi.ObjectRef {
	out := []tasksapi.ObjectRef{{ModuleKey: sourceFleet, EntityType: "vehicle", EntityId: e.Vehicle}}
	if e.Trip != nil {
		out = append(out, tasksapi.ObjectRef{ModuleKey: sourceFleet, EntityType: "trip", EntityId: *e.Trip})
	}
	return out
}

// defectAssigned moves the assignee and the deadline of the defect to its task.
func (r *request) defectAssigned(ctx context.Context, e defectEvent) error {
	t, err := r.sourceTask(ctx, e.Defect)
	if err != nil || t == nil || e.Assignee == nil {
		return err
	}
	a := *e.Assignee
	t.Assignee, t.DueAt = &a, utcOrNil(e.DueAt)
	if _, err := r.log(ctx, t.ID, "assignment", "Назначено: "+r.nameOf(ctx, &a), actor{label: actorProcess}, ""); err != nil {
		return err
	}
	return r.saveTask(ctx, t)
}

// defectDecided finishes the task of a decided defect: the first status of «Готово» with the decision in its history.
func (r *request) defectDecided(ctx context.Context, e defectEvent) error {
	t, p, v, err := r.defectVersion(ctx, e.Defect)
	if err != nil || v == nil {
		return err
	}
	w := workflow{Statuses: v.Statuses}
	from, _ := w.status(t.StatusID)
	if from.Category == tasksapi.Done {
		return nil
	}
	to := doneStatus(v)
	if to.Id == "" {
		return nil
	}
	rd, err := r.openRound(ctx, t.ID)
	if err != nil {
		return err
	}
	if err := r.closeRound(ctx, rd, outcomeCancelled); err != nil {
		return err
	}
	decision := "Неисправность подтверждена — машина недоступна"
	if e.Decision == decisionAllow {
		decision = "Дефект признан некритичным — выезд разрешён"
	}
	t.StatusID = to.Id
	if _, err := r.log(ctx, t.ID, "transition", "Решение по дефекту: "+from.Name+" → "+to.Name+". "+decision, actor{label: actorProcess}, ""); err != nil {
		return err
	}
	if err := r.saveTask(ctx, t); err != nil {
		return err
	}
	_, err = r.publish(ctx, evTransitioned, aggTask, t.ID, map[string]any{keyTaskID: t.ID, keyProjectID: p.ID, "statusId": t.StatusID})
	return err
}

// defectVersion is the live task of the defect id, its project and the version of its workflow (nil — none).
func (r *request) defectVersion(ctx context.Context, id uuid.UUID) (*task, *project, *version, error) {
	t, err := r.sourceTask(ctx, id)
	if err != nil || t == nil {
		return nil, nil, nil, err
	}
	p, err := r.project(ctx, t.Project)
	if err != nil || p == nil {
		return nil, nil, nil, err
	}
	v, err := r.versionOf(ctx, p, t)
	return t, p, v, err
}

// doneStatus is the status «Готово» of a version, else its first status of the category «Готово».
func doneStatus(v *version) tasksapi.TaskWorkflowStatus {
	var first tasksapi.TaskWorkflowStatus
	for _, s := range v.Statuses {
		if s.Category != tasksapi.Done {
			continue
		}
		if s.Name == stDone {
			return s
		}
		if first.Id == "" {
			first = s
		}
	}
	return first
}
