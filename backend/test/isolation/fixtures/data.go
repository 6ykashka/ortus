package fixtures

import (
	"fmt"
	"slices"
)

// Role actions: templates of design/docs/11-permissions.yaml (logistics_manager, driver, observer) and a custom
// role with the restricted fleet.earnings.read.
var (
	managerActions = []string{
		"members.read", "roles.read", "org_units.read", permFilesRead, "files.upload", permKnowledgeRead,
		"fleet.vehicles.read", "fleet.vehicles.manage", "fleet.reservations.read", "fleet.reservations.manage",
		"fleet.inspections.read", "fleet.inspections.review", "fleet.trips.read", "fleet.trips.review",
		"fleet.routes.read", "fleet.routes.manage", "fleet.expenses.read", "fleet.expenses.review",
		"fleet.driver_transfers.read", "fleet.driver_transfers.request", "fleet.driver_transfers.approve",
	}
	driverActions = []string{
		permFilesRead, "files.upload", permTasksRead, permKnowledgeRead, "calendar.availability.read",
		"fleet.vehicles.read", "fleet.reservations.read", "fleet.reservations.create",
		"fleet.inspections.read", "fleet.inspections.submit", "fleet.trips.read", "fleet.trips.start", "fleet.trips.return",
		"fleet.routes.read", "fleet.expenses.read", "fleet.expenses.create",
	}
	observerActions = []string{
		"org_units.read", "data.catalog.read", "data.query", permTasksRead, permKnowledgeRead,
		"fleet.vehicles.read", "fleet.trips.read",
	}
	earningsActions = []string{"fleet.earnings.read"}
	// A custom role of the personnel officer: people of its units, imports with their default unit there (W1.44).
	staffActions = []string{"members.read", "members.manage"}
	// Template project_manager: the role is assigned with the object scope «project» (PD-53).
	projectManagerActions = []string{
		"tasks.projects.read", "tasks.projects.manage", permTasksRead, "tasks.create", "tasks.update", "tasks.transition",
		"tasks.approve", "tasks.members.manage", "tasks.workflow.manage", "tasks.automation.manage", permFilesRead, "files.upload",
	}
	// W4.03: template project_approver «Согласующий» — tasks.approve without tasks.transition (the vote on an approval
	// transition passes the gate by tasks.approve, x-permissions-mode any).
	projectApproverActions = []string{"tasks.projects.read", permTasksRead, "tasks.approve", permFilesRead}
	// W4.02: a custom role of a knowledge space lead, assigned with the object scope «space» (kind of stage 4, PD-53).
	spaceLeadActions = []string{permKnowledgeRead, "knowledge.create", "knowledge.update", "knowledge.publish"}
	// A custom tenant-wide role that lists owner_only actions (modules.manage, billing.manage): they stay the
	// owner's (permissions.yaml owner_only), whatever a role says.
	adminActions = []string{
		"members.read", "members.invite", "members.manage", "roles.read", "org_units.read",
		"modules.read", "modules.manage", "modules.settings.read", "billing.read", "billing.manage",
	}
)

const (
	roleManager    = "manager"
	roleDriver     = "driver"
	roleObserver   = "observer"
	roleEarnings   = "earnings"
	roleProject    = "project_manager"
	roleApprover   = "project_approver"
	roleAdmin      = "admin"
	roleStaff      = "staff"
	roleSpaceLead  = "space_lead"
	fnDriver       = "driver"
	zoneMoscow     = "Europe/Moscow"
	zoneSamara     = "Europe/Samara"
	uMsk           = "msk"
	uMsk1          = "msk1"
	uMsk2          = "msk2"
	uSmr           = "smr"
	uSmr2          = "smr2"
	uSpb           = "spb"
	uSpb1          = "spb1"
	projectFleet   = "fleet"
	projectBuild   = "build"
	spaceRules     = "rules"
	pageRulesIntro = "rules-intro" // the page of the space «Регламенты»
)

