//go:build integration

package org

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W1.05: shared helpers of org, people, importer (integratorNotes)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

func listAll(ctx context.Context, t *testing.T, e env, limit *int) []accessapi.OrgUnit {
	t.Helper()
	var out []accessapi.OrgUnit
	var cursor *string
	for range 50 {
		resp, err := e.srv.ListOrgUnits(ctx, accessapi.ListOrgUnitsRequestObject{
			TenantId: tenantA(t), Params: accessapi.ListOrgUnitsParams{Cursor: cursor, Limit: limit},
		})
		require.NoError(t, err)
		page, ok := resp.(accessapi.ListOrgUnits200JSONResponse)
		require.True(t, ok, "%T", resp)
		out = append(out, page.Body.Items...)
		if page.Body.NextCursor == nil {
			return out
		}
		cursor = page.Body.NextCursor
	}
	t.Fatal("too many pages")
	return nil
}

func unitIDs(us []accessapi.OrgUnit) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(us))
	for _, u := range us {
		out = append(out, u.Id)
	}
	return out
}

func TestListOrgUnitsByScope(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	// Other tests of the package create units in parallel (a branch under Москва-1 is in the scope of its
	// manager): the fixture units are checked by presence and absence, not as the whole list.
	got := unitIDs(listAll(e.as(t, "a.manager-msk1"), t, e, nil))
	assert.Contains(t, got, id(t, "unit:a.msk1"))
	for _, ref := range []string{"unit:a.msk", "unit:a.msk2", "unit:a.smr1", "unit:a.spb1", "unit:b.msk1"} {
		assert.NotContains(t, got, id(t, ref), "a firm manager sees the firm only, not %s", ref)
	}

	for _, u := range listAll(e.as(t, "a.manager-msk1"), t, e, nil) {
		if u.Id == id(t, "unit:a.msk1") {
			assert.Nil(t, u.ParentId, "an invisible parent is not disclosed")
		}
	}

	got = unitIDs(listAll(e.as(t, "a.two-roles"), t, e, nil))
	assert.Subset(t, got, []uuid.UUID{id(t, "unit:a.msk1"), id(t, "unit:a.smr2")}, "two roles — union")
	for _, ref := range []string{"unit:a.msk", "unit:a.smr", "unit:a.smr1", "unit:a.msk2"} {
		assert.NotContains(t, got, id(t, ref), "no parents and no neighbours: %s", ref)
	}

	got = unitIDs(listAll(e.as(t, "a.region-msk"), t, e, nil))
	assert.Contains(t, got, id(t, "unit:a.msk"))
	assert.Contains(t, got, id(t, "unit:a.msk4"))
	assert.NotContains(t, got, id(t, "unit:a.smr1"))
}

func TestListOrgUnitsPages(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := e.as(t, "a.owner")
	all := listAll(ctx, t, e, nil)
	three := 3
	paged := listAll(ctx, t, e, &three)
	// Other tests create units in parallel: pages are checked for duplicates and for every fixture unit.
	seen := map[uuid.UUID]bool{}
	for _, u := range unitIDs(paged) {
		assert.False(t, seen[u], "unit %s on two pages", u)
		seen[u] = true
	}
	assert.Subset(t, unitIDs(paged), []uuid.UUID{id(t, "unit:a.msk"), id(t, "unit:a.msk1"), id(t, "unit:a.smr2"), id(t, "unit:a.spb4")})
	for _, ref := range []string{"unit:a.msk", "unit:a.smr2", "unit:a.spb4"} {
		assert.Contains(t, unitIDs(all), id(t, ref))
	}
	assert.NotContains(t, unitIDs(all), id(t, "unit:b.msk1"))

	bad := "garbage"
	_, err := e.srv.ListOrgUnits(ctx, accessapi.ListOrgUnitsRequestObject{TenantId: tenantA(t), Params: accessapi.ListOrgUnitsParams{Cursor: &bad}})
	assert.True(t, problem.Is(err, problem.CodeMalformedRequest), "%v", err)
}

func getUnit(ctx context.Context, t *testing.T, e env, unit uuid.UUID) (accessapi.GetOrgUnit200JSONResponse, error) {
	t.Helper()
	resp, err := e.srv.GetOrgUnit(ctx, accessapi.GetOrgUnitRequestObject{TenantId: tenantA(t), OrgUnitId: unit})
	if err != nil {
		return accessapi.GetOrgUnit200JSONResponse{}, err
	}
	ok, is := resp.(accessapi.GetOrgUnit200JSONResponse)
	require.True(t, is, "%T", resp)
	return ok, nil
}

