// Package tasks is the provider of the dataset of the module of tasks for «Данные» (W4.80; the FollowUp П-1 of the
// critique of the exit of stage 4): «Задачи» of the prototype (dataVM :4189 of design-2026-10-19, SETS.tasks) — the
// columns «Задача» (KEY-N · название), «Исполнитель», «Статус», «Срок»; the row opens the card of the task. The rows
// are those of listTasks (W4.11): the scope predicate of tasks.read over the columns of a task — the unit of its
// project, its project (a role of the project replaces the inherited ones), its assignee (scope self) and the level
// of its project (TP-03: a closed project is shut to the owner too; a limited one keeps the reads, which the module of
// tasks registers in the evaluator — tasks.RegisterContainer). The module of tasks is a module of the core: its
// dataset exists in every tenant.
package tasks

import (
	"github.com/ortus/ortus-crm/backend/internal/modules/data" //nolint:depguard // the registry this provider plugs into
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
)

// ModuleKey is the key of the module of tasks (a module of the core, modulesreg.CoreKeys).
const ModuleKey = "tasks"

// Tasks is the dataset of the module (Dataset.id).
const Tasks = "tasks"

// Provider registers the dataset of tasks.
type Provider struct{}

var (
	_ data.Provider = Provider{}
	_ data.Core     = Provider{}
)

// Module implements data.Provider.
func (Provider) Module() string { return ModuleKey }

// Core implements data.Core: the module of tasks is never installed.
func (Provider) Core() bool { return true }

// Datasets implements data.Provider: «Задачи».
func (Provider) Datasets() []data.Spec { return []data.Spec{tasks()} }

// levelSQL is the level of the project of a row for the evaluator: a funnel is open (taskColumns of the module of
// tasks, MSW accessOf).
const levelSQL = "(case when p.flow = 'leads' then 'open' else p.access end)"

// columns are taskColumns of the module of tasks (tasks_ops.go): the rows of «Задачи» are those of listTasks.
var columns = authz.Columns{
	Unit:      "p.org_unit_id",
	Objects:   map[string]string{authz.KindProject: "t.project_id"},
	Persons:   []string{"t.assignee_id"},
	Container: authz.ProjectColumns(levelSQL),
}

// statusSQL is the name of the status of a task in the version of the workflow it follows (its own, else the published
// one; a funnel has its fixed v1), the published version as a fallback, the code itself without a name (statusOf of
// the module of tasks).
const statusSQL = `coalesce(
  (select s->>'name' from tasks.workflow_versions w cross join lateral jsonb_array_elements(w.statuses) s
    where w.project_id = t.project_id and s->>'id' = t.status_id
      and w.version = case when p.flow = 'leads' then 1 else coalesce(t.workflow_version, p.current_version) end limit 1),
  (select s->>'name' from tasks.workflow_versions w cross join lateral jsonb_array_elements(w.statuses) s
    where w.project_id = t.project_id and s->>'id' = t.status_id
      and w.version = case when p.flow = 'leads' then 1 else p.current_version end limit 1),
  t.status_id)`

// dueSQL is the day of the due by Moscow: the due of a card is the end of a day — the start of the next one (dueAtOf of
// the page of tasks), so the day is that of the moment a millisecond earlier.
const dueSQL = `((t.due_at - interval '1 millisecond') at time zone 'Europe/Moscow')::date`

func tasks() data.Spec {
	return data.Spec{
		ID: Tasks, Name: "Задачи", Permission: "tasks.read", EntityType: "task",
		From: `tasks.tasks t
  join tasks.projects p on p.id = t.project_id
  left join people.person_profiles a on a.id = t.assignee_id`,
		// A deleted task and the tasks of an archived project are not in listTasks.
		Where:   "t.deleted_at is null and p.status = 'active'",
		Columns: columns, RecordID: "t.id", Order: []string{"p.key", "t.number", "t.id"},
		Fields: []data.Field{
			{Key: "task", Label: "Задача", Type: data.Text, SQL: "coalesce(t.legacy_key, p.key || '-' || t.number) || ' · ' || t.title"},
			{Key: "assignee", Label: "Исполнитель", Type: data.Text, Nullable: true, SQL: "a.full_name"},
			{Key: "status", Label: "Статус", Type: data.Text, SQL: statusSQL},
			{Key: "due", Label: "Срок", Type: data.Date, Nullable: true, SQL: dueSQL},
		},
		DefaultSort: []data.Sort{{Field: "task"}},
	}
}
