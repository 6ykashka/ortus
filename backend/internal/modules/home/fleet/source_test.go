package fleet

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/modules/home" //nolint:depguard // the registry this source plugs into
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

var errDown = errors.New("tenant DB down")

type downPools struct{}

func (downPools) For(context.Context, uuid.UUID) (*pgxpool.Pool, error) { return nil, errDown }

// The source belongs to the logistics module of the registry (modulesreg.KeyFleet) and opens only the tenant DB of
// the query: its failure is the failure of the source.
func TestSourceWithoutTenantDB(t *testing.T) {
	t.Parallel()
	if (Source{}).Module() != "fleet" {
		t.Fatal("module key")
	}
	_, err := Source{Pools: downPools{}}.Cards(t.Context(), home.Query{Tenant: tenantctx.TenantContext{TenantID: uuid.New()}, ModuleState: "active"})
	if !errors.Is(err, errDown) {
		t.Fatalf("error %v, want %v", err, errDown)
	}
}
