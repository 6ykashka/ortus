package migrations_test

import (
	"regexp"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// Миграции контрактного PR этапа 2 (W2.00, план v2 §3.5, PD-59): tenant 0010–0012 из блока этапа 2.
// Номер выдал стюард; Up добавляет объекты шага, Down снимает ровно их (без cascade).
func TestStage2Migrations(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		file string
		up   []string
		down []string
	}{
		{
			name: "tenant 0010 очередь блокирующих дефектов и решение менеджера (S2-17)",
			file: "0010_fleet_defect_queue.sql",
			up: []string{
				`alter table fleet\.defects`,
				`add column trip_id\s+uuid references fleet\.trips\(id\)`,
				`add column reported_by\s+uuid`,
				`add column decision\s+text check \(decision in \('allow_departure','confirm_out_of_service'\)\)`,
				`add column decision_comment\s+text`,
				`add column revision\s+integer not null default 1`,
				// Решение ↔ состояние: решённый дефект несёт автора и время; в очереди — только блокирующие без решения.
				`constraint defects_decision_resolved check \(decision is null or \(resolved_by is not null and resolved_at is not null\)\)`,
				`constraint defects_decision_state check \(decision is null or state = case decision`,
				`constraint defects_open_undecided check \(state not in \('open','in_review'\) or decision is null\)`,
				`constraint defects_review_blocking check \(state <> 'in_review' or severity = 'blocking'\)`,
				`create index defects_review_queue_idx on fleet\.defects \(created_at, id\)\s+where state = 'in_review'`,
				`create index defects_trip_idx on fleet\.defects \(trip_id\)`,
			},
			down: []string{
				`drop index fleet\.defects_trip_idx`,
				`drop index fleet\.defects_review_queue_idx`,
				`drop constraint defects_review_blocking`,
				`drop column trip_id`,
				`drop column decision_comment`,
			},
		},
		{
			name: "tenant 0011 повторная сдача после доработки и разделы приёмки (S2-10, Q-51)",
			file: "0011_fleet_trip_rework.sql",
			up: []string{
				`add column attempt\s+integer not null default 1 check \(attempt > 0\)`,
				`add column comment\s+text`,
				`drop constraint inspections_trip_id_kind_key`,
				`add constraint inspections_trip_kind_attempt_key unique \(trip_id, kind, attempt\)`,
				`create table fleet\.trip_reviews \(`,
				`decision\s+text not null check \(decision in \('approve','reject','maintenance_required','rework'\)\)`,
				`steps\s+text\[\] not null default '\{\}' check \(steps <@ array\['photos','odometer','expenses','checklist'\]::text\[\]\)`,
				`unique \(trip_id, attempt\)`,
				`check \(decision <> 'rework' or \(length\(btrim\(coalesce\(comment, ''\)\)\) > 0 and cardinality\(steps\) > 0\)\)`,
				`check \(decision = 'rework' or cardinality\(steps\) = 0\)`,
			},
			down: []string{
				`drop table fleet\.trip_reviews`,
				`drop constraint inspections_trip_kind_attempt_key`,
				`add constraint inspections_trip_id_kind_key unique \(trip_id, kind\)`,
				`drop column attempt`,
			},
		},
		{
			name: "tenant 0012 поля плана рейса и машины (Q-45, S2-13)",
			file: "0012_fleet_trip_plan.sql",
			up: []string{
				`alter table fleet\.trips`,
				`add column title\s+text`,
				`add column cargo_description\s+text`,
				`add column distance_km\s+numeric\(8,1\)`,
				`add column route_completed_at\s+timestamptz`,
				`constraint trips_route_completed check \(state <> 'returning' or route_completed_at is not null\)`,
				`alter table fleet\.vehicles`,
				`add column display_name\s+text`,
				`add column depot\s+text`,
				`add column service_note\s+text`,
			},
			down: []string{
				`drop constraint trips_route_completed`,
				`drop column route_completed_at`,
				`drop column display_name`,
				`drop column service_note`,
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			text := readFile(t, migrations.Tenant, tt.file)
			wantHeader := "-- W2.00 · tenant " + tt.file[:4] + " · "
			if !strings.HasPrefix(text, wantHeader) {
				t.Errorf("first line must start with %q", wantHeader)
			}
			up, down := stripComments(upBody(t, text)), stripComments(downBody(t, text))
			for _, re := range tt.up {
				if !regexp.MustCompile(re).MatchString(up) {
					t.Errorf("Up lacks /%s/", re)
				}
			}
			for _, re := range tt.down {
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
