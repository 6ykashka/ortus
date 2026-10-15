//go:build isolation

package isolation

import (
	"context"
	"fmt"
	"os"
	"testing"

	harness "github.com/ortus/ortus-crm/backend/test"
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures"
	"github.com/ortus/ortus-crm/backend/test/isolation/matrix"
)

// suite is what the generated <module>_test.go files run their rows against.
var suite *matrix.Suite

// TestMain starts PostgreSQL (testcontainers, harness.Image), loads the fixtures with the content of the tenants
// (imports, vehicles with files, notifications — the objects of the positive rows, W1.44) and builds the target.
// Without Docker it fails: a missing database must not turn the blocking job green.
func TestMain(m *testing.M) {
	os.Exit(runMain(m))
}

func runMain(m *testing.M) int {
	ctx := context.Background()
	cluster, stopPG, err := harness.StartPostgres(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, "isolation:", err)
		return 1
	}
	defer stopPG()
	world, err := fixtures.Load(ctx, cluster, "iso", harness.Now(), fixtures.WithContent())
	if err != nil {
		fmt.Fprintln(os.Stderr, "isolation:", err)
		return 1
	}
	env := world.Env()
	target, stopTarget, err := newTarget(ctx, matrix.Env{
		World:  world,
		Clock:  harness.Now,
		Getenv: func(k string) string { return env[k] },
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "isolation: target:", err)
		return 1
	}
	defer stopTarget()
	suite = matrix.NewSuite(world, target)
	return m.Run()
}

// The suite is wired: fixtures resolve and the runtime role reaches both tenant databases.
func TestSuiteIsWired(t *testing.T) {
	t.Parallel()
	w, ok := suite.Refs.(*fixtures.World)
	if !ok || suite.Target.Handler == nil || suite.Target.Authenticate == nil {
		t.Fatalf("suite is not wired: refs %T, target %+v", suite.Refs, suite.Target)
	}
	for _, tn := range []string{fixtures.TenantA, fixtures.TenantB} {
		db := w.Cluster.DB(t, w.TenantDBs[tn], "ortus_api")
		var units int
		if err := db.QueryRowContext(t.Context(), `select count(*) from org.units`).Scan(&units); err != nil || units == 0 {
			t.Fatalf("tenant %s: units %d, err %v", tn, units, err)
		}
	}
}
