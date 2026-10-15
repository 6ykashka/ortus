//go:build integration

package migrations_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// Ограничения миграций этапа 1 (W0.08, tenant 0003–0006) на реальном сервере под runtime-ролью API.
func TestStage1Constraints(t *testing.T) {
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

		unit := scalar[string](t, db, `insert into org.units (kind, name, time_zone)
			values ('company', 'Север Логистик', 'Europe/Moscow') returning id::text`)
		person := scalar[string](t, db, `insert into people.person_profiles (full_name, home_unit_id)
			values ('Дарья Зимина', $1) returning id::text`, unit)

		// 0003: одно событие outbox → одно уведомление адресату (повтор доставки не дублирует).
		note := `insert into notify.notifications (recipient_person_id, kind, severity, title, unit_id, source_event_id)
			values ($1, 'members.invitation.accepted', $2, 'Олеся Петрова приняла приглашение', $3,
			        '6f1c2a3b-0000-4000-8000-000000000001')`
		if err := exec(note, person, "info", unit); err != nil {
			t.Fatalf("insert notification: %v", err)
		}
		wantState("duplicate source_event_id", exec(note, person, "info", unit), "23505")
		wantState("unknown severity", exec(`insert into notify.notifications (recipient_person_id, kind, severity, title)
			values ($1, 'fleet.trip.submitted', 'loud', 'Рейс сдан')`, person), "23514")
		if n := scalar[int](t, db, `update notify.notifications set read_at = now()
			where recipient_person_id = $1 and read_at is null returning 1`, person); n != 1 {
			t.Errorf("mark read: %d rows", n)
		}
		// link — путь того же источника (CWE-601): `\` браузер читает как `/`, так что /\host — чужой хост.
		link := `insert into notify.notifications (recipient_person_id, kind, title, link)
			values ($1, 'billing.invoice.issued', 'Счёт выставлен', $2)`
		for _, ok := range []string{"/", "/billing", "/tasks?id=1#comments"} {
			if err := exec(link, person, ok); err != nil {
				t.Errorf("link %q: %v", ok, err)
			}
		}
		for _, bad := range []string{
			"billing", "https://evil.example", "//evil.example", `/\evil.example`, `/\/evil.example`,
			`/a\b`, "/\t/evil.example", "/ /evil.example", "/" + strings.Repeat("a", 512),
		} {
			wantState(fmt.Sprintf("link %q", bad), exec(link, person, bad), "23514")
		}

		// 0004: одна сессия на файл, состояние из перечня; purpose — значение UploadCreate.purpose один к одному.
		file := scalar[string](t, db, `insert into files.objects
			(object_key, state, purpose, owner_type, owner_id, declared_mime, uploaded_by)
			values ('t/quarantine/1', 'reserved', 'inspection', 'fleet.reservation', gen_random_uuid(),
			        'image/jpeg', gen_random_uuid()) returning id::text`)
		session := `insert into files.upload_sessions
			(file_id, actor_id, state, reserved_bytes, ticket_expires_at, session_expires_at)
			values ($1, gen_random_uuid(), $2, 2457600, now() + interval '15 minutes', now() + interval '1 hour')`
		wantState("unknown session state", exec(session, file, "lost"), "23514")
		if err := exec(session, file, "issued"); err != nil {
			t.Fatalf("insert upload session: %v", err)
		}
		wantState("second session for the file", exec(session, file, "issued"), "23505")

		// 0005: импорт по умолчанию — предпросмотр; номер строки уникален в импорте.
		imp := scalar[string](t, db, `insert into people.imports
			(file_name, default_unit_id, created_by, expires_at, totals)
			values ('Водители Север.csv', $1, gen_random_uuid(), now() + interval '24 hours', '{}')
			returning id::text`, unit)
		if st := scalar[string](t, db, `select state from people.imports where id = $1`, imp); st != "previewed" {
			t.Errorf("import state = %q, want previewed", st)
		}
		row := `insert into people.import_rows (import_id, line, action, data, errors)
			values ($1, 2, 'create', '{"full_name":"Семён Лапин"}', '[]')`
		if err := exec(row, imp); err != nil {
			t.Fatalf("insert import row: %v", err)
		}
		wantState("duplicate import line", exec(row, imp), "23505")
		// Строки удаляются только у применённого импорта (через 30 дней после commit, Q-W0.08-5).
		wantState("rows purged before commit", exec(`update people.imports set rows_purged_at = now()
			where id = $1`, imp), "23514")
		if err := exec(`update people.imports set state = 'committed', committed_at = now(),
			rows_purged_at = now() where id = $1`, imp); err != nil {
			t.Errorf("purge rows of a committed import: %v", err)
		}

		// 0006: ревизия группы с 1; имя уникально среди активных групп без учёта регистра.
		if rev := scalar[int](t, db, `insert into access.groups (name, home_unit_id)
			values ('Водители Север', $1) returning revision`, unit); rev != 1 {
			t.Errorf("group revision = %d, want 1", rev)
		}
		wantState("duplicate active group name", exec(`insert into access.groups (name) values ('водители север')`), "23505")
		if err := exec(`insert into access.groups (name, archived_at) values ('Водители Север', now())`); err != nil {
			t.Errorf("archived group with the same name: %v", err)
		}
	})
}

// Down 0003 без cascade: чужой объект в схеме notify (резерв 0007–0009, канал реального времени)
// останавливает откат ошибкой, а не снимается молча.
func TestStage1DownKeepsForeignObjects(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		_, db := migrated(t, c, migrations.Tenant)
		if _, err := db.ExecContext(t.Context(), `create table notify.realtime_cursors (id bigint primary key)`); err != nil {
			t.Fatalf("create foreign table: %v", err)
		}
		if _, err := migrations.DownTo(t.Context(), db, migrations.Tenant, 2); err == nil {
			t.Fatal("down to 2 with a foreign object in notify: want error")
		}
		q := `select count(*) from information_schema.tables where table_schema = 'notify'
			and table_name = 'realtime_cursors'`
		if got := scalar[int](t, db, q); got != 1 {
			t.Errorf("notify.realtime_cursors dropped by down (count %d)", got)
		}
	})
}

// Down до версии 2 снимает ровно объекты этапа 1; v0.2 остаётся целой.
func TestStage1Down(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		_, db := migrated(t, c, migrations.Tenant)
		if res, err := migrations.DownTo(t.Context(), db, migrations.Tenant, 2); err != nil || res.To != 2 {
			t.Fatalf("down to 2 = %+v, %v", res, err)
		}
		for q, want := range map[string]int{
			`select count(*) from pg_namespace where nspname = 'notify'`: 0,
			`select count(*) from information_schema.tables where table_schema = 'files'
				and table_name = 'upload_sessions'`: 0,
			`select count(*) from information_schema.tables where table_schema = 'people'
				and table_name in ('imports', 'import_rows')`: 0,
			`select count(*) from information_schema.columns where table_schema = 'access'
				and table_name in ('groups', 'group_members') and column_name in
				('revision', 'description', 'home_unit_id', 'archived_at', 'updated_at', 'added_at', 'added_by')`: 0,
			`select count(*) from information_schema.tables
				where table_schema not in ('public','pg_catalog','information_schema') and table_type = 'BASE TABLE'`: 36,
		} {
			if got := scalar[int](t, db, q); got != want {
				t.Errorf("%s = %d, want %d", q, got, want)
			}
		}
	})
}
