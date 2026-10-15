//go:build integration

package assignments_test

import (
	"context"
	"fmt"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments"            //nolint:depguard // the package under test (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/accesstest" //nolint:depguard // the access module's own test helper (W1.06)
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

// world: Москва (Москва-1, Москва-2) и Самара; владелец; администратор региона Москва и фирмы Москва-1 (роли
// читать, назначать, видеть участников, рейсы); читатель Москва-1 (без права назначать); менеджеры Москва-1 и
// Москва-2; водитель Москва-1 (функция driver) в группе «Водители» Москва-1; менеджер Москва-2 в группе всей
// организации.
type world struct {
	*accesstest.World
	h                                                  *assignments.Handler
	region, f1, f2, samara                             uuid.UUID
	owner, regionAdmin, firmAdmin, reader              tenantctx.TenantContext
	m1, m2, driver                                     uuid.UUID
	trips, earnings, review, driverRole, ownerRole     uuid.UUID
	drivers, everyone                                  uuid.UUID
	aRegion, aFirm, aReader, aM1, aM2, aDriver, aGroup uuid.UUID
}

func newWorld(t *testing.T) *world {
	t.Helper()
	w := &world{World: server.NewWorld(t)}
	w.region = w.Unit("Москва", uuid.Nil)
	w.f1, w.f2 = w.Unit("Москва-1", w.region), w.Unit("Москва-2", w.region)
	w.samara = w.Unit("Самара", uuid.Nil)
	owner := w.Member("Дарья Зимина", "d.zimina@alta.example", w.region)
	w.Owner(owner)
	ra := w.Member("Админ региона", "region@alta.example", w.region)
	fa := w.Member("Админ фирмы", "firm@alta.example", w.f1)
	rd := w.Member("Читатель", "reader@alta.example", w.f1)
	w.m1 = w.Member("Менеджер Москва-1", "m1@alta.example", w.f1)
	w.m2 = w.Member("Менеджер Москва-2", "m2@alta.example", w.f2)
	w.driver = w.Member("Илья Васильев", "i.vasiliev@alta.example", w.f1)
	w.Function(w.driver, authz.FunctionDriver, w.f1, nil)

	admin := w.Role("Администратор доступа", "custom", "", "roles.read", "roles.assign", "members.read", "members.invite", "fleet.trips.read")
	readOnly := w.Role("Читатель ролей", "custom", "", "roles.read", "members.read")
	w.trips = w.Role("Рейсы", "custom", "", "fleet.trips.read")
	w.earnings = w.Role("Начисления", "custom", "", "fleet.earnings.read")
	w.review = w.Role("Приёмка", "custom", "", "fleet.trips.review")
	w.driverRole = w.Role("Водитель", "template", "driver", "fleet.trips.read")
	w.ownerRole = w.Role("Владелец бизнеса", "system", "owner", "members.read")
	w.drivers = w.Group("Водители", w.f1, w.driver)
	w.everyone = w.Group("Вся организация", uuid.Nil, w.m2)

	w.aRegion = w.Assign(accesstest.Grant{Principal: ra, Role: admin, Kind: "unit", Ref: w.region, Descendants: true})
	w.aFirm = w.Assign(accesstest.Grant{Principal: fa, Role: admin, Kind: "unit", Ref: w.f1, Descendants: true})
	w.aReader = w.Assign(accesstest.Grant{Principal: rd, Role: readOnly, Kind: "unit", Ref: w.f1, Descendants: true})
	w.aM1 = w.Assign(accesstest.Grant{Principal: w.m1, Role: w.trips, Kind: "unit", Ref: w.f1, Descendants: true})
	w.aM2 = w.Assign(accesstest.Grant{Principal: w.m2, Role: w.trips, Kind: "tenant"})
	w.aDriver = w.Assign(accesstest.Grant{Principal: w.driver, Role: w.driverRole, Kind: "self"})
	w.aGroup = w.Assign(accesstest.Grant{Group: true, Principal: w.everyone, Role: w.trips, Kind: "self"})
	w.owner, w.regionAdmin, w.firmAdmin, w.reader = w.TC(owner), w.TC(ra), w.TC(fa), w.TC(rd)
	w.h = assignments.New(w.Deps())
	return w
}

func (w *world) list(t *testing.T, tc tenantctx.TenantContext) map[uuid.UUID]accessapi.Assignment {
	t.Helper()
	out := map[uuid.UUID]accessapi.Assignment{}
	req := accessapi.ListAssignmentsRequestObject{TenantId: w.TenantID}
	limit := 2
	req.Params.Limit = &limit
	for range 20 {
		resp, err := w.h.ListAssignments(w.Ctx(tc), req)
		page := accesstest.As[accessapi.ListAssignments200JSONResponse](t, resp, err).Body
		for _, a := range page.Items {
			if _, dup := out[a.Id]; dup {
				t.Fatalf("assignment %s twice", a.Id)
			}
			out[a.Id] = a
		}
		if page.NextCursor == nil {
			return out
		}
		req.Params.Cursor = page.NextCursor
	}
	t.Fatal("too many pages")
	return nil
}

func ids(m map[uuid.UUID]accessapi.Assignment) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(m))
	for id := range m {
		out = append(out, id)
	}
	slices.SortFunc(out, func(a, b uuid.UUID) int { return slices.Compare(a[:], b[:]) })
	return out
}

