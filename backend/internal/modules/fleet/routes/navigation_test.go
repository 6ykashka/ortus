package routes

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// W2.50 (D-11 комплекта): the address of a stop for the external navigator (TripStop.navigationAddress, tenant 0017
// fleet.trip_stops.navigation_address, 1…500 characters) is trimmed, a blank one is none.
func TestCheckStopNavigationAddress(t *testing.T) {
	t.Parallel()
	stop := func(nav string) fleetapi.TripStop {
		return fleetapi.TripStop{Sequence: 1, Op: fleetapi.Load, Address: "Склад № 1 · ворота 3", WeightKg: "1", VolumeM3: "1",
			NavigationAddress: &nav}
	}
	st, err := checkStop(stop("  Лобня, ул. Лейтенанта Бакина, 1 "), 1)
	require.NoError(t, err)
	require.NotNil(t, st.navigation)
	assert.Equal(t, "Лобня, ул. Лейтенанта Бакина, 1", *st.navigation)

	st, err = checkStop(stop("   "), 1)
	require.NoError(t, err)
	assert.Nil(t, st.navigation, "a blank address for the navigator is none")

	long := stop(strings.Repeat("я", 501))
	long.Sequence = 2
	_, err = checkStop(long, 2)
	require.Error(t, err)
	assert.True(t, problem.Is(err, "validation_failed"))
	assert.Contains(t, err.Error(), "Точка 2: адрес для навигатора длиннее 500 символов.")
}
