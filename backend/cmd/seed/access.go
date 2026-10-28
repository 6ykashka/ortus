package main

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// Access part of the seed (W1.04, critique of stage 0 П-14): roles with their actions, groups, assignments and
// installed modules of «Альта» and «Лотос», as the MSW adapter of W0.13 builds them from mock-data.js 14.10
// (frontend/packages/adapter/src/msw/core/project.ts). Role actions are those of api/openapi/examples/listRoles/
// ok.json; an assignment «через группу» belongs to the group. With it /me/context answers the same capabilities on
// the stand as in mock (cmd/api TestStackCapabilitiesParity). Ownership stays an owner binding (control DB); the
// role «Владелец бизнеса» is the prototype's role with the actions of the example.

type roleDef struct {
	proto, name, kind, template string
	actions                     []string
}

type groupDef struct {
	proto, name string
	members     []string
}

// assignmentDef: principal is a member proto or «group:<group proto>»; scope tenant | self | unit | project with
// ref — the proto of the unit or project.
type assignmentDef struct {
	proto, principal, role, scope, ref string
}

type access struct {
	roles       []roleDef
	groups      []groupDef
	assignments []assignmentDef
	modules     []string // modules.installations (module_key), state enabled
}

const (
	scopeTenant  = "tenant"
	scopeSelf    = "self"
	scopeUnit    = "unit"
	scopeProject = "project"
	kindTemplate = "template"
	groupPrefix  = "group:"
	projectFleet = "fleet" // проект «Автопарк» прототипа
	memberOwner  = "m-owner"
	memberMoroz  = "m-morozova"
	tmplDriver   = "driver"
	nameDriver   = "Водитель"
)

func actions(csv string) []string { return strings.Split(csv, ",") }

