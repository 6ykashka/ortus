//go:build integration

package assignments_test

import (
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/accesstest" //nolint:depguard // the access module's own test helper (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/modules/access/groups"                 //nolint:depguard // the access module of W1.06: setGroupMembers in the race
	"github.com/ortus/ortus-crm/backend/internal/modules/access/roles"                  //nolint:depguard // the access module of W1.06: updateRole in the race
	orgkit "github.com/ortus/ortus-crm/backend/internal/modules/org/kit"                //nolint:depguard // test only: the directory of the real command of W1.05
	"github.com/ortus/ortus-crm/backend/internal/modules/people"                        //nolint:depguard // test only: the real createWorkProfile / updateWorkProfile of W1.05
)

const sodConflict = "separation_of_duties_conflict"

// workProfiles is the people module of W1.05 over the world: its commands give and extend the work function driver.
func (w *world) workProfiles() *people.Server {
	return &people.Server{Pools: w.Pools(), Authz: w.Evaluator(), Directory: orgkit.ControlDirectory{DB: w.Control},
		Now: func() time.Time { return w.Now }}
}

// makeDriver is createWorkProfile(driver) of W1.05 for person from now, open-ended.
func (w *world) makeDriver(person uuid.UUID) func() error {
	body := accessapi.WorkProfileCreate{Function: accessapi.WorkProfileCreateFunction("driver"), ValidFrom: w.Now}
	return func() error {
		_, err := w.workProfiles().CreateWorkProfile(w.Ctx(w.owner), accessapi.CreateWorkProfileRequestObject{
			TenantId: w.TenantID, MemberId: person, Body: &body})
		return err
	}
}

// race runs a command of the access model (mine) against a work function command of W1.05 (theirs) in the order that
// once broke D-10: mine is already waiting for the policy lock when theirs starts — theirs checks the earnings and
// writes the function before it raises policy_version. A third transaction holds the policy lock until both wait.
//
// «Waits» is what the server says (accesstest.Waiter, W1.46): mine is blocked by the holder of the policy row, so it
// has already locked its people (kit.InPeopleTx takes them before the policy); only then theirs starts, and it is
// released once it is blocked by the holder or by mine. A timer would take a command still on its way to its locks on
// a loaded machine for a waiting one, and theirs would pass first.
func race(t *testing.T, w *world, mine, theirs func() error) (errMine, errTheirs error) {
	t.Helper()
	held := w.HoldPolicy("")
	holder := accesstest.PID(held)
	m := accesstest.Go(mine)
	minePID, ok := w.Waiter(w.Tenant, m, holder)
	if !ok {
		t.Fatalf("the command of the access model did not wait for the policy lock: %v", m.Wait())
	}
	th := accesstest.Go(theirs)
	if _, ok := w.Waiter(w.Tenant, th, holder, minePID); !ok {
		t.Fatalf("the command of W1.05 did not wait: %v", th.Wait())
	}
	if err := held.Rollback(t.Context()); err != nil {
		t.Fatal(err)
	}
	return m.Wait(), th.Wait()
}

// noDriverWithEarnings fails the test when person has the work function driver and an earnings grant at once.
func (w *world) noDriverWithEarnings(t *testing.T, person uuid.UUID) {
	t.Helper()
	n := w.Count(`select 1 from people.work_profiles wp
		join access.role_assignments ra on ra.state <> 'revoked' and ra.valid && wp.valid
		join access.role_versions rv on rv.role_id = ra.role_id and rv.version = ra.role_version
		where wp.person_id = $1 and wp.function = 'driver' and 'fleet.earnings.read' = any(rv.actions)
		  and ((ra.principal_kind = 'person' and ra.principal_id = $1)
		    or (ra.principal_kind = 'group' and ra.principal_id in (select group_id from access.group_members where person_id = $1)))`,
		person)
	if n != 0 {
		t.Errorf("D-10 broken: the driver %s holds earnings (%d overlaps)", person, n)
	}
}

// D-10 против реальной createWorkProfile(driver) W1.05: назначение начислений ждёт блокировку политики, а W1.05
// в это время делает того же человека водителем. Назначение проходит первым, функция «Водитель» — 409, а не обе
// команды мимо проверок друг друга (write skew).
func TestCreateAssignmentRacesCreateWorkProfile(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	body := member(w.m1, w.earnings, unitScope(w.f1, true))
	mine, theirs := race(t, w, func() error {
		_, err := w.h.CreateAssignment(w.Ctx(w.owner), accessapi.CreateAssignmentRequestObject{TenantId: w.TenantID, Body: &body})
		return err
	}, w.makeDriver(w.m1))
	if mine != nil {
		t.Errorf("createAssignment: %v", mine)
	}
	if accesstest.Code(theirs) != sodConflict {
		t.Errorf("createWorkProfile(driver) after the earnings: %v, want %s", theirs, sodConflict)
	}
	w.noDriverWithEarnings(t, w.m1)
}

