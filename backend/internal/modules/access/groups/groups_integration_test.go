//go:build integration

package groups_test

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
	"github.com/ortus/ortus-crm/backend/internal/modules/access/groups"                 //nolint:depguard // the package under test (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
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

// world: Москва (Москва-1, Москва-2); владелец; администратор фирмы Москва-1 (участники: читать и управлять,
// назначать, рейсы), руководитель региона (участники: читать и управлять), читатель Москва-1; люди p1 (Москва-1),
// p2 (Москва-2), p3 (Москва-2), водитель (Москва-1). Группы: «Диспетчеры Север» (Москва-1: p1, p2; роль «Рейсы» на
// Москва-1) и «Финансы» (вся организация: p1; начисления на Москва-1).
type world struct {
	*accesstest.World
	h                                   *groups.Handler
	region, f1, f2                      uuid.UUID
	owner, firmAdmin, regionMgr, reader tenantctx.TenantContext
	p1, p2, p3, driver                  uuid.UUID
	trips, earnings                     uuid.UUID
	disp, finance                       uuid.UUID
}

func newWorld(t *testing.T) *world {
	t.Helper()
	w := &world{World: server.NewWorld(t)}
	w.region = w.Unit("Москва", uuid.Nil)
	w.f1, w.f2 = w.Unit("Москва-1", w.region), w.Unit("Москва-2", w.region)
	owner := w.Member("Дарья Зимина", "d.zimina@alta.example", w.region)
	w.Owner(owner)
	fa := w.Member("Админ фирмы", "firm@alta.example", w.f1)
	rm := w.Member("Руководитель региона", "region@alta.example", w.region)
	rd := w.Member("Читатель", "reader@alta.example", w.f1)
	w.p1, w.p2, w.p3 = w.Card("Марина Котова", w.f1), w.Card("Олеся Петрова", w.f2), w.Card("Пётр Третий", w.f2)
	w.driver = w.Card("Илья Васильев", w.f1)
	w.Function(w.driver, authz.FunctionDriver, w.f1, nil)
	firmRole := w.Role("Админ участников", "custom", "", "members.read", "members.manage", "roles.assign", "fleet.trips.read")
	regionRole := w.Role("Кадры региона", "custom", "", "members.read", "members.manage")
	readRole := w.Role("Читатель участников", "custom", "", "members.read")
	w.trips = w.Role("Рейсы", "custom", "", "fleet.trips.read")
	w.earnings = w.Role("Начисления", "custom", "", "fleet.earnings.read")
	w.Assign(accesstest.Grant{Principal: fa, Role: firmRole, Kind: "unit", Ref: w.f1, Descendants: true})
	w.Assign(accesstest.Grant{Principal: rm, Role: regionRole, Kind: "unit", Ref: w.region, Descendants: true})
	w.Assign(accesstest.Grant{Principal: rd, Role: readRole, Kind: "unit", Ref: w.f1, Descendants: true})
	w.disp = w.Group("Диспетчеры Север", w.f1, w.p1, w.p2)
	w.finance = w.Group("Финансы", uuid.Nil, w.p1)
	w.Assign(accesstest.Grant{Group: true, Principal: w.disp, Role: w.trips, Kind: "unit", Ref: w.f1, Descendants: true})
	w.Assign(accesstest.Grant{Group: true, Principal: w.finance, Role: w.earnings, Kind: "unit", Ref: w.f1, Descendants: true})
	w.owner, w.firmAdmin, w.regionMgr, w.reader = w.TC(owner), w.TC(fa), w.TC(rm), w.TC(rd)
	w.h = groups.New(w.Deps())
	return w
}

func (w *world) list(t *testing.T, tc tenantctx.TenantContext, unit *uuid.UUID) []accessapi.Group {
	t.Helper()
	resp, err := w.h.ListGroups(w.Ctx(tc), accessapi.ListGroupsRequestObject{TenantId: w.TenantID, Params: accessapi.ListGroupsParams{OrgUnitId: unit}})
	page := accesstest.As[accessapi.ListGroups200JSONResponse](t, resp, err).Body
	if page.NextCursor != nil {
		t.Errorf("cursor %v", *page.NextCursor)
	}
	return page.Items
}

