package tasks

import (
	"context"
	"net/http"
	"slices"
	"strconv"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W4.11: shared command helpers of the modules (Audit, Complete; Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Texts of «Автоматизация» (api.js:150–163, 729–740 of the prototype, MSW tasks/index.ts).
const (
	textNameRule      = "Назовите правило"
	textRuleStatus    = "Выберите статус для триггера"
	textFillAction    = "Заполните действие"
	textFunnelRules   = "У воронки «Заявки» нет автоматизации"
	targetAutomation  = "tasks.automation"
	ruleNameMax       = 120
	ruleTextMax       = 2000
	resultOK          = "ok"
	resultStopped     = "stopped"
	resultError       = "error"
	triggerCreated    = "created"
	triggerStatus     = "status_entered"
	actionAssign      = "assign"
	actionSetPriority = "set_priority"
	actionComment     = "comment"
)

// autoFire is autoFire of the prototype: the enabled rules of p for trigger (status_entered — into statusID) run on
// behalf of their authors (tasks.transition of the author in the project is checked every time), the changes they
// make start no rule (depth 1), every run is logged in the journal (30 per project).
func (r *request) autoFire(ctx context.Context, p *project, t *task, trigger, statusID string) error {
	if r.firing {
		return nil
	}
	r.firing = true
	defer func() { r.firing = false }()
	rules, err := r.automations(ctx, p.ID)
	if err != nil {
		return err
	}
	sc, err := r.scene(ctx, p)
	if err != nil {
		return err
	}
	key := keyOf(t, p)
	for _, a := range rules {
		if !a.Enabled || a.Trigger != trigger || (trigger == triggerStatus && (a.TriggerTo == nil || *a.TriggerTo != statusID)) {
			continue
		}
		if err := r.fire(ctx, sc, t, key, a); err != nil {
			return err
		}
	}
	return nil
}

// fire runs one rule a on t.
func (r *request) fire(ctx context.Context, sc *scene, t *task, key string, a *automation) error {
	if a.CondPrio != nil && t.Priority != *a.CondPrio {
		return r.run(ctx, a, t, resultStopped, key+": приоритет «"+priorityLabel[t.Priority]+"» — условие не выполнено")
	}
	if ok, why, _ := sc.can(a.Author, actTransition); !ok {
		ev, err := r.publish(ctx, evAutomationRun, aggAutomation, a.ID, map[string]any{keyAutomationID: a.ID, keyTaskID: t.ID, "result": resultError})
		if err != nil {
			return err
		}
		r.toOwners("automation.failed", "Правило «"+a.Name+"» не выполнено: "+why, ev)
		return r.run(ctx, a, t, resultError, "У автора правила "+sc.name(a.Author)+" нет права менять задачи: "+why)
	}
	applied, err := r.act(ctx, sc, t, key, a)
	if err != nil || !applied {
		return err
	}
	_, err = r.log(ctx, t.ID, "automation", "Правило «"+a.Name+"» v"+strconv.Itoa(a.Version), actor{label: actorAutomation}, "")
	return err
}

// act applies the action of a to t and journals the run; applied is false when the action could not be applied.
func (r *request) act(ctx context.Context, sc *scene, t *task, key string, a *automation) (applied bool, err error) {
	switch a.ActionKind {
	case actionAssign:
		var m *member
		if a.ActionWho != nil {
			m = sc.people[*a.ActionWho]
		}
		if m == nil || !m.Active {
			name := unknownName
			if m != nil {
				name = m.Name
			}
			return false, r.run(ctx, a, t, resultError, "Сотрудник «"+name+"» не найден или неактивен")
		}
		id := m.ID
		t.Assignee = &id
		return true, r.run(ctx, a, t, resultOK, key+" назначена: "+m.Name)
	case actionSetPriority:
		if a.ActionPrio != nil {
			t.Priority = *a.ActionPrio
		}
		return true, r.run(ctx, a, t, resultOK, key+": приоритет «"+priorityLabel[t.Priority]+"»")
	}
	text := ""
	if a.ActionText != nil {
		text = *a.ActionText
	}
	if _, err := r.log(ctx, t.ID, "automation", text, actor{label: actorAutomation}, ""); err != nil {
		return false, err
	}
	return true, r.run(ctx, a, t, resultOK, key+": добавлен комментарий")
}

// run writes a run of rule a on t into the journal (the last 30 of the project are kept) and counts it.
func (r *request) run(ctx context.Context, a *automation, t *task, result, text string) error {
	if _, err := r.tx.Exec(ctx, `insert into tasks.automation_runs (id, project_id, automation_id, automation_name,
		automation_version, result, text, task_id, at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		uuid.New(), a.Project, a.ID, a.Name, a.Version, result, clip(text, ruleTextMax), t.ID, r.tick()); err != nil {
		return store("run", err)
	}
	if _, err := r.tx.Exec(ctx, `delete from tasks.automation_runs where project_id = $1 and id not in (
		select id from tasks.automation_runs where project_id = $1 order by at desc, id desc limit $2)`, a.Project, runsKept); err != nil {
		return store("journal", err)
	}
	a.RunCount++
	_, err := r.tx.Exec(ctx, `update tasks.automations set run_count = run_count + 1 where id = $1`, a.ID)
	return store("run count", err)
}

// Automations lists the rules of a project (listTaskAutomations), in the order of creation.
func (s *Service) Automations(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (tasksapi.TaskAutomationList, error) {
	var out tasksapi.TaskAutomationList
	err := s.run(ctx, tc, false, func(r *request) error {
		p, err := r.visibleProject(ctx, id)
		if err != nil {
			return err
		}
		rules, err := r.automations(ctx, p.ID)
		if err != nil {
			return err
		}
		out.Items = make([]tasksapi.TaskAutomation, 0, len(rules))
		for _, a := range rules {
			out.Items = append(out.Items, automationDTO(a))
		}
		return nil
	})
	return out, err
}

// rule is the content of a rule being saved.
type rule struct {
	name      string
	trigger   tasksapi.TaskAutomationTrigger
	condition *tasksapi.TaskAutomationCondition
	action    tasksapi.TaskAutomationAction
}

// checkRule is the form «Новое правило» of the prototype: a name, a status of the published version for «Задача
// перешла в статус», an action with its value (an active member for «Назначить на»).
func (r *request) checkRule(ctx context.Context, p *project, x rule) error {
	switch n := runes(trimmed(x.name)); {
	case n == 0:
		return invalid("name", "required", textNameRule)
	case n > ruleNameMax:
		return invalid("name", "length", textLength)
	}
	if err := r.checkTrigger(ctx, p, x.trigger); err != nil {
		return err
	}
	if x.condition != nil {
		if err := validPriority("condition.priority", x.condition.Priority); err != nil {
			return err
		}
	}
	return r.checkAction(ctx, x.action)
}

// checkTrigger requires a known trigger and, for «Задача перешла в статус», a status of the published version.
func (r *request) checkTrigger(ctx context.Context, p *project, tr tasksapi.TaskAutomationTrigger) error {
	switch tr.Kind {
	case tasksapi.TaskAutomationTriggerKindCreated:
		return nil
	case tasksapi.TaskAutomationTriggerKindStatusEntered:
		cur, err := r.current(ctx, p)
		if err != nil {
			return err
		}
		w := workflow{}
		if cur != nil {
			w.Statuses = cur.Statuses
		}
		if _, ok := w.status(deref(tr.StatusId)); tr.StatusId == nil || !ok {
			return invalid("trigger.statusId", "required", textRuleStatus)
		}
		return nil
	}
	return invalid("trigger.kind", "enum", textEnum)
}

// checkAction requires a known action with its value: an active member, a priority or a text.
func (r *request) checkAction(ctx context.Context, a tasksapi.TaskAutomationAction) error {
	ok := false
	switch a.Kind {
	case tasksapi.TaskAutomationActionKindAssign:
		if a.MemberId != nil {
			m, err := r.person(ctx, *a.MemberId)
			if err != nil {
				return err
			}
			ok = m != nil && m.Active
		}
	case tasksapi.TaskAutomationActionKindSetPriority:
		ok = a.Priority != nil && slices.Contains(priorities, string(*a.Priority))
	case tasksapi.TaskAutomationActionKindComment:
		ok = a.Text != nil && trimmed(*a.Text) != "" && runes(*a.Text) <= ruleTextMax
	default:
		return invalid("action.kind", "enum", textEnum)
	}
	if !ok {
		return invalid("action", "required", textFillAction)
	}
	return nil
}
func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// columns of a rule: the trigger status, the condition and the value of the action as the table stores them.
func (x rule) columns() (status, cond, member, prio, text any) {
	if x.trigger.Kind == tasksapi.TaskAutomationTriggerKindStatusEntered {
		status = deref(x.trigger.StatusId)
	}
	if x.condition != nil && x.condition.Priority != nil {
		cond = string(*x.condition.Priority)
	}
	switch x.action.Kind {
	case tasksapi.TaskAutomationActionKindAssign:
		member = *x.action.MemberId
	case tasksapi.TaskAutomationActionKindSetPriority:
		prio = string(*x.action.Priority)
	case tasksapi.TaskAutomationActionKindComment:
		text = trimmed(*x.action.Text)
	}
	return status, cond, member, prio, text
}

// CreateAutomation adds a rule (createTaskAutomation, «Добавить правило»): the author is the requesting member,
// version 1 — the rule runs on his behalf.
func (s *Service) CreateAutomation(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, b tasksapi.TaskAutomationCreate) (tasksapi.TaskAutomation, error) {
	var out tasksapi.TaskAutomation
	err := s.run(ctx, tc, true, func(r *request) error {
		p, err := r.visibleProject(ctx, id)
		if err != nil {
			return err
		}
		if _, err := r.need(ctx, p, actAutomation); err != nil {
			return err
		}
		if p.funnel() {
			return conflict(reasonFunnel, textFunnelRules)
		}
		x := rule{name: b.Name, trigger: b.Trigger, condition: b.Condition, action: b.Action}
		if err := r.checkRule(ctx, p, x); err != nil {
			return err
		}
		enabled := b.Enabled == nil || *b.Enabled
		status, cond, member, prio, text := x.columns()
		ruleID := uuid.New()
		if _, err := r.tx.Exec(ctx, `insert into tasks.automations (id, project_id, name, trigger_kind, trigger_status_id,
			condition_priority, action_kind, action_member_id, action_priority, action_text, enabled, version, author_id,
			created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1, $12, $13, $13)`,
			ruleID, p.ID, trimmed(x.name), string(x.trigger.Kind), status, cond, string(x.action.Kind), member, prio, text,
			enabled, r.tc.PersonID, r.tick()); err != nil {
			return store("insert rule", err)
		}
		a, err := r.ruleOf(ctx, p, ruleID, false)
		if err != nil {
			return err
		}
		if err := r.ruleChanged(ctx, p, a, "tasks.automation.create"); err != nil {
			return err
		}
		out = automationDTO(a)
		return kit.Complete(ctx, r.tx, http.StatusCreated, etag(out.Revision), out)
	})
	return out, err
}

// ruleOf reads the rule id of p (404 «Правило не найдено»); lock — for update.
func (r *request) ruleOf(ctx context.Context, p *project, id uuid.UUID, lock bool) (*automation, error) {
	sql := `select ` + automationCols + ` from tasks.automations a left join people.person_profiles pp on pp.id = a.author_id
		where a.id = $1 and a.project_id = $2`
	if lock {
		sql += ` for update of a`
	}
	a, err := scanAutomation(r.tx.QueryRow(ctx, sql, id, p.ID))
	switch {
	case noRows(err):
		return nil, notFound(textNoRule)
	case err != nil:
		return nil, store("rule", err)
	}
	return a, nil
}

// ruleChanged publishes and audits a change of a rule.
func (r *request) ruleChanged(ctx context.Context, p *project, a *automation, action string) error {
	if _, err := r.publish(ctx, evAutomation, aggAutomation, a.ID, map[string]any{keyAutomationID: a.ID, keyProjectID: p.ID}); err != nil {
		return err
	}
	return kit.Audit(ctx, r.tx, audit.Event{Action: action, TargetType: targetAutomation, TargetID: a.ID, UnitID: unitOrNil(p.Unit),
		Sensitivity: audit.Sensitive, Diff: map[string]any{"name": a.Name, "version": a.Version, "enabled": a.Enabled}})
}

// UpdateAutomation changes, enables or disables a rule (updateTaskAutomation): a change of the content raises the
// version and makes the requesting member the author; «Включено» alone keeps them.
func (s *Service) UpdateAutomation(ctx context.Context, tc tenantctx.TenantContext, projectID, id uuid.UUID, ifMatch string, b tasksapi.TaskAutomationPatch) (tasksapi.TaskAutomation, error) {
	var out tasksapi.TaskAutomation
	err := s.run(ctx, tc, true, func(r *request) error {
		p, err := r.visibleProject(ctx, projectID)
		if err != nil {
			return err
		}
		if _, err := r.need(ctx, p, actAutomation); err != nil {
			return err
		}
		a, err := r.ruleOf(ctx, p, id, true)
		if err != nil {
			return err
		}
		if err := checkRevision(ifMatch, a.Revision, staleRule); err != nil {
			return err
		}
		x, changed := ruleFrom(a).patched(b)
		if !changed && b.Enabled == nil {
			return invalid("body", "required", textRequired)
		}
		if changed {
			if err := r.checkRule(ctx, p, x); err != nil {
				return err
			}
		}
		if err := r.saveRule(ctx, a, x, b.Enabled, changed); err != nil {
			return err
		}
		if a, err = r.ruleOf(ctx, p, id, false); err != nil {
			return err
		}
		if err := r.ruleChanged(ctx, p, a, "tasks.automation.update"); err != nil {
			return err
		}
		out = automationDTO(a)
		return kit.Complete(ctx, r.tx, http.StatusOK, etag(out.Revision), out)
	})
	return out, err
}

// ruleFrom is the content of a stored rule.
func ruleFrom(a *automation) rule {
	x := rule{name: a.Name, trigger: tasksapi.TaskAutomationTrigger{Kind: tasksapi.TaskAutomationTriggerKind(a.Trigger), StatusId: a.TriggerTo},
		action: tasksapi.TaskAutomationAction{Kind: tasksapi.TaskAutomationActionKind(a.ActionKind), MemberId: a.ActionWho, Text: a.ActionText}}
	if a.ActionPrio != nil {
		x.action.Priority = new(tasksapi.TaskPriority(*a.ActionPrio))
	}
	if a.CondPrio != nil {
		x.condition = &tasksapi.TaskAutomationCondition{Priority: new(tasksapi.TaskPriority(*a.CondPrio))}
	}
	return x
}

// patched is x with the content of b; changed reports whether b changes the content (not only «Включено»).
func (x rule) patched(b tasksapi.TaskAutomationPatch) (rule, bool) {
	if b.Name != nil {
		x.name = *b.Name
	}
	if b.Trigger != nil {
		x.trigger = *b.Trigger
	}
	if b.Action != nil {
		x.action = *b.Action
	}
	if b.Condition != nil {
		x.condition = b.Condition
	}
	return x, b.Name != nil || b.Trigger != nil || b.Action != nil || b.Condition != nil
}

// saveRule writes the content x (when changed: version + 1, the requesting member — the author) and «Включено».
func (r *request) saveRule(ctx context.Context, a *automation, x rule, enabled *bool, changed bool) error {
	on := a.Enabled
	if enabled != nil {
		on = *enabled
	}
	version, author := a.Version, a.Author
	if changed {
		version, author = version+1, r.tc.PersonID
	}
	status, cond, member, prio, text := x.columns()
	_, err := r.tx.Exec(ctx, `update tasks.automations set name = $2, trigger_kind = $3, trigger_status_id = $4,
		condition_priority = $5, action_kind = $6, action_member_id = $7, action_priority = $8, action_text = $9,
		enabled = $10, version = $11, author_id = $12, revision = revision + 1, updated_at = $13 where id = $1`,
		a.ID, trimmed(x.name), string(x.trigger.Kind), status, cond, string(x.action.Kind), member, prio, text, on, version,
		author, r.now)
	return store("save rule", err)
}

// DeleteAutomation deletes a rule (deleteTaskAutomation); the journal keeps its runs.
func (s *Service) DeleteAutomation(ctx context.Context, tc tenantctx.TenantContext, projectID, id uuid.UUID, ifMatch string) error {
	return s.run(ctx, tc, true, func(r *request) error {
		p, err := r.visibleProject(ctx, projectID)
		if err != nil {
			return err
		}
		if _, err := r.need(ctx, p, actAutomation); err != nil {
			return err
		}
		a, err := r.ruleOf(ctx, p, id, true)
		if err != nil {
			return err
		}
		if err := checkRevision(ifMatch, a.Revision, staleRule); err != nil {
			return err
		}
		if _, err := r.tx.Exec(ctx, `delete from tasks.automations where id = $1`, a.ID); err != nil {
			return store("delete rule", err)
		}
		if err := r.ruleChanged(ctx, p, a, "tasks.automation.delete"); err != nil {
			return err
		}
		return kit.Complete(ctx, r.tx, http.StatusNoContent, "", nil)
	})
}

// Runs is the journal of the rules of a project, the last 30 newest first (listTaskAutomationRuns); a run names a
// task only when the member sees it.
func (s *Service) Runs(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (tasksapi.TaskAutomationRunList, error) {
	var out tasksapi.TaskAutomationRunList
	err := s.run(ctx, tc, false, func(r *request) error {
		p, err := r.visibleProject(ctx, id)
		if err != nil {
			return err
		}
		rows, err := r.tx.Query(ctx, `select id, at, automation_id, automation_name, automation_version, result, text, task_id
			from tasks.automation_runs where project_id = $1 order by at desc, id desc limit $2`, p.ID, runsKept)
		if err != nil {
			return store("runs", err)
		}
		runs, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (tasksapi.TaskAutomationRun, error) {
			var (
				x      tasksapi.TaskAutomationRun
				result string
			)
			err := row.Scan(&x.Id, &x.At, &x.AutomationId, &x.AutomationName, &x.AutomationVersion, &result, &x.Text, &x.TaskId)
			x.Result, x.At = tasksapi.TaskAutomationRunResult(result), x.At.UTC()
			return x, err
		})
		if err != nil {
			return store("runs", err)
		}
		for i := range runs {
			if runs[i].TaskId == nil {
				continue
			}
			t, err := r.task(ctx, *runs[i].TaskId, false)
			if err != nil {
				return err
			}
			ok := false
			if t != nil {
				if ok, err = r.visible(ctx, t); err != nil {
					return err
				}
			}
			if !ok {
				runs[i].TaskId = nil
				continue
			}
			runs[i].TaskKey = new(r.keyOfTask(ctx, t))
		}
		out.Items = runs
		return nil
	})
	return out, err
}
