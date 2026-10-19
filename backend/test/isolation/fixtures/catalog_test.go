package fixtures

import (
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestDefaultCatalogIsValid(t *testing.T) {
	t.Parallel()
	if err := Default().Validate(); err != nil {
		t.Fatal(err)
	}
}

// Карточка W0.15 (S0-07) и 15-quality-security.md «Фикстуры изоляции»: два тенанта, по две фирмы и больше.
func TestCatalogTwoTenantsWithFirms(t *testing.T) {
	t.Parallel()
	c := Default()
	if len(c.Tenants) != 2 {
		t.Fatalf("tenants = %d, want 2 (A «Холдинг», B «Чужой клиент»)", len(c.Tenants))
	}
	for _, tn := range c.Tenants {
		companies := 0
		for _, u := range tn.Units {
			if u.Kind == KindCompany {
				companies++
			}
		}
		if companies < 2 {
			t.Errorf("tenant %s: %d firms, want ≥ 2", tn.Key, companies)
		}
	}
	for _, key := range []string{"a.owner", "b.owner"} {
		if !c.mustActor(t, key).Memberships[0].Owner {
			t.Errorf("%s is not an owner", key)
		}
	}
}

// 15-quality-security.md «Фикстуры изоляции» (Q-W0.15-2, W1.04): в A — Москва, Самара, Петербург × 4 фирмы;
// в B — тёзки: Москва (Москва-1, Москва-2) и Самара (Самара-2).
func TestCatalogRegionsAndFirms(t *testing.T) {
	t.Parallel()
	c := Default()
	firms := func(tn TenantDef) map[string][]string {
		names := map[string]string{}
		out := map[string][]string{}
		for _, u := range tn.Units {
			names[u.Key] = u.Name
			if u.Kind == KindRegion {
				out[u.Name] = nil
			}
		}
		for _, u := range tn.Units {
			if u.Kind == KindCompany {
				out[names[u.Parent]] = append(out[names[u.Parent]], u.Name)
			}
		}
		return out
	}
	a := firms(c.Tenants[0])
	for _, region := range []string{"Москва", "Самара", "Петербург"} {
		if len(a[region]) != 4 {
			t.Errorf("A, region %s: firms %v, want 4", region, a[region])
		}
	}
	if len(a) != 3 {
		t.Errorf("A regions = %v, want Москва, Самара, Петербург", a)
	}
	b := firms(c.Tenants[1])
	if !slices.Equal(b["Москва"], []string{"Москва-1", "Москва-2"}) || !slices.Equal(b["Самара"], []string{"Самара-2"}) {
		t.Errorf("B firms = %v, want Москва: Москва-1, Москва-2; Самара: Самара-2", b)
	}
	// Ссылки W0.15 не меняются: строки модулей уже ссылаются на них.
	for _, ref := range []string{"unit:a.msk1", "unit:a.msk2", "unit:a.smr2", "unit:b.msk1", "unit:b.smr2", "unit:a.spb4"} {
		if _, err := c.ID(ref); err != nil {
			t.Error(err)
		}
	}
}

// W4.02 (tenant 0020): гранты видов этапов 4–7 — руководитель пространства (space) и наблюдатель на объектах
// следующих этапов (page, folder, doc, account, chat, repair_project) и связи (relation, без объекта). До регистрации
// вида в оценщике (W4.01, W5.00, W6.00, W7.00) такой грант не даёт ничего.
func TestCatalogStage4ScopeKinds(t *testing.T) {
	t.Parallel()
	c := Default()
	lead := c.mustActor(t, "a.space-lead").Memberships[0].Grants
	if len(lead) != 1 || lead[0].Scope != ObjectSpace+":"+spaceRules || lead[0].Role != roleSpaceLead {
		t.Fatalf("a.space-lead grants = %+v, want one %s grant on space:%s", lead, roleSpaceLead, spaceRules)
	}
	if !c.roleHasAction(t, "a", roleSpaceLead, "knowledge.read") {
		t.Errorf("%s must carry knowledge.read", roleSpaceLead)
	}
	var kinds []string
	for _, g := range c.mustActor(t, "a.later-scopes").Memberships[0].Grants {
		kind, _, _ := strings.Cut(g.Scope, ":")
		kinds = append(kinds, kind)
		if g.Role != roleObserver {
			t.Errorf("a.later-scopes: grant %s with role %s, want %s", g.Scope, g.Role, roleObserver)
		}
	}
	want := []string{ObjectPage, ObjectFolder, ObjectDoc, ObjectAccount, ObjectChat, ObjectRepairProject, ScopeRelation}
	if !slices.Equal(kinds, want) {
		t.Errorf("a.later-scopes grant kinds = %v, want %v", kinds, want)
	}
	for _, ref := range []string{"space:a.rules", "space:b.rules", "page:a.rules-intro", "folder:a.contracts",
		"doc:a.contract", "cash_account:a.cash", "chat:a.trip", "repair_project:a.flat"} {
		if _, err := c.ID(ref); err != nil {
			t.Error(err)
		}
	}
}

// PD-53: руководитель проекта — роль с объектной областью «проект» и без территориальной.
func TestCatalogObjectScopedActor(t *testing.T) {
	t.Parallel()
	c := Default()
	grants := c.mustActor(t, "a.project-lead").Memberships[0].Grants
	if len(grants) != 1 || grants[0].Scope != "project:fleet" || grants[0].Role != "project_manager" {
		t.Fatalf("a.project-lead grants = %+v, want one project_manager grant on project:fleet", grants)
	}
	if !c.roleHasAction(t, "a", "project_manager", "tasks.projects.manage") {
		t.Error("project_manager must carry tasks.projects.manage (template project_manager)")
	}
	for _, ref := range []string{"project:a.fleet", "project:b.fleet"} {
		if _, err := c.ID(ref); err != nil {
			t.Error(err)
		}
	}
}

// owner_only (permissions.yaml): действие в роли не-владельца не даёт права — «Администратор» с modules.manage.
func TestCatalogOwnerOnlyActionInRole(t *testing.T) {
	t.Parallel()
	c := Default()
	m := c.mustActor(t, "a.admin").Memberships[0]
	if m.Owner || len(m.Grants) != 1 || m.Grants[0].Scope != ScopeTenant {
		t.Fatalf("a.admin = %+v, want a non-owner with one tenant grant", m)
	}
	for _, action := range []string{"modules.manage", "billing.manage", "members.read"} {
		if !c.roleHasAction(t, "a", m.Grants[0].Role, action) {
			t.Errorf("role %s has no %s", m.Grants[0].Role, action)
		}
	}
}

// Оператор платформы (W1.02, Q-W1.02-7): аккаунт без членств, строка platform_operators.
func TestCatalogOperator(t *testing.T) {
	t.Parallel()
	c := Default()
	a, err := c.Actor("p.operator")
	if err != nil {
		t.Fatal(err)
	}
	if !a.Operator || len(a.Memberships) != 0 || a.Issuer != IssuerDev {
		t.Errorf("p.operator = %+v, want an operator without memberships", a)
	}
	if owner, _ := c.Actor("a.owner"); owner.Operator {
		t.Error("a.owner must not be an operator")
	}
}

// Q-W1.02-7: стандартная ссылка на несуществующую организацию — строки «tenantId, которого нет» в YAML.
func TestMissingTenantRef(t *testing.T) {
	t.Parallel()
	c := Default()
	id, err := c.ID(MissingTenant)
	if err != nil {
		t.Fatal(err)
	}
	// The id W1.02 used in tenants_member_test.go: UUID v5 of «ortus:isolation:tenant:missing».
	if want := uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:isolation:tenant:missing")); id != want {
		t.Fatalf("ID(%s) = %s, want %s", MissingTenant, id, want)
	}
	if slices.Contains(c.Refs(), MissingTenant) {
		t.Error("tenant:missing must not be a reference of the loaded data")
	}
	for _, tn := range []string{TenantA, TenantB} {
		if slices.Contains(c.TenantIDs(tn), id) {
			t.Errorf("tenant:missing belongs to tenant %s", tn)
		}
	}
}

