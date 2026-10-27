//go:build isolation

package fixtures

import (
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
	harness "github.com/ortus/ortus-crm/backend/test"
)

// W6.11 (возврат 1): у фикстур подключён модуль «Ремонт и стройка» у организации A — только WithInTenant (иначе
// integration-тесты модулей, считающие подключённые модули и людей A, видят лишнее); у B модуля нет (строки шлюза
// «не подключён у организации B»). В A два объекта ремонта с прорабами: «Квартира на Лесной» (repair_project:a.flat)
// и «Дом на Речной» (repair_project:a.other, чужой прораб), у «Лесной» — работа и отметка на приёмке.
func TestLoadRepairs(t *testing.T) {
	t.Parallel()
	now := harness.Now()
	w, err := Load(t.Context(), cluster, "fx_repairs", now, WithInTenant())
	if err != nil {
		t.Fatal(err)
	}
	a := cluster.DB(t, w.TenantDBs[TenantA], migrations.RoleAPI)
	b := cluster.DB(t, w.TenantDBs[TenantB], migrations.RoleAPI)
	if n := count(t, a, `select count(*) from modules.installations where module_key = 'repairs' and state = 'enabled'`); n != 1 {
		t.Errorf("repairs installed in A = %d, want 1", n)
	}
	if n := count(t, b, `select count(*) from modules.installations where module_key = 'repairs'`); n != 0 {
		t.Errorf("repairs installed in B = %d, want 0", n)
	}
	for _, c := range []struct{ project, foreman string }{
		{"repair_project:a.flat", "person:a.repairs-foreman@a"},
		{"repair_project:a.other", "person:a.repairs-foreman-two@a"},
	} {
		if n := count(t, a, `select count(*) from repairs.projects where id = $1 and foreman_id = $2 and status = 'active'
			and budget_minor is not null and client_phone is not null`, id(t, w, c.project), id(t, w, c.foreman)); n != 1 {
			t.Errorf("%s is not an active object of %s with a budget and a phone", c.project, c.foreman)
		}
	}
	if n := count(t, a, `select count(*) from repairs.works where project_id = $1`, id(t, w, "repair_project:a.flat")); n != 1 {
		t.Errorf("works of a.flat = %d, want 1", n)
	}
	if n := count(t, a, `select count(*) from repairs.work_logs where project_id = $1 and status = 'submitted'`,
		id(t, w, "repair_project:a.flat")); n != 1 {
		t.Errorf("marks of a.flat on acceptance = %d, want 1", n)
	}
	// Прораб — роль без repairs.finance.read в области своего объекта.
	if n := count(t, a, `select count(*) from access.role_assignments ra join access.role_versions v on v.role_id = ra.role_id
		and v.version = ra.role_version where ra.principal_id = $1 and ra.scope_kind = 'repair_project' and ra.scope_ref = $2
		and 'repairs.work_logs.submit' = any(v.actions) and not 'repairs.finance.read' = any(v.actions)`,
		id(t, w, "person:a.repairs-foreman@a"), id(t, w, "repair_project:a.flat")); n != 1 {
		t.Error("a.repairs-foreman has no foreman grant on a.flat without repairs.finance.read")
	}

	content, err := Load(t.Context(), cluster, "fx_repairs_off", now, WithContent())
	if err != nil {
		t.Fatal(err)
	}
	plain := cluster.DB(t, content.TenantDBs[TenantA], migrations.RoleAPI)
	if n := count(t, plain, `select count(*) from modules.installations where module_key = 'repairs'`); n != 0 {
		t.Error("WithContent installed the module repairs")
	}
	if n := count(t, plain, `select count(*) from repairs.projects`); n != 0 {
		t.Errorf("WithContent wrote %d objects of repairs, want 0", n)
	}
}