// Roles of mock-data.js 14.10 with the canonical actions of listRoles/ok.json.
var (
	roleOwner = roleDef{"r-owner", "Владелец бизнеса", "system", "owner", actions(
		"members.read,members.invite,members.manage,roles.read,roles.manage,roles.assign,org_units.read,org_units.manage," +
			"modules.read,modules.manage,modules.settings.read,modules.settings.manage,billing.read,billing.manage," +
			"branding.manage," + // W4.07 (0.8.0-stage4): оформление — core.modules, owner_only
			"files.read,files.upload,data.catalog.read,data.query,data.export,tasks.projects.read,tasks.projects.manage," +
			"tasks.read,tasks.create,tasks.update,tasks.transition,tasks.approve,tasks.members.manage,tasks.workflow.manage," +
			"tasks.automation.manage,forms.read,forms.create,forms.manage,forms.publish,forms.publish_public," +
			"forms.responses.read,forms.responses.review,forms.responses.assign,calendar.availability.read," +
			"calendar.bookings.read,calendar.bookings.create,calendar.bookings.manage,knowledge.read,knowledge.create," +
			"knowledge.update,knowledge.publish,knowledge.organize,knowledge.access.manage,knowledge.members.manage," +
			"knowledge.automation.manage,knowledge.spaces.manage,inventory.items.read,inventory.items.manage," +
			"inventory.warehouses.manage,inventory.consumption.override,inventory.movements.read," +
			"inventory.movements.post,inventory.consume,spa.services.read,spa.services.manage,spa.appointments.read," +
			"spa.appointments.create,spa.appointments.perform,spa.appointments.complete,cash.read,cash.balance.read,cash.post,cash.proposals.post,cash.shift.operate," +
			"cash.refund,cash.transfer,cash.advance.issue,cash.approve,cash.reconcile,cash.reverse,cash.payroll.post," +
			"cash.reports.finance,cash.accounts.manage,cash.period.close,cash.advance.self,cash.export")}
	roleManager = roleDef{"r-manager", "Менеджер логистики", kindTemplate, "logistics_manager", actions(
		"members.read,roles.read,org_units.read,files.read,files.upload,data.catalog.read,data.query,data.export," +
			"tasks.read,tasks.create,tasks.update,tasks.transition,forms.read,forms.responses.read,forms.responses.review," +
			"calendar.availability.read,calendar.bookings.read,knowledge.read,fleet.vehicles.read,fleet.vehicles.manage," +
			"fleet.reservations.read,fleet.reservations.manage,fleet.inspections.read,fleet.inspections.review," +
			"fleet.trips.read,fleet.trips.review,fleet.routes.read,fleet.routes.manage,fleet.expenses.read," +
			"fleet.expenses.review,fleet.driver_transfers.read,fleet.driver_transfers.request," +
			"fleet.driver_transfers.approve,fleet.earnings.read")}
	roleDriver = roleDef{"r-driver", nameDriver, kindTemplate, tmplDriver, actions(
		"files.read,files.upload,tasks.read,knowledge.read,calendar.availability.read,fleet.vehicles.read," +
			"fleet.reservations.read,fleet.reservations.create,fleet.reservations.choose,fleet.inspections.read," +
			"fleet.inspections.submit,fleet.trips.read,fleet.trips.start,fleet.trips.return,fleet.routes.read," +
			"fleet.expenses.read,fleet.expenses.create")} // W2.71 (S2-20, Q-W2.70-7): + fleet.reservations.choose
	roleTherapist = roleDef{"r-therapist", "Массажист", kindTemplate, "", actions(
		"spa.appointments.read,spa.appointments.create,calendar.bookings.read,calendar.bookings.manage,knowledge.read")}
	roleForeman = roleDef{"r-foreman", "Прораб", kindTemplate, "foreman", actions(
		"files.read,files.upload,tasks.read,tasks.create,knowledge.read,repairs.projects.read,repairs.work_logs.read," +
			"repairs.work_logs.submit,repairs.schedule.read,repairs.schedule.shift,repairs.changes.submit,repairs.supply.request,repairs.measurements.edit")}
	rolePM = roleDef{"r-pm", "Руководитель проекта", kindTemplate, "project_manager", actions(
		"tasks.projects.read,tasks.projects.manage,tasks.read,tasks.create,tasks.update,tasks.transition,tasks.approve," +
			"tasks.members.manage,tasks.workflow.manage,tasks.automation.manage,files.read,files.upload")}
	roleApprover = roleDef{"r-approver", "Согласующий", kindTemplate, "project_approver", actions(
		"tasks.projects.read,tasks.read,tasks.approve,files.read")}
	roleExecutor = roleDef{"r-exec", "Исполнитель", kindTemplate, "project_executor", actions(
		"tasks.projects.read,tasks.read,tasks.create,tasks.update,tasks.transition,files.read,files.upload")}
	roleViewer = roleDef{"r-viewer", "Наблюдатель", kindTemplate, "project_viewer", actions(
		"tasks.projects.read,tasks.read,files.read")}
)

// altaAccess: mock-data.js baseSeed() — 5 base roles and 4 project roles, two groups, 7 assignments; SPA is the
// only installed module (logistics and repairs are switched on in the scenarios of the prototype).
var altaAccess = access{
	roles: []roleDef{roleOwner, roleManager, roleDriver, roleTherapist, roleForeman, rolePM, roleApprover, roleExecutor, roleViewer},
	groups: []groupDef{
		{"g-disp", "Диспетчеры Север", []string{memberKotova, "m-petrova"}},
		{"g-drv", "Водители Север", []string{"m-vasiliev", "m-gromov"}},
	},
	assignments: []assignmentDef{
		{"a1", memberOwner, roleOwner.proto, scopeTenant, ""},
		{"ap1", memberKotova, rolePM.proto, scopeProject, projectFleet},
		{"ap2", groupPrefix + "g-drv", roleExecutor.proto, scopeProject, projectFleet},
		{"ap3", "m-kotelnikova", roleApprover.proto, scopeProject, projectFleet},
		{"a2", groupPrefix + "g-drv", roleDriver.proto, scopeUnit, homeAlta},
		{"a3", memberMoroz, roleTherapist.proto, scopeSelf, ""},
		{"a4", "m-sokolov", roleForeman.proto, scopeSelf, ""},
	},
	modules: []string{"spa"},
}

// lotosAccess: mock-data.js seedLotos() without the generated staff (acc-g*, not in the skeleton of W0.06).
var lotosAccess = access{
	roles: []roleDef{roleOwner, roleTherapist},
	assignments: []assignmentDef{
		{"la1", memberOwner, roleOwner.proto, scopeTenant, ""},
		{"la2", memberMoroz, roleTherapist.proto, scopeSelf, ""},
	},
	modules: []string{"spa"},
}

