//go:build integration

package migrations_test

import (
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// tenant 0026 (W4.05) на реальном сервере под runtime-ролью API: имя формы и группы уникальны без учёта регистра,
// черновик без версии, опубликованная форма ссылается на свою версию, версии неизменяемы по номеру, условие и
// настройка правила по виду, ответ по версии формы, номер ответа и дедупликация осмотра, автор и объект ответа,
// результат действия с ошибкой или без, журнал переживает правило, одна действующая публичная ссылка.
func TestStage4W405Constraints(t *testing.T) {
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

		unit := scalar[string](t, db, `insert into org.units (kind, name, time_zone)
			values ('company', 'Север', 'Europe/Moscow') returning id::text`)
		zimina := scalar[string](t, db, `insert into people.person_profiles (full_name, home_unit_id)
			values ('Дарья Зимина', $1) returning id::text`, unit)
		vasiliev := scalar[string](t, db, `insert into people.person_profiles (full_name, home_unit_id)
			values ('Илья Васильев', $1) returning id::text`, unit)

		// Группы: 2–80 символов, имя уникально без учёта регистра.
		group := scalar[string](t, db, `insert into forms.groups (name, created_by) values ('Опросы клиентов', $1)
			returning id::text`, zimina)
		wantState("group taken", exec(`insert into forms.groups (name) values ('опросы КЛИЕНТОВ')`), "23505")
		wantState("group of one letter", exec(`insert into forms.groups (name) values ('О')`), "23514")

		// Формы: черновик без версии; имя 3–200 и уникально; срок хранения 90 / 365 / 1095.
		form := func(nm string, status string, version any, retain int) (string, error) {
			var id string
			err := db.QueryRowContext(ctx, `insert into forms.forms (name, org_unit_id, module_key, template_id, group_id,
				owner_id, status, current_version, retain_days) values ($1, $2, 'logistics', 'tpl-insp', $3, $4, $5, $6, $7)
				returning id::text`, nm, unit, group, zimina, status, version, retain).Scan(&id)
			return id, err
		}
		insp, err := form("Осмотр машины", "draft", nil, 365)
		wantOK("draft form", err)
		_, err = form("осмотр МАШИНЫ", "draft", nil, 365)
		wantState("form name taken", err, "23505")
		_, err = form("Ос", "draft", nil, 365)
		wantState("form name of two letters", err, "23514")
		_, err = form("Отчёт прораба", "draft", nil, 30)
		wantState("retain 30 days", err, "23514")
		_, err = form("Отчёт прораба", "draft", 1, 365)
		wantState("draft with a version", err, "23514")
		wantOK("whole organization", exec(`insert into forms.forms (name, owner_id) values ('Анкета', $1)`, zimina))

		// Черновик: одна строка на форму, определение — объект, ревизия ≥ 1.
		wantOK("draft", exec(`insert into forms.drafts (form_id, definition, saved_by)
			values ($1, '{"pages": [{"id": "p1", "title": "Фото"}], "fields": []}', $2)`, insp, zimina))
		wantState("second draft", exec(`insert into forms.drafts (form_id, definition) values ($1, '{}')`, insp), "23505")
		wantState("definition not an object", exec(`update forms.drafts set definition = '[]' where form_id = $1`, insp),
			"23514")

		// Публикация: версия неизменяема по номеру; опубликованная форма ссылается на существующую версию (FK
		// отложенный — версия и указатель в одной транзакции).
		wantState("published without a version", exec(`update forms.forms set status = 'published', current_version = 1
			where id = $1`, insp), "23503")
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		_, err1 := tx.ExecContext(ctx, `update forms.forms set status = 'published', current_version = 1 where id = $1`, insp)
		_, err2 := tx.ExecContext(ctx, `insert into forms.versions (form_id, number, definition, question_count, published_by)
			values ($1, 1, '{"pages": [], "fields": []}', 3, $2)`, insp, zimina)
		wantOK("publish v1", err1)
		wantOK("version v1", err2)
		wantOK("commit v1", tx.Commit())
		wantState("v1 again", exec(`insert into forms.versions (form_id, number, definition, question_count)
			values ($1, 1, '{}', 0)`, insp), "23505")

		// Правила: условие — оба поля или ни одного, настройка — объект своего вида.
		rule := func(kind, field, value, config string) (string, error) {
			var id string
			var f, v any
			if field != "" {
				f, v = field, value
			}
			err := db.QueryRowContext(ctx, `insert into forms.rules (form_id, kind, trigger, condition_field, condition_value,
				config, author_id) values ($1, $2, 'accepted', $3, $4, $5, $6) returning id::text`,
				insp, kind, f, v, config, zimina).Scan(&id)
			return id, err
		}
		_, err = rule("sms", "", "", `{"to": "+7"}`)
		wantState("unknown kind", err, "23514")
		_, err = rule("kb", "q-defect", "", `{"nodeId": "x"}`)
		wantOK("condition true/false value", err)
		_, err = db.ExecContext(ctx, `insert into forms.rules (form_id, kind, trigger, condition_field, config, author_id)
			values ($1, 'kb', 'accepted', 'q-defect', '{}', $2)`, insp, zimina)
		wantState("condition without a value", err, "23514")
		_, err = rule("task", "", "", `[]`)
		wantState("config not an object", err, "23514")
		au2, err := rule("kb", "", "", `{"nodeId": "kb-5", "mode": "table", "tableId": "kt-insp"}`)
		wantOK("rule au-2", err)

		// Ответы: по версии формы, номер уникален, автор — у сотрудника, у гостя — нет; объект — все поля или ни одного.
		response := func(number, version int, channel string, author any, dedup any) (string, error) {
			var id string
			err := db.QueryRowContext(ctx, `insert into forms.responses (form_id, number, version_number, channel, author_id,
				subject_module, subject_type, subject_id, subject_label, answers, review_status, dedup_key)
				values ($1, $2, $3, $4, $5, 'fleet', 'trip', gen_random_uuid(), 'Рейс Р-196 · сдача', '[]', 'accepted', $6)
				returning id::text`, insp, number, version, channel, author, dedup).Scan(&id)
			return id, err
		}
		r1012, err := response(1012, 1, "inspection", vasiliev, "trip-196:ret:rev1")
		wantOK("response R-1012", err)
		_, err = response(1012, 1, "member", vasiliev, nil)
		wantState("number taken", err, "23505")
		_, err = response(1013, 2, "member", vasiliev, nil)
		wantState("response by a missing version", err, "23503")
		_, err = response(1014, 1, "inspection", vasiliev, "trip-196:ret:rev1")
		wantState("inspection twice", err, "23505")
		_, err = response(1015, 1, "public", vasiliev, nil)
		wantState("guest with an author", err, "23514")
		_, err = response(1016, 1, "member", nil, nil)
		wantState("employee without an author", err, "23514")
		wantState("half a subject", exec(`insert into forms.responses (form_id, number, version_number, channel, author_id,
			subject_module, answers, review_status) values ($1, 1017, 1, 'member', $2, 'fleet', '[]', 'accepted')`,
			insp, vasiliev), "23514")
		wantOK("guest", exec(`insert into forms.responses (form_id, number, version_number, channel, answers,
			review_status) values ($1, 1018, 1, 'public', '[]', 'pending')`, insp))
		wantState("unknown review status", exec(`update forms.responses set review_status = 'Принят' where id = $1`, r1012),
			"23514")

		// Журнал действий: одна строка на «ответ × правило»; ошибка — только у невыполненного; переживает правило.
		wantOK("action ok", exec(`insert into forms.response_actions (response_id, rule_id, rule_version, kind, ok, text)
			values ($1, $2, 1, 'kb', true, 'Строка в таблице «Осмотры» · страница «Журнал осмотров машин»')`, r1012, au2))
		wantState("second action of the rule", exec(`insert into forms.response_actions (response_id, rule_id, rule_version,
			kind, ok) values ($1, $2, 1, 'kb', true)`, r1012, au2), "23505")
		wantState("failure without an error", exec(`insert into forms.response_actions (response_id, rule_id, rule_version,
			kind, ok) values ($1, gen_random_uuid(), 1, 'kb', false)`, r1012), "23514")
		wantState("success with an error", exec(`insert into forms.response_actions (response_id, rule_id, rule_version,
			kind, ok, error) values ($1, gen_random_uuid(), 1, 'kb', true, 'страница удалена из Базы знаний')`, r1012),
			"23514")
		wantOK("delete the rule", exec(`delete from forms.rules where id = $1`, au2))
		if n := scalar[int](t, db, `select count(*) from forms.response_actions where rule_id = $1`, au2); n != 1 {
			t.Errorf("actions of a deleted rule: %d, want 1", n)
		}

		// Публичная ссылка: только дайджест («sha256:» + 64 hex, возврат 2), одна действующая на форму.
		aa, bb := "sha256:"+strings.Repeat("a", 64), "sha256:"+strings.Repeat("b", 64)
		wantOK("public link", exec(`insert into forms.public_links (form_id, token_digest, created_by)
			values ($1, $2, $3)`, insp, aa, zimina))
		wantState("second active link", exec(`insert into forms.public_links (form_id, token_digest)
			values ($1, $2)`, insp, bb), "23505")
		wantOK("revoke and issue", exec(`update forms.public_links set revoked_at = now() where form_id = $1`, insp))
		wantOK("new link", exec(`insert into forms.public_links (form_id, token_digest) values ($1, $2)`, insp, bb))
		if v := scalar[int](t, db, `select key_version from forms.public_links where token_digest = $1`, bb); v != 1 {
			t.Errorf("key_version of a new link: %d, want 1", v)
		}
		wantState("key version 0", exec(`update forms.public_links set key_version = 0 where token_digest = $1`, bb),
			"23514")
		wantState("digest of another format", exec(`update forms.public_links set token_digest = 'sha256:zz'
			where token_digest = $1`, bb), "23514")
		// Схема вывода токена — в комментарии столбца (возврат 1): её читают W4.21 и W4.25.
		scheme := scalar[string](t, db, `select coalesce(col_description('forms.public_links'::regclass,
			(select attnum from pg_attribute where attrelid = 'forms.public_links'::regclass and attname = 'token_digest')),
			'')`)
		for _, want := range []string{"HMAC-SHA256", "FORMS_PUBLIC_LINK_KEY", "key_version", "public_form_links"} {
			if !strings.Contains(scheme, want) {
				t.Errorf("comment of forms.public_links.token_digest lacks %q: %q", want, scheme)
			}
		}
	})
}