// roles returns the same role names for every tenant (tenant B mirrors tenant A).
func roles() []RoleDef {
	return []RoleDef{
		{Key: roleManager, Name: "Менеджер логистики", Kind: RoleKindTemplate, Template: "logistics_manager", Actions: clone(managerActions)},
		{Key: roleDriver, Name: "Водитель", Kind: RoleKindTemplate, Template: "driver", Actions: clone(driverActions)},
		{Key: roleObserver, Name: "Наблюдатель", Kind: RoleKindTemplate, Template: "observer", Actions: clone(observerActions)},
		{Key: roleEarnings, Name: "Начисления", Kind: RoleKindCustom, Actions: clone(earningsActions)},
		{Key: roleProject, Name: "Руководитель проекта", Kind: RoleKindTemplate, Template: "project_manager", Actions: clone(projectManagerActions)},
		{Key: roleApprover, Name: "Согласующий", Kind: RoleKindTemplate, Template: "project_approver", Actions: clone(projectApproverActions)},
		{Key: roleAdmin, Name: "Администратор", Kind: RoleKindCustom, Actions: clone(adminActions)},
		{Key: roleStaff, Name: "Кадры", Kind: RoleKindCustom, Actions: clone(staffActions)},
		{Key: roleSpaceLead, Name: "Руководитель пространства", Kind: RoleKindCustom, Actions: clone(spaceLeadActions)},
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

// objects are the targets of object-bound grants of every tenant: the project «Автопарк» (Задачи), since W4.03 the
// project «Стройка» nobody has a role in (a role of «Автопарк» gives nothing there) and, since W4.02, one object of
// every object-bound kind of stages 4–7 (no rows: the modules add their tables with their steps).
func objects() []ObjectDef {
	return []ObjectDef{
		{Kind: ObjectProject, Key: projectFleet, Name: "Автопарк"},
		{Kind: ObjectProject, Key: projectBuild, Name: "Стройка"},
		{Kind: ObjectSpace, Key: spaceRules, Name: "Регламенты"},
		{Kind: ObjectPage, Key: pageRulesIntro, Name: "Регламенты · Введение"},
		{Kind: ObjectFolder, Key: "contracts", Name: "Договоры"},
		{Kind: ObjectDoc, Key: "contract", Name: "Договор поставки"},
		{Kind: ObjectAccount, Key: "cash", Name: "Касса Москва-1"},
		{Kind: ObjectChat, Key: "trip", Name: "Чат рейса"},
		{Kind: ObjectRepairProject, Key: "flat", Name: "Квартира на Лесной"},
	}
}

func clone(s []string) []string { return append([]string(nil), s...) }

func unitGrant(role, unit string) []GrantDef {
	return []GrantDef{{Role: role, Scope: unit, Descendants: true}}
}

func selfDriver() []GrantDef { return []GrantDef{{Role: roleDriver, Scope: ScopeSelf}} }

// Audience of the notifications of the content (notify.notifications.required_permission, sensitivity).
const (
	permTripsReview = "fleet.trips.review"
	permTripsRead   = "fleet.trips.read"
	// permFilesRead and permTasksRead are in the templates of the logistics and of the projects (W4.03).
	permFilesRead = "files.read"
	permTasksRead = "tasks.read"
	// permKnowledgeRead is in the templates of the manager, driver, observer and the space lead (W4.02).
	permKnowledgeRead = "knowledge.read"
	permEarnings      = "fleet.earnings.read"
	// sensRestricted closes a notification to a person with the driver function (AC-05).
	sensRestricted = "restricted"
)

// contentA is the content of tenant A (W1.44):
//   - imports: Москва-1 by default (Q-W1.05-19) with a row of a.driver-msk1; Москва-2 by default with a row of
//     a.driver-msk2 and a row of a.driver-msk1 — a person outside the scope of a.manager-msk2;
//   - vehicles with a file each (Q-W1.09-11): Москва-1 (managers of Москва-1 read it, the neighbouring firm does
//     not) and Самара-2 (a.two-roles sees the vehicle as an observer and has no files.read there — 403);
//   - notifications with an audience (Q-W1.10-8): a trip of Москва-1 to a.manager-msk1 and a trip of Москва-2 to
//     the same manager (hidden on read: no right there), restricted earnings to a.driver-earnings (hidden, AC-05),
//     a system notice to the owner, a trip of Москва-2 to ab.member.
func contentA() Content {
	projects, tasks, rules := taskContent(TenantA)
	groups, forms, formRules, responses := formContent(TenantA)
	return Content{
		Projects: projects, Tasks: tasks, Rules: rules, // W4.11 (content_tasks.go)
		FormGroups: groups, Forms: forms, FormRules: formRules, FormResponses: responses, // W4.21 (content_forms.go)
		Imports: []ImportDef{
			{Key: uMsk1, DefaultUnit: uMsk1, Rows: []ImportRowDef{{Person: "a.driver-msk1", Unit: uMsk1}}},
			{Key: uMsk2, DefaultUnit: uMsk2, Rows: []ImportRowDef{
				{Person: "a.driver-msk2", Unit: uMsk2},
				{Person: "a.driver-msk1", Unit: uMsk1},
			}},
		},
		Vehicles: []VehicleDef{{Key: uMsk1, Unit: uMsk1, Plate: "ИЗ-101"}, {Key: uSmr2, Unit: uSmr2, Plate: "ИЗ-202"}},
		Files: slices.Concat([]FileDef{
			{Key: uMsk1, Vehicle: uMsk1, Name: "Осмотр Москва-1.jpg"},
			{Key: uSmr2, Vehicle: uSmr2, Name: "Осмотр Самара-2.jpg"},
		}, taskFiles()), // W4.11: attachments of tasks (content_tasks.go)
		Notifications: []NotificationDef{
			{Key: "trip-msk1", Recipient: "a.manager-msk1", Title: "Рейс Москвы-1 сдан", Permission: permTripsReview, Unit: uMsk1},
			{Key: "trip-msk2", Recipient: "a.manager-msk1", Title: "Рейс Москвы-2 сдан", Permission: permTripsReview, Unit: uMsk2},
			{Key: "earnings", Recipient: "a.driver-earnings", Title: "Начисления за рейс", Permission: permEarnings, Unit: uMsk1,
				Sensitivity: sensRestricted},
			{Key: "owner", Recipient: "a.owner", Title: "Пробный период продлён"},
			{Key: "member", Recipient: "ab.member", Title: "Рейс Москвы-2 в пути", Permission: permTripsRead, Unit: uMsk2},
		},
		KnowledgeRequests: []KnowledgeRequestDef{{Key: kbAsk, Member: "a.driver-msk2"}},
		KnowledgeRules:    []KnowledgeRuleDef{{Key: kbReview, Name: "Напоминать о пересмотре"}},
	}
}

// contentB is the content of tenant B: namesakes of Москва-1 (an import, a vehicle with a file, a trip notification
// to b.manager-msk1) and a notification to ab.member — the same account reads one tenant at a time (BR-T2).
func contentB() Content {
	projects, tasks, rules := taskContent(TenantB)
	groups, forms, formRules, responses := formContent(TenantB)
	return Content{
		Projects: projects, Tasks: tasks, Rules: rules, // W4.11 (content_tasks.go)
		FormGroups: groups, Forms: forms, FormRules: formRules, FormResponses: responses, // W4.21 (content_forms.go)
		Imports:  []ImportDef{{Key: uMsk1, DefaultUnit: uMsk1, Rows: []ImportRowDef{{Person: "b.driver-msk1", Unit: uMsk1}}}},
		Vehicles: []VehicleDef{{Key: uMsk1, Unit: uMsk1, Plate: "ИЗ-101"}},
		Files:    slices.Concat([]FileDef{{Key: uMsk1, Vehicle: uMsk1, Name: "Осмотр Москва-1.jpg"}}, taskFiles()),
		Notifications: []NotificationDef{
			{Key: "trip-msk1", Recipient: "b.manager-msk1", Title: "Рейс Москвы-1 сдан", Permission: permTripsReview, Unit: uMsk1},
			{Key: "member", Recipient: "ab.member", Title: "Рейс Москвы-2 в пути", Permission: permTripsRead, Unit: uMsk2},
		},
		KnowledgeRequests: []KnowledgeRequestDef{{Key: kbAsk, Member: kbAskMemberB}},
		KnowledgeRules:    []KnowledgeRuleDef{{Key: kbReview, Name: "Напоминать о пересмотре"}},
	}
}

// The request and the rule of the knowledge base of every tenant (W4.31): kb_request:<t>.ask, kb_rule:<t>.review.
const (
	kbAsk    = "ask"
	kbReview = "review"
	// kbAskMemberB asks for the page in tenant B.
	kbAskMemberB = "b.manager-msk1"
)

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
				Content: contentA(),
				// W4.60: решённая заявка — строки «чужая заявка через свой URL» и «своя решённая — 409».
				Requests: []RequestDef{{Key: "rejected", Number: "SR-9001", Owner: "a.owner", Tier: TierTeam, Status: RequestRejected}},
			},
			{
				Key: TenantB, Slug: "iso-foreign", Name: "Чужой клиент",
				Units: units(
					region(uMsk, "Москва", zoneMoscow, 1, 2),
					region(uSmr, "Самара", zoneSamara, 2),
				),
				Roles:   roles(),
				Objects: objects(),
				Content: contentB(),
				// W4.60: заявка на рассмотрении — положительная строка решения оператора.
				Requests: []RequestDef{{Key: "pending", Number: "SR-9002", Owner: "b.owner", Tier: TierTeam, Status: RequestPending}},
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
			// Менеджер Москвы-2 ведёт и кадры своей фирмы (роль «Кадры», members.manage): импорт Москвы-1 для него —
			// как несуществующий, а не отказ шлюза (Q-W1.05-19, W1.44).
			{Key: "a.manager-msk2", Name: "Менеджер Москва-2", Memberships: []MemberDef{
				{Tenant: TenantA, Home: uMsk2, Grants: slices.Concat(unitGrant(roleManager, uMsk2), unitGrant(roleStaff, uMsk2))},
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
			// W4.03: согласующий «Автопарка» — tasks.approve без tasks.transition (голос согласования проходит шлюз).
			{Key: "a.project-approver", Name: "Согласующий проекта", Memberships: []MemberDef{
				{Tenant: TenantA, Home: uMsk1, Grants: []GrantDef{{Role: roleApprover, Scope: ObjectProject + ":" + projectFleet}}},
			}},
			// W4.02: виды областей этапов 4–7 — до регистрации вида в оценщике грант не даёт ничего (fail-closed, PD-53).
			{Key: "a.space-lead", Name: "Руководитель пространства", Memberships: []MemberDef{
				{Tenant: TenantA, Home: uMsk1, Grants: []GrantDef{{Role: roleSpaceLead, Scope: ObjectSpace + ":" + spaceRules}}},
			}},
			{Key: "a.later-scopes", Name: "Наблюдатель на объектах следующих этапов", Memberships: []MemberDef{
				{Tenant: TenantA, Home: uMsk2, Grants: []GrantDef{
					{Role: roleObserver, Scope: ObjectPage + ":rules-intro"},
					{Role: roleObserver, Scope: ObjectFolder + ":contracts"},
					{Role: roleObserver, Scope: ObjectDoc + ":contract"},
					{Role: roleObserver, Scope: ObjectAccount + ":cash"},
					{Role: roleObserver, Scope: ObjectChat + ":trip"},
					{Role: roleObserver, Scope: ObjectRepairProject + ":flat"},
					{Role: roleObserver, Scope: ScopeRelation},
				}},
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
			// W4.60 (Q-W4.07-14): роли операторов на шлюзе /platform/** — поддержка без биллинга, биллинг без управления
			// пользователями, администратор без управления операторами.
			{Key: "p.support", Name: "Оператор поддержки", Operator: "support"},
			{Key: "p.billing", Name: "Оператор биллинга", Operator: "billing"},
			{Key: "p.admin", Name: "Администратор платформы", Operator: "admin"},
		},
	}
}
