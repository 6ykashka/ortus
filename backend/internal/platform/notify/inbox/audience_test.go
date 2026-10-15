package inbox

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

var (
	tenant = uuid.New()
	msk    = uuid.New() // регион Москва
	msk1   = uuid.New() // фирма Москва-1 в регионе
	msk2   = uuid.New() // фирма Москва-2 в регионе
	now    = time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
)

// person is a subject of the fake source: work functions and grants.
type person struct {
	functions []string
	grants    []authz.Grant
}

type fakeSource struct {
	people map[uuid.UUID]person
	err    error
}

func (f fakeSource) Subject(_ context.Context, tc tenantctx.TenantContext, _ time.Time, grants bool) (authz.Subject, error) {
	if f.err != nil {
		return authz.Subject{}, f.err
	}
	p := f.people[tc.PersonID]
	s := authz.Subject{TenantID: tc.TenantID, PersonID: tc.PersonID, Owner: tc.Owner, Functions: p.functions}
	if grants {
		s.Grants = p.grants
	}
	return s, nil
}

func (fakeSource) InstalledModules(context.Context, tenantctx.TenantContext) ([]string, error) {
	return []string{"logistics"}, nil
}

type fakeUnits struct{}

func (fakeUnits) Ancestors(_ context.Context, _, unit uuid.UUID) ([]uuid.UUID, error) {
	if unit == msk1 || unit == msk2 {
		return []uuid.UUID{unit, msk}, nil
	}
	return []uuid.UUID{unit}, nil
}

func grant(scope authz.Scope, actions ...string) authz.Grant {
	return authz.Grant{AssignmentID: uuid.New(), RoleID: uuid.New(), Actions: actions, Scope: scope}
}

func unitScope(u uuid.UUID) authz.Scope {
	return authz.Scope{Kind: authz.KindUnit, Ref: u, Descendants: true}
}

// AuthzAudience — правила §4 брифа: право на подразделение по оценщику W1.04, функция driver закрывает
// чувствительные уведомления (AC-05), без права — только «обычное» уведомление без подразделения.
func TestAuthzAudience(t *testing.T) {
	t.Parallel()
	var (
		owner, region, manager, observer = uuid.New(), uuid.New(), uuid.New(), uuid.New()
		earner, driverEarner, driver     = uuid.New(), uuid.New(), uuid.New()
	)
	src := fakeSource{people: map[uuid.UUID]person{
		owner:        {},
		region:       {grants: []authz.Grant{grant(unitScope(msk), "fleet.trips.read")}},
		manager:      {grants: []authz.Grant{grant(unitScope(msk1), "fleet.trips.read", "fleet.trips.review")}},
		observer:     {grants: []authz.Grant{grant(authz.Scope{Kind: authz.KindTenant}, "members.read")}},
		earner:       {grants: []authz.Grant{grant(unitScope(msk1), "fleet.earnings.read", "fleet.trips.read")}},
		driverEarner: {functions: []string{authz.FunctionDriver}, grants: []authz.Grant{grant(unitScope(msk1), "fleet.earnings.read", "fleet.trips.read")}},
		driver:       {functions: []string{authz.FunctionDriver}, grants: []authz.Grant{grant(authz.Scope{Kind: authz.KindSelf}, "fleet.trips.read")}},
	}}
	aud := AuthzAudience{E: authz.New(src, fakeUnits{}, func() time.Time { return now })}
	tc := func(p uuid.UUID) tenantctx.TenantContext {
		return tenantctx.TenantContext{TenantID: tenant, PersonID: p, Owner: p == owner}
	}
	trips := func(u uuid.UUID) Rule {
		return Rule{Permission: "fleet.trips.read", Unit: u, Sensitivity: SensitivityNormal}
	}
	earnings := Rule{Permission: "fleet.earnings.read", Unit: msk1, Sensitivity: SensitivityRestricted}
	for _, c := range []struct {
		name string
		who  uuid.UUID
		rule Rule
		want bool
	}{
		{"обычное без права — всем", manager, Rule{Sensitivity: SensitivityNormal}, true},
		{"пустая чувствительность = normal", driver, Rule{}, true},
		{"владелец — всё", owner, trips(msk2), true},
		{"владелец — начисления", owner, earnings, true},
		{"регион с потомками видит фирму", region, trips(msk1), true},
		{"менеджер Москва-1 — своя фирма", manager, trips(msk1), true},
		{"менеджер Москва-1 — чужая фирма", manager, trips(msk2), false},
		{"менеджер Москва-1 — регион выше своей фирмы", manager, trips(msk), false},
		{"менеджер без права начислений (R-03)", manager, earnings, false},
		{"право на всю организацию без подразделения", observer, Rule{Permission: "members.read"}, true},
		{"грант подразделения без подразделения уведомления", manager, Rule{Permission: "fleet.trips.read"}, false},
		{"начисления с правом", earner, earnings, true},
		{"водитель с правом начислений через группу (AC-05)", driverEarner, earnings, false},
		{"водитель: чувствительное с незакрываемым правом", driverEarner, Rule{Permission: "fleet.trips.read", Unit: msk1, Sensitivity: SensitivitySensitive}, false},
		{"не водитель: чувствительное", earner, Rule{Permission: "fleet.trips.read", Unit: msk1, Sensitivity: SensitivitySensitive}, true},
		{"водитель со своей областью — не подразделение", driver, trips(msk1), false},
		{"подразделение без права — никому", owner, Rule{Unit: msk1}, false},
		{"чувствительное без права — никому", owner, Rule{Sensitivity: SensitivitySensitive}, false},
		{"неизвестное право", owner, Rule{Permission: "fleet.unknown.read"}, false},
	} {
		got, err := aud.Admits(t.Context(), tc(c.who), c.rule)
		if err != nil || got != c.want {
			t.Errorf("%s: %v, %v; want %v", c.name, got, err, c.want)
		}
	}
}

// Сбой tenant DB при проверке адресата — ошибка dependency_unavailable, а не «не адресат».
func TestAuthzAudienceSourceDown(t *testing.T) {
	t.Parallel()
	aud := AuthzAudience{E: authz.New(fakeSource{err: errors.New("tenant DB down")}, fakeUnits{}, nil)}
	tc := tenantctx.TenantContext{TenantID: tenant, PersonID: uuid.New()}
	for _, r := range []Rule{
		{Permission: "fleet.trips.read", Unit: msk1},
		{Permission: "fleet.trips.read", Unit: msk1, Sensitivity: SensitivityRestricted},
	} {
		ok, err := aud.Admits(t.Context(), tc, r)
		if ok || !problem.Is(err, problem.CodeDependencyUnavailable) {
			t.Errorf("%+v: %v, %v; want dependency_unavailable", r, ok, err)
		}
	}
}
