//go:build integration

package vehicles

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: the clock of the suite
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04
)

// S2-20 (W2.72, Q-W2.71-14): a hold of an offer stays live after its end until the choice or the scheduler settles the
// offer — the vehicle reads as reserved, never as free for another hold.
func TestVehicleStatusOffers(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	now := harness.Now()
	db := e.pool(t, fixtures.TenantA)

	offered := e.add(t, vehicle{unit: "msk3"})
	trip := uuid.New()
	e.hold(t, offered, at(10), at(14), now.Add(-2*time.Hour), now.Add(-time.Hour), &trip)
	_, err := db.Exec(t.Context(), `update sched.reservations r set offer_group_id = $2, offered_to = $3, offer_kind = 'usual',
		choose_until = r.hold_expires_at from sched.resources s where s.id = r.resource_id and s.ref_id = $1`,
		offered, uuid.New(), id(t, "person:a.driver-msk1@a"))
	require.NoError(t, err)

	region := e.list(e.as(t, "a.region-msk", fixtures.TenantA), t, fleetapi.ListVehiclesParams{})
	require.Equal(t, fleetapi.VehicleStatusReserved, find(t, region, offered).Status, "a hold of an offer after its end")
}
