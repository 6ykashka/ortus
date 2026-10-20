//go:build integration

package migrations_test

import (
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// tenant 0025 (W4.03) на реальном сервере под runtime-ролью API: ключ проекта, воронка без уровня доступа, номера
// задач в проекте, задача не входит в саму себя, комментарий только от участника, один открытый раунд согласования,
// отказ с комментарием, файл — одной задаче, правило с действием по виду, журнал переживает удаление правила.
func TestStage4W403Constraints(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		name, _ := migrated(t, c, migrations.Tenant)
		db := c.DB(t, name, migrations.RoleAPI)
		ctx := t.Context()
		exec := func(q string, args ...any) error {
			_, err := db.ExecContext(ctx, q, args...)
			return err
		}
		wantState := func(what string, err error, state string) {
			t.Helper()
			if got := sqlState(err); got != state {
				t.Errorf("%s: SQLSTATE %q (%v), want %s", what, got, err, state)
			}
		}
		wantOK := func(what string, err error) {
			t.Helper()
			if err != nil {
				t.Errorf("%s: %v", what, err)
			}
		}

		unit := scalar[string](t, db, `insert into org.units (kind, name, time_zone)
			values ('company', 'Север', 'Europe/Moscow') returning id::text`)
		kotova := scalar[string](t, db, `insert into people.person_profiles (full_name, home_unit_id)
			values ('Марина Котова', $1) returning id::text`, unit)
		vasiliev := scalar[string](t, db, `insert into people.person_profiles (full_name, home_unit_id)
			values ('Илья Васильев', $1) returning id::text`, unit)

		// Проекты: ключ кириллицей 2–6, уникален; у воронки нет уровня доступа, у проекта задач — есть.
		project := func(key, flow, access string) error {
			var acc any
			if access != "" {
				acc = access
			}
			return exec(`insert into tasks.projects (key, name, org_unit_id, access, flow, workflow_key, owner_id, current_version)
				values ($1, 'Логистика · Север', $2, $3, $4, $5, $6, $7)`, key, unit, acc, flow,
				map[string]string{"tasks": "approval", "leads": "leads"}[flow], kotova,
				map[string]any{"tasks": 1, "leads": nil}[flow])
		}
		wantOK("project LOG", project("LOG", "tasks", "limited"))
		wantOK("funnel ЗАЯ", project("ЗАЯ", "leads", ""))
		wantState("key taken", project("LOG", "tasks", "open"), "23505")
		wantState("key of one letter", project("L", "tasks", "open"), "23514")
		wantState("key in lower case", project("log2", "tasks", "open"), "23514")
		wantState("project without an access level", project("ДОК", "tasks", ""), "23514")
		wantState("funnel with an access level", project("ВОР", "leads", "open"), "23514")
		wantOK("whole organization", exec(`insert into tasks.projects (key, name, access, workflow_key, owner_id, current_version)
			values ('РЧН', 'Ремонт · ЖК Речной', 'closed', 'simple', $1, 1)`, kotova))
		log := scalar[string](t, db, `select id::text from tasks.projects where key = 'LOG'`)

		wantOK("workflow v1", exec(`insert into tasks.workflow_versions (project_id, version, statuses, transitions, published_by)
			values ($1, 1, '[{"id": "s1", "name": "Новая", "category": "todo"}]', '[]', $2)`, log, kotova))
		wantState("workflow v1 again", exec(`insert into tasks.workflow_versions (project_id, version, statuses, transitions)
			values ($1, 1, '[{"id": "s1", "name": "Новая", "category": "todo"}]', '[]')`, log), "23505")
		wantState("workflow without statuses", exec(`insert into tasks.workflow_versions (project_id, version, statuses,
			transitions) values ($1, 2, '[]', '[]')`, log), "23514")

		// Задачи: номер уникален в проекте, сидовый ключ T-NN, приоритет и метки, не родитель самой себе.
		task := func(number int, legacy any, priority string) (string, error) {
			var id string
			err := db.QueryRowContext(ctx, `insert into tasks.tasks (project_id, number, legacy_key, title, status_id,
				workflow_version, priority, author_id, assignee_id) values ($1, $2, $3, 'Заменить шины на ГАЗон Next (зимние)',
				's3', 1, $4, $5, $5) returning id::text`, log, number, legacy, priority, vasiliev).Scan(&id)
			return id, err
		}
		t65, err := task(65, "T-65", "high")
		wantOK("task T-65", err)
		_, err = task(65, nil, "normal")
		wantState("number taken in the project", err, "23505")
		_, err = task(101, nil, "critical")
		wantState("unknown priority", err, "23514")
		wantState("own parent", exec(`update tasks.tasks set parent_task_id = id where id = $1`, t65), "23514")
		wantState("eleven labels", exec(`update tasks.tasks set labels = '{a,b,c,d,e,f,g,h,i,j,k}' where id = $1`, t65),
			"23514")

		// История: комментарий — только от участника; системная строка — с меткой.
		wantState("comment without a member", exec(`insert into tasks.task_events (task_id, kind, actor_label, text)
			values ($1, 'comment', 'system', 'Сумма 48 600 ₽')`, t65), "23514")
		wantOK("system line", exec(`insert into tasks.task_events (task_id, kind, actor_label, text)
			values ($1, 'automation', 'automation', 'Правило «Срочная задача → назначить руководителю проекта» v1')`, t65))
		wantOK("comment", exec(`insert into tasks.task_events (task_id, kind, actor_id, text)
			values ($1, 'comment', $2, 'Сумма 48 600 ₽, счёт во вложении. Прошу согласовать.')`, t65, vasiliev))

		// Согласование: один открытый раунд на задачу; отказ — с комментарием.
		round := scalar[string](t, db, `insert into tasks.approval_rounds (task_id, transition_key, workflow_version, mode,
			approver_ids) values ($1, 't3', 1, 'all', array[$2::uuid]) returning id::text`, t65, kotova)
		wantState("second open round", exec(`insert into tasks.approval_rounds (task_id, transition_key, workflow_version,
			mode) values ($1, 't3', 1, 'any')`, t65), "23505")
		wantState("rejection without a comment", exec(`insert into tasks.approval_votes (round_id, member_id, decision)
			values ($1, $2, 'reject')`, round, kotova), "23514")
		wantOK("approval vote", exec(`insert into tasks.approval_votes (round_id, member_id, decision)
			values ($1, $2, 'approve')`, round, kotova))
		wantState("closed without an outcome", exec(`update tasks.approval_rounds set closed_at = now() where id = $1`, round),
			"23514")

		// Вложение: файл — одной задаче.
		file := scalar[string](t, db, `insert into files.objects (object_key, state, purpose, owner_type, owner_id,
			declared_mime, bytes, uploaded_by) values ('tasks/t65/schet.pdf', 'ready', 'task_attachment', 'tasks/task', $1,
			'application/pdf', 184320, $2) returning id::text`, t65, vasiliev)
		wantOK("attachment", exec(`insert into tasks.task_files (task_id, file_id, attached_by) values ($1, $2, $3)`,
			t65, file, vasiliev))
		t66, err := task(66, "T-66", "high")
		wantOK("task T-66", err)
		wantState("file of two tasks", exec(`insert into tasks.task_files (task_id, file_id, attached_by) values ($1, $2, $3)`,
			t66, file, kotova), "23505")

		// Автоматизация: триггер «перешла в статус» — со статусом, действие — по виду; журнал переживает правило.
		rule := func(trigger string, status any, kind string, member, text any) (string, error) {
			var id string
			err := db.QueryRowContext(ctx, `insert into tasks.automations (project_id, name, trigger_kind, trigger_status_id,
				action_kind, action_member_id, action_text, author_id) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id::text`,
				log, "Срочная задача → назначить руководителю проекта", trigger, status, kind, member, text, kotova).Scan(&id)
			return id, err
		}
		_, err = rule("status_entered", nil, "comment", nil, "Проверьте путевой лист")
		wantState("status trigger without a status", err, "23514")
		_, err = rule("created", nil, "assign", nil, nil)
		wantState("assign without a member", err, "23514")
		ar1, err := rule("created", nil, "assign", kotova, nil)
		wantOK("rule ar-1", err)
		wantOK("run", exec(`insert into tasks.automation_runs (project_id, automation_id, automation_name, automation_version,
			result, text, task_id) values ($1, $2, 'Срочная задача → назначить руководителю проекта', 1, 'ok',
			'T-64 назначена: Марина Котова', $3)`, log, ar1, t65))
		wantOK("delete the rule", exec(`delete from tasks.automations where id = $1`, ar1))
		if n := scalar[int](t, db, `select count(*) from tasks.automation_runs where automation_id = $1`, ar1); n != 1 {
			t.Errorf("runs of a deleted rule: %d, want 1", n)
		}
	})
}
