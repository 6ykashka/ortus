package fixtures

import (
	"slices"
	"strings"
	"testing"
)

func TestDefaultCatalogIsValid(t *testing.T) {
	t.Parallel()
	if err := Default().Validate(); err != nil {
		t.Fatal(err)
	}
}

// Карточка W0.15 (S0-07) и 15-quality-security.md «Фикстуры изоляции»: два тенанта, по две фирмы и больше.
func TestCatalogTwoTenantsWithFirms(t *testing.T) {
	t.Parallel()
	c := Default()
	if len(c.Tenants) != 2 {
		t.Fatalf("tenants = %d, want 2 (A «Холдинг», B «Чужой клиент»)", len(c.Tenants))
	}
	for _, tn := range c.Tenants {
		companies := 0
		for _, u := range tn.Units {
			if u.Kind == KindCompany {
				companies++
			}
		}
		if companies < 2 {
			t.Errorf("tenant %s: %d firms, want ≥ 2", tn.Key, companies)
		}
	}
	for _, key := range []string{"a.owner", "b.owner"} {
		if !c.mustActor(t, key).Memberships[0].Owner {
			t.Errorf("%s is not an owner", key)
		}
	}
}

// Пользователь с двумя ролями: «изменять» в Москва-1 и «читать» в Самара-2.
func TestCatalogUserWithTwoRoles(t *testing.T) {
	t.Parallel()
	two := Default().mustActor(t, "a.two-roles").Memberships[0].Grants
	if len(two) != 2 || two[0].Role == two[1].Role || two[0].Scope == two[1].Scope {
		t.Errorf("a.two-roles grants = %+v, want two different roles in two different units", two)
	}
}

// Водители: функция driver, временное назначение, начисления через группу.
func TestCatalogDrivers(t *testing.T) {
	t.Parallel()
	c := Default()
	for _, key := range []string{"a.driver-msk1", "a.driver-msk2", "a.driver-earnings", "b.driver-msk1"} {
		if f := c.mustActor(t, key).Memberships[0].Function; f != "driver" {
			t.Errorf("%s function = %q, want driver", key, f)
		}
	}
	if !slices.ContainsFunc(c.mustActor(t, "a.driver-msk2").Memberships[0].Grants, func(g GrantDef) bool {
		return g.Temporary && g.Scope == "msk1"
	}) {
		t.Error("a.driver-msk2: no temporary grant on Москва-1")
	}
	earn := c.mustActor(t, "a.driver-earnings").Memberships[0]
	if !slices.Contains(earn.Groups, "finance") || !c.groupHasAction(t, "a", "finance", "fleet.earnings.read") {
		t.Error("a.driver-earnings must reach fleet.earnings.read through the group «Финансы»")
	}
}

// Один аккаунт в двух тенантах (BR-T2).
func TestCatalogAccountInBothTenants(t *testing.T) {
	t.Parallel()
	if ms := Default().mustActor(t, "ab.member").Memberships; len(ms) != 2 || ms[0].Tenant == ms[1].Tenant {
		t.Errorf("ab.member memberships = %+v, want one in each tenant", ms)
	}
}

// Тенант B «с теми же названиями ролей и фирм» (15-quality-security.md).
func TestForeignTenantMirrorsNames(t *testing.T) {
	t.Parallel()
	c := Default()
	a, b := c.Tenants[0], c.Tenants[1]
	unitNames := func(tn TenantDef) []string {
		var out []string
		for _, u := range tn.Units {
			out = append(out, u.Name)
		}
		return out
	}
	for _, n := range unitNames(b) {
		if !slices.Contains(unitNames(a), n) {
			t.Errorf("unit %q of B has no namesake in A", n)
		}
	}
	if len(a.Roles) != len(b.Roles) {
		t.Fatalf("roles: A %d, B %d", len(a.Roles), len(b.Roles))
	}
	for i := range a.Roles {
		if a.Roles[i].Name != b.Roles[i].Name {
			t.Errorf("role %d: A %q, B %q", i, a.Roles[i].Name, b.Roles[i].Name)
		}
	}
}

// Векторы посчитаны независимо (Node: SHA-1 от NameSpaceURL + имя, версия 5).
func TestIDGoldenVectors(t *testing.T) {
	t.Parallel()
	c := Default()
	for ref, want := range map[string]string{
		"tenant:a":    "f12bd853-8405-510b-9a57-2747865291c1",
		"tenant:b":    "7f6e0e65-76eb-5d3f-b738-52914e3effa6",
		"unit:a.msk1": "6483fa0e-d258-5e90-aaaf-fc46297b6da7",
	} {
		id, err := c.ID(ref)
		if err != nil {
			t.Fatal(err)
		}
		if id.String() != want {
			t.Errorf("ID(%s) = %s, want %s", ref, id, want)
		}
	}
}

func TestRefsResolveToUniqueIDs(t *testing.T) {
	t.Parallel()
	c := Default()
	refs := c.Refs()
	for _, want := range []string{
		"tenant:a", "unit:b.msk1", "role:a.driver", "group:a.finance",
		"account:ab.member", "person:ab.member@b", "membership:a.owner@a",
	} {
		if !slices.Contains(refs, want) {
			t.Errorf("Refs() has no %s", want)
		}
	}
	seen := map[string]string{}
	for _, ref := range refs {
		id, err := c.ID(ref)
		if err != nil {
			t.Fatalf("ID(%s): %v", ref, err)
		}
		if prev, dup := seen[id.String()]; dup {
			t.Errorf("%s and %s share id %s", prev, ref, id)
		}
		seen[id.String()] = ref
	}
}

