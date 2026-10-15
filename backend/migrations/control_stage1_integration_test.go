//go:build integration

package migrations_test

import (
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// control 0006 (W1.03) Down: an owner invitation has no author (created_by null) and cannot return under NOT NULL
// created_by. Down refuses with an error and keeps the data instead of deleting it (review W1.03, return 1).
func TestControl0006DownKeepsOwnerInvitations(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		ctx := t.Context()
		name, mig := migrated(t, c, migrations.Control)
		api := c.DB(t, name, migrations.RoleAPI)
		tenant := scalar[string](t, api, `insert into tenants (slug, display_name, industry_pack)
			values ('nova', 'Нова Логистик', 'logistics') returning id::text`)
		if _, err := api.ExecContext(ctx, `insert into invitations
			(tenant_id, email_norm, token_hash, person_profile_id, grants_owner, expires_at)
			values ($1, 'owner@nova.example', '\x01', gen_random_uuid(), true, now() + interval '7 days')`, tenant); err != nil {
			t.Fatalf("owner invitation: %v", err)
		}
		if _, err := migrations.DownTo(ctx, mig, migrations.Control, 5); err == nil {
			t.Fatal("Down of control 0006 must refuse while owner invitations without an author exist")
		}
		if v, err := migrations.Version(ctx, mig, migrations.Control); err != nil || v != 6 {
			t.Fatalf("version %d (%v), want 6: the refused Down rolls back as a whole", v, err)
		}
		if n := scalar[int](t, api, `select count(*) from invitations where grants_owner and created_by is null`); n != 1 {
			t.Fatalf("owner invitations after the refused Down: %d, want 1", n)
		}
	})
}
