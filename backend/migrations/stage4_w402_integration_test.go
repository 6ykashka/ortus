//go:build integration

package migrations_test

import (
	"database/sql"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// tenant 0020 (W4.02) на реальном сервере под runtime-ролью API: назначения видов этапов 4–7 записываются, объектные —
// ровно с одним объектом (scope_ref), relation — без него; вид вне списка (repair_object ADR-0014 до Q-W4.00-repair-2)
// и объектный вид без объекта — 23514.
func TestStage4W402ScopeKinds(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		name, _ := migrated(t, c, migrations.Tenant)
		db := c.DB(t, name, migrations.RoleAPI)
		ctx := t.Context()
		person := uuid.NewString()
		role := scalar[string](t, db, `insert into access.roles (name, kind) values ('Руководитель пространства', 'custom')
			returning id::text`)
		if _, err := db.ExecContext(ctx, `insert into access.role_versions (role_id, version, actions, created_by)
			values ($1, 1, '{knowledge.read}', $2)`, role, person); err != nil {
			t.Fatal(err)
		}
		grant := func(kind string, ref *string) error {
			_, err := db.ExecContext(ctx, `insert into access.role_assignments (principal_kind, principal_id, role_id,
				role_version, scope_kind, scope_ref, include_descendants, granted_by)
				values ('person', $1, $2, 1, $3, $4, false, $1)`, person, role, kind, ref)
			return err
		}
		object := func() *string { id := uuid.NewString(); return &id }

		for _, kind := range []string{"space", "page", "folder", "doc", "account", "chat", "repair_project"} {
			if err := grant(kind, object()); err != nil {
				t.Errorf("%s with an object: %v", kind, err)
			}
			if got := sqlState(grant(kind, nil)); got != "23514" {
				t.Errorf("%s without an object: SQLSTATE %q, want 23514", kind, got)
			}
		}
		if err := grant("relation", nil); err != nil {
			t.Errorf("relation without an object: %v", err)
		}
		if got := sqlState(grant("relation", object())); got != "23514" {
			t.Errorf("relation with an object: SQLSTATE %q, want 23514", got)
		}
		for _, kind := range []string{"repair_object", "service_direction", "kb_space"} {
			if got := sqlState(grant(kind, object())); got != "23514" {
				t.Errorf("%s: SQLSTATE %q, want 23514", kind, got)
			}
		}
		// Виды tenant 0001 не меняются.
		if err := grant("project", object()); err != nil {
			t.Errorf("project with an object: %v", err)
		}
		if err := grant("self", nil); err != nil {
			t.Errorf("self: %v", err)
		}
		if got := sqlState(grant("tenant", object())); got != "23514" {
			t.Errorf("tenant with an object: SQLSTATE %q, want 23514", got)
		}
	})
}

// Возврат 1 W4.02: номер ниже уже применённого раннер не применяет (goose без WithAllowOutofOrder). Так придёт
// tenant 0019 W2.71, если 0020 W4.02 уже накатан на существующую БД (стенды слотов, стенд показа): строка версии
// удаляется — файл «пришёл позже». Пока новых файлов нет, Up молча пропускает пропущенную миграцию (from = Latest);
// следующая миграция (здесь — 0020) падает ошибкой goose «missing migrations». Отсюда порядок вливания в api/README.md.
func TestStage4W402LateLowerVersionRefused(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		ctx := t.Context()
		latest := migrations.Latest(migrations.Tenant)
		forget := func(db *sql.DB, versions ...int64) {
			t.Helper()
			for _, v := range versions {
				if _, err := db.ExecContext(ctx, `delete from public.goose_db_version where version_id = $1`, v); err != nil {
					t.Fatal(err)
				}
			}
		}
		applied := func(db *sql.DB, v int64) int {
			return scalar[int](t, db, `select count(*)::int from public.goose_db_version where version_id = $1 and is_applied`, v)
		}

		// Ниже применённого максимума — 0018, новых файлов нет: Up — без ошибки и без применения 0018.
		_, skip := migrated(t, c, migrations.Tenant)
		forget(skip, latest-2)
		res, err := migrations.Up(ctx, skip, migrations.Tenant)
		if err != nil || res != (migrations.Result{From: latest, To: latest}) {
			t.Fatalf("Up with a late lower version = %+v, %v; want {%d %d}, nil", res, err, latest, latest)
		}
		if n := applied(skip, latest-2); n != 0 {
			t.Errorf("version %d applied %d times, want 0 (silently skipped)", latest-2, n)
		}

		// Пропуск 0017 ниже применённой 0018 и не применённая 0020: Up отказывает — missing migrations.
		_, refuse := migrated(t, c, migrations.Tenant)
		forget(refuse, latest-3, latest)
		res, err = migrations.Up(ctx, refuse, migrations.Tenant)
		if err == nil || !strings.Contains(err.Error(), "missing") {
			t.Fatalf("Up over a missing lower version = %+v, %v; want a goose missing-migrations error", res, err)
		}
		if n := applied(refuse, latest); n != 0 {
			t.Errorf("version %d applied after the refusal", latest)
		}
	})
}
