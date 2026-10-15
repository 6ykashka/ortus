package roles

import (
	"errors"
	"fmt"
	"maps"
	"slices"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

func codeOf(err error) string {
	if pe, ok := errors.AsType[*problem.Error](err); ok {
		return pe.Code
	}
	return ""
}

func TestValidateName(t *testing.T) {
	t.Parallel()
	long := strings.Repeat("я", 100)
	for _, tc := range []struct{ in, want string }{{"  Диспетчер Север ", "Диспетчер Север"}, {long, long}} {
		if got, err := validateName(tc.in); err != nil || got != tc.want {
			t.Errorf("%q: %q %v", tc.in, got, err)
		}
	}
	for _, in := range []string{"", "   ", long + "я"} {
		if _, err := validateName(in); codeOf(err) != "validation_failed" {
			t.Errorf("%q: %v", in, err)
		}
	}
}
func TestValidatePermissions(t *testing.T) {
	t.Parallel()
	p := authz.DefaultPolicy()
	if err := validatePermissions(p, []string{}); err != nil {
		t.Errorf("empty role: %v", err)
	}
	if err := validatePermissions(p, []string{"fleet.trips.read", "fleet.earnings.read", "modules.manage"}); err != nil {
		t.Errorf("catalog keys: %v", err)
	}
	for _, perms := range [][]string{{"fleet.weird"}, {"platform.tenants.read"}, {"tasks.read", "tasks.read"}, {"*"}} {
		if err := validatePermissions(p, perms); codeOf(err) != "validation_failed" {
			t.Errorf("%v: %v", perms, err)
		}
	}
}

// Аудит изменения роли: добавленные и снятые права, sensitive и restricted — отдельными списками; уровень записи —
// наибольший из изменённых, не ниже sensitive (изменение доступа).
func TestDiffAndAudit(t *testing.T) {
	t.Parallel()
	added, removed := diff([]string{"a.read", "b.read"}, []string{"b.read", "c.read"})
	if !slices.Equal(added, []string{"c.read"}) || !slices.Equal(removed, []string{"a.read"}) {
		t.Fatalf("diff = %v %v", added, removed)
	}
	d, level := auditDiff("Финансы", []string{"fleet.earnings.read", "roles.assign"}, []string{"tasks.read"})
	want := map[string]any{
		"name": "Финансы", "added": []string{"fleet.earnings.read", "roles.assign"}, "removed": []string{"tasks.read"},
		"sensitive": []string{"roles.assign"}, "restricted": []string{"fleet.earnings.read"},
	}
	if level != "restricted" || !maps.EqualFunc(d, want, func(a, b any) bool { return fmt.Sprint(a) == fmt.Sprint(b) }) {
		t.Errorf("auditDiff = %v %s", d, level)
	}
	if _, level := auditDiff("Чтение", []string{"tasks.read"}, nil); level != "sensitive" {
		t.Errorf("level of a normal change: %s", level)
	}
}
