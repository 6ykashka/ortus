package modulesreg

import (
	"slices"
	"strings"

	modulesapi "github.com/ortus/ortus-crm/backend/internal/api/modules"
)

// Module states of the contract (ModuleManifest.state, ModuleAvailability.state).
const (
	StateUninstalled = "uninstalled"
	StateActive      = "active"
	StateDraining    = "draining"
	StateReadOnly    = "read_only"
	StateDisabled    = "disabled"
)

// Retained access after disabling (ModuleInstallationUpdate.retainedAccess).
const (
	RetainHistory = "history_read"
	RetainExport  = "owner_export"
)

// manifestVersion is the version of every manifest of stage 1 (manifestDto of MSW W0.13).
const manifestVersion = "1.0.0"

// Action is one action of the permission catalog.
type Action struct {
	Key, Label, Level string
	Scopes            []string
	Sensitivity       string // normal | sensitive | restricted
}

// CatalogModule is one module of the permission catalog as the registry knows it.
type CatalogModule struct {
	Key, Label string
	DependsOn  []string // catalog keys (core.calendar, inventory)
	Actions    []Action
}

// catalogModules is catalogText parsed once (the text is a constant: a malformed line is a programming error).
var catalogModules = parseCatalog(catalogText)

func parseCatalog(text string) []CatalogModule {
	var out []CatalogModule
	for line := range strings.Lines(text) {
		f := strings.Split(line, "|")
		for i := range f {
			f[i] = strings.TrimSpace(f[i])
		}
		switch {
		case len(f) == 3 && strings.HasPrefix(f[0], "module "):
			out = append(out, CatalogModule{
				Key: strings.TrimPrefix(f[0], "module "), Label: f[1], DependsOn: strings.Fields(f[2]),
			})
		case len(f) == 5 && len(out) > 0:
			last := &out[len(out)-1]
			last.Actions = append(last.Actions, Action{
				Key: f[0], Label: f[1], Level: f[2], Scopes: strings.Fields(f[3]), Sensitivity: f[4],
			})
		case len(f) == 1 && f[0] == "":
		default:
			panic("modulesreg: malformed catalog line: " + line)
		}
	}
	for i := range out {
		if out[i].DependsOn == nil {
			out[i].DependsOn = []string{}
		}
	}
	return out
}

// Contract keys of the installable modules and of the core modules with settings.
const (
	KeyFleet   = "fleet"
	KeySpa     = "spa"
	KeyRepairs = "repairs"
	KeyForms   = "forms"
	KeyTasks   = "tasks"
)

// installable maps the contract keys of the installable modules to their catalog modules, in the order of the
// contract examples (INSTALLABLE of MSW W0.13).
var installable = []struct{ key, catalog string }{
	{KeyFleet, "logistics"}, {KeySpa, "spa"}, {KeyRepairs, "repairs"},
}

// coreKeys are always installed (CORE_MODULES of MSW W0.13; members and modules are system modules without
// availability rows).
var coreKeys = []string{KeyTasks, KeyForms, "calendar", "knowledge", "files", "data", "inventory", "cash"}

// synonyms are stored keys of the catalog read as contract keys (isolation fixtures of W1.04 store logistics).
var synonyms = map[string]string{"logistics": KeyFleet, "repair": KeyRepairs}

// Catalog returns the tenant modules of the permission catalog in catalog order (copies).
func Catalog() []CatalogModule {
	out := make([]CatalogModule, 0, len(catalogModules))
	for _, m := range catalogModules {
		c := m
		c.DependsOn = slices.Clone(m.DependsOn)
		c.Actions = slices.Clone(m.Actions)
		out = append(out, c)
	}
	return out
}

// InstallableKeys returns the keys of the installable modules in the order of the contract examples.
func InstallableKeys() []string {
	out := make([]string, 0, len(installable))
	for _, m := range installable {
		out = append(out, m.key)
	}
	return out
}

