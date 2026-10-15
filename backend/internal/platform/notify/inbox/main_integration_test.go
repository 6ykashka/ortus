//go:build integration

package inbox_test

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
	harness "github.com/ortus/ortus-crm/backend/test"
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures"
)

// The isolation fixtures of W1.04 (tenants A and B, managers of namesake firms, drivers, the group «Финансы»)
// in a throw-away PostgreSQL: every test that writes notifications loads its own world.
var cluster *migratetest.Cluster

func TestMain(m *testing.M) {
	os.Exit(runMain(m))
}

func runMain(m *testing.M) int {
	c, stop, err := harness.StartPostgres(context.Background())
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer stop()
	cluster = c
	return m.Run()
}

// env is one world of fixtures reached as cmd/api reaches it: control DB directory, tenant pools (ortus_api).
type env struct {
	w       *fixtures.World
	control *pgxpool.Pool
	dir     *tenantctx.PGDirectory
	pools   *tenantctx.Pools
	aud     inbox.AuthzAudience
	in      *inbox.Inbox
}

func load(t *testing.T, name string) *env {
	t.Helper()
	w, err := fixtures.Load(t.Context(), cluster, name, harness.Now())
	if err != nil {
		t.Fatal(err)
	}
	control, err := pgxpool.New(t.Context(), w.ControlURL(migrations.RoleAPI))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(control.Close)
	vars := w.Env()
	dir := tenantctx.NewPGDirectory(control)
	pools := tenantctx.NewPools(dir, func(k string) string { return vars[k] }, vars["TENANT_DB_HOST"])
	pools.RetryAfter = 0
	t.Cleanup(pools.Close)
	src := authz.PGSource{Pools: pools}
	aud := inbox.AuthzAudience{E: authz.New(src, src, harness.Now)}
	return &env{w: w, control: control, dir: dir, pools: pools, aud: aud, in: &inbox.Inbox{Pools: pools, Audience: aud}}
}

func (e *env) id(t *testing.T, ref string) uuid.UUID {
	t.Helper()
	id, err := e.w.ID(ref)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// tc resolves the tenant context of an actor in tenant A as the gateway does.
func (e *env) tc(t *testing.T, actor string) tenantctx.TenantContext {
	t.Helper()
	a, err := e.w.Actor(actor)
	if err != nil {
		t.Fatal(err)
	}
	c, err := tenantctx.Resolve(t.Context(), e.dir, a.AccountID, e.id(t, "tenant:a").String(), false)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

// pool is the pool of tenant A as ortus_api.
func (e *env) pool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	p, err := e.pools.For(t.Context(), e.id(t, "tenant:a"))
	if err != nil {
		t.Fatal(err)
	}
	return p
}

// super is tenant A as the superuser: rows a producer would never write (other recipients, archived, read).
func (e *env) super(t *testing.T) *sql.DB {
	t.Helper()
	return e.w.Cluster.DB(t, e.w.TenantDBs[fixtures.TenantA], migratetest.Super)
}

// row is a notification written straight into notify.notifications.
type row struct {
	person      uuid.UUID
	minutesAgo  int
	permission  string
	unit        uuid.UUID
	sensitivity string
	read        bool
	archived    bool
	title       string
}

func (e *env) insert(t *testing.T, r row) uuid.UUID {
	t.Helper()
	if r.sensitivity == "" {
		r.sensitivity = inbox.SensitivityNormal
	}
	if r.title == "" {
		r.title = "Рейс сдан"
	}
	at := harness.Now().Add(-time.Duration(r.minutesAgo) * time.Minute)
	var readAt, archivedAt any
	if r.read {
		readAt = at.Add(time.Second)
	}
	if r.archived {
		archivedAt = at.Add(time.Second)
	}
	var perm, unit any
	if r.permission != "" {
		perm = r.permission
	}
	if r.unit != uuid.Nil {
		unit = r.unit
	}
	var id uuid.UUID
	err := e.super(t).QueryRowContext(t.Context(), `
insert into notify.notifications (recipient_person_id, kind, title, body, link, module_key, entity_type, entity_id,
                                  unit_id, sensitivity, required_permission, created_at, read_at, archived_at)
values ($1, 'fleet.trip.submitted', $2, 'Проверьте рейс', '/fleet/trips/R-102', 'fleet', 'trip', gen_random_uuid(),
        $3, $4, $5, $6, $7, $8)
returning id`, r.person, r.title, unit, r.sensitivity, perm, at, readAt, archivedAt).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// count returns the notifications of a person in tenant A (any state).
func (e *env) count(t *testing.T, person uuid.UUID) int {
	t.Helper()
	var n int
	if err := e.super(t).QueryRowContext(t.Context(),
		`select count(*) from notify.notifications where recipient_person_id = $1`, person).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}
