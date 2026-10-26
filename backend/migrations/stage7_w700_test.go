package migrations_test

import (
	"regexp"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// tenant 0060–0062 контрактного PR этапа 7 (W7.00): схемы chat, docs и service. Номера выдал стюард из блока этапа 7
// (0060–0069, план v2 §3.5). Модуль пишет только в свою схему: внешние ключи — лишь на people, org и files
// (общие справочники ядра); задача, проект, запись CRM, поездка — id без ключей. Down снимает ровно эти объекты.
func TestStage7W700Migrations(t *testing.T) {
	t.Parallel()
	cases := []stage7Case{
		{
			file: "0060_chats.sql", first: "-- W7.00 · tenant 0060 · ", schema: "chat",
			tables: []string{
				"chats", "chat_sources", "chat_members", "topics", "messages", "message_versions", "attachments",
				"receipts", "acks", "polls", "poll_votes", "pins", "policies", "holds", "cleanups", "journal", "exports",
			},
			up: []string{
				`kind\s+text not null check \(kind in \('direct', 'group', 'area', 'record', 'announce'\)\)`,
				`sensitivity\s+text not null default 'normal' check \(sensitivity in \('normal', 'finance', 'pdn'\)\)`,
				`unique \(chat_id, seq\)`,
				`voter_hash\s+text check \(voter_hash is null or voter_hash ~ '\^\[0-9a-f\]\{64\}\$'\)`,
				`constraint poll_votes_voter check \(\(voter_id is null\) <> \(voter_hash is null\)\)`,
				`create table chat\.holds`,
				`constraint holds_scope check \(\(scope = 'chat'\) = \(chat_id is not null\)\)`,
			},
		},
		{
			file: "0061_docs.sql", first: "-- W7.00 · tenant 0061 · ", schema: "docs",
			tables: []string{
				"folders", "documents", "versions", "shares", "temp_grants", "links", "link_opens", "comments", "replies",
				"routes", "route_steps", "route_decisions", "acks", "jobs", "ocr_words", "templates", "route_templates",
			},
			up: []string{
				`status\s+text not null default 'draft' check \(status in \('draft', 'in_route', 'returned', 'agreed', 'approved', 'signed', 'archived'\)\)`,
				`unique \(document_id, number\)`,
				`create unique index versions_engine_key_uq on docs\.versions \(document_id, engine_key\) where engine_key is not null`,
				`token_digest\s+text not null check \(token_digest ~ '\^sha256:\[0-9a-f\]\{64\}\$'\)`,
				`create unique index routes_active_uq on docs\.routes \(document_id\) where status = 'active'`,
				`method\s+text not null check \(method in \('click', 'pep_login', 'pep_sms', 'sms_link'\)\)`,
			},
		},
		{
			file: "0062_service.sql", first: "-- W7.00 · tenant 0062 · ", schema: "service",
			tables: []string{
				"calendars", "directions", "direction_versions", "direction_drafts", "direction_team", "request_types",
				"clients", "requests", "key_aliases", "request_details", "messages", "sla_timers", "ratings", "surveys",
				"portal_tokens", "reply_templates",
			},
			up: []string{
				`create unique index directions_key_uq on service\.directions \(key\)`,
				`unique \(direction_id, number\)`,
				`create unique index requests_key_uq on service\.requests \(key\)`,
				`primary key \(request_id, target\)`,
				`token_digest text not null check \(token_digest ~ '\^sha256:\[0-9a-f\]\{64\}\$'\)`,
				`phone\s+text not null check \(phone ~ '\^\\\+\[0-9\]\{10,15\}\$'\)`,
			},
		},
	}
	for _, c := range cases {
		checkStage7Case(t, c)
	}
}

type stage7Case struct {
	file, first, schema string
	tables              []string
	up                  []string
}

func checkStage7Case(t *testing.T, c stage7Case) {
	t.Helper()
	text := readFile(t, migrations.Tenant, c.file)
	if !strings.HasPrefix(text, c.first) {
		t.Errorf("%s: first line must start with %q", c.file, c.first)
	}
	up, down := stripComments(upBody(t, text)), stripComments(downBody(t, text))
	if !regexp.MustCompile(`create schema if not exists ` + c.schema + `;`).MatchString(up) {
		t.Errorf("%s: Up lacks create schema %s", c.file, c.schema)
	}
	for _, tb := range c.tables {
		if !strings.Contains(up, "create table "+c.schema+"."+tb+" (") {
			t.Errorf("%s: Up lacks table %s.%s", c.file, c.schema, tb)
		}
		if !strings.Contains(down, "drop table "+c.schema+"."+tb+";") {
			t.Errorf("%s: Down lacks drop of %s.%s", c.file, c.schema, tb)
		}
	}
	if got := strings.Count(up, "create table "); got != len(c.tables) {
		t.Errorf("%s: %d tables, want %d", c.file, got, len(c.tables))
	}
	if !strings.Contains(down, "drop schema "+c.schema+";") {
		t.Errorf("%s: Down lacks drop schema %s", c.file, c.schema)
	}
	for _, re := range c.up {
		if !regexp.MustCompile(re).MatchString(up) {
			t.Errorf("%s: Up lacks /%s/", c.file, re)
		}
	}
	if strings.Contains(down, "cascade") {
		t.Errorf("%s: Down must not use cascade", c.file)
	}
	// Ссылки наружу — только на общие справочники ядра.
	for _, m := range regexp.MustCompile(`references ([a-z_]+)\.`).FindAllStringSubmatch(up, -1) {
		switch m[1] {
		case c.schema, "people", "org", "files":
		default:
			t.Errorf("%s: foreign key to the schema %s of another module", c.file, m[1])
		}
	}
}

// Секреты не хранятся: у ссылки документа, кабинета обращения — только дайджест токена; PIN — только хэш; номер
// клиента наружу — маской (комментарий столбца); анонимный голос — без сотрудника.
func TestStage7W700NoSecretsStored(t *testing.T) {
	t.Parallel()
	docs := stripComments(upBody(t, readFile(t, migrations.Tenant, "0061_docs.sql")))
	svc := stripComments(upBody(t, readFile(t, migrations.Tenant, "0062_service.sql")))
	for _, bad := range []string{`\btoken\s+text`, `\bpin\s+text`, `pin_code`} {
		for name, text := range map[string]string{"docs": docs, "service": svc} {
			if regexp.MustCompile(bad).MatchString(text) {
				t.Errorf("%s: stores a secret /%s/", name, bad)
			}
		}
	}
	if !strings.Contains(docs, "pin_hash") {
		t.Error("docs.links keeps the PIN as a hash only")
	}
	full := readFile(t, migrations.Tenant, "0062_service.sql")
	if !regexp.MustCompile(`comment on column service\.clients\.phone is '[^']*phoneMasked[^']*'`).MatchString(full) {
		t.Error("service.clients.phone: comment must say the number leaves masked")
	}
	chat := readFile(t, migrations.Tenant, "0060_chats.sql")
	if !regexp.MustCompile(`comment on column chat\.poll_votes\.voter_hash is '[^']*HMAC-SHA256[^']*'`).MatchString(chat) {
		t.Error("chat.poll_votes.voter_hash: comment must describe the HMAC")
	}
}