// Пользователь с двумя ролями: «изменять» в Москва-1 и «читать» в Самара-2.
func TestCatalogUserWithTwoRoles(t *testing.T) {
	t.Parallel()
	two := Default().mustActor(t, "a.two-roles").Memberships[0].Grants
	if len(two) != 2 || two[0].Role == two[1].Role || two[0].Scope == two[1].Scope {
		t.Errorf("a.two-roles grants = %+v, want two different roles in two different units", two)
	}
}

// Водители: функция driver, временное назначение, начисления через группу.
func TestCatalogDrivers(t *testing.T) {
	t.Parallel()
	c := Default()
	for _, key := range []string{"a.driver-msk1", "a.driver-msk2", "a.driver-earnings", "b.driver-msk1"} {
		if f := c.mustActor(t, key).Memberships[0].Function; f != "driver" {
			t.Errorf("%s function = %q, want driver", key, f)
		}
	}
	if !slices.ContainsFunc(c.mustActor(t, "a.driver-msk2").Memberships[0].Grants, func(g GrantDef) bool {
		return g.Period == PeriodTemporary && g.Scope == "msk1"
	}) {
		t.Error("a.driver-msk2: no temporary grant on Москва-1")
	}
	earn := c.mustActor(t, "a.driver-earnings").Memberships[0]
	if !slices.Contains(earn.Groups, "finance") || !c.groupHasAction(t, "a", "finance", "fleet.earnings.read") {
		t.Error("a.driver-earnings must reach fleet.earnings.read through the group «Финансы»")
	}
}

