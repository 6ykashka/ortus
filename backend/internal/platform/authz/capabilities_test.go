package authz

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

func capKeys(gs []tenantctx.Grant) []string {
	out := make([]string, 0, len(gs))
	for _, g := range gs {
		ref := ""
		if g.ScopeRef != nil {
			ref = g.ScopeRef.String()
		}
		out = append(out, g.Action+"|"+g.ScopeKind+"|"+ref)
	}
	return out
}

// examplePermissions reads the permissions of an example of getMyContext (what MSW of W0.13 answers).
func examplePermissions(t *testing.T, persona string) []string {
	t.Helper()
	root, err := os.OpenRoot(filepath.Join("..", "..", "..", "..", "api", "openapi", "examples", "getMyContext"))
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	raw, err := root.ReadFile(persona + ".json")
	if err != nil {
		t.Fatal(err)
	}
	var me struct {
		Tenants []struct {
			Capabilities []struct {
				Permission string `json:"permission"`
			} `json:"capabilities"`
		} `json:"tenants"`
	}
	if err := json.Unmarshal(raw, &me); err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, c := range me.Tenants[0].Capabilities {
		out = append(out, c.Permission)
	}
	return out
}

// П-14 критики этапа 0: владелец «Альты» — 59 возможностей в mock (действия ядра и подключённого SPA, без чатов),
// а не 114 (все действия каталога). «Альта» сида 14.10: подключён только SPA.
func TestCapabilitiesOwnerMatchesMock(t *testing.T) {
	t.Parallel()
	ev, _ := newWorld(t)
	got, err := ev.Capabilities(t.Context(), member(pOwner))
	if err != nil {
		t.Fatal(err)
	}
	want := examplePermissions(t, "owner")
	var actions []string
	for _, g := range got {
		if g.ScopeKind != KindTenant || g.ScopeRef != nil {
			t.Errorf("owner capability %v: want the tenant scope", g)
		}
		actions = append(actions, g.Action)
	}
	slices.Sort(want)
	if !slices.Equal(actions, want) {
		t.Errorf("owner capabilities (%d):\n got %v\nwant %v (%d)", len(actions), actions, want, len(want))
	}
}

// Модули владельца: логистика подключена — её действия появляются; функция driver закрывает начисления.
func TestCapabilitiesOwnerModulesAndFunction(t *testing.T) {
	t.Parallel()
	ev, src := newWorld(t)
	src.modules = []string{"logistics", "unknown-module"}
	got, err := ev.Capabilities(t.Context(), member(pOwner))
	if err != nil {
		t.Fatal(err)
	}
	keys := capKeys(got)
	for _, want := range []string{aVehiclesRead + "|tenant|", aEarningsRead + "|tenant|", aMembersRead + "|tenant|"} {
		if !slices.Contains(keys, want) {
			t.Errorf("owner with logistics: no %s", want)
		}
	}
	for _, k := range keys {
		if strings.HasPrefix(k, "spa.") || strings.HasPrefix(k, "chat.") || strings.HasPrefix(k, "repairs.") {
			t.Errorf("owner: %s of a module that is not installed", k)
		}
	}
	got, err = ev.Capabilities(t.Context(), member(pOwnerDriver))
	if err != nil {
		t.Fatal(err)
	}
	if slices.Contains(capKeys(got), aEarningsRead+"|tenant|") {
		t.Error("owner with the driver function must not get fleet.earnings.read")
	}
}

// Участник: действия действующих грантов с их областью; без закрытых функцией, owner_only, истёкших и
// неизвестных видов; повторы схлопываются.
func TestCapabilitiesOfMembers(t *testing.T) {
	t.Parallel()
	ev, src := newWorld(t)
	s := src.subjects[pDriver]
	s.Grants = append(s.Grants, grant(driverRole, KindSelf, uuid.Nil, false)) // повтор той же роли
	src.subjects[pDriver] = s
	for _, tc := range []struct {
		person    uuid.UUID
		want, not []string
	}{
		{pDriver, []string{aTripsRead + "|self|", aVehiclesRead + "|self|"}, []string{aEarningsRead + "|unit|" + uMsk1.String()}},
		{pLead, []string{aProjectsManage + "|project|" + projFleet.String()}, nil},
		{pTwoRoles, []string{aVehiclesManage + "|unit|" + uMsk1.String(), aVehiclesRead + "|unit|" + uSmr2.String()},
			[]string{aVehiclesManage + "|unit|" + uSmr2.String()}},
		{pAdmin, []string{aMembersManage + "|tenant|", aBillingRead + "|tenant|"},
			[]string{aModulesManage + "|tenant|", aBillingManage + "|tenant|"}},
		{pExpired, nil, []string{aVehiclesRead + "|unit|" + uMsk1.String(), aVehiclesRead + "|unit|" + uMsk2.String()}},
		{pGalaxy, nil, []string{aVehiclesRead + "|galaxy|" + uMsk1.String()}},
	} {
		got, err := ev.Capabilities(t.Context(), member(tc.person))
		if err != nil {
			t.Fatal(err)
		}
		keys := capKeys(got)
		for _, w := range tc.want {
			if !slices.Contains(keys, w) {
				t.Errorf("%s: no %s in %v", tc.person, w, keys)
			}
		}
		for _, n := range tc.not {
			if slices.Contains(keys, n) {
				t.Errorf("%s: unexpected %s", tc.person, n)
			}
		}
		seen := map[string]bool{}
		for _, k := range keys {
			if seen[k] {
				t.Errorf("%s: duplicate capability %s", tc.person, k)
			}
			seen[k] = true
		}
	}
}

func TestCapabilitiesSourceFailure(t *testing.T) {
	t.Parallel()
	ev, src := newWorld(t)
	src.err = errBoom
	for _, p := range []uuid.UUID{pOwner, pRegion} {
		if _, err := ev.Capabilities(t.Context(), member(p)); !errors.Is(err, errBoom) || !problem.Is(err, codeDep) {
			t.Errorf("%s: %v, want dependency_unavailable wrapping the source error", p, err)
		}
	}
}
