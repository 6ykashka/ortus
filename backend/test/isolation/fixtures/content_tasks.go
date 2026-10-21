package fixtures

import (
	"crypto/sha256"
	"fmt"
	"mime"
	"slices"
)

// Content of «Задачи и проекты» (W4.11, integratorNotes of W4.03 п. 3): the rows of tasks.projects of the object
// projects of the tenant, tasks and a rule of automation. The workflow of a project is v1 of «С согласованием»
// (buildWf of the prototype) — the fixtures do not import the module (its tests load them).

// Reference kinds of the content of tasks.
const (
	refTask       = "task"
	refAutomation = "automation"
)

// Levels of access of a project (tasks.projects.access).
const (
	LevelOpen    = "open"
	LevelLimited = "limited"
	LevelClosed  = "closed"
)

// ProjectDef is the row of tasks.projects of an object project of the tenant (ObjectDef of kind project): the key of
// its tasks (2–6 capital letters), its level of access and its area — a unit key ("" — the whole organization).
type ProjectDef struct {
	Object, Key, Level, Unit string
}

// TaskDef is a task of a project: its status of the workflow (s1…s5), the assignee and the author (actors with a
// membership in the tenant; "" — none). Reference task:<tenant>.<key>.
type TaskDef struct {
	Key, Project, Title, Status, Assignee, Author string
}

// RuleDef is a rule of automation of a project («Задача создана → комментарий») on behalf of Author. Reference
// automation:<tenant>.<key>.
type RuleDef struct {
	Key, Project, Name, Author string
}

// approvalStatuses and approvalTransitions are buildWf('approval') of the prototype (models.js:185–193) in the JSON of
// the contract (TaskWorkflowStatus, TaskWorkflowTransition).
const (
	approvalStatuses = `[{"id":"s1","name":"Новая","category":"todo"},{"id":"s2","name":"В работе","category":"progress"},
{"id":"s3","name":"На проверке","category":"progress"},{"id":"s4","name":"Готово","category":"done"},
{"id":"s5","name":"Отменена","category":"done"}]`
	approvalTransitions = `[
{"key":"t1","name":"Взять в работу","from":["s1"],"to":"s2","who":[],"notAuthor":false,"commentRequired":false,"checklistClosed":false,"childrenDone":false,"assignAuthor":false},
{"key":"t2","name":"На проверку","from":["s2"],"to":"s3","who":[],"notAuthor":false,"commentRequired":false,"checklistClosed":false,"childrenDone":false,"assignAuthor":false},
{"key":"t3","name":"Согласовать","from":["s3"],"to":"s4","who":[],"notAuthor":true,"approval":{"mode":"any","rejectTo":"s2"},"commentRequired":false,"checklistClosed":true,"childrenDone":true,"assignAuthor":true},
{"key":"t5","name":"Отменить","from":["*"],"to":"s5","who":["project_manager"],"notAuthor":false,"commentRequired":true,"checklistClosed":false,"childrenDone":false,"assignAuthor":false}]`
)

// taskContent is the content of tasks of every tenant (tenant B mirrors tenant A): «Автопарк» of Москва-1 is a limited
// project with three tasks — one assigned to the driver (scope self), one waiting for approval, one of the project
// lead — and a rule; «Стройка» is a closed project nobody has a role in (TP-03: the owner does not see it either).
func taskContent(t string) ([]ProjectDef, []TaskDef, []RuleDef) {
	driver, lead := t+".driver-msk1", "a.project-lead"
	if t == TenantB {
		lead = "b.manager-msk1"
	}
	return []ProjectDef{
			{Object: projectFleet, Key: "АВТ", Level: LevelLimited, Unit: uMsk1},
			{Object: projectBuild, Key: "СТР", Level: LevelClosed, Unit: uMsk1},
		}, []TaskDef{
			{Key: "fleet-1", Project: projectFleet, Title: "Проверить тормоза", Status: "s1", Assignee: driver, Author: lead},
			{Key: "fleet-2", Project: projectFleet, Title: "Заменить шины", Status: "s3", Assignee: lead, Author: lead},
			{Key: "build-1", Project: projectBuild, Title: "Залить фундамент", Status: "s2", Assignee: driver, Author: lead},
		}, []RuleDef{
			{Key: "fleet-rule", Project: projectFleet, Name: "Новая задача → комментарий", Author: lead},
		}
}

// taskFiles are the attachments of the tasks of tenant t (W4.11 возврат 1): one on fleet-1 of «Автопарк» and one on
// build-1 of the closed «Стройка» — the rows of listFiles and getFile read a file as its task.
func taskFiles() []FileDef {
	return []FileDef{
		{Key: "fleet-1", Task: "fleet-1", Name: "Акт проверки тормозов.pdf"},
		{Key: "build-1", Task: "build-1", Name: "Смета фундамента.pdf"},
	}
}

// validateTasks checks the content of tasks of t: projects of the object projects with a known level and unit, tasks
// and rules of those projects, people with a membership in t.
func (c Catalog) validateTasks(t TenantDef, fail failFunc) {
	validateProjects(t, fail)
	member := func(actor string) bool { return actor == "" || c.hasRef(memberRef(refPerson, actor, t.Key)) }
	hasProject := func(key string) bool {
		return slices.ContainsFunc(t.Content.Projects, func(p ProjectDef) bool { return p.Object == key })
	}
	for _, x := range t.Content.Tasks {
		if !hasProject(x.Project) || !member(x.Assignee) || !member(x.Author) || x.Title == "" {
			fail("task %s.%s: unknown project or people, or no title", t.Key, x.Key)
		}
	}
	for _, r := range t.Content.Rules {
		if !hasProject(r.Project) || !member(r.Author) || r.Author == "" {
			fail("rule %s.%s: unknown project or author", t.Key, r.Key)
		}
	}
}