// Часы набора на шлюзе (T-2, возврат 1 W1.04): участник, чьё единственное назначение закончилось до «сейчас», и
// участник, чьё назначение начнётся после «сейчас» набора, но уже идёт по настоящим часам машины. Если cmd/api
// сверяет периоды не с APP_FIXED_NOW, второй проходит шлюз.
func TestCatalogInactiveAssignments(t *testing.T) {
	t.Parallel()
	c := Default()
	for key, want := range map[string]Period{"a.manager-expired": PeriodExpired, "a.manager-future": PeriodFuture} {
		grants := c.mustActor(t, key).Memberships[0].Grants
		if len(grants) != 1 || grants[0].Period != want || grants[0].Role != roleManager {
			t.Errorf("%s grants = %+v, want one manager grant with period %q", key, grants, want)
		}
	}
	if since, until := periodBounds(PeriodFuture); since <= 0 || until != nil {
		t.Errorf("future period: from now%+v until %v, want after now and open-ended", since, until)
	}
	if since, until := periodBounds(PeriodExpired); since >= 0 || until == nil || *until >= 0 {
		t.Errorf("expired period: from now%+v until %v, want both before now", since, until)
	}
}

// W1.44 (Q-W1.05-19, Q-W1.09-11, Q-W1.10-8): объекты для позитивных строк матрицы — импорты, машины с файлами,
// уведомления. Ссылки разрешаются и принадлежат своему тенанту (в БД другого тенанта их нет).
func TestCatalogContentRefs(t *testing.T) {
	t.Parallel()
	c := Default()
	refs := c.Refs()
	for tn, list := range map[string][]string{
		TenantA: {
			"import:a.msk1", "import:a.msk2", "vehicle:a.msk1", "vehicle:a.smr2", "file:a.msk1", "file:a.smr2",
			"notification:a.trip-msk1", "notification:a.trip-msk2", "notification:a.earnings", "notification:a.owner",
			"notification:a.member", "role:a.staff",
		},
		TenantB: {"import:b.msk1", "vehicle:b.msk1", "file:b.msk1", "notification:b.trip-msk1", "notification:b.member", "role:b.staff"},
	} {
		for _, ref := range list {
			id, err := c.ID(ref)
			if err != nil {
				t.Error(err)
				continue
			}
			if !slices.Contains(refs, ref) {
				t.Errorf("Refs() has no %s", ref)
			}
			if !slices.Contains(c.TenantIDs(tn), id) {
				t.Errorf("%s does not belong to tenant %s", ref, tn)
			}
		}
	}
	for _, ref := range []string{"import:a.nope", "file:a.nope", "vehicle:b.smr2", "notification:b.owner", "file:msk1", "import:c.msk1"} {
		if _, err := c.ID(ref); err == nil {
			t.Errorf("ID(%q) = nil error, want an error", ref)
		}
	}
}

