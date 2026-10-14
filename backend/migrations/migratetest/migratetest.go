// Package migratetest starts throw-away PostgreSQL servers for integration tests (testcontainers-go),
// creates the Ortus DB roles and databases, and takes schema snapshots.
//
// Without Docker the helpers fail (never skip): a missing database must not turn a suite green.
// PG_TEST_IMAGES selects images (comma-separated, default: Postgres17 and Postgres164). There is no switch to an
// external server (CLAUDE.md: integration tests use testcontainers only): EnsureRoles resets the passwords of the
// cluster-wide ortus_* roles, and test databases are never dropped, so a shared server (the stand) would break.
package migratetest

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"hash/fnv"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib" // database/sql driver "pgx"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// Pinned images (D-04). Postgres17 must equal the compose stand image (deploy/compose/docker-compose.yml).
const (
	Postgres17  = "postgres:17.11@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3"
	Postgres164 = "postgres:16.4@sha256:e62fbf9d3e2b49816a32c400ed2dba83e3b361e6833e624024309c35d334b412"
)

// Passwords used for the Ortus roles inside test servers.
var Passwords = migrations.Passwords{
	Migrator:    "test-migrator",
	API:         "test-api",
	Worker:      "test-worker",
	Provisioner: "test-provisioner",
}

// Role names accepted by Cluster.DB besides the Ortus roles.
const Super = "super"

// Images returns the PostgreSQL images to test against.
func Images() []string {
	if v := strings.TrimSpace(os.Getenv("PG_TEST_IMAGES")); v != "" {
		var out []string
		for s := range strings.SplitSeq(v, ",") {
			if s = strings.TrimSpace(s); s != "" {
				out = append(out, s)
			}
		}
		return out
	}
	return []string{Postgres17, Postgres164}
}

// Cluster is one PostgreSQL server with the Ortus roles created.
type Cluster struct {
	Image    string
	superURL *url.URL
	seq      atomic.Int64
}

// Start starts a container server for image and creates the roles.
// The returned stop function terminates the container. Intended for TestMain.
func Start(ctx context.Context, image string) (*Cluster, func(), error) {
	ctr, err := tcpostgres.Run(ctx, image,
		tcpostgres.WithDatabase("postgres"),
		tcpostgres.WithUsername("postgres"),
		tcpostgres.WithPassword("postgres"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").WithOccurrence(2).WithStartupTimeout(2*time.Minute),
		),
	)
	if err != nil {
		return nil, nil, fmt.Errorf("migratetest: Docker недоступен или образ %s не запустился — запустите Docker Desktop: %w", image, err)
	}
	stop := func() {
		_ = testcontainers.TerminateContainer(ctr)
	}
	dsn, err := ctr.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		stop()
		return nil, nil, fmt.Errorf("migratetest: connection string: %w", err)
	}
	c, err := newCluster(ctx, image, dsn)
	if err != nil {
		stop()
		return nil, nil, err
	}
	return c, stop, nil
}

func newCluster(ctx context.Context, image, dsn string) (*Cluster, error) {
	u, err := url.Parse(dsn)
	if err != nil {
		return nil, fmt.Errorf("migratetest: parse dsn: %w", err)
	}
	c := &Cluster{Image: image, superURL: u}
	super, err := c.open(ctx, "postgres", Super)
	if err != nil {
		return nil, err
	}
	defer super.Close()
	if err := migrations.EnsureRoles(ctx, super, Passwords); err != nil {
		return nil, fmt.Errorf("migratetest: ensure roles: %w", err)
	}
	return c, nil
}

// URL returns a DSN for database name and role (Super or an Ortus role).
func (c *Cluster) URL(dbName, role string) string {
	u := *c.superURL
	u.Path = "/" + dbName
	switch role {
	case Super:
	case migrations.RoleMigrator:
		u.User = url.UserPassword(role, Passwords.Migrator)
	case migrations.RoleAPI:
		u.User = url.UserPassword(role, Passwords.API)
	case migrations.RoleWorker:
		u.User = url.UserPassword(role, Passwords.Worker)
	case migrations.RoleProvisioner:
		u.User = url.UserPassword(role, Passwords.Provisioner)
	default:
		u.User = url.User(role)
	}
	return u.String()
}

