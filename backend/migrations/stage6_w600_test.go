package migrations_test

import (
	"regexp"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// tenant 0050–0054 и control 0010 контрактного PR этапа 6 (W6.00, контракт 0.12.0-stage6): схема repairs «Ремонта и
// стройки» (W6.11–W6.16) — 28 таблиц в пяти миграциях: ядро (объекты, бригада без входа, работы, отметки, допработы,
// лента), замер и сметы (версии, справочник расценок, шаблоны), график, снабжение, документы и кабинет заказчика.
// Down каждой миграции снимает ровно её объекты (без cascade). Модуль пишет только в свою схему: ссылки на org, people
// допустимы, на tasks, kb, fleet, inventory — нет (задача заявки и склад — идентификаторы без внешних ключей).
type w600File struct {
	name   string
	prefix string
	up     []string
	down   []string
}

var w600Files = []w600File{
	{
		name:   "0050_repairs_core.sql",
		prefix: "-- W6.00 · tenant 0050 · ",
		up: []string{
			`create schema if not exists repairs`,
			`create table repairs\.projects`,
			`status\s+text not null default 'active' check \(status in \('draft', 'planned', 'active', 'completed', 'archived', 'handed_over'\)\)`,
			`foreman_id\s+uuid references people\.person_profiles \(id\)`,
			`budget_minor\s+bigint check \(budget_minor is null or budget_minor between 0 and 9007199254740991\)`,
			`constraint projects_draft_no_foreman check \(status <> 'draft' or foreman_id is null\)`,
			`constraint projects_handover check \(\(status = 'handed_over'\) = \(handed_over_on is not null\)\)`,
			`create unique index projects_lead_idx on repairs\.projects \(lead_task_id\) where lead_task_id is not null`,
			`create table repairs\.workers`,
			`create table repairs\.works`,
			`unit\s+text not null check \(unit in \('hour', 'm2', 'm3', 'm', 'piece', 'set', 'trip', 'mesh', 'liter'\)\)`,
			`create sequence repairs\.work_log_number_seq`,
			`create table repairs\.work_logs`,
			`status\s+text not null default 'submitted' check \(status in \('submitted', 'accepted', 'rejected'\)\)`,
			`evidence_file_ids\s+uuid\[\] not null check \(cardinality\(evidence_file_ids\) >= 1\)`,
			`constraint work_logs_review check`,
			`create unique index work_logs_number_idx on repairs\.work_logs \(number\)`,
			`create table repairs\.work_log_lines`,
			`primary key \(work_log_id, line_no\)`,
			`create table repairs\.change_orders`,
			`status\s+text not null default 'proposed' check \(status in \('proposed', 'priced', 'sent', 'signed', 'rejected'\)\)`,
			`photo_file_ids\s+uuid\[\] not null check \(cardinality\(photo_file_ids\) >= 1\)`,
			`constraint change_orders_reject check \(\(status = 'rejected'\) = \(reject_reason is not null\)\)`,
			`create unique index change_orders_seq_idx on repairs\.change_orders \(project_id, seq\)`,
			`create table repairs\.project_events`,
		},
		down: []string{
			`drop table repairs\.project_events`,
			`drop table repairs\.change_orders`,
			`drop table repairs\.work_log_lines`,
			`drop table repairs\.work_logs`,
			`drop sequence repairs\.work_log_number_seq`,
			`drop table repairs\.works`,
			`drop table repairs\.workers`,
			`drop table repairs\.projects`,
			`drop schema repairs`,
		},
	},
	{
		name:   "0051_repairs_estimates.sql",
		prefix: "-- W6.00 · tenant 0051 · ",
		up: []string{
			`create table repairs\.measurements`,
			`primary key \(project_id, version\)`,
			`create table repairs\.price_items`,
			`kind\s+text not null check \(kind in \('work', 'material'\)\)`,
			`create unique index price_items_name_idx on repairs\.price_items \(lower\(btrim\(name\)\)\) where not archived`,
			`create table repairs\.templates`,
			`source\s+text not null check \(source in \('ortus', 'own'\)\)`,
			`warranty_months\s+integer not null default 24 check \(warranty_months between 1 and 120\)`,
			`create table repairs\.template_lines`,
			`part\s+text not null check \(part in \('estimate', 'material'\)\)`,
			`formula\s+text check \(formula is null or formula in \('floor', 'floor_dry', 'walls', 'walls_dry', 'wet', 'perimeter', 'perimeter_dry'\)\)`,
			`constraint template_lines_volume check \(\(quantity is null\) <> \(formula is null\)\)`,
			`create table repairs\.template_stages`,
			`create table repairs\.estimates`,
			`kind\s+text not null check \(kind in \('first', 'revision', 'change'\)\)`,
			`state\s+text not null default 'draft' check \(state in \('draft', 'sent', 'approved', 'replaced'\)\)`,
			`discount_pct\s+integer not null default 0 check \(discount_pct between 0 and 100\)`,
			`create unique index estimates_version_idx on repairs\.estimates \(project_id, version\)`,
			`create unique index estimates_open_idx on repairs\.estimates \(project_id\) where state in \('draft', 'sent'\)`,
			`create table repairs\.estimate_sections`,
			`create table repairs\.estimate_lines`,
			`manual\s+boolean not null default false`,
			`line_key\s+uuid not null default gen_random_uuid\(\)`,
			`create unique index estimate_lines_key_idx on repairs\.estimate_lines \(estimate_id, line_key\)`,
			`alter table repairs\.projects add constraint projects_template_fk foreign key \(template_id\) references repairs\.templates \(id\)`,
			`alter table repairs\.works add constraint works_estimate_line_fk foreign key \(estimate_line_id\) references repairs\.estimate_lines \(id\)`,
		},
		down: []string{
			`alter table repairs\.works drop constraint works_estimate_line_fk`,
			`alter table repairs\.projects drop constraint projects_template_fk`,
			`drop table repairs\.estimate_lines`,
			`drop table repairs\.estimate_sections`,
			`drop table repairs\.estimates`,
			`drop table repairs\.template_stages`,
			`drop table repairs\.template_lines`,
			`drop table repairs\.templates`,
			`drop table repairs\.price_items`,
			`drop table repairs\.measurements`,
		},
	},
	{
		name:   "0052_repairs_schedule.sql",
		prefix: "-- W6.00 · tenant 0052 · ",
		up: []string{
			`alter table repairs\.projects add column schedule_revision integer not null default 1`,
			`create table repairs\.schedule_stages`,
			`status\s+text not null default 'planned' check \(status in \('planned', 'started', 'done'\)\)`,
			`duration_wd\s+integer not null check \(duration_wd >= 1\)`,
			`create table repairs\.schedule_links`,
			`lag_days\s+integer not null default 0 check \(lag_days between -60 and 60\)`,
			`constraint schedule_links_distinct check \(from_stage_id <> to_stage_id\)`,
			`create unique index schedule_links_pair_idx on repairs\.schedule_links \(from_stage_id, to_stage_id\)`,
			`create table repairs\.schedule_baselines`,
			`create unique index schedule_baselines_version_idx on repairs\.schedule_baselines \(project_id, version\)`,
			`create table repairs\.schedule_changes`,
			`reason\s+text check \(reason is null or reason in \('client_request', 'material_delay', 'executor_busy', 'rework', 'weather_or_drying', 'scope_change', 'other'\)\)`,
			`create table repairs\.work_calendars`,
		},
		down: []string{
			`drop table repairs\.work_calendars`,
			`drop table repairs\.schedule_changes`,
			`drop table repairs\.schedule_baselines`,
			`drop table repairs\.schedule_links`,
			`drop table repairs\.schedule_stages`,
			`alter table repairs\.projects drop column schedule_revision`,
		},
	},
	{
		name:   "0053_repairs_supply.sql",
		prefix: "-- W6.00 · tenant 0053 · ",
		up: []string{
			`create sequence repairs\.supply_request_number_seq`,
			`create table repairs\.supply_requests`,
			`state\s+text not null default 'request' check \(state in \('request', 'reserved', 'issued', 'ordered', 'bought', 'used'\)\)`,
			`quantity\s+numeric\(14, 3\) not null check \(quantity > 0\)`,
			`create unique index supply_requests_number_idx on repairs\.supply_requests \(number\)`,
			`create table repairs\.purchases`,
			`state\s+text not null default 'ordered' check \(state in \('ordered', 'received'\)\)`,
			`constraint purchases_received check \(\(state = 'received'\) = \(received_at is not null\)\)`,
			`create table repairs\.purchase_lines`,
			`create unique index purchase_lines_request_idx on repairs\.purchase_lines \(supply_request_id\)`,
			`alter table repairs\.supply_requests add constraint supply_requests_purchase_fk foreign key \(purchase_id\) references repairs\.purchases \(id\)`,
			`create table repairs\.project_stock`,
			`primary key \(project_id, price_item_id\)`,
		},
		down: []string{
			`drop table repairs\.project_stock`,
			`alter table repairs\.supply_requests drop constraint supply_requests_purchase_fk`,
			`drop table repairs\.purchase_lines`,
			`drop table repairs\.purchases`,
			`drop table repairs\.supply_requests`,
			`drop sequence repairs\.supply_request_number_seq`,
		},
	},
	{
		name:   "0054_repairs_documents_cabinet.sql",
		prefix: "-- W6.00 · tenant 0054 · ",
		up: []string{
			`create table repairs\.documents`,
			`kind\s+text not null check \(kind in \('contract', 'agreement', 'act', 'invoice', 'handover_act', 'warranty'\)\)`,
			`state\s+text not null default 'draft' check \(state in \('draft', 'wait', 'sms', 'signed', 'paid'\)\)`,
			`sign_code_hash\s+text`,
			`constraint documents_signed check \(\(state in \('signed', 'paid'\)\) = \(signed_at is not null\)\)`,
			`create table repairs\.crew_accruals`,
			`state\s+text not null default 'pending_act' check \(state in \('pending_act', 'accrued', 'proposed', 'paid'\)\)`,
			`create unique index crew_accruals_act_idx on repairs\.crew_accruals \(act_id, worker_id\)`,
			`create table repairs\.subcontractors`,
			`create table repairs\.client_links`,
			`token_digest\s+text not null check \(token_digest ~ '\^sha256:\[0-9a-f\]\{64\}\$'\)`,
			`create unique index client_links_digest_idx on repairs\.client_links \(token_digest\)`,
			`create unique index client_links_active_idx on repairs\.client_links \(project_id\) where revoked_at is null`,
		},
		down: []string{
			`drop table repairs\.client_links`,
			`drop table repairs\.subcontractors`,
			`drop table repairs\.crew_accruals`,
			`drop table repairs\.documents`,
		},
	},
}

func TestStage6W600Migrations(t *testing.T) {
	t.Parallel()
	for _, f := range w600Files {
		t.Run(f.name, func(t *testing.T) {
			t.Parallel()
			text := readFile(t, migrations.Tenant, f.name)
			if !strings.HasPrefix(text, f.prefix) {
				t.Errorf("first line must start with %q", f.prefix)
			}
			up, down := stripComments(upBody(t, text)), stripComments(downBody(t, text))
			for _, re := range f.up {
				if !regexp.MustCompile(re).MatchString(up) {
					t.Errorf("Up lacks /%s/", re)
				}
			}
			for _, re := range f.down {
				if !regexp.MustCompile(re).MatchString(down) {
					t.Errorf("Down lacks /%s/", re)
				}
			}
			for _, other := range []string{"references tasks.", "references kb.", "references fleet.", "references inventory.", "references forms.", "references sched."} {
				if strings.Contains(up, other) {
					t.Errorf("Up must not reference another module (%s)", other)
				}
			}
			if strings.Contains(down, "cascade") {
				t.Error("Down must not use cascade")
			}
			if regexp.MustCompile(`\btoken\s+text`).MatchString(up) {
				t.Error("the cabinet token is never stored, only its digest")
			}
		})
	}
}

// Миграции 0050–0054 — блок этапа 6 без дыр; блок этапа 5 (0040–0049) может быть пуст до влития W5.00.
func TestStage6W600Numbering(t *testing.T) {
	t.Parallel()
	got := map[string]bool{}
	for _, n := range files(t, migrations.Tenant) {
		got[n] = true
	}
	for _, f := range w600Files {
		if !got[f.name] {
			t.Errorf("tenant %s is missing", f.name)
		}
	}
	for _, n := range []string{"0055", "0056"} {
		for name := range got {
			if strings.HasPrefix(name, n) {
				t.Errorf("%s is not issued by W6.00 (reserve 0055–0059)", name)
			}
		}
	}
}

// Публичный кабинет заказчика: гость приходит без тенанта, тенант находится по дайджесту токена в control 0010
// (прецедент — control 0009 public_form_links).
func TestStage6W600PublicClientLinkIndex(t *testing.T) {
	t.Parallel()
	const file = "0010_public_client_links.sql"
	text := readFile(t, migrations.Control, file)
	if want := "-- W6.00 · control 0010 · "; !strings.HasPrefix(text, want) {
		t.Errorf("first line must start with %q", want)
	}
	up, down := stripComments(upBody(t, text)), stripComments(downBody(t, text))
	for _, re := range []string{
		`create table public_client_links`,
		`token_digest\s+text primary key check \(token_digest ~ '\^sha256:\[0-9a-f\]\{64\}\$'\)`,
		`tenant_id\s+uuid not null references tenants\(id\)`,
		`project_id\s+uuid not null`,
		`link_id\s+uuid not null`,
		`revoked_at\s+timestamptz`,
		`unique \(tenant_id, link_id\)`,
		`create index public_client_links_project_idx on public_client_links \(tenant_id, project_id\)`,
		`comment on table public_client_links is '[^']*token_digest[^']*tenant_id[^']*repairs\.client_links[^']*'`,
	} {
		if !regexp.MustCompile(re).MatchString(up) {
			t.Errorf("control %s: Up lacks /%s/", file, re)
		}
	}
	if !regexp.MustCompile(`drop table public_client_links`).MatchString(down) {
		t.Errorf("control %s: Down lacks drop table public_client_links", file)
	}
	if strings.Contains(down, "cascade") {
		t.Error("Down must not use cascade")
	}
}
