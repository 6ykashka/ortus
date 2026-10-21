package tasks

import (
	"context"
	"net/http"
	"slices"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W4.11: shared command helpers of the modules (Audit, Complete; Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/realtime"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Texts of «Участники» (api.js:665–674 of the prototype, MSW tasks/index.ts).
const (
	textPickMember   = "Выберите сотрудника"
	textProjectRoles = "В проекте назначаются роли проекта"
	textFunnelRoles  = "В воронке «Заявки» ролей проекта нет"
	textDelegation   = "Можно выдать только то, что есть у вас в проекте"
	textNotSelf      = "Себя из проекта исключить нельзя"
	textNoRole       = "Роли в проекте нет"
	textNoChecker    = "Проверять доступ может руководитель проекта"
	targetAssignment = "access.assignment"
)

// projectRole is a role of the organization assignable in a project (the template has the default scope project).
type projectRole struct {
	ID       uuid.UUID
	Name     string
	Template string
	Version  int
	Actions  []string
}

// projectRoles are the roles of projects of the organization in the order of the templates (Q-W4.00-tasks-17).
func (r *request) projectRoles(ctx context.Context) ([]projectRole, error) {
	rows, err := r.tx.Query(ctx, `select r.id, r.name, r.template_key, r.current_version, v.actions
		  from access.roles r join access.role_versions v on v.role_id = r.id and v.version = r.current_version
		 where r.archived_at is null and r.template_key = any($1) order by r.created_at, r.id`, projectTemplates)
	if err != nil {
		return nil, store("roles of projects", err)
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (projectRole, error) {
		var x projectRole
		err := row.Scan(&x.ID, &x.Name, &x.Template, &x.Version, &x.Actions)
		return x, err
	})
	if err != nil {
		return nil, store("roles of projects", err)
	}
	slices.SortStableFunc(out, func(a, b projectRole) int {
		return slices.Index(projectTemplates, a.Template) - slices.Index(projectTemplates, b.Template)
	})
	return out, nil
}

// Members lists the members with access to a project and the roles of projects (listTaskProjectMembers).
func (s *Service) Members(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (tasksapi.TaskProjectMemberList, error) {
	var out tasksapi.TaskProjectMemberList
	err := s.run(ctx, tc, false, func(r *request) error {
		p, err := r.visibleProject(ctx, id)
		if err != nil {
			return err
		}
		if out.Items, err = r.membersOf(ctx, p); err != nil {
			return err
		}
		roles, err := r.projectRoles(ctx)
		if err != nil {
			return err
		}
		out.Roles = make([]tasksapi.TaskProjectRole, 0, len(roles))
		for _, x := range roles {
			out.Roles = append(out.Roles, tasksapi.TaskProjectRole{RoleId: x.ID, Name: x.Name, Actions: taskActions([]grant{{Actions: x.Actions}})})
		}
		return nil
	})
	return out, err
}

// directAssignment is the active assignment of person with the scope of p (not through a group).
func (r *request) directAssignment(ctx context.Context, person, projectID uuid.UUID) (uuid.UUID, bool, error) {
	var id uuid.UUID
	err := r.tx.QueryRow(ctx, `select id from access.role_assignments where principal_kind = 'person' and principal_id = $1
		and scope_kind = 'project' and scope_ref = $2 and state = 'active' order by created_at, id limit 1 for update`,
		person, projectID).Scan(&id)
	switch {
	case noRows(err):
		return uuid.Nil, false, nil
	case err != nil:
		return uuid.Nil, false, store("assignment", err)
	}
	return id, true, nil
}

// SetMemberRole assigns or changes the role of a member in a project (setTaskProjectMemberRole): the direct
// assignment of the member with the scope project; without If-Match — last write wins (Q-W4.03-10). The changes of
// the members of a project go one after another under the lock of the project: access.role_assignments has no unique
// key on (person, project), so two calls at once would each insert an assignment.
func (s *Service) SetMemberRole(ctx context.Context, tc tenantctx.TenantContext, projectID, memberID uuid.UUID, b tasksapi.TaskProjectMemberRoleSet) (tasksapi.TaskProjectMember, error) {
	var out tasksapi.TaskProjectMember
	err := s.run(ctx, tc, true, func(r *request) error {
		p, err := r.lockedProject(ctx, projectID)
		if err != nil {
			return err
		}
		mine, err := r.need(ctx, p, actMembersManage)
		if err != nil {
			return err
		}
		if p.funnel() {
			return conflict(reasonFunnel, textFunnelRoles)
		}
		m, err := r.assignee(ctx, memberID)
		if err != nil {
			return err
		}
		role, err := r.grantable(ctx, mine, b.RoleId)
		if err != nil {
			return err
		}
		if err := r.setRole(ctx, p, m, role); err != nil {
			return err
		}
		r.forget()
		rows, err := r.membersOf(ctx, p)
		if err != nil {
			return err
		}
		k := slices.IndexFunc(rows, func(x tasksapi.TaskProjectMember) bool { return x.MemberId == m.ID })
		if k < 0 {
			return invalid("memberId", "unknown", textPickMember)
		}
		out = rows[k]
		return kit.Complete(ctx, r.tx, http.StatusOK, "", out)
	})
	return out, err
}

// assignee is the member a role of a project is given to: a person with a membership, not suspended.
func (r *request) assignee(ctx context.Context, id uuid.UUID) (*member, error) {
	m, err := r.person(ctx, id)
	switch {
	case err != nil:
		return nil, err
	case m == nil || !r.isMember(m):
		return nil, invalid("memberId", "unknown", textPickMember)
	case r.suspended(m):
		return nil, invalid("memberId", "suspended", m.Name+" заблокирован — назначить роль нельзя")
	}
	return m, nil
}

// grantable is the role of projects id the requesting member may give with his access mine (AUTH-08: nothing beyond
// his own actions in the project, the system role gives any).
func (r *request) grantable(ctx context.Context, mine *access, id uuid.UUID) (projectRole, error) {
	roles, err := r.projectRoles(ctx)
	if err != nil {
		return projectRole{}, err
	}
	i := slices.IndexFunc(roles, func(x projectRole) bool { return x.ID == id })
	if i < 0 {
		return projectRole{}, invalid("roleId", "not_project_role", textProjectRoles)
	}
	role := roles[i]
	if mine.Source != srcSystem && slices.ContainsFunc(role.Actions, func(a string) bool { return isTaskKey(a) && !mine.has(a) }) {
		return projectRole{}, delegation(textDelegation)
	}
	return role, nil
}

// removable is the direct assignment of m in p; a group, inherited or system access is locked (409), none — 404.
func (r *request) removable(ctx context.Context, p *project, m *member) (uuid.UUID, error) {
	id, found, err := r.directAssignment(ctx, m.ID, p.ID)
	if err != nil || found {
		return id, err
	}
	sc, err := r.scene(ctx, p)
	if err != nil {
		return uuid.Nil, err
	}
	if a := projAccess(p, m, sc.path, sc.names); a != nil {
		return uuid.Nil, conflict("", "Доступ "+m.Name+" — «"+a.Via+"» — меняется только в «Пользователях и ролях»")
	}
	return uuid.Nil, notFound(textNoRole)
}

// isMember reports whether a person has a membership in the organization (a member of «Пользователи и роли»).
func (r *request) isMember(m *member) bool { return m.Active || r.memberStatus[m.ID] != "" }

// suspended reports whether the membership of a person is suspended («заблокирован»).
func (r *request) suspended(m *member) bool { return !m.Active && r.memberStatus[m.ID] == "suspended" }

// setRole writes the direct role of m in p (replacing its direct one), raises the policy version for m, publishes and
// audits it and tells the owners (event of the prototype «{имя}: роль «X» в проекте «Y»»).
func (r *request) setRole(ctx context.Context, p *project, m *member, role projectRole) error {
	id, found, err := r.directAssignment(ctx, m.ID, p.ID)
	if err != nil {
		return err
	}
	if found {
		if _, err := r.tx.Exec(ctx, `update access.role_assignments set role_id = $2, role_version = $3 where id = $1`,
			id, role.ID, role.Version); err != nil {
			return store("change role", err)
		}
	} else if err := r.insertAssignment(ctx, m.ID, role.ID, role.Version, p.ID); err != nil {
		return err
	}
	if _, err := realtime.BumpPolicy(ctx, r.tx, r.tc.TenantID, []uuid.UUID{m.ID}, "tasks.member.role_set"); err != nil {
		return store("policy version", err)
	}
	ev, err := r.publish(ctx, evRoleSet, aggProject, p.ID, map[string]any{keyProjectID: p.ID, keyMemberID: m.ID, "roleId": role.ID})
	if err != nil {
		return err
	}
	r.toOwners("member.role_set", m.Name+": роль «"+role.Name+"» в проекте «"+p.Name+"»", ev)
	return kit.Audit(ctx, r.tx, audit.Event{Action: "tasks.member.role_set", TargetType: targetAssignment, TargetID: p.ID,
		UnitID: unitOrNil(p.Unit), Sensitivity: audit.Sensitive, Diff: map[string]any{keyMemberID: m.ID, "roleId": role.ID}})
}

// RemoveMember revokes the direct role of a member in a project (removeTaskProjectMember): not oneself, not a group,
// inherited or system access (the lock — 409); no role — 404. Under the lock of the project, as SetMemberRole.
func (s *Service) RemoveMember(ctx context.Context, tc tenantctx.TenantContext, projectID, memberID uuid.UUID) error {
	return s.run(ctx, tc, true, func(r *request) error {
		p, err := r.lockedProject(ctx, projectID)
		if err != nil {
			return err
		}
		if _, err := r.need(ctx, p, actMembersManage); err != nil {
			return err
		}
		m, err := r.person(ctx, memberID)
		if err != nil {
			return err
		}
		if m == nil || !r.isMember(m) {
			return notFound(textNoMember)
		}
		if m.ID == r.tc.PersonID {
			return conflict("", textNotSelf)
		}
		id, err := r.removable(ctx, p, m)
		if err != nil {
			return err
		}
		if _, err := r.tx.Exec(ctx, `update access.role_assignments set state = 'revoked', revoked_at = $2 where id = $1`,
			id, r.now); err != nil {
			return store("revoke", err)
		}
		if _, err := realtime.BumpPolicy(ctx, r.tx, r.tc.TenantID, []uuid.UUID{m.ID}, "tasks.member.removed"); err != nil {
			return store("policy version", err)
		}
		ev, err := r.publish(ctx, evMemberRemoved, aggProject, p.ID, map[string]any{keyProjectID: p.ID, keyMemberID: m.ID})
		if err != nil {
			return err
		}
		r.toOwners("member.removed", m.Name+" исключён из проекта «"+p.Name+"»", ev)
		if err := kit.Audit(ctx, r.tx, audit.Event{Action: "tasks.member.remove", TargetType: targetAssignment, TargetID: id,
			UnitID: unitOrNil(p.Unit), Sensitivity: audit.Sensitive, Diff: map[string]any{keyMemberID: m.ID, keyProjectID: p.ID}}); err != nil {
			return err
		}
		return kit.Complete(ctx, r.tx, http.StatusNoContent, "", nil)
	})
}

// CheckAccess is «Проверить доступ» (checkTaskProjectAccess, projCan of the prototype): tasks.members.manage in the
// project or members.read in the area of the project (Q-W4.00-tasks-7).
func (s *Service) CheckAccess(ctx context.Context, tc tenantctx.TenantContext, projectID, memberID uuid.UUID, action string) (tasksapi.TaskProjectAccessCheck, error) {
	var out tasksapi.TaskProjectAccessCheck
	err := s.run(ctx, tc, false, func(r *request) error {
		p, err := r.visibleProject(ctx, projectID)
		if err != nil {
			return err
		}
		ok, err := r.mayCheck(ctx, p)
		if err != nil {
			return err
		}
		if !ok {
			return forbidden(textNoChecker)
		}
		if !isTaskKey(action) {
			return invalid("action", "enum", textEnum)
		}
		m, err := r.person(ctx, memberID)
		if err != nil {
			return err
		}
		if m == nil || !r.isMember(m) {
			return notFound(textNoMember)
		}
		sc, err := r.scene(ctx, p)
		if err != nil {
			return err
		}
		allowed, why, a := canIn(p, m, action, sc.path, sc.names)
		out = tasksapi.TaskProjectAccessCheck{MemberId: m.ID, Action: action, Allowed: allowed}
		if a != nil {
			out.RoleName, out.Via = new(a.RoleName), new(a.Via)
		}
		if !allowed {
			out.Reason = new(why)
		}
		return nil
	})
	return out, err
}

// mayCheck reports whether the requesting member may check the access of others in p: the owner, tasks.members.manage
// in p, or members.read over the organization or a unit covering the area of p.
func (r *request) mayCheck(ctx context.Context, p *project) (bool, error) {
	if r.tc.Owner {
		return true, nil
	}
	a, err := r.access(ctx, p)
	if err != nil || a.has(actMembersManage) {
		return a.has(actMembersManage), err
	}
	me, err := r.me(ctx)
	if err != nil {
		return false, err
	}
	sc, err := r.scene(ctx, p)
	if err != nil {
		return false, err
	}
	return slices.ContainsFunc(me.Grants, func(g grant) bool { return g.has(actMembersRead) && covers(&g, p, sc.path) }), nil
}