func TestGetOrgUnit(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := e.as(t, "a.manager-msk1")
	got, err := getUnit(ctx, t, e, id(t, "unit:a.msk1"))
	require.NoError(t, err)
	assert.Equal(t, "Москва-1", got.Body.Name)
	assert.Equal(t, accessapi.OrgUnitKindCompany, got.Body.Kind)
	assert.Equal(t, accessapi.OrgUnitStatusActive, got.Body.Status)
	assert.Nil(t, got.Body.ParentId, "the region is invisible to the firm manager: its id is not disclosed (AC-01)")
	assert.Equal(t, kit.ETag(got.Body.Revision), *got.Headers.ETag)
	owners, err := getUnit(e.as(t, "a.owner"), t, e, id(t, "unit:a.msk1"))
	require.NoError(t, err)
	require.NotNil(t, owners.Body.ParentId)
	assert.Equal(t, id(t, "unit:a.msk"), *owners.Body.ParentId)
	region, err := getUnit(e.as(t, "a.region-msk"), t, e, id(t, "unit:a.msk1"))
	require.NoError(t, err)
	assert.Equal(t, owners.Body.ParentId, region.Body.ParentId, "a visible parent is shown")

	for _, ref := range []string{"unit:a.msk2", "unit:a.msk", "unit:b.msk1"} {
		_, err := getUnit(ctx, t, e, id(t, ref))
		assert.True(t, problem.Is(err, problem.CodeNotFound), "%s: %v", ref, err)
	}
	_, err = getUnit(ctx, t, e, uuid.New())
	assert.True(t, problem.Is(err, problem.CodeNotFound), "missing id: %v", err)
}

func create(ctx context.Context, t *testing.T, e env, parent *uuid.UUID, name string, kind accessapi.OrgUnitCreateKind) (accessapi.CreateOrgUnit201JSONResponse, error) {
	t.Helper()
	resp, err := e.srv.CreateOrgUnit(ctx, accessapi.CreateOrgUnitRequestObject{
		TenantId: tenantA(t), Body: &accessapi.CreateOrgUnitJSONRequestBody{ParentId: parent, Name: name, Kind: kind},
	})
	if err != nil {
		return accessapi.CreateOrgUnit201JSONResponse{}, err
	}
	ok, is := resp.(accessapi.CreateOrgUnit201JSONResponse)
	require.True(t, is, "%T", resp)
	return ok, nil
}

// unique makes a unit name unique: the fixture world is shared by the tests and by repeated runs (-count).
func unique(name string) string { return name + " " + uuid.NewString()[:8] }

func ancestors(t *testing.T, e env, unit uuid.UUID) []uuid.UUID {
	t.Helper()
	rows, err := e.pool(t).Query(t.Context(), `select ancestor_id from org.unit_closure where descendant_id = $1 order by depth`, unit)
	require.NoError(t, err)
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var a uuid.UUID
		require.NoError(t, rows.Scan(&a))
		out = append(out, a)
	}
	require.NoError(t, rows.Err())
	return out
}

func auditCount(t *testing.T, e env, action string, target uuid.UUID) int {
	t.Helper()
	var n int
	require.NoError(t, e.pool(t).QueryRow(t.Context(),
		`select count(*) from audit.events where action = $1 and target_id = $2`, action, target).Scan(&n))
	return n
}