// Содержимое под строки AC-01: импорт с подразделением по умолчанию Москва-1, файлы видимого и невидимого для
// соседней фирмы родителя.
func TestCatalogContent(t *testing.T) {
	t.Parallel()
	a := Default().Tenants[0].Content
	if i := a.Imports[0]; i.Key != uMsk1 || i.DefaultUnit != uMsk1 || len(i.Rows) == 0 {
		t.Errorf("import:a.msk1 = %+v, want the default unit Москва-1 and rows", i)
	}
	vehicleUnit := map[string]string{}
	for _, v := range a.Vehicles {
		vehicleUnit[v.Key] = v.Unit
	}
	for file, unit := range map[string]string{uMsk1: uMsk1, uSmr2: uSmr2} {
		i := slices.IndexFunc(a.Files, func(f FileDef) bool { return f.Key == file })
		if i < 0 || vehicleUnit[a.Files[i].Vehicle] != unit {
			t.Errorf("file:a.%s must be attached to a vehicle of %s", file, unit)
		}
	}
}

// Уведомления, которые лента обязана скрыть: нет права в подразделении, начисления водителю (AC-05); системное.
func TestCatalogNotifications(t *testing.T) {
	t.Parallel()
	a := Default().Tenants[0].Content
	byKey := map[string]NotificationDef{}
	for _, n := range a.Notifications {
		byKey[n.Key] = n
	}
	if n := byKey["trip-msk2"]; n.Recipient != "a.manager-msk1" || n.Unit != uMsk2 || n.Permission == "" {
		t.Errorf("notification:a.trip-msk2 = %+v, want one to a.manager-msk1 over Москва-2 (hidden on read)", n)
	}
	if n := byKey["earnings"]; n.Recipient != "a.driver-earnings" || n.Sensitivity != sensRestricted {
		t.Errorf("notification:a.earnings = %+v, want a restricted one to a.driver-earnings (AC-05)", n)
	}
	if n := byKey["owner"]; n.Recipient != "a.owner" || n.Permission != "" || n.Unit != "" {
		t.Errorf("notification:a.owner = %+v, want a system notice to the owner", n)
	}
}

// Q-W1.05-19: «a.manager-msk2 → 404» на импорте Москвы-1 проверяет область импорта, а не шлюз, поэтому у менеджера
// Москвы-2 есть members.manage — роль «Кадры» на Москва-2 с потомками. У роли «Менеджер логистики» его нет.
func TestCatalogStaffOnMoscow2(t *testing.T) {
	t.Parallel()
	c := Default()
	if !slices.ContainsFunc(c.mustActor(t, "a.manager-msk2").Memberships[0].Grants, func(g GrantDef) bool {
		return g.Role == "staff" && g.Scope == uMsk2 && g.Descendants && g.Period == ""
	}) {
		t.Error("a.manager-msk2 has no permanent «Кадры» grant on Москва-2")
	}
	for _, action := range []string{"members.read", "members.manage"} {
		if !c.roleHasAction(t, TenantA, "staff", action) {
			t.Errorf("role «Кадры» has no %s", action)
		}
	}
	if c.roleHasAction(t, TenantA, roleManager, "members.manage") {
		t.Error("the manager role must not carry members.manage: createPeopleImport of a.manager-msk1 is 403")
	}
}

