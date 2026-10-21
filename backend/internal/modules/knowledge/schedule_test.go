package knowledge

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The check of the review dates runs «По расписанию · каждый день в 09:00» (knowledge.js:291): 09:00 of the day of
// the clock of the application in Moscow, whatever the zone of the clock.
func TestReviewSlot(t *testing.T) {
	t.Parallel()
	for now, want := range map[string]string{
		"2026-10-05T08:59:00+03:00": "2026-10-05T09:00:00+03:00",
		"2026-10-05T09:00:00+03:00": "2026-10-05T09:00:00+03:00",
		"2026-10-05T06:00:00Z":      "2026-10-05T09:00:00+03:00",
		"2026-10-05T23:30:00Z":      "2026-10-06T09:00:00+03:00", // 02:30 of 06.10 in Moscow
		"2026-10-05T20:59:59Z":      "2026-10-05T09:00:00+03:00", // 23:59:59 of 05.10 in Moscow
	} {
		n, err := time.Parse(time.RFC3339, now)
		require.NoError(t, err)
		w, err := time.Parse(time.RFC3339, want)
		require.NoError(t, err)
		assert.True(t, reviewSlot(n).Equal(w), "%s: slot %v, want %v", now, reviewSlot(n), w)
	}
}
