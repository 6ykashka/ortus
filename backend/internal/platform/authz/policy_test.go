package authz

import (
	"maps"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"go.yaml.in/yaml/v3"
)

// catalogAction is what the evaluator depends on of one action of api/permissions.yaml.
type catalogAction struct {
	Scopes            []string `yaml:"scopes"`
	OwnerOnly         bool     `yaml:"owner_only"`
	BlockedByFunction []string `yaml:"blocked_by_function"`
}

// readCatalog returns module → action → description of api/permissions.yaml.
func readCatalog(t *testing.T) map[string]map[string]catalogAction {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "api", "permissions.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	var c struct {
		Modules map[string]struct {
			Actions map[string]catalogAction `yaml:"actions"`
		} `yaml:"modules"`
	}
	if err := yaml.Unmarshal(raw, &c); err != nil {
		t.Fatal(err)
	}
	if len(c.Modules) < 10 {
		t.Fatalf("permissions.yaml: %d modules parsed", len(c.Modules))
	}
	out := map[string]map[string]catalogAction{}
	for m, v := range c.Modules {
		out[m] = v.Actions
	}
	return out
}

// tenantCatalog is the tenant part of the catalog as the policy keeps it.
type tenantCatalog struct {
	actions   []string
	ownerOnly map[string]bool
	blocked   map[string][]string
}

func collectTenantCatalog(t *testing.T, modules map[string]map[string]catalogAction) tenantCatalog {
	t.Helper()
	tc := tenantCatalog{ownerOnly: map[string]bool{}, blocked: map[string][]string{}}
	for module, actions := range modules {
		if module == "platform" {
			continue
		}
		for action, a := range actions {
			tc.actions = append(tc.actions, action)
			if a.OwnerOnly {
				tc.ownerOnly[action] = true
			}
			if len(a.BlockedByFunction) > 0 {
				tc.blocked[action] = a.BlockedByFunction
			}
			if got := ModuleOf(action); got != module {
				t.Errorf("ModuleOf(%s) = %q, want %q", action, got, module)
			}
			for _, s := range a.Scopes {
				if !isRegistered(s) {
					t.Errorf("%s: scope %q is not in the registry", action, s)
				}
			}
		}
	}
	slices.Sort(tc.actions)
	return tc
}

// Политика оценщика совпадает с каталогом прав (стюард меняет каталог — тест краснеет, таблицы правятся тут):
// действия организации, owner_only, blocked_by_function, модуль действия, области каталога известны реестру.
func TestPolicyMatchesCatalog(t *testing.T) {
	t.Parallel()
	modules := readCatalog(t)
	want := collectTenantCatalog(t, modules)
	p := DefaultPolicy()
	if !slices.Equal(p.Actions, want.actions) {
		t.Errorf("Policy.Actions:\n got %v\nwant %v", p.Actions, want.actions)
	}
	if !maps.Equal(p.OwnerOnly, want.ownerOnly) {
		t.Errorf("OwnerOnly = %v, want %v", p.OwnerOnly, want.ownerOnly)
	}
	if !maps.EqualFunc(p.BlockedBy, want.blocked, slices.Equal) {
		t.Errorf("BlockedBy = %v, want %v", p.BlockedBy, want.blocked)
	}
	for action := range modules["platform"] {
		if p.Known(action) {
			t.Errorf("%s: platform actions are not tenant actions", action)
		}
	}
}

func TestPolicyFunctions(t *testing.T) {
	t.Parallel()
	p := DefaultPolicy()
	if !p.Blocked(aEarningsRead, []string{"therapist", FunctionDriver}) || p.Blocked(aEarningsRead, []string{"therapist"}) {
		t.Error("Blocked: fleet.earnings.read is closed by driver only")
	}
	if !p.Blockable("chat.pdn.read") || p.Blockable(aTripsRead) {
		t.Error("Blockable")
	}
	for action, want := range map[string]string{
		"members.read": ModMembers, "billing.manage": ModModules, "fleet.trips.read": ModLogistics, "weird": "",
	} {
		if got := ModuleOf(action); got != want {
			t.Errorf("ModuleOf(%s) = %q, want %q", action, got, want)
		}
	}
}

// Подключённые модули: ядро всегда (как CORE_MODULES MSW W0.13), остальные — по ключам modules.installations
// (ключ каталога или контракта: logistics и fleet).
func TestInstalledModules(t *testing.T) {
	t.Parallel()
	in := Installed([]string{"fleet", "chat", "nope"})
	for _, m := range []string{ModMembers, ModModules, ModFiles, ModData, ModTasks, ModForms, ModCalendar, ModKnowledge, ModInventory, ModCash, ModLogistics, ModChat} {
		if !in[m] {
			t.Errorf("Installed: %s missing", m)
		}
	}
	if in[ModSpa] || in[ModRepairs] || in["nope"] {
		t.Errorf("Installed: %v", in)
	}
}