func groupNames(gs []accessapi.Group) []string {
	out := []string{}
	for _, g := range gs {
		out = append(out, g.Name)
	}
	return out
}

// Список групп: видимость по домашнему подразделению (группа всей организации — только с грантом на организацию),
// участники вне области — только счётчиком, число назначений, фильтр по подразделению.
func TestListGroups(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	if got := groupNames(w.list(t, w.owner, nil)); !slices.Equal(got, []string{"Диспетчеры Север", "Финансы"}) {
		t.Fatalf("owner: %v", got)
	}
	firm := w.list(t, w.firmAdmin, nil)
	if len(firm) != 1 {
		t.Fatalf("firm admin: %v", groupNames(firm))
	}
	g := firm[0]
	if g.Id != w.disp || !slices.Equal(g.MemberIds, []uuid.UUID{w.p1}) || g.HiddenMemberCount != 1 || g.AssignmentCount != 1 ||
		g.Revision != 1 || g.HomeUnitId == nil || *g.HomeUnitId != w.f1 {
		t.Errorf("group seen by the firm admin: %+v", g)
	}
	if got := groupNames(w.list(t, w.owner, &w.f2)); len(got) != 0 {
		t.Errorf("filter Москва-2: %v", got)
	}
	if got := groupNames(w.list(t, w.owner, &w.region)); !slices.Equal(got, []string{"Диспетчеры Север"}) {
		t.Errorf("filter Москва: %v", got)
	}
}

func (w *world) get(t *testing.T, tc tenantctx.TenantContext, id uuid.UUID) (accessapi.Group, error) {
	t.Helper()
	resp, err := w.h.GetGroup(w.Ctx(tc), accessapi.GetGroupRequestObject{TenantId: w.TenantID, GroupId: id})
	if err != nil {
		return accessapi.Group{}, err
	}
	r := accesstest.As[accessapi.GetGroup200JSONResponse](t, resp, nil)
	if r.Headers.ETag == nil || *r.Headers.ETag != fmt.Sprintf(`"%d"`, r.Body.Revision) {
		t.Errorf("ETag %v", r.Headers.ETag)
	}
	return r.Body, nil
}

