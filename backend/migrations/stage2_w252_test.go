package migrations_test

import (
	"regexp"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// tenant 0015–0017 стюарда контракта этапа 2, часть 2 (W2.52, контракт 0.6.1-stage2) — ответы владельца 17.10:
// справочник категорий расходов с посевом (D-12 комплекта, W2.41), история принадлежности машины и импорт CSV машин
// (модель данных п. 2, D-11 комплекта: W2.42, W2.50), антифрод фото, чек-лист в формате FormDefinition, поля задачи
// дефекта, адрес навигатора (модель данных п. 4, D-30, D-29 и D-11 комплекта: W2.43, W2.45, W2.46, W2.50). Down
// снимает ровно эти объекты (без cascade).
func TestStage2W252Migrations(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		file     string
		up, down []string
	}{
		{
			file: "0015_fleet_expense_categories.sql",
			up: []string{
				`create table fleet\.expense_categories \(`,
				`code\s+text primary key check \(code ~ '\^\[a-z\]\[a-z0-9_\]\{1,49\}\$'\)`,
				`comment_required boolean not null default false`,
				`seeded\s+boolean not null default false`,
				`constraint expense_categories_archived check \(\(archived_at is null\) = \(archived_by is null\)\)`,
				`constraint expense_categories_other check \(code <> 'other' or \(comment_required and archived_at is null\)\)`,
				`create unique index expense_categories_label_uq on fleet\.expense_categories \(lower\(btrim\(label\)\)\)\s+where archived_at is null`,
				`\('fuel', 'Топливо', false, true, 10\)`,
				`\('tire_service', 'Шиномонтаж и мелкий ремонт', false, true, 50\)`,
				`\('other', 'Прочее', true,\s+true, 60\)`,
				`drop constraint expenses_category_check`,
				`add constraint expenses_category_fk foreign key \(category\) references fleet\.expense_categories \(code\)`,
			},
			down: []string{
				`drop constraint expenses_category_fk`,
				`add constraint expenses_category_check\s+check \(category in \('fuel','wash','parking','toll','tire_service','other'\)\)`,
				`drop table fleet\.expense_categories`,
			},
		},
		{
			file: "0016_fleet_vehicle_assignments_imports.sql",
			up: []string{
				`create table fleet\.vehicle_assignments \(`,
				`vehicle_id\s+uuid not null references fleet\.vehicles \(id\) on delete cascade`,
				`valid_from\s+timestamptz not null`,
				`valid_to\s+timestamptz,`,
				`constraint vehicle_assignments_period check \(valid_to is null or valid_from < valid_to\)`,
				`constraint vehicle_assignments_no_overlap exclude using gist\s+\(vehicle_id with =, tstzrange\(valid_from, valid_to\) with &&\)`,
				`create unique index vehicle_assignments_open_uq on fleet\.vehicle_assignments \(vehicle_id\)\s+where valid_to is null`,
				`insert into fleet\.vehicle_assignments \(vehicle_id, unit_id, valid_from\)\s+select id, unit_id, created_at from fleet\.vehicles`,
				// Новая машина получает открытый период сама (писатели W2.02, W2.50 его не пишут); открытый период и
				// fleet.vehicles.unit_id сверяются при фиксации транзакции.
				`create function fleet\.vehicles_open_assignment\(\) returns trigger`,
				`create trigger vehicles_open_assignment after insert on fleet\.vehicles`,
				`create function fleet\.vehicle_assignment_check\(\) returns trigger`,
				`create constraint trigger vehicles_assignment_check after update of unit_id on fleet\.vehicles\s+deferrable initially deferred`,
				`create constraint trigger vehicle_assignments_check after insert or update on fleet\.vehicle_assignments\s+deferrable initially deferred`,
				`create table fleet\.vehicle_imports \(`,
				`create table fleet\.vehicle_import_rows \(`,
				`action\s+text not null check \(action in \('create','update','skip','error'\)\)`,
			},
			down: []string{
				`drop table fleet\.vehicle_import_rows`,
				`drop table fleet\.vehicle_imports`,
				`drop trigger vehicles_assignment_check on fleet\.vehicles`,
				`drop trigger vehicles_open_assignment on fleet\.vehicles`,
				`drop table fleet\.vehicle_assignments`,
				`drop function fleet\.vehicle_assignment_check\(\)`,
				`drop function fleet\.vehicles_open_assignment\(\)`,
			},
		},
		{
			file: "0017_fleet_inspection_evidence_tasks.sql",
			up: []string{
				`create index files_sha256_idx on files\.objects \(sha256, created_at\)\s+where sha256 is not null and state <> 'rejected'`,
				`alter table fleet\.inspection_photos`,
				`add column server_captured_at\s+timestamptz`,
				`add column duplicate_count\s+integer`,
				`update fleet\.inspection_photos p set server_captured_at = s\.completed_at\s+from files\.upload_sessions s`,
				`create function fleet\.checklist_definition\(text, jsonb, text\[\]\)`,
				`'Осмотр перед выездом'`,
				`'Осмотр при сдаче'`,
				`add column definition jsonb`,
				`update fleet\.checklist_versions set definition = fleet\.checklist_definition\(kind, items, required_photo_roles\)`,
				`alter column definition set not null`,
				`create trigger checklist_versions_definition before insert on fleet\.checklist_versions`,
				`add column assignee_id\s+uuid references people\.person_profiles \(id\)`,
				`add column due_at\s+timestamptz`,
				`add constraint defects_assignment_due check \(due_at is null or assignee_id is not null\)`,
				`create index defects_assignee_idx on fleet\.defects \(assignee_id, due_at\)`,
				`alter table fleet\.trip_stops\s+add column navigation_address text`,
			},
			down: []string{
				`drop trigger checklist_versions_definition on fleet\.checklist_versions`,
				`drop function fleet\.checklist_versions_fill_definition\(\)`,
				`drop function fleet\.checklist_definition\(text, jsonb, text\[\]\)`,
				`drop column definition`,
				`drop index fleet\.defects_assignee_idx`,
				`drop column assignee_id`,
				`drop column server_captured_at`,
				`drop index files\.files_sha256_idx`,
				`drop column navigation_address`,
			},
		},
	} {
		t.Run(c.file, func(t *testing.T) {
			t.Parallel()
			text := readFile(t, migrations.Tenant, c.file)
			if want := "-- W2.52 · tenant " + c.file[:4] + " · "; !strings.HasPrefix(text, want) {
				t.Errorf("first line must start with %q", want)
			}
			up, down := stripComments(upBody(t, text)), stripComments(downBody(t, text))
			for _, re := range c.up {
				if !regexp.MustCompile(re).MatchString(up) {
					t.Errorf("Up lacks /%s/", re)
				}
			}
			for _, re := range c.down {
				if !regexp.MustCompile(re).MatchString(down) {
					t.Errorf("Down lacks /%s/", re)
				}
			}
			if strings.Contains(down, "cascade") {
				t.Error("Down must not use cascade")
			}
		})
	}
}
