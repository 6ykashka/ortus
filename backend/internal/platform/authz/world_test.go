package authz

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// A small tenant for unit tests, in the spirit of the isolation fixtures (15-quality-security.md): Москва
// (Москва-1, Москва-2) and Самара (Самара-2), the project «Автопарк», people with the roles of the matrix.

func tid(name string) uuid.UUID {
	return uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:authz-test:"+name))
}

var (
	tenantA = tid("tenant")

	uMsk  = tid("unit:msk")
	uMsk1 = tid("unit:msk1")
	uMsk2 = tid("unit:msk2")
	uSmr  = tid("unit:smr")
	uSmr2 = tid("unit:smr2")

	projFleet = tid("project:fleet")
	projOther = tid("project:other")

	pOwner       = tid("person:owner")
	pOwnerDriver = tid("person:owner-driver")
	pTwoRoles    = tid("person:two-roles")
	pRegion      = tid("person:region")
	pFirmOnly    = tid("person:firm-only")
	pDriver      = tid("person:driver")
	pEarner      = tid("person:earner")
	pLead        = tid("person:lead")
	pTemp        = tid("person:temp")
	pExpired     = tid("person:expired")
	pAdmin       = tid("person:admin")
	pCashier     = tid("person:cashier")
	pReader      = tid("person:reader")
	pGalaxy      = tid("person:galaxy")
	pNobody      = tid("person:nobody")
)

// now is the clock of the tests: harness.Now of the isolation suite (01.10.2026 10:30 MSK).
var now = time.Date(2026, 10, 1, 10, 30, 0, 0, time.FixedZone("MSK", 3*60*60))

const (
	aVehiclesRead   = "fleet.vehicles.read"
	aVehiclesManage = "fleet.vehicles.manage"
	aTripsRead      = "fleet.trips.read"
	aEarningsRead   = "fleet.earnings.read"
	aMembersRead    = "members.read"
	aProjectsRead   = "tasks.projects.read"
	aProjectsManage = "tasks.projects.manage"
	aTasksRead      = "tasks.read"
	aTasksApprove   = "tasks.approve"
	aModulesManage  = "modules.manage"
	aBillingRead    = "billing.read"
	aBillingManage  = "billing.manage"
	aMembersManage  = "members.manage"
	aCashRead       = "cash.read"
	aCashPost       = "cash.post"
)

var (
	managerRole  = []string{aMembersRead, "org_units.read", aVehiclesRead, aVehiclesManage, aTripsRead, "fleet.trips.review", "roles.read"}
	observerRole = []string{"org_units.read", aVehiclesRead, aTripsRead}
	driverRole   = []string{aTripsRead, "fleet.trips.start", aVehiclesRead, "files.read"}
	earningsRole = []string{aEarningsRead}
	projectRole  = []string{aProjectsRead, aProjectsManage, aTasksRead, aTasksApprove, "files.read"}
	adminRole    = []string{aMembersRead, aMembersManage, aModulesManage, aBillingRead, aBillingManage}
	cashRole     = []string{aCashRead, aCashPost}
	readerRole   = []string{aTasksRead, aProjectsRead}
)

// grant is a permanent grant (since 30 days before now).
func grant(actions []string, kind string, ref uuid.UUID, descendants bool) Grant {
	return Grant{
		AssignmentID: uuid.New(), RoleID: uuid.New(), Actions: actions,
		Scope: Scope{Kind: kind, Ref: ref, Descendants: descendants}, From: now.Add(-30 * 24 * time.Hour),
	}
}

func period(g Grant, from, until time.Duration) Grant {
	g.From = now.Add(from)
	end := now.Add(until)
	g.Until = &end
	return g
}

func viaGroup(g Grant) Grant {
	g.Group = tid("group:finance")
	return g
}

func limited(g Grant, value int64) Grant {
	g.Limit = &Amount{Value: value, Currency: "RUB"}
	return g
}