// Один аккаунт в двух тенантах (BR-T2).
func TestCatalogAccountInBothTenants(t *testing.T) {
	t.Parallel()
	if ms := Default().mustActor(t, "ab.member").Memberships; len(ms) != 2 || ms[0].Tenant == ms[1].Tenant {
		t.Errorf("ab.member memberships = %+v, want one in each tenant", ms)
	}
}

// Тенант B «с теми же названиями ролей и фирм» (15-quality-security.md).
func TestForeignTenantMirrorsNames(t *testing.T) {
	t.Parallel()
	c := Default()
	a, b := c.Tenants[0], c.Tenants[1]
	unitNames := func(tn TenantDef) []string {
		var out []string
		for _, u := range tn.Units {
			out = append(out, u.Name)
		}
		return out
	}
	for _, n := range unitNames(b) {
		if !slices.Contains(unitNames(a), n) {
			t.Errorf("unit %q of B has no namesake in A", n)
		}
	}
	if len(a.Roles) != len(b.Roles) {
		t.Fatalf("roles: A %d, B %d", len(a.Roles), len(b.Roles))
	}
	for i := range a.Roles {
		if a.Roles[i].Name != b.Roles[i].Name {
			t.Errorf("role %d: A %q, B %q", i, a.Roles[i].Name, b.Roles[i].Name)
		}
	}
}

// Векторы посчитаны независимо (Node: SHA-1 от NameSpaceURL + имя, версия 5).
func TestIDGoldenVectors(t *testing.T) {
	t.Parallel()
	c := Default()
	for ref, want := range map[string]string{
		"tenant:a":    "f12bd853-8405-510b-9a57-2747865291c1",
		"tenant:b":    "7f6e0e65-76eb-5d3f-b738-52914e3effa6",
		"unit:a.msk1": "6483fa0e-d258-5e90-aaaf-fc46297b6da7",
	} {
		id, err := c.ID(ref)
		if err != nil {
			t.Fatal(err)
		}
		if id.String() != want {
			t.Errorf("ID(%s) = %s, want %s", ref, id, want)
		}
	}
}

func TestRefsResolveToUniqueIDs(t *testing.T) {
	t.Parallel()
	c := Default()
	refs := c.Refs()
	for _, want := range []string{
		"tenant:a", "unit:b.msk1", "role:a.driver", "group:a.finance",
		"account:ab.member", "person:ab.member@b", "membership:a.owner@a",
		"project:a.fleet", "account:p.operator",
	} {
		if !slices.Contains(refs, want) {
			t.Errorf("Refs() has no %s", want)
		}
	}
	seen := map[string]string{}
	for _, ref := range refs {
		id, err := c.ID(ref)
		if err != nil {
			t.Fatalf("ID(%s): %v", ref, err)
		}
		if prev, dup := seen[id.String()]; dup {
			t.Errorf("%s and %s share id %s", prev, ref, id)
		}
		seen[id.String()] = ref
	}
}

func TestIDErrors(t *testing.T) {
	t.Parallel()
	c := Default()
	for _, ref := range []string{
		"", "tenant", "tenant:c", "unit:a.nope", "unit:msk1", "role:b.boss", "group:b.finance",
		"account:nobody", "person:a.owner@b", "person:a.owner", "membership:b.owner@a", "planet:a",
		"project:a.nope", "project:fleet", "warehouse:a.fleet", "person:p.operator@a",
	} {
		if _, err := c.ID(ref); err == nil {
			t.Errorf("ID(%q) = nil error, want an error", ref)
		}
	}
}

