package main

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// Контрольные векторы PD-30 (UUID v5, NameSpaceURL, «ortus:<область>:<id>»), посчитаны независимо
// (Node crypto, SHA-1 по RFC 4122) — для паритета с TS-сидом W0.12.
func TestSeedIDGoldenVectors(t *testing.T) {
	t.Parallel()
	cases := []struct{ scope, proto, want string }{
		{scopePlatform, "t-alta", "f04f636e-b66d-509e-ae10-9c27a18e3baa"},
		{scopePlatform, "t-lotos", "e4f2195f-f5a3-5f61-98be-f6ed76ea565a"},
		{scopePlatform, "acc-1", "0281a55e-725e-53b1-920f-4189ab46e08a"},
		{"t-alta", "m-owner", "b8df06ec-317e-5f46-b54c-e76603e41b5b"},
		{"t-lotos", "m-owner", "12d3a0fa-563f-5206-8f97-b955588350fa"},
		{"t-alta", "f-msk-sever", "6de355d2-b019-5bb6-b66a-ddae6a13fb65"},
	}
	for _, tc := range cases {
		if got := seedID(tc.scope, tc.proto); got != uuid.MustParse(tc.want) {
			t.Errorf("seedID(%q, %q) = %s, want %s", tc.scope, tc.proto, got, tc.want)
		}
	}
}

// mockData reads design/ortus/mock-data.js and splits it into the «Лотос» part and the base seed («Альта»,
// платформа): идентификаторы участников «Лотоса» намеренно совпадают с «Альтой» (mock-data.js:41).
func mockData(t *testing.T) (lotos, base string) {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "design", "ortus", "mock-data.js"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(b)
	i, j := strings.Index(text, "export function seedLotos("), strings.Index(text, "function baseSeed()")
	if i < 0 || j < i {
		t.Fatal("mock-data.js: seedLotos/baseSeed not found")
	}
	return text[i:j], text[j:]
}

func matches(re, text string) [][]string {
	return regexp.MustCompile(re).FindAllStringSubmatch(text, -1)
}

func sorted(s []string) []string {
	out := append([]string(nil), s...)
	sort.Strings(out)
	return out
}

func equalSets(t *testing.T, what string, got, want []string) {
	t.Helper()
	if strings.Join(sorted(got), ",") != strings.Join(sorted(want), ",") {
		t.Errorf("%s:\n got %v\nwant %v", what, sorted(got), sorted(want))
	}
}

// Организации каталога оператора — те же id, названия и статусы (restricted → read_only, PLAT-02).
func TestTenantsMatchPrototype(t *testing.T) {
	t.Parallel()
	_, base := mockData(t)
	state := map[string]string{"trial": "trial", "active": "active", "restricted": "read_only", "suspended": "suspended"}
	var want []string
	for _, m := range matches(`\{ id: '(t-[a-z]+)', name: '([^']+)', owner: '[^']+', status: '([a-z]+)'`, base) {
		want = append(want, m[1]+"|"+m[2]+"|"+state[m[3]])
	}
	var got []string
	for _, tn := range tenants {
		got = append(got, tn.proto+"|"+tn.name+"|"+tn.state)
	}
	equalSets(t, "tenants", got, want)
	if len(want) != 4 {
		t.Fatalf("prototype tenants parsed: %d, want 4", len(want))
	}
}

// Аккаунты каталога: id, имя, почта, MFA (fillAccounts-аккаунты acc-g* — генерируемые, не в скелете).
func TestAccountsMatchPrototype(t *testing.T) {
	t.Parallel()
	_, base := mockData(t)
	var want []string
	for _, m := range matches(`\{ id: '(acc-\d+)', name: '([^']+)', email: '([^']+)', status: '([a-z]+)', mfa: (true|false)`, base) {
		want = append(want, strings.Join(m[1:], "|"))
	}
	var got []string
	for _, a := range accounts {
		mfa := "false"
		if a.mfa {
			mfa = "true"
		}
		got = append(got, strings.Join([]string{a.proto, a.name, a.email, a.protoStatus, mfa}, "|"))
	}
	equalSets(t, "accounts", got, want)
	if len(want) != 13 {
		t.Fatalf("prototype accounts parsed: %d, want 13", len(want))
	}
}

func TestOperatorsMatchPrototype(t *testing.T) {
	t.Parallel()
	_, base := mockData(t)
	var want []string
	for _, m := range matches(`\{ id: '(op-\d+)', name: '([^']+)', email: '([^']+)', role: '([a-z]+)', status: '([a-z]+)'`, base) {
		want = append(want, strings.Join(m[1:], "|"))
	}
	var got []string
	for _, o := range operators {
		got = append(got, strings.Join([]string{o.proto, o.name, o.email, o.role, o.status}, "|"))
	}
	equalSets(t, "operators", got, want)
	if len(want) != 6 {
		t.Fatalf("prototype operators parsed: %d, want 6", len(want))
	}
}

