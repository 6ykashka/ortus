package migrations_test

import (
	"regexp"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// Возврат 1 ревью W7.00 (major): публичные пути этапа 7 не несут tenantId (/public/doc-links/{token}/open,
// /public/service/{slug}, /public/service/requests/{token}/...), а токены и slug лежат в tenant-схемах. Как у
// публичных форм (control 0009, W4.05), маршрут «токен или slug → тенант» живёт в control: control 0011 даёт
// индекс дайджестов токенов внешних ссылок документов и токенов портала обращений и глобальный реестр slug
// публичных страниц направлений (slug не уникален между тенантами без него).
func TestStage7W700Return1ControlRouting(t *testing.T) {
	t.Parallel()
	const file = "0011_public_docs_service_index.sql"
	text := readFile(t, migrations.Control, file)
	if !strings.HasPrefix(text, "-- W7.00 · control 0011 · ") {
		t.Error("first line must start with \"-- W7.00 · control 0011 · \"")
	}
	up, down := stripComments(upBody(t, text)), stripComments(downBody(t, text))
	for _, re := range []string{
		// Дайджест глобально уникален: первичный ключ, формат sha256:hex, тенант — внешний ключ на tenants.
		`create table public_doc_links \(`,
		`create table public_service_tokens \(`,
		`create table public_service_slugs \(`,
		`token_digest text primary key check \(token_digest ~ '\^sha256:\[0-9a-f\]\{64\}\$'\)`,
		`tenant_id\s+uuid not null references tenants\(id\)`,
		`document_id\s+uuid not null`,
		`link_id\s+uuid not null`,
		`request_id\s+uuid not null`,
		`token_id\s+uuid not null`,
		`direction_id\s+uuid not null`,
		`slug\s+text primary key check \(slug ~ '\^\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*\$' and length\(slug\) <= 60\)`,
		`unique \(tenant_id, link_id\)`,
		`unique \(tenant_id, token_id\)`,
		`unique \(tenant_id, direction_id\)`,
		`revoked_at\s+timestamptz`,
		`expires_at\s+timestamptz not null`,
	} {
		if !regexp.MustCompile(re).MatchString(up) {
			t.Errorf("Up lacks /%s/", re)
		}
	}
	if got := strings.Count(up, "create table "); got != 3 {
		t.Errorf("%d tables, want 3", got)
	}
	for _, tb := range []string{"public_doc_links", "public_service_tokens", "public_service_slugs"} {
		if !strings.Contains(down, "drop table "+tb+";") {
			t.Errorf("Down lacks drop of %s", tb)
		}
	}
	for _, bad := range []string{"cascade", "delete from"} {
		if strings.Contains(down, bad) {
			t.Errorf("Down must not contain %q", bad)
		}
	}
	// Секрет не хранится: только дайджест.
	if regexp.MustCompile(`\btoken\s+text`).MatchString(up) {
		t.Error("control keeps a token digest only, never the token")
	}
}

// Slug публичной страницы направления — столбец tenant 0062 (источник истины, как forms.public_links для форм);
// уникален внутри тенанта, глобальная уникальность — реестр control 0011.
func TestStage7W700Return1DirectionPublicSlug(t *testing.T) {
	t.Parallel()
	up := stripComments(upBody(t, readFile(t, migrations.Tenant, "0062_service.sql")))
	for _, re := range []string{
		`public_slug\s+text check \(public_slug is null or \(public_slug ~ '\^\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*\$' and length\(public_slug\) <= 60\)\)`,
		`create unique index directions_public_slug_uq on service\.directions \(public_slug\) where public_slug is not null`,
	} {
		if !regexp.MustCompile(re).MatchString(up) {
			t.Errorf("0062 Up lacks /%s/", re)
		}
	}
}
