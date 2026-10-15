package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// listRolesExample reads api/openapi/examples/listRoles/ok.json: the roles of «Альта» that MSW W0.13 serves.
func listRolesExample(t *testing.T) map[uuid.UUID]struct {
	Name        string   `json:"name"`
	Permissions []string `json:"permissions"`
} {
	t.Helper()
	root, err := os.OpenRoot(filepath.Join("..", "..", "..", "api", "openapi", "examples", "listRoles"))
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	raw, err := root.ReadFile("ok.json")
	if err != nil {
		t.Fatal(err)
	}
	var page struct {
		Items []struct {
			ID          uuid.UUID `json:"id"`
			Name        string    `json:"name"`
			Permissions []string  `json:"permissions"`
		} `json:"items"`
	}
	if err := json.Unmarshal(raw, &page); err != nil {
		t.Fatal(err)
	}
	out := map[uuid.UUID]struct {
		Name        string   `json:"name"`
		Permissions []string `json:"permissions"`
	}{}
	for _, r := range page.Items {
		out[r.ID] = struct {
			Name        string   `json:"name"`
			Permissions []string `json:"permissions"`
		}{r.Name, r.Permissions}
	}
	return out
}

// Роли «Альты» на стенде — те же id, названия и права, что в примере listRoles, который отдаёт MSW (П-14:
// «каталог прав ролей на стенде»).
func TestAccessRolesMatchExample(t *testing.T) {
	t.Parallel()
	example := listRolesExample(t)
	a := accessOf(protoAlta)
	if len(a.roles) != len(example) {
		t.Fatalf("alta roles = %d, example = %d", len(a.roles), len(example))
	}
	for _, r := range a.roles {
		ex, ok := example[seedID(protoAlta, r.proto)]
		switch {
		case !ok:
			t.Errorf("role %s (%s): no example role with id %s", r.proto, r.name, seedID(protoAlta, r.proto))
		case ex.Name != r.name || !slices.Equal(ex.Permissions, r.actions):
			t.Errorf("role %s: %q %v\nwant %q %v", r.proto, r.name, r.actions, ex.Name, ex.Permissions)
		}
	}
}

// Группы и назначения «Альты» и «Лотоса» — как в mock-data.js 14.10; назначение «через группу» принадлежит группе
// (adapter W0.13, project.ts assignments()).
func TestAccessMatchesPrototype(t *testing.T) {
	t.Parallel()
	lotos, base := mockData(t)
	re := `\{ id: '([a-z0-9]+)', member: '(m-[a-z]+)', role: '(r-[a-z]+)', scope: \{ type: '([a-z]+)'(?:, id: '([a-z-]+)')? \}(?:, via: '[^']*«([^»]+)»')? \}`
	for _, tc := range []struct {
		tenant, text string
	}{{protoAlta, base}, {protoLotos, lotos}} {
		a := accessOf(tc.tenant)
		var want, got []string
		for _, m := range matches(re, tc.text) {
			principal := m[2]
			if m[6] != "" {
				principal = "group:" + groupByName(t, a, m[6])
			}
			scope := m[4]
			if scope == "firm" || scope == "region" { // одна область «подразделение» (scopeOf адаптера W0.13)
				scope = scopeUnit
			}
			want = append(want, strings.Join([]string{m[1], principal, m[3], scope, m[5]}, "|"))
		}
		for _, as := range a.assignments {
			got = append(got, strings.Join([]string{as.proto, as.principal, as.role, as.scope, as.ref}, "|"))
		}
		equalSets(t, tc.tenant+" assignments", got, want)
		if len(want) == 0 {
			t.Fatalf("%s: no assignments parsed", tc.tenant)
		}
	}
	var groups []string
	for _, m := range matches(`\{ id: '(g-[a-z]+)', name: '([^']+)', members: \[([^\]]*)\] \}`, base) {
		groups = append(groups, m[1]+"|"+m[2]+"|"+strings.ReplaceAll(strings.ReplaceAll(m[3], "'", ""), " ", ""))
	}
	var gotGroups []string
	for _, g := range accessOf(protoAlta).groups {
		gotGroups = append(gotGroups, g.proto+"|"+g.name+"|"+strings.Join(g.members, ","))
	}
	equalSets(t, "alta groups", gotGroups, groups)
}

func groupByName(t *testing.T, a access, name string) string {
	t.Helper()
	for _, g := range a.groups {
		if g.name == name {
			return g.proto
		}
	}
	t.Fatalf("no group %q", name)
	return ""
}

// Каждое назначение ссылается на роль, участника или группу и область своей организации; подключённые модули —
// как в сиде 14.10 (SPA; логистика и ремонт выключены).
func TestAccessIsConsistent(t *testing.T) {
	t.Parallel()
	for _, td := range tenantDBs() {
		a := accessOf(td.tenant.proto)
		roles := map[string]bool{}
		for _, r := range a.roles {
			roles[r.proto] = true
		}
		for _, as := range a.assignments {
			if !roles[as.role] {
				t.Errorf("%s %s: unknown role %s", td.tenant.proto, as.proto, as.role)
			}
			if group, ok := strings.CutPrefix(as.principal, "group:"); ok {
				if !slices.ContainsFunc(a.groups, func(g groupDef) bool { return g.proto == group }) {
					t.Errorf("%s %s: unknown group %s", td.tenant.proto, as.proto, group)
				}
			} else if _, ok := td.member(as.principal); !ok {
				t.Errorf("%s %s: unknown member %s", td.tenant.proto, as.proto, as.principal)
			}
		}
		if !slices.Equal(a.modules, []string{"spa"}) {
			t.Errorf("%s modules = %v, want [spa]", td.tenant.proto, a.modules)
		}
	}
	// Проект «fleet» прототипа — id области «проект» примеров getMyContext (manager, driver).
	if got := seedID(protoAlta, "fleet").String(); got != "1380e888-13ac-5357-9a6f-a592a20e8220" {
		t.Errorf("project fleet id = %s", got)
	}
}