// CoreKeys returns the keys of the core modules: always installed (CORE_MODULES of the MSW adapter W0.13).
func CoreKeys() []string { return slices.Clone(coreKeys) }

// IsInstallable reports whether key is the contract key of an installable module.
func IsInstallable(key string) bool { return catalogOf(key) != "" }

// isCore reports whether key is a core module.
func isCore(key string) bool { return slices.Contains(coreKeys, key) }

func catalogOf(key string) string {
	for _, m := range installable {
		if m.key == key {
			return m.catalog
		}
	}
	return ""
}

// Canonical returns the contract key of a stored module_key (synonyms of the catalog accepted).
func Canonical(stored string) (string, bool) {
	if k, ok := synonyms[stored]; ok {
		return k, true
	}
	if IsInstallable(stored) || isCore(stored) {
		return stored, true
	}
	return "", false
}

// Availability modules of the system actions (moduleOfKey of MSW).
const (
	moduleMembers = "members"
	moduleModules = "modules"
)

// systemModules maps action prefixes of the system modules to their availability module.
var systemModules = map[string]string{
	moduleMembers: moduleMembers, "roles": moduleMembers, "org_units": moduleMembers,
	moduleModules: moduleModules, "billing": moduleModules,
}

// ModuleOfAction returns the availability module of an action key (members, modules or the prefix).
func ModuleOfAction(key string) string {
	prefix, _, _ := strings.Cut(key, ".")
	if m, ok := systemModules[prefix]; ok {
		return m
	}
	return prefix
}

// actionLevel returns the editor level of an action ("" for an unknown action).
func actionLevel(key string) string {
	for _, m := range catalogModules {
		for _, a := range m.Actions {
			if a.Key == key {
				return a.Level
			}
		}
	}
	return ""
}

// scopeKinds maps catalog scopes to Permission.allowedScopeKinds of the contract (warehouse has no kind yet).
var scopeKinds = map[string]modulesapi.PermissionAllowedScopeKinds{
	"tenant": "tenant", "unit": "org_unit", "project": "project", "self": "self", "resource": "resource_pool",
}

// sensitivities maps catalog sensitivity to Permission.sensitivity of the contract.
var sensitivities = map[string]modulesapi.PermissionSensitivity{"sensitive": "personal", "restricted": "financial"}

// Manifest returns the trusted manifest of an installable module in state with revision.
func Manifest(key, state string, revision int64) (modulesapi.ModuleManifest, bool) {
	cat := catalogOf(key)
	if cat == "" {
		return modulesapi.ModuleManifest{}, false
	}
	i := slices.IndexFunc(catalogModules, func(m CatalogModule) bool { return m.Key == cat })
	mod := catalogModules[i]
	m := modulesapi.ModuleManifest{
		ModuleKey: key, Version: manifestVersion, Name: mod.Label, Dependencies: []string{}, Datasets: []string{},
		Permissions: make([]modulesapi.Permission, 0, len(mod.Actions)), State: modulesapi.ModuleManifestState(state),
		Revision: revision,
	}
	for _, d := range mod.DependsOn {
		m.Dependencies = append(m.Dependencies, strings.TrimPrefix(d, "core."))
	}
	for _, a := range mod.Actions {
		p := modulesapi.Permission{
			Key: a.Key, ModuleKey: key, Description: a.Label, AllowedScopeKinds: []modulesapi.PermissionAllowedScopeKinds{},
			Sensitivity: "standard",
		}
		if s, ok := sensitivities[a.Sensitivity]; ok {
			p.Sensitivity = s
		}
		for _, sc := range a.Scopes {
			if k, ok := scopeKinds[sc]; ok && !slices.Contains(p.AllowedScopeKinds, k) {
				p.AllowedScopeKinds = append(p.AllowedScopeKinds, k)
			}
		}
		m.Permissions = append(m.Permissions, p)
	}
	return m, true
}
