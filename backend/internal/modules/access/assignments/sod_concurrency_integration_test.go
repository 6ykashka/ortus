//go:build integration

package assignments_test

import (
	"testing"
	"time"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/accesstest" //nolint:depguard // the access module's own test helper (W1.06)
)

const insertDriverProfile = `insert into people.work_profiles (person_id, function, unit_id, valid)
	values ($1, 'driver', $2, tstzrange($3::timestamptz, null))`

// D-10 под конкуренцией: пока параллельная команда (createWorkProfile(driver) W1.05) держит блокировку политики и
// делает менеджера водителем, назначение ему начислений ждёт её и видит функцию — 409, а не 201 мимо проверки.
func TestCreateAssignmentWaitsForWorkProfile(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	held := w.HoldPolicy(insertDriverProfile, w.m1, w.f1, w.Now.Add(-time.Hour))
	body := member(w.m1, w.earnings, unitScope(w.f1, true))
	run := accesstest.Go(func() error {
		_, err := w.h.CreateAssignment(w.Ctx(w.owner), accessapi.CreateAssignmentRequestObject{TenantId: w.TenantID, Body: &body})
		return err
	})
	if !run.Running(accesstest.Pause) {
		t.Error("createAssignment did not wait for the concurrent command")
	}
	if err := held.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	if got := accesstest.Problem(run.Wait()); got != "separation_of_duties_conflict|Функция «Водитель» несовместима с правом на начисления (правило MVP)." {
		t.Errorf("earnings to a new driver: %q", got)
	}
}

// D-10 под конкуренцией в обратную сторону: параллельное назначение начислений держит блокировку — назначение роли
// «Водитель» тому же человеку ждёт и получает 409.
func TestCreateAssignmentWaitsForEarnings(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	held := w.HoldPolicy(`insert into access.role_assignments (principal_kind, principal_id, role_id, role_version, scope_kind,
		scope_ref, include_descendants, valid, granted_by) values ('person', $1, $2, 1, 'unit', $3, true, tstzrange($4::timestamptz, null), $1)`,
		w.m1, w.earnings, w.f1, w.Now.Add(-time.Hour))
	body := member(w.m1, w.driverRole, accessapi.Scope{Kind: accessapi.ScopeKindSelf, ResourceIds: []accessapi.Id{}})
	run := accesstest.Go(func() error {
		_, err := w.h.CreateAssignment(w.Ctx(w.owner), accessapi.CreateAssignmentRequestObject{TenantId: w.TenantID, Body: &body})
		return err
	})
	if !run.Running(accesstest.Pause) {
		t.Error("createAssignment did not wait for the concurrent command")
	}
	if err := held.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	if got := accesstest.Problem(run.Wait()); got != "separation_of_duties_conflict|У сотрудника есть финансовые права. Совмещение с функцией «Водитель» в MVP запрещено." {
		t.Errorf("driver role to a new earner: %q", got)
	}
}
