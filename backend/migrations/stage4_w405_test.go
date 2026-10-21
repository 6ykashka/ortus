package migrations_test

import (
	"regexp"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// tenant 0026 контрактного PR 4 этапа 4 (W4.05, контракт 0.11.0-stage4): схема forms «Форм и опросов» (W4.21) —
// группы организации, формы (область, модуль, шаблон, группа, владелец, статус, действующая версия, настройки, ревизия),
// черновик одной строкой на форму с ревизией, неизменяемые версии, правила пяти видов с версией и автором, ответы
// (номер R-…, версия, канал, автор, объект, ответы, баллы, проверка, дедупликация осмотра), журнал действий ответа
// (переживает удаление правила), публичные ссылки (только дайджест токена). Down снимает ровно эти объекты (без
// cascade).
func TestStage4W405Migration(t *testing.T) {
	t.Parallel()
	const file = "0026_forms_v2.sql"
	text := readFile(t, migrations.Tenant, file)
	if want := "-- W4.05 · tenant 0026 · "; !strings.HasPrefix(text, want) {
		t.Errorf("first line must start with %q", want)
	}
	up, down := stripComments(upBody(t, text)), stripComments(downBody(t, text))
	for _, re := range []string{
		`create schema if not exists forms`,
		`create table forms\.groups`,
		`create unique index groups_name_idx on forms\.groups \(lower\(btrim\(name\)\)\)`,
		`create table forms\.forms`,
		`org_unit_id\s+uuid references org\.units \(id\),`,
		`group_id\s+uuid references forms\.groups \(id\)`,
		`owner_id\s+uuid not null references people\.person_profiles \(id\)`,
		`status\s+text not null default 'draft' check \(status in \('draft', 'published', 'closed'\)\)`,
		`access\s+text not null default 'members' check \(access in \('members', 'public'\)\)`,
		`retain_days\s+integer not null default 365 check \(retain_days in \(90, 365, 1095\)\)`,
		`create unique index forms_name_idx on forms\.forms \(lower\(btrim\(name\)\)\)`,
		`constraint forms_published check \(\(status = 'draft'\) = \(current_version is null\)\)`,
		`create table forms\.drafts`,
		`form_id\s+uuid primary key references forms\.forms \(id\)`,
		`create table forms\.versions`,
		`create unique index versions_number_idx on forms\.versions \(form_id, number\)`,
		`foreign key \(id, current_version\) references forms\.versions \(form_id, number\) deferrable initially deferred`,
		`create table forms\.rules`,
		`kind\s+text not null check \(kind in \('task', 'notify', 'email', 'http', 'kb'\)\)`,
		`trigger\s+text not null check \(trigger in \('submitted', 'accepted'\)\)`,
		`constraint rules_condition check`,
		`constraint rules_config check`,
		`create table forms\.responses`,
		`create sequence forms\.response_number_seq`,
		`foreign key \(form_id, version_number\) references forms\.versions \(form_id, number\)`,
		`channel\s+text not null check \(channel in \('member', 'public', 'inspection'\)\)`,
		`constraint responses_author check`,
		`constraint responses_subject check`,
		`review_status\s+text not null check \(review_status in \('pending', 'accepted', 'rejected'\)\)`,
		`create unique index responses_number_idx on forms\.responses \(number\)`,
		`create unique index responses_dedup_idx on forms\.responses \(form_id, dedup_key\) where dedup_key is not null`,
		`create table forms\.response_actions`,
		`primary key \(response_id, rule_id\)`,
		`constraint response_actions_result check`,
		`create table forms\.public_links`,
		`token_digest\s+text not null`,
		`create unique index public_links_active_idx on forms\.public_links \(form_id\) where revoked_at is null`,
	} {
		if !regexp.MustCompile(re).MatchString(up) {
			t.Errorf("Up lacks /%s/", re)
		}
	}
	for _, re := range []string{
		`drop table forms\.public_links`,
		`drop table forms\.response_actions`,
		`drop table forms\.responses`,
		`drop sequence forms\.response_number_seq`,
		`drop table forms\.rules`,
		`alter table forms\.forms drop constraint forms_current_version_fk`,
		`drop table forms\.versions`,
		`drop table forms\.drafts`,
		`drop table forms\.forms`,
		`drop table forms\.groups`,
		`drop schema forms`,
	} {
		if !regexp.MustCompile(re).MatchString(down) {
			t.Errorf("Down lacks /%s/", re)
		}
	}
	// Журнал действий переживает удаление правила (как журнал автоматизации W4.03); страница и задача — объекты
	// других модулей: внешних ключей на kb и tasks нет (модуль пишет только в свою схему).
	if regexp.MustCompile(`rule_id\s+uuid[^,]*references`).MatchString(up) {
		t.Error("response_actions.rule_id must not reference forms.rules: the journal outlives the rule")
	}
	for _, other := range []string{"references kb.", "references tasks."} {
		if strings.Contains(up, other) {
			t.Errorf("Up must not reference another module (%s)", other)
		}
	}
	if strings.Contains(up, "token text") || regexp.MustCompile(`\btoken\s+text`).MatchString(up) {
		t.Error("public_links stores only the digest of the token")
	}
	if strings.Contains(down, "cascade") {
		t.Error("Down must not use cascade")
	}
}

// Возврат 1 (ревью W4.05): токен не хранится, а выводится (Form.share.publicToken показывается снова и снова) —
// HMAC-SHA256 ключом FORMS_PUBLIC_LINK_KEY версии key_version из тенанта и id ссылки; схема вывода — в комментарии
// столбца, который читают W4.21 и W4.25. Журнал действий — один раз на «ответ × правило», отправка сериализуется по
// строке формы.
func TestStage4W405MigrationReturn1(t *testing.T) {
	t.Parallel()
	up := stripComments(upBody(t, readFile(t, migrations.Tenant, "0026_forms_v2.sql")))
	for _, re := range []string{
		`key_version\s+smallint not null default 1 check \(key_version >= 1\)`,
		`comment on column forms\.public_links\.token_digest is '[^']*HMAC-SHA256[^']*FORMS_PUBLIC_LINK_KEY[^']*'`,
		`comment on table forms\.response_actions is '[^']*response × rule[^']*'`,
		`comment on column forms\.forms\.response_limit is '[^']*for update[^']*'`,
	} {
		if !regexp.MustCompile(re).MatchString(up) {
			t.Errorf("Up lacks /%s/", re)
		}
	}
}

// Возврат 2 (ревью W4.05): гостевой маршрут /api/v1/public/forms/{publicToken} не несёт тенанта, а БД у каждого
// тенанта своя (ADR 0006) — тенант находится по индексу control 0009 public_form_links (token_digest → tenant_id,
// форма, id ссылки, версия ключа), как приглашения control.invitations (token_hash → tenant_id). Дайджест в обеих
// БД — один формат «sha256:» + 64 hex; комментарий столбца tenant 0026 описывает маршрут и порядок записи.
func TestStage4W405PublicLinkIndex(t *testing.T) {
	t.Parallel()
	const file = "0009_public_form_links.sql"
	text := readFile(t, migrations.Control, file)
	if want := "-- W4.05 · control 0009 · "; !strings.HasPrefix(text, want) {
		t.Errorf("first line must start with %q", want)
	}
	up, down := stripComments(upBody(t, text)), stripComments(downBody(t, text))
	for _, re := range []string{
		`create table public_form_links`,
		`token_digest\s+text primary key check \(token_digest ~ '\^sha256:\[0-9a-f\]\{64\}\$'\)`,
		`tenant_id\s+uuid not null references tenants\(id\)`,
		`form_id\s+uuid not null`,
		`link_id\s+uuid not null`,
		`key_version\s+smallint not null default 1 check \(key_version >= 1\)`,
		`revoked_at\s+timestamptz`,
		`unique \(tenant_id, link_id\)`,
		`create index public_form_links_form_idx on public_form_links \(tenant_id, form_id\)`,
		`comment on table public_form_links is '[^']*token_digest[^']*tenant_id[^']*forms\.public_links[^']*'`,
	} {
		if !regexp.MustCompile(re).MatchString(up) {
			t.Errorf("control %s: Up lacks /%s/", file, re)
		}
	}
	if !regexp.MustCompile(`drop table public_form_links`).MatchString(down) {
		t.Errorf("control %s: Down lacks drop table public_form_links", file)
	}
	if strings.Contains(down, "cascade") {
		t.Error("Down must not use cascade")
	}

	tenant := stripComments(upBody(t, readFile(t, migrations.Tenant, "0026_forms_v2.sql")))
	for _, re := range []string{
		`token_digest\s+text not null check \(token_digest ~ '\^sha256:\[0-9a-f\]\{64\}\$'\)`,
		`comment on column forms\.public_links\.token_digest is '[^']*public_form_links[^']*'`,
	} {
		if !regexp.MustCompile(re).MatchString(tenant) {
			t.Errorf("tenant 0026: Up lacks /%s/", re)
		}
	}
}
