package migrations_test

import (
	"regexp"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// tenant 0025 контрактного PR 2 этапа 4 (W4.03, контракт 0.10.0-stage4): схема tasks «Задач и проектов» (W4.11) —
// проекты с уровнем доступа и ключом, неизменяемые версии процесса и черновик, задачи со статусом процесса и номером,
// история, раунды и голоса согласования, вложения поверх files.objects, правила и журнал автоматизации. Down снимает
// ровно эти объекты (без cascade).
func TestStage4W403Migration(t *testing.T) {
	t.Parallel()
	const file = "0025_tasks_projects_workflow.sql"
	text := readFile(t, migrations.Tenant, file)
	if want := "-- W4.03 · tenant 0025 · "; !strings.HasPrefix(text, want) {
		t.Errorf("first line must start with %q", want)
	}
	up, down := stripComments(upBody(t, text)), stripComments(downBody(t, text))
	for _, re := range []string{
		`create schema if not exists tasks`,
		`create table tasks\.projects`,
		`key\s+text not null check \(key ~ '\^\[A-ZА-ЯЁ\]\[A-ZА-ЯЁ0-9\]\{1,5\}\$'\)`,
		`org_unit_id\s+uuid references org\.units \(id\),`,
		`access\s+text check \(access in \('open', 'limited', 'closed'\)\)`,
		`flow\s+text not null default 'tasks' check \(flow in \('tasks', 'leads'\)\)`,
		`task_seq\s+integer not null default 100`,
		`constraint projects_funnel check \(\(flow = 'leads'\) = \(access is null\)\)`,
		`create unique index projects_key_idx on tasks\.projects \(key\)`,
		`create table tasks\.workflow_versions`,
		`primary key \(project_id, version\)`,
		`create table tasks\.workflow_drafts`,
		`create table tasks\.tasks`,
		`status_id\s+text not null`,
		`workflow_version integer check`,
		`priority\s+text not null default 'normal' check \(priority in \('urgent', 'high', 'normal', 'low'\)\)`,
		`labels\s+text\[\] not null default '\{\}' check \(cardinality\(labels\) <= 10\)`,
		`parent_task_id\s+uuid references tasks\.tasks \(id\)`,
		`deleted_at\s+timestamptz`,
		`create unique index tasks_number_idx on tasks\.tasks \(project_id, number\)`,
		`create table tasks\.task_events`,
		`constraint task_events_comment check \(kind <> 'comment' or actor_id is not null\)`,
		`create table tasks\.approval_rounds`,
		`mode\s+text not null check \(mode in \('any', 'all'\)\)`,
		`approver_ids\s+uuid\[\] not null`,
		`create unique index approval_rounds_open_idx on tasks\.approval_rounds \(task_id\) where closed_at is null`,
		`create table tasks\.approval_votes`,
		`constraint approval_votes_reject_comment check`,
		`create table tasks\.task_files`,
		`file_id\s+uuid not null references files\.objects \(id\)`,
		`create unique index task_files_file_idx on tasks\.task_files \(file_id\)`,
		`create table tasks\.automations`,
		`constraint automations_trigger check`,
		`constraint automations_action check`,
		`create table tasks\.automation_runs`,
		// Журнал хранит id удалённого правила (TaskAutomationRun.automationId обязателен) — без внешнего ключа.
		`automation_id\s+uuid not null,`,
	} {
		if !regexp.MustCompile(re).MatchString(up) {
			t.Errorf("Up lacks /%s/", re)
		}
	}
	for _, re := range []string{
		`drop table tasks\.automation_runs`,
		`drop table tasks\.automations`,
		`drop table tasks\.task_files`,
		`drop table tasks\.approval_votes`,
		`drop table tasks\.approval_rounds`,
		`drop table tasks\.task_events`,
		`drop table tasks\.tasks`,
		`drop table tasks\.workflow_drafts`,
		`drop table tasks\.workflow_versions`,
		`drop table tasks\.projects`,
		`drop schema tasks`,
	} {
		if !regexp.MustCompile(re).MatchString(down) {
			t.Errorf("Down lacks /%s/", re)
		}
	}
	if regexp.MustCompile(`automation_id\s+uuid[^,]*references`).MatchString(up) {
		t.Error("automation_runs.automation_id must not reference tasks.automations: the journal outlives the rule")
	}
	if strings.Contains(down, "cascade") {
		t.Error("Down must not use cascade")
	}
}
