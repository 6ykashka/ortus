package explain

import (
	"testing"

	"github.com/google/uuid"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
)

// failedCheck runs the step «permission» (and «resource-scope») of explainAccess and returns the failed check.
func failedCheck(x authz.Explanation, r request, seen map[uuid.UUID]bool) (step accessapi.AccessCheckStep, detail string) {
	(&Handler{}).permission(x, r, seen,
		func(s accessapi.AccessCheckStep, _ string, d string) { step, detail = s, d },
		func(accessapi.AccessCheckStep, string) {})
	return step, detail
}

// Причина отказа при совпавшем гранте: с объектом — объект закрыт своими настройками; запрос без объекта — отказ
// дало правило действия («не автор»). Владелец бизнеса в закрытом проекте без роли в нём (TP-03) — своя причина,
// как в projCan («закрытый проект — нужна роль в самом проекте»).
func TestPermissionRefusalDetails(t *testing.T) {
	t.Parallel()
	id := uuid.New()
	seen := map[uuid.UUID]bool{id: true}
	matched := authz.Explanation{Grants: []authz.GrantVerdict{{Grant: authz.Grant{AssignmentID: id}, Matches: true}}}
	project := uuid.New()
	object := request{object: &accessapi.ObjectRef{ModuleKey: "tasks", EntityType: "project", EntityId: project},
		resource: authz.Resource{Objects: map[string]uuid.UUID{authz.KindProject: project}}}
	unit := request{resource: authz.Resource{Unit: uuid.New()}}
	for _, tc := range []struct {
		name   string
		x      authz.Explanation
		r      request
		step   accessapi.AccessCheckStep
		detail string
	}{
		{"грант совпал, объект закрыт", matched, object, accessapi.ResourceScope, detailClosed},
		{"грант совпал, без объекта — правило", matched, request{}, accessapi.Permission, detailRuled},
		{"грант совпал, только подразделение — правило", matched, unit, accessapi.ResourceScope, detailRuled},
		{"владелец в закрытом проекте", authz.Explanation{Owner: true, OwnerShut: true}, object, accessapi.ResourceScope,
			detailOwnerClosed},
	} {
		step, detail := failedCheck(tc.x, tc.r, seen)
		if step != tc.step || detail != tc.detail {
			t.Errorf("%s: %s %q, want %s %q", tc.name, step, detail, tc.step, tc.detail)
		}
	}
}
