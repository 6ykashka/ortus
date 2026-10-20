package migrations_test

import (
	"regexp"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// tenant 0024 контрактного PR 3 этапа 4 (W4.04; в ветке — 0023, перенумерована после W2.71 — tenant 0023 в main): схема kb «Базы знаний» (W4.31) — пространства с областью и уровнем,
// дерево узлов (родитель в том же пространстве, глубина до шести уровней, главная страница), версии, записи доступа
// узла и журнал доступа, ознакомление и журнал подтверждений (KB-03), запросы доступа (один открытый на узел и
// сотрудника), правила и журнал запусков, таблицы и записи страниц (D-26 комплекта). Down снимает ровно эти объекты
// (без cascade).
func TestStage4W404Migration(t *testing.T) {
	t.Parallel()
	const file = "0024_knowledge_spaces.sql"
	text := readFile(t, migrations.Tenant, file)
	if want := "-- W4.04 · tenant 0024 · "; !strings.HasPrefix(text, want) {
		t.Errorf("first line must start with %q", want)
	}
	up, down := stripComments(upBody(t, text)), stripComments(downBody(t, text))
	for _, re := range []string{
		`create schema if not exists kb`,
		`create table kb\.spaces`,
		`org_unit_id\s+uuid references org\.units \(id\)`,
		`access\s+text not null check \(access in \('open', 'limited', 'closed'\)\)`,
		`create unique index spaces_name_uq on kb\.spaces \(lower\(btrim\(name\)\)\)`,
		`create table kb\.nodes`,
		`kind\s+text not null check \(kind in \('page', 'folder', 'table', 'diagram', 'file', 'link'\)\)`,
		`status\s+text not null default 'draft' check \(status in \('draft', 'review', 'active', 'outdated'\)\)`,
		`access_mode\s+text not null default 'inherit' check \(access_mode in \('inherit', 'edit_listed', 'listed'\)\)`,
		`sensitivity\s+text not null default 'normal' check \(sensitivity in \('normal', 'finance'\)\)`,
		`depth\s+smallint not null check \(depth between 1 and 6\)`,
		// Возврат 1 (ревью): глубина выводится из родителя — составной FK (пространство, родитель, глубина − 1) на
		// (пространство, id, глубина), отложенный до конца транзакции (перенос ветки меняет глубины потомков); так же
		// исключён цикл в дереве.
		`parent_depth\s+smallint generated always as \(depth - 1\) stored`,
		`unique \(space_id, id, depth\)`,
		`foreign key \(space_id, parent_id, parent_depth\) references kb\.nodes \(space_id, id, depth\)\s+deferrable initially deferred`,
		`create unique index nodes_home_uq on kb\.nodes \(space_id\) where is_home`,
		`constraint nodes_home check`,
		`create table kb\.versions`,
		`primary key \(node_id, version\)`,
		`create table kb\.node_access`,
		`who\s+text not null check \(who in \('member', 'group', 'role', 'relation'\)\)`,
		`can\s+text not null check \(can in \('view', 'edit'\)\)`,
		`constraint node_access_relation check`,
		`create table kb\.access_history`,
		`create table kb\.acks`,
		`create table kb\.ack_log`,
		`unique \(node_id, member_id, version\)`,
		`create table kb\.requests`,
		// Возврат 1 (ревью): пространство запроса — пространство узла (по нему строится список руководителя).
		`foreign key \(space_id, node_id\) references kb\.nodes \(space_id, id\)`,
		`create unique index requests_open_uq on kb\.requests \(node_id, member_id\) where status = 'open'`,
		`constraint requests_until check`,
		`create table kb\.rules`,
		`kind\s+text not null check \(kind in \('ack', 'review', 'section'\)\)`,
		`create table kb\.runs`,
		// Возврат 1 (ревью): пространство запуска — пространство правила (журнал запусков пространства).
		`foreign key \(space_id, rule_id\) references kb\.rules \(space_id, id\)`,
		`result\s+text not null check \(result in \('ok', 'warn', 'stopped', 'error'\)\)`,
		`create table kb\.tables`,
		`create table kb\.table_rows`,
		`create table kb\.entries`,
	} {
		if !regexp.MustCompile(re).MatchString(up) {
			t.Errorf("Up lacks /%s/", re)
		}
	}
	for _, re := range []string{
		`drop table kb\.entries`,
		`drop table kb\.table_rows`,
		`drop table kb\.tables`,
		`drop table kb\.runs`,
		`drop table kb\.rules`,
		`drop table kb\.requests`,
		`drop table kb\.ack_log`,
		`drop table kb\.acks`,
		`drop table kb\.access_history`,
		`drop table kb\.node_access`,
		`drop table kb\.versions`,
		`drop table kb\.nodes`,
		`drop table kb\.spaces`,
		`drop schema kb`,
	} {
		if !regexp.MustCompile(re).MatchString(down) {
			t.Errorf("Down lacks /%s/", re)
		}
	}
	if strings.Contains(down, "cascade") {
		t.Error("Down must not use cascade")
	}
}