// validateProjects checks the projects of t: of the object projects, with a known level and unit.
func validateProjects(t TenantDef, fail failFunc) {
	for _, p := range t.Content.Projects {
		switch {
		case !t.hasObject(ObjectProject, p.Object):
			fail("project %s.%s: no object project", t.Key, p.Object)
		case !slices.Contains([]string{LevelOpen, LevelLimited, LevelClosed}, p.Level):
			fail("project %s.%s: level %q", t.Key, p.Object, p.Level)
		case p.Unit != "" && !t.hasUnit(p.Unit):
			fail("project %s.%s: unknown unit %q", t.Key, p.Object, p.Unit)
		}
	}
}

// tasks writes the projects, their v1, the tasks and the rules of the content.
func (l *tenantLoader) tasks() error {
	for _, p := range l.t.Content.Projects {
		if err := l.project(p); err != nil {
			return err
		}
	}
	numbers := map[string]int{}
	for _, x := range l.t.Content.Tasks {
		numbers[x.Project]++
		if err := l.exec("task "+x.Key, `insert into tasks.tasks (id, project_id, number, title, status_id, workflow_version,
			assignee_id, author_id, created_at, updated_at)
			values ($1, $2, $3, $4, $5, 1, $6, $7, $8, $8)`,
			l.contentID(refTask, x.Key), l.objectID(x.Project), 100+numbers[x.Project], x.Title, x.Status,
			l.personOrNil(x.Assignee), l.personOrNil(x.Author), l.now.Add(-contentAge)); err != nil {
			return err
		}
	}
	for p, n := range numbers {
		if err := l.exec("task_seq "+p, `update tasks.projects set task_seq = $2 where id = $1`, l.objectID(p), 100+n); err != nil {
			return err
		}
	}
	for _, r := range l.t.Content.Rules {
		if err := l.exec("rule "+r.Key, `insert into tasks.automations (id, project_id, name, trigger_kind, action_kind,
			action_text, enabled, author_id) values ($1, $2, $3, 'created', 'comment', 'Проверьте исполнителя', true, $4)`,
			l.contentID(refAutomation, r.Key), l.objectID(r.Project), r.Name, l.personID(r.Author)); err != nil {
			return err
		}
	}
	return l.taskFiles()
}

// taskFiles writes the attachments of tasks: checked PDFs of core.files (purpose task_attachment, parent tasks/task)
// attached to their task (tasks.task_files) by the owner. Like the photos of vehicles, the objects are not in a
// storage.
func (l *tenantLoader) taskFiles() error {
	at := l.now.Add(-contentAge)
	for _, f := range l.t.Content.Files {
		if f.Task == "" {
			continue
		}
		id, task := l.contentID(refFile, f.Key), l.contentID(refTask, f.Task)
		key := fmt.Sprintf("isolation/%s/task-%s.pdf", l.t.Key, f.Key)
		sum := sha256.Sum256([]byte(key))
		if err := l.exec("file "+f.Key, `insert into files.objects
			(id, object_key, state, purpose, owner_type, owner_id, declared_mime, detected_mime, bytes, sha256,
			 uploaded_by, created_at, ready_at)
			values ($1, $2, 'ready', 'task_attachment', 'tasks.task', $3, $4, 'application/pdf', 2048, $5, $6, $7, $7)`,
			id, key, task, mime.FormatMediaType("application/pdf", map[string]string{"name": f.Name}), sum[:], l.owner, at); err != nil {
			return err
		}
		if err := l.exec("attachment "+f.Key, `insert into tasks.task_files (task_id, file_id, attached_by, attached_at)
			values ($1, $2, $3, $4)`, task, id, l.owner, at); err != nil {
			return err
		}
	}
	return nil
}

func (l *tenantLoader) project(p ProjectDef) error {
	var unit any
	if p.Unit != "" {
		unit = l.unitID(p.Unit)
	}
	name := p.Object
	for _, o := range l.t.Objects {
		if o.Kind == ObjectProject && o.Key == p.Object {
			name = o.Name
		}
	}
	id := l.objectID(p.Object)
	if err := l.exec("project "+p.Object, `insert into tasks.projects (id, key, name, org_unit_id, access, flow, workflow_key,
		owner_id, current_version, created_at, updated_at) values ($1, $2, $3, $4, $5, 'tasks', 'approval', $6, 1, $7, $7)`,
		id, p.Key, name, unit, p.Level, l.owner, l.now.Add(-contentAge)); err != nil {
		return err
	}
	return l.exec("workflow of "+p.Object, `insert into tasks.workflow_versions (project_id, version, statuses,
		transitions, published_at, published_by) values ($1, 1, $2::jsonb, $3::jsonb, $4, $5)`,
		id, approvalStatuses, approvalTransitions, l.now.Add(-contentAge), l.owner)
}

func (l *tenantLoader) objectID(key string) any { return nameID(localRef(ObjectProject, l.t.Key, key)) }

func (l *tenantLoader) personOrNil(actor string) any {
	if actor == "" {
		return nil
	}
	return l.personID(actor)
}