func TestCreateOrgUnit(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	owner := e.as(t, "a.owner")
	msk1 := id(t, "unit:a.msk1")
	name := unique("Филиал Север")
	got, err := create(owner, t, e, &msk1, name, accessapi.OrgUnitCreateKindBranch)
	require.NoError(t, err)
	u := got.Body
	assert.Equal(t, accessapi.OrgUnitKindBranch, u.Kind)
	assert.Equal(t, int64(1), u.Revision)
	assert.Equal(t, kit.ETag(1), *got.Headers.ETag)
	assert.Equal(t, []uuid.UUID{u.Id, msk1, id(t, "unit:a.msk")}, ancestors(t, e, u.Id), "closure: itself, firm, region")
	var tz string
	require.NoError(t, e.pool(t).QueryRow(t.Context(), `select time_zone from org.units where id = $1`, u.Id).Scan(&tz))
	assert.Equal(t, "Europe/Moscow", tz, "the zone is the parent's")
	assert.Equal(t, 1, auditCount(t, e, "org.unit.create", u.Id))

	// The manager of Москва-1 sees the new branch: its grant covers the subtree.
	_, err = getUnit(e.as(t, "a.manager-msk1"), t, e, u.Id)
	require.NoError(t, err)

	_, err = create(owner, t, e, &msk1, strings.ToLower(name), accessapi.OrgUnitCreateKindBranch)
	assert.True(t, problem.Is(err, kit.CodeValidationFailed), "a sibling with the same name (case-insensitive): %v", err)

	top, err := create(owner, t, e, nil, unique("Казань"), accessapi.OrgUnitCreateKindRegion)
	require.NoError(t, err)
	assert.Nil(t, top.Body.ParentId)
	assert.Equal(t, []uuid.UUID{top.Body.Id}, ancestors(t, e, top.Body.Id))
}

func TestCreateOrgUnitScope(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	admin := e.as(t, "a.admin") // org_units.read in the whole tenant, no org_units.manage
	msk := id(t, "unit:a.msk")
	_, err := create(admin, t, e, &msk, "Чужая фирма", accessapi.OrgUnitCreateKindCompany)
	assert.True(t, problem.Is(err, problem.CodeForbiddenAction), "visible parent without the right: %v", err)
	_, err = create(admin, t, e, nil, "Чужой регион", accessapi.OrgUnitCreateKindRegion)
	assert.True(t, problem.Is(err, problem.CodeForbiddenAction), "top level without the tenant-wide right: %v", err)

	owner := e.as(t, "a.owner")
	for _, parent := range []uuid.UUID{uuid.New(), id(t, "unit:b.msk1")} {
		_, err = create(owner, t, e, &parent, "Филиал", accessapi.OrgUnitCreateKindBranch)
		assert.True(t, problem.Is(err, kit.CodeValidationFailed), "unknown parent %s: %v", parent, err)
	}
	// A unit the actor cannot see answers like an unknown one (AC-01).
	smr := id(t, "unit:a.smr1")
	_, err = create(e.as(t, "a.manager-msk1"), t, e, &smr, "Филиал", accessapi.OrgUnitCreateKindBranch)
	assert.True(t, problem.Is(err, kit.CodeValidationFailed), "invisible parent: %v", err)
}

func preview(ctx context.Context, t *testing.T, e env, unit uuid.UUID, parent *uuid.UUID) (accessapi.OrgUnitMovePreview, error) {
	t.Helper()
	resp, err := e.srv.PreviewOrgUnitMove(ctx, accessapi.PreviewOrgUnitMoveRequestObject{
		TenantId: tenantA(t), OrgUnitId: unit, Params: accessapi.PreviewOrgUnitMoveParams{ParentId: parent},
	})
	if err != nil {
		return accessapi.OrgUnitMovePreview{}, err
	}
	ok, is := resp.(accessapi.PreviewOrgUnitMove200JSONResponse)
	require.True(t, is, "%T", resp)
	return ok.Body, nil
}

