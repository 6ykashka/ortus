//go:build integration

package people

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/invitations" //nolint:depguard // integration test: the invitation of inviteMember (W1.03, W1.06)
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// W1.52: inviteMember (W1.06) writes a person card without a membership and an invitation of the control DB; the
// membership appears on acceptance. Member.status of such a card follows its invitation: invited while it is pending,
// a card without an account once it expired or was revoked, active with the account after the acceptance.

// issue issues an invitation of person like inviteMember does (invitations.Issue in a control transaction).
func issue(t *testing.T, e env, by tenantctx.TenantContext, person uuid.UUID, email string) (string, uuid.UUID) {
	t.Helper()
	ctx := t.Context()
	tx, err := e.control.Begin(ctx)
	require.NoError(t, err)
	defer func() { _ = tx.Rollback(ctx) }()
	author := by.MembershipID
	token, inv, err := invitations.Issue(ctx, tx, invitations.Draft{TenantID: tenantA(t), PersonProfileID: person, Email: email, CreatedBy: &author})
	require.NoError(t, err)
	require.NoError(t, tx.Commit(ctx))
	return token, inv
}

// invitedCard is what inviteMember commits: the card in Москва-1 and its pending invitation.
type invitedCard struct {
	member     accessapi.Member
	email      string
	token      string
	invitation uuid.UUID
}

func invite(t *testing.T, e env, name string) invitedCard {
	t.Helper()
	email := "w152-" + uuid.NewString()[:8] + "@alta.example"
	m, err := createMember(e.as(t, "a.admin"), t, e, withEmail(accessapi.MemberCreate{DisplayName: name, OrgUnitIds: []uuid.UUID{id(t, "unit:a.msk1")}}, email))
	require.NoError(t, err)
	token, inv := issue(t, e, e.tc(t, "a.admin"), m.Id, email)
	return invitedCard{member: m, email: email, token: token, invitation: inv}
}

// seen is the person as getMember and listMembers of the owner show it.
func seen(ctx context.Context, t *testing.T, e env, person uuid.UUID) (got, listed accessapi.Member) {
	t.Helper()
	resp, err := getMember(ctx, t, e, person)
	require.NoError(t, err)
	for _, m := range listAll(ctx, t, e, nil, nil) {
		if m.Id == person {
			return resp.Body, m
		}
	}
	t.Fatalf("listMembers does not show %s", person)
	return resp.Body, accessapi.Member{}
}

// T-1: a card with a pending invitation is invited, without an account.
func TestInvitedCardIsInvited(t *testing.T) {
	t.Parallel()
	e := newEnv(t, 0)
	c := invite(t, e, "Приглашённый W152")
	for _, ctx := range []context.Context{e.as(t, "a.owner"), e.as(t, "a.manager-msk1")} {
		got, listed := seen(ctx, t, e, c.member.Id)
		for name, m := range map[string]accessapi.Member{"getMember": got, "listMembers": listed} {
			assert.Equal(t, accessapi.MemberStatusInvited, m.Status, name)
			assert.Nil(t, m.UserId, "%s: no account before the acceptance", name)
			require.NotNil(t, m.Email, name)
			assert.Equal(t, c.email, string(*m.Email), name)
		}
	}
}

// T-2: an expired or a revoked invitation leaves a card without an account: active, no userId (Q-W1.00-5).
func TestLapsedInvitationLeavesCard(t *testing.T) {
	t.Parallel()
	e := newEnv(t, 0)
	owner := e.as(t, "a.owner")
	lapse := map[string]string{
		"expired": `update invitations set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where id = $1`,
		"revoked": `update invitations set revoked_at = now() where id = $1`,
	}
	for name, sql := range lapse {
		c := invite(t, e, "Приглашение "+name)
		_, err := e.control.Exec(t.Context(), sql, c.invitation)
		require.NoError(t, err)
		got, listed := seen(owner, t, e, c.member.Id)
		for op, m := range map[string]accessapi.Member{"getMember": got, "listMembers": listed} {
			assert.Equal(t, accessapi.MemberStatusActive, m.Status, "%s %s", name, op)
			assert.Nil(t, m.UserId, "%s %s", name, op)
		}
	}
}

