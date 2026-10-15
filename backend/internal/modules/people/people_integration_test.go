//go:build integration

package people

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W1.05: shared helpers of org, people, importer (integratorNotes)
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: the clock of the fixtures
)

func listAll(ctx context.Context, t *testing.T, e env, unit *uuid.UUID, limit *int) []accessapi.Member {
	t.Helper()
	var out []accessapi.Member
	var cursor *string
	for range 50 {
		resp, err := e.srv.ListMembers(ctx, accessapi.ListMembersRequestObject{
			TenantId: tenantA(t), Params: accessapi.ListMembersParams{Cursor: cursor, Limit: limit, OrgUnitId: unit},
		})
		require.NoError(t, err)
		page, ok := resp.(accessapi.ListMembers200JSONResponse)
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

func memberIDs(ms []accessapi.Member) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(ms))
	for _, m := range ms {
		out = append(out, m.Id)
	}
	return out
}

func refs(t *testing.T, rs ...string) []uuid.UUID {
	t.Helper()
	out := make([]uuid.UUID, 0, len(rs))
	for _, r := range rs {
		out = append(out, id(t, r))
	}
	return out
}

func uniq(ids []uuid.UUID) map[uuid.UUID]bool {
	out := map[uuid.UUID]bool{}
	for _, id := range ids {
		out[id] = true
	}
	return out
}

func TestListMembersByScope(t *testing.T) {
	t.Parallel()
	e := newEnv(t, 0)
	got := memberIDs(listAll(e.as(t, "a.manager-msk1"), t, e, nil, nil))
	assert.Subset(t, got, refs(t, "person:a.manager-msk1@a", "person:a.driver-msk1@a", "person:a.two-roles@a",
		"person:a.driver-earnings@a", "person:a.project-lead@a"))
	for _, r := range []string{"person:a.manager-msk2@a", "person:a.driver-msk2@a", "person:a.region-msk@a",
		"person:a.owner@a", "person:a.manager-expired@a", "person:b.manager-msk1@b"} {
		assert.NotContains(t, got, id(t, r), "a firm manager does not see %s", r)
	}

	got = memberIDs(listAll(e.as(t, "a.region-msk"), t, e, nil, nil))
	assert.Subset(t, got, refs(t, "person:a.region-msk@a", "person:a.owner@a", "person:a.driver-msk2@a", "person:ab.member@a"))
	assert.NotContains(t, got, id(t, "person:a.manager-expired@a"))

	owner := e.as(t, "a.owner")
	all := listAll(owner, t, e, nil, nil)
	assert.Subset(t, memberIDs(all), refs(t, "person:a.owner@a", "person:a.manager-expired@a", "person:ab.member@a"))
	assert.NotContains(t, memberIDs(all), id(t, "person:b.owner@b"))
	two := 2
	// Other tests create cards in parallel: pages are checked for duplicates and for every fixture person.
	paged := memberIDs(listAll(owner, t, e, nil, &two))
	assert.Len(t, uniq(paged), len(paged), "no person on two pages")
	assert.Subset(t, paged, refs(t, "person:a.owner@a", "person:a.manager-expired@a", "person:ab.member@a",
		"person:a.driver-msk2@a", "person:a.admin@a"))

	msk2 := id(t, "unit:a.msk2")
	got = memberIDs(listAll(owner, t, e, &msk2, nil))
	assert.Subset(t, got, refs(t, "person:a.manager-msk2@a", "person:a.driver-msk2@a", "person:ab.member@a"))
	assert.NotContains(t, got, id(t, "person:a.manager-msk1@a"), "the filter narrows to the subtree")
	// The filter never widens: the manager of Москва-1 asking for Москва-2 gets nobody.
	assert.Empty(t, listAll(e.as(t, "a.manager-msk1"), t, e, &msk2, nil))

	bad := "garbage"
	_, err := e.srv.ListMembers(owner, accessapi.ListMembersRequestObject{TenantId: tenantA(t), Params: accessapi.ListMembersParams{Cursor: &bad}})
	assert.True(t, problem.Is(err, problem.CodeMalformedRequest), "%v", err)
}

func getMember(ctx context.Context, t *testing.T, e env, member uuid.UUID) (accessapi.GetMember200JSONResponse, error) {
	t.Helper()
	resp, err := e.srv.GetMember(ctx, accessapi.GetMemberRequestObject{TenantId: tenantA(t), MemberId: member})
	if err != nil {
		return accessapi.GetMember200JSONResponse{}, err
	}
	ok, is := resp.(accessapi.GetMember200JSONResponse)
	require.True(t, is, "%T", resp)
	return ok, nil
}

