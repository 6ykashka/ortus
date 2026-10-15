//go:build integration

package roles_test

import (
	"context"
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/accesstest" //nolint:depguard // the access module's own test helper (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/modules/access/roles"                  //nolint:depguard // the package under test (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

var server *accesstest.Server

func TestMain(m *testing.M) {
	s, stop, err := accesstest.Start(context.Background())
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	server = s
	code := m.Run()
	stop()
	os.Exit(code)
}

// world: владелец, администратор ролей на всю организацию (roles.manage, roles.read, fleet.trips.read),
// водитель; роли — системная «Владелец бизнеса», шаблон «Водитель», своя «Диспетчер».
type world struct {
	*accesstest.World
	h                           *roles.Handler
	firm                        uuid.UUID
	owner, admin, driver        tenantctx.TenantContext
	ownerRole, driverRole, disp uuid.UUID
	adminRole                   uuid.UUID
}

func newWorld(t *testing.T) *world {
	t.Helper()
	w := &world{World: server.NewWorld(t)}
	w.firm = w.Unit("Москва-1", uuid.Nil)
	owner := w.Member("Дарья Зимина", "d.zimina@alta.example", w.firm)
	w.Owner(owner)
	admin := w.Member("Администратор", "admin@alta.example", w.firm)
	driver := w.Member("Илья Васильев", "i.vasiliev@alta.example", w.firm)
	w.Function(driver, authz.FunctionDriver, w.firm, nil)
	w.ownerRole = w.Role("Владелец бизнеса", "system", "owner", "members.read")
	w.driverRole = w.Role("Водитель", "template", "driver", "fleet.trips.read", "fleet.trips.start")
	w.disp = w.Role("Диспетчер", "custom", "", "fleet.routes.read")
	w.adminRole = w.Role("Администратор ролей", "custom", "", "roles.manage", "roles.read", "fleet.trips.read")
	w.Assign(accesstest.Grant{Principal: admin, Role: w.adminRole, Kind: "tenant"})
	w.Assign(accesstest.Grant{Principal: driver, Role: w.driverRole, Kind: "self"})
	w.owner, w.admin, w.driver = w.TC(owner), w.TC(admin), w.TC(driver)
	w.h = roles.New(w.Deps())
	return w
}

func names(items []accessapi.Role) []string {
	out := make([]string, 0, len(items))
	for _, r := range items {
		out = append(out, r.Name)
	}
	return out
}

// Список ролей: живые роли по имени, системная — builtIn, архивные не видны.
func TestListRoles(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	archived := w.Role("Архивная", "custom", "")
	if _, err := w.Tenant.Exec(t.Context(), `update access.roles set archived_at = now() where id = $1`, archived); err != nil {
		t.Fatal(err)
	}
	resp, err := w.h.ListRoles(w.Ctx(w.owner), accessapi.ListRolesRequestObject{TenantId: w.TenantID})
	page := accesstest.As[accessapi.ListRoles200JSONResponse](t, resp, err).Body
	if got := names(page.Items); !slices.Equal(got, allRoles) || page.NextCursor != nil {
		t.Fatalf("roles = %v (cursor %v), want %v", got, page.NextCursor, allRoles)
	}
	for _, r := range page.Items {
		if r.BuiltIn != (r.Id == w.ownerRole) || r.Revision != 1 || r.Description != "" || r.Permissions == nil {
			t.Errorf("role %+v", r)
		}
	}
}

var allRoles = []string{"Администратор ролей", "Владелец бизнеса", "Водитель", "Диспетчер"}

// Курсорная пагинация: страницы по 3, без повторов и пропусков.
func TestListRolesPages(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	limit, seen := 3, []string{}
	req := accessapi.ListRolesRequestObject{TenantId: w.TenantID, Params: accessapi.ListRolesParams{Limit: &limit}}
	for range 3 {
		resp, err := w.h.ListRoles(w.Ctx(w.admin), req)
		p := accesstest.As[accessapi.ListRoles200JSONResponse](t, resp, err).Body
		seen = append(seen, names(p.Items)...)
		if p.NextCursor == nil {
			break
		}
		req.Params.Cursor = p.NextCursor
	}
	if !slices.Equal(seen, allRoles) {
		t.Errorf("pages = %v, want %v", seen, allRoles)
	}
}

func TestGetRole(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	resp, err := w.h.GetRole(w.Ctx(w.admin), accessapi.GetRoleRequestObject{TenantId: w.TenantID, RoleId: w.disp})
	r := accesstest.As[accessapi.GetRole200JSONResponse](t, resp, err)
	if r.Body.Name != "Диспетчер" || !slices.Equal(r.Body.Permissions, []string{"fleet.routes.read"}) || r.Headers.ETag == nil || *r.Headers.ETag != `"1"` {
		t.Errorf("role %+v etag %v", r.Body, r.Headers.ETag)
	}
	if _, err := w.h.GetRole(w.Ctx(w.admin), accessapi.GetRoleRequestObject{TenantId: w.TenantID, RoleId: uuid.New()}); accesstest.Code(err) != problem.CodeNotFound {
		t.Errorf("unknown role: %v", err)
	}
}

func create(t *testing.T, w *world, tc tenantctx.TenantContext, name string, perms ...string) (accessapi.Role, error) {
	t.Helper()
	if perms == nil {
		perms = []string{}
	}
	resp, err := w.h.CreateRole(w.Ctx(tc), accessapi.CreateRoleRequestObject{TenantId: w.TenantID,
		Body: &accessapi.RoleCreate{Name: name, Permissions: perms}})
	if err != nil {
		return accessapi.Role{}, err
	}
	r := accesstest.As[accessapi.CreateRole201JSONResponse](t, resp, nil)
	if r.Headers.ETag == nil || *r.Headers.ETag != `"1"` {
		t.Errorf("ETag %v", r.Headers.ETag)
	}
	return r.Body, nil
}

// Создание роли (S1-12): пустая роль; участник со своими правами; аудит — с чувствительностью прав роли
// (sensitive и restricted отдельно).
func TestCreateRole(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	empty, err := create(t, w, w.owner, "  Пустая роль  ")
	if err != nil || empty.Name != "Пустая роль" || len(empty.Permissions) != 0 || empty.BuiltIn || empty.Revision != 1 {
		t.Fatalf("empty role: %+v %v", empty, err)
	}
	if n := w.Count(`select 1 from access.roles r join access.role_versions v on v.role_id = r.id and v.version = 1
		where r.id = $1 and r.kind = 'custom' and cardinality(v.actions) = 0`, empty.Id); n != 1 {
		t.Errorf("stored empty role: %d", n)
	}
	if r, err := create(t, w, w.admin, "Свои права", "fleet.trips.read"); err != nil || !slices.Equal(r.Permissions, []string{"fleet.trips.read"}) {
		t.Errorf("own rights: %+v %v", r, err)
	}
	if _, err := create(t, w, w.owner, "Финансы", "fleet.earnings.read", "roles.assign", "tasks.read"); err != nil {
		t.Fatal(err)
	}
	if n := w.Count(`select 1 from audit.events where action = 'access.role.create' and sensitivity = 'restricted'
		and diff->'restricted' = '["fleet.earnings.read"]' and diff->'sensitive' = '["roles.assign"]'`); n != 1 {
		t.Errorf("audit of the role with restricted rights: %d", n)
	}
}

// Отказы создания: имя обязательно и уникально, ключи — только из каталога, участник выдаёт только свои права
// (AUTH-08), owner_only — только владелец.
func TestCreateRoleRefusals(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	for name, tc := range map[string]struct {
		actor tenantctx.TenantContext
		name  string
		perms []string
		want  string // code or code|detail
	}{
		"без имени":                 {w.owner, "   ", nil, "validation_failed|Укажите название роли"},
		"длинное имя":               {w.owner, strings.Repeat("я", 101), nil, "validation_failed"},
		"имя занято (без регистра)": {w.owner, "диспетчер", nil, "validation_failed|Роль с таким названием уже есть"},
		"неизвестный ключ":          {w.owner, "Странная", []string{"fleet.weird"}, "validation_failed"},
		"ключ платформы":            {w.owner, "Оператор", []string{"platform.tenants.read"}, "validation_failed"},
		"ключ дважды":               {w.owner, "Дубль", []string{"tasks.read", "tasks.read"}, "validation_failed"},
		"чужие права участнику":     {w.admin, "Начисления", []string{"fleet.earnings.read"}, "delegation_exceeds_grant"},
		"owner_only участнику":      {w.admin, "Модули", []string{"modules.manage"}, "delegation_exceeds_grant"},
	} {
		_, err := create(t, w, tc.actor, tc.name, tc.perms...)
		if got := accesstest.Problem(err); got != tc.want && accesstest.Code(err) != tc.want {
			t.Errorf("%s: %s, want %s", name, got, tc.want)
		}
	}
}

func update(t *testing.T, w *world, tc tenantctx.TenantContext, id uuid.UUID, rev string, patch accessapi.RolePatch) (accessapi.Role, error) {
	t.Helper()
	resp, err := w.h.UpdateRole(w.Ctx(tc), accessapi.UpdateRoleRequestObject{TenantId: w.TenantID, RoleId: id,
		Params: accessapi.UpdateRoleParams{IfMatch: rev}, Body: &patch})
	if err != nil {
		return accessapi.Role{}, err
	}
	return accesstest.As[accessapi.UpdateRole200JSONResponse](t, resp, nil).Body, nil
}

// Правка роли: новые права получают держатели (назначения переходят на новую версию, policy_version + 1);
// переименование — новая ревизия без новой policy_version; аудит каждой правки.
func TestUpdateRole(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	holder := w.Member("Марина Котова", "m.kotova@alta.example", w.firm)
	w.Assign(accesstest.Grant{Principal: holder, Role: w.disp, Kind: "unit", Ref: w.firm, Descendants: true})
	before := w.PolicyVersion()
	r, err := update(t, w, w.owner, w.disp, `"1"`, accessapi.RolePatch{Name: new("Диспетчер Север"), Permissions: new([]string{"fleet.routes.read", "fleet.routes.manage"})})
	if err != nil || r.Name != "Диспетчер Север" || r.Revision != 2 || !slices.Equal(r.Permissions, []string{"fleet.routes.read", "fleet.routes.manage"}) {
		t.Fatalf("update: %+v %v", r, err)
	}
	if n := w.Count(`select 1 from access.role_assignments where role_id = $1 and role_version = 2`, w.disp); n != 1 || w.PolicyVersion() != before+1 {
		t.Errorf("assignments on version 2: %d, policy version %d → %d", n, before, w.PolicyVersion())
	}
	if err := w.Evaluator().Permit(w.Ctx(w.TC(holder)), w.TC(holder), "fleet.routes.manage", authz.Resource{Unit: w.firm}); err != nil {
		t.Errorf("holder gets the new right: %v", err)
	}
	if r, err = update(t, w, w.owner, w.disp, `"2"`, accessapi.RolePatch{Name: new("Диспетчер")}); err != nil || r.Revision != 3 || w.PolicyVersion() != before+1 {
		t.Errorf("rename: %+v %v policy %d", r, err, w.PolicyVersion())
	}
	if n := w.Count(`select 1 from audit.events where action = 'access.role.update' and target_id = $1`, w.disp); n != 2 {
		t.Errorf("audit of updates: %d", n)
	}
}

// Отказы правки: ревизия (If-Match), системная роль не редактируется; участник снимает чужое право, но не добавляет.
func TestUpdateRoleRefusals(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	if _, err := update(t, w, w.owner, w.disp, `"2"`, accessapi.RolePatch{Name: new("Диспетчер Север")}); accesstest.Code(err) != "revision_mismatch" {
		t.Errorf("stale If-Match: %v", err)
	}
	if _, err := update(t, w, w.owner, w.ownerRole, `"1"`, accessapi.RolePatch{Name: new("Хозяин")}); accesstest.Problem(err) != "invalid_transition|Системная роль не редактируется" {
		t.Errorf("system role: %v", err)
	}
	if _, err := update(t, w, w.admin, w.disp, `"1"`, accessapi.RolePatch{Permissions: new([]string{"fleet.routes.read", "fleet.earnings.read"})}); accesstest.Code(err) != "delegation_exceeds_grant" {
		t.Errorf("admin adds a foreign right: %v", err)
	}
	if r, err := update(t, w, w.admin, w.disp, `"1"`, accessapi.RolePatch{Permissions: new([]string{})}); err != nil || r.Revision != 2 {
		t.Errorf("admin removes a right: %+v %v", r, err)
	}
}

// SoD при правке роли (D-10): роль «Водитель» не содержит начислений; роль, назначенная водителю, их не получает.
func TestUpdateRoleSeparationOfDuties(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	held := w.Role("Рейсы", "custom", "", "fleet.trips.read")
	w.Assign(accesstest.Grant{Principal: w.driver.PersonID, Role: held, Kind: "self"})
	for name, tc := range map[string]struct {
		role uuid.UUID
		want string
	}{
		"шаблон водителя":         {w.driverRole, "separation_of_duties_conflict|Роль с функцией «Водитель» не может содержать начисления"},
		"роль назначена водителю": {held, "separation_of_duties_conflict|Роль назначена водителю — финансовые права недоступны"},
	} {
		_, err := update(t, w, w.owner, tc.role, `"1"`, accessapi.RolePatch{Permissions: new([]string{"fleet.trips.read", "fleet.earnings.read"})})
		if got := accesstest.Problem(err); got != tc.want {
			t.Errorf("%s: %s", name, got)
		}
	}
	if _, err := update(t, w, w.owner, w.disp, `"1"`, accessapi.RolePatch{Permissions: new([]string{"fleet.earnings.read"})}); err != nil {
		t.Errorf("earnings in a role without drivers: %v", err)
	}
}

func remove(t *testing.T, w *world, tc tenantctx.TenantContext, id uuid.UUID, rev string) error {
	t.Helper()
	resp, err := w.h.DeleteRole(w.Ctx(tc), accessapi.DeleteRoleRequestObject{TenantId: w.TenantID, RoleId: id,
		Params: accessapi.DeleteRoleParams{IfMatch: rev}})
	if err == nil {
		accesstest.As[accessapi.DeleteRole204Response](t, resp, nil)
	}
	return err
}

// Удаление: системная и назначенная роль — 409 (права у участников молча не пропадают), устаревшая ревизия — 412;
// удалённая роль — 404, её имя снова свободно.
func TestDeleteRole(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	for name, tc := range map[string]struct {
		role uuid.UUID
		rev  string
		code string
	}{
		"системная": {w.ownerRole, `"1"`, "invalid_transition"},
		"назначена": {w.driverRole, `"1"`, "invalid_transition"},
		"ревизия":   {w.disp, `"5"`, "revision_mismatch"},
		"нет такой": {uuid.New(), `"1"`, "not_found"},
	} {
		if got := accesstest.Code(remove(t, w, w.owner, tc.role, tc.rev)); got != tc.code {
			t.Errorf("%s: %s, want %s", name, got, tc.code)
		}
	}
	if err := remove(t, w, w.owner, w.disp, `"1"`); err != nil {
		t.Fatal(err)
	}
	if _, err := w.h.GetRole(w.Ctx(w.owner), accessapi.GetRoleRequestObject{TenantId: w.TenantID, RoleId: w.disp}); accesstest.Code(err) != "not_found" {
		t.Errorf("deleted role: %v", err)
	}
	if _, err := create(t, w, w.owner, "Диспетчер"); err != nil {
		t.Errorf("name is free again: %v", err)
	}
	if n := w.Count(`select 1 from audit.events where action = 'access.role.delete' and target_id = $1`, w.disp); n != 1 {
		t.Errorf("audit: %d", n)
	}
}

// access.policy.bumped.v1 правки роли — для relay W1.07: держатели роли прямо и через группу.
func TestUpdateRolePolicyBump(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	holder := w.Member("Марина Котова", "m.kotova@alta.example", w.firm)
	viaGroup := w.Card("Олеся Петрова", w.firm)
	w.Assign(accesstest.Grant{Principal: holder, Role: w.disp, Kind: "unit", Ref: w.firm})
	grp := w.Group("Диспетчеры", w.firm, viaGroup)
	w.Assign(accesstest.Grant{Group: true, Principal: grp, Role: w.disp, Kind: "unit", Ref: w.firm})
	before := w.PolicyVersion()
	if _, err := update(t, w, w.owner, w.disp, `"1"`, accessapi.RolePatch{Permissions: new([]string{"fleet.routes.read", "fleet.routes.manage"})}); err != nil {
		t.Fatal(err)
	}
	w.CheckPolicyBump(w.LastPolicyBump(), before+1, holder, viaGroup)
}

// AUTH-08 по областям при правке роли: добавленное право у держателей действует в областях их назначений, поэтому
// участник добавляет его, только если сам имеет это право в каждой такой области (иначе 409 delegation_exceeds_grant);
// владелец — без ограничений.
func TestUpdateRoleDelegationByScope(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	other := w.Unit("Москва-2", uuid.Nil)
	local := w.Role("Начисления Москва-1", "custom", "", "fleet.earnings.read")
	w.Assign(accesstest.Grant{Principal: w.admin.PersonID, Role: local, Kind: "unit", Ref: w.firm, Descendants: true})
	holder := w.Member("Марина Котова", "m.kotova@alta.example", w.firm)
	wide := w.Role("Диспетчер организации", "custom", "", "fleet.routes.read")
	w.Assign(accesstest.Grant{Principal: holder, Role: wide, Kind: "tenant", Descendants: true})
	elsewhere := w.Role("Диспетчер Москва-2", "custom", "", "fleet.routes.read")
	w.Assign(accesstest.Grant{Principal: holder, Role: elsewhere, Kind: "unit", Ref: other})
	inside := w.Role("Диспетчер Москва-1", "custom", "", "fleet.routes.read")
	w.Assign(accesstest.Grant{Principal: holder, Role: inside, Kind: "unit", Ref: w.firm})
	earnings := new([]string{"fleet.routes.read", "fleet.earnings.read"})
	for name, role := range map[string]uuid.UUID{"роль на всю организацию": wide, "роль на чужое подразделение": elsewhere} {
		if _, err := update(t, w, w.admin, role, `"1"`, accessapi.RolePatch{Permissions: earnings}); accesstest.Code(err) != "delegation_exceeds_grant" {
			t.Errorf("%s: %v", name, err)
		}
	}
	if n := w.Count(`select 1 from access.role_versions where role_id = any($1) and version > 1`, []uuid.UUID{wide, elsewhere}); n != 0 {
		t.Errorf("versions after refusals: %d", n)
	}
	if _, err := update(t, w, w.admin, inside, `"1"`, accessapi.RolePatch{Permissions: earnings}); err != nil {
		t.Errorf("a role held only where the admin has the right: %v", err)
	}
	if _, err := update(t, w, w.owner, wide, `"1"`, accessapi.RolePatch{Permissions: earnings}); err != nil {
		t.Errorf("owner: %v", err)
	}
}

// D-10 под конкуренцией: держатель роли становится водителем в параллельной команде — правка роли с начислениями
// ждёт её блокировку и получает 409; архив роли ждёт параллельное назначение и получает 409.
func TestRoleCommandsWaitForConcurrentChanges(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	holder := w.Member("Марина Котова", "m.kotova@alta.example", w.firm)
	w.Assign(accesstest.Grant{Principal: holder, Role: w.disp, Kind: "unit", Ref: w.firm})
	held := w.HoldPolicy(`insert into people.work_profiles (person_id, function, unit_id, valid) values ($1, 'driver', $2, tstzrange($3::timestamptz, null))`,
		holder, w.firm, w.Now.Add(-time.Hour))
	patch := accessapi.RolePatch{Permissions: new([]string{"fleet.routes.read", "fleet.earnings.read"})}
	run := accesstest.Go(func() error {
		_, err := w.h.UpdateRole(w.Ctx(w.owner), accessapi.UpdateRoleRequestObject{TenantId: w.TenantID, RoleId: w.disp,
			Params: accessapi.UpdateRoleParams{IfMatch: `"1"`}, Body: &patch})
		return err
	})
	if !run.Running(accesstest.Pause) {
		t.Error("updateRole did not wait for the concurrent command")
	}
	if err := held.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	if got := accesstest.Problem(run.Wait()); got != "separation_of_duties_conflict|Роль назначена водителю — финансовые права недоступны" {
		t.Errorf("earnings to a role of a new driver: %q", got)
	}

	unused := w.Role("Пока без назначений", "custom", "", "fleet.routes.read")
	held = w.HoldPolicy(`insert into access.role_assignments (principal_kind, principal_id, role_id, role_version, scope_kind, valid, granted_by)
		values ('person', $1, $2, 1, 'tenant', tstzrange($3::timestamptz, null), $1)`, holder, unused, w.Now.Add(-time.Hour))
	run = accesstest.Go(func() error {
		_, err := w.h.DeleteRole(w.Ctx(w.owner), accessapi.DeleteRoleRequestObject{TenantId: w.TenantID, RoleId: unused,
			Params: accessapi.DeleteRoleParams{IfMatch: `"1"`}})
		return err
	})
	if !run.Running(accesstest.Pause) {
		t.Error("deleteRole did not wait for the concurrent command")
	}
	if err := held.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	if got := accesstest.Code(run.Wait()); got != "invalid_transition" {
		t.Errorf("archive of a role assigned meanwhile: %q", got)
	}
}

// Ввод: без тела — 400, длинное описание — 422, limit и курсор — 400.
func TestRolesInput(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := w.Ctx(w.owner)
	long := strings.Repeat("я", 1001)
	zero, broken := 0, "!!"
	for name, err := range map[string]error{
		"создание без тела": second(w.h.CreateRole(ctx, accessapi.CreateRoleRequestObject{TenantId: w.TenantID})),
		"правка без тела": second(w.h.UpdateRole(ctx, accessapi.UpdateRoleRequestObject{TenantId: w.TenantID, RoleId: w.disp,
			Params: accessapi.UpdateRoleParams{IfMatch: `"1"`}})),
		"limit 0":     second(w.h.ListRoles(ctx, accessapi.ListRolesRequestObject{TenantId: w.TenantID, Params: accessapi.ListRolesParams{Limit: &zero}})),
		"курсор":      second(w.h.ListRoles(ctx, accessapi.ListRolesRequestObject{TenantId: w.TenantID, Params: accessapi.ListRolesParams{Cursor: &broken}})),
		"без тенанта": second(w.h.ListRoles(t.Context(), accessapi.ListRolesRequestObject{TenantId: w.TenantID})),
	} {
		if got := accesstest.Code(err); got != "malformed_request" && got != "not_found" {
			t.Errorf("%s: %v", name, err)
		}
	}
	_, err := w.h.CreateRole(ctx, accessapi.CreateRoleRequestObject{TenantId: w.TenantID, Body: &accessapi.RoleCreate{Name: "Описание", Description: &long}})
	if accesstest.Code(err) != "validation_failed" {
		t.Errorf("long description: %v", err)
	}
	if _, err := update(t, w, w.owner, w.disp, `"1"`, accessapi.RolePatch{Description: &long}); accesstest.Code(err) != "validation_failed" {
		t.Errorf("long description of an update: %v", err)
	}
	if _, err := update(t, w, w.owner, w.disp, `"1"`, accessapi.RolePatch{Name: new("  ")}); accesstest.Code(err) != "validation_failed" {
		t.Errorf("empty name of an update: %v", err)
	}
	if _, err := update(t, w, w.owner, w.disp, `"1"`, accessapi.RolePatch{Permissions: new([]string{"fleet.weird"})}); accesstest.Code(err) != "validation_failed" {
		t.Errorf("unknown right of an update: %v", err)
	}
	if _, err := update(t, w, w.owner, w.disp, `"1"`, accessapi.RolePatch{Name: new("Администратор ролей")}); accesstest.Code(err) != "validation_failed" {
		t.Errorf("taken name of an update: %v", err)
	}
}

func second[T any](_ T, err error) error { return err }

// Сбой БД — 503 dependency_unavailable на чтении и на каждой команде; без таблицы аудита команда не фиксируется.
func TestRolesStoreFailures(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	w.Break("access.role_versions")
	ctx := w.Ctx(w.owner)
	for name, err := range map[string]error{
		"список":   second(w.h.ListRoles(ctx, accessapi.ListRolesRequestObject{TenantId: w.TenantID})),
		"роль":     second(w.h.GetRole(ctx, accessapi.GetRoleRequestObject{TenantId: w.TenantID, RoleId: w.disp})),
		"создание": second(create(t, w, w.owner, "Новая")),
		"правка":   second(update(t, w, w.owner, w.disp, `"1"`, accessapi.RolePatch{Name: new("X")})),
		"удаление": remove(t, w, w.owner, w.disp, `"1"`),
	} {
		if got := accesstest.Code(err); got != "dependency_unavailable" {
			t.Errorf("%s: %v", name, err)
		}
	}
	a := newWorld(t)
	a.Break("audit.events")
	for name, err := range map[string]error{
		"создание": second(create(t, a, a.owner, "Новая")),
		"правка":   second(update(t, a, a.owner, a.disp, `"1"`, accessapi.RolePatch{Permissions: new([]string{"fleet.routes.manage"})})),
		"удаление": remove(t, a, a.owner, a.disp, `"1"`),
	} {
		if got := accesstest.Code(err); got != "dependency_unavailable" {
			t.Errorf("without audit, %s: %v", name, err)
		}
	}
	if n := a.Count(`select 1 from access.roles where name = 'Новая'`); n != 0 {
		t.Errorf("a role without its audit record: %d", n)
	}
}
