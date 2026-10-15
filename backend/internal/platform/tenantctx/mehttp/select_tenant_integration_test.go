//go:build integration

package mehttp

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// Q-W0.08-1: the selection lives in control DB accounts.last_tenant_id (control 0004, W1.03).

var cluster *migratetest.Cluster

func TestMain(m *testing.M) {
	c, stop, err := migratetest.Start(context.Background(), migratetest.Images()[0])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	cluster = c
	code := m.Run()
	stop()
	os.Exit(code)
}

// controlDB returns a migrated control DB (role ortus_api) with one account and one tenant.
func controlDB(t *testing.T) (db *pgxpool.Pool, acc, tenant uuid.UUID) {
	t.Helper()
	ctx := t.Context()
	name := cluster.NewDatabase(t, "ctl")
	if _, err := migrations.Up(ctx, cluster.DB(t, name, migrations.RoleMigrator), migrations.Control); err != nil {
		t.Fatal(err)
	}
	db, err := pgxpool.New(ctx, cluster.URL(name, migrations.RoleAPI))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	acc, tenant = uuid.New(), uuid.New()
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{`insert into accounts (id, issuer, subject, email_norm, display_name) values ($1, 'urn:ortus:dev', 'acc-x', 'x@x', 'X')`, []any{acc}},
		{`insert into tenants (id, slug, display_name, industry_pack, state) values ($1, 'alta-x', 'Альта', 'logistics', 'active')`, []any{tenant}},
	} {
		if _, err := db.Exec(ctx, q.sql, q.args...); err != nil {
			t.Fatal(err)
		}
	}
	return db, acc, tenant
}

func TestPGLastTenants(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	db, acc, tenant := controlDB(t)
	store := NewPGLastTenants(db)
	if got, err := store.LastTenant(ctx, acc); err != nil || got != nil {
		t.Fatalf("before selection: %v, %v", got, err)
	}
	if err := store.SetLastTenant(ctx, acc, tenant); err != nil {
		t.Fatal(err)
	}
	if got, err := store.LastTenant(ctx, acc); err != nil || got == nil || *got != tenant {
		t.Fatalf("after selection: %v, %v", got, err)
	}
	if err := store.SetLastTenant(ctx, acc, uuid.New()); err == nil {
		t.Fatal("an unknown tenant must be refused by the foreign key")
	}
	if got, err := store.LastTenant(ctx, uuid.New()); err != nil || got != nil {
		t.Fatalf("unknown account: %v, %v", got, err)
	}
}
