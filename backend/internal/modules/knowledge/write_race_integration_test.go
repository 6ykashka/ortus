//go:build integration

package knowledge

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	kapi "github.com/ortus/ortus-crm/backend/internal/api/knowledge"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// tenantctxOf is the tenant context of a member of «Альта» in tenant A as the gateway makes it.
func tenantctxOf(proto string) tenantctx.TenantContext {
	return tenantctx.TenantContext{TenantID: tenantA, PersonID: pid(proto), Owner: proto == "m-owner"}
}

// Two leads decide one request at the same time (review of W4.31, return 1): the decision that comes second finds
// the request decided and answers 404 «Запрос не найден или уже решён» — it grants nothing, the request keeps the
// first decision.
func TestWriteDecideRace(t *testing.T) { //nolint:paralleltest // the commands share the seed and run in order
	ctx := t.Context()
	id := uuid.New()
	require.NoError(t, exec(ctx, `insert into kb.requests (id, node_id, space_id, member_id, can, requested_at)
		values ($1, $2, $3, $4, 'view', now())`, id, pid("kb-1b"), pid("sp-log"), pid("m-sokolov")))

	// The first lead denies: his transaction holds the request until it commits.
	first, err := superA.Begin(ctx)
	require.NoError(t, err)
	defer func() { _ = first.Rollback(ctx) }()
	_, err = first.Exec(ctx, `update kb.requests set status = 'denied', decided_at = now(), decided_by = $2 where id = $1`, id,
		pid("m-owner"))
	require.NoError(t, err)

	type result struct {
		x   kapi.KnowledgeAccessRequest
		err error
	}
	second := make(chan result, 1)
	go func() {
		x, err := decide(t, "m-kotova", id, kapi.Approve)
		second <- result{x, err}
	}()
	deadline := time.Now().Add(10 * time.Second)
	for scalar[int](t, `select count(*) from pg_stat_activity where wait_event_type = 'Lock' and query like '%kb.requests%'`) == 0 {
		if time.Now().After(deadline) {
			t.Fatal("the second decision does not wait for the first")
		}
		time.Sleep(20 * time.Millisecond)
	}
	require.NoError(t, first.Commit(ctx))

	got := <-second
	wantProblem(t, got.err, "not_found", "Запрос не найден или уже решён")
	assert.Equal(t, "denied", scalar[string](t, `select status from kb.requests where id = $1`, id))
	assert.Zero(t, scalar[int](t, `select count(*) from access.role_assignments where principal_id = $1 and scope_kind = 'page'
		and scope_ref = $2`, pid("m-sokolov"), pid("kb-1b")), "the denied request grants nothing")
	assert.Zero(t, scalar[int](t, `select count(*) from outbox.events where type = 'kb.request.decided.v1' and aggregate_id = $1`, id))
}

// Approving a request changes the access (review of W4.31, return 1): a sensitive audit record of the lead with the
// page, the member and the right, as setKnowledgeNodeAccess and setKnowledgeSpaceMember; a denial changes nothing and
// is not audited.
func TestWriteDecideAudit(t *testing.T) { //nolint:paralleltest // the commands share the seed and run in order
	ctx := t.Context()
	audited := func(id uuid.UUID) int {
		return scalar[int](t, `select count(*) from audit.events where action = 'knowledge.request.approved' and target_type = 'kb.request'
			and target_id = $1 and sensitivity = 'sensitive' and actor_kind = 'person' and actor_id = $2 and result = 'ok'`, id, pid("m-kotova"))
	}
	ask := func(node, member, can string) uuid.UUID {
		id := uuid.New()
		require.NoError(t, exec(ctx, `insert into kb.requests (id, node_id, space_id, member_id, can, requested_at)
			values ($1, $2, $3, $4, $5, now())`, id, pid(node), pid("sp-log"), pid(member), can))
		return id
	}

	read := ask("kb-1b", "m-akhmedov", "view")
	_, err := decide(t, "m-kotova", read, kapi.Approve)
	require.NoError(t, err)
	assert.Equal(t, 1, audited(read))
	assert.Equal(t, map[string]string{"nodeId": pid("kb-1b").String(), "memberId": pid("m-akhmedov").String(), "can": "view",
		"until": "2026-10-31"}, scalar[map[string]string](t, `select diff from audit.events where action = 'knowledge.request.approved'
		and target_id = $1`, read))

	edit := ask("kb-1a", "m-akhmedov", "edit")
	_, err = decide(t, "m-kotova", edit, kapi.Approve)
	require.NoError(t, err)
	assert.Equal(t, 1, audited(edit))

	denied := ask("kb-1", "m-akhmedov", "edit")
	_, err = decide(t, "m-kotova", denied, kapi.Deny)
	require.NoError(t, err)
	assert.Zero(t, scalar[int](t, `select count(*) from audit.events where target_id = $1`, denied))
}

// A role of a space made by another transaction after the snapshot was read (review of W4.31, return 1): the lazy
// creation finds it by its template instead of making a second system role «Читатель · база знаний» with the same
// template.
func TestWriteSpaceRoleMeanwhile(t *testing.T) { //nolint:paralleltest // the commands share the seed and run in order
	ctx := t.Context()
	require.NoError(t, exec(ctx, `update access.roles set archived_at = now() where template_key = $1 and archived_at is null`, templateReader))
	pool, err := pools.For(ctx, tenantA)
	require.NoError(t, err)
	tc := tenantctxOf("m-kotova")
	meanwhile := uuid.New()
	err = svc.inTx(ctx, pool, tc, pgx.TxOptions{}, func(r *req) error {
		if err := r.load(ctx); err != nil {
			return err
		}
		r.me = r.w.actor(tc)
		require.Nil(t, r.w.spaceRoleOf(templateReader), "the snapshot has no reader")
		require.NoError(t, exec(ctx, `insert into access.roles (id, name, kind, template_key) values ($1, 'Читатель', 'system', $2)`,
			meanwhile, templateReader))
		require.NoError(t, exec(ctx, `insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`,
			meanwhile, []string{actionRead}, pid("m-owner")))
		x, err := r.spaceRole(ctx, templateReader)
		if err != nil {
			return err
		}
		assert.Equal(t, meanwhile, x.id)
		assert.Equal(t, "Читатель", x.name)
		assert.Equal(t, []string{actionRead}, x.actions)
		return nil
	})
	require.NoError(t, err)
	assert.Equal(t, 1, scalar[int](t, `select count(*) from access.roles where template_key = $1 and archived_at is null`, templateReader))
}
