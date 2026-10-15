package main

// W1.08: манифесты модулей строятся из таблицы каталога прав в modulesreg (internal/modules запрещено читать YAML —
// depguard). Здесь таблица сверяется с api/permissions.yaml: стюард меняет каталог — тест краснеет.

import (
	"os"
	"path/filepath"
	"slices"
	"testing"

	"go.yaml.in/yaml/v3"

	"github.com/ortus/ortus-crm/backend/internal/modules/modulesreg"
)

func TestCatalogMatchesPermissions(t *testing.T) {
	t.Parallel()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "api", "permissions.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	var doc yaml.Node
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	want := catalogFromYAML(t, &doc)
	got := modulesreg.Catalog()
	if len(got) != len(want) {
		t.Fatalf("modules: got %d, want %d", len(got), len(want))
	}
	for i, w := range want {
		g := got[i]
		if g.Key != w.Key || g.Label != w.Label || !slices.Equal(g.DependsOn, w.DependsOn) {
			t.Errorf("module %d: got %s %q %v, want %s %q %v", i, g.Key, g.Label, g.DependsOn, w.Key, w.Label, w.DependsOn)
			continue
		}
		if !slices.EqualFunc(g.Actions, w.Actions, func(a, b modulesreg.Action) bool {
			return a.Key == b.Key && a.Label == b.Label && a.Level == b.Level && a.Sensitivity == b.Sensitivity &&
				slices.Equal(a.Scopes, b.Scopes)
		}) {
			t.Errorf("%s actions:\n got %+v\nwant %+v", w.Key, g.Actions, w.Actions)
		}
	}
}

// catalogFromYAML reads modules in document order (a map would lose the order of the manifest permissions).
func catalogFromYAML(t *testing.T, doc *yaml.Node) []modulesreg.CatalogModule {
	t.Helper()
	modules := mapValue(doc.Content[0], "modules")
	if modules == nil {
		t.Fatal("permissions.yaml: no modules")
	}
	var out []modulesreg.CatalogModule
	for i := 0; i+1 < len(modules.Content); i += 2 {
		key, body := modules.Content[i].Value, modules.Content[i+1]
		if key == "platform" {
			continue
		}
		m := modulesreg.CatalogModule{Key: key, DependsOn: []string{}}
		if n := mapValue(body, "label"); n != nil {
			m.Label = n.Value
		}
		if n := mapValue(body, "depends_on"); n != nil {
			if err := n.Decode(&m.DependsOn); err != nil {
				t.Fatal(err)
			}
		}
		actions := mapValue(body, "actions")
		for j := 0; actions != nil && j+1 < len(actions.Content); j += 2 {
			var a struct {
				Label, Level, Sensitivity string
				Scopes                    []string
			}
			if err := actions.Content[j+1].Decode(&a); err != nil {
				t.Fatal(err)
			}
			if a.Sensitivity == "" {
				a.Sensitivity = "normal"
			}
			m.Actions = append(m.Actions, modulesreg.Action{
				Key: actions.Content[j].Value, Label: a.Label, Level: a.Level, Scopes: a.Scopes, Sensitivity: a.Sensitivity,
			})
		}
		out = append(out, m)
	}
	return out
}

func mapValue(n *yaml.Node, key string) *yaml.Node {
	if n == nil || n.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(n.Content); i += 2 {
		if n.Content[i].Value == key {
			return n.Content[i+1]
		}
	}
	return nil
}
