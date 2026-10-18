//go:build concurrency

package concurrency

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib" // database/sql driver "pgx"

	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
	harness "github.com/ortus/ortus-crm/backend/test"
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures"
)

// The world of the suite: the isolation fixtures of W1.04 without their content (the tests make their vehicles,
// trips and shifts through the API), the tenant DBs as the superuser (files, drivers and checks the API does not
// expose) and the API under test.
var (
	world *fixtures.World
	dbs   = map[string]*sql.DB{}
	api   *target
)

// TestMain starts PostgreSQL (testcontainers), loads the fixtures and starts cmd/api on the clock of the suite.
// Without Docker it fails: a missing database must not turn the blocking step green.
func TestMain(m *testing.M) {
	os.Exit(runMain(m))
}

func runMain(m *testing.M) int {
	ctx := context.Background()
	cluster, stopPG, err := harness.StartPostgres(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, "concurrency:", err)
		return 1
	}
	defer stopPG()
	if world, err = fixtures.Load(ctx, cluster, "conc", harness.Now()); err != nil {
		fmt.Fprintln(os.Stderr, "concurrency:", err)
		return 1
	}
	for _, t := range []string{fixtures.TenantA, fixtures.TenantB} {
		d, err := sql.Open("pgx", world.TenantURL(t, migratetest.Super))
		if err != nil {
			fmt.Fprintln(os.Stderr, "concurrency:", err)
			return 1
		}
		d.SetMaxOpenConns(8)
		defer d.Close()
		dbs[t] = d
	}
	var stopAPI func()
	if api, stopAPI, err = startTarget(ctx, world); err != nil {
		fmt.Fprintln(os.Stderr, "concurrency: target:", err)
		return 1
	}
	defer stopAPI()
	return m.Run()
}
