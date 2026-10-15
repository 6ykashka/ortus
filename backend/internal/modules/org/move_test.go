package org

import (
	"fmt"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
)

// Tree of the cases: region msk → firm msk1 (moved); region smr; the tenant root has no unit.
var (
	msk  = uuid.MustParse("00000000-0000-4000-8000-000000000001")
	smr  = uuid.MustParse("00000000-0000-4000-8000-000000000002")
	top  = uuid.MustParse("00000000-0000-4000-8000-000000000003") // a common ancestor of msk and smr
	role = uuid.MustParse("00000000-0000-4000-8000-0000000000aa")
)

func person(n int, visible bool) movePerson {
	return movePerson{ID: uuid.NewSHA1(uuid.NameSpaceURL, fmt.Appendf(nil, "p%d", n)), Name: fmt.Sprintf("Человек %d", n), Visible: visible}
}

func assignment(n int, unit uuid.UUID, people ...movePerson) moveAssignment {
	return moveAssignment{ID: uuid.NewSHA1(uuid.NameSpaceURL, fmt.Appendf(nil, "a%d", n)), RoleID: role, Unit: unit, People: people}
}

func TestImpactLosingAndGaining(t *testing.T) {
	t.Parallel()
	alice, bob := person(1, true), person(2, true)
	got := impactOf([]uuid.UUID{msk, top}, []uuid.UUID{smr, top}, []moveAssignment{
		assignment(1, msk, alice),
		assignment(2, smr, bob),
		assignment(3, top, alice, bob), // common ancestor: coverage does not change
	})
	assert.Equal(t, int64(1), got.Losing)
	assert.Equal(t, int64(1), got.Gaining)
	assert.Equal(t, int64(0), got.Hidden)
	assert.Equal(t, []accessapi.OrgUnitMoveImpact{
		{MemberId: alice.ID, DisplayName: alice.Name, Change: accessapi.Loses, RoleId: role, AssignmentId: assignment(1, msk).ID},
		{MemberId: bob.ID, DisplayName: bob.Name, Change: accessapi.Gains, RoleId: role, AssignmentId: assignment(2, smr).ID},
	}, got.People)
}

func TestImpactToTopLevel(t *testing.T) {
	t.Parallel()
	// Without a new parent nothing starts covering the subtree; every old ancestor assignment stops.
	got := impactOf([]uuid.UUID{msk, top}, nil, []moveAssignment{
		assignment(1, msk, person(1, true)),
		assignment(2, top, person(2, true)),
	})
	assert.Equal(t, int64(2), got.Losing)
	assert.Equal(t, int64(0), got.Gaining)
	assert.Len(t, got.People, 2)
}

func TestImpactHidesPeopleOutsideScope(t *testing.T) {
	t.Parallel()
	hidden, seen := person(1, false), person(2, true)
	got := impactOf([]uuid.UUID{msk}, []uuid.UUID{smr}, []moveAssignment{
		assignment(1, msk, hidden),       // only a hidden person: not counted, not listed (Q-W1.00-15)
		assignment(2, msk, hidden, seen), // a visible one: counted, only the visible person is listed
		assignment(3, smr, hidden),       // the same hidden person on the other side counts once
		assignment(4, smr),               // a group without members reaches nobody
	})
	assert.Equal(t, int64(1), got.Losing)
	assert.Equal(t, int64(0), got.Gaining)
	assert.Equal(t, int64(1), got.Hidden, "people, not assignments")
	assert.Len(t, got.People, 1)
	assert.Equal(t, seen.ID, got.People[0].MemberId)
	for _, p := range got.People {
		assert.NotEqual(t, hidden.ID, p.MemberId)
	}
}

func TestImpactListsAtMostFifty(t *testing.T) {
	t.Parallel()
	var many []movePerson
	for i := range 60 {
		many = append(many, person(i, true))
	}
	// Person 0 also gains through a second assignment: entry 61, beyond the limit, but already listed.
	got := impactOf([]uuid.UUID{msk}, []uuid.UUID{smr}, []moveAssignment{
		assignment(1, msk, many...),
		assignment(2, smr, many[0]),
	})
	assert.Len(t, got.People, maxAffected)
	assert.Equal(t, int64(10), got.Hidden, "people 50…59 are beyond the list; person 0 is listed")
	assert.Equal(t, int64(1), got.Losing)
	assert.Equal(t, int64(1), got.Gaining)
}

func TestImpactWithoutAssignments(t *testing.T) {
	t.Parallel()
	got := impactOf([]uuid.UUID{msk}, []uuid.UUID{smr}, nil)
	assert.Equal(t, moveImpact{People: []accessapi.OrgUnitMoveImpact{}}, got)
}