func TestPreviewOrgUnitMove(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	owner := e.as(t, "a.owner")
	msk, msk1, smr := id(t, "unit:a.msk"), id(t, "unit:a.msk1"), id(t, "unit:a.smr")
	got, err := preview(owner, t, e, msk1, &smr)
	require.NoError(t, err)
	assert.Equal(t, msk1, got.OrgUnitId)
	assert.Equal(t, &msk, got.FromParentId)
	assert.Equal(t, &smr, got.ToParentId)
	assert.Equal(t, int64(0), got.AssignmentsGainingScope)
	assert.GreaterOrEqual(t, got.AssignmentsLosingScope, int64(1))
	assert.Positive(t, got.MemberCount, "people with their home in Москва-1")
	var losers []uuid.UUID
	for _, p := range got.AffectedPeople {
		assert.Equal(t, accessapi.Loses, p.Change)
		losers = append(losers, p.MemberId)
	}
	assert.Contains(t, losers, id(t, "person:a.region-msk@a"), "the region manager loses the firm")
	assert.NotContains(t, losers, id(t, "person:a.manager-msk1@a"), "a grant on the moved unit itself moves with it")
	assert.Equal(t, int64(0), got.HiddenCount)

	// Back: Самара-2 under Москва — the region manager of Москва gains it.
	smr2 := id(t, "unit:a.smr2")
	got, err = preview(owner, t, e, smr2, &msk)
	require.NoError(t, err)
	var gainers []uuid.UUID
	for _, p := range got.AffectedPeople {
		if p.Change == accessapi.Gains {
			gainers = append(gainers, p.MemberId)
		}
	}
	assert.Contains(t, gainers, id(t, "person:a.region-msk@a"))

	_, err = preview(owner, t, e, msk, &msk1)
	assert.True(t, problem.Is(err, kit.CodeValidationFailed), "a cycle: %v", err)
	_, err = preview(owner, t, e, msk1, &msk1)
	assert.True(t, problem.Is(err, kit.CodeValidationFailed), "under itself: %v", err)
	_, err = preview(owner, t, e, id(t, "unit:b.msk1"), &smr)
	assert.True(t, problem.Is(err, problem.CodeNotFound), "a unit of tenant B: %v", err)
	missing := uuid.New()
	_, err = preview(owner, t, e, msk1, &missing)
	assert.True(t, problem.Is(err, kit.CodeValidationFailed), "unknown new parent: %v", err)

	top, err := preview(owner, t, e, msk1, nil)
	require.NoError(t, err)
	assert.Nil(t, top.ToParentId)
}

func TestPreviewOrgUnitMoveScope(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	admin := e.as(t, "a.admin") // reads the whole structure, manages nothing
	smr := id(t, "unit:a.smr")
	_, err := preview(admin, t, e, id(t, "unit:a.msk1"), &smr)
	assert.True(t, problem.Is(err, problem.CodeNotFound), "the moved unit is outside org_units.manage: %v", err)
}

func update(ctx context.Context, t *testing.T, e env, unit uuid.UUID, ifMatch string, body accessapi.OrgUnitPatch) (accessapi.OrgUnit, error) {
	t.Helper()
	resp, err := e.srv.UpdateOrgUnit(ctx, accessapi.UpdateOrgUnitRequestObject{
		TenantId: tenantA(t), OrgUnitId: unit, Params: accessapi.UpdateOrgUnitParams{IfMatch: ifMatch}, Body: &body,
	})
	if err != nil {
		return accessapi.OrgUnit{}, err
	}
	ok, is := resp.(accessapi.UpdateOrgUnit200JSONResponse)
	require.True(t, is, "%T", resp)
	assert.Equal(t, kit.ETag(ok.Body.Revision), *ok.Headers.ETag)
	return ok.Body, nil
}

func policyVersion(t *testing.T, e env) int64 {
	t.Helper()
	var v int64
	require.NoError(t, e.pool(t).QueryRow(t.Context(), `select policy_version from access.policy_state`).Scan(&v))
	return v
}

// The move changes access exactly as the preview says (S1-08): the region manager of Москва reads a firm under
// Москва and stops reading it once the firm moves to Самара.
func TestMoveOrgUnitChangesAccess(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	owner := e.as(t, "a.owner")
	msk, smr := id(t, "unit:a.msk"), id(t, "unit:a.smr")
	firm, err := create(owner, t, e, &msk, unique("Фирма для переноса"), accessapi.OrgUnitCreateKindCompany)
	require.NoError(t, err)
	team, err := create(owner, t, e, &firm.Body.Id, unique("Бригада"), accessapi.OrgUnitCreateKindTeam)
	require.NoError(t, err)
	region := e.tc(t, "a.region-msk", "a")
	read := authz.Resource{Unit: team.Body.Id}
	require.NoError(t, e.ev.Permit(t.Context(), region, "org_units.read", read), "before the move")

	before := policyVersion(t, e)
	_, err = update(owner, t, e, firm.Body.Id, kit.ETag(2), accessapi.OrgUnitPatch{ParentId: &smr})
	assert.True(t, problem.Is(err, kit.CodeRevisionMismatch), "stale If-Match: %v", err)
	_, err = update(owner, t, e, firm.Body.Id, "", accessapi.OrgUnitPatch{ParentId: &smr})
	assert.True(t, problem.Is(err, kit.CodeRevisionRequired), "no If-Match: %v", err)

	moved, err := update(owner, t, e, firm.Body.Id, kit.ETag(1), accessapi.OrgUnitPatch{ParentId: &smr})
	require.NoError(t, err)
	assert.Equal(t, &smr, moved.ParentId)
	assert.Equal(t, int64(2), moved.Revision)
	assert.Equal(t, []uuid.UUID{team.Body.Id, firm.Body.Id, smr}, ancestors(t, e, team.Body.Id), "the subtree moved with the unit")
	assert.Greater(t, policyVersion(t, e), before)
	assert.Equal(t, 1, auditCount(t, e, "org.unit.move", firm.Body.Id))

	err = e.ev.Permit(t.Context(), region, "org_units.read", read)
	assert.True(t, problem.Is(err, problem.CodeNotFound), "after the move: %v", err)

	// A unit cannot move under its own descendant.
	_, err = update(owner, t, e, firm.Body.Id, kit.ETag(2), accessapi.OrgUnitPatch{ParentId: &team.Body.Id})
	assert.True(t, problem.Is(err, kit.CodeInvalidTransition), "cycle: %v", err)
}