func sorted(in ...uuid.UUID) []uuid.UUID {
	slices.SortFunc(in, func(a, b uuid.UUID) int { return slices.Compare(a[:], b[:]) })
	return in
}

// Список назначений — только в области roles.read актора (по «якорю»: подразделение области, организация, дом
// принципала); снятые не видны, закончившиеся — expired, спящие — dormant.
func TestListAssignments(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ended := w.Now.Add(-time.Hour)
	expired := w.Assign(accesstest.Grant{Principal: w.m1, Role: w.review, Kind: "unit", Ref: w.f1, Until: &ended})
	dormant := w.Assign(accesstest.Grant{Principal: w.m1, Role: w.review, Kind: "unit", Ref: w.f1, State: "dormant"})
	w.Assign(accesstest.Grant{Principal: w.m1, Role: w.review, Kind: "unit", Ref: w.f1, State: "revoked"})

	all := w.list(t, w.owner)
	want := sorted(w.aRegion, w.aFirm, w.aReader, w.aM1, w.aM2, w.aDriver, w.aGroup, expired, dormant)
	if got := ids(all); !slices.Equal(got, want) {
		t.Fatalf("owner sees %v, want %v", got, want)
	}
	if all[expired].State != accessapi.AssignmentStateExpired || all[dormant].State != accessapi.AssignmentStateDormant || all[w.aM1].State != accessapi.AssignmentStateActive {
		t.Errorf("states: %s %s %s", all[expired].State, all[dormant].State, all[w.aM1].State)
	}
	g := all[w.aGroup]
	if g.PrincipalType != accessapi.AssignmentPrincipalTypeGroup || g.PrincipalId != w.everyone || g.Scope.Kind != accessapi.ScopeKindSelf {
		t.Errorf("group assignment %+v", g)
	}
	m1 := all[w.aM1]
	if m1.Scope.Kind != accessapi.ScopeKindOrgUnit || !slices.Equal(m1.Scope.ResourceIds, []uuid.UUID{w.f1}) || !m1.Scope.IncludeDescendants || m1.ValidFrom == nil {
		t.Errorf("unit assignment %+v", m1)
	}
}

// Администратор фирмы и региона видят назначения только своей области; организация и группа всей организации
// скрыты.
func TestListAssignmentsByScope(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ended := w.Now.Add(-time.Hour)
	expired := w.Assign(accesstest.Grant{Principal: w.m1, Role: w.review, Kind: "unit", Ref: w.f1, Until: &ended})
	dormant := w.Assign(accesstest.Grant{Principal: w.m1, Role: w.review, Kind: "unit", Ref: w.f1, State: "dormant"})
	firm := ids(w.list(t, w.firmAdmin))
	if want := sorted(w.aFirm, w.aReader, w.aM1, w.aDriver, expired, dormant); !slices.Equal(firm, want) {
		t.Errorf("firm admin sees %v, want %v (region, tenant and tenant-wide group hidden)", firm, want)
	}
	region := ids(w.list(t, w.regionAdmin))
	if want := sorted(w.aRegion, w.aFirm, w.aReader, w.aM1, w.aDriver, expired, dormant); !slices.Equal(region, want) {
		t.Errorf("region admin sees %v, want %v", region, want)
	}
}

