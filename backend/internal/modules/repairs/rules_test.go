package repairs

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
)

func TestQuantity(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		in   string
		want milli
		ok   bool
	}{
		{"18", 18000, true}, {"46.82", 46820, true}, {"0.001", 1, true}, {"134.240", 134240, true}, {"0", 0, true},
		{"", 0, false}, {"-1", 0, false}, {"1.0005", 0, false}, {"abc", 0, false}, {"1e3", 0, false},
	} {
		got, ok := parseQty(c.in)
		if ok != c.ok || got != c.want {
			t.Errorf("parseQty(%q) = %d, %v; want %d, %v", c.in, got, ok, c.want, c.ok)
		}
	}
	for want, in := range map[string]milli{"18": 18000, "46.82": 46820, "0": 0, "0.5": 500, "1000": 1000000, "0.001": 1} {
		if got := in.String(); got != want {
			t.Errorf("milli(%d).String() = %q, want %q", in, got, want)
		}
	}
}

// The rule of the prototype (MSW submitWorkLog): a line over the rest of the plan by more than 10 % of the rest, and
// over 10 % of the plan, is refused; the answer names what is left.
func TestVolumeOverPlan(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name                  string
		qty, plan, fact, wait milli
		over                  bool
		left                  milli
	}{
		{"в пределах остатка", 40000, 100000, 50000, 0, false, 50000},
		{"ровно остаток", 50000, 100000, 50000, 0, false, 50000},
		{"плюс 10 % остатка", 55000, 100000, 50000, 0, false, 50000},
		{"сверх 10 % остатка и плана", 60000, 100000, 50000, 0, true, 50000},
		{"остаток учитывает приёмку", 22000, 100000, 50000, 30000, false, 20000},
		{"остаток учитывает приёмку, сверх", 40000, 100000, 50000, 30000, true, 20000},
		{"остатка нет, допуск 10 % плана", 9000, 100000, 100000, 0, false, 0},
		{"остатка нет, сверх допуска", 11000, 100000, 100000, 0, true, 0},
		{"факт выше плана", 5000, 100000, 120000, 0, false, 0},
	} {
		over, left := overPlan(c.qty, c.plan, c.fact, c.wait)
		if over != c.over || left != c.left {
			t.Errorf("%s: overPlan = %v, %d; want %v, %d", c.name, over, left, c.over, c.left)
		}
	}
}

func TestReadiness(t *testing.T) {
	t.Parallel()
	r := readinessOf(210000, 100000, 5000, 3, 1)
	if r.AcceptedPct != 48 || r.PendingPct != 2 || r.ClientPct != 33 {
		t.Errorf("readiness = %+v, want 48 / 2 / 33", r)
	}
	if r := readinessOf(0, 0, 0, 0, 0); r.AcceptedPct != 0 || r.PendingPct != 0 || r.ClientPct != 0 {
		t.Errorf("empty plan: %+v", r)
	}
	if r := readinessOf(10000, 15000, 0, 1, 1); r.AcceptedPct != 100 || r.ClientPct != 100 {
		t.Errorf("fact above plan is capped: %+v", r)
	}
}

func TestIfMatch(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		header  string
		current int64
		ok      bool
	}{
		{`"rev-3"`, 3, true}, {"rev-3", 3, true}, {`W/"rev-3"`, 3, true}, {`"rev-2"`, 3, false}, {`"3"`, 3, false}, {"", 3, false}, {`"rev-x"`, 3, false},
	} {
		if err := checkRev(c.header, c.current, "changed"); (err == nil) != c.ok {
			t.Errorf("checkRev(%q, %d) = %v, want ok=%v", c.header, c.current, err, c.ok)
		}
	}
}

func TestCovers(t *testing.T) {
	t.Parallel()
	unit, parent, other, project, me, foreman := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	p := &projectRow{id: project, unit: unit, foreman: &foreman}
	path := []uuid.UUID{unit, parent}
	grant := func(kind string, ref uuid.UUID, desc bool) authz.Grant {
		return authz.Grant{Actions: []string{actRead}, Scope: authz.Scope{Kind: kind, Ref: ref, Descendants: desc}, From: time.Time{}}
	}
	for _, c := range []struct {
		name string
		g    authz.Grant
		who  uuid.UUID
		want bool
	}{
		{"вся организация", grant(authz.KindTenant, uuid.Nil, false), me, true},
		{"подразделение объекта", grant(authz.KindUnit, unit, false), me, true},
		{"предок без потомков", grant(authz.KindUnit, parent, false), me, false},
		{"предок с потомками", grant(authz.KindUnit, parent, true), me, true},
		{"чужое подразделение", grant(authz.KindUnit, other, true), me, false},
		{"сам объект", grant(authz.KindRepairProject, project, false), me, true},
		{"другой объект", grant(authz.KindRepairProject, other, false), me, false},
		{"своё — я прораб", grant(authz.KindSelf, uuid.Nil, false), foreman, true},
		{"своё — не мой объект", grant(authz.KindSelf, uuid.Nil, false), me, false},
		{"связь не покрывает", grant(authz.KindRelation, uuid.Nil, false), me, false},
	} {
		if got := covers(c.g, p, path, c.who, actRead); got != c.want {
			t.Errorf("%s: covers = %v, want %v", c.name, got, c.want)
		}
	}
	if covers(authz.Grant{Actions: []string{actManage}, Scope: authz.Scope{Kind: authz.KindTenant}}, p, path, me, actRead) {
		t.Error("a grant without the action covers nothing")
	}
}