func (c *Cluster) open(ctx context.Context, dbName, role string) (*sql.DB, error) {
	db, err := sql.Open("pgx", c.URL(dbName, role))
	if err != nil {
		return nil, fmt.Errorf("migratetest: open %s as %s: %w", dbName, role, err)
	}
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("migratetest: ping %s as %s: %w", dbName, role, err)
	}
	return db, nil
}

// DB opens database dbName as role; the pool is closed at the end of the test.
func (c *Cluster) DB(tb testing.TB, dbName, role string) *sql.DB {
	tb.Helper()
	db, err := c.open(tb.Context(), dbName, role)
	if err != nil {
		tb.Fatal(err)
	}
	tb.Cleanup(func() { _ = db.Close() })
	return db
}

// NewDatabase creates an empty database owned by ortus_migrator with a name unique to the test.
func (c *Cluster) NewDatabase(tb testing.TB, prefix string) string {
	tb.Helper()
	h := fnv.New32a()
	_, _ = h.Write([]byte(tb.Name()))
	name := fmt.Sprintf("%s_%08x_%d", prefix, h.Sum32(), c.seq.Add(1))
	super := c.DB(tb, "postgres", Super)
	if err := migrations.CreateDatabase(tb.Context(), super, name); err != nil {
		tb.Fatalf("create database %s: %v", name, err)
	}
	return name
}

// Snapshot returns a sorted text description of the user-visible schema of db:
// schemas, columns, constraints, indexes, views, enum values and extensions (goose_db_version excluded).
func Snapshot(tb testing.TB, db *sql.DB) string {
	tb.Helper()
	const q = `
with ns as (
  select oid, nspname from pg_namespace
   where nspname not in ('pg_catalog','information_schema','pg_toast') and nspname not like 'pg_temp%' and nspname not like 'pg_toast_temp%'
)
select 'schema ' || nspname from ns
union all
select 'column ' || table_schema || '.' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '')
  from information_schema.columns
 where table_schema in (select nspname from ns) and table_name <> 'goose_db_version'
union all
select 'constraint ' || n.nspname || '.' || c.conrelid::regclass::text || ' ' || c.conname || ' ' || pg_get_constraintdef(c.oid)
  from pg_constraint c join ns n on n.oid = c.connamespace
 where c.conrelid <> 0 and c.conrelid::regclass::text not like '%goose_db_version'
union all
select 'index ' || schemaname || '.' || indexname || ' ' || indexdef
  from pg_indexes where schemaname in (select nspname from ns) and tablename <> 'goose_db_version'
union all
select 'view ' || schemaname || '.' || viewname || ' ' || definition from pg_views where schemaname in (select nspname from ns)
union all
select 'enum ' || t.typname || ' ' || e.enumlabel || ' ' || e.enumsortorder::text
  from pg_enum e join pg_type t on t.oid = e.enumtypid
union all
select 'extension ' || extname from pg_extension where extname <> 'plpgsql'
order by 1`
	rows, err := db.QueryContext(tb.Context(), q)
	if err != nil {
		tb.Fatalf("snapshot: %v", err)
	}
	defer rows.Close()
	var b strings.Builder
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			tb.Fatalf("snapshot scan: %v", err)
		}
		b.WriteString(line)
		b.WriteByte('\n')
	}
	if err := rows.Err(); err != nil {
		tb.Fatalf("snapshot rows: %v", err)
	}
	return b.String()
}

// ErrNoClusters is returned by StartAll when no image is configured.
var ErrNoClusters = errors.New("migratetest: no PostgreSQL images (PG_TEST_IMAGES is empty)")

// StartAll starts a cluster for every image of Images(). Intended for TestMain:
//
//	clusters, stop, err := migratetest.StartAll(ctx)
func StartAll(ctx context.Context) ([]*Cluster, func(), error) {
	images := Images()
	if len(images) == 0 {
		return nil, nil, ErrNoClusters
	}
	var (
		clusters []*Cluster
		stops    []func()
	)
	stopAll := func() {
		for _, s := range stops {
			s()
		}
	}
	for _, img := range images {
		c, stop, err := Start(ctx, img)
		if err != nil {
			stopAll()
			return nil, nil, err
		}
		clusters = append(clusters, c)
		stops = append(stops, stop)
	}
	return clusters, stopAll, nil
}
