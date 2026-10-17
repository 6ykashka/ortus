//go:build integration

package reservations

import (
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: the clock of the suite
)

// personOf registers a person of unit (a key of tenant A), with the work function «Водитель» since a month when
// driver is true.
func (e env) personOf(t *testing.T, unit string, driver bool) uuid.UUID {
	t.Helper()
	ctx, pool := t.Context(), e.pool(t)
	var pid uuid.UUID
	require.NoError(t, pool.QueryRow(ctx, `insert into people.person_profiles (full_name, home_unit_id) values ('Сотрудник', $1)
		returning id`, id(t, "unit:a."+unit)).Scan(&pid))
	if driver {
		_, err := pool.Exec(ctx, `insert into people.work_profiles (person_id, function, unit_id, valid)
			values ($1, 'driver', $2, tstzrange($3, null))`, pid, id(t, "unit:a."+unit), harness.Now().AddDate(0, -1, 0))
		require.NoError(t, err)
	}
	return pid
}

// grantReservations gives person a custom role with fleet.reservations.create over unit (a key of tenant A) — a
// dispatcher who is not a driver.
func (e env) grantReservations(t *testing.T, person uuid.UUID, unit string) {
	t.Helper()
	ctx, pool := t.Context(), e.pool(t)
	role := uuid.New()
	for _, s := range []struct {
		sql  string
		args []any
	}{
		{`insert into access.roles (id, name, kind) values ($1, $2, 'custom')`, []any{role, "Диспетчер брони " + role.String()[:8]}},
		{`insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`,
			[]any{role, []string{ActionCreate, ActionRead, "fleet.vehicles.read"}, person}},
		{`insert into access.role_assignments (principal_kind, principal_id, role_id, role_version, scope_kind, scope_ref,
			include_descendants, valid, granted_by) values ('person', $1, $2, 1, 'unit', $3, true, tstzrange($4, null), $1)`,
			[]any{person, role, id(t, "unit:a."+unit), harness.Now().AddDate(0, -1, 0)}},
		{`update access.policy_state set policy_version = policy_version + 1`, nil},
	} {
		_, err := pool.Exec(ctx, s.sql, s.args...)
		require.NoError(t, err)
	}
}

// A member with fleet.reservations.create over Москва-1 reserves for the drivers of its area only (brief §10 item 3).
// A person it cannot see (members.read) answers like a person that does not exist — the same 422 «Водитель не
// найден.», whether the person is a driver or not (AC-01); a person it sees outside the area of the right is 403.
func TestReserveVehicleDriverOfTheArea(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	e.grantReservations(t, id(t, "person:a.region-msk@a"), "msk1")
	ctx := e.as(t, "a.region-msk") // the manager of the region Москва (members.read), the dispatcher of Москва-1
	v := e.vehicle(t)
	from, until := day(13, 6), day(13, 8)

	for name, person := range map[string]uuid.UUID{
		"водитель невидимой фирмы":    e.personOf(t, "smr2", true),
		"не водитель невидимой фирмы": e.personOf(t, "smr2", false),
		"несуществующий сотрудник":    uuid.New(),
	} {
		_, err := e.reserve(ctx, body(v, person, from, until))
		pe, ok := errors.AsType[*problem.Error](err)
		require.True(t, ok, "%s: not a Problem: %v", name, err)
		require.Equal(t, [2]string{"validation_failed", textDriverUnknown}, [2]string{pe.Code, pe.Detail}, name)
	}
	_, err := e.reserve(ctx, body(v, e.personOf(t, "msk2", true), from, until))
	requireProblem(t, err, problem.CodeForbiddenAction) // a driver of Москва-2 it sees, outside the area of the right

	_, err = e.reserve(ctx, body(v, e.personOf(t, "msk1", false), from, until))
	requireProblem(t, err, "validation_failed", textNotADriver)

	e.reserved(ctx, t, body(v, e.personOf(t, "msk1", true), from, until))
}
