package fixtures

import (
	"fmt"
	"slices"
)

// Role actions: templates of design/docs/11-permissions.yaml (logistics_manager, driver, observer) and a custom
// role with the restricted fleet.earnings.read.
var (
	managerActions = []string{
		"members.read", "roles.read", "org_units.read", "files.read", "files.upload", "knowledge.read",
		"fleet.vehicles.read", "fleet.vehicles.manage", "fleet.reservations.read", "fleet.reservations.manage",
		"fleet.inspections.read", "fleet.inspections.review", "fleet.trips.read", "fleet.trips.review",
		"fleet.routes.read", "fleet.routes.manage", "fleet.expenses.read", "fleet.expenses.review",
		"fleet.driver_transfers.read", "fleet.driver_transfers.request", "fleet.driver_transfers.approve",
	}
	driverActions = []string{
		"files.read", "files.upload", "tasks.read", "knowledge.read", "calendar.availability.read",
		"fleet.vehicles.read", "fleet.reservations.read", "fleet.reservations.create",
		"fleet.inspections.read", "fleet.inspections.submit", "fleet.trips.read", "fleet.trips.start", "fleet.trips.return",
		"fleet.routes.read", "fleet.expenses.read", "fleet.expenses.create",
	}
	observerActions = []string{
		"org_units.read", "data.catalog.read", "data.query", "tasks.read", "knowledge.read",
		"fleet.vehicles.read", "fleet.trips.read",
	}
	earningsActions = []string{"fleet.earnings.read"}
	// Template project_manager: the role is assigned with the object scope «project» (PD-53).
	projectManagerActions = []string{
		"tasks.projects.read", "tasks.projects.manage", "tasks.read", "tasks.create", "tasks.update", "tasks.transition",
		"tasks.approve", "tasks.members.manage", "tasks.workflow.manage", "tasks.automation.manage", "files.read", "files.upload",
	}
	// A custom tenant-wide role that lists owner_only actions (modules.manage, billing.manage): they stay the
	// owner's (permissions.yaml owner_only), whatever a role says.
	adminActions = []string{
		"members.read", "members.invite", "members.manage", "roles.read", "org_units.read",
		"modules.read", "modules.manage", "modules.settings.read", "billing.read", "billing.manage",
	}
)

const (
	roleManager  = "manager"
	roleDriver   = "driver"
	roleObserver = "observer"
	roleEarnings = "earnings"
	roleProject  = "project_manager"
	roleAdmin    = "admin"
	fnDriver     = "driver"
	zoneMoscow   = "Europe/Moscow"
	zoneSamara   = "Europe/Samara"
	uMsk         = "msk"
	uMsk1        = "msk1"
	uMsk2        = "msk2"
	uSmr         = "smr"
	uSmr2        = "smr2"
	uSpb         = "spb"
	uSpb1        = "spb1"
	projectFleet = "fleet"
)

// roles returns the same role names for every tenant (tenant B mirrors tenant A).
func roles() []RoleDef {
	return []RoleDef{
		{Key: roleManager, Name: "Менеджер логистики", Kind: RoleKindTemplate, Template: "logistics_manager", Actions: clone(managerActions)},
		{Key: roleDriver, Name: "Водитель", Kind: RoleKindTemplate, Template: "driver", Actions: clone(driverActions)},
		{Key: roleObserver, Name: "Наблюдатель", Kind: RoleKindTemplate, Template: "observer", Actions: clone(observerActions)},
		{Key: roleEarnings, Name: "Начисления", Kind: RoleKindCustom, Actions: clone(earningsActions)},
		{Key: roleProject, Name: "Руководитель проекта", Kind: RoleKindTemplate, Template: "project_manager", Actions: clone(projectManagerActions)},
		{Key: roleAdmin, Name: "Администратор", Kind: RoleKindCustom, Actions: clone(adminActions)},
	}
}