func TestRenameAndArchiveOrgUnit(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	owner := e.as(t, "a.owner")
	spb := id(t, "unit:a.spb")
	u, err := create(owner, t, e, &spb, unique("Склад Петербург"), accessapi.OrgUnitCreateKindBranch)
	require.NoError(t, err)

	_, err = update(owner, t, e, u.Body.Id, kit.ETag(1), accessapi.OrgUnitPatch{Name: new("Петербург-1")})
	assert.True(t, problem.Is(err, kit.CodeValidationFailed), "the name of a sibling: %v", err)
	renamed, err := update(owner, t, e, u.Body.Id, kit.ETag(1), accessapi.OrgUnitPatch{Name: new(unique("Склад Петербург-Юг"))})
	require.NoError(t, err)
	assert.Contains(t, renamed.Name, "Склад Петербург-Юг")

	archived := accessapi.OrgUnitPatchStatusArchived
	got, err := update(owner, t, e, u.Body.Id, kit.ETag(2), accessapi.OrgUnitPatch{Status: &archived})
	require.NoError(t, err)
	assert.Equal(t, accessapi.OrgUnitStatusArchived, got.Status)

	// Москва-1 has people with their home there and cannot be archived.
	msk1, err := getUnit(owner, t, e, id(t, "unit:a.msk1"))
	require.NoError(t, err)
	_, err = update(owner, t, e, msk1.Body.Id, *msk1.Headers.ETag, accessapi.OrgUnitPatch{Status: &archived})
	assert.True(t, problem.Is(err, kit.CodeInvalidTransition), "a unit with people: %v", err)
	// Москва has active firms.
	mskUnit, err := getUnit(owner, t, e, id(t, "unit:a.msk"))
	require.NoError(t, err)
	_, err = update(owner, t, e, mskUnit.Body.Id, *mskUnit.Headers.ETag, accessapi.OrgUnitPatch{Status: &archived})
	assert.True(t, problem.Is(err, kit.CodeInvalidTransition), "a unit with active children: %v", err)
}

// detail is the user-facing text of a Problem error.
func detail(err error) string {
	if p, ok := errors.AsType[*problem.Error](err); ok {
		return p.Detail
	}
	return ""
}

var (
	readUnits   = []string{"org_units.read"}
	manageUnits = []string{"org_units.read", "org_units.manage"}
)

// T-4 of the brief: a move needs org_units.manage over the old and the new parent, in the preview and in the move.
func TestMoveNeedsBothParents(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	owner := e.as(t, "a.owner")
	msk, smr, msk2 := id(t, "unit:a.msk"), id(t, "unit:a.smr"), id(t, "unit:a.msk2")
	mine, err := create(owner, t, e, &msk, unique("Фирма Москвы"), accessapi.OrgUnitCreateKindCompany)
	require.NoError(t, err)
	foreign, err := create(owner, t, e, &smr, unique("Фирма Самары"), accessapi.OrgUnitCreateKindCompany)
	require.NoError(t, err)
	// Reads the whole structure; manages Москва with its firms and one firm of Самара, not Самара itself.
	actor := e.person(t, grant{uuid.Nil, readUnits}, grant{msk, manageUnits}, grant{foreign.Body.Id, manageUnits})

	_, err = preview(actor, t, e, mine.Body.Id, &smr)
	assert.True(t, problem.Is(err, problem.CodeForbiddenAction), "preview, a visible new parent without the right: %v", err)
	_, err = update(actor, t, e, mine.Body.Id, kit.ETag(1), accessapi.OrgUnitPatch{ParentId: &smr})
	assert.True(t, problem.Is(err, problem.CodeForbiddenAction), "move, a visible new parent without the right: %v", err)
	_, err = preview(actor, t, e, foreign.Body.Id, &msk)
	assert.True(t, problem.Is(err, problem.CodeForbiddenAction), "preview, the old parent without the right: %v", err)
	_, err = update(actor, t, e, foreign.Body.Id, kit.ETag(1), accessapi.OrgUnitPatch{ParentId: &msk})
	assert.True(t, problem.Is(err, problem.CodeForbiddenAction), "move, the old parent without the right: %v", err)
	assert.Equal(t, []uuid.UUID{foreign.Body.Id, smr}, ancestors(t, e, foreign.Body.Id), "nothing moved")

	moved, err := update(actor, t, e, mine.Body.Id, kit.ETag(1), accessapi.OrgUnitPatch{ParentId: &msk2})
	require.NoError(t, err, "both parents in its region")
	assert.Equal(t, &msk2, moved.ParentId)
}

