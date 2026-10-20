//go:build integration

package migrations_test

import (
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// tenant 0024 (W4.04) на реальном сервере под runtime-ролью API: имя пространства без регистра, дерево узлов (родитель
// того же пространства, шесть уровней, одна главная страница), записи доступа, ознакомление, запросы и таблицы.
func TestStage4W404Constraints(t *testing.T) {
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
			values ('company', 'Север Логистик', 'Europe/Moscow') returning id::text`)
		kotova := scalar[string](t, db, `insert into people.person_profiles (full_name, home_unit_id)
			values ('Марина Котова', $1) returning id::text`, unit)
		driver := scalar[string](t, db, `insert into people.person_profiles (full_name, home_unit_id)
			values ('Илья Васильев', $1) returning id::text`, unit)

		// Пространства: имя без регистра и пробелов уникально, уровень — один из трёх.
		space := scalar[string](t, db, `insert into kb.spaces (name, org_unit_id, access, created_by)
			values ('Логистика', $1, 'limited', $2) returning id::text`, unit, kotova)
		wantState("space name taken (case, spaces)", exec(`insert into kb.spaces (name, access) values (' логистика ', 'open')`), "23505")
		wantState("unknown level", exec(`insert into kb.spaces (name, access) values ('Общее', 'public')`), "23514")
		wantState("name too short", exec(`insert into kb.spaces (name, access) values ('О', 'open')`), "23514")
		other := scalar[string](t, db, `insert into kb.spaces (name, access) values ('Общее', 'open') returning id::text`)

		node := func(sp, parent any, depth int, kind, title string, home bool) (string, error) {
			var id string
			err := db.QueryRowContext(ctx, `insert into kb.nodes (space_id, parent_id, depth, kind, title, is_home, owner_id)
				values ($1, $2, $3, $4, $5, $6, $7) returning id::text`, sp, parent, depth, kind, title, home, kotova).Scan(&id)
			return id, err
		}
		home, err := node(space, nil, 1, "page", "Обзор", true)
		wantOK("home page", err)
		_, err = node(space, nil, 1, "page", "Второй обзор", true)
		wantState("second home page", err, "23505")
		_, err = node(space, home, 2, "page", "Главная внутри", true)
		wantState("home page with a parent", err, "23514")
		folder, err := node(space, nil, 1, "folder", "Регламенты", false)
		wantOK("folder", err)
		_, err = node(other, folder, 2, "page", "Чужой родитель", false)
		wantState("parent of another space", err, "23503")
		_, err = node(space, folder, 7, "page", "Седьмой уровень", false)
		wantState("deeper than six levels", err, "23514")
		_, err = node(space, folder, 2, "board", "Доска", false)
		wantState("unknown kind", err, "23514")
		page, err := node(space, folder, 2, "page", "Регламент приёмки смены", false)
		wantOK("page", err)
		wantState("diagram steps on a page", exec(`update kb.nodes set diagram = '{"steps": ["Начало"], "out": []}'
			where id = $1`, page), "23514")

		// Возврат 1 (ревью): глубина — глубина родителя + 1 (составной FK, отложенный до конца транзакции), поэтому
		// цикл в дереве невозможен; перенос ветки меняет глубины узла и потомков одной транзакцией.
		_, err = node(space, folder, 3, "page", "Через уровень", false)
		wantState("depth is not the parent's + 1", err, "23503")
		branch, err := node(space, folder, 2, "folder", "Смены", false)
		wantOK("branch", err)
		leaf, err := node(space, branch, 3, "page", "Ночная смена", false)
		wantOK("leaf", err)
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		_, err = tx.ExecContext(ctx, `update kb.nodes set parent_id = null, depth = 1 where id = $1`, branch)
		wantOK("move the branch up", err)
		_, err = tx.ExecContext(ctx, `update kb.nodes set depth = 2 where id = $1`, leaf)
		wantOK("the leaf follows", err)
		wantOK("move a branch in one transaction", tx.Commit())
		wantState("move a branch without its leaves", exec(`update kb.nodes set parent_id = $2, depth = 2 where id = $1`,
			branch, folder), "23503")
		wantState("cycle in the tree", exec(`update kb.nodes set parent_id = $2, depth = 3 where id = $1`, branch, leaf),
			"23503")

		// Версии: номер на узел уникален, текст до 200 000 символов (проекция knowledge/pages).
		version := func(v int, body string) error {
			return exec(`insert into kb.versions (node_id, version, title, body, published_by, author_name)
				values ($1, $2, 'Регламент приёмки смены', $3, $4, 'Марина Котова')`, page, v, body, kotova)
		}
		wantOK("version 1", version(1, "Менеджер проверяет фото до и после."))
		wantState("version 1 again", version(1, "Другой текст"), "23505")

		// Записи доступа: связь — без ref_id, с видом и записью; роль — с областью; прочие — с ref_id.
		entry := func(pos int, who string, ref, relation, objID, unitID any, can string) error {
			var module, typ any
			if objID != nil {
				module, typ = "repairs", "project"
			}
			return exec(`insert into kb.node_access (node_id, position, who, ref_id, relation, object_module, object_type,
				object_id, org_unit_id, can) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
				page, pos, who, ref, relation, module, typ, objID, unitID, can)
		}
		obj := "6b1b3a52-6d2e-4f43-9b7a-0a7c2e4f1d42"
		wantOK("member entry", entry(1, "member", driver, nil, nil, nil, "view"))
		wantOK("role entry in a unit", entry(2, "role", "0b7f6c1e-0c55-4a8a-9c3e-6f0d2d1c7a10", nil, nil, unit, "view"))
		wantOK("relation entry", entry(3, "relation", nil, "foreman", obj, nil, "edit"))
		wantState("relation without the record", entry(4, "relation", nil, "foreman", nil, nil, "view"), "23514")
		wantState("member without ref", entry(5, "member", nil, nil, nil, nil, "view"), "23514")
		wantState("unit on a member entry", entry(6, "member", driver, nil, nil, unit, "view"), "23514")
		wantState("unknown can", entry(7, "group", driver, nil, nil, nil, "comment"), "23514")
		wantState("same position", entry(1, "member", kotova, nil, nil, nil, "edit"), "23505")

		// Ознакомление: одно на узел; подтверждение версии — один раз.
		wantOK("ack", exec(`insert into kb.acks (node_id, version, audience_who) values ($1, 1, 'all')`, page))
		wantState("ack audience all with a ref", exec(`insert into kb.acks (node_id, version, audience_who, audience_ref)
			values ($1, 1, 'all', $2)`, folder, driver), "23514")
		wantOK("confirmation", exec(`insert into kb.ack_log (node_id, member_id, version) values ($1, $2, 1)`, page, driver))
		wantState("confirmation twice", exec(`insert into kb.ack_log (node_id, member_id, version) values ($1, $2, 1)`,
			page, driver), "23505")

		// Запросы: один открытый на узел и сотрудника; срок — только у одобренного запроса чтения.
		request := func(can, status string, until any) error {
			var decided any
			if status != "open" {
				decided = "2026-10-01 10:00Z"
			}
			return exec(`insert into kb.requests (node_id, space_id, member_id, can, status, decided_at, until)
				values ($1, $2, $3, $4, $5, $6, $7)`, page, space, driver, can, status, decided, until)
		}
		wantOK("open request", request("edit", "open", nil))
		wantState("second open request", request("edit", "open", nil), "23505")
		wantState("decided without the moment", exec(`insert into kb.requests (node_id, space_id, member_id, can, status)
			values ($1, $2, $3, 'edit', 'denied')`, page, space, driver), "23514")
		wantState("until on an edit request", request("edit", "approved", "2026-10-31"), "23514")
		wantOK("approved request to read for 30 days", request("view", "approved", "2026-10-31"))
		// Возврат 1 (ревью): пространство запроса — пространство узла (по нему строится список руководителя).
		wantState("request with a space other than the node's", exec(`insert into kb.requests (node_id, space_id, member_id,
			can) values ($1, $2, $3, 'view')`, page, other, kotova), "23503")

		// Правила и запуски: виды эталона, итог запуска.
		rule := scalar[string](t, db, `insert into kb.rules (space_id, kind, name, trigger) values ($1, 'review',
			'Пора пересмотреть страницу → уведомить владельца', 'По расписанию · каждый день в 09:00') returning id::text`, space)
		wantState("unknown rule kind", exec(`insert into kb.rules (space_id, kind, name, trigger) values ($1, 'copy', 'x', 'y')`,
			space), "23514")
		wantOK("run", exec(`insert into kb.runs (space_id, rule_id, result, text)
			values ($1, $2, 'stopped', 'Остановлено условием: сроки пересмотра не наступили')`, space, rule))
		wantState("unknown run result", exec(`insert into kb.runs (space_id, rule_id, result, text) values ($1, $2, 'skipped', 'x')`,
			space, rule), "23514")
		// Возврат 1 (ревью): пространство запуска — пространство правила (журнал запусков пространства).
		wantState("run with a space other than the rule's", exec(`insert into kb.runs (space_id, rule_id, result, text)
			values ($1, $2, 'ok', 'x')`, other, rule), "23503")

		// Таблицы страницы: название уникально на странице, строки — объект ячеек.
		table := scalar[string](t, db, `insert into kb.tables (node_id, title, columns)
			values ($1, 'Осмотры', '[{"id": "c-at", "name": "Дата", "type": "text"}]') returning id::text`, page)
		wantState("table title taken", exec(`insert into kb.tables (node_id, title, columns) values ($1, 'осмотры', '[]')`, page),
			"23505")
		wantOK("row", exec(`insert into kb.table_rows (table_id, cells, response_number, form_version)
			values ($1, '{"c-at": "27.09 09:05"}', 'R-1012', 3)`, table))
		wantState("row cells not an object", exec(`insert into kb.table_rows (table_id, cells) values ($1, '[]')`, table), "23514")
	})
}
