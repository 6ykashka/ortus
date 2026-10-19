//go:build integration

package migrations_test

import (
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// tenant 0018 (W2.57) на реальном сервере под runtime-ролью API: назначение на машину рейса — строка
// access.role_assignments, и только у запроса с основным временным назначением.
func TestStage2W257Constraints(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		name, _ := migrated(t, c, migrations.Tenant)
		db := c.DB(t, name, migrations.RoleAPI)
		ctx := t.Context()
		exec := func(q string, args ...any) error {
			_, err := db.ExecContext(ctx, q, args...)
			return err
		}
		wantState := func(what string, err error, state string) {
			t.Helper()
			if got := sqlState(err); got != state {
				t.Errorf("%s: SQLSTATE %q (%v), want %s", what, got, err, state)
			}
		}

		yug := scalar[string](t, db, `insert into org.units (kind, name, time_zone)
			values ('company', 'Юг Транс', 'Europe/Moscow') returning id::text`)
		sever := scalar[string](t, db, `insert into org.units (kind, name, time_zone)
			values ('company', 'Север Логистик', 'Europe/Moscow') returning id::text`)
		driver := scalar[string](t, db, `insert into people.person_profiles (full_name, home_unit_id)
			values ('Водитель Юга', $1) returning id::text`, yug)
		pub := scalar[string](t, db, `insert into fleet.pool_publications (person_id, home_unit_id, available, published_by)
			values ($1, $2, tstzrange('2026-10-01 10:00Z', '2026-10-01 16:00Z'), $1) returning id::text`, driver, yug)
		req := scalar[string](t, db, `insert into fleet.driver_transfers (publication_id, source_unit_id, target_unit_id,
			period, state, requested_by) values ($1, $2, $3, tstzrange('2026-10-01 11:00Z', '2026-10-01 15:00Z'), 'requested', $4)
			returning id::text`, pub, yug, sever, driver)
		role := scalar[string](t, db, `insert into access.roles (name, kind, template_key)
			values ('Временный водитель', 'system', 'temporary_driver') returning id::text`)
		if err := exec(`insert into access.role_versions (role_id, version, actions, created_by)
			values ($1, 1, '{fleet.vehicles.read}', $2)`, role, driver); err != nil {
			t.Fatal(err)
		}
		vehicle := scalar[string](t, db, `insert into access.role_assignments (principal_kind, principal_id, role_id,
			role_version, scope_kind, scope_ref, include_descendants, valid, source, granted_by)
			values ('person', $1, $2, 1, 'resource', $3, false, tstzrange('2026-10-01 11:00Z', '2026-10-01 15:00Z'),
			'transfer', $1) returning id::text`, driver, role, uuid.NewString())

		wantState("vehicle grant without the grant of the request", exec(`update fleet.driver_transfers
			set vehicle_assignment_id = $2 where id = $1`, req, vehicle), "23514")
		wantState("vehicle grant of a missing assignment", exec(`update fleet.driver_transfers
			set assignment_id = $2, vehicle_assignment_id = $3 where id = $1`, req, vehicle, uuid.NewString()), "23503")
		if err := exec(`update fleet.driver_transfers set assignment_id = $2, vehicle_assignment_id = $2 where id = $1`,
			req, vehicle); err != nil {
			t.Errorf("request with its grant and the vehicle grant: %v", err)
		}
	})
}
