//go:build integration

package vehicles

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"              //nolint:depguard // integration test: roles of the fixture databases
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: PostgreSQL in testcontainers
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04 (3 regions × 4 firms)
)

// world is the fixture world of the isolation suite (W1.04) without its content: the tests register their vehicles.
var world *fixtures.World

func TestMain(m *testing.M) { os.Exit(runMain(m)) }

func runMain(m *testing.M) int {
	ctx := context.Background()
	c, stop, err := harness.StartPostgres(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer stop()
	if world, err = fixtures.Load(ctx, c, "vehicles", harness.Now()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	return m.Run()
}

type env struct {
	dir   *tenantctx.PGDirectory
	pools *tenantctx.Pools
	srv   *Server
}

func newEnv(t *testing.T) env {
	t.Helper()
	control, err := pgxpool.New(t.Context(), world.ControlURL(migrations.RoleAPI))
	require.NoError(t, err)
	t.Cleanup(control.Close)
	vars := world.Env()
	dir := tenantctx.NewPGDirectory(control)
	pools := tenantctx.NewPools(dir, func(k string) string { return vars[k] }, vars["TENANT_DB_HOST"])
	t.Cleanup(pools.Close)
	src := authz.PGSource{Pools: pools}
	ev := authz.New(src, src, harness.Now)
	return env{dir: dir, pools: pools, srv: &Server{Pools: pools, Authz: ev, Now: harness.Now}}
}

// as is the context of a request of actor in tenant (a or b), as the gateway builds it.
func (e env) as(t *testing.T, actor, tenant string) context.Context {
	t.Helper()
	a, err := world.Actor(actor)
	require.NoError(t, err)
	tc, err := tenantctx.Resolve(t.Context(), e.dir, a.AccountID, id(t, "tenant:"+tenant).String(), false)
	require.NoError(t, err)
	return tenantctx.WithTenant(t.Context(), tc)
}

func id(t *testing.T, ref string) uuid.UUID {
	t.Helper()
	v, err := world.ID(ref)
	require.NoError(t, err)
	return v
}

// pool is the tenant DB of t as ortus_api, for the rows the API does not write.
func (e env) pool(t *testing.T, tenant string) *pgxpool.Pool {
	t.Helper()
	p, err := e.pools.For(t.Context(), id(t, "tenant:"+tenant))
	require.NoError(t, err)
	return p
}

// vehicle is a row of fleet.vehicles a test registers directly.
type vehicle struct {
	unit             string // unit key of tenant A (msk1, smr2…)
	body             string // body_type of the table
	payload, volume  string
	lengthMM         int
	tempMin, tempMax *string
	service, note    string
	depot            string
	createdAt        time.Time
}

// add registers v in tenant A and returns its id; plates are unique per call.
func (e env) add(t *testing.T, v vehicle) uuid.UUID {
	t.Helper()
	if v.body == "" {
		v.body = "van"
	}
	if v.payload == "" {
		v.payload, v.volume, v.lengthMM = "1500", "12", 3200
	}
	if v.service == "" {
		v.service = ServiceOK
	}
	if v.createdAt.IsZero() {
		v.createdAt = harness.Now()
	}
	var note, depot *string
	if v.note != "" {
		note = &v.note
	}
	if v.depot != "" {
		depot = &v.depot
	}
	plate := "Т " + strings.ToUpper(uuid.NewString()[:8])
	var vid uuid.UUID
	require.NoError(t, e.pool(t, fixtures.TenantA).QueryRow(t.Context(), `insert into fleet.vehicles
		(unit_id, plate, display_name, body_type, payload_kg, volume_m3, cargo_length_mm, cargo_width_mm, cargo_height_mm,
		 temp_min_c, temp_max_c, odometer_km, service_state, service_note, depot, created_at)
		values ($1, $2, $3, $4, $5::numeric, $6::numeric, $7, 2000, 2000, $8::numeric, $9::numeric, 84370, $10, $11, $12, $13)
		returning id`, id(t, "unit:a."+v.unit), plate, "Машина "+plate, v.body, v.payload, v.volume, v.lengthMM,
		v.tempMin, v.tempMax, v.service, note, depot, v.createdAt).Scan(&vid))
	return vid
}

// tenantContext returns the tenant of the request context ctx.
func tenantContext(ctx context.Context) (uuid.UUID, bool) {
	tc, ok := tenantctx.FromContext(ctx)
	return tc.TenantID, ok
}
