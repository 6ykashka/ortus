package modulesreg

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

// example reads api/openapi/examples/<op>/<name>.json.
func example(t *testing.T, op, name string) []byte {
	t.Helper()
	root, err := os.OpenRoot(filepath.Join("..", "..", "..", "..", "api", "openapi", "examples", op))
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	raw, err := root.ReadFile(name + ".json")
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// normalized re-encodes JSON so that key order and spacing do not matter.
func normalized(t *testing.T, raw []byte) string {
	t.Helper()
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	out, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

// Манифест «Логистики» = пример setModuleInstallation/ok (manifestDto MSW W0.13): имя и зависимости из каталога,
// права в порядке каталога с подписью, видами областей контракта и чувствительностью.
func TestManifestMatchesExample(t *testing.T) {
	t.Parallel()
	m, ok := Manifest("fleet", StateActive, 2)
	if !ok {
		t.Fatal("fleet: no manifest")
	}
	got, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	if want := normalized(t, example(t, "setModuleInstallation", "ok")); normalized(t, got) != want {
		t.Errorf("manifest fleet:\n got %s\nwant %s", got, want)
	}
}

func TestManifests(t *testing.T) {
	t.Parallel()
	if got := InstallableKeys(); !slices.Equal(got, []string{"fleet", "spa", "repairs"}) {
		t.Errorf("InstallableKeys = %v", got)
	}
	if got := CoreKeys(); !slices.Equal(got, []string{"tasks", "forms", "calendar", "knowledge", "files", "data", "inventory", "cash"}) {
		t.Errorf("CoreKeys = %v", got)
	}
	checkManifest(t, "fleet", "Логистика", []string{"calendar", "files", "forms"}, 23) // W2.71: + fleet.reservations.choose
	checkManifest(t, "spa", "Салон и SPA", []string{"calendar", "forms", "inventory", "cash"}, 6)
	checkManifest(t, "repairs", "Ремонт и стройка", []string{"files", "tasks"}, 21) // W6.00: + 7 ключей этапа 6
	for _, key := range []string{"tasks", "logistics", "", "chat"} {
		if _, ok := Manifest(key, StateActive, 1); ok {
			t.Errorf("Manifest(%q): only installable modules have manifests", key)
		}
	}
}

func checkManifest(t *testing.T, key, name string, deps []string, permissions int) {
	t.Helper()
	m, ok := Manifest(key, StateUninstalled, 1)
	if !ok || m.Name != name || !slices.Equal(m.Dependencies, deps) || len(m.Permissions) != permissions ||
		m.Version != "1.0.0" || string(m.State) != StateUninstalled || m.Revision != 1 || m.Datasets == nil {
		t.Errorf("%s: %+v", key, m)
	}
	for _, p := range m.Permissions {
		if p.ModuleKey != key || p.Description == "" || len(p.AllowedScopeKinds) == 0 {
			t.Errorf("%s: permission %+v", key, p)
		}
	}
}

// Ключ module_key: ключ контракта; ключи каталога logistics и repair (фикстуры W1.04) — синонимы.
func TestCanonical(t *testing.T) {
	t.Parallel()
	for stored, want := range map[string]string{
		"fleet": "fleet", "logistics": "fleet", "spa": "spa", "repairs": "repairs", "repair": "repairs", "forms": "forms",
		"tasks": "tasks",
	} {
		if got, ok := Canonical(stored); !ok || got != want {
			t.Errorf("Canonical(%q) = %q, %v; want %q", stored, got, ok, want)
		}
	}
	for _, stored := range []string{"", "chat", "platform", "FLEET"} {
		if got, ok := Canonical(stored); ok {
			t.Errorf("Canonical(%q) = %q: unknown key", stored, got)
		}
	}
	if !IsInstallable("spa") || IsInstallable("tasks") || IsInstallable("logistics") {
		t.Error("IsInstallable")
	}
}

func TestModuleOfAction(t *testing.T) {
	t.Parallel()
	for key, want := range map[string]string{
		"members.read": "members", "roles.assign": "members", "org_units.manage": "members", "modules.read": "modules",
		"billing.manage": "modules", "fleet.trips.read": "fleet", "spa.services.read": "spa", "tasks.read": "tasks",
		"calendar.bookings.read": "calendar", "repairs.projects.read": "repairs",
	} {
		if got := ModuleOfAction(key); got != want {
			t.Errorf("ModuleOfAction(%s) = %q, want %q", key, got, want)
		}
	}
}

// Каталог: все модули организации без платформы, у каждого действия есть уровень и подпись.
func TestCatalog(t *testing.T) {
	t.Parallel()
	mods := Catalog()
	if len(mods) != 16 { // + core.docs и core.service (W7.00)
		t.Fatalf("Catalog: %d modules", len(mods))
	}
	seen := map[string]bool{}
	for _, m := range mods {
		if m.Key == "platform" || m.Label == "" || len(m.Actions) == 0 {
			t.Errorf("module %+v", m)
		}
		for _, a := range m.Actions {
			if seen[a.Key] || a.Label == "" || a.Level == "" || len(a.Scopes) == 0 {
				t.Errorf("action %+v", a)
			}
			seen[a.Key] = true
		}
	}
}
