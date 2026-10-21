package tasks

import (
	"slices"
	"strconv"
	"time"

	"github.com/google/uuid"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
)

// Actions of core.tasks (api/permissions.yaml) in the order of the catalog.
const (
	actProjectsRead   = "tasks.projects.read"
	actProjectsManage = "tasks.projects.manage"
	actRead           = "tasks.read"
	actCreate         = "tasks.create"
	actUpdate         = "tasks.update"
	actTransition     = "tasks.transition"
	actApprove        = "tasks.approve"
	actMembersManage  = "tasks.members.manage"
	actWorkflowManage = "tasks.workflow.manage"
	actAutomation     = "tasks.automation.manage"
	actMembersRead    = "members.read"
	actFilesRead      = "files.read"
)

// taskKeys are the actions of core.tasks in the order of the catalog (the chips «Что может»).
var taskKeys = []string{
	actProjectsRead, actProjectsManage, actRead, actCreate, actUpdate, actTransition, actApprove,
	actMembersManage, actWorkflowManage, actAutomation,
}

// readKeys are the actions an inherited role keeps in a limited project («только чтение»).
var readKeys = []string{actProjectsRead, actRead}

// ContainerReads are the actions a territorial grant keeps in a limited project for the evaluator
// (authz.Evaluator.ContainerReads[project]): the reads of the project and its tasks and the files of the tasks
// («Доступ к файлам — как к задаче»).
func ContainerReads() []string { return []string{actProjectsRead, actRead, actFilesRead} }

func isTaskKey(a string) bool { return slices.Contains(taskKeys, a) }

// verbOf is the verb of the prototype (VERB_LABEL) of an action of the catalog — «роль «X» не даёт «Y»».
var verbOf = map[string]string{
	actProjectsRead:   "Читать",
	actRead:           "Читать",
	actCreate:         "Создавать",
	actUpdate:         "Менять статус",
	actTransition:     "Менять статус",
	actApprove:        "Согласовывать",
	actProjectsManage: verbManage,
	actMembersManage:  verbManage,
	actWorkflowManage: verbManage,
	actAutomation:     verbManage,
}

func verb(action string) string {
	if v, ok := verbOf[action]; ok {
		return v
	}
	return action
}

// Levels of access of a project (tasks.projects.access; a funnel has none).
const (
	levelOpen    = "open"
	levelLimited = "limited"
	levelClosed  = "closed"
)

// Flows of a project.
const (
	flowTasks = "tasks"
	flowLeads = "leads"
)

// Status categories.
const (
	catTodo     = string(tasksapi.Todo)
	catProgress = string(tasksapi.Progress)
	catDone     = string(tasksapi.Done)
)

// Priorities and their labels («Срочно», «Высокий», «Обычный», «Низкий»).
const (
	prioUrgent = string(tasksapi.Urgent)
	prioHigh   = string(tasksapi.High)
	prioNormal = string(tasksapi.Normal)
	prioLow    = string(tasksapi.Low)
)

var priorityLabel = map[string]string{prioUrgent: "Срочно", prioHigh: "Высокий", prioNormal: "Обычный", prioLow: "Низкий"}

// «Кто может» of a transition (the contract) and the action of a role of the project that stands for it (WHO_VERB).
const (
	whoManager  = string(tasksapi.ProjectManager)
	whoApprover = string(tasksapi.ProjectApprover)
	whoExecutor = string(tasksapi.ProjectExecutor)
	whoAssignee = string(tasksapi.Assignee)
	whoAuthor   = string(tasksapi.Author)
)

var whoAction = map[string]string{whoManager: actWorkflowManage, whoApprover: actApprove, whoExecutor: actTransition}

var whoLabel = map[string]string{
	whoManager:  "руководитель проекта",
	whoApprover: "согласующий",
	whoExecutor: "исполнитель по роли",
	whoAssignee: "исполнитель задачи",
	whoAuthor:   "автор задачи",
}

// Templates of the roles of projects (api/permissions.yaml, default_scope project; Q-W4.00-tasks-17) in the order of
// «Роли проекта»: «Руководитель проекта», «Согласующий», «Исполнитель», «Наблюдатель».
const (
	tmplManager  = "project_manager"
	tmplApprover = "project_approver"
	tmplExecutor = "project_executor"
	tmplViewer   = "project_viewer"
)

var projectTemplates = []string{tmplManager, tmplApprover, tmplExecutor, tmplViewer}

// Problem codes of the module (api/errors.yaml) and the reasons of invalid_transition.
const (
	codeValidation   = "validation_failed"
	codeTransition   = "invalid_transition"
	codeForbidden    = "forbidden_action"
	codeNotFound     = "not_found"
	codeDelegation   = "delegation_exceeds_grant"
	codeRevRequired  = "revision_required"
	codeRevMismatch  = "revision_mismatch"
	codeMalformed    = "malformed_request"
	reasonNotIn      = "not_in_status"
	reasonChecklist  = "checklist_open"
	reasonChildren   = "children_open"
	reasonAuthor     = "author_forbidden"
	reasonVoted      = "already_voted"
	reasonDocRoute   = "doc_route"
	reasonExists     = "workflow_exists"
	reasonFunnel     = "funnel_fixed"
	actorSystem      = "system"
	actorProcess     = "process"
	actorAutomation  = "automation"
	labelSystem      = "Система"
	labelProcess     = "Процесс"
	labelAutomation  = "Автоматизация"
	runsKept         = 30
	descriptionMax   = 5000
	filesPerTask     = 30
	fileMaxBytes     = 20 * 1048576
	maxLevels        = 3
	labelsMax        = 10
	seqStart         = 100
	unknownName      = "—"
	textStale        = "Данные изменились. Обновите страницу и повторите."
	textTaskNotFound = "Задача не найдена"
	textNoProject    = "Проект не найден"
	textNoWorkflow   = "Процесс не настроен"
	textNoRule       = "Правило не найдено"
	textNoItem       = "Пункт чек-листа не найден"
	textNoDraft      = "Черновика нет"
	textFileGone     = "Файл уже удалён"
	textNoMember     = "Сотрудник не найден"
)

