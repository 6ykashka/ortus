// Package accesstest starts a throw-away PostgreSQL (testcontainers) with a migrated tenant DB and control DB for
// the integration tests of the access module (W1.06). The migrations are read from backend/migrations/{tenant,
// control}/*.sql and applied as the superuser in file order: depguard keeps the package migrations (goose) out of
// internal/modules/**, and the files are the same ones goose applies (Up section of each).
//
// Without Docker the helpers fail, never skip: a missing database must not turn a suite green.
package accesstest

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

// Image is the PostgreSQL of the stand (migratetest.Postgres17); PG_TEST_IMAGES overrides it (first image).
const Image = "postgres:17.11@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3"

// Server is one PostgreSQL container.
type Server struct {
	dsn string
	seq atomic.Int64
}

func image() string {
	if v := strings.TrimSpace(os.Getenv("PG_TEST_IMAGES")); v != "" {
		first, _, _ := strings.Cut(v, ",")
		return strings.TrimSpace(first)
	}
	return Image
}

// windowsDockerHost is the pipe of Docker Desktop testcontainers finds by itself (client.DefaultDockerHost).
const windowsDockerHost = "npipe:////./pipe/docker_engine"

// defaultDockerHost is the DOCKER_HOST Start sets when there is none (W1.46, П-10). On Windows without DOCKER_HOST
// testcontainers looks for Docker by os.Stat of the pipe docker_engine; while several test binaries start at once Stat
// gets «All pipe instances are busy», the strategy takes it for «no socket», the next one answers «rootless Docker is not
// supported on Windows, failed to create Docker provider», and the answer is cached for the process (sync.Once) —
// repeating the run does not help. With DOCKER_HOST the host is checked by `docker info` over the pipe, which waits for
// a free instance.
func defaultDockerHost(goos string, getenv func(string) string) (string, bool) {
	if goos != "windows" || getenv("DOCKER_HOST") != "" {
		return "", false
	}
	return windowsDockerHost, true
}

// Start starts the server; stop terminates it. Intended for TestMain.
func Start(ctx context.Context) (*Server, func(), error) {
	if host, ok := defaultDockerHost(runtime.GOOS, os.Getenv); ok {
		if err := os.Setenv("DOCKER_HOST", host); err != nil {
			return nil, nil, fmt.Errorf("accesstest: DOCKER_HOST: %w", err)
		}
	}
	ctr, err := tcpostgres.Run(ctx, image(),
		tcpostgres.WithDatabase("postgres"), tcpostgres.WithUsername("postgres"), tcpostgres.WithPassword("postgres"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").WithOccurrence(2).WithStartupTimeout(2*time.Minute)),
	)
	if err != nil {
		return nil, nil, fmt.Errorf("accesstest: Docker недоступен или образ не запустился — запустите Docker Desktop: %w", err)
	}
	stop := func() { _ = testcontainers.TerminateContainer(ctr) }
	dsn, err := ctr.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		stop()
		return nil, nil, fmt.Errorf("accesstest: connection string: %w", err)
	}
	return &Server{dsn: dsn}, stop, nil
}

// DSN returns the DSN of database name as the superuser.
func (s *Server) DSN(name string) string {
	i := strings.LastIndex(s.dsn, "/")
	j := strings.Index(s.dsn[i:], "?")
	if j < 0 {
		return s.dsn[:i+1] + name
	}
	return s.dsn[:i+1] + name + s.dsn[i+j:]
}

// Kind of a database: the directory of its migrations.
type Kind string

// Kinds of databases.
const (
	Tenant  Kind = "tenant"
	Control Kind = "control"
)

// NewDB creates a fresh database of kind, applies its migrations and returns a pool closed at the end of the test.
func (s *Server) NewDB(tb testing.TB, kind Kind) *pgxpool.Pool {
	tb.Helper()
	ctx := tb.Context()
	name := fmt.Sprintf("%s_%d_%d", kind, time.Now().UnixNano()%1_000_000, s.seq.Add(1))
	admin, err := pgx.Connect(ctx, s.DSN("postgres"))
	if err != nil {
		tb.Fatalf("accesstest: connect: %v", err)
	}
	defer admin.Close(context.WithoutCancel(ctx))
	if _, err := admin.Exec(ctx, "create database "+pgx.Identifier{name}.Sanitize()); err != nil {
		tb.Fatalf("accesstest: create database %s: %v", name, err)
	}
	pool, err := pgxpool.New(ctx, s.DSN(name))
	if err != nil {
		tb.Fatalf("accesstest: pool %s: %v", name, err)
	}
	tb.Cleanup(pool.Close)
	if err := Migrate(ctx, pool, kind); err != nil {
		tb.Fatal(err)
	}
	return pool
}

// Migrate applies the Up sections of backend/migrations/<kind>/*.sql in file order.
func Migrate(ctx context.Context, pool *pgxpool.Pool, kind Kind) error {
	dir, err := migrationsDir(kind)
	if err != nil {
		return err
	}
	files, err := filepath.Glob(filepath.Join(dir, "*.sql"))
	if err != nil {
		return err
	}
	slices.Sort(files)
	for _, f := range files {
		raw, err := os.ReadFile(f) //nolint:gosec // G304: migration files of the repository
		if err != nil {
			return err
		}
		up, err := upSection(string(raw))
		if err != nil {
			return fmt.Errorf("accesstest: %s: %w", filepath.Base(f), err)
		}
		// No arguments: pgx runs the text with the simple protocol, several statements at once.
		if _, err := pool.Exec(ctx, up); err != nil {
			return fmt.Errorf("accesstest: migrate %s: %w", filepath.Base(f), err)
		}
	}
	return nil
}

// upSection returns the statements between «-- +goose Up» and «-- +goose Down».
func upSection(sql string) (string, error) {
	_, rest, ok := strings.Cut(sql, "-- +goose Up")
	if !ok {
		return "", errors.New("no -- +goose Up")
	}
	up, _, _ := strings.Cut(rest, "-- +goose Down")
	return up, nil
}

// migrationsDir finds backend/migrations/<kind> from the working directory of the test (a package of backend).
func migrationsDir(kind Kind) (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return filepath.Join(dir, "migrations", string(kind)), nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errors.New("accesstest: backend/go.mod not found above the working directory")
		}
		dir = parent
	}
}

// Pools reaches the tenant DBs of tests by tenant id (scopeddb.Pools, authz.Pools).
type Pools map[uuid.UUID]*pgxpool.Pool

// For implements scopeddb.Pools.
func (p Pools) For(_ context.Context, tenantID uuid.UUID) (*pgxpool.Pool, error) {
	pool, ok := p[tenantID]
	if !ok {
		return nil, errors.New("accesstest: unknown tenant")
	}
	return pool, nil
}
