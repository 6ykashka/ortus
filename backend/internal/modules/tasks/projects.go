package tasks

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"slices"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W4.11: shared command helpers of the modules (Audit, Complete; Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/realtime"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Texts of the projects (api.js:644–675 of the prototype).
const (
	textNoCreate     = "Создавать проекты может роль с правом «Задачи · Настраивать»"
	textNameShort    = "Название — не короче 3 символов"
	textKeyPattern   = "Ключ — 2–6 заглавных букв или цифр, первая — буква"
	textNoUnit       = "Выберите область проекта"
	textNoCopy       = "Выберите проект, процесс которого копировать"
	textFunnelFixed  = "Этапы воронки «Заявки» фиксированы"
	textFunnelLevel  = "У воронки «Заявки» нет уровня доступа"
	textHasWorkflow  = "У проекта уже есть процесс"
	textRequired     = "Заполните поле"
	textEnum         = "Недопустимое значение"
	textLength       = "Недопустимая длина"
	targetProject    = "tasks.project"
	nameMin, nameMax = 3, 150
	// pgUniqueViolation is SQLSTATE unique_violation.
	pgUniqueViolation = "23505"
)

// keyRE is KEY_RE of the prototype: 2–6 capital letters (Latin or Cyrillic) or digits, the first a letter.
var keyRE = regexp.MustCompile(`^[A-ZА-ЯЁ][A-ZА-ЯЁ0-9]{1,5}$`)

var levels = []string{levelOpen, levelLimited, levelClosed}

// Projects lists the projects the requesting member sees (listTaskProjects): its access with «Читать» — a role of
// the project, a role of the area by the level, the system role of the owner except a closed project (TP-03).
func (s *Service) Projects(ctx context.Context, tc tenantctx.TenantContext, cursor *string, limit *int) (tasksapi.ProjectPage, error) {
	var out tasksapi.ProjectPage
	err := s.run(ctx, tc, false, func(r *request) error {
		ps, err := r.loadProjects(ctx)
		if err != nil {
			return err
		}
		items := []tasksapi.Project{}
		for _, p := range ps {
			a, err := r.access(ctx, p)
			if err != nil {
				return err
			}
			if !a.has(actProjectsRead) {
				continue
			}
			dto, err := r.projectDTO(ctx, p)
			if err != nil {
				return err
			}
			items = append(items, dto)
		}
		out.Items, out.NextCursor, err = pageOf(items, func(p tasksapi.Project) string { return p.Id.String() }, cursor, limit)
		return err
	})
	return out, err
}

// Project is the header of a project (getTaskProject); a project without the access of the member is 404.
func (s *Service) Project(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (tasksapi.Project, error) {
	var out tasksapi.Project
	err := s.run(ctx, tc, false, func(r *request) error {
		p, err := r.visibleProject(ctx, id)
		if err != nil {
			return err
		}
		out, err = r.projectDTO(ctx, p)
		return err
	})
	return out, err
}

// mayCreate reports whether m may create a project in unit (nil — the whole organization): the owner, or a grant
// with tasks.projects.manage over the organization or a unit covering unit (PD-53: a role of a project does not).
func mayCreate(m *member, unit *uuid.UUID, path []uuid.UUID) bool {
	if m.Owner {
		return true
	}
	return slices.ContainsFunc(m.Grants, func(g grant) bool {
		if !g.has(actProjectsManage) {
			return false
		}
		return g.Kind == kindTenant || (g.Kind == kindUnit && unit != nil && (g.Ref == *unit || (g.Descendants && slices.Contains(path, g.Ref))))
	})
}

// CreateProject creates a project from a template (createTaskProject, createProject of the prototype): the creator
// becomes its project manager (an assignment of the template project_manager with the scope project).
func (s *Service) CreateProject(ctx context.Context, tc tenantctx.TenantContext, b tasksapi.ProjectCreate) (tasksapi.Project, error) {
	var out tasksapi.Project
	err := s.run(ctx, tc, true, func(r *request) error {
		p, wf, copied, err := r.newProject(ctx, b)
		if err != nil {
			return err
		}
		if err := r.insertProject(ctx, p, wf, copied); err != nil {
			return err
		}
		if err := r.assignCreator(ctx, p); err != nil {
			return err
		}
		ev, err := r.publish(ctx, evProjectCreated, aggProject, p.ID, map[string]any{keyProjectID: p.ID, "key": p.Key})
		if err != nil {
			return err
		}
		r.toOwners("project.created", "Создан проект «"+p.Name+"» ("+p.Key+")", ev)
		if err := kit.Audit(ctx, r.tx, audit.Event{Action: "tasks.project.create", TargetType: targetProject, TargetID: p.ID,
			UnitID: unitOrNil(p.Unit), Diff: map[string]any{"key": p.Key, "access": p.Access, "workflowKey": p.WorkflowKey}}); err != nil {
			return err
		}
		r.forget()
		r.projects = nil
		fresh, err := r.project(ctx, p.ID)
		if err != nil {
			return err
		}
		if out, err = r.projectDTO(ctx, fresh); err != nil {
			return err
		}
		return kit.Complete(ctx, r.tx, http.StatusCreated, etag(out.Revision), out)
	})
	return out, err
}

func unitOrNil(u *uuid.UUID) uuid.UUID {
	if u == nil {
		return uuid.Nil
	}
	return *u
}

// newProject checks the body of createTaskProject in the order of the prototype and returns the project, its v1 and
// the rules to copy (disabled).
func (r *request) newProject(ctx context.Context, b tasksapi.ProjectCreate) (*project, workflow, []*automation, error) {
	if err := r.loadUnits(ctx); err != nil {
		return nil, workflow{}, nil, err
	}
	if b.OrgUnitId != nil {
		if _, ok := r.unitName[*b.OrgUnitId]; !ok {
			return nil, workflow{}, nil, invalid("orgUnitId", "required", textNoUnit)
		}
	}
	me, err := r.me(ctx)
	if err != nil {
		return nil, workflow{}, nil, err
	}
	path, err := r.unitPath(ctx, b.OrgUnitId)
	if err != nil {
		return nil, workflow{}, nil, err
	}
	if !mayCreate(me, b.OrgUnitId, path) {
		return nil, workflow{}, nil, forbidden(textNoCreate)
	}
	name, err := projectName(b.Name)
	if err != nil {
		return nil, workflow{}, nil, err
	}
	key, err := r.freeKey(ctx, b.Key)
	if err != nil {
		return nil, workflow{}, nil, err
	}
	level := levelLimited
	if b.Access != nil {
		if level = string(*b.Access); !slices.Contains(levels, level) {
			return nil, workflow{}, nil, invalid("access", "enum", textEnum)
		}
	}
	p := &project{ID: uuid.New(), Key: key, Name: name, Unit: b.OrgUnitId, Access: level, Flow: flowTasks,
		WorkflowKey: string(b.WorkflowKey), Owner: r.tc.PersonID, WorkflowRevision: 1, TaskSeq: seqStart, Revision: 1, CreatedAt: r.now}
	wf, copied, err := r.templateOf(ctx, b)
	return p, wf, copied, err
}

// projectName is the trimmed name of a project: 3–120 characters.
func projectName(raw string) (string, error) {
	name := trimmed(raw)
	switch n := utf8.RuneCountInString(name); {
	case n < nameMin:
		return "", invalid("name", "too_short", textNameShort)
	case n > nameMax:
		return "", invalid("name", "length", textLength)
	}
	return name, nil
}

// freeKey is the key of a new project: 2–6 capital letters or digits, the first a letter, not taken by a project.
func (r *request) freeKey(ctx context.Context, raw string) (string, error) {
	key := trimmed(raw) // the schema of the contract: capital letters only (MSW answers a small one by the same text)
	if !keyRE.MatchString(key) {
		return "", invalid("key", "pattern", textKeyPattern)
	}
	var taken bool
	if err := r.tx.QueryRow(ctx, `select exists (select 1 from tasks.projects where key = $1)`, key).Scan(&taken); err != nil {
		return "", store("key", err)
	}
	if taken {
		return "", invalid("key", "taken", "Ключ "+key+" уже занят")
	}
	return key, nil
}

// templateOf is the v1 of a new project: a template of buildWf or the published workflow of a project the member sees
// (its rules are copied disabled).
func (r *request) templateOf(ctx context.Context, b tasksapi.ProjectCreate) (workflow, []*automation, error) {
	switch b.WorkflowKey {
	case tasksapi.Simple:
		return template(tmplSimple), nil, nil
	case tasksapi.Approval:
		return template(tmplApproval), nil, nil
	case tasksapi.Copy:
	default:
		return workflow{}, nil, invalid("workflowKey", "enum", textEnum)
	}
	if b.CopyFromProjectId == nil {
		return workflow{}, nil, invalid("copyFromProjectId", "required", textNoCopy)
	}
	src, err := r.project(ctx, *b.CopyFromProjectId)
	if err != nil {
		return workflow{}, nil, err
	}
	if src == nil || src.funnel() {
		return workflow{}, nil, invalid("copyFromProjectId", "required", textNoCopy)
	}
	a, err := r.access(ctx, src)
	if err != nil {
		return workflow{}, nil, err
	}
	cur, err := r.current(ctx, src)
	if err != nil {
		return workflow{}, nil, err
	}
	if !a.has(actProjectsRead) || cur == nil {
		return workflow{}, nil, invalid("copyFromProjectId", "required", textNoCopy)
	}
	rules, err := r.automations(ctx, src.ID)
	if err != nil {
		return workflow{}, nil, err
	}
	return workflow{Statuses: slices.Clone(cur.Statuses), Transitions: slices.Clone(cur.Transitions)}, rules, nil
}

func (r *request) insertProject(ctx context.Context, p *project, wf workflow, copied []*automation) error {
	var owner *uuid.UUID
	if p.Owner != uuid.Nil {
		owner = &p.Owner
	}
	if _, err := r.tx.Exec(ctx, `insert into tasks.projects (id, key, name, org_unit_id, access, flow, workflow_key, owner_id,
		current_version, workflow_revision, task_seq, revision, created_at, updated_at)
		values ($1, $2, $3, $4, $5, 'tasks', $6, $7, 1, 1, $8, 1, $9, $9)`,
		p.ID, p.Key, p.Name, p.Unit, p.Access, p.WorkflowKey, owner, seqStart, r.now); err != nil {
		if pe, ok := errors.AsType[*pgconn.PgError](err); ok && pe.Code == pgUniqueViolation && pe.ConstraintName == "projects_key_idx" {
			return invalid("key", "taken", "Ключ "+p.Key+" уже занят") // a project with the key was created after freeKey
		}
		return store("insert project", err)
	}
	if err := r.insertVersion(ctx, p, 1, wf, owner); err != nil {
		return err
	}
	for i, a := range copied {
		if _, err := r.tx.Exec(ctx, `insert into tasks.automations (id, project_id, name, trigger_kind, trigger_status_id,
			condition_priority, action_kind, action_member_id, action_priority, action_text, enabled, version, author_id,
			created_at, updated_at)
			select $1, $2, name, trigger_kind, trigger_status_id, condition_priority, action_kind, action_member_id,
			       action_priority, action_text, false, version, author_id, $3, $3
			  from tasks.automations where id = $4`, uuid.New(), p.ID, r.now.Add(durationOf(i)), a.ID); err != nil {
			return store("copy rule", err)
		}
	}
	return nil
}

// assignCreator makes the requesting member the project manager of p: the role of the organization with the template
// project_manager, scope project (none in the organization — no assignment, as MSW).
func (r *request) assignCreator(ctx context.Context, p *project) error {
	if r.tc.PersonID == uuid.Nil {
		return nil
	}
	var (
		role    uuid.UUID
		version int
	)
	err := r.tx.QueryRow(ctx, `select id, current_version from access.roles where template_key = $1 and archived_at is null
		order by created_at, id limit 1`, tmplManager).Scan(&role, &version)
	switch {
	case noRows(err):
		return nil
	case err != nil:
		return store("project manager role", err)
	}
	if err := r.insertAssignment(ctx, r.tc.PersonID, role, version, p.ID); err != nil {
		return err
	}
	_, err = realtime.BumpPolicy(ctx, r.tx, r.tc.TenantID, []uuid.UUID{r.tc.PersonID}, "tasks.project.create")
	return store("policy version", err)
}

// insertAssignment gives person role with the scope of the project p (access.role_assignments, scope_kind project).
func (r *request) insertAssignment(ctx context.Context, person, role uuid.UUID, version int, projectID uuid.UUID) error {
	granter := r.tc.PersonID
	if granter == uuid.Nil {
		granter = person
	}
	_, err := r.tx.Exec(ctx, `insert into access.role_assignments (id, principal_kind, principal_id, role_id, role_version,
		scope_kind, scope_ref, include_descendants, valid, state, source, granted_by, created_at)
		values ($1, 'person', $2, $3, $4, 'project', $5, false, tstzrange($6::timestamptz, null), 'active', 'manual', $7, $6)`,
		uuid.New(), person, role, version, projectID, r.now, granter)
	return store("assignment", err)
}

// UpdateProject renames a project or changes its level of access (updateTaskProject, updateProject of the prototype):
// the name — «Настраивать» (tasks.projects.manage), the level — tasks.members.manage; checks first, then the change
// (PD-60, Q-W4.10-8).
func (s *Service) UpdateProject(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b tasksapi.TaskProjectPatch) (tasksapi.Project, error) {
	var out tasksapi.Project
	err := s.run(ctx, tc, true, func(r *request) error {
		p, err := r.visibleProject(ctx, id)
		if err != nil {
			return err
		}
		if err := r.mayPatch(ctx, p, b); err != nil {
			return err
		}
		if err := r.lockProject(ctx, p); err != nil {
			return err
		}
		if err := checkRevision(ifMatch, p.Revision, textStale); err != nil {
			return err
		}
		diff, err := p.patch(b)
		if err != nil {
			return err
		}
		p.Revision++
		if _, err := r.tx.Exec(ctx, `update tasks.projects set name = $2, access = $3, revision = $4, updated_at = $5 where id = $1`,
			p.ID, p.Name, p.Access, p.Revision, r.now); err != nil {
			return store("update project", err)
		}
		if _, err := r.publish(ctx, evProjectUpdated, aggProject, p.ID, map[string]any{keyProjectID: p.ID}); err != nil {
			return err
		}
		if err := kit.Audit(ctx, r.tx, audit.Event{Action: "tasks.project.update", TargetType: targetProject, TargetID: p.ID,
			UnitID: unitOrNil(p.Unit), Diff: diff}); err != nil {
			return err
		}
		r.mine = map[uuid.UUID]*access{}
		if out, err = r.projectDTO(ctx, p); err != nil {
			return err
		}
		return kit.Complete(ctx, r.tx, http.StatusOK, etag(out.Revision), out)
	})
	return out, err
}

// mayPatch requires the rights of a change of a project: the name — «Настраивать», the level — tasks.members.manage
// (not of the funnel).
func (r *request) mayPatch(ctx context.Context, p *project, b tasksapi.TaskProjectPatch) error {
	if b.Name == nil && b.Access == nil {
		return invalid("body", "required", textRequired)
	}
	if b.Name != nil {
		if _, err := r.need(ctx, p, actProjectsManage); err != nil {
			return err
		}
	}
	if b.Access == nil {
		return nil
	}
	if _, err := r.need(ctx, p, actMembersManage); err != nil {
		return err
	}
	if p.funnel() {
		return conflict(reasonFunnel, textFunnelLevel)
	}
	return nil
}

// patch applies b to p and returns the diff of the audit.
func (p *project) patch(b tasksapi.TaskProjectPatch) (map[string]any, error) {
	diff := map[string]any{}
	if b.Name != nil {
		name, err := projectName(*b.Name)
		if err != nil {
			return nil, err
		}
		diff["name"], p.Name = name, name
	}
	if b.Access != nil {
		if !slices.Contains(levels, string(*b.Access)) {
			return nil, invalid("access", "enum", textEnum)
		}
		diff["access"], p.Access = string(*b.Access), string(*b.Access)
	}
	return diff, nil
}

// InitWorkflow creates v1 of a project without a workflow (initTaskProjectWorkflow, TP-06): the statuses of its tasks
// 1:1 and the transitions «all to all»; the tasks move to v1 by the names of their statuses.
func (s *Service) InitWorkflow(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (tasksapi.TaskWorkflow, error) {
	var out tasksapi.TaskWorkflow
	err := s.run(ctx, tc, true, func(r *request) error {
		p, err := r.visibleProject(ctx, id)
		if err != nil {
			return err
		}
		if _, err := r.need(ctx, p, actWorkflowManage); err != nil {
			return err
		}
		if p.funnel() {
			return conflict(reasonFunnel, textFunnelFixed)
		}
		if err := r.lockProject(ctx, p); err != nil {
			return err
		}
		if p.CurrentVersion != nil {
			return conflict(reasonExists, textHasWorkflow)
		}
		if err := r.firstVersion(ctx, p); err != nil {
			return err
		}
		level := p.Access
		if level == "" {
			level = levelLimited
		}
		if _, err := r.tx.Exec(ctx, `update tasks.projects set current_version = 1, access = $2, workflow_revision = workflow_revision + 1,
			updated_at = $3 where id = $1`, p.ID, level, r.now); err != nil {
			return store("init workflow", err)
		}
		if _, err := r.publish(ctx, evPublished, aggProject, p.ID, map[string]any{keyProjectID: p.ID, keyWorkflowVer: 1}); err != nil {
			return err
		}
		if err := kit.Audit(ctx, r.tx, audit.Event{Action: "tasks.workflow.init", TargetType: targetProject, TargetID: p.ID,
			UnitID: unitOrNil(p.Unit)}); err != nil {
			return err
		}
		r.projects = nil
		fresh, err := r.project(ctx, p.ID)
		if err != nil {
			return err
		}
		if out, err = r.workflowDTO(ctx, fresh); err != nil {
			return err
		}
		return kit.Complete(ctx, r.tx, http.StatusOK, etag(out.Revision), out)
	})
	return out, err
}

// firstVersion writes v1 of p from the statuses of its tasks (initialWorkflow) and moves the tasks to it.
func (r *request) firstVersion(ctx context.Context, p *project) error {
	used, err := collect[string](ctx, r.tx, `select distinct status_id from tasks.tasks where project_id = $1 order by 1`, p.ID)
	if err != nil {
		return store("statuses of the tasks", err)
	}
	names := make([]string, 0, len(used))
	for _, id := range used {
		names = append(names, legacyName(id))
	}
	wf := initialWorkflow(names)
	me := r.tc.PersonID
	if err := r.insertVersion(ctx, p, 1, wf, &me); err != nil {
		return err
	}
	for _, id := range used {
		st := wf.Statuses[0]
		if i := slices.IndexFunc(wf.Statuses, func(s tasksapi.TaskWorkflowStatus) bool { return s.Name == legacyName(id) }); i >= 0 {
			st = wf.Statuses[i]
		}
		if _, err := r.tx.Exec(ctx, `update tasks.tasks set status_id = $3, workflow_version = 1, revision = revision + 1,
			updated_at = $4 where project_id = $1 and status_id = $2`, p.ID, id, st.Id, r.now); err != nil {
			return store("move the tasks to v1", err)
		}
	}
	return nil
}

// legacyNames are the names of the statuses of a project without a workflow by their ids (the old board keeps a status
// as a slug: new, in_progress, review, done, cancelled); an unknown id is its own name (TP-06: the statuses 1:1).
var legacyNames = map[string]string{
	"new": stNew, "in_progress": stProgress, "progress": stProgress, "review": "На проверке", "done": stDone,
	"cancelled": stCancelled, "canceled": stCancelled,
}

func legacyName(id string) string {
	if n, ok := legacyNames[id]; ok {
		return n
	}
	return id
}