// «Альта»: 3 региона × 4 фирмы (14-engineering «Окружения»), участники с должностью и функцией.
func TestAltaMatchesPrototype(t *testing.T) {
	t.Parallel()
	_, base := mockData(t)
	var wantUnits []string
	for _, m := range matches(`\{ id: '(r-[a-z]+)', type: 'region', name: '([^']+)' \}`, base) {
		wantUnits = append(wantUnits, m[1]+"|region||"+m[2])
	}
	for _, m := range matches(`\['(f-[a-z-]+)', '(r-[a-z]+)', '([^']+)'\]`, base) {
		wantUnits = append(wantUnits, m[1]+"|company|"+m[2]+"|"+m[3])
	}
	equalSets(t, "alta units", unitKeys(alta.units), wantUnits)
	if len(wantUnits) != 15 {
		t.Fatalf("prototype alta units parsed: %d, want 15", len(wantUnits))
	}

	re := `\{ id: '(m-[a-z]+)', name: '([^']+)', email: '([^']+)', status: '([a-z]+)', title: '([^']+)'(?:, function: '([a-z]+)')?`
	var wantMembers []string
	for _, m := range matches(re, base) {
		wantMembers = append(wantMembers, strings.Join(m[1:], "|"))
	}
	equalSets(t, "alta members", memberKeys(alta.members), wantMembers)
	if len(wantMembers) != 10 {
		t.Fatalf("prototype alta members parsed: %d, want 10", len(wantMembers))
	}
}

// «Лотос»: регион и два салона; владелец и Морозова (у неё членства в двух организациях).
func TestLotosMatchesPrototype(t *testing.T) {
	t.Parallel()
	lotos, _ := mockData(t)
	var wantUnits []string
	re := `\{ id: '((?:r|f)-[a-z-]+)', type: '(region|firm)', (?:parent: '([a-z-]+)', )?name: '([^']+)' \}`
	for _, m := range matches(re, lotos) {
		kind := map[string]string{"region": "region", "firm": "company"}[m[2]]
		wantUnits = append(wantUnits, m[1]+"|"+kind+"|"+m[3]+"|"+m[4])
	}
	equalSets(t, "lotos units", unitKeys(lotosData.units), wantUnits)

	var wantMembers []string
	for _, m := range matches(`\{ id: '(m-[a-z]+)', name: '([^']+)', email: '([^']+)', status: '([a-z]+)', title: '([^']+)' \}`, lotos) {
		wantMembers = append(wantMembers, strings.Join(m[1:], "|")+"|")
	}
	equalSets(t, "lotos members", memberKeys(lotosData.members), wantMembers)
	if len(wantUnits) != 3 || len(wantMembers) != 2 {
		t.Fatalf("prototype lotos parsed: %d units, %d members; want 3, 2", len(wantUnits), len(wantMembers))
	}
}

func unitKeys(units []unit) []string {
	var out []string
	for _, u := range units {
		out = append(out, u.proto+"|"+u.kind+"|"+u.parent+"|"+u.name)
	}
	return out
}

func memberKeys(members []member) []string {
	var out []string
	for _, m := range members {
		out = append(out, strings.Join([]string{m.proto, m.name, m.email, m.protoStatus, m.title, m.function}, "|"))
	}
	return out
}

// Членства ссылаются на участников своей организации с той же почтой; UUID сида не повторяются.
func TestMembershipsAndUniqueIDs(t *testing.T) {
	t.Parallel()
	byTenant := map[string]tenantData{"t-alta": alta, "t-lotos": lotosData}
	n := 0
	for _, ms := range memberships() {
		td, ok := byTenant[ms.tenant]
		if !ok {
			t.Errorf("membership %s → tenant %s without database", ms.account.proto, ms.tenant)
			continue
		}
		m, ok := td.member(ms.member)
		if !ok || m.email != ms.account.email {
			t.Errorf("membership %s@%s → member %q (%v)", ms.account.proto, ms.tenant, ms.member, ok)
		}
		n++
	}
	if n != 12 {
		t.Errorf("memberships = %d, want 12 (Альта 10, Лотос 2)", n)
	}

	seen := map[uuid.UUID]string{}
	add := func(id uuid.UUID, what string) {
		if prev, dup := seen[id]; dup {
			t.Errorf("duplicate seed UUID %s: %s and %s", id, prev, what)
		}
		seen[id] = what
	}
	for _, tn := range tenants {
		add(tn.id(), "tenant "+tn.proto)
	}
	for _, a := range accounts {
		add(a.id(), "account "+a.proto)
	}
	for _, o := range operators {
		add(o.id(), "operator "+o.proto)
		add(o.accountID(), "operator account "+o.proto)
	}
	for _, ms := range memberships() {
		add(ms.id(), "membership "+ms.account.proto+"@"+ms.tenant)
	}
}
