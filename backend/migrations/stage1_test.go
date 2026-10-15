package migrations_test

import (
	"regexp"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// downBody returns the text after «-- +goose Down».
func downBody(t *testing.T, text string) string {
	t.Helper()
	_, down, ok := strings.Cut(text, "\n-- +goose Down\n")
	if !ok {
		t.Fatal("no «-- +goose Down» marker")
	}
	return down
}

// Миграции блока этапа 1 (W0.08, план v2 §3.5, PD-59): номер выдал стюард, Up создаёт объекты шага,
// Down снимает ровно их. Порядок выражений внутри файла не проверяется — только наличие.
func TestStage1Migrations(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		file string
		up   []string
		down []string
	}{
		{
			name: "0003 входящие уведомления (S1-26)",
			file: "0003_notify_inbox.sql",
			up: []string{
				`create schema if not exists notify`,
				`create table notify\.notifications \(`,
				`recipient_person_id\s+uuid not null references people\.person_profiles\(id\)`,
				`unique \(recipient_person_id, source_event_id\)`,
				`required_permission\s+text`,
				`sensitivity\s+text not null default 'normal'`,
				`create index notifications_feed_idx on notify\.notifications`,
				`create index notifications_unread_idx on notify\.notifications`,
				// Тот же путь того же источника, что startLogin.returnTo и Notification.link (CWE-601).
				`link ~ '\^/\(\[\^/\\\\\[:space:\]\[:cntrl:\]\]\[\^\\\\\[:space:\]\[:cntrl:\]\]\*\)\?\$'`,
				`char_length\(link\) <= 512`,
			},
			down: []string{`drop table notify\.notifications;`, `drop schema notify;`},
		},
		{
			name: "0004 сессии загрузки (S1-20)",
			file: "0004_files_upload_sessions.sql",
			up: []string{
				`create table files\.upload_sessions \(`,
				`file_id\s+uuid not null unique references files\.objects\(id\)`,
				`state\s+text not null check \(state in \('issued','uploaded','completed','expired','aborted'\)\)`,
				`reserved_bytes\s+bigint not null check \(reserved_bytes >= 0\)`,
				`session_expires_at\s+timestamptz not null`,
				`create index upload_sessions_sweep_idx on files\.upload_sessions`,
			},
			down: []string{`drop table files\.upload_sessions`},
		},
		{
			name: "0005 импорт CSV людей (S1-10)",
			file: "0005_people_imports.sql",
			up: []string{
				`create table people\.imports \(`,
				`state\s+text not null default 'previewed' check \(state in \('previewed','committed','expired'\)\)`,
				`create table people\.import_rows \(`,
				`primary key \(import_id, line\)`,
				`action\s+text not null check \(action in \('create','update','skip','error'\)\)`,
				// Строки с персональными данными удаляются через 30 дней после commit (152-ФЗ, Q-W0.08-5).
				`rows_purged_at\s+timestamptz`,
				`check \(rows_purged_at is null or state = 'committed'\)`,
				`create index imports_purge_idx on people\.imports \(committed_at\)`,
			},
			down: []string{`drop table people\.import_rows`, `drop table people\.imports`},
		},
		{
			name: "0006 группы: ревизия и домашнее подразделение (S1-16)",
			file: "0006_access_groups.sql",
			up: []string{
				`alter table access\.groups`,
				`add column revision\s+integer not null default 1`,
				`add column home_unit_id\s+uuid references org\.units\(id\)`,
				`add column archived_at\s+timestamptz`,
				`create unique index groups_name_uq on access\.groups \(lower\(name\)\) where archived_at is null`,
				`alter table access\.group_members`,
				`add column added_at\s+timestamptz not null default now\(\)`,
			},
			down: []string{
				`drop index access\.groups_name_uq`,
				`alter table access\.groups`,
				`drop column revision`,
				`alter table access\.group_members`,
				`drop column added_at`,
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			text := readFile(t, migrations.Tenant, tt.file)
			wantHeader := "-- W0.08 · tenant " + tt.file[:4] + " · "
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
			// Down без cascade: объекты резерва 0007–0009 в тех же схемах не снимаются молча.
			if strings.Contains(down, "cascade") {
				t.Error("Down must not use cascade")
			}
		})
	}
}
