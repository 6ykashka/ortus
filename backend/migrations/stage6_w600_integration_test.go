//go:build integration

package migrations_test

import (
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// tenant 0050–0054 (W6.00) на реальном сервере под runtime-ролью API: объект-черновик без прораба, сдача с датой,
// одна заявка — один объект, отметка с фото и ревью, допработа с фото и отказом с причиной, версия сметы и единственная
// открытая, справочник без дублей, строка шаблона «количество или формула», связи графика, заявка снабжения по
// состоянию, закупка и строка, документ по коду SMS, начисление по акту, ссылка кабинета только хешем.
func TestStage6W600Constraints(t *testing.T) {
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
			values ('company', 'Альта Групп', 'Europe/Moscow') returning id::text`)
		zimina := scalar[string](t, db, `insert into people.person_profiles (full_name, home_unit_id)
			values ('Дарья Зимина', $1) returning id::text`, unit)
		sokolov := scalar[string](t, db, `insert into people.person_profiles (full_name, home_unit_id)
			values ('Алексей Соколов', $1) returning id::text`, unit)

		// Объект: черновик без прораба, сданный — с датой сдачи, одна заявка — один объект.
		lead := "30000000-0000-4000-8000-000000000001"
		draft := scalar[string](t, db, `insert into repairs.projects (org_unit_id, name, address, status, lead_task_id, created_by)
			values ($1, 'Дом 120 м², Истра', 'д. Лесная, 14', 'draft', $2, $3) returning id::text`, unit, lead, zimina)
		wantState("draft with a foreman", exec(`insert into repairs.projects (org_unit_id, name, address, status, foreman_id)
			values ($1, 'Дом', 'адрес', 'draft', $2)`, unit, sokolov), "23514")
		wantState("second object of a lead", exec(`insert into repairs.projects (org_unit_id, name, address, status, lead_task_id)
			values ($1, 'Дом 2', 'адрес', 'draft', $2)`, unit, lead), "23505")
		wantState("unknown status", exec(`insert into repairs.projects (org_unit_id, name, address, status)
			values ($1, 'Объект', 'адрес', 'frozen')`, unit), "23514")
		wantState("empty name", exec(`insert into repairs.projects (org_unit_id, name, address) values ($1, ' ', 'адрес')`, unit), "23514")
		wantState("negative budget", exec(`insert into repairs.projects (org_unit_id, name, address, budget_minor)
			values ($1, 'Объект', 'адрес', -1)`, unit), "23514")
		project := scalar[string](t, db, `insert into repairs.projects (org_unit_id, name, address, status, foreman_id, budget_minor)
			values ($1, 'ЖК Речной · кв. 42', 'Речная, 7', 'active', $2, 43817500) returning id::text`, unit, sokolov)
		wantState("handed over without a date", exec(`update repairs.projects set status = 'handed_over' where id = $1`, project), "23514")
		wantOK("handed over", exec(`update repairs.projects set status = 'handed_over', handed_over_on = '2026-11-27',
			warranty_until = '2028-11-27' where id = $1`, project))
		wantOK("back to active clears nothing", exec(`update repairs.projects set status = 'active', handed_over_on = null where id = $1`, project))

		// Бригада и работы.
		worker := scalar[string](t, db, `insert into repairs.workers (project_id, display_name, trade)
			values ($1, 'Иван Петров', 'электрик') returning id::text`, project)
		wantState("worker status", exec(`update repairs.workers set status = 'fired' where id = $1`, worker), "23514")
		work := scalar[string](t, db, `insert into repairs.works (project_id, name, unit, plan_qty)
			values ($1, 'Подготовка стен', 'm2', 210) returning id::text`, project)
		wantState("unit of a work", exec(`insert into repairs.works (project_id, name, unit, plan_qty) values ($1, 'X', 'kg', 1)`, project), "23514")
		wantState("negative fact", exec(`update repairs.works set fact_qty = -1 where id = $1`, work), "23514")

		// Отметка: ≥ 1 фото, статус и ревью, причина возврата, номер уникален.
		photo := "40000000-0000-4000-8000-000000000001"
		mark := func(num, status string, photos string, reviewer any, reason any) (string, error) {
			var id string
			err := db.QueryRowContext(ctx, `insert into repairs.work_logs (number, project_id, submitted_by, work_date, time_zone,
				status, evidence_file_ids, reviewed_by, reviewed_at, return_reason)
				values ($1, $2, $3, '2026-10-20', 'Europe/Moscow', $4, $5::uuid[], $6, case when $6::uuid is null then null else now() end, $7)
				returning id::text`, num, project, sokolov, status, photos, reviewer, reason).Scan(&id)
			return id, err
		}
		log1, err := mark("WL-1", "submitted", "{"+photo+"}", nil, nil)
		wantOK("submitted mark", err)
		_, err = mark("WL-2", "submitted", "{}", nil, nil)
		wantState("mark without a photo", err, "23514")
		_, err = mark("WL-1", "submitted", "{"+photo+"}", nil, nil)
		wantState("number taken", err, "23505")
		_, err = mark("WL-3", "accepted", "{"+photo+"}", nil, nil)
		wantState("accepted without a reviewer", err, "23514")
		_, err = mark("WL-4", "submitted", "{"+photo+"}", zimina, nil)
		wantState("submitted with a reviewer", err, "23514")
		_, err = mark("WL-5", "rejected", "{"+photo+"}", zimina, nil)
		wantState("returned without a reason", err, "23514")
		_, err = mark("WL-6", "rejected", "{"+photo+"}", zimina, "Не видно объём")
		wantOK("returned with a reason", err)
		wantOK("line", exec(`insert into repairs.work_log_lines (work_log_id, line_no, work_id, quantity, unit)
			values ($1, 1, $2, 12.5, 'm2')`, log1, work))
		wantState("zero volume", exec(`insert into repairs.work_log_lines (work_log_id, line_no, work_id, quantity, unit)
			values ($1, 2, $2, 0, 'm2')`, log1, work), "23514")
		wantState("same line twice", exec(`insert into repairs.work_log_lines (work_log_id, line_no, work_id, quantity, unit)
			values ($1, 1, $2, 1, 'm2')`, log1, work), "23505")

		// Допработа: фото, номер внутри объекта, отказ только с причиной из четырёх.
		order := func(seq int, status string, reason any) error {
			return exec(`insert into repairs.change_orders (project_id, seq, title, quantity, unit, photo_file_ids, status,
				reject_reason, created_by) values ($1, $2, 'Перенос розетки', 6, 'piece', array[$3::uuid], $4, $5, $6)`,
				project, seq, photo, status, reason, sokolov)
		}
		wantOK("change order", order(1, "proposed", nil))
		wantState("same number", order(1, "proposed", nil), "23505")
		wantState("rejected without a reason", order(2, "rejected", nil), "23514")
		wantState("reason without a rejection", order(3, "priced", "warranty"), "23514")
		wantState("unknown reason", order(4, "rejected", "boring"), "23514")
		wantOK("rejected", order(5, "rejected", "client_refused"))
		wantState("no photo", exec(`insert into repairs.change_orders (project_id, seq, title, quantity, unit, photo_file_ids, created_by)
			values ($1, 9, 'X', 1, 'm', '{}', $2)`, project, sokolov), "23514")

		// Справочник: название уникально без учёта регистра среди действующих, шаблон — количество или формула.
		item := scalar[string](t, db, `insert into repairs.price_items (section, name, unit, kind, price_minor)
			values ('Электрика', 'Штробление бетона', 'm', 'work', 45000) returning id::text`)
		wantState("duplicate item", exec(`insert into repairs.price_items (section, name, unit, kind, price_minor)
			values ('Электрика', 'штробление БЕТОНА', 'm', 'work', 1)`), "23505")
		wantOK("archive", exec(`update repairs.price_items set archived = true where id = $1`, item))
		wantOK("same name after archive", exec(`insert into repairs.price_items (section, name, unit, kind, price_minor)
			values ('Электрика', 'Штробление бетона', 'm', 'work', 50000)`))
		tpl := scalar[string](t, db, `insert into repairs.templates (name, kind, source) values ('Капитальный ремонт квартиры', 'capital', 'ortus')
			returning id::text`)
		wantOK("template line by formula", exec(`insert into repairs.template_lines (template_id, part, section, price_item_id, formula, coef)
			values ($1, 'estimate', 'Полы', $2, 'floor_dry', 1.1)`, tpl, item))
		wantState("line with both", exec(`insert into repairs.template_lines (template_id, part, section, price_item_id, quantity, formula)
			values ($1, 'estimate', 'Полы', $2, 3, 'floor')`, tpl, item), "23514")
		wantState("line with none", exec(`insert into repairs.template_lines (template_id, part, section, price_item_id)
			values ($1, 'estimate', 'Полы', $2)`, tpl, item), "23514")
		wantState("unknown formula", exec(`insert into repairs.template_lines (template_id, part, section, price_item_id, formula)
			values ($1, 'estimate', 'Полы', $2, 'ceiling')`, tpl, item), "23514")

		// Версии сметы: номер уникален, открытая (draft или sent) — одна на объект.
		est := scalar[string](t, db, `insert into repairs.estimates (project_id, version, kind, state, created_by)
			values ($1, 1, 'first', 'draft', $2) returning id::text`, project, zimina)
		wantState("second open estimate", exec(`insert into repairs.estimates (project_id, version, kind, state) values ($1, 2, 'revision', 'sent')`, project), "23505")
		wantState("same version", exec(`insert into repairs.estimates (project_id, version, kind, state, approved_at) values ($1, 1, 'revision', 'approved', now())`, project), "23505")
		wantState("approved without a date", exec(`update repairs.estimates set state = 'approved' where id = $1`, est), "23514")
		wantOK("approved", exec(`update repairs.estimates set state = 'approved', approved_at = now() where id = $1`, est))
		wantOK("next draft after approval", exec(`insert into repairs.estimates (project_id, version, kind, state, base_version) values ($1, 2, 'change', 'draft', 1)`, project))
		wantState("discount over 100", exec(`update repairs.estimates set discount_pct = 101 where project_id = $1 and version = 2`, project), "23514")
		section := scalar[string](t, db, `insert into repairs.estimate_sections (estimate_id, name) values ($1, 'Демонтаж') returning id::text`, est)
		line := scalar[string](t, db, `insert into repairs.estimate_lines (estimate_id, section_id, price_item_id, name, unit, kind, price_minor, quantity)
			values ($1, $2, $3, 'Штробление бетона', 'm', 'work', 45000, 9) returning id::text`, est, section, item)
		wantOK("work linked to the line", exec(`update repairs.works set estimate_line_id = $1 where id = $2`, line, work))
		wantOK("measurement", exec(`insert into repairs.measurements (project_id, version, rooms) values ($1, 1, '[{"name":"Кухня"}]')`, project))
		wantState("rooms not an array", exec(`insert into repairs.measurements (project_id, version, rooms) values ($1, 2, '{}')`, project), "23514")

		// График: связь не на себя и без дублей, причина переноса из семи.
		s1 := scalar[string](t, db, `insert into repairs.schedule_stages (project_id, name, duration_wd) values ($1, 'Демонтаж', 3) returning id::text`, project)
		s2 := scalar[string](t, db, `insert into repairs.schedule_stages (project_id, name, duration_wd, offset_wd) values ($1, 'Электрика', 5, 3) returning id::text`, project)
		wantOK("link", exec(`insert into repairs.schedule_links (project_id, from_stage_id, to_stage_id, lag_days) values ($1, $2, $3, -3)`, project, s1, s2))
		wantState("link to itself", exec(`insert into repairs.schedule_links (project_id, from_stage_id, to_stage_id) values ($1, $2, $2)`, project, s1), "23514")
		wantState("link twice", exec(`insert into repairs.schedule_links (project_id, from_stage_id, to_stage_id) values ($1, $2, $3)`, project, s1, s2), "23505")
		wantState("lag out of range", exec(`insert into repairs.schedule_links (project_id, from_stage_id, to_stage_id, lag_days) values ($1, $2, $3, 61)`, project, s2, s1), "23514")
		wantState("zero duration", exec(`insert into repairs.schedule_stages (project_id, name, duration_wd) values ($1, 'X', 0)`, project), "23514")
		wantOK("move with a reason", exec(`insert into repairs.schedule_changes (project_id, text, reason) values ($1, 'Электрика +2 дня', 'material_delay')`, project))
		wantState("move with an unknown reason", exec(`insert into repairs.schedule_changes (project_id, text, reason) values ($1, 'X', 'whim')`, project), "23514")
		wantOK("baseline", exec(`insert into repairs.schedule_baselines (project_id, version, due_on, snapshot) values ($1, 1, '2026-11-27', '{}')`, project))
		wantState("baseline twice", exec(`insert into repairs.schedule_baselines (project_id, version, due_on, snapshot) values ($1, 1, '2026-11-28', '{}')`, project), "23505")

		// Снабжение: состояние и склад или закупка, номер, закупка и её строка.
		req := func(num, state string, warehouse any, purchase any) error {
			return exec(`insert into repairs.supply_requests (number, project_id, price_item_id, quantity, need_by, state, warehouse_id, purchase_id, created_by)
				values ($1, $2, $3, 4, '2026-10-25', $4, $5, $6, $7)`, num, project, item, state, warehouse, purchase, sokolov)
		}
		wh := "50000000-0000-4000-8000-000000000001"
		wantOK("request", req("З-1", "request", nil, nil))
		wantState("number taken", req("З-1", "request", nil, nil), "23505")
		wantState("reserved without a warehouse", req("З-2", "reserved", nil, nil), "23514")
		wantOK("reserved", req("З-3", "reserved", wh, nil))
		wantState("ordered without a purchase", req("З-4", "ordered", nil, nil), "23514")
		wantState("warehouse on a plain request", req("З-5", "request", wh, nil), "23514")
		purchase := scalar[string](t, db, `insert into repairs.purchases (number, supplier, created_by) values ('ЗК-1', 'ООО «Стройбаза»', $1)
			returning id::text`, zimina)
		wantOK("ordered", req("З-6", "ordered", nil, purchase))
		reqID := scalar[string](t, db, `select id::text from repairs.supply_requests where number = 'З-6'`)
		wantOK("purchase line", exec(`insert into repairs.purchase_lines (purchase_id, supply_request_id, project_id, price_item_id, quantity, price_minor)
			values ($1, $2, $3, $4, 4, 9900)`, purchase, reqID, project, item))
		wantState("request in two purchases", exec(`insert into repairs.purchase_lines (purchase_id, supply_request_id, project_id, price_item_id, quantity, price_minor)
			values ($1, $2, $3, $4, 4, 9900)`, purchase, reqID, project, item), "23505")
		wantState("received without a date", exec(`update repairs.purchases set state = 'received' where id = $1`, purchase), "23514")
		wantOK("received", exec(`update repairs.purchases set state = 'received', receipt_qr = 't=20261020T1010&s=990.00', received_at = now() where id = $1`, purchase))
		wantOK("stock", exec(`insert into repairs.project_stock (project_id, price_item_id, quantity, cost_minor) values ($1, $2, 4, 39600)`, project, item))
		wantState("negative stock", exec(`update repairs.project_stock set quantity = -1 where project_id = $1`, project), "23514")

		// Документы и подпись: sms — только с хешем и сроком, подписан — с датой; начисление по акту; ссылка кабинета.
		act := scalar[string](t, db, `insert into repairs.documents (project_id, kind, title, estimate_version, act_no)
			values ($1, 'act', 'Акт № 1', 2, 1) returning id::text`, project)
		wantState("sms without a code", exec(`update repairs.documents set state = 'sms' where id = $1`, act), "23514")
		wantOK("sms", exec(`update repairs.documents set state = 'sms', sign_code_hash = 'hmac', sign_code_expires_at = now() + interval '10 minutes' where id = $1`, act))
		wantState("signed without a date", exec(`update repairs.documents set state = 'signed', sign_code_hash = null, sign_code_expires_at = null where id = $1`, act), "23514")
		wantOK("signed", exec(`update repairs.documents set state = 'signed', sign_code_hash = null, sign_code_expires_at = null, signed_at = now() where id = $1`, act))
		wantState("unknown document kind", exec(`insert into repairs.documents (project_id, kind, title) values ($1, 'letter', 'X')`, project), "23514")
		wantOK("accrual by act", exec(`insert into repairs.crew_accruals (project_id, worker_id, act_id, amount_minor, state)
			values ($1, $2, $3, 1500000, 'accrued')`, project, worker, act))
		wantState("accrual twice by an act", exec(`insert into repairs.crew_accruals (project_id, worker_id, act_id, amount_minor, state)
			values ($1, $2, $3, 1, 'accrued')`, project, worker, act), "23505")
		wantState("accrued without an act", exec(`insert into repairs.crew_accruals (project_id, worker_id, amount_minor, state)
			values ($1, $2, 1, 'accrued')`, project, worker), "23514")
		wantOK("pending accrual without an act", exec(`insert into repairs.crew_accruals (project_id, worker_id, amount_minor)
			values ($1, $2, 1)`, project, worker))
		wantOK("subcontractor", exec(`insert into repairs.subcontractors (project_id, name, scope, active, access_until)
			values ($1, 'ИП Орлов', 'электрика', true, '2026-10-31')`, project))
		wantState("active subcontractor without a term", exec(`insert into repairs.subcontractors (project_id, name, active) values ($1, 'ИП Седов', true)`, project), "23514")
		digest := "sha256:" + strings.Repeat("ab", 32)
		wantOK("client link", exec(`insert into repairs.client_links (project_id, token_digest, sent_to, issued_by) values ($1, $2, '+7 *** 21', $3)`, project, digest, zimina))
		wantState("a token itself", exec(`insert into repairs.client_links (project_id, token_digest) values ($1, 'secret-token-value')`, project), "23514")
		wantState("second active link", exec(`insert into repairs.client_links (project_id, token_digest) values ($1, $2)`, project, "sha256:"+strings.Repeat("cd", 32)), "23505")
		wantOK("revoke", exec(`update repairs.client_links set revoked_at = now() where token_digest = $1`, digest))
		wantOK("new link after the revocation", exec(`insert into repairs.client_links (project_id, token_digest) values ($1, $2)`, project, "sha256:"+strings.Repeat("cd", 32)))
		wantState("digest taken", exec(`insert into repairs.client_links (project_id, token_digest) values ($1, $2)`, draft, digest), "23505")

		// Лента и журнал переносов — только INSERT (roles/grants.sql).
		wantOK("event", exec(`insert into repairs.project_events (project_id, kind, text) values ($1, 'repairs.work_log.submitted', 'Отметка WL-1')`, project))
		wantState("event update", exec(`update repairs.project_events set text = 'x' where project_id = $1`, project), "42501")
		wantState("schedule change delete", exec(`delete from repairs.schedule_changes where project_id = $1`, project), "42501")
		wantState("bad event kind", exec(`insert into repairs.project_events (project_id, kind, text) values ($1, 'X', 'x')`, project), "23514")
	})
}

// control 0010: индекс публичных ссылок кабинета — дайджест токена в формате «sha256:» + hex, уникальный id ссылки
// внутри тенанта, отзыв.
func TestStage6W600PublicClientLinks(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		name, _ := migrated(t, c, migrations.Control)
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
		tenant := scalar[string](t, db, `insert into tenants (slug, display_name, industry_pack)
			values ('alta', 'Альта Групп', 'repair') returning id::text`)
		other := scalar[string](t, db, `insert into tenants (slug, display_name, industry_pack)
			values ('remstroy', 'Ремстрой Плюс', 'repair') returning id::text`)
		digest := "sha256:" + strings.Repeat("ab", 32)
		project, link := "60000000-0000-4000-8000-000000000001", "60000000-0000-4000-8000-000000000002"
		if err := exec(`insert into public_client_links (token_digest, tenant_id, project_id, link_id)
			values ($1, $2, $3, $4)`, digest, tenant, project, link); err != nil {
			t.Fatal(err)
		}
		wantState("digest taken", exec(`insert into public_client_links (token_digest, tenant_id, project_id, link_id)
			values ($1, $2, $3, $4)`, digest, other, project, link), "23505")
		wantState("same link of a tenant", exec(`insert into public_client_links (token_digest, tenant_id, project_id, link_id)
			values ($1, $2, $3, $4)`, "sha256:"+strings.Repeat("cd", 32), tenant, project, link), "23505")
		wantState("not a digest", exec(`insert into public_client_links (token_digest, tenant_id, project_id, link_id)
			values ('secret', $1, $2, $3)`, tenant, project, "60000000-0000-4000-8000-000000000003"), "23514")
		wantState("unknown tenant", exec(`insert into public_client_links (token_digest, tenant_id, project_id, link_id)
			values ($1, '70000000-0000-4000-8000-000000000001', $2, $3)`, "sha256:"+strings.Repeat("ef", 32), project,
			"60000000-0000-4000-8000-000000000004"), "23503")
		if err := exec(`update public_client_links set revoked_at = now() where token_digest = $1`, digest); err != nil {
			t.Fatal(err)
		}
		comment := scalar[string](t, db, `select coalesce(obj_description('public_client_links'::regclass, 'pg_class'), '')`)
		for _, want := range []string{"token_digest", "tenant_id", "repairs.client_links", "public_token_expired"} {
			if !strings.Contains(comment, want) {
				t.Errorf("comment of public_client_links lacks %q", want)
			}
		}
	})
}