func TestActor(t *testing.T) {
	t.Parallel()
	c := Default()
	a, err := c.Actor("ab.member")
	if err != nil {
		t.Fatal(err)
	}
	if a.Issuer != IssuerDev || a.Subject != "iso-ab.member" {
		t.Errorf("ab.member identity = %s %s, want %s iso-ab.member", a.Issuer, a.Subject, IssuerDev)
	}
	if acc, _ := c.ID("account:ab.member"); a.AccountID != acc {
		t.Errorf("AccountID = %s, want %s", a.AccountID, acc)
	}
	if len(a.Memberships) != 2 {
		t.Fatalf("memberships = %d, want 2", len(a.Memberships))
	}
	m := a.Memberships[1]
	tb, _ := c.ID("tenant:b")
	mb, _ := c.ID("membership:ab.member@b")
	pb, _ := c.ID("person:ab.member@b")
	if m.Tenant != "b" || m.TenantID != tb || m.MembershipID != mb || m.PersonID != pb || m.Owner {
		t.Errorf("membership in B = %+v", m)
	}
	if _, err := c.Actor("nobody"); err == nil {
		t.Error("Actor(nobody) must fail")
	}
}

func TestValidateRejectsBrokenCatalogs(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		mutate func(*Catalog)
		want   string
	}{
		{"duplicate unit", func(c *Catalog) { c.Tenants[0].Units = append(c.Tenants[0].Units, c.Tenants[0].Units[0]) }, "duplicate"},
		{"unknown parent", func(c *Catalog) { c.Tenants[0].Units[1].Parent = "nope" }, "parent"},
		{"parent after child", func(c *Catalog) { u := c.Tenants[0].Units; u[0], u[1] = u[1], u[0] }, "parent"},
		{"bad unit kind", func(c *Catalog) { c.Tenants[0].Units[0].Kind = "planet" }, "kind"},
		{"unknown role", func(c *Catalog) { c.Actors[1].Memberships[0].Grants[0].Role = "boss" }, "role"},
		{"unknown scope", func(c *Catalog) { c.Actors[1].Memberships[0].Grants[0].Scope = "nope" }, "scope"},
		{"unknown group", func(c *Catalog) { c.Actors[1].Memberships[0].Groups = []string{"nope"} }, "group"},
		{"unknown tenant", func(c *Catalog) { c.Actors[1].Memberships[0].Tenant = "c" }, "tenant"},
		{"unknown home", func(c *Catalog) { c.Actors[1].Memberships[0].Home = "nope" }, "home"},
		{"bad function", func(c *Catalog) { c.Actors[1].Memberships[0].Function = "pilot" }, "function"},
		{"duplicate actor", func(c *Catalog) { c.Actors = append(c.Actors, c.Actors[0]) }, "duplicate"},
		{"reserved actor", func(c *Catalog) { c.Actors[0].Key = Anonymous }, "reserved"},
		{"two memberships in one tenant", func(c *Catalog) {
			c.Actors[0].Memberships = append(c.Actors[0].Memberships, c.Actors[0].Memberships[0])
		}, "duplicate"},
		{"wildcard action", func(c *Catalog) { c.Tenants[0].Roles[0].Actions = []string{"*"} }, "action"},
		{"unknown object scope", func(c *Catalog) { c.Actors[1].Memberships[0].Grants[0].Scope = "project:nope" }, "scope"},
		{"unknown object kind", func(c *Catalog) { c.Actors[1].Memberships[0].Grants[0].Scope = "planet:fleet" }, "scope"},
		{"unknown period", func(c *Catalog) { c.Actors[1].Memberships[0].Grants[0].Period = "someday" }, "period"},
		{"duplicate object", func(c *Catalog) {
			dup := ObjectDef{Kind: "project", Key: "twin", Name: "Двойник"}
			c.Tenants[0].Objects = append(c.Tenants[0].Objects, dup, dup)
		}, "duplicate"},
		{"operator with memberships", func(c *Catalog) {
			for i := range c.Actors {
				if c.Actors[i].Operator != "" {
					c.Actors[i].Memberships = c.Actors[0].Memberships
				}
			}
		}, "operator"},
		{"import: unknown default unit", func(c *Catalog) { c.Tenants[0].Content.Imports[0].DefaultUnit = "nope" }, "unit"},
		{"import: person of another tenant", func(c *Catalog) { c.Tenants[0].Content.Imports[0].Rows[0].Person = "b.owner" }, "person"},
		{"import: unknown row unit", func(c *Catalog) { c.Tenants[0].Content.Imports[0].Rows[0].Unit = "nope" }, "unit"},
		{"import: duplicate key", func(c *Catalog) {
			c.Tenants[0].Content.Imports = append(c.Tenants[0].Content.Imports, c.Tenants[0].Content.Imports[0])
		}, "duplicate"},
		{"vehicle: unknown unit", func(c *Catalog) { c.Tenants[1].Content.Vehicles[0].Unit = "spb1" }, "unit"},
		{"vehicle: no plate", func(c *Catalog) { c.Tenants[0].Content.Vehicles[0].Plate = "" }, "plate"},
		{"file: unknown vehicle", func(c *Catalog) { c.Tenants[1].Content.Files[0].Vehicle = "smr2" }, "vehicle"},
		{"file: duplicate key", func(c *Catalog) {
			c.Tenants[0].Content.Files = append(c.Tenants[0].Content.Files, c.Tenants[0].Content.Files[0])
		}, "duplicate"},
		{"notification: recipient without membership", func(c *Catalog) {
			c.Tenants[0].Content.Notifications[0].Recipient = "p.operator"
		}, "recipient"},
		{"notification: unknown unit", func(c *Catalog) { c.Tenants[0].Content.Notifications[0].Unit = "nope" }, "unit"},
		{"notification: unit without permission", func(c *Catalog) { c.Tenants[0].Content.Notifications[0].Permission = "" }, "permission"},
		{"notification: bad sensitivity", func(c *Catalog) { c.Tenants[0].Content.Notifications[0].Sensitivity = "secret" }, "sensitivity"},
		{"bad operator role", func(c *Catalog) {
			for i := range c.Actors {
				if c.Actors[i].Operator != "" {
					c.Actors[i].Operator = "god"
				}
			}
		}, "operator"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			c := Default()
			tc.mutate(&c)
			err := c.Validate()
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("Validate() = %v, want an error mentioning %q", err, tc.want)
			}
		})
	}
}