func TestGetMember(t *testing.T) {
	t.Parallel()
	e := newEnv(t, 0)
	manager := e.as(t, "a.manager-msk1")
	got, err := getMember(manager, t, e, id(t, "person:a.driver-msk1@a"))
	require.NoError(t, err)
	m := got.Body
	assert.Equal(t, id(t, "person:a.driver-msk1@a"), m.Id)
	assert.Equal(t, accessapi.MemberStatusActive, m.Status)
	require.NotNil(t, m.UserId)
	assert.Equal(t, id(t, "account:a.driver-msk1"), *m.UserId)
	assert.Equal(t, []uuid.UUID{id(t, "unit:a.msk1")}, m.OrgUnitIds)
	assert.Equal(t, []accessapi.MemberWorkProfiles{accessapi.MemberWorkProfilesDriver}, m.WorkProfiles)
	require.NotNil(t, m.Email)
	assert.Equal(t, "iso-a.driver-msk1@isolation.test", string(*m.Email))
	assert.Equal(t, kit.ETag(m.Revision), *got.Headers.ETag)

	for _, r := range []string{"person:a.driver-msk2@a", "person:a.owner@a", "person:b.owner@b"} {
		_, err := getMember(manager, t, e, id(t, r))
		assert.True(t, problem.Is(err, problem.CodeNotFound), "%s: %v", r, err)
	}
	_, err = getMember(manager, t, e, uuid.New())
	assert.True(t, problem.Is(err, problem.CodeNotFound), "missing: %v", err)
}

func createMember(ctx context.Context, t *testing.T, e env, body accessapi.MemberCreate) (accessapi.Member, error) {
	t.Helper()
	resp, err := e.srv.CreateMember(ctx, accessapi.CreateMemberRequestObject{TenantId: tenantA(t), Body: &body})
	if err != nil {
		return accessapi.Member{}, err
	}
	ok, is := resp.(accessapi.CreateMember201JSONResponse)
	require.True(t, is, "%T", resp)
	assert.Equal(t, kit.ETag(ok.Body.Revision), *ok.Headers.ETag)
	return ok.Body, nil
}

func card(ctx context.Context, t *testing.T, e env, name, unitRef string) accessapi.Member {
	t.Helper()
	m, err := createMember(ctx, t, e, accessapi.MemberCreate{DisplayName: name, OrgUnitIds: []uuid.UUID{id(t, unitRef)}})
	require.NoError(t, err)
	return m
}

func TestCreateMemberWithoutAccount(t *testing.T) {
	t.Parallel()
	e := newEnv(t, 0)
	admin := e.as(t, "a.admin") // members.manage over the whole tenant
	body := accessapi.MemberCreate{DisplayName: "  Рабочий без входа ", OrgUnitIds: []uuid.UUID{id(t, "unit:a.msk1")}}
	kit.SetString(&body.Email, "worker@alta.example")
	m, err := createMember(admin, t, e, body)
	require.NoError(t, err)
	assert.Equal(t, "Рабочий без входа", m.DisplayName)
	assert.Equal(t, accessapi.MemberStatusActive, m.Status)
	assert.Nil(t, m.UserId, "no account")
	assert.Empty(t, m.WorkProfiles)
	assert.Equal(t, []uuid.UUID{id(t, "unit:a.msk1")}, m.OrgUnitIds)

	var seats int
	require.NoError(t, e.control.QueryRow(t.Context(), `select count(*) from memberships where person_profile_id = $1`, m.Id).Scan(&seats))
	assert.Equal(t, 0, seats, "a card takes no seat and sends no invitation (Q-W1.00-5)")
	var audits int
	require.NoError(t, e.pool(t).QueryRow(t.Context(), `select count(*) from audit.events where action = 'people.person.create' and target_id = $1`, m.Id).Scan(&audits))
	assert.Equal(t, 1, audits)

	// The manager of Москва-1 sees the card in the firm.
	assert.Contains(t, memberIDs(listAll(e.as(t, "a.manager-msk1"), t, e, nil, nil)), m.Id)
}

func withEmail(b accessapi.MemberCreate, email string) accessapi.MemberCreate {
	kit.SetString(&b.Email, email)
	return b
}

