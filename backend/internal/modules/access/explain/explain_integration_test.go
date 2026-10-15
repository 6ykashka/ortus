//go:build integration

package explain_test

import (
	"context"
	"fmt"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/accesstest" //nolint:depguard // the access module's own test helper (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/modules/access/explain"                //nolint:depguard // the package under test (W1.06)
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

// world: Москва (Москва-1, Москва-2), логистика подключена. Акторы: владелец, читатель ролей Москва-1, читатель ролей
// организации. Участники: менеджер (рейсы на Москва-1 и наблюдатель на Москва-2), руководитель проекта (PD-53),
// водитель в группе «Финансы» с начислениями, менеджеры с закончившимся и со спящим назначением, менеджер Москва-2,
// карточка без аккаунта.
type world struct {
	*accesstest.World
	h                                     *explain.Handler
	f1, f2, project                       uuid.UUID
	owner, firmReader, tenantReader       tenantctx.TenantContext
	manager, lead, driver, ended, dormant uuid.UUID
	m2, card                              uuid.UUID
	aF1, aF2, aLead, aFinance, ownerRole  uuid.UUID
	finance                               uuid.UUID
}

func newWorld(t *testing.T) *world {
	t.Helper()
	w := &world{World: server.NewWorld(t)}
	w.Install("logistics")
	region := w.Unit("Москва", uuid.Nil)
	w.f1, w.f2 = w.Unit("Москва-1", region), w.Unit("Москва-2", region)
	w.project = uuid.New()
	owner := w.Member("Дарья Зимина", "d.zimina@alta.example", region)
	w.Owner(owner)
	fr := w.Member("Читатель Москва-1", "fr@alta.example", w.f1)
	tr := w.Member("Читатель организации", "tr@alta.example", region)
	w.manager = w.Member("Марина Котова", "m.kotova@alta.example", w.f1)
	w.lead = w.Member("Руководитель проекта", "lead@alta.example", w.f1)
	w.driver = w.Member("Илья Васильев", "i.vasiliev@alta.example", w.f1)
	w.ended = w.Member("Бывший менеджер", "ended@alta.example", w.f1)
	w.dormant = w.Member("Спящий менеджер", "dormant@alta.example", w.f1)
	w.m2 = w.Member("Менеджер Москва-2", "m2@alta.example", w.f2)
	w.card = w.Card("Карточка без входа", w.f1)
	w.Function(w.driver, authz.FunctionDriver, w.f1, nil)

	reader := w.Role("Читатель ролей", "custom", "", "roles.read", "members.read")
	trips := w.Role("Рейсы", "custom", "", "fleet.trips.read")
	observer := w.Role("Наблюдатель", "template", "observer", "fleet.trips.read")
	lead := w.Role("Руководитель проекта", "template", "project_manager", "tasks.update")
	earnings := w.Role("Начисления", "custom", "", "fleet.earnings.read")
	w.ownerRole = w.Role("Владелец бизнеса", "system", "owner", "members.invite")
	w.Assign(accesstest.Grant{Principal: fr, Role: reader, Kind: "unit", Ref: w.f1, Descendants: true})
	w.Assign(accesstest.Grant{Principal: tr, Role: reader, Kind: "tenant", Descendants: true})
	w.aF1 = w.Assign(accesstest.Grant{Principal: w.manager, Role: trips, Kind: "unit", Ref: w.f1, Descendants: true})
	w.aF2 = w.Assign(accesstest.Grant{Principal: w.manager, Role: observer, Kind: "unit", Ref: w.f2, Descendants: true})
	w.aLead = w.Assign(accesstest.Grant{Principal: w.lead, Role: lead, Kind: "project", Ref: w.project})
	w.finance = w.Group("Финансы", uuid.Nil, w.driver)
	w.aFinance = w.Assign(accesstest.Grant{Group: true, Principal: w.finance, Role: earnings, Kind: "unit", Ref: w.f1, Descendants: true})
	past := w.Now.Add(-time.Hour)
	w.Assign(accesstest.Grant{Principal: w.ended, Role: trips, Kind: "unit", Ref: w.f1, Until: &past})
	w.Assign(accesstest.Grant{Principal: w.dormant, Role: trips, Kind: "unit", Ref: w.f1, State: "dormant"})
	w.Assign(accesstest.Grant{Principal: w.card, Role: trips, Kind: "self"})
	w.owner, w.firmReader, w.tenantReader = w.TC(owner), w.TC(fr), w.TC(tr)
	w.h = explain.New(w.Deps())
	return w
}

type query struct {
	member     uuid.UUID
	permission string
	unit       *uuid.UUID
	module     *string
	typ        *string
	object     *uuid.UUID
}

func (w *world) explain(tc tenantctx.TenantContext, q query) (accessapi.AccessExplanation, error) {
	resp, err := w.h.ExplainAccess(w.Ctx(tc), accessapi.ExplainAccessRequestObject{TenantId: w.TenantID, Params: accessapi.ExplainAccessParams{
		MemberId: q.member, Permission: q.permission, OrgUnitId: q.unit, ObjectModule: q.module, ObjectType: q.typ, ObjectId: q.object}})
	if err != nil {
		return accessapi.AccessExplanation{}, err
	}
	r, ok := resp.(accessapi.ExplainAccess200JSONResponse)
	if !ok {
		return accessapi.AccessExplanation{}, fmt.Errorf("response %T", resp)
	}
	return r.Body, nil
}

func checks(x accessapi.AccessExplanation) []string {
	out := []string{}
	for _, c := range x.Checks {
		out = append(out, fmt.Sprintf("%s=%v", c.Check, c.Passed))
	}
	return out
}

func trace(x accessapi.AccessExplanation, assignment uuid.UUID) (accessapi.AccessGrantTrace, bool) {
	for _, g := range x.Grants {
		if g.AssignmentId != nil && *g.AssignmentId == assignment {
			return g, true
		}
	}
	return accessapi.AccessGrantTrace{}, false
}

func mismatch(g accessapi.AccessGrantTrace) string {
	if g.Mismatch == nil {
		return ""
	}
	return string(*g.Mismatch)
}

var passedAll = []string{"tenant-membership-and-binding=true", "tenant-state=true", "module-installation=true", "plan-entitlement=true", "separation-of-duties=true"}

// expect reports a violated expectation without adding branches to the test (gocyclo).
func expect(t *testing.T, ok bool, format string, args ...any) {
	t.Helper()
	if !ok {
		t.Errorf(format, args...)
	}
}

func deny(x accessapi.AccessExplanation) string {
	if x.DenyCode == nil {
		return ""
	}
	return string(*x.DenyCode)
}

func lastDetail(x accessapi.AccessExplanation) string {
	if len(x.Checks) == 0 || x.Checks[len(x.Checks)-1].Detail == nil {
		return ""
	}
	return *x.Checks[len(x.Checks)-1].Detail
}

// Разрешено: проверки по порядку, решающая — permission; каждый грант с правом и причиной (вне области — out_of_scope).
func TestExplainAllowed(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	x, err := w.explain(w.tenantReader, query{member: w.manager, permission: "fleet.trips.read", unit: &w.f1})
	if err != nil {
		t.Fatal(err)
	}
	expect(t, x.Allowed && x.DecisiveCheck == accessapi.Permission && x.DenyCode == nil && !x.HiddenGrants, "decision %+v", x)
	expect(t, x.PolicyVersion != "" && x.MemberId == w.manager && x.OrgUnitId != nil && *x.OrgUnitId == w.f1, "fields %+v", x)
	want := append(slices.Clone(passedAll), "permission=true", "resource-scope=true")
	expect(t, slices.Equal(checks(x), want), "checks %v, want %v", checks(x), want)
	f1, ok := trace(x, w.aF1)
	expect(t, ok && f1.Matches && f1.Via == accessapi.AccessGrantTraceViaDirect && f1.RoleName == "Рейсы", "grant Москва-1 %+v", f1)
	f2, ok := trace(x, w.aF2)
	expect(t, ok && !f2.Matches && mismatch(f2) == "out_of_scope", "grant Москва-2 %+v", f2)
}

// Гранты вне области актора не показываются — только hiddenGrants, без счётчика и подробностей.
func TestExplainHiddenGrants(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	x, err := w.explain(w.firmReader, query{member: w.manager, permission: "fleet.trips.read", unit: &w.f1})
	if err != nil {
		t.Fatal(err)
	}
	expect(t, x.Allowed && x.HiddenGrants && len(x.Grants) == 1, "explanation %+v", x)
	_, leaked := trace(x, w.aF2)
	expect(t, !leaked, "the grant of Москва-2 leaked")
}

// PD-53: роль на проект без объекта не действует; на своём объекте — действует; на чужом — other_object.
func TestExplainObjectScope(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	x, err := w.explain(w.tenantReader, query{member: w.lead, permission: "tasks.update"})
	if err != nil {
		t.Fatal(err)
	}
	g, _ := trace(x, w.aLead)
	expect(t, !x.Allowed && x.DecisiveCheck == accessapi.Permission && deny(x) == "forbidden_action", "without object %+v", x)
	expect(t, mismatch(g) == "object_scope_without_object", "grant %+v", g)
	expect(t, lastDetail(x) == "Право есть только в роли на проект: без задачи этого проекта оно не действует (PD-53).", "detail %q", lastDetail(x))
	module, typ := "tasks", "project"
	x, err = w.explain(w.tenantReader, query{member: w.lead, permission: "tasks.update", module: &module, typ: &typ, object: &w.project})
	g, _ = trace(x, w.aLead)
	expect(t, err == nil && x.Allowed && g.Matches && x.Object != nil && x.Object.EntityId == w.project, "same object: %+v %v", x, err)
	other := uuid.New()
	x, err = w.explain(w.tenantReader, query{member: w.lead, permission: "tasks.update", module: &module, typ: &typ, object: &other})
	g, _ = trace(x, w.aLead)
	expect(t, err == nil && !x.Allowed && mismatch(g) == "other_object", "other object: %+v %v", x, err)
}

// Решающие проверки до права: функция «Водитель» (SoD), модуль не подключён, нет членства.
func TestExplainDecisiveChecks(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	for name, tc := range map[string]struct {
		q        query
		decisive accessapi.AccessCheckStep
		deny     string
	}{
		"начисления водителю":   {query{member: w.driver, permission: "fleet.earnings.read", unit: &w.f1}, accessapi.SeparationOfDuties, "function_blocked"},
		"модуль не подключён":   {query{member: w.manager, permission: "spa.appointments.read"}, accessapi.ModuleInstallation, "module_not_installed"},
		"карточка без аккаунта": {query{member: w.card, permission: "fleet.trips.read"}, accessapi.TenantMembershipAndBinding, "not_found"},
	} {
		x, err := w.explain(w.tenantReader, tc.q)
		if err != nil {
			t.Errorf("%s: %v", name, err)
			continue
		}
		last := x.Checks[len(x.Checks)-1]
		expect(t, !x.Allowed && x.DecisiveCheck == tc.decisive && deny(x) == tc.deny, "%s: %+v", name, x)
		expect(t, last.Check == tc.decisive && !last.Passed && last.Detail != nil, "%s: last check %+v", name, last)
	}
	x, _ := w.explain(w.tenantReader, query{member: w.driver, permission: "fleet.earnings.read", unit: &w.f1})
	g, ok := trace(x, w.aFinance)
	expect(t, ok && g.Via == accessapi.AccessGrantTraceViaGroup && g.GroupId != nil && *g.GroupId == w.finance, "via group: %+v", g)
	expect(t, mismatch(g) == "function_blocked", "mismatch: %+v", g)
}

// Закончившееся и спящее назначения видны с причиной (expired, dormant_module) и не дают права.
func TestExplainExpiredAndDormant(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	for person, want := range map[uuid.UUID]string{w.ended: "expired", w.dormant: "dormant_module"} {
		x, err := w.explain(w.tenantReader, query{member: person, permission: "fleet.trips.read", unit: &w.f1})
		if err != nil || x.Allowed || len(x.Grants) != 1 || mismatch(x.Grants[0]) != want || x.Grants[0].Matches {
			t.Errorf("%s: %+v %v", want, x, err)
		}
	}
}

// Владелец: право из владения (via owner), без ролей.
func TestExplainOwner(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	x, err := w.explain(w.tenantReader, query{member: w.owner.PersonID, permission: "members.invite"})
	if err != nil || !x.Allowed || len(x.Grants) != 1 {
		t.Fatalf("owner: %+v %v", x, err)
	}
	g := x.Grants[0]
	if g.Via != accessapi.AccessGrantTraceViaOwner || !g.Matches || g.RoleId != w.ownerRole || g.RoleName != "Владелец бизнеса" || g.Scope.Kind != accessapi.ScopeKindTenant {
		t.Errorf("owner trace %+v", g)
	}
}

// Участник, подразделение и объект вне области актора — 404, как несуществующие; ключ и объект — 422.
func TestExplainRefusals(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	module, typ, weird := "tasks", "project", "chat"
	for name, tc := range map[string]struct {
		actor tenantctx.TenantContext
		q     query
		code  string
	}{
		"участник соседней фирмы":     {w.firmReader, query{member: w.m2, permission: "fleet.trips.read"}, "not_found"},
		"нет участника":               {w.tenantReader, query{member: uuid.New(), permission: "fleet.trips.read"}, "not_found"},
		"подразделение вне области":   {w.firmReader, query{member: w.manager, permission: "fleet.trips.read", unit: &w.f2}, "not_found"},
		"нет подразделения":           {w.tenantReader, query{member: w.manager, permission: "fleet.trips.read", unit: new(uuid.New())}, "not_found"},
		"объект без гранта на всё":    {w.firmReader, query{member: w.lead, permission: "tasks.update", module: &module, typ: &typ, object: &w.project}, "not_found"},
		"неизвестное право":           {w.tenantReader, query{member: w.manager, permission: "fleet.weird"}, "validation_failed"},
		"объект без типа":             {w.tenantReader, query{member: w.lead, permission: "tasks.update", module: &module, object: &w.project}, "validation_failed"},
		"объект модуля другого этапа": {w.tenantReader, query{member: w.lead, permission: "tasks.update", module: &weird, typ: &weird, object: &w.project}, "validation_failed"},
	} {
		if _, err := w.explain(tc.actor, tc.q); accesstest.Code(err) != tc.code {
			t.Errorf("%s: %v, want %s", name, err, tc.code)
		}
	}
}

// Текст причины отказа строится только по видимым актору грантам: скрытый грант не раскрывает свой вид (вне области,
// роль на проект или объект) — только hiddenGrants.
func TestExplainDetailWithoutHiddenGrants(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	person := w.Member("Работает в Москве-2", "far@alta.example", w.f1)
	far := w.Role("Наблюдатель Москва-2", "custom", "", "fleet.trips.review")
	w.Assign(accesstest.Grant{Principal: person, Role: far, Kind: "unit", Ref: w.f2})
	x, err := w.explain(w.firmReader, query{member: person, permission: "fleet.trips.review", unit: &w.f1})
	if err != nil {
		t.Fatal(err)
	}
	expect(t, !x.Allowed && x.HiddenGrants && len(x.Grants) == 0, "explanation %+v", x)
	expect(t, lastDetail(x) == "Среди видимых вам назначений сотрудника нет подходящих: остальные вне вашей области.", "detail %q", lastDetail(x))
	x, err = w.explain(w.tenantReader, query{member: person, permission: "fleet.trips.review", unit: &w.f1})
	expect(t, err == nil && !x.HiddenGrants && lastDetail(x) == "Право есть, но объект находится вне области назначения.", "tenant reader: %+v %v", x, err)
}