func subjects() map[uuid.UUID]Subject {
	return map[uuid.UUID]Subject{
		pOwner:       {},
		pOwnerDriver: {Functions: []string{FunctionDriver}},
		pTwoRoles: {Grants: []Grant{
			grant(managerRole, KindUnit, uMsk1, true),  // «изменять» Москва-1
			grant(observerRole, KindUnit, uSmr2, true), // «читать» Самара-2
		}},
		pRegion:   {Grants: []Grant{grant(managerRole, KindUnit, uMsk, true)}},
		pFirmOnly: {Grants: []Grant{grant(managerRole, KindUnit, uMsk, false)}},
		pDriver: {Functions: []string{FunctionDriver}, Grants: []Grant{
			grant(driverRole, KindSelf, uuid.Nil, false),
			viaGroup(grant(earningsRole, KindUnit, uMsk1, true)), // конфликт: начисления через группу (AC-05)
		}},
		pEarner: {Grants: []Grant{viaGroup(grant(earningsRole, KindUnit, uMsk1, true))}},
		pLead:   {Grants: []Grant{grant(projectRole, KindProject, projFleet, false)}},
		pTemp:   {Grants: []Grant{period(grant(driverRole, KindUnit, uMsk1, true), -24*time.Hour, 7*24*time.Hour)}},
		pExpired: {Grants: []Grant{
			period(grant(managerRole, KindUnit, uMsk1, true), -30*24*time.Hour, -24*time.Hour),
			period(grant(managerRole, KindUnit, uMsk2, true), 24*time.Hour, 30*24*time.Hour), // ещё не началось
		}},
		pAdmin: {Grants: []Grant{grant(adminRole, KindTenant, uuid.Nil, false)}},
		pCashier: {Grants: []Grant{
			limited(grant(cashRole, KindUnit, uMsk1, true), 10_000_00),
			grant(cashRole, KindUnit, uMsk2, true),
		}},
		pReader: {Grants: []Grant{grant(readerRole, KindTenant, uuid.Nil, false)}},
		pGalaxy: {Grants: []Grant{grant(managerRole, "galaxy", uMsk1, true)}},
		pNobody: {},
	}
}

// fakeTree: Москва → Москва-1, Москва-2; Самара → Самара-2.
type fakeTree struct{ err error }

func (f fakeTree) Ancestors(_ context.Context, _ uuid.UUID, unit uuid.UUID) ([]uuid.UUID, error) {
	if f.err != nil {
		return nil, f.err
	}
	parents := map[uuid.UUID]uuid.UUID{uMsk1: uMsk, uMsk2: uMsk, uSmr2: uSmr}
	out := []uuid.UUID{unit}
	if p, ok := parents[unit]; ok {
		out = append(out, p)
	}
	return out, nil
}

// fakeSource returns the subjects above; it ignores «at» on purpose: the evaluator re-checks every period.
type fakeSource struct {
	subjects map[uuid.UUID]Subject
	modules  []string
	err      error
	calls    int
}

func (f *fakeSource) Subject(_ context.Context, tc tenantctx.TenantContext, _ time.Time, grants bool) (Subject, error) {
	f.calls++
	if f.err != nil {
		return Subject{}, f.err
	}
	s := f.subjects[tc.PersonID]
	s.TenantID, s.PersonID, s.Owner = tc.TenantID, tc.PersonID, tc.Owner
	if !grants {
		s.Grants = nil
	}
	s.Functions = slices.Clone(s.Functions)
	return s, nil
}

func (f *fakeSource) InstalledModules(context.Context, tenantctx.TenantContext) ([]string, error) {
	return f.modules, f.err
}

func newWorld(t *testing.T) (*Evaluator, *fakeSource) {
	t.Helper()
	src := &fakeSource{subjects: subjects(), modules: []string{ModSpa}}
	return New(src, fakeTree{}, func() time.Time { return now }), src
}

func member(person uuid.UUID) tenantctx.TenantContext {
	return tenantctx.TenantContext{TenantID: tenantA, PersonID: person, Owner: person == pOwner || person == pOwnerDriver}
}

var errBoom = errors.New("boom")

// wantCode fails unless err is nil (code "") or a problem with code.
func wantCode(t *testing.T, what string, err error, code string) {
	t.Helper()
	switch {
	case code == "" && err != nil:
		t.Errorf("%s: %v, want allowed", what, err)
	case code != "" && !problem.Is(err, code):
		t.Errorf("%s: %v, want %s", what, err, code)
	}
}