func TestCreateMemberValidation(t *testing.T) {
	t.Parallel()
	e := newEnv(t, 0)
	admin := e.as(t, "a.admin")
	msk1, msk2 := id(t, "unit:a.msk1"), id(t, "unit:a.msk2")
	bad := []struct {
		name string
		body accessapi.MemberCreate
	}{
		{"two units (one home unit in the schema)", accessapi.MemberCreate{DisplayName: "Иван", OrgUnitIds: []uuid.UUID{msk1, msk2}}},
		{"no unit", accessapi.MemberCreate{DisplayName: "Иван", OrgUnitIds: nil}},
		{"empty name", accessapi.MemberCreate{DisplayName: "  ", OrgUnitIds: []uuid.UUID{msk1}}},
		{"unknown unit", accessapi.MemberCreate{DisplayName: "Иван", OrgUnitIds: []uuid.UUID{uuid.New()}}},
		{"unit of tenant B", accessapi.MemberCreate{DisplayName: "Иван", OrgUnitIds: []uuid.UUID{id(t, "unit:b.msk1")}}},
		{"bad email", withEmail(accessapi.MemberCreate{DisplayName: "Иван", OrgUnitIds: []uuid.UUID{msk1}}, "ivan")},
	}
	for _, c := range bad {
		_, err := createMember(admin, t, e, c.body)
		assert.True(t, problem.Is(err, kit.CodeValidationFailed), "%s: %v", c.name, err)
	}
	// The manager of Москва-1 reads its firm but cannot create cards there; Москва-2 is invisible to it.
	manager := e.as(t, "a.manager-msk1")
	_, err := createMember(manager, t, e, accessapi.MemberCreate{DisplayName: "Иван", OrgUnitIds: []uuid.UUID{msk1}})
	assert.True(t, problem.Is(err, problem.CodeForbiddenAction), "visible unit without members.manage: %v", err)
	_, err = createMember(manager, t, e, accessapi.MemberCreate{DisplayName: "Иван", OrgUnitIds: []uuid.UUID{msk2}})
	assert.True(t, problem.Is(err, kit.CodeValidationFailed), "invisible unit — like an unknown one: %v", err)
}

func listProfiles(ctx context.Context, t *testing.T, e env, member uuid.UUID) ([]accessapi.WorkProfile, error) {
	t.Helper()
	resp, err := e.srv.ListWorkProfiles(ctx, accessapi.ListWorkProfilesRequestObject{TenantId: tenantA(t), MemberId: member})
	if err != nil {
		return nil, err
	}
	ok, is := resp.(accessapi.ListWorkProfiles200JSONResponse)
	require.True(t, is, "%T", resp)
	assert.Equal(t, member, ok.Body.MemberId)
	return ok.Body.Items, nil
}

func createProfile(ctx context.Context, t *testing.T, e env, member uuid.UUID, body accessapi.WorkProfileCreate) (accessapi.CreateWorkProfile201JSONResponse, error) {
	t.Helper()
	resp, err := e.srv.CreateWorkProfile(ctx, accessapi.CreateWorkProfileRequestObject{TenantId: tenantA(t), MemberId: member, Body: &body})
	if err != nil {
		return accessapi.CreateWorkProfile201JSONResponse{}, err
	}
	ok, is := resp.(accessapi.CreateWorkProfile201JSONResponse)
	require.True(t, is, "%T", resp)
	return ok, nil
}

func updateProfile(ctx context.Context, t *testing.T, e env, member, profile uuid.UUID, ifMatch string, until time.Time) (accessapi.UpdateWorkProfile200JSONResponse, error) {
	t.Helper()
	resp, err := e.srv.UpdateWorkProfile(ctx, accessapi.UpdateWorkProfileRequestObject{
		TenantId: tenantA(t), MemberId: member, WorkProfileId: profile,
		Params: accessapi.UpdateWorkProfileParams{IfMatch: ifMatch}, Body: &accessapi.WorkProfilePatch{ValidUntil: until},
	})
	if err != nil {
		return accessapi.UpdateWorkProfile200JSONResponse{}, err
	}
	ok, is := resp.(accessapi.UpdateWorkProfile200JSONResponse)
	require.True(t, is, "%T", resp)
	return ok, nil
}

func policyVersion(t *testing.T, e env) int64 {
	t.Helper()
	var v int64
	require.NoError(t, e.pool(t).QueryRow(t.Context(), `select policy_version from access.policy_state`).Scan(&v))
	return v
}

