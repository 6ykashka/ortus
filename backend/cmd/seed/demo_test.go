package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// `seed demo` is the one argument cmd/seed takes (W2.90): it needs the same environment as the base seed; any other
// argument is refused as before.
func TestRunTakesTheDemoArgument(t *testing.T) {
	t.Parallel()
	empty := func(string) string { return "" }
	for _, tc := range []struct {
		args []string
		want string
	}{
		{[]string{demoArg}, "MIGRATOR_DB_URL is not set"},
		{[]string{"demos"}, `unexpected argument "demos"`},
		{[]string{demoArg, "now"}, `unexpected argument "demo"`},
	} {
		var out, errOut bytes.Buffer
		code := run(t.Context(), tc.args, empty, &out, &errOut)
		if code != exitConfig || !strings.Contains(errOut.String(), tc.want) {
			t.Errorf("run %v: code %d, stderr %q; want %d and %q", tc.args, code, errOut.String(), exitConfig, tc.want)
		}
	}
}

// The demo of the stand is the preset logistics-ready of MSW (adapter/src/msw/core/presets.ts): «Логистика» is on,
// Марина Котова is «Менеджер логистики» of «Север Логистик» with its subtree, under the id of the preset.
func TestDemoIsTheLogisticsPreset(t *testing.T) {
	t.Parallel()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "frontend", "packages", "adapter", "src", "msw", "core", "presets.ts"))
	if err != nil {
		t.Fatal(err)
	}
	preset := string(b)
	for _, want := range []string{
		"seedUuid('" + kotovaManager.scope + "', '" + kotovaManager.proto + "')",
		"const kotova = A('" + kotovaManager.member + "')",
		"roleId: A('" + kotovaManager.role + "')",
		"resourceIds: [A('" + kotovaManager.unit + "')], includeDescendants: true",
	} {
		if !strings.Contains(preset, want) {
			t.Errorf("presets.ts lacks %q", want)
		}
	}
	// Golden vector (Node crypto, UUID v5 of «ortus:t-alta:preset:a-kotova-manager»).
	if got := kotovaManager.id(); got != uuid.MustParse("0d3b60b3-38c9-5b53-8bfe-493cc1ec5a27") {
		t.Errorf("assignment id %s", got)
	}
	if kotova, _ := alta.member(kotovaManager.member); kotova.name != "Марина Котова" || kotovaManager.role != roleManager.proto || kotovaManager.unit != homeAlta {
		t.Errorf("grant %+v, want Котова · %s · %s", kotovaManager, roleManager.name, homeAlta)
	}
	c, err := os.ReadFile(filepath.Join("..", "..", "..", "frontend", "packages", "adapter", "src", "msw", "core", "catalog.ts"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(c), "fleet: '"+demoModule+"'") || demoModule == "" {
		t.Errorf("stored key of «Логистика» %q is not INSTALLABLE.fleet of catalog.ts", demoModule)
	}
}