// W1.46 (П-12): под нагрузкой команда модели доступа доходит до своих блокировок позже accesstest.Pause. race всё
// равно пускает команду W1.05 только тогда, когда «моя» уже ждёт политику (а людей заперла): назначение проходит,
// функция «Водитель» — 409, как в TestCreateAssignmentRacesCreateWorkProfile.
func TestRaceWaitsForTheBlockedCommand(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	body := member(w.m1, w.earnings, unitScope(w.f1, true))
	mine, theirs := race(t, w, func() error {
		time.Sleep(2 * accesstest.Pause) // a slow machine: the command reaches its locks late
		_, err := w.h.CreateAssignment(w.Ctx(w.owner), accessapi.CreateAssignmentRequestObject{TenantId: w.TenantID, Body: &body})
		return err
	}, w.makeDriver(w.m1))
	if mine != nil {
		t.Errorf("createAssignment: %v", mine)
	}
	if accesstest.Code(theirs) != sodConflict {
		t.Errorf("createWorkProfile(driver) after the earnings: %v, want %s", theirs, sodConflict)
	}
	w.noDriverWithEarnings(t, w.m1)
}

// То же против updateWorkProfile W1.05: продление периода водителя на время будущих начислений.
func TestCreateAssignmentRacesExtendWorkProfile(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	until := w.Now.Add(time.Hour)
	w.Function(w.m1, "driver", w.f1, &until)
	var profile uuid.UUID
	var revision int64
	if err := w.Tenant.QueryRow(t.Context(), `select id, xmin::text::bigint from people.work_profiles where person_id = $1`, w.m1).
		Scan(&profile, &revision); err != nil {
		t.Fatal(err)
	}
	from := w.Now.Add(2 * time.Hour)
	body := member(w.m1, w.earnings, unitScope(w.f1, true))
	body.ValidFrom = &from
	extended := accessapi.WorkProfilePatch{ValidUntil: w.Now.Add(3 * time.Hour)}
	mine, theirs := race(t, w, func() error {
		_, err := w.h.CreateAssignment(w.Ctx(w.owner), accessapi.CreateAssignmentRequestObject{TenantId: w.TenantID, Body: &body})
		return err
	}, func() error {
		_, err := w.workProfiles().UpdateWorkProfile(w.Ctx(w.owner), accessapi.UpdateWorkProfileRequestObject{
			TenantId: w.TenantID, MemberId: w.m1, WorkProfileId: profile, Body: &extended,
			Params: accessapi.UpdateWorkProfileParams{IfMatch: strconv.Quote(strconv.FormatInt(revision, 10))}})
		return err
	})
	if mine != nil {
		t.Errorf("createAssignment: %v", mine)
	}
	if accesstest.Code(theirs) != sodConflict {
		t.Errorf("updateWorkProfile(driver) over the earnings: %v, want %s", theirs, sodConflict)
	}
	w.noDriverWithEarnings(t, w.m1)
}

// Состав группы с ролью начислений против createWorkProfile(driver) W1.05 для добавляемого человека.
func TestSetGroupMembersRacesCreateWorkProfile(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	finance := w.Group("Финансы", w.f1)
	w.Assign(accesstest.Grant{Group: true, Principal: finance, Role: w.earnings, Kind: "unit", Ref: w.f1, Descendants: true})
	var revision int64
	if err := w.Tenant.QueryRow(t.Context(), `select revision from access.groups where id = $1`, finance).Scan(&revision); err != nil {
		t.Fatal(err)
	}
	h := groups.New(w.Deps())
	mine, theirs := race(t, w, func() error {
		_, err := h.SetGroupMembers(w.Ctx(w.owner), accessapi.SetGroupMembersRequestObject{TenantId: w.TenantID, GroupId: finance,
			Params: accessapi.SetGroupMembersParams{IfMatch: strconv.Quote(strconv.FormatInt(revision, 10))},
			Body:   &accessapi.SetGroupMembersJSONRequestBody{MemberIds: []uuid.UUID{w.m1}}})
		return err
	}, w.makeDriver(w.m1))
	if mine != nil {
		t.Errorf("setGroupMembers: %v", mine)
	}
	if accesstest.Code(theirs) != sodConflict {
		t.Errorf("createWorkProfile(driver) of a new member of the earnings group: %v, want %s", theirs, sodConflict)
	}
	w.noDriverWithEarnings(t, w.m1)
}

// Правка роли (начисления в роль, которую держит человек) против createWorkProfile(driver) W1.05 для держателя.
func TestUpdateRoleRacesCreateWorkProfile(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	h := roles.New(w.Deps())
	perms := []string{"fleet.trips.read", "fleet.earnings.read"}
	mine, theirs := race(t, w, func() error {
		_, err := h.UpdateRole(w.Ctx(w.owner), accessapi.UpdateRoleRequestObject{TenantId: w.TenantID, RoleId: w.trips,
			Params: accessapi.UpdateRoleParams{IfMatch: `"1"`}, Body: &accessapi.RolePatch{Permissions: &perms}})
		return err
	}, w.makeDriver(w.m1))
	if mine != nil {
		t.Errorf("updateRole: %v", mine)
	}
	if accesstest.Code(theirs) != sodConflict {
		t.Errorf("createWorkProfile(driver) of a holder of the role with earnings: %v, want %s", theirs, sodConflict)
	}
	w.noDriverWithEarnings(t, w.m1)
}