// Names of the statuses of the templates and the stages of the funnel (models.js WORKFLOWS, buildWf) and the verb of
// the settings of a project.
const (
	stNew       = "Новая"
	stProgress  = "В работе"
	stDone      = "Готово"
	stCancelled = "Отменена"
	stMeasure   = "Замер"
	stEstimate  = "Смета"
	stContract  = "Договор"
	stObject    = "Объект"
	stRejected  = "Отказ"
	verbManage  = "Настраивать"
)

// funnelIDs are the ids of the stages of the funnel «Заявки» (WORKFLOWS.leads, MSW FUNNEL_IDS).
var funnelIDs = map[string]string{
	stNew:      "new",
	stMeasure:  "measure",
	stEstimate: "estimate",
	stContract: "contract",
	stObject:   "object",
	stRejected: "rejected",
}

// funnelStages and funnelFlow are the old board «Заявки» (models.js WORKFLOWS.leads).
var (
	funnelStages = []string{stNew, stMeasure, stEstimate, stContract, stObject}
	funnelFlow   = []struct {
		from string
		to   []string
	}{
		{stNew, []string{stMeasure, stRejected}},
		{stMeasure, []string{stEstimate, stRejected}},
		{stEstimate, []string{stContract, stMeasure, stRejected}},
		{stContract, []string{stObject, stEstimate, stRejected}},
		{stObject, nil},
		{stRejected, []string{stNew}},
	}
)

// project is a row of tasks.projects.
type project struct {
	ID               uuid.UUID
	Key, Name        string
	Unit             *uuid.UUID // nil — the whole organization
	Access           string     // "" — a funnel
	Flow             string
	WorkflowKey      string
	Owner            uuid.UUID
	CurrentVersion   *int // nil — no workflow
	WorkflowRevision int64
	TaskSeq          int
	Revision         int64
	CreatedAt        time.Time
}

func (p *project) funnel() bool { return p.Flow == flowLeads }

// level is the level of access the evaluator sees: a funnel is open (MSW accessOf: inherited roles keep every action).
func (p *project) level() string {
	if p.funnel() || p.Access == "" {
		return levelOpen
	}
	return p.Access
}

// version is a published version of the workflow of a project (tasks.workflow_versions).
type version struct {
	Number      int
	Statuses    []tasksapi.TaskWorkflowStatus
	Transitions []tasksapi.TaskWorkflowTransition
	PublishedAt time.Time
	PublishedBy *uuid.UUID
}

// draft is the draft of the workflow of a project (tasks.workflow_drafts).
type draft struct {
	Base        int
	Statuses    []tasksapi.TaskWorkflowStatus
	Transitions []tasksapi.TaskWorkflowTransition
	UpdatedAt   time.Time
	UpdatedBy   *uuid.UUID
}

// task is a row of tasks.tasks.
type task struct {
	ID              uuid.UUID
	Project         uuid.UUID
	Number          int
	LegacyKey       *string
	Title           string
	Description     string
	StatusID        string
	WorkflowVersion *int
	Priority        string
	Labels          []string
	Assignee        *uuid.UUID
	Author          *uuid.UUID
	DueAt           *time.Time
	Parent          *uuid.UUID
	Checklist       []tasksapi.TaskChecklistItem
	Related         []tasksapi.ObjectRef
	DocRoute        *tasksapi.TaskDocRoute
	Revision        int64
	CreatedAt       time.Time
	UpdatedAt       time.Time
	Deleted         bool
	source          sourceRef // the object the task was made for (a defect of S2-17); written once
}

// sourceRef is the source of a task (tasks.tasks.source_*): module, entity type and id; zero — none.
type sourceRef struct {
	module *string
	typ    *string
	id     *uuid.UUID
}

// keyOf is the human number of a task: «T-65» of the seed or «{KEY}-{N}».
func keyOf(t *task, p *project) string {
	if t.LegacyKey != nil {
		return *t.LegacyKey
	}
	return p.Key + "-" + strconv.Itoa(t.Number)
}

func (t *task) assignedTo(id uuid.UUID) bool { return t.Assignee != nil && *t.Assignee == id }

func (t *task) authoredBy(id uuid.UUID) bool { return t.Author != nil && *t.Author == id }

// round is an open round of approval of a task (tasks.approval_rounds) with its votes.
type round struct {
	ID            uuid.UUID
	TransitionKey string
	Version       int
	Mode          string
	Approvers     []uuid.UUID // fixed for «нужны все» (Q-W4.00-tasks-9); empty for «достаточно одного»
	Votes         []vote
}

type vote struct {
	Member uuid.UUID
	At     time.Time
}

func (r *round) voted(id uuid.UUID) bool {
	for _, v := range r.Votes {
		if v.Member == id {
			return true
		}
	}
	return false
}

// automation is a row of tasks.automations.
type automation struct {
	ID          uuid.UUID
	Project     uuid.UUID
	Name        string
	Trigger     string // created | status_entered
	TriggerTo   *string
	CondPrio    *string
	ActionKind  string // assign | set_priority | comment
	ActionWho   *uuid.UUID
	ActionPrio  *string
	ActionText  *string
	Enabled     bool
	Version     int
	Author      uuid.UUID
	RunCount    int
	Revision    int64
	CreatedAt   time.Time
	UpdatedAt   time.Time
	AuthorLabel string // the name of the author (DTO)
}
