package operators

import (
	"maps"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// W4.60 (Q-W4.07-14, Q-W4.07-18): права ролей операторов Go — те же, что PLATFORM_GRANTS сценарного сервера
// (frontend/packages/adapter/src/msw/platform/roles.ts) и описание PlatformOperator.role контракта 0.8.0-stage4.
func TestGrantsMatchMSW(t *testing.T) {
	t.Parallel()
	root, err := os.OpenRoot(filepath.Join("..", "..", "..", "..", "..", "frontend", "packages", "adapter", "src", "msw", "platform"))
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	raw, err := root.ReadFile("roles.ts")
	if err != nil {
		t.Fatal(err)
	}
	all := []string{RoleOwner, RoleAdmin, RoleBilling, RoleSupport}
	entry := regexp.MustCompile(`'(platform\.[a-z_.]+)':\s*(ALL|\[([^\]]*)\])`)
	msw := map[string][]string{}
	for _, m := range entry.FindAllStringSubmatch(string(raw), -1) {
		roles := all
		if m[2] != "ALL" {
			roles = nil
			for r := range strings.SplitSeq(m[3], ",") {
				if r = strings.Trim(strings.TrimSpace(r), `'"`); r != "" {
					roles = append(roles, r)
				}
			}
		}
		msw[m[1]] = roles
	}
	if len(msw) != 9 {
		t.Fatalf("PLATFORM_GRANTS: %d rights parsed, want 9: %v", len(msw), slices.Sorted(maps.Keys(msw)))
	}
	for perm, roles := range msw {
		for _, role := range all {
			if got, want := Allowed(role, perm), slices.Contains(roles, role); got != want {
				t.Errorf("%s %s: Go %v, MSW %v", role, perm, got, want)
			}
		}
	}
	for perm := range grants {
		if _, ok := msw[perm]; !ok {
			t.Errorf("Go grants %s, PLATFORM_GRANTS does not", perm)
		}
	}
}

// W4.60: шлюз /platform/** пускает операцию, если роль даёт её x-permissions (x-permissions-mode all | any).
func TestAllowedAll(t *testing.T) {
	t.Parallel()
	for name, c := range map[string]struct {
		role  string
		perms []string
		mode  string
		want  bool
	}{
		"поддержка читает организации":       {RoleSupport, []string{PermTenantsRead}, "all", true},
		"поддержка не видит заявки":          {RoleSupport, []string{PermBillingRead}, "all", false},
		"биллинг решает заявки":              {RoleBilling, []string{PermBillingManage}, "all", true},
		"биллинг не приглашает операторов":   {RoleBilling, []string{PermOperatorsManage}, "all", false},
		"поддержка блокирует вход":           {RoleSupport, []string{PermUsersManage}, "all", true},
		"администратор создаёт организации":  {RoleAdmin, []string{PermTenantsCreate}, "all", true},
		"все права — нужны все":              {RoleBilling, []string{PermTenantsRead, PermPricingManage}, "all", false},
		"любое из прав":                      {RoleBilling, []string{PermTenantsRead, PermPricingManage}, "any", true},
		"режим по умолчанию — все":           {RoleSupport, []string{PermTenantsRead, PermBillingRead}, "", false},
		"без прав операция закрыта":          {RoleOwner, nil, "all", false},
		"неизвестная роль":                   {"intruder", []string{PermTenantsRead}, "all", false},
		"владелец управляет операторами":     {RoleOwner, []string{PermOperatorsManage}, "all", true},
		"администратор не управляет ими":     {RoleAdmin, []string{PermOperatorsManage}, "all", false},
		"администратор публикует сетку":      {RoleAdmin, []string{PermPricingManage}, "all", true},
		"поддержка не публикует сетку":       {RoleSupport, []string{PermPricingManage}, "all", false},
		"биллинг читает сетку и заявки":      {RoleBilling, []string{PermBillingRead}, "all", true},
		"администратор читает каталог людей": {RoleAdmin, []string{PermUsersRead}, "all", true},
	} {
		if got := AllowedAll(c.role, c.perms, c.mode); got != c.want {
			t.Errorf("%s: %v, want %v", name, got, c.want)
		}
	}
}

// W4.60: детали строк журнала шага 4.6 (заявка, тариф, срок, версия сетки, роль оператора) видны оператору.
func TestPublicDetailsW460(t *testing.T) {
	t.Parallel()
	raw := []byte(`{"request": "SR-12", "tier": "biz", "termMonths": "12", "version": "3", "effectiveFrom": "2026-11-01",
		"role": "support", "from": "billing", "to": "admin", "comment": "Открываем второй салон"}`)
	want := map[string]string{
		"request": "SR-12", "tier": "biz", "termMonths": "12", "version": "3", "effectiveFrom": "2026-11-01", "role": "support",
		"from": "billing", "to": "admin",
	}
	if got := PublicDetails(raw); !maps.Equal(got, want) {
		t.Errorf("details %v, want %v", got, want)
	}
}