func TestListWorkProfiles(t *testing.T) {
	t.Parallel()
	e := newEnv(t, 0)
	items, err := listProfiles(e.as(t, "a.manager-msk1"), t, e, id(t, "person:a.driver-msk1@a"))
	require.NoError(t, err)
	require.Len(t, items, 1)
	assert.Equal(t, accessapi.WorkProfileFunctionDriver, items[0].Function)
	assert.Equal(t, accessapi.WorkProfileStateActive, items[0].State)
	assert.Nil(t, items[0].ValidUntil)
	assert.Positive(t, items[0].Revision)

	_, err = listProfiles(e.as(t, "a.manager-msk1"), t, e, id(t, "person:a.driver-msk2@a"))
	assert.True(t, problem.Is(err, problem.CodeNotFound), "another firm: %v", err)
	_, err = listProfiles(e.as(t, "a.owner"), t, e, id(t, "person:b.driver-msk1@b"))
	assert.True(t, problem.Is(err, problem.CodeNotFound), "tenant B: %v", err)
}

func TestWorkProfilePeriod(t *testing.T) {
	t.Parallel()
	e := newEnv(t, 0)
	admin := e.as(t, "a.admin")
	m := card(admin, t, e, "Прораб с периодом", "unit:a.msk1")
	now := harness.Now()
	before := policyVersion(t, e)

	got, err := createProfile(admin, t, e, m.Id, accessapi.WorkProfileCreate{Function: accessapi.WorkProfileCreateFunctionForeman, ValidFrom: now})
	require.NoError(t, err)
	p := got.Body
	assert.Equal(t, accessapi.WorkProfileFunctionForeman, p.Function)
	assert.Equal(t, accessapi.WorkProfileStateActive, p.State)
	assert.Equal(t, kit.ETag(p.Revision), *got.Headers.ETag)
	assert.Greater(t, policyVersion(t, e), before, "a function changes the policy (AUTH-05)")

	member, err := getMember(admin, t, e, m.Id)
	require.NoError(t, err)
	assert.Equal(t, []accessapi.MemberWorkProfiles{accessapi.MemberWorkProfilesForeman}, member.Body.WorkProfiles)

	_, err = createProfile(admin, t, e, m.Id, accessapi.WorkProfileCreate{Function: accessapi.WorkProfileCreateFunctionForeman, ValidFrom: now.Add(48 * time.Hour)})
	assert.True(t, problem.Is(err, kit.CodeInvalidTransition), "overlap of the same function: %v", err)

	scheduled, err := createProfile(admin, t, e, m.Id, accessapi.WorkProfileCreate{
		Function: accessapi.WorkProfileCreateFunctionPractitioner, ValidFrom: now.Add(24 * time.Hour), ValidUntil: new(now.Add(72 * time.Hour)),
	})
	require.NoError(t, err)
	assert.Equal(t, accessapi.WorkProfileStateScheduled, scheduled.Body.State)

	for name, body := range map[string]accessapi.WorkProfileCreate{
		"yesterday":        {Function: accessapi.WorkProfileCreateFunctionManager, ValidFrom: now.Add(-24 * time.Hour)},
		"end before start": {Function: accessapi.WorkProfileCreateFunctionManager, ValidFrom: now.Add(time.Hour), ValidUntil: new(now)},
	} {
		_, err := createProfile(admin, t, e, m.Id, body)
		assert.True(t, problem.Is(err, kit.CodeValidationFailed), "%s: %v", name, err)
	}

	items, err := listProfiles(admin, t, e, m.Id)
	require.NoError(t, err)
	require.Len(t, items, 2)
	assert.Equal(t, scheduled.Body.Id, items[0].Id, "newest first")

	// End the foreman function in an hour.
	_, err = updateProfile(admin, t, e, m.Id, p.Id, kit.ETag(p.Revision+1), now.Add(time.Hour))
	assert.True(t, problem.Is(err, kit.CodeRevisionMismatch), "stale If-Match: %v", err)
	_, err = updateProfile(admin, t, e, m.Id, p.Id, *got.Headers.ETag, now.Add(-time.Hour))
	assert.True(t, problem.Is(err, kit.CodeValidationFailed), "an end in the past: %v", err)
	if p, ok := errors.AsType[*problem.Error](err); assert.True(t, ok) {
		assert.Equal(t, "Проверьте срок функции.", p.Detail, "the text of the mock (people.ts badUntil)")
	}
	ended, err := updateProfile(admin, t, e, m.Id, p.Id, *got.Headers.ETag, now.Add(time.Hour))
	require.NoError(t, err)
	require.NotNil(t, ended.Body.ValidUntil)
	assert.True(t, now.Add(time.Hour).Equal(*ended.Body.ValidUntil))
	assert.NotEqual(t, p.Revision, ended.Body.Revision)

	// Two hours later the period is over and cannot change any more.
	later := newEnv(t, 2*time.Hour)
	_, err = updateProfile(later.as(t, "a.admin"), t, later, m.Id, p.Id, *ended.Headers.ETag, now.Add(3*time.Hour))
	assert.True(t, problem.Is(err, kit.CodeInvalidTransition), "an ended period: %v", err)
	member, err = getMember(later.as(t, "a.admin"), t, later, m.Id)
	require.NoError(t, err)
	assert.Empty(t, member.Body.WorkProfiles, "no function is active two hours later")

	_, err = updateProfile(admin, t, e, m.Id, uuid.New(), *got.Headers.ETag, now.Add(time.Hour))
	assert.True(t, problem.Is(err, problem.CodeNotFound), "another profile id: %v", err)

	var audits int
	require.NoError(t, e.pool(t).QueryRow(t.Context(), `select count(*) from audit.events
		where action in ('people.work_profile.create', 'people.work_profile.end') and target_id in ($1, $2)`,
		p.Id, scheduled.Body.Id).Scan(&audits))
	assert.Equal(t, 3, audits)
}

