//go:build integration

package assignments_test

import (
	"testing"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
)

// access.policy.bumped.v1 — формат relay W1.07 (realtime.PolicyBumped): policyVersion числом, aggregate_id —
// тенант, personIds — затронутые люди (их сессии получают context.changed, отзыв ≤ 5 с).
func TestPolicyBumpForRelay(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	before := w.PolicyVersion()
	a, err := w.create(t, w.owner, member(w.m2, w.review, unitScope(w.f2, false)))
	if err != nil {
		t.Fatal(err)
	}
	w.CheckPolicyBump(w.LastPolicyBump(), before+1, w.m2)

	grp := accessapi.AssignmentCreate{PrincipalType: accessapi.AssignmentCreatePrincipalTypeGroup, PrincipalId: w.drivers, RoleId: w.trips,
		Scope: unitScope(w.f1, true)}
	if _, err := w.create(t, w.owner, grp); err != nil {
		t.Fatal(err)
	}
	w.CheckPolicyBump(w.LastPolicyBump(), before+2, w.driver) // the members of the group

	if err := w.revoke(t, w.owner, a.Id); err != nil {
		t.Fatal(err)
	}
	w.CheckPolicyBump(w.LastPolicyBump(), before+3, w.m2)

	if _, err := w.transfer(t, w.owner, transferTo(w.m1, "m1@alta.example", false)); err != nil {
		t.Fatal(err)
	}
	w.CheckPolicyBump(w.LastPolicyBump(), before+4, w.owner.PersonID, w.m1)
}

// Назначение пустой группе и его снятие ничьих прав не меняют: policy_version не растёт и события для relay W1.07
// нет — пустой personIds означал бы «каждый участник» и context.changed всему тенанту (как правка роли без держателей).
func TestPolicyNotBumpedForEmptyGroup(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	empty := w.Group("Пустая", w.f1)
	before, events := w.PolicyVersion(), len(w.PolicyBumps())
	a, err := w.create(t, w.owner, accessapi.AssignmentCreate{PrincipalType: accessapi.AssignmentCreatePrincipalTypeGroup,
		PrincipalId: empty, RoleId: w.trips, Scope: unitScope(w.f1, true)})
	if err != nil {
		t.Fatal(err)
	}
	if v, n := w.PolicyVersion(), len(w.PolicyBumps()); v != before || n != events {
		t.Errorf("assignment to an empty group: version %d → %d, policy events %d → %d", before, v, events, n)
	}
	if err := w.revoke(t, w.owner, a.Id); err != nil {
		t.Fatal(err)
	}
	if v, n := w.PolicyVersion(), len(w.PolicyBumps()); v != before || n != events {
		t.Errorf("revocation from an empty group: version %d → %d, policy events %d → %d", before, v, events, n)
	}
}

// Tenant DB без строки access.policy_state: первая команда даёт версию 1, как realtime.BumpPolicy W1.07.
func TestPolicyBumpWithoutRow(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	if _, err := w.Tenant.Exec(t.Context(), `delete from access.policy_state`); err != nil {
		t.Fatal(err)
	}
	if _, err := w.create(t, w.owner, member(w.m2, w.review, unitScope(w.f2, false))); err != nil {
		t.Fatal(err)
	}
	w.CheckPolicyBump(w.LastPolicyBump(), 1, w.m2)
	if v := w.PolicyVersion(); v != 1 {
		t.Errorf("policy version %d, want 1", v)
	}
}