// A new parent the actor cannot see is the same 422 as an unknown one in the move too (AC-01, brief §10 item 5).
func TestMoveToInvisibleParent(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	msk, smr := id(t, "unit:a.msk"), id(t, "unit:a.smr")
	mine, err := create(e.as(t, "a.owner"), t, e, &msk, unique("Фирма Москвы"), accessapi.OrgUnitCreateKindCompany)
	require.NoError(t, err)
	actor := e.person(t, grant{msk, manageUnits}) // Самара is invisible

	_, err = preview(actor, t, e, mine.Body.Id, &smr)
	assert.True(t, problem.Is(err, kit.CodeValidationFailed), "preview: %v", err)
	missing := uuid.New()
	for _, parent := range []uuid.UUID{smr, missing} {
		_, err = update(actor, t, e, mine.Body.Id, kit.ETag(1), accessapi.OrgUnitPatch{ParentId: &parent})
		assert.True(t, problem.Is(err, kit.CodeValidationFailed), "move under %s: %v", parent, err)
		assert.Equal(t, "Родительское подразделение не найдено.", detail(err), "the text of the mock (units.ts)")
	}
}

// The preview does not list the people the actor cannot read: they are counted in hiddenCount only.
func TestPreviewHiddenCount(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	owner := e.as(t, "a.owner")
	msk, msk1, msk2 := id(t, "unit:a.msk"), id(t, "unit:a.msk1"), id(t, "unit:a.msk2")
	team, err := create(owner, t, e, &msk1, unique("Бригада"), accessapi.OrgUnitCreateKindTeam)
	require.NoError(t, err)

	all, err := preview(owner, t, e, team.Body.Id, &msk2)
	require.NoError(t, err)
	require.NotEmpty(t, all.AffectedPeople, "the managers of Москва-1 lose, of Москва-2 gain")
	assert.Equal(t, int64(0), all.HiddenCount)

	blind := e.person(t, grant{msk, manageUnits}) // no members.read
	got, err := preview(blind, t, e, team.Body.Id, &msk2)
	require.NoError(t, err)
	assert.Empty(t, got.AffectedPeople)
	assert.Equal(t, int64(0), got.AssignmentsLosingScope, "an assignment of hidden people only is not counted")
	assert.Equal(t, int64(0), got.AssignmentsGainingScope)
	seen := map[uuid.UUID]bool{}
	for _, p := range all.AffectedPeople {
		seen[p.MemberId] = true
	}
	assert.GreaterOrEqual(t, got.HiddenCount, int64(len(seen)), "every person the owner sees is hidden")
	assert.Equal(t, int64(0), got.MemberCount)
}

// The answer of updateOrgUnit hides an invisible parent as getOrgUnit does (Q-W1.05-12).
func TestUpdateOrgUnitHidesInvisibleParent(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	smr := id(t, "unit:a.smr")
	firm, err := create(e.as(t, "a.owner"), t, e, &smr, unique("Фирма Самары"), accessapi.OrgUnitCreateKindCompany)
	require.NoError(t, err)
	actor := e.person(t, grant{firm.Body.Id, manageUnits}) // the firm only, not Самара

	got, err := update(actor, t, e, firm.Body.Id, kit.ETag(1), accessapi.OrgUnitPatch{Name: new(unique("Фирма Самары-Юг"))})
	require.NoError(t, err)
	assert.Nil(t, got.ParentId, "the parent the actor cannot see is not disclosed")
	read, err := getUnit(actor, t, e, firm.Body.Id)
	require.NoError(t, err)
	assert.Nil(t, read.Body.ParentId)
}

