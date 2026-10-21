//go:build integration

package knowledge

import (
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"   //nolint:depguard // integration test: role names of the test cluster
	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: clock of the suites
)

// The places of the objects of the knowledge base for the evaluator of W4.01 (explainAccess of the access module):
// a space — its unit and level; a page — its space, ancestors and branch with the access lists.

func TestResolverPlaces(t *testing.T) { //nolint:paralleltest // reads the seed the commands change
	sp, err := SpaceResolver{Pools: pools}.Place(t.Context(), tenantA, pid("sp-log"))
	require.NoError(t, err)
	assert.Equal(t, pid("f-msk-sever"), sp.Unit)
	assert.Equal(t, authz.SpaceContainer(authz.LevelLimited), sp.Container)
	none, err := SpaceResolver{Pools: pools}.Place(t.Context(), tenantA, uuid.New())
	require.NoError(t, err)
	assert.Equal(t, authz.Place{}, none, "a space that does not exist has no place")

	pg, err := PageResolver{Pools: pools, Relations: relations{}}.Place(t.Context(), tenantA, pid("kb-drv-4"))
	require.NoError(t, err)
	assert.Equal(t, pid("f-msk-sever"), pg.Unit)
	assert.Equal(t, map[string]uuid.UUID{authz.KindSpace: pid("sp-log")}, pg.Containers)
	assert.Equal(t, []uuid.UUID{pid("kb-f-drv")}, pg.Ancestors)
	require.Len(t, pg.Nodes, 2)
	assert.Equal(t, authz.Node{ID: pid("kb-f-drv"), Kind: authz.KindPage, Mode: authz.NodeListed, Entries: []authz.Entry{
		{Kind: authz.EntryRole, Ref: pid("r-driver"), Unit: pid("f-msk-sever")},
		{Kind: authz.EntryRole, Ref: pid("r-kb-editor"), Edit: true},
	}}, pg.Nodes[0])
	assert.Equal(t, authz.NodeEdit, pg.Nodes[1].Mode)

	sec, err := PageResolver{Pools: pools, Relations: relations{}}.Place(t.Context(), tenantA, pid("kb-o-obj-42-2"))
	require.NoError(t, err)
	require.Len(t, sec.Nodes, 3)
	assert.Equal(t, authz.Entry{Kind: authz.EntryRelation, People: []uuid.UUID{pid("m-sokolov")}}, sec.Nodes[1].Entries[0],
		"the relation «прораб объекта» names the foreman (KB-01)")
}

func TestEvaluatorWithKnowledge(t *testing.T) { //nolint:paralleltest // reads the seed the commands change
	src := authz.PGSource{Pools: pools}
	ev := authz.New(src, src, harness.Now)
	Register(ev, pools, relations{})
	permit := func(proto, action, page string) error {
		tc := tenantctx.TenantContext{TenantID: tenantA, PersonID: pid(proto)}
		return ev.Permit(t.Context(), tc, action, authz.Resource{Objects: map[string]uuid.UUID{authz.KindPage: pid(page)},
			ReadAction: actionRead})
	}
	require.NoError(t, permit("m-kotova", actionRead, "kb-fin"), "the role of the lead of the space reaches its pages")
	require.NoError(t, permit("m-kotova", actionUpdate, "kb-drv-4"), "the lead passes the lists")
	require.NoError(t, permit("m-vasiliev", actionRead, "kb-drv-1"), "a role of the area reads a limited space; the list names his role")
	assert.True(t, problem.Is(permit("m-vasiliev", actionRead, "kb-fin"), problem.CodeNotFound), "«Только выбранные» without him")
	assert.True(t, problem.Is(permit("m-kotova", actionRead, "kb-rep-home"), problem.CodeNotFound), "a role of another space")
}

// The places of Register change what a grant reaches for every Permit over a space (review of W4.31, return 1): the
// delegation kit of access/assignments checks an assignment scoped space as Resource{Objects: {space: id}} — with the
// place, a grant over the unit of the space covers it too (ADR-0014), not only a grant of the space or the tenant; a
// grant of one space still does not cover another.
func TestEvaluatorDelegationReach(t *testing.T) { //nolint:paralleltest // reads the seed the commands change
	src := authz.PGSource{Pools: pools}
	bare := authz.New(src, src, harness.Now)
	ev := authz.New(src, src, harness.Now)
	Register(ev, pools, relations{})
	onSpace := func(e *authz.Evaluator, proto, action, sp string) error {
		tc := tenantctx.TenantContext{TenantID: tenantA, PersonID: pid(proto)}
		return e.Permit(t.Context(), tc, action, authz.Resource{Objects: map[string]uuid.UUID{authz.KindSpace: pid(sp)}})
	}
	denied := func(err error) bool {
		return problem.Is(err, problem.CodeForbiddenAction) || problem.Is(err, problem.CodeNotFound)
	}
	// «Водитель» over «Север Логистик» (group «Водители Север») and «Логистика» of «Север Логистик».
	assert.True(t, denied(onSpace(bare, "m-vasiliev", actionRead, "sp-log")), "without the place a unit grant does not reach a space")
	require.NoError(t, onSpace(ev, "m-vasiliev", actionRead, "sp-log"), "with it the grant over the unit of the space does")
	assert.True(t, denied(onSpace(ev, "m-vasiliev", actionUpdate, "sp-log")), "only the actions of the role")
	assert.True(t, denied(onSpace(ev, "m-vasiliev", actionRead, "sp-own")), "a closed space of the whole organization")
	// The lead of «Логистика» (a grant of the space): the space only, before and after.
	require.NoError(t, onSpace(bare, "m-kotova", actionAccess, "sp-log"))
	require.NoError(t, onSpace(ev, "m-kotova", actionAccess, "sp-log"))
	assert.True(t, denied(onSpace(ev, "m-kotova", actionAccess, "sp-spa")), "a grant of one space does not cover another")
}

func TestPGMemberships(t *testing.T) { //nolint:paralleltest // the control DB of the fixtures
	control, err := pgxpool.New(t.Context(), fx.ControlURL(migrations.RoleAPI))
	require.NoError(t, err)
	defer control.Close()
	owner, err := fx.Actor("a.owner")
	require.NoError(t, err)
	manager, err := fx.Actor("a.manager-msk1")
	require.NoError(t, err)
	ids := []uuid.UUID{owner.Memberships[0].MembershipID, manager.Memberships[0].MembershipID, uuid.New()}
	got, err := PGMemberships{DB: control}.Memberships(t.Context(), tenantA, ids)
	require.NoError(t, err)
	assert.Equal(t, map[uuid.UUID]Membership{
		ids[0]: {Status: "active", Owner: true},
		ids[1]: {Status: "active"},
	}, got)
	empty, err := PGMemberships{DB: control}.Memberships(t.Context(), tenantA, nil)
	require.NoError(t, err)
	assert.Empty(t, empty)
}