func TestGetGroup(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	if g, err := w.get(t, w.owner, w.finance); err != nil || !slices.Equal(g.MemberIds, []uuid.UUID{w.p1}) || g.HomeUnitId != nil || g.AssignmentCount != 1 {
		t.Errorf("owner: %+v %v", g, err)
	}
	for name, id := range map[string]uuid.UUID{"группа всей организации": w.finance, "нет такой": uuid.New()} {
		if _, err := w.get(t, w.firmAdmin, id); accesstest.Code(err) != "not_found" {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func (w *world) create(t *testing.T, tc tenantctx.TenantContext, name string, home *uuid.UUID) (accessapi.Group, error) {
	t.Helper()
	resp, err := w.h.CreateGroup(w.Ctx(tc), accessapi.CreateGroupRequestObject{TenantId: w.TenantID,
		Body: &accessapi.GroupCreate{Name: name, HomeUnitId: home}})
	if err != nil {
		return accessapi.Group{}, err
	}
	return accesstest.As[accessapi.CreateGroup201JSONResponse](t, resp, nil).Body, nil
}

// Создание группы: в своей области; группа всей организации — только с правом на организацию; имя уникально среди
// живых групп.
func TestCreateGroup(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	g, err := w.create(t, w.firmAdmin, "  Водители Север ", &w.f1)
	if err != nil || g.Name != "Водители Север" || g.Revision != 1 || len(g.MemberIds) != 0 || g.Description != "" {
		t.Fatalf("create: %+v %v", g, err)
	}
	if n := w.Count(`select 1 from audit.events where action = 'access.group.create' and target_id = $1`, g.Id); n != 1 {
		t.Errorf("audit: %d", n)
	}
	if _, err := w.create(t, w.owner, "Вся компания", nil); err != nil {
		t.Errorf("owner, tenant-wide: %v", err)
	}
	for name, tc := range map[string]struct {
		actor tenantctx.TenantContext
		name  string
		home  *uuid.UUID
		want  string
	}{
		"соседняя фирма вне видимости": {w.firmAdmin, "Чужая", &w.f2, "not_found"},
		"вся организация без права":    {w.regionMgr, "Общая", nil, "forbidden_action"},
		"видит, но не управляет":       {w.reader, "Читатели", &w.f1, "forbidden_action"},
		"нет подразделения":            {w.owner, "Пустота", new(uuid.New()), "not_found"},
		"без имени":                    {w.owner, "  ", &w.f1, "validation_failed"},
		"имя занято":                   {w.owner, "диспетчеры север", &w.f1, "validation_failed|Группа с таким названием уже есть"},
	} {
		_, err := w.create(t, tc.actor, tc.name, tc.home)
		if got := accesstest.Problem(err); got != tc.want && accesstest.Code(err) != tc.want {
			t.Errorf("%s: %s, want %s", name, got, tc.want)
		}
	}
}

func (w *world) update(t *testing.T, tc tenantctx.TenantContext, id uuid.UUID, rev string, p accessapi.GroupPatch) (accessapi.Group, error) {
	t.Helper()
	resp, err := w.h.UpdateGroup(w.Ctx(tc), accessapi.UpdateGroupRequestObject{TenantId: w.TenantID, GroupId: id,
		Params: accessapi.UpdateGroupParams{IfMatch: rev}, Body: &p})
	if err != nil {
		return accessapi.Group{}, err
	}
	return accesstest.As[accessapi.UpdateGroup200JSONResponse](t, resp, nil).Body, nil
}

// Правка группы: ревизия; перенос — с правом на старое и новое подразделение; области назначений группы не меняются.
func TestUpdateGroup(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	g, err := w.update(t, w.firmAdmin, w.disp, `"1"`, accessapi.GroupPatch{Name: new("Диспетчеры"), Description: new("Смена Север")})
	if err != nil || g.Name != "Диспетчеры" || g.Description != "Смена Север" || g.Revision != 2 {
		t.Fatalf("rename: %+v %v", g, err)
	}
	if g, err = w.update(t, w.regionMgr, w.disp, `"2"`, accessapi.GroupPatch{HomeUnitId: &w.f2}); err != nil || *g.HomeUnitId != w.f2 || g.Revision != 3 {
		t.Fatalf("move: %+v %v", g, err)
	}
	samara := w.Unit("Самара", uuid.Nil)
	if n := w.Count(`select 1 from access.role_assignments where principal_id = $1 and scope_ref = $2`, w.disp, w.f1); n != 1 {
		t.Errorf("assignment scope changed by the move: %d", n)
	}
	for name, tc := range map[string]struct {
		actor tenantctx.TenantContext
		id    uuid.UUID
		rev   string
		patch accessapi.GroupPatch
		want  string
	}{
		"ревизия":               {w.owner, w.disp, `"1"`, accessapi.GroupPatch{Name: new("X")}, "revision_mismatch"},
		"группа вне видимости":  {w.firmAdmin, w.finance, `"1"`, accessapi.GroupPatch{Name: new("X")}, "not_found"},
		"имя занято":            {w.owner, w.disp, `"3"`, accessapi.GroupPatch{Name: new("финансы")}, "validation_failed"},
		"перенос вне видимости": {w.regionMgr, w.disp, `"3"`, accessapi.GroupPatch{HomeUnitId: &samara}, "not_found"},
		"читатель не управляет": {w.reader, w.finance, `"1"`, accessapi.GroupPatch{Name: new("X")}, "not_found"},
	} {
		_, err := w.update(t, tc.actor, tc.id, tc.rev, tc.patch)
		if got := accesstest.Code(err); got != tc.want {
			t.Errorf("%s: %s, want %s", name, got, tc.want)
		}
	}
}

func (w *world) remove(t *testing.T, tc tenantctx.TenantContext, id uuid.UUID, rev string) error {
	t.Helper()
	resp, err := w.h.DeleteGroup(w.Ctx(tc), accessapi.DeleteGroupRequestObject{TenantId: w.TenantID, GroupId: id,
		Params: accessapi.DeleteGroupParams{IfMatch: rev}})
	if err == nil {
		accesstest.As[accessapi.DeleteGroup204Response](t, resp, nil)
	}
	return err
}

// Архив группы: пока есть действующие назначения — 409 (никто молча не теряет доступ); пустая — архив, потом 404.
func TestDeleteGroup(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	if got := accesstest.Problem(w.remove(t, w.owner, w.disp, `"1"`)); got != "invalid_transition|У группы «Диспетчеры Север» есть назначения ролей. Сначала снимите их." {
		t.Errorf("with assignments: %s", got)
	}
	empty, err := w.create(t, w.owner, "Пустая", &w.f1)
	if err != nil {
		t.Fatal(err)
	}
	if got := accesstest.Code(w.remove(t, w.owner, empty.Id, `"2"`)); got != "revision_mismatch" {
		t.Errorf("stale: %s", got)
	}
	if err := w.remove(t, w.firmAdmin, empty.Id, `"1"`); err != nil {
		t.Fatal(err)
	}
	if _, err := w.get(t, w.owner, empty.Id); accesstest.Code(err) != "not_found" {
		t.Errorf("archived group: %v", err)
	}
	if _, err := w.create(t, w.owner, "Пустая", &w.f1); err != nil {
		t.Errorf("name is free again: %v", err)
	}
}

func (w *world) setMembers(t *testing.T, tc tenantctx.TenantContext, id uuid.UUID, rev string, members ...uuid.UUID) (accessapi.Group, error) {
	t.Helper()
	if members == nil {
		members = []uuid.UUID{}
	}
	resp, err := w.h.SetGroupMembers(w.Ctx(tc), accessapi.SetGroupMembersRequestObject{TenantId: w.TenantID, GroupId: id,
		Params: accessapi.SetGroupMembersParams{IfMatch: rev}, Body: &accessapi.GroupMembersUpdate{MemberIds: members}})
	if err != nil {
		return accessapi.Group{}, err
	}
	return accesstest.As[accessapi.SetGroupMembers200JSONResponse](t, resp, nil).Body, nil
}

// Состав группы: полная замена с ревизией; скрытые участники сохраняются; новый участник группы с ролями
// проверяется как прямое назначение; изменение состава группы с ролями поднимает policy_version.
func TestSetGroupMembers(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	before := w.PolicyVersion()
	g, err := w.setMembers(t, w.firmAdmin, w.disp, `"1"`, w.driver)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(g.MemberIds, []uuid.UUID{w.driver}) || g.HiddenMemberCount != 1 || g.Revision != 2 {
		t.Errorf("members: %+v", g)
	}
	if n := w.Count(`select 1 from access.group_members where group_id = $1`, w.disp); n != 2 {
		t.Errorf("stored members: %d (p2 is hidden and must stay)", n)
	}
	if w.PolicyVersion() != before+1 {
		t.Errorf("policy version %d → %d", before, w.PolicyVersion())
	}
	drv := tenantctx.TenantContext{TenantID: w.TenantID, PersonID: w.driver}
	if err := w.Evaluator().Permit(w.Ctx(drv), drv, "fleet.trips.read", authz.Resource{Unit: w.f1}); err != nil {
		t.Errorf("the new member gets the role of the group: %v", err)
	}
	if n := w.Count(`select 1 from audit.events where action = 'access.group.members_set' and target_id = $1`, w.disp); n != 1 {
		t.Errorf("audit: %d", n)
	}
}

// Отказы состава: чужие и невидимые люди — 404, делегирование и SoD добавленных — 409, ревизия — 412, дубль — 422.
func TestSetGroupMembersRefusals(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	finF1 := w.Group("Финансы Москва-1", w.f1)
	w.Assign(accesstest.Grant{Group: true, Principal: finF1, Role: w.earnings, Kind: "unit", Ref: w.f1, Descendants: true})
	for name, tc := range map[string]struct {
		actor   tenantctx.TenantContext
		group   uuid.UUID
		rev     string
		members []uuid.UUID
		want    string
	}{
		"нет такого человека":          {w.firmAdmin, w.disp, `"1"`, []uuid.UUID{uuid.New()}, "not_found"},
		"человек вне видимости":        {w.firmAdmin, w.disp, `"1"`, []uuid.UUID{w.p1, w.p3}, "not_found"},
		"начисления через группу":      {w.firmAdmin, finF1, `"1"`, []uuid.UUID{w.p1}, "delegation_exceeds_grant"},
		"водитель в группу начислений": {w.owner, finF1, `"1"`, []uuid.UUID{w.driver}, "separation_of_duties_conflict|Функция «Водитель» несовместима с правом на начисления (правило MVP)."},
		"ревизия":                {w.firmAdmin, w.disp, `"7"`, []uuid.UUID{w.p1}, "revision_mismatch"},
		"дубль":                  {w.firmAdmin, w.disp, `"1"`, []uuid.UUID{w.p1, w.p1}, "validation_failed"},
		"группа вне видимости":   {w.firmAdmin, w.finance, `"1"`, []uuid.UUID{w.p1}, "not_found"},
		"видит, но не управляет": {w.reader, w.disp, `"1"`, []uuid.UUID{w.p1}, "forbidden_action"},
	} {
		_, err := w.setMembers(t, tc.actor, tc.group, tc.rev, tc.members...)
		if got := accesstest.Problem(err); got != tc.want && accesstest.Code(err) != tc.want {
			t.Errorf("%s: %s, want %s", name, got, tc.want)
		}
	}
	if n := w.Count(`select 1 from access.group_members where group_id = $1`, finF1); n != 0 {
		t.Errorf("members after refusals: %d", n)
	}
}

// access.policy.bumped.v1 состава группы с ролями — для relay W1.07: добавленные и убранные участники.
func TestSetGroupMembersPolicyBump(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	before := w.PolicyVersion()
	if _, err := w.setMembers(t, w.firmAdmin, w.disp, `"1"`, w.driver); err != nil {
		t.Fatal(err)
	}
	w.CheckPolicyBump(w.LastPolicyBump(), before+1, w.driver, w.p1)
}

// D-10 под конкуренцией: человек становится водителем в параллельной команде — добавление его в группу с
// начислениями ждёт её блокировку и получает 409; архив группы ждёт параллельное назначение группе и получает 409.
func TestGroupCommandsWaitForConcurrentChanges(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	finF1 := w.Group("Финансы Москва-1", w.f1)
	w.Assign(accesstest.Grant{Group: true, Principal: finF1, Role: w.earnings, Kind: "unit", Ref: w.f1, Descendants: true})
	held := w.HoldPolicy(`insert into people.work_profiles (person_id, function, unit_id, valid) values ($1, 'driver', $2, tstzrange($3::timestamptz, null))`,
		w.p1, w.f1, w.Now.Add(-time.Hour))
	run := accesstest.Go(func() error {
		_, err := w.h.SetGroupMembers(w.Ctx(w.owner), accessapi.SetGroupMembersRequestObject{TenantId: w.TenantID, GroupId: finF1,
			Params: accessapi.SetGroupMembersParams{IfMatch: `"1"`}, Body: &accessapi.GroupMembersUpdate{MemberIds: []uuid.UUID{w.p1}}})
		return err
	})
	if !run.Running(accesstest.Pause) {
		t.Error("setGroupMembers did not wait for the concurrent command")
	}
	if err := held.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	if got := accesstest.Problem(run.Wait()); got != "separation_of_duties_conflict|Функция «Водитель» несовместима с правом на начисления (правило MVP)." {
		t.Errorf("a new driver into a group with earnings: %q", got)
	}

	empty := w.Group("Пустая", w.f1)
	held = w.HoldPolicy(`insert into access.role_assignments (principal_kind, principal_id, role_id, role_version, scope_kind, scope_ref,
		include_descendants, valid, granted_by) values ('group', $1, $2, 1, 'unit', $3, true, tstzrange($4::timestamptz, null), $1)`,
		empty, w.trips, w.f1, w.Now.Add(-time.Hour))
	run = accesstest.Go(func() error {
		_, err := w.h.DeleteGroup(w.Ctx(w.owner), accessapi.DeleteGroupRequestObject{TenantId: w.TenantID, GroupId: empty,
			Params: accessapi.DeleteGroupParams{IfMatch: `"1"`}})
		return err
	})
	if !run.Running(accesstest.Pause) {
		t.Error("deleteGroup did not wait for the concurrent command")
	}
	if err := held.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	if got := accesstest.Code(run.Wait()); got != "invalid_transition" {
		t.Errorf("archive of a group assigned meanwhile: %q", got)
	}
}

// Роль группы с областью «своё» действует на каждого участника в его подразделении: добавить в такую группу человека
// другого подразделения можно, только если актор назначает роли и там (иначе 409 delegation_exceeds_grant).
func TestSetGroupMembersSelfRoleByMemberHome(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	actor := w.Member("Кадровик Москва-1", "hr@alta.example", w.f1)
	w.Assign(accesstest.Grant{Principal: actor, Role: w.Role("Кадры региона без назначений", "custom", "", "members.read", "members.manage"),
		Kind: "unit", Ref: w.region, Descendants: true})
	w.Assign(accesstest.Grant{Principal: actor, Role: w.Role("Назначения Москва-1", "custom", "", "roles.assign", "fleet.trips.read"),
		Kind: "unit", Ref: w.f1, Descendants: true})
	own := w.Group("Свои рейсы Москва-1", w.f1)
	w.Assign(accesstest.Grant{Group: true, Principal: own, Role: w.trips, Kind: "self"})
	tc := w.TC(actor)
	if _, err := w.setMembers(t, tc, own, `"1"`, w.p2); accesstest.Code(err) != "delegation_exceeds_grant" {
		t.Errorf("a member of Москва-2 into a self role given from Москва-1: %v", err)
	}
	if _, err := w.setMembers(t, tc, own, `"1"`, w.p1); err != nil {
		t.Errorf("a member of Москва-1: %v", err)
	}
}

func second[T any](_ T, err error) error { return err }

// Ввод: без тела — 400, имя и описание — 422, больше 500 участников — 422, limit и курсор — 400; страницы списка.
func TestGroupsInput(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := w.Ctx(w.owner)
	long, zero, broken := strings.Repeat("я", 1001), 0, "!!"
	many := make([]uuid.UUID, 501)
	for i := range many {
		many[i] = uuid.New()
	}
	for name, tc := range map[string]struct {
		err  error
		want string
	}{
		"создание без тела": {second(w.h.CreateGroup(ctx, accessapi.CreateGroupRequestObject{TenantId: w.TenantID})), "malformed_request"},
		"правка без тела": {second(w.h.UpdateGroup(ctx, accessapi.UpdateGroupRequestObject{TenantId: w.TenantID, GroupId: w.disp,
			Params: accessapi.UpdateGroupParams{IfMatch: `"1"`}})), "malformed_request"},
		"состав без тела": {second(w.h.SetGroupMembers(ctx, accessapi.SetGroupMembersRequestObject{TenantId: w.TenantID, GroupId: w.disp,
			Params: accessapi.SetGroupMembersParams{IfMatch: `"1"`}})), "malformed_request"},
		"длинное имя":        {second(w.create(t, w.owner, strings.Repeat("я", 101), &w.f1)), "validation_failed"},
		"длинное описание":   {second(w.h.CreateGroup(ctx, accessapi.CreateGroupRequestObject{TenantId: w.TenantID, Body: &accessapi.GroupCreate{Name: "X", Description: &long}})), "validation_failed"},
		"пустое имя правки":  {second(w.update(t, w.owner, w.disp, `"1"`, accessapi.GroupPatch{Name: new(" ")})), "validation_failed"},
		"описание правки":    {second(w.update(t, w.owner, w.disp, `"1"`, accessapi.GroupPatch{Description: &long})), "validation_failed"},
		"больше 500":         {second(w.setMembers(t, w.owner, w.disp, `"1"`, many...)), "validation_failed"},
		"limit 0":            {second(w.h.ListGroups(ctx, accessapi.ListGroupsRequestObject{TenantId: w.TenantID, Params: accessapi.ListGroupsParams{Limit: &zero}})), "malformed_request"},
		"курсор":             {second(w.h.ListGroups(ctx, accessapi.ListGroupsRequestObject{TenantId: w.TenantID, Params: accessapi.ListGroupsParams{Cursor: &broken}})), "malformed_request"},
		"список без тенанта": {second(w.h.ListGroups(t.Context(), accessapi.ListGroupsRequestObject{TenantId: w.TenantID})), "not_found"},
		"группа без тенанта": {second(w.h.GetGroup(t.Context(), accessapi.GetGroupRequestObject{TenantId: w.TenantID, GroupId: w.disp})), "not_found"},
		"команда без тенанта": {second(w.h.DeleteGroup(t.Context(), accessapi.DeleteGroupRequestObject{TenantId: w.TenantID, GroupId: w.disp,
			Params: accessapi.DeleteGroupParams{IfMatch: `"1"`}})), "not_found"},
	} {
		if got := accesstest.Code(tc.err); got != tc.want {
			t.Errorf("%s: %v, want %s", name, tc.err, tc.want)
		}
	}
	one := 1
	req := accessapi.ListGroupsRequestObject{TenantId: w.TenantID, Params: accessapi.ListGroupsParams{Limit: &one}}
	var seen []string
	for range 3 {
		resp, err := w.h.ListGroups(ctx, req)
		page := accesstest.As[accessapi.ListGroups200JSONResponse](t, resp, err).Body
		seen = append(seen, groupNames(page.Items)...)
		if page.NextCursor == nil {
			break
		}
		req.Params.Cursor = page.NextCursor
	}
	if !slices.Equal(seen, []string{"Диспетчеры Север", "Финансы"}) {
		t.Errorf("pages %v", seen)
	}
}

// Сбой БД — 503 dependency_unavailable на чтении и на каждой команде.
func TestGroupsStoreFailures(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	w.Break("access.group_members")
	ctx := w.Ctx(w.owner)
	for name, err := range map[string]error{
		"список":   second(w.h.ListGroups(ctx, accessapi.ListGroupsRequestObject{TenantId: w.TenantID})),
		"группа":   second(w.get(t, w.owner, w.disp)),
		"создание": second(w.create(t, w.owner, "Новая", &w.f1)),
		"правка":   second(w.update(t, w.owner, w.disp, `"1"`, accessapi.GroupPatch{Name: new("X")})),
		"состав":   second(w.setMembers(t, w.owner, w.disp, `"1"`, w.p1)),
	} {
		if got := accesstest.Code(err); got != "dependency_unavailable" {
			t.Errorf("%s: %v", name, err)
		}
	}
	a := newWorld(t)
	a.Break("audit.events")
	for name, err := range map[string]error{
		"создание": second(a.create(t, a.owner, "Новая", &a.f1)),
		"правка":   second(a.update(t, a.owner, a.disp, `"1"`, accessapi.GroupPatch{Name: new("X")})),
		"состав":   second(a.setMembers(t, a.owner, a.disp, `"1"`, a.p1)),
		"архив":    a.remove(t, a.owner, a.Group("Пустая", a.f1), `"1"`),
	} {
		if got := accesstest.Code(err); got != "dependency_unavailable" {
			t.Errorf("without audit, %s: %v", name, err)
		}
	}
	r := newWorld(t)
	r.Break("access.role_assignments")
	if err := r.remove(t, r.owner, r.disp, `"1"`); accesstest.Code(err) != "dependency_unavailable" {
		t.Errorf("archive without assignments table: %v", err)
	}
}
