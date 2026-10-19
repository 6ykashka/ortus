//go:build integration

package routes

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
)

// W2.50 (D-11 комплекта): createTripPlan stores the address of a stop for the navigator and getTripPlan returns it; a
// stop without it has none (the client uses address).
func TestTripPlanNavigationAddress(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := e.as(t, "a.manager-msk1")
	b := plan(t, "msk1", day(22, 6), day(22, 12), nil)
	nav := "Лобня, ул. Лейтенанта Бакина, 1"
	b.Stops[0].NavigationAddress = &nav
	p := e.planned(ctx, t, b)
	require.NotNil(t, p.Stops[0].NavigationAddress)
	assert.Equal(t, nav, *p.Stops[0].NavigationAddress)
	assert.Nil(t, p.Stops[1].NavigationAddress)

	resp, err := e.get(ctx, p.Id)
	require.NoError(t, err)
	got, ok := resp.(fleetapi.GetTripPlan200JSONResponse)
	require.True(t, ok, "%T", resp)
	require.NotNil(t, got.Body.Stops[0].NavigationAddress)
	assert.Equal(t, nav, *got.Body.Stops[0].NavigationAddress)
	assert.Equal(t, 1, e.count(t, `select count(*) from fleet.trip_stops where trip_id = $1 and navigation_address = $2`, p.Id, nav))
}