func (w *world) create(t *testing.T, tc tenantctx.TenantContext, body accessapi.AssignmentCreate) (accessapi.Assignment, error) {
	t.Helper()
	resp, err := w.h.CreateAssignment(w.Ctx(tc), accessapi.CreateAssignmentRequestObject{TenantId: w.TenantID, Body: &body})
	if err != nil {
		return accessapi.Assignment{}, err
	}
	return accesstest.As[accessapi.CreateAssignment201JSONResponse](t, resp, nil).Body, nil
}

func member(person, role uuid.UUID, scope accessapi.Scope) accessapi.AssignmentCreate {
	return accessapi.AssignmentCreate{PrincipalType: accessapi.AssignmentCreatePrincipalTypeMember, PrincipalId: person, RoleId: role, Scope: scope}
}

func unitScope(u uuid.UUID, desc bool) accessapi.Scope {
	return accessapi.Scope{Kind: accessapi.ScopeKindOrgUnit, ResourceIds: []uuid.UUID{u}, IncludeDescendants: desc}
}

var tenantScope = accessapi.Scope{Kind: accessapi.ScopeKindTenant, ResourceIds: []uuid.UUID{}, IncludeDescendants: true}

// Назначение с областью и сроком (S1-13): срок хранится, права появляются сразу, policy_version + 1, событие
// access.assignment.granted.v1 и аудит в той же транзакции.
func TestCreateAssignment(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	before := w.PolicyVersion()
	until := w.Now.Add(30 * 24 * time.Hour)
	body := member(w.m2, w.review, unitScope(w.f2, false))
	body.ValidUntil = &until
	a, err := w.create(t, w.owner, body)
	if err != nil {
		t.Fatal(err)
	}
	if a.State != accessapi.AssignmentStateActive || a.ValidUntil == nil || !a.ValidUntil.Equal(until) || a.PrincipalId != w.m2 || a.Scope.IncludeDescendants {
		t.Errorf("assignment %+v", a)
	}
	if w.PolicyVersion() != before+1 {
		t.Errorf("policy version %d → %d", before, w.PolicyVersion())
	}
	if n := w.Count(`select 1 from outbox.events where type = 'access.assignment.granted.v1' and aggregate_id = $1`, a.Id); n != 1 {
		t.Errorf("granted events: %d", n)
	}
	if n := w.Count(`select 1 from audit.events where action = 'access.assignment.create' and target_id = $1 and unit_id = $2`, a.Id, w.f2); n != 1 {
		t.Errorf("audit: %d", n)
	}
	m2 := w.TC(w.m2)
	if err := w.Evaluator().Permit(w.Ctx(m2), m2, "fleet.trips.review", authz.Resource{Unit: w.f2}); err != nil {
		t.Errorf("the right works at once: %v", err)
	}
}

// Руководитель региона назначает в своей области то, что имеет сам; фирма — группе своей фирмы.
func TestCreateAssignmentInOwnScope(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	if _, err := w.create(t, w.regionAdmin, member(w.m2, w.trips, unitScope(w.f2, true))); err != nil {
		t.Errorf("region admin in his region: %v", err)
	}
	// Группе — тоже назначение.
	grp := accessapi.AssignmentCreate{PrincipalType: accessapi.AssignmentCreatePrincipalTypeGroup, PrincipalId: w.drivers, RoleId: w.trips,
		Scope: unitScope(w.f1, true)}
	if a, err := w.create(t, w.firmAdmin, grp); err != nil || a.PrincipalType != accessapi.AssignmentPrincipalTypeGroup {
		t.Errorf("group assignment: %+v %v", a, err)
	}
}

// Delegation check (AUTH-08): вне своей области, право, которого нет у назначающего, вся организация, поддерево
// шире своего — 409 delegation_exceeds_grant.
func TestCreateAssignmentDelegation(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	for name, body := range map[string]accessapi.AssignmentCreate{
		"соседняя фирма":           member(w.m1, w.trips, unitScope(w.f2, false)),
		"чужое право":              member(w.m1, w.review, unitScope(w.f1, false)),
		"вся организация":          member(w.m1, w.trips, tenantScope),
		"поддерево региона":        member(w.m1, w.trips, unitScope(w.region, true)),
		"проект без гранта на всё": member(w.m1, w.trips, accessapi.Scope{Kind: accessapi.ScopeKindProject, ResourceIds: []uuid.UUID{uuid.New()}}),
	} {
		if _, err := w.create(t, w.firmAdmin, body); accesstest.Code(err) != "delegation_exceeds_grant" {
			t.Errorf("%s: %v", name, err)
		}
	}
}

