package authz

import (
	"slices"
	"testing"

	"github.com/google/uuid"
)

func verdicts(x Explanation) []string {
	var out []string
	for _, v := range x.Grants {
		out = append(out, v.Grant.Scope.Kind+":"+v.Mismatch)
	}
	slices.Sort(out)
	return out
}

// «Почему доступно» (S1-14, explainAccess W1.06): причина несовпадения каждого гранта с действием — в терминах
// GrantExplanation.mismatch контракта; объектный грант без объекта — object_scope_without_object (PD-53).
func TestExplain(t *testing.T) {
	t.Parallel()
	ev, _ := newWorld(t)
	project := func(id uuid.UUID) Resource { return Resource{Objects: map[string]uuid.UUID{KindProject: id}} }
	for _, tc := range []struct {
		name    string
		person  uuid.UUID
		action  string
		r       Resource
		allowed bool
		want    []string
	}{
		{"две роли: читать в Самара-2", pTwoRoles, aVehiclesRead, inUnit(uSmr2, ""), true, []string{"unit:", "unit:out_of_scope"}},
		{"две роли: изменить в Москва-2", pTwoRoles, aVehiclesManage, inUnit(uMsk2, ""), false, []string{"unit:out_of_scope"}},
		{"PD-53: без объекта", pLead, aProjectsManage, Resource{}, false, []string{"project:object_scope_without_object"}},
		{"PD-53: другой проект", pLead, aProjectsManage, project(projOther), false, []string{"project:other_object"}},
		{"PD-53: свой проект", pLead, aProjectsManage, project(projFleet), true, []string{"project:"}},
		{"функция driver", pDriver, aEarningsRead, inUnit(uMsk1, ""), false, []string{"unit:function_blocked"}},
		{"нет действия", pNobody, aVehiclesRead, Resource{}, false, nil},
	} {
		x, err := ev.Explain(t.Context(), member(tc.person), tc.action, tc.r)
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if x.Allowed != tc.allowed || !slices.Equal(verdicts(x), tc.want) {
			t.Errorf("%s: allowed %v %v, want %v %v", tc.name, x.Allowed, verdicts(x), tc.allowed, tc.want)
		}
		for _, v := range x.Grants {
			if v.Matches != (v.Mismatch == "") {
				t.Errorf("%s: Matches %v with mismatch %q", tc.name, v.Matches, v.Mismatch)
			}
		}
	}
	x, err := ev.Explain(t.Context(), member(pOwner), aModulesManage, Resource{})
	if err != nil || !x.Allowed || !x.Owner {
		t.Errorf("owner: %+v %v", x, err)
	}
}

// Решение и вердикты грантов считаются по одному чтению субъекта: между двумя чтениями назначения могут измениться,
// и Allowed разошёлся бы с вердиктами (и каждый вызов делал бы лишние запросы к tenant DB).
func TestExplainReadsSubjectOnce(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name   string
		person uuid.UUID
		action string
		r      Resource
	}{
		{"участник, разрешено", pTwoRoles, aVehiclesManage, inUnit(uMsk1, aVehiclesRead)},
		{"участник, отказ", pTwoRoles, aVehiclesManage, inUnit(uSmr2, aVehiclesRead)},
		{"функция driver", pDriver, aEarningsRead, inUnit(uMsk1, aTripsRead)},
		{"владелец, закрываемое функцией действие", pOwnerDriver, aEarningsRead, inUnit(uMsk1, "")},
	} {
		ev, src := newWorld(t)
		if _, err := ev.Explain(t.Context(), member(tc.person), tc.action, tc.r); err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if src.calls != 1 {
			t.Errorf("%s: %d source calls, want 1", tc.name, src.calls)
		}
	}
}

// Неизвестное действие Explain объясняет отказом, как Permit (fail-closed).
func TestExplainUnknownAction(t *testing.T) {
	t.Parallel()
	ev, _ := newWorld(t)
	x, err := ev.Explain(t.Context(), member(pOwner), "fleet.teleport", Resource{})
	if err != nil || x.Allowed {
		t.Errorf("unknown action: allowed %v, err %v; want denied", x.Allowed, err)
	}
}

func TestExplainSourceFailure(t *testing.T) {
	t.Parallel()
	ev, src := newWorld(t)
	src.err = errBoom
	_, err := ev.Explain(t.Context(), member(pRegion), aMembersRead, Resource{})
	wantCode(t, "сбой источника", err, codeDep)
}