// region returns a region and its firms «<name>-1…n» with keys <key>1…n (keys of W0.15 stay: msk1, msk2, smr2).
func region(key, name, zone string, firms ...int) []UnitDef {
	out := []UnitDef{{Key: key, Kind: KindRegion, Name: name, TimeZone: zone}}
	for _, n := range firms {
		out = append(out, UnitDef{Key: fmt.Sprintf("%s%d", key, n), Parent: key, Kind: KindCompany, Name: fmt.Sprintf("%s-%d", name, n), TimeZone: zone})
	}
	return out
}

func units(parts ...[]UnitDef) []UnitDef { return slices.Concat(parts...) }

// objects are the targets of object-bound grants of every tenant: the project «Автопарк» (Задачи).
func objects() []ObjectDef {
	return []ObjectDef{{Kind: ObjectProject, Key: projectFleet, Name: "Автопарк"}}
}

func clone(s []string) []string { return append([]string(nil), s...) }

func unitGrant(role, unit string) []GrantDef {
	return []GrantDef{{Role: role, Scope: unit, Descendants: true}}
}

func selfDriver() []GrantDef { return []GrantDef{{Role: roleDriver, Scope: ScopeSelf}} }

// Default returns a fresh copy of the fixture catalog (callers may change it freely).
//
// Tenant A «Холдинг»: Москва, Самара, Петербург × 4 firms (15-quality-security.md «Фикстуры изоляции»). Tenant B
// «Чужой клиент» has namesake regions, firms and roles: Москва (Москва-1, Москва-2) and Самара (Самара-2). Keys of
// actors start with the tenant they belong to; ab.member belongs to both; p.operator is a platform operator.
func Default() Catalog {
	return Catalog{
		Tenants: []TenantDef{
			{
				Key: TenantA, Slug: "iso-holding", Name: "Холдинг",
				Units: units(
					region(uMsk, "Москва", zoneMoscow, 1, 2, 3, 4),
					region(uSmr, "Самара", zoneSamara, 1, 2, 3, 4),
					region(uSpb, "Петербург", zoneMoscow, 1, 2, 3, 4),
				),
				Roles: roles(),
				Groups: []GroupDef{
					{Key: "finance", Name: "Финансы", Grants: unitGrant(roleEarnings, uMsk1)},
				},
				Objects: objects(),
			},
			{
				Key: TenantB, Slug: "iso-foreign", Name: "Чужой клиент",
				Units: units(
					region(uMsk, "Москва", zoneMoscow, 1, 2),
					region(uSmr, "Самара", zoneSamara, 2),
				),
				Roles:   roles(),
				Objects: objects(),
			},
		},
		Actors: []ActorDef{
			{Key: "a.owner", Name: "Владелец Холдинга", Memberships: []MemberDef{
				{Tenant: TenantA, Home: uMsk, Owner: true},
			}},
			{Key: "a.region-msk", Name: "Руководитель региона Москва", Memberships: []MemberDef{
				{Tenant: TenantA, Home: uMsk, Grants: unitGrant(roleManager, uMsk)},
			}},
			{Key: "a.manager-msk1", Name: "Менеджер Москва-1", Memberships: []MemberDef{
				{Tenant: TenantA, Home: uMsk1, Grants: unitGrant(roleManager, uMsk1)},
			}},
			{Key: "a.manager-msk2", Name: "Менеджер Москва-2", Memberships: []MemberDef{
				{Tenant: TenantA, Home: uMsk2, Grants: unitGrant(roleManager, uMsk2)},
			}},
			// «Изменять» в Москва-1 и «читать» в Самара-2: права не перемножаются между областями.
			{Key: "a.two-roles", Name: "Две роли", Memberships: []MemberDef{
				{Tenant: TenantA, Home: uMsk1, Grants: []GrantDef{
					{Role: roleManager, Scope: uMsk1, Descendants: true},
					{Role: roleObserver, Scope: uSmr2, Descendants: true},
				}},
			}},
			{Key: "a.driver-msk1", Name: "Водитель Москва-1", Memberships: []MemberDef{
				{Tenant: TenantA, Home: uMsk1, Function: fnDriver, Grants: selfDriver()},
			}},
			// Водитель Москва-2 во временном назначении на Москва-1.
			{Key: "a.driver-msk2", Name: "Водитель Москва-2", Memberships: []MemberDef{
				{Tenant: TenantA, Home: uMsk2, Function: fnDriver, Grants: []GrantDef{
					{Role: roleDriver, Scope: ScopeSelf},
					{Role: roleDriver, Scope: uMsk1, Period: PeriodTemporary},
				}},
			}},
			// Функция driver и fleet.earnings.read через группу «Финансы»: конфликт, начисления закрыты (AC-05).
			{Key: "a.driver-earnings", Name: "Водитель в группе Финансы", Memberships: []MemberDef{
				{Tenant: TenantA, Home: uMsk1, Function: fnDriver, Grants: selfDriver(), Groups: []string{"finance"}},
			}},
			{Key: "b.owner", Name: "Владелец Чужого клиента", Memberships: []MemberDef{
				{Tenant: TenantB, Home: uMsk, Owner: true},
			}},
			{Key: "b.manager-msk1", Name: "Менеджер Москва-1 (B)", Memberships: []MemberDef{
				{Tenant: TenantB, Home: uMsk1, Grants: unitGrant(roleManager, uMsk1)},
			}},
			{Key: "b.driver-msk1", Name: "Водитель Москва-1 (B)", Memberships: []MemberDef{
				{Tenant: TenantB, Home: uMsk1, Function: fnDriver, Grants: selfDriver()},
			}},
			// Один аккаунт в двух тенантах (BR-T2).
			{Key: "ab.member", Name: "Участник двух организаций", Memberships: []MemberDef{
				{Tenant: TenantA, Home: uMsk2, Grants: unitGrant(roleObserver, uMsk2)},
				{Tenant: TenantB, Home: uMsk2, Grants: unitGrant(roleObserver, uMsk2)},
			}},
			// PD-53: роль проекта даёт права только в проекте «Автопарк», не во всей организации.
			{Key: "a.project-lead", Name: "Руководитель проекта", Memberships: []MemberDef{
				{Tenant: TenantA, Home: uMsk1, Grants: []GrantDef{{Role: roleProject, Scope: ObjectProject + ":" + projectFleet}}},
			}},
			// owner_only: роль на всю организацию с modules.manage и billing.manage — без владения не действует.
			{Key: "a.admin", Name: "Администратор Холдинга", Memberships: []MemberDef{
				{Tenant: TenantA, Home: uMsk, Grants: []GrantDef{{Role: roleAdmin, Scope: ScopeTenant}}},
			}},
			// Часы набора на шлюзе: назначение менеджера на Петербург-1 закончилось вчера по часам набора…
			{Key: "a.manager-expired", Name: "Менеджер Петербург-1 (назначение закончилось)", Memberships: []MemberDef{
				{Tenant: TenantA, Home: uSpb1, Grants: []GrantDef{{Role: roleManager, Scope: uSpb1, Descendants: true, Period: PeriodExpired}}},
			}},
			// …и начнётся завтра по часам набора, хотя по часам машины уже идёт (cmd/api обязан взять APP_FIXED_NOW).
			{Key: "a.manager-future", Name: "Менеджер Петербург-1 (назначение ещё не началось)", Memberships: []MemberDef{
				{Tenant: TenantA, Home: uSpb1, Grants: []GrantDef{{Role: roleManager, Scope: uSpb1, Descendants: true, Period: PeriodFuture}}},
			}},
			// Оператор платформы (отдельный контур, без членств): положительные строки тега Platform.
			{Key: "p.operator", Name: "Оператор платформы", Operator: "owner"},
		},
	}
}