// D-10: функция «Водитель» несовместима с начислениями — в обе стороны, прямо и через группу, даже у владельца.
func TestCreateAssignmentSeparationOfDuties(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	if _, err := w.create(t, w.owner, member(w.m1, w.earnings, unitScope(w.f1, true))); err != nil {
		t.Fatal(err)
	}
	group := accessapi.AssignmentCreate{PrincipalType: accessapi.AssignmentCreatePrincipalTypeGroup, PrincipalId: w.drivers,
		RoleId: w.earnings, Scope: unitScope(w.f1, true)}
	for name, tc := range map[string]struct {
		body accessapi.AssignmentCreate
		want string
	}{
		"начисления водителю":         {member(w.driver, w.earnings, unitScope(w.f1, true)), "separation_of_duties_conflict|Функция «Водитель» несовместима с правом на начисления (правило MVP)."},
		"начисления группе водителей": {group, "separation_of_duties_conflict|Функция «Водитель» несовместима с правом на начисления (правило MVP)."},
		"роль водителя финансисту":    {member(w.m1, w.driverRole, accessapi.Scope{Kind: accessapi.ScopeKindSelf, ResourceIds: []uuid.UUID{}}), "separation_of_duties_conflict|У сотрудника есть финансовые права. Совмещение с функцией «Водитель» в MVP запрещено."},
	} {
		if _, err := w.create(t, w.owner, tc.body); accesstest.Problem(err) != tc.want {
			t.Errorf("%s: %s", name, accesstest.Problem(err))
		}
	}
	// Функция водителя закончится до начала назначения — конфликта нет.
	ended := w.Now.Add(24 * time.Hour)
	later := w.Member("Бывший водитель", "ex@alta.example", w.f1)
	w.Function(later, authz.FunctionDriver, w.f1, &ended)
	from := w.Now.Add(48 * time.Hour)
	body := member(later, w.earnings, unitScope(w.f1, true))
	body.ValidFrom = &from
	if _, err := w.create(t, w.owner, body); err != nil {
		t.Errorf("after the driver period: %v", err)
	}
}

// Ссылки и поля: чужие или невидимые id — 404, системная роль — 409, область и срок — 422.
func TestCreateAssignmentRefusals(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	past, early := w.Now.Add(-time.Hour), w.Now.Add(time.Hour)
	late := w.Now.Add(2 * time.Hour)
	ended := member(w.m1, w.trips, unitScope(w.f1, false))
	ended.ValidUntil = &past
	inverted := member(w.m1, w.trips, unitScope(w.f1, false))
	inverted.ValidFrom, inverted.ValidUntil = &late, &early
	for name, tc := range map[string]struct {
		actor tenantctx.TenantContext
		body  accessapi.AssignmentCreate
		code  string
	}{
		"нет роли":               {w.owner, member(w.m1, uuid.New(), tenantScope), "not_found"},
		"нет участника":          {w.owner, member(uuid.New(), w.trips, tenantScope), "not_found"},
		"участник вне видимости": {w.firmAdmin, member(w.m2, w.trips, unitScope(w.f1, false)), "not_found"},
		"нет подразделения":      {w.owner, member(w.m1, w.trips, unitScope(uuid.New(), false)), "not_found"},
		"системная роль":         {w.owner, member(w.m1, w.ownerRole, tenantScope), "invalid_transition"},
		"касса (этап 5)":         {w.owner, member(w.m1, w.trips, accessapi.Scope{Kind: "account", ResourceIds: []uuid.UUID{uuid.New()}}), "validation_failed"},
		"срок уже прошёл":        {w.owner, ended, "validation_failed"},
		"конец раньше начала":    {w.owner, inverted, "validation_failed"},
		"группа вне видимости":   {w.firmAdmin, accessapi.AssignmentCreate{PrincipalType: accessapi.AssignmentCreatePrincipalTypeGroup, PrincipalId: w.everyone, RoleId: w.trips, Scope: unitScope(w.f1, false)}, "not_found"},
	} {
		if _, err := w.create(t, tc.actor, tc.body); accesstest.Code(err) != tc.code {
			t.Errorf("%s: %v, want %s", name, err, tc.code)
		}
	}
}

