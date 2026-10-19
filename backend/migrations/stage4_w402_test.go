package migrations_test

import (
	"regexp"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// tenant 0020 контрактного PR 1 этапа 4 (W4.02, 0.7.0-stage4): access.role_assignments.scope_kind принимает виды
// этапов 4–7 (ADR-0014 п. 3; Q-W4.00-repair-2 — объект ремонта repair_project), relation — вычисляемая связь, как
// tenant и self, без scope_ref. Down возвращает проверки tenant 0001 (без cascade).
func TestStage4W402Migration(t *testing.T) {
	t.Parallel()
	const file = "0020_access_scope_kinds_stage4.sql"
	text := readFile(t, migrations.Tenant, file)
	if want := "-- W4.02 · tenant 0020 · "; !strings.HasPrefix(text, want) {
		t.Errorf("first line must start with %q", want)
	}
	up, down := stripComments(upBody(t, text)), stripComments(downBody(t, text))
	kinds := `'tenant', ?'unit', ?'project', ?'warehouse', ?'resource', ?'self', ?'space', ?'page', ?'folder', ?'doc', ?` +
		`'account', ?'chat', ?'relation', ?'repair_project'`
	for _, re := range []string{
		`alter table access\.role_assignments`,
		`drop constraint role_assignments_scope_kind_check`,
		`drop constraint role_assignments_check`,
		`add constraint role_assignments_scope_kind_check check \(scope_kind in \(` + kinds + `\)\)`,
		`add constraint role_assignments_check check \(\(scope_kind in \('tenant', ?'self', ?'relation'\)\) = \(scope_ref is null\)\)`,
	} {
		if !regexp.MustCompile(re).MatchString(up) {
			t.Errorf("Up lacks /%s/", re)
		}
	}
	for _, re := range []string{
		`drop constraint role_assignments_scope_kind_check`,
		`drop constraint role_assignments_check`,
		`add constraint role_assignments_scope_kind_check check \(scope_kind in \('tenant', ?'unit', ?'project', ?'warehouse', ?'resource', ?'self'\)\)`,
		`add constraint role_assignments_check check \(\(scope_kind in \('tenant', ?'self'\)\) = \(scope_ref is null\)\)`,
	} {
		if !regexp.MustCompile(re).MatchString(down) {
			t.Errorf("Down lacks /%s/", re)
		}
	}
	if strings.Contains(down, "cascade") {
		t.Error("Down must not use cascade")
	}
	// Возврат 1: Down данные не чистит — комментарий Down предупреждает, что при назначениях новых видов откат
	// падает 23514 (политика «только вперёд»), а не удаляет их молча.
	if !regexp.MustCompile(`(?m)^-- .*23514.*$`).MatchString(downBody(t, text)) {
		t.Error("Down must warn in a comment that it fails with 23514 while assignments of the new kinds exist")
	}
}
