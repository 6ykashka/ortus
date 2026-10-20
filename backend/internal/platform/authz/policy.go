package authz

import (
	"slices"
	"strings"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
)

// Modules of the permission catalog (sections «modules» of api/permissions.yaml).
const (
	ModMembers   = "core.members"
	ModModules   = "core.modules"
	ModFiles     = "core.files"
	ModData      = "core.data"
	ModTasks     = "core.tasks"
	ModForms     = "core.forms"
	ModCalendar  = "core.calendar"
	ModKnowledge = "core.knowledge"
	ModChat      = "core.chat"
	ModLogistics = "logistics"
	ModRepairs   = "repairs"
	ModInventory = "inventory"
	ModSpa       = "spa"
	ModCash      = "cash"
)

// FunctionDriver is the work function that closes restricted actions (AUTH-05, ADR-0011).
const FunctionDriver = "driver"

// Policy is what the evaluator needs of the permission catalog besides role contents.
type Policy struct {
	Actions   []string            // tenant actions (catalog.TenantActions): any other action is denied
	OwnerOnly map[string]bool     // owner_only: only an OwnerBinding grants them, whatever a role says
	BlockedBy map[string][]string // blocked_by_function: action → work functions that close it
}

// DefaultPolicy is the catalog of contract 0.3.0-stage1 (api/permissions.yaml; TestPolicyMatchesCatalog guards
// the tables below against it).
func DefaultPolicy() Policy {
	driverOnly := []string{FunctionDriver}
	return Policy{
		Actions: slices.Clone(catalog.TenantActions),
		OwnerOnly: map[string]bool{
			"modules.manage": true, "billing.manage": true, "branding.manage": true, "chat.hold.manage": true,
			"chat.policy.manage": true,
		},
		BlockedBy: map[string][]string{
			"chat.pdn.read": driverOnly, "fleet.earnings.read": driverOnly, "fleet.earnings.manage": driverOnly,
		},
	}
}

// Known reports whether action is a tenant action of the catalog.
func (p Policy) Known(action string) bool { return slices.Contains(p.Actions, action) }

// Blocked reports whether one of functions closes action.
func (p Policy) Blocked(action string, functions []string) bool {
	return slices.ContainsFunc(p.BlockedBy[action], func(f string) bool { return slices.Contains(functions, f) })
}

// Blockable reports whether some work function closes action.
func (p Policy) Blockable(action string) bool { return len(p.BlockedBy[action]) > 0 }

// modulePrefixes maps the first segment of an action key to its catalog module.
var modulePrefixes = map[string]string{
	"members": ModMembers, "roles": ModMembers, "org_units": ModMembers,
	"modules": ModModules, "billing": ModModules, "branding": ModModules,
	"files": ModFiles, "data": ModData, "tasks": ModTasks, "forms": ModForms, "calendar": ModCalendar,
	"knowledge": ModKnowledge, "chat": ModChat, "fleet": ModLogistics, "repairs": ModRepairs,
	"inventory": ModInventory, "spa": ModSpa, "cash": ModCash,
}

// ModuleOf returns the catalog module of an action by its prefix ("" for an unknown prefix).
func ModuleOf(action string) string {
	prefix, _, _ := strings.Cut(action, ".")
	return modulePrefixes[prefix]
}

// installKeys maps module_key of modules.installations to the catalog module: catalog keys and the keys of
// ModuleAvailability.moduleKey of the contract (fleet, repairs) are both accepted until W1.08 fixes one.
var installKeys = map[string]string{
	ModLogistics: ModLogistics, "fleet": ModLogistics,
	ModSpa: ModSpa, ModRepairs: ModRepairs, "repair": ModRepairs,
	"chat": ModChat, ModChat: ModChat,
}

// alwaysOn are the modules every tenant has: CORE_MODULES of the MSW adapter W0.13 plus the system modules of
// the catalog (brief W1.04 §10 п.3).
var alwaysOn = []string{
	ModMembers, ModModules, ModFiles, ModData, ModTasks, ModForms, ModCalendar, ModKnowledge, ModInventory, ModCash,
}

// Installed returns the catalog modules of a tenant: the core ones and those of installation keys (unknown keys
// are ignored).
func Installed(keys []string) map[string]bool {
	out := map[string]bool{}
	for _, m := range alwaysOn {
		out[m] = true
	}
	for _, k := range keys {
		if m, ok := installKeys[k]; ok {
			out[m] = true
		}
	}
	return out
}