func TestDefaultReturnsACopy(t *testing.T) {
	t.Parallel()
	c := Default()
	c.Tenants[0].Units[0].Name = "changed"
	c.Actors[0].Memberships[0].Grants = append(c.Actors[0].Memberships[0].Grants, GrantDef{Role: "x"})
	if d := Default(); d.Tenants[0].Units[0].Name == "changed" || d.Validate() != nil {
		t.Fatal("Default() must return an independent catalog")
	}
}

func (c Catalog) mustActor(t *testing.T, key string) ActorDef {
	t.Helper()
	for _, a := range c.Actors {
		if a.Key == key {
			return a
		}
	}
	t.Fatalf("no actor %s", key)
	return ActorDef{}
}

func (c Catalog) roleHasAction(t *testing.T, tenant, role, action string) bool {
	t.Helper()
	for _, tn := range c.Tenants {
		for _, r := range tn.Roles {
			if tn.Key == tenant && r.Key == role && slices.Contains(r.Actions, action) {
				return true
			}
		}
	}
	return false
}

func (c Catalog) groupHasAction(t *testing.T, tenant, group, action string) bool {
	t.Helper()
	for _, tn := range c.Tenants {
		if tn.Key != tenant {
			continue
		}
		for _, g := range tn.Groups {
			if g.Key != group {
				continue
			}
			for _, gr := range g.Grants {
				for _, r := range tn.Roles {
					if r.Key == gr.Role && slices.Contains(r.Actions, action) {
						return true
					}
				}
			}
		}
	}
	return false
}