// accessOf returns the access data of a tenant of the stand.
func accessOf(tenant string) access {
	switch tenant {
	case protoAlta:
		return altaAccess
	case protoLotos:
		return lotosAccess
	}
	return access{}
}

// grantsSince is the start of every seeded assignment, as the work profiles of the seed: the pilot September.
const grantsSince = "2026-09-01 00:00+03"

// writeAccess writes the access data of td in the transaction of its tenant DB; existing rows are kept.
func writeAccess(ctx context.Context, tx *sql.Tx, td tenantData) error {
	a := accessOf(td.tenant.proto)
	id := func(proto string) uuid.UUID { return seedID(td.tenant.proto, proto) }
	owner := id(memberOwner)
	var exec execFunc = func(what, q string, args ...any) error {
		if _, err := tx.ExecContext(ctx, q, args...); err != nil {
			return fmt.Errorf("%s: %w", what, err)
		}
		return nil
	}
	if err := exec("policy_state", `insert into access.policy_state default values on conflict do nothing`); err != nil {
		return err
	}
	if err := writeRoles(exec, id, owner, a.roles); err != nil {
		return err
	}
	if err := writeGroups(exec, id, a.groups); err != nil {
		return err
	}
	for _, as := range a.assignments {
		if err := writeAssignment(ctx, tx, id, owner, as); err != nil {
			return err
		}
	}
	for _, m := range a.modules {
		if err := exec("module "+m, `insert into modules.installations (module_key, state, manifest_version, updated_by)
			values ($1, 'enabled', '0.2', $2) on conflict do nothing`, m, owner); err != nil {
			return err
		}
	}
	return nil
}

type execFunc func(what, q string, args ...any) error

func writeRoles(exec execFunc, id func(string) uuid.UUID, owner uuid.UUID, roles []roleDef) error {
	for _, r := range roles {
		if err := exec("role "+r.proto, `insert into access.roles (id, name, kind, template_key) values ($1, $2, $3, nullif($4, ''))
			on conflict (id) do nothing`, id(r.proto), r.name, r.kind, r.template); err != nil {
			return err
		}
		if err := exec("role version "+r.proto, `insert into access.role_versions (role_id, version, actions, created_by)
			values ($1, 1, $2, $3) on conflict do nothing`, id(r.proto), r.actions, owner); err != nil {
			return err
		}
	}
	return nil
}

func writeGroups(exec execFunc, id func(string) uuid.UUID, groups []groupDef) error {
	for _, g := range groups {
		if err := exec("group "+g.proto, `insert into access.groups (id, name) values ($1, $2) on conflict (id) do nothing`,
			id(g.proto), g.name); err != nil {
			return err
		}
		for _, m := range g.members {
			if err := exec("group member "+m, `insert into access.group_members (group_id, person_id) values ($1, $2)
				on conflict do nothing`, id(g.proto), id(m)); err != nil {
				return err
			}
		}
	}
	return nil
}

func writeAssignment(ctx context.Context, tx *sql.Tx, id func(string) uuid.UUID, owner uuid.UUID, as assignmentDef) error {
	kind, principal := "person", as.principal
	if g, ok := strings.CutPrefix(as.principal, groupPrefix); ok {
		kind, principal = "group", g
	}
	var ref *uuid.UUID
	if as.ref != "" {
		r := id(as.ref)
		ref = &r
	}
	if _, err := tx.ExecContext(ctx, `insert into access.role_assignments
		(id, principal_kind, principal_id, role_id, role_version, scope_kind, scope_ref, include_descendants, valid,
		 granted_by, reason)
		values ($1, $2, $3, $4, 1, $5, $6, $7, tstzrange($8::timestamptz, null), $9, 'seed 14.10')
		on conflict (id) do nothing`,
		id(as.proto), kind, id(principal), id(as.role), as.scope, ref, as.scope == scopeUnit, grantsSince, owner); err != nil {
		return fmt.Errorf("assignment %s: %w", as.proto, err)
	}
	return nil
}