// publicLinkToken — вывод токена по комментарию forms.public_links.token_digest (возврат 1) и его дайджест.
func publicLinkToken(key []byte, tenantID, linkID string) (token, digest string) {
	m := hmac.New(sha256.New, key)
	m.Write([]byte("ortus.forms.public-link.v1\x00" + tenantID + "\x00" + linkID))
	token = base64.RawURLEncoding.EncodeToString(m.Sum(nil))
	sum := sha256.Sum256([]byte(token))
	return token, "sha256:" + hex.EncodeToString(sum[:])
}

// Возврат 2 (ревью W4.05): гостевой маршрут /api/v1/public/forms/{publicToken} без tenantId. Тенант находится по
// индексу control 0009 public_form_links (дайджест → тенант, форма, ссылка), ссылка — в forms.public_links своего
// тенанта (источник истины). Одинаковый id ссылки у двух тенантов даёт разные токены; дайджест один на весь control;
// отозванная ссылка в тенанте не находится, даже если строка индекса ещё не отозвана.
func TestStage4W405PublicLinkRouting(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		cname, _ := migrated(t, c, migrations.Control)
		control := c.DB(t, cname, migrations.RoleAPI)
		tname, _ := migrated(t, c, migrations.Tenant)
		tenantDB := c.DB(t, tname, migrations.RoleAPI)
		ctx := t.Context()
		wantState := func(what string, err error, state string) {
			t.Helper()
			if got := sqlState(err); got != state {
				t.Errorf("%s: SQLSTATE %q (%v), want %s", what, got, err, state)
			}
		}
		must := func(what string, err error) {
			t.Helper()
			if err != nil {
				t.Fatalf("%s: %v", what, err)
			}
		}

		alta := scalar[string](t, control, `insert into tenants (slug, display_name, industry_pack)
			values ('alta', 'Альта Групп', 'logistics') returning id::text`)
		lotos := scalar[string](t, control, `insert into tenants (slug, display_name, industry_pack)
			values ('lotos', 'SPA «Лотос»', 'spa') returning id::text`)

		unit := scalar[string](t, tenantDB, `insert into org.units (kind, name, time_zone)
			values ('company', 'Альта Групп', 'Europe/Moscow') returning id::text`)
		owner := scalar[string](t, tenantDB, `insert into people.person_profiles (full_name, home_unit_id)
			values ('Дарья Зимина', $1) returning id::text`, unit)
		form := scalar[string](t, tenantDB, `insert into forms.forms (name, owner_id, access)
			values ('Отзыв клиента', $1, 'public') returning id::text`, owner)

		// Выпуск: id ссылки — у сервера, строка индекса control, затем строка тенанта с тем же id.
		key := []byte(strings.Repeat("k", 32))
		link := uuid.NewString()
		token, digest := publicLinkToken(key, alta, link)
		if other, _ := publicLinkToken(key, lotos, link); other == token {
			t.Fatal("the same link id of two tenants must give two tokens")
		}
		_, err := control.ExecContext(ctx, `insert into public_form_links (token_digest, tenant_id, form_id, link_id)
			values ($1, $2, $3, $4)`, digest, alta, form, link)
		must("control index row", err)
		_, err = tenantDB.ExecContext(ctx, `insert into forms.public_links (id, form_id, token_digest, created_by)
			values ($1, $2, $3, $4)`, link, form, digest, owner)
		must("tenant link row", err)

		// Маршрут гостя: токен → дайджест → тенант (control) → ссылка и форма (тенант).
		resolve := func(tok string) (string, error) {
			sum := sha256.Sum256([]byte(tok))
			d := "sha256:" + hex.EncodeToString(sum[:])
			var tenantID, linkID string
			if err := control.QueryRowContext(ctx, `select tenant_id::text, link_id::text from public_form_links
				where token_digest = $1 and revoked_at is null`, d).Scan(&tenantID, &linkID); err != nil {
				return "", err
			}
			if tenantID != alta {
				return "", errors.New("routed to another tenant " + tenantID)
			}
			var formID string
			err := tenantDB.QueryRowContext(ctx, `select form_id::text from forms.public_links
				where id = $1 and token_digest = $2 and revoked_at is null`, linkID, d).Scan(&formID)
			return formID, err
		}
		if got, err := resolve(token); err != nil || got != form {
			t.Errorf("resolve the guest token: %q, %v; want form %s", got, err, form)
		}
		if _, err := resolve(token + "x"); !errors.Is(err, sql.ErrNoRows) {
			t.Errorf("an unknown token: %v, want no rows", err)
		}

		// Ограничения индекса: дайджест уникален во всём control, формат «sha256:» + 64 hex, тенант существует.
		wantState("the same digest for another tenant", func() error {
			_, err := control.ExecContext(ctx, `insert into public_form_links (token_digest, tenant_id, form_id, link_id)
				values ($1, $2, $3, $4)`, digest, lotos, form, uuid.NewString())
			return err
		}(), "23505")
		wantState("digest of another format", func() error {
			_, err := control.ExecContext(ctx, `insert into public_form_links (token_digest, tenant_id, form_id, link_id)
				values ('sha256:aa', $1, $2, $3)`, lotos, form, uuid.NewString())
			return err
		}(), "23514")
		_, missing := publicLinkToken(key, uuid.NewString(), uuid.NewString())
		wantState("a missing tenant", func() error {
			_, err := control.ExecContext(ctx, `insert into public_form_links (token_digest, tenant_id, form_id, link_id)
				values ($1, $2, $3, $4)`, missing, uuid.NewString(), form, uuid.NewString())
			return err
		}(), "23503")

		// Отзыв: сначала строка тенанта (источник истины), затем индекс — между шагами гость уже не находит форму.
		_, err = tenantDB.ExecContext(ctx, `update forms.public_links set revoked_at = now() where id = $1`, link)
		must("revoke in the tenant", err)
		if _, err := resolve(token); !errors.Is(err, sql.ErrNoRows) {
			t.Errorf("a link revoked in the tenant: %v, want no rows", err)
		}
		_, err = control.ExecContext(ctx, `update public_form_links set revoked_at = now() where token_digest = $1`, digest)
		must("revoke in the index", err)

		comment := scalar[string](t, control, `select coalesce(obj_description('public_form_links'::regclass, 'pg_class'),
			'')`)
		for _, want := range []string{"token_digest", "tenant_id", "forms.public_links", "/api/v1/public/forms"} {
			if !strings.Contains(comment, want) {
				t.Errorf("comment of public_form_links lacks %q: %q", want, comment)
			}
		}
	})
}