func (w *world) revoke(t *testing.T, tc tenantctx.TenantContext, id uuid.UUID) error {
	t.Helper()
	resp, err := w.h.RevokeAssignment(w.Ctx(tc), accessapi.RevokeAssignmentRequestObject{TenantId: w.TenantID, AssignmentId: id})
	if err == nil {
		accesstest.As[accessapi.RevokeAssignment204Response](t, resp, nil)
	}
	return err
}

// Снятие назначения: права пропадают сразу (policy_version, событие, аудит); невидимое — 404, видимое без права
// назначать — 403; повтор — 404.
func TestRevokeAssignment(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	before := w.PolicyVersion()
	for name, tc := range map[string]struct {
		actor tenantctx.TenantContext
		id    uuid.UUID
		code  string
	}{
		"вне области — как нет":  {w.firmAdmin, w.aM2, "not_found"},
		"нет такого":             {w.owner, uuid.New(), "not_found"},
		"видит, но не назначает": {w.reader, w.aM1, "forbidden_action"},
	} {
		if got := accesstest.Code(w.revoke(t, tc.actor, tc.id)); got != tc.code {
			t.Errorf("%s: %s, want %s", name, got, tc.code)
		}
	}
	if err := w.revoke(t, w.firmAdmin, w.aM1); err != nil {
		t.Fatal(err)
	}
	if w.PolicyVersion() != before+1 || w.Count(`select 1 from access.role_assignments where id = $1 and state = 'revoked' and revoked_at is not null`, w.aM1) != 1 {
		t.Errorf("revoked: policy %d → %d", before, w.PolicyVersion())
	}
	if n := w.Count(`select 1 from outbox.events where type = 'access.assignment.revoked.v1' and aggregate_id = $1`, w.aM1); n != 1 {
		t.Errorf("revoked events: %d", n)
	}
	m1 := w.TC(w.m1)
	if err := w.Evaluator().Permit(w.Ctx(m1), m1, "fleet.trips.read", authz.Resource{Unit: w.f1}); err == nil {
		t.Error("the right still works after revocation")
	}
	if got := accesstest.Code(w.revoke(t, w.owner, w.aM1)); got != "not_found" {
		t.Errorf("repeat: %s", got)
	}
}

// Роль «Владелец бизнеса» последнего владельца не снимается (как в прототипе); при втором владельце — снимается.
func TestRevokeAssignmentLastOwner(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	own := w.Assign(accesstest.Grant{Principal: w.owner.PersonID, Role: w.ownerRole, Kind: "tenant", Descendants: true})
	if got := accesstest.Problem(w.revoke(t, w.owner, own)); got != "last_owner_required|Нельзя снять роль с последнего владельца" {
		t.Errorf("last owner: %s", got)
	}
	w.Owner(w.m1)
	if err := w.revoke(t, w.owner, own); err != nil {
		t.Errorf("with a second owner: %v", err)
	}
}

// Назначение группе с областью «своё» действует на каждого участника в его подразделении: администратор фирмы не
// назначает его группе, где есть человек другого подразделения (409 delegation_exceeds_grant).
func TestCreateAssignmentGroupSelfByMemberHome(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	mixed := w.Group("Смешанная", w.f1, w.m1, w.m2)
	self := accessapi.Scope{Kind: accessapi.ScopeKindSelf, ResourceIds: []uuid.UUID{}}
	body := accessapi.AssignmentCreate{PrincipalType: accessapi.AssignmentCreatePrincipalTypeGroup, PrincipalId: mixed, RoleId: w.trips, Scope: self}
	if _, err := w.create(t, w.firmAdmin, body); accesstest.Code(err) != "delegation_exceeds_grant" {
		t.Errorf("self role to a group with a member of Москва-2: %v", err)
	}
	body.PrincipalId = w.drivers // Москва-1 only
	if _, err := w.create(t, w.firmAdmin, body); err != nil {
		t.Errorf("self role to a group of Москва-1: %v", err)
	}
}