// T-3: after the acceptance the person is active with its account.
func TestAcceptedInvitationIsActive(t *testing.T) {
	t.Parallel()
	e := newEnv(t, 0)
	owner := e.as(t, "a.owner")
	c := invite(t, e, "Принявший W152")
	before, _ := seen(owner, t, e, c.member.Id)
	assert.Equal(t, accessapi.MemberStatusInvited, before.Status, "before the acceptance")

	account := uuid.New()
	_, err := e.control.Exec(t.Context(), `insert into accounts (id, issuer, subject, email_norm, display_name)
		values ($1, 'http://idp.test/realms/ortus', $2, $3, 'Принявший W152')`, account, account.String(), c.email)
	require.NoError(t, err)
	svc := invitations.Service{Control: e.control, Tenants: e.pools}
	_, err = svc.Accept(t.Context(), account, c.token)
	require.NoError(t, err)

	got, listed := seen(owner, t, e, c.member.Id)
	for op, m := range map[string]accessapi.Member{"getMember": got, "listMembers": listed} {
		assert.Equal(t, accessapi.MemberStatusActive, m.Status, op)
		require.NotNil(t, m.UserId, op)
		assert.Equal(t, account, *m.UserId, op)
	}
}

// serverSeats are the seats of tenant A as inviteMember counts them (freeSeats, W1.06): active and invited
// memberships plus pending invitations without an invited membership of their profile.
func serverSeats(t *testing.T, e env) int64 {
	t.Helper()
	var used int64
	require.NoError(t, e.control.QueryRow(t.Context(), `select coalesce((select seats_used from tenant_seat_usage where tenant_id = $1), 0)
		     + (select count(*) from invitations i where i.tenant_id = $1 and i.accepted_at is null and i.revoked_at is null
		          and i.expires_at > now()
		          and not exists (select 1 from memberships m where m.tenant_id = $1 and m.person_profile_id = i.person_profile_id
		                            and m.status = 'invited'))`, tenantA(t)).Scan(&used))
	return used
}

// clientSeats are the seats the client counts in listMembers of the owner: invited people and active people with an
// account (a card without an account and a suspended person take no seat).
func clientSeats(t *testing.T, e env) int64 {
	t.Helper()
	var n int64
	for _, m := range listAll(e.as(t, "a.owner"), t, e, nil, nil) {
		if m.Status == accessapi.MemberStatusInvited || m.Status == accessapi.MemberStatusActive && m.UserId != nil {
			n++
		}
	}
	return n
}

// T-4: an invitation takes a seat on the server and in listMembers alike, an expired one frees it in both. Not
// parallel: the other tests of the package invite in tenant A too (they run after the sequential tests).
func TestInvitationSeatsAgree(t *testing.T) { //nolint:paralleltest // counts the seats of tenant A, which the parallel tests change
	e := newEnv(t, 0)
	server, client := serverSeats(t, e), clientSeats(t, e)
	c := invite(t, e, "Место W152")
	assert.Equal(t, server+1, serverSeats(t, e), "the server counts the invitation")
	assert.Equal(t, client+1, clientSeats(t, e), "listMembers shows the invitation as a seat")

	_, err := e.control.Exec(t.Context(), `update invitations set created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
		where id = $1`, c.invitation)
	require.NoError(t, err)
	assert.Equal(t, server, serverSeats(t, e), "an expired invitation frees its seat")
	assert.Equal(t, client, clientSeats(t, e), "and listMembers stops counting it")
}

// T-5: without a control DB (Directory nil) every person is shown as a card, as before W1.52.
func TestInvitationsWithoutControlDB(t *testing.T) {
	t.Parallel()
	e := newEnv(t, 0)
	c := invite(t, e, "Без control DB W152")
	srv := *e.srv
	srv.Directory = nil
	e.srv = &srv
	got, err := getMember(e.as(t, "a.owner"), t, e, c.member.Id)
	require.NoError(t, err)
	assert.Equal(t, accessapi.MemberStatusActive, got.Body.Status)
}