func TestIDErrors(t *testing.T) {
	t.Parallel()
	c := Default()
	for _, ref := range []string{
		"", "tenant", "tenant:c", "unit:a.nope", "unit:msk1", "role:b.boss", "group:b.finance",
		"account:nobody", "person:a.owner@b", "person:a.owner", "membership:b.owner@a", "planet:a",
	} {
		if _, err := c.ID(ref); err == nil {
			t.Errorf("ID(%q) = nil error, want an error", ref)
		}
	}
}

func TestActor(t *testing.T) {
	t.Parallel()
	c := Default()
	a, err := c.Actor("ab.member")
	if err != nil {
		t.Fatal(err)
	}
	if a.Issuer != IssuerDev || a.Subject != "iso-ab.member" {
		t.Errorf("ab.member identity = %s %s, want %s iso-ab.member", a.Issuer, a.Subject, IssuerDev)
	}
	if acc, _ := c.ID("account:ab.member"); a.AccountID != acc {
		t.Errorf("AccountID = %s, want %s", a.AccountID, acc)
	}
	if len(a.Memberships) != 2 {
		t.Fatalf("memberships = %d, want 2", len(a.Memberships))
	}
	m := a.Memberships[1]
	tb, _ := c.ID("tenant:b")
	mb, _ := c.ID("membership:ab.member@b")
	pb, _ := c.ID("person:ab.member@b")
	if m.Tenant != "b" || m.TenantID != tb || m.MembershipID != mb || m.PersonID != pb || m.Owner {
		t.Errorf("membership in B = %+v", m)
	}
	if _, err := c.Actor("nobody"); err == nil {
		t.Error("Actor(nobody) must fail")
	}
}

func TestValidateRejectsBrokenCatalogs(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		mutate func(*Catalog)
		want   string
	}{
		{"duplicate unit", func(c *Catalog) { c.Tenants[0].Units = append(c.Tenants[0].Units, c.Tenants[0].Units[0]) }, "duplicate"},
		{"unknown parent", func(c *Catalog) { c.Tenants[0].Units[1].Parent = "nope" }, "parent"},
		{"parent after child", func(c *Catalog) { u := c.Tenants[0].Units; u[0], u[1] = u[1], u[0] }, "parent"},
		{"bad unit kind", func(c *Catalog) { c.Tenants[0].Units[0].Kind = "planet" }, "kind"},
		{"unknown role", func(c *Catalog) { c.Actors[1].Memberships[0].Grants[0].Role = "boss" }, "role"},
		{"unknown scope", func(c *Catalog) { c.Actors[1].Memberships[0].Grants[0].Scope = "nope" }, "scope"},
		{"unknown group", func(c *Catalog) { c.Actors[1].Memberships[0].Groups = []string{"nope"} }, "group"},
		{"unknown tenant", func(c *Catalog) { c.Actors[1].Memberships[0].Tenant = "c" }, "tenant"},
		{"unknown home", func(c *Catalog) { c.Actors[1].Memberships[0].Home = "nope" }, "home"},
		{"bad function", func(c *Catalog) { c.Actors[1].Memberships[0].Function = "pilot" }, "function"},
		{"duplicate actor", func(c *Catalog) { c.Actors = append(c.Actors, c.Actors[0]) }, "duplicate"},
		{"reserved actor", func(c *Catalog) { c.Actors[0].Key = Anonymous }, "reserved"},
		{"two memberships in one tenant", func(c *Catalog) {
			c.Actors[0].Memberships = append(c.Actors[0].Memberships, c.Actors[0].Memberships[0])
		}, "duplicate"},
		{"wildcard action", func(c *Catalog) { c.Tenants[0].Roles[0].Actions = []string{"*"} }, "action"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			c := Default()
			tc.mutate(&c)
			err := c.Validate()
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("Validate() = %v, want an error mentioning %q", err, tc.want)
			}
		})
	}
}

func TestDefaultReturnsACopy(t *testing.T) {
	t.Parallel()
	c := Default()
	c.Tenants[0].Units[0].Name = "changed"
	c.Actors[0].Memberships[0].Grants = append(c.Actors[0].Memberships[0].Grants, GrantDef{Role: "x"})
	if d := Default(); d.Tenants[0].Units[0].Name == "changed" || d.Validate() != nil {
		t.Fatal("Default() must return an independent catalog")
	}
}

func (c Catalog) mustActor(t *testing.T, key string) ActorDef {
	t.Helper()
	for _, a := range c.Actors {
		if a.Key == key {
			return a
		}
	}
	t.Fatalf("no actor %s", key)
	return ActorDef{}
}

func (c Catalog) groupHasAction(t *testing.T, tenant, group, action string) bool {
	t.Helper()
	for _, tn := range c.Tenants {
		if tn.Key != tenant {
			continue
		}
		for _, g := range tn.Groups {
			if g.Key != group {
				continue
			}
			for _, gr := range g.Grants {
				for _, r := range tn.Roles {
					if r.Key == gr.Role && slices.Contains(r.Actions, action) {
						return true
					}
				}
			}
		}
	}
	return false
}