// A restore follows the rules of a new unit: a free name among the active siblings and an active parent.
func TestRestoreOrgUnit(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	owner := e.as(t, "a.owner")
	archived, active := accessapi.OrgUnitPatchStatusArchived, accessapi.OrgUnitPatchStatusActive
	msk := id(t, "unit:a.msk")
	name := unique("Фирма в архиве")
	old, err := create(owner, t, e, &msk, name, accessapi.OrgUnitCreateKindCompany)
	require.NoError(t, err)
	_, err = update(owner, t, e, old.Body.Id, kit.ETag(1), accessapi.OrgUnitPatch{Status: &archived})
	require.NoError(t, err)
	_, err = create(owner, t, e, &msk, name, accessapi.OrgUnitCreateKindCompany)
	require.NoError(t, err, "the name of an archived sibling is free")
	_, err = update(owner, t, e, old.Body.Id, kit.ETag(2), accessapi.OrgUnitPatch{Status: &active})
	assert.True(t, problem.Is(err, kit.CodeValidationFailed), "the name is taken by an active sibling: %v", err)
	assert.Equal(t, "Подразделение с таким названием уже есть.", detail(err))

	region, err := create(owner, t, e, nil, unique("Регион"), accessapi.OrgUnitCreateKindRegion)
	require.NoError(t, err)
	firm, err := create(owner, t, e, &region.Body.Id, unique("Фирма"), accessapi.OrgUnitCreateKindCompany)
	require.NoError(t, err)
	_, err = update(owner, t, e, firm.Body.Id, kit.ETag(1), accessapi.OrgUnitPatch{Status: &archived})
	require.NoError(t, err)
	_, err = update(owner, t, e, region.Body.Id, kit.ETag(1), accessapi.OrgUnitPatch{Status: &archived})
	require.NoError(t, err)
	_, err = update(owner, t, e, firm.Body.Id, kit.ETag(2), accessapi.OrgUnitPatch{Status: &active})
	assert.True(t, problem.Is(err, kit.CodeValidationFailed), "the parent is archived: %v", err)
	assert.Equal(t, "Родительское подразделение в архиве.", detail(err))

	restored, err := update(owner, t, e, region.Body.Id, kit.ETag(2), accessapi.OrgUnitPatch{Status: &active})
	require.NoError(t, err)
	assert.Equal(t, accessapi.OrgUnitStatusActive, restored.Status)
}

// Texts of the answers are the texts of the mock (MSW units.ts, people.ts) and of the contract examples.
func TestOrgUnitTexts(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	owner := e.as(t, "a.owner")
	msk, msk1 := id(t, "unit:a.msk"), id(t, "unit:a.msk1")
	_, err := preview(owner, t, e, msk, &msk1)
	assert.Equal(t, "Нельзя перенести подразделение внутрь самого себя.", detail(err), "preview, 422 (contract example)")
	missing := uuid.New()
	_, err = preview(owner, t, e, msk1, &missing)
	assert.Equal(t, "Подразделение не найдено.", detail(err), "preview, an unknown parent")
	_, err = create(owner, t, e, &missing, "Филиал", accessapi.OrgUnitCreateKindBranch)
	assert.Equal(t, "Родительское подразделение не найдено.", detail(err), "create, an unknown parent")

	firm, err := create(owner, t, e, &msk, unique("Фирма"), accessapi.OrgUnitCreateKindCompany)
	require.NoError(t, err)
	team, err := create(owner, t, e, &firm.Body.Id, unique("Бригада"), accessapi.OrgUnitCreateKindTeam)
	require.NoError(t, err)
	_, err = update(owner, t, e, firm.Body.Id, kit.ETag(1), accessapi.OrgUnitPatch{ParentId: &team.Body.Id})
	assert.True(t, problem.Is(err, kit.CodeInvalidTransition), "%v", err)
	assert.Equal(t, "Подразделение нельзя перенести внутрь самого себя.", detail(err), "move, 409")
}

