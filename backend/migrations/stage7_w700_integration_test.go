//go:build integration

package migrations_test

import (
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// tenant 0060–0062 (W7.00) на реальном сервере под runtime-ролью API: чат и номер сообщения, голос анонимного опроса
// без сотрудника, удержание с областью, версия документа с ключом сервера документов, одна действующая маршрутизация,
// дайджест токена ссылки, ключ и номер обращения, оценка клиента.
func TestStage7W700Constraints(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		name, _ := migrated(t, c, migrations.Tenant)
		db := c.DB(t, name, migrations.RoleAPI)
		ctx := t.Context()
		exec := func(q string, args ...any) error {
			_, err := db.ExecContext(ctx, q, args...)
			return err
		}
		wantState := func(what string, err error, state string) {
			t.Helper()
			if got := sqlState(err); got != state {
				t.Errorf("%s: SQLSTATE %q (%v), want %s", what, got, err, state)
			}
		}
		wantOK := func(what string, err error) {
			t.Helper()
			if err != nil {
				t.Errorf("%s: %v", what, err)
			}
		}
		digest := "sha256:" + strings.Repeat("a", 64)

		unit := scalar[string](t, db, `insert into org.units (kind, name, time_zone)
			values ('company', 'Север', 'Europe/Moscow') returning id::text`)
		anna := scalar[string](t, db, `insert into people.person_profiles (full_name, home_unit_id)
			values ('Анна Котова', $1) returning id::text`, unit)
		oleg := scalar[string](t, db, `insert into people.person_profiles (full_name, home_unit_id)
			values ('Олег Рябов', $1) returning id::text`, unit)

		// Чаты: вид и чувствительность из перечня, номер сообщения уникален в чате, голос анонимного опроса — хэш.
		chat := scalar[string](t, db, `insert into chat.chats (kind, title, created_by) values ('group', 'Склад', $1)
			returning id::text`, anna)
		wantState("chat kind", exec(`insert into chat.chats (kind, title) values ('forum', 'X')`), "23514")
		wantState("chat sensitivity", exec(`insert into chat.chats (kind, title, sensitivity) values ('group', 'X', 'secret')`), "23514")
		wantOK("member", exec(`insert into chat.chat_members (chat_id, member_id, state, role) values ($1, $2, 'in', 'owner')`, chat, anna))
		wantState("member in without a role", exec(`insert into chat.chat_members (chat_id, member_id, state, role) values ($1, $2, 'in', null)`, chat, oleg), "23514")
		msg := scalar[string](t, db, `insert into chat.messages (chat_id, seq, author_id, text) values ($1, 1, $2, 'Привет')
			returning id::text`, chat, anna)
		wantState("seq taken", exec(`insert into chat.messages (chat_id, seq, author_id, text) values ($1, 1, $2, 'Дубль')`, chat, anna), "23505")
		pollMsg := scalar[string](t, db, `insert into chat.messages (chat_id, seq, kind, author_id, text) values ($1, 2, 'poll', $2, '')
			returning id::text`, chat, anna)
		poll := scalar[string](t, db, `insert into chat.polls (message_id, question, options, anonymous, closes_at)
			values ($1, 'Когда?', '["Сегодня","Завтра"]', true, now() + interval '1 day') returning id::text`, pollMsg)
		wantState("poll with one option", exec(`insert into chat.polls (message_id, question, options, closes_at)
			values ($1, 'Один?', '["Да"]', now())`, msg), "23514")
		hash := strings.Repeat("b", 64)
		wantOK("anonymous vote", exec(`insert into chat.poll_votes (poll_id, option_idx, voter_hash) values ($1, 0, $2)`, poll, hash))
		wantState("vote twice", exec(`insert into chat.poll_votes (poll_id, option_idx, voter_hash) values ($1, 0, $2)`, poll, hash), "23505")
		wantState("vote with member and hash", exec(`insert into chat.poll_votes (poll_id, option_idx, voter_id, voter_hash) values ($1, 1, $2, $3)`, poll, oleg, hash), "23514")
		wantState("vote with nobody", exec(`insert into chat.poll_votes (poll_id, option_idx) values ($1, 1)`, poll), "23514")
		wantState("hold of a chat without a chat", exec(`insert into chat.holds (scope, reason) values ('chat', 'Проверка')`), "23514")
		wantOK("hold of a chat", exec(`insert into chat.holds (scope, chat_id, reason, created_by) values ('chat', $1, 'Проверка ИБ', $2)`, chat, anna))
		wantState("hold released without a time", exec(`insert into chat.holds (scope, chat_id, reason, status) values ('chat', $1, 'Проверка ИБ', 'released')`, chat), "23514")

		// Документы: версия неизменяема по номеру, повтор ключа сервера документов не создаёт версию, одна действующая
		// маршрутизация, токен ссылки — только дайджест.
		folder := scalar[string](t, db, `insert into docs.folders (name, owner_id) values ('Договоры', $1) returning id::text`, anna)
		wantState("folder name taken", exec(`insert into docs.folders (name, owner_id) values ('договоры', $1)`, oleg), "23505")
		doc := scalar[string](t, db, `insert into docs.documents (kind, title, folder_id, owner_id) values ('text', 'Договор', $1, $2)
			returning id::text`, folder, anna)
		wantState("document kind", exec(`insert into docs.documents (kind, title, folder_id, owner_id) values ('video', 'X', $1, $2)`, folder, anna), "23514")
		wantOK("version 1", exec(`insert into docs.versions (document_id, number, source, engine_key) values ($1, 1, 'edit', 'k-1')`, doc))
		wantState("version number taken", exec(`insert into docs.versions (document_id, number, source) values ($1, 1, 'edit')`, doc), "23505")
		wantState("engine key repeated", exec(`insert into docs.versions (document_id, number, source, engine_key) values ($1, 2, 'edit', 'k-1')`, doc), "23505")
		wantState("share without a target", exec(`insert into docs.shares (who, level) values ('all', 'view')`), "23514")
		wantOK("route", exec(`insert into docs.routes (document_id, version, started_by) values ($1, 1, $2)`, doc, anna))
		wantState("second active route", exec(`insert into docs.routes (document_id, version, started_by) values ($1, 1, $2)`, doc, anna), "23505")
		wantOK("link", exec(`insert into docs.links (document_id, level, expires_at, token_digest, created_by)
			values ($1, 'view', now() + interval '7 days', $2, $3)`, doc, digest, anna))
		wantState("link digest taken", exec(`insert into docs.links (document_id, level, expires_at, token_digest)
			values ($1, 'view', now() + interval '7 days', $2)`, doc, digest), "23505")
		wantState("link with a raw token", exec(`insert into docs.links (document_id, level, expires_at, token_digest)
			values ($1, 'view', now() + interval '7 days', 'plain-token')`, doc), "23514")
		wantState("decision method", exec(`insert into docs.jobs (op, doc_ids, name) values ('shred', array[$1::uuid], 'X')`, doc), "23514")

		// Обращения: ключ направления и номера уникальны, телефон — полным международным, оценка 1–5.
		dir := scalar[string](t, db, `insert into service.directions (key, name, module_key, lead_id)
			values ('LOG', 'Логистика', 'logistics', $1) returning id::text`, anna)
		wantState("direction key taken", exec(`insert into service.directions (key, name, module_key) values ('LOG', 'Дубль', 'repair')`), "23505")
		wantState("direction key lower case", exec(`insert into service.directions (key, name, module_key) values ('log2', 'Х2', 'repair')`), "23514")
		wantOK("type", exec(`insert into service.request_types (id, direction_id, kind, name) values ('delay', $1, 'complaint', 'Задержка')`, dir))
		client := scalar[string](t, db, `insert into service.clients (name, phone) values ('ООО Альта', '+79990001122') returning id::text`)
		wantState("client phone", exec(`insert into service.clients (name, phone) values ('Х', '89990001122')`), "23514")
		wantState("client phone taken", exec(`insert into service.clients (name, phone) values ('Х', '+79990001122')`), "23505")
		req := scalar[string](t, db, `insert into service.requests (direction_id, number, key, kind, type_id, title, client_id, channel)
			values ($1, 1, 'LOG-1', 'complaint', 'delay', 'Опоздала машина', $2, 'sms') returning id::text`, dir, client)
		wantState("request key taken", exec(`insert into service.requests (direction_id, number, key, kind, title, client_id, channel)
			values ($1, 2, 'LOG-1', 'question', 'Х', $2, 'sms')`, dir, client), "23505")
		wantState("request number taken", exec(`insert into service.requests (direction_id, number, key, kind, title, client_id, channel)
			values ($1, 1, 'LOG-9', 'question', 'Х', $2, 'sms')`, dir, client), "23505")
		wantState("request type of another direction", exec(`insert into service.requests (direction_id, number, key, kind, type_id, title, client_id, channel)
			values ($1, 3, 'LOG-3', 'question', 'nope', 'Х', $2, 'sms')`, dir, client), "23503")
		wantState("resolved without a time", exec(`update service.requests set status = 'resolved' where id = $1`, req), "23514")
		wantOK("resolved", exec(`update service.requests set status = 'resolved', resolved_at = now() where id = $1`, req))
		wantState("rating of six", exec(`insert into service.ratings (direction_id, request_id, client_id, score) values ($1, $2, $3, 6)`, dir, req, client), "23514")
		wantOK("rating", exec(`insert into service.ratings (direction_id, request_id, client_id, score) values ($1, $2, $3, 5)`, dir, req, client))
		wantOK("portal token", exec(`insert into service.portal_tokens (request_id, token_digest, expires_at)
			values ($1, $2, now() + interval '30 days')`, req, digest))
		wantState("portal token digest taken", exec(`insert into service.portal_tokens (request_id, token_digest, expires_at)
			values ($1, $2, now() + interval '30 days')`, req, digest), "23505")
	})
}

// Down 0063 → 0060 снимает схемы service, docs, chat и возвращает 27 файлов без остатка.
func TestStage7W700DownUp(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		_, db := migrated(t, c, migrations.Tenant)
		if res, err := migrations.DownTo(t.Context(), db, migrations.Tenant, 27); err != nil || res.To != 27 {
			t.Fatalf("down to 27 = %+v, %v", res, err)
		}
		if n := scalar[int](t, db, `select count(*) from pg_namespace where nspname in ('chat', 'docs', 'service')`); n != 0 {
			t.Fatalf("chat/docs/service still exist after down to 27")
		}
		if res, err := migrations.UpTo(t.Context(), db, migrations.Tenant, migrations.Latest(migrations.Tenant)); err != nil || res.To != 63 {
			t.Fatalf("up = %+v, %v", res, err)
		}
	})
}
