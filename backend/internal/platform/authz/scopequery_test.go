package authz

import (
	"slices"
	"testing"

	"github.com/google/uuid"
)

const closure = " in (select descendant_id from org.unit_closure where ancestor_id = "

type queryCase struct {
	name     string
	person   uuid.UUID
	action   string
	cols     Columns
	argStart int
	sql      string
	args     []any
}

var vehicles = Columns{Unit: "t.unit_id", Persons: []string{"t.driver_id", "t.created_by"},
	Objects: map[string]string{KindProject: "t.project_id"}}

// scopeQuery: предикат строится только из целых разрешающих грантов действия, до пагинации и агрегации.
func TestScopeQuery(t *testing.T) {
	t.Parallel()
	ev, _ := newWorld(t)
	for _, tc := range []queryCase{
		{"регион с потомками", pRegion, aMembersRead, Columns{Unit: "p.home_unit_id"}, 2,
			"(p.home_unit_id" + closure + "$3))", []any{uMsk}},
		{"подразделение без потомков", pFirmOnly, aVehiclesManage, vehicles, 0, "(t.unit_id = $1)", []any{uMsk}},
		{"две роли: изменять — только Москва-1", pTwoRoles, aVehiclesManage, vehicles, 0,
			"(t.unit_id" + closure + "$1))", []any{uMsk1}},
		{"две роли: читать — Москва-1 или Самара-2", pTwoRoles, aVehiclesRead, vehicles, 0,
			"(t.unit_id" + closure + "$1) or t.unit_id" + closure + "$2))", []any{uMsk1, uSmr2}},
		{"своё", pDriver, aTripsRead, vehicles, 0, "((t.driver_id = $1 or t.created_by = $2))", []any{pDriver, pDriver}},
		{"своё без колонок людей", pDriver, aTripsRead, Columns{Unit: "t.unit_id"}, 0, "false", nil},
		{"PD-53: проект без колонки проекта", pLead, aProjectsRead, Columns{Unit: "t.unit_id"}, 0, "false", nil},
		{"PD-53: проект", pLead, aProjectsRead, vehicles, 0, "(t.project_id = $1)", []any{projFleet}},
		{"владелец", pOwner, aVehiclesRead, vehicles, 0, "true", nil},
		{"организация", pAdmin, aMembersRead, vehicles, 0, "true", nil},
		{"функция driver", pDriver, aEarningsRead, vehicles, 0, "false", nil},
		{"владелец с функцией driver", pOwnerDriver, aEarningsRead, vehicles, 0, "false", nil},
		{"owner_only в роли", pAdmin, aModulesManage, vehicles, 0, "false", nil},
		{"нет действия", pNobody, aVehiclesRead, vehicles, 0, "false", nil},
		{"истёкшие назначения", pExpired, aVehiclesRead, vehicles, 0, "false", nil},
		{"неизвестный вид области", pGalaxy, aVehiclesRead, vehicles, 0, "false", nil},
		{"подразделение без колонки", pRegion, aMembersRead, Columns{}, 0, "false", nil},
	} {
		p, err := ev.ScopeQuery(t.Context(), member(tc.person), tc.action, tc.cols, tc.argStart)
		if err != nil {
			t.Errorf("%s: %v", tc.name, err)
			continue
		}
		if p.SQL != tc.sql || !slices.Equal(p.Args, tc.args) {
			t.Errorf("%s:\n got %s %v\nwant %s %v", tc.name, p.SQL, p.Args, tc.sql, tc.args)
		}
	}
}

// Список доступа объекта сужает предикат всех, кроме владельца.
func TestScopeQueryWithObjectACL(t *testing.T) {
	t.Parallel()
	ev, _ := newWorld(t)
	ev.ACL = fakeACL{}
	p, err := ev.ScopeQuery(t.Context(), member(pReader), aTasksRead, vehicles, 0)
	if err != nil || p.SQL != "(true and t.project_id is distinct from 'restricted')" {
		t.Errorf("reader: %q %v", p.SQL, err)
	}
	if p, err := ev.ScopeQuery(t.Context(), member(pOwner), aTasksRead, vehicles, 0); err != nil || p.SQL != "true" {
		t.Errorf("owner: %q %v", p.SQL, err)
	}
}

func TestScopeQuerySourceFailure(t *testing.T) {
	t.Parallel()
	ev, src := newWorld(t)
	src.err = errBoom
	_, err := ev.ScopeQuery(t.Context(), member(pRegion), aMembersRead, vehicles, 0)
	wantCode(t, "сбой источника", err, codeDep)
}
