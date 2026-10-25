package main

// W4.24 (D-30, D-29 комплекта; критерий этапа 4 «Осмотр → ответ формы → задача менеджеру»): the worker writes the
// inspection of a trip as a response of «Осмотр машины» with its rules (forms.InspectionResponses on
// fleet.inspection.submitted.v1) and makes its blocking defect one task (tasks.InspectionDefects) — the module of
// forms with the ports of the tasks and of the knowledge base as cmd/api wires them (cmd/api/forms.go).
import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	formsapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
	"github.com/ortus/ortus-crm/backend/internal/modules/forms"
	"github.com/ortus/ortus-crm/backend/internal/modules/knowledge"
	"github.com/ortus/ortus-crm/backend/internal/modules/tasks"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// inspectionDeps are what the consumer of the inspections needs of the worker: the control DB (memberships, owner
// bindings, recipients), the tenant pools (role ortus_worker), the evaluator with the projects of tasks, the inbox and
// the clock of the application.
type inspectionDeps struct {
	control  *pgxpool.Pool
	pools    *tenantctx.Pools
	ev       *authz.Evaluator
	audience inbox.Audience
	now      func() time.Time
}

// registerInspections adds the consumer of fleet.inspection.submitted.v1 to reg.
func registerInspections(reg *events.Registry, d inspectionDeps) {
	newInspectionResponses(d).Register(reg)
}

// newInspectionResponses is the consumer of the inspections over the services of the modules of the worker.
func newInspectionResponses(d inspectionDeps) forms.InspectionResponses {
	var db forms.ControlDB // a nil pool stays a nil interface
	if d.control != nil {
		db = d.control
	}
	taskSvc := &tasks.Service{Pools: d.pools, Authz: d.ev, Directory: tasks.ControlDirectory{DB: d.control}, Audience: d.audience, Now: d.now}
	s := &forms.Service{Pools: d.pools, Directory: forms.ControlDirectory{DB: db}, Tasks: formTasks{S: taskSvc},
		Knowledge: formKnowledge{S: newKnowledge(d.pools, d.control, d.audience, d.now)}, Audience: d.audience, Now: d.now}
	return forms.InspectionResponses{Service: s, Defects: taskSvc}
}

// formTasks adapts the port of the module of tasks (tasks/forms_port.go) to forms.Tasks, as cmd/api does.
type formTasks struct{ S *tasks.Service }

var _ forms.Tasks = formTasks{}

// CreateFormTask implements forms.Tasks.
func (a formTasks) CreateFormTask(ctx context.Context, tx pgx.Tx, tenant uuid.UUID, t forms.FormTask) (forms.TaskResult, error) {
	r, err := a.S.CreateFormTask(ctx, tx, tenant, tasks.FormTask{Project: t.Project, Author: t.Author, Assignee: t.Assignee,
		AuthorOwner: t.AuthorOwner, AuthorName: t.AuthorName, Title: t.Title, Description: t.Description, Response: t.Response,
		Origin: t.Origin, Priority: t.Priority, Checklist: t.Checklist, Related: taskRefs(t.Related)})
	return forms.TaskResult{ID: r.ID, Key: r.Key, Status: r.Status, Assigned: r.Assigned, Refused: r.Refused}, err
}

// MayCreate implements forms.Tasks.
func (a formTasks) MayCreate(ctx context.Context, tx pgx.Tx, tenant, member uuid.UUID, owner bool, project uuid.UUID) (bool, error) {
	return a.S.MayCreate(ctx, tx, tenant, member, owner, project)
}

// Keys implements forms.Tasks.
func (a formTasks) Keys(ctx context.Context, tx pgx.Tx, _ uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]string, error) {
	return a.S.FormTaskKeys(ctx, tx, ids)
}

// taskRefs are the related objects of a task of a form in the types of the tasks.
func taskRefs(refs []formsapi.ObjectRef) []tasksapi.ObjectRef {
	out := make([]tasksapi.ObjectRef, 0, len(refs))
	for _, r := range refs {
		out = append(out, tasksapi.ObjectRef{ModuleKey: r.ModuleKey, EntityType: r.EntityType, EntityId: r.EntityId})
	}
	return out
}

// formKnowledge adapts the port of the knowledge base (knowledge/forms_port.go) to forms.Knowledge, as cmd/api does.
type formKnowledge struct{ S *knowledge.Service }

var _ forms.Knowledge = formKnowledge{}

// Nodes implements forms.Knowledge.
func (a formKnowledge) Nodes(ctx context.Context, tx pgx.Tx, tenant uuid.UUID, v forms.Viewer, ids []uuid.UUID) (map[uuid.UUID]forms.KBNode, error) {
	ns, err := a.S.FormNodes(ctx, tx, tenant, v.Member, v.Owner, ids)
	if err != nil {
		return nil, err
	}
	out := make(map[uuid.UUID]forms.KBNode, len(ns))
	for id, n := range ns {
		x := forms.KBNode{ID: n.ID, Title: n.Title, Visible: n.Visible, AllEmployees: n.AllEmployees}
		for _, t := range n.Tables {
			x.Tables = append(x.Tables, forms.KBTable{ID: t.ID, Title: t.Title, Columns: t.Columns})
		}
		out[id] = x
	}
	return out, nil
}

// Write implements forms.Knowledge.
func (a formKnowledge) Write(ctx context.Context, tx pgx.Tx, tenant uuid.UUID, rec forms.KBRecord) (forms.KBResult, error) {
	lines := make([]knowledge.FormLine, 0, len(rec.Lines))
	for _, l := range rec.Lines {
		lines = append(lines, knowledge.FormLine{Name: l.Name, Value: l.Value})
	}
	r, err := a.S.FormWrite(ctx, tx, tenant, knowledge.FormRecord{Author: rec.Author.Member, AuthorOwner: rec.Author.Owner,
		AuthorName: rec.AuthorName, Node: rec.Node, Table: rec.Table, Bottom: rec.Bottom, Head: rec.Head, Lines: lines, Cells: rec.Cells,
		Form: rec.Form, Response: rec.Response, Version: rec.Version, At: rec.At})
	return forms.KBResult{Text: r.Text, Refused: r.Refused}, err
}
