package kit

import (
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

func TestFunctionMapping(t *testing.T) {
	t.Parallel()
	pairs := map[string]string{"driver": "driver", "foreman": "foreman", "practitioner": "therapist", "manager": "dispatcher"}
	for api, db := range pairs {
		got, ok := FunctionToDB(api)
		require.True(t, ok, api)
		assert.Equal(t, db, got)
		back, ok := FunctionFromDB(db)
		require.True(t, ok, db)
		assert.Equal(t, api, back)
	}
	_, ok := FunctionToDB("worker")
	assert.False(t, ok, "worker is not a function of the contract")
	_, ok = FunctionFromDB("worker")
	assert.False(t, ok, "people.work_profiles worker is not shown in the API")
	_, ok = FunctionToDB("")
	assert.False(t, ok)
}

var msk = time.FixedZone("MSK", 3*60*60)

func at(s string) time.Time {
	t, err := time.ParseInLocation("2006-01-02 15:04", s, msk)
	if err != nil {
		panic(err)
	}
	return t
}

func TestWorkState(t *testing.T) {
	t.Parallel()
	now := at("2026-10-01 10:30")
	until := at("2026-10-05 00:00")
	past := at("2026-10-01 10:30")
	assert.Equal(t, StateScheduled, WorkState(at("2026-10-02 00:00"), nil, now))
	assert.Equal(t, StateActive, WorkState(at("2026-09-01 00:00"), nil, now))
	assert.Equal(t, StateActive, WorkState(at("2026-09-01 00:00"), &until, now))
	assert.Equal(t, StateEnded, WorkState(at("2026-09-01 00:00"), &past, now), "the end is exclusive")
	assert.Equal(t, StateActive, WorkState(now, nil, now), "the start is inclusive")
}

func TestCheckPeriod(t *testing.T) {
	t.Parallel()
	now := at("2026-10-01 10:30")
	ok := []struct {
		from  time.Time
		until *time.Time
	}{
		{at("2026-10-01 00:00"), nil}, // a correction of the current day
		{at("2026-10-01 10:00"), nil},
		{at("2026-10-02 00:00"), new(at("2026-10-09 00:00"))},
	}
	for _, c := range ok {
		require.NoError(t, CheckPeriod(c.from, c.until, now, msk), "%v", c.from)
	}
	// The texts of the mock (people.ts): an end out of range is «Проверьте срок функции.».
	const period = "Проверьте срок функции."
	bad := []struct {
		name   string
		from   time.Time
		until  *time.Time
		detail string
	}{
		{"yesterday", at("2026-09-30 23:59"), nil, "Функция может начаться не раньше сегодняшнего дня."},
		{"end before start", at("2026-10-03 00:00"), new(at("2026-10-02 00:00")), period},
		{"empty period", at("2026-10-03 00:00"), new(at("2026-10-03 00:00")), period},
		{"end in the past", at("2026-10-01 00:00"), new(at("2026-10-01 09:00")), period},
	}
	for _, c := range bad {
		err := CheckPeriod(c.from, c.until, now, msk)
		assert.True(t, problem.Is(err, CodeValidationFailed), "%s: %v", c.name, err)
		p, ok := errors.AsType[*problem.Error](err)
		if assert.True(t, ok, c.name) {
			assert.Equal(t, c.detail, p.Detail, c.name)
		}
	}
}

func TestDriverBlockedActions(t *testing.T) {
	t.Parallel()
	got := DriverBlockedActions()
	assert.Contains(t, got, "fleet.earnings.read", "AUTH-05: the driver function closes the earnings")
	assert.True(t, slices.IsSorted(got))
	assert.NotContains(t, got, "fleet.trips.start")
}

func TestCleanText(t *testing.T) {
	t.Parallel()
	got, err := CleanName("  Иван  Петров ", 150)
	require.NoError(t, err)
	assert.Equal(t, "Иван  Петров", got)
	for _, bad := range []string{"", "   ", string(make([]rune, 151))} {
		_, err := CleanName(bad, 150)
		assert.True(t, problem.Is(err, CodeValidationFailed), "%q", bad)
	}
	assert.True(t, ValidEmail("a.morozova@alta.example"))
	for _, bad := range []string{"", "a", "a@", "@b", "a b@c.d", "a@b@c"} {
		assert.False(t, ValidEmail(bad), bad)
	}
}