// Concurrent moves never make a cycle and never leave a stale closure: A under C (in the subtree of B) and B under D
// (in the subtree of A) — one of them is a cycle; a unit created under the moving subtree gets the new ancestors.
func TestConcurrentMovesKeepTheTree(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	owner := e.as(t, "a.owner")
	spb := id(t, "unit:a.spb")
	var created []uuid.UUID
	for range 8 {
		a, err := create(owner, t, e, &spb, unique("A"), accessapi.OrgUnitCreateKindCompany)
		require.NoError(t, err)
		b, err := create(owner, t, e, &spb, unique("B"), accessapi.OrgUnitCreateKindCompany)
		require.NoError(t, err)
		c, err := create(owner, t, e, &b.Body.Id, unique("C"), accessapi.OrgUnitCreateKindTeam)
		require.NoError(t, err)
		d, err := create(owner, t, e, &a.Body.Id, unique("D"), accessapi.OrgUnitCreateKindTeam)
		require.NoError(t, err)
		created = append(created, a.Body.Id, b.Body.Id, c.Body.Id, d.Body.Id)

		var (
			wg    sync.WaitGroup
			moves [2]error
			child uuid.UUID
		)
		move := func(unit, parent uuid.UUID) error {
			_, err := e.srv.UpdateOrgUnit(owner, accessapi.UpdateOrgUnitRequestObject{
				TenantId: tenantA(t), OrgUnitId: unit, Params: accessapi.UpdateOrgUnitParams{IfMatch: kit.ETag(1)},
				Body: &accessapi.OrgUnitPatch{ParentId: &parent},
			})
			return err
		}
		wg.Go(func() { moves[0] = move(a.Body.Id, c.Body.Id) })
		wg.Go(func() { moves[1] = move(b.Body.Id, d.Body.Id) })
		wg.Go(func() {
			resp, err := e.srv.CreateOrgUnit(owner, accessapi.CreateOrgUnitRequestObject{
				TenantId: tenantA(t), Body: &accessapi.CreateOrgUnitJSONRequestBody{
					ParentId: &d.Body.Id, Name: unique("E"), Kind: accessapi.OrgUnitCreateKindTeam,
				},
			})
			if ok, is := resp.(accessapi.CreateOrgUnit201JSONResponse); err == nil && is {
				child = ok.Body.Id
			}
		})
		wg.Wait()
		ok := 0
		for _, err := range moves {
			if err == nil {
				ok++
				continue
			}
			assert.True(t, problem.Is(err, kit.CodeInvalidTransition), "the other move is a cycle: %v", err)
		}
		assert.Equal(t, 1, ok, "exactly one of the two moves")
		require.NotEqual(t, uuid.Nil, child)
		created = append(created, child)
	}
	// The closure equals the parent chains of the units (no cycle, no stale row).
	var diff int
	require.NoError(t, e.pool(t).QueryRow(t.Context(), `
		with recursive chain (unit, anc, depth) as (
		  select u.id, u.id as anc, 0 from org.units u where u.id = any($1)
		  union all
		  select c.unit, u.parent_id, c.depth + 1 from chain c join org.units u on u.id = c.anc
		   where u.parent_id is not null and c.depth < 50
		), closure as (
		  select descendant_id, ancestor_id, depth from org.unit_closure where descendant_id = any($1)
		)
		select (select count(*) from (select * from chain except select * from closure) x)
		     + (select count(*) from (select * from closure except select * from chain) y)`, created).Scan(&diff))
	assert.Zero(t, diff, "org.unit_closure differs from the parent chains")
}

func TestUpdateOrgUnitScope(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	_, err := update(e.as(t, "a.admin"), t, e, id(t, "unit:a.msk1"), kit.ETag(1), accessapi.OrgUnitPatch{Name: new("Чужое имя")})
	assert.True(t, problem.Is(err, problem.CodeForbiddenAction), "visible without org_units.manage: %v", err)
	_, err = update(e.as(t, "a.manager-msk1"), t, e, id(t, "unit:a.msk2"), kit.ETag(1), accessapi.OrgUnitPatch{Name: new("Чужое имя")})
	assert.True(t, problem.Is(err, problem.CodeNotFound), "invisible: %v", err)
	_, err = update(e.as(t, "a.owner"), t, e, id(t, "unit:b.msk1"), kit.ETag(1), accessapi.OrgUnitPatch{Name: new("Чужое имя")})
	assert.True(t, problem.Is(err, problem.CodeNotFound), "a unit of tenant B: %v", err)
}
