package migrations_test

import (
	"regexp"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// tenant 0021–0022 контрактного PR 5 этапа 4 (W4.06, контракт 0.7.0-stage4): календарь ресурсов (W4.40) — подписи,
// рабочий день и пояс ресурсов, бронь календаря sched.bookings с буферами, видом источника, статусом и ревизией;
// «Данные» (W4.50) — схема data: сохранённые виды и задания выгрузки с журналом. Down снимает ровно эти объекты
// (без cascade).
func TestStage4W406Migrations(t *testing.T) {
	t.Parallel()
	cases := []struct {
		file string
		up   []string
		down []string
	}{
		{
			file: "0021_sched_calendar_bookings.sql",
			up: []string{
				`alter table sched\.resources`,
				`add column label text`,
				`add column time_zone text`,
				`add column workday_start time not null default '08:00'`,
				`add column workday_end time not null default '20:00'`,
				`add column active boolean not null default true`,
				`add constraint resources_workday check \(workday_start < workday_end\)`,
				`add constraint resources_label check \(kind in \('vehicle', 'person'\) or label is not null\)`,
				// Возврат 1: у помещения и оборудования нет объекта-источника — ref_id необязателен; пояс — имя IANA.
				`alter column ref_id drop not null`,
				`add constraint resources_ref check \(kind in \('room', 'equipment'\) or ref_id is not null\)`,
				`add constraint resources_time_zone check \(time_zone is null or time_zone ~ `,
				`constraint bookings_time_zone check \(time_zone ~ `,
				`create table sched\.bookings`,
				`org_unit_id\s+uuid not null references org\.units \(id\)`,
				`source_kind\s+text not null check \(source_kind in \('appointment', 'trip', 'maintenance', 'break', 'manual'\)\)`,
				`prep_minutes\s+integer not null default 0 check \(prep_minutes between 0 and 240\)`,
				`cleanup_minutes\s+integer not null default 0 check \(cleanup_minutes between 0 and 240\)`,
				`status\s+text not null default 'confirmed' check \(status in \('confirmed', 'cancelled'\)\)`,
				`constraint bookings_source_kind check`,
				`create index bookings_during_idx on sched\.bookings using gist \(during\) where status = 'confirmed'`,
				`create unique index bookings_source_idx on sched\.bookings`,
			},
			down: []string{
				`drop table sched\.bookings`,
				`update sched\.resources set ref_id = id where ref_id is null`,
				`alter column ref_id set not null`,
				`drop constraint resources_time_zone`,
				`drop constraint resources_ref`,
				`drop constraint resources_label`,
				`drop constraint resources_workday`,
				`drop column active`,
				`drop column workday_end`,
				`drop column workday_start`,
				`drop column time_zone`,
				`drop column label`,
			},
		},
		{
			file: "0022_data_views_export_jobs.sql",
			up: []string{
				`create schema if not exists data`,
				`create table data\.saved_views`,
				`visibility\s+text not null default 'personal' check \(visibility in \('personal', 'shared'\)\)`,
				`owner_id\s+uuid not null references people\.person_profiles \(id\)`,
				`create unique index saved_views_personal_name on data\.saved_views \(owner_id, dataset_id, lower\(name\)\)\s+where visibility = 'personal'`,
				`create unique index saved_views_shared_name on data\.saved_views \(dataset_id, lower\(name\)\)\s+where visibility = 'shared'`,
				`create table data\.export_jobs`,
				`view_id\s+uuid references data\.saved_views \(id\) on delete set null`,
				`state\s+text not null default 'queued'\s+check \(state in \('queued', 'running', 'ready', 'failed', 'expired', 'revoked'\)\)`,
				`row_limit\s+integer not null default 100000 check \(row_limit between 1 and 100000\)`,
				`constraint export_jobs_ready check`,
				`constraint export_jobs_failed check`,
				`constraint export_jobs_revoked check`,
				`constraint export_jobs_time_zone check \(time_zone ~ `,
				`create index export_jobs_active_idx on data\.export_jobs \(state, created_at\)\s+where state in \('queued', 'running'\)`,
			},
			down: []string{
				`drop table data\.export_jobs`,
				`drop table data\.saved_views`,
				`drop schema data`,
			},
		},
	}
	for _, c := range cases {
		t.Run(c.file, func(t *testing.T) {
			t.Parallel()
			text := readFile(t, migrations.Tenant, c.file)
			if want := "-- W4.06 · tenant " + c.file[:4] + " · "; !strings.HasPrefix(text, want) {
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