func TestWorkProfileScope(t *testing.T) {
	t.Parallel()
	e := newEnv(t, 0)
	body := accessapi.WorkProfileCreate{Function: accessapi.WorkProfileCreateFunctionForeman, ValidFrom: harness.Now()}
	_, err := createProfile(e.as(t, "a.manager-msk1"), t, e, id(t, "person:a.driver-msk1@a"), body)
	assert.True(t, problem.Is(err, problem.CodeForbiddenAction), "visible person without members.manage: %v", err)
	_, err = createProfile(e.as(t, "a.manager-msk1"), t, e, id(t, "person:a.driver-msk2@a"), body)
	assert.True(t, problem.Is(err, problem.CodeNotFound), "invisible person: %v", err)
	_, err = createProfile(e.as(t, "a.admin"), t, e, id(t, "person:b.driver-msk1@b"), body)
	assert.True(t, problem.Is(err, problem.CodeNotFound), "a person of tenant B: %v", err)
}

// The driver function and the earnings are incompatible over the whole period (AUTH-05, ADR-0011): through a
// group, a later temporary assignment, the owner binding.
func TestDriverSeparationOfDuties(t *testing.T) {
	t.Parallel()
	e := newEnv(t, 0)
	admin := e.as(t, "a.admin")
	now := harness.Now()
	driver := accessapi.WorkProfileCreate{Function: accessapi.WorkProfileCreateFunctionDriver, ValidFrom: now}

	inGroup := card(admin, t, e, "Водитель в группе Финансы", "unit:a.msk1")
	_, err := e.pool(t).Exec(t.Context(), `insert into access.group_members (group_id, person_id) values ($1, $2)`,
		id(t, "group:a.finance"), inGroup.Id)
	require.NoError(t, err)
	_, err = createProfile(admin, t, e, inGroup.Id, driver)
	assert.True(t, problem.Is(err, kit.CodeSeparationOfDuties), "earnings through a group: %v", err)

	later := card(admin, t, e, "Водитель с начислениями через неделю", "unit:a.msk1")
	_, err = e.pool(t).Exec(t.Context(), `insert into access.role_assignments
		(principal_kind, principal_id, role_id, role_version, scope_kind, scope_ref, valid, granted_by)
		values ('person', $1, $2, 1, 'unit', $3, tstzrange($4, null), $1)`,
		later.Id, id(t, "role:a.earnings"), id(t, "unit:a.msk1"), now.Add(7*24*time.Hour))
	require.NoError(t, err)
	_, err = createProfile(admin, t, e, later.Id, accessapi.WorkProfileCreate{
		Function: accessapi.WorkProfileCreateFunctionDriver, ValidFrom: now, ValidUntil: new(now.Add(24 * time.Hour)),
	})
	require.NoError(t, err, "the earnings start after the period")
	_, err = createProfile(admin, t, e, later.Id, accessapi.WorkProfileCreate{
		Function: accessapi.WorkProfileCreateFunctionDriver, ValidFrom: now.Add(48 * time.Hour),
	})
	assert.True(t, problem.Is(err, kit.CodeSeparationOfDuties), "an open period reaches the earnings: %v", err)

	_, err = createProfile(e.as(t, "a.owner"), t, e, id(t, "person:a.owner@a"), driver)
	assert.True(t, problem.Is(err, kit.CodeSeparationOfDuties), "the owner has every action, the earnings included: %v", err)

	free := card(admin, t, e, "Водитель без начислений", "unit:a.msk1")
	got, err := createProfile(admin, t, e, free.Id, driver)
	require.NoError(t, err)
	assert.Equal(t, accessapi.WorkProfileFunctionDriver, got.Body.Function)
}
