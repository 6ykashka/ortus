package fixtures

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
)

const (
	roleManager  = "manager"
	roleDriver   = "driver"
	roleObserver = "observer"
	roleEarnings = "earnings"
	fnDriver     = "driver"
	zoneMoscow   = "Europe/Moscow"
	zoneSamara   = "Europe/Samara"
	uMsk         = "msk"
	uMsk1        = "msk1"
	uMsk2        = "msk2"
)

// roles returns the same role names for every tenant (tenant B mirrors tenant A).
func roles() []RoleDef {
	return []RoleDef{
		{Key: roleManager, Name: "Менеджер логистики", Kind: RoleKindTemplate, Template: "logistics_manager", Actions: clone(managerActions)},
		{Key: roleDriver, Name: "Водитель", Kind: RoleKindTemplate, Template: "driver", Actions: clone(driverActions)},
		{Key: roleObserver, Name: "Наблюдатель", Kind: RoleKindTemplate, Template: "observer", Actions: clone(observerActions)},
		{Key: roleEarnings, Name: "Начисления", Kind: RoleKindCustom, Actions: clone(earningsActions)},
	}
}

func clone(s []string) []string { return append([]string(nil), s...) }

func unitGrant(role, unit string) []GrantDef {
	return []GrantDef{{Role: role, Scope: unit, Descendants: true}}
}

func selfDriver() []GrantDef { return []GrantDef{{Role: roleDriver, Scope: ScopeSelf}} }

// Default returns a fresh copy of the fixture catalog (callers may change it freely).
//
// Tenant A «Холдинг»: Москва (Москва-1, Москва-2) and Самара (Самара-2). Tenant B «Чужой клиент» has namesake
// firms and roles. Keys of actors start with the tenant they belong to; ab.member belongs to both.
func Default() Catalog {
	return Catalog{
		Tenants: []TenantDef{
			{
				Key: TenantA, Slug: "iso-holding", Name: "Холдинг",
				Units: []UnitDef{
					{Key: uMsk, Kind: KindRegion, Name: "Москва", TimeZone: zoneMoscow},
					{Key: uMsk1, Parent: uMsk, Kind: KindCompany, Name: "Москва-1", TimeZone: zoneMoscow},
					{Key: uMsk2, Parent: uMsk, Kind: KindCompany, Name: "Москва-2", TimeZone: zoneMoscow},
					{Key: "smr", Kind: KindRegion, Name: "Самара", TimeZone: zoneSamara},
					{Key: "smr2", Parent: "smr", Kind: KindCompany, Name: "Самара-2", TimeZone: zoneSamara},
				},
				Roles: roles(),
				Groups: []GroupDef{
					{Key: "finance", Name: "Финансы", Grants: unitGrant(roleEarnings, uMsk1)},
				},
			},
			{
				Key: TenantB, Slug: "iso-foreign", Name: "Чужой клиент",
				Units: []UnitDef{
					{Key: uMsk, Kind: KindRegion, Name: "Москва", TimeZone: zoneMoscow},
					{Key: uMsk1, Parent: uMsk, Kind: KindCompany, Name: "Москва-1", TimeZone: zoneMoscow},
					{Key: uMsk2, Parent: uMsk, Kind: KindCompany, Name: "Москва-2", TimeZone: zoneMoscow},
				},
				Roles: roles(),
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
					{Role: roleObserver, Scope: "smr2", Descendants: true},
				}},
			}},
			{Key: "a.driver-msk1", Name: "Водитель Москва-1", Memberships: []MemberDef{
				{Tenant: TenantA, Home: uMsk1, Function: fnDriver, Grants: selfDriver()},
			}},
			// Водитель Москва-2 во временном назначении на Москва-1.
			{Key: "a.driver-msk2", Name: "Водитель Москва-2", Memberships: []MemberDef{
				{Tenant: TenantA, Home: uMsk2, Function: fnDriver, Grants: []GrantDef{
					{Role: roleDriver, Scope: ScopeSelf},
					{Role: roleDriver, Scope: uMsk1, Temporary: true},
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
		},
	}
}
