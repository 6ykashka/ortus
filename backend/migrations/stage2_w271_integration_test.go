//go:build integration

package migrations_test

import (
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// tenant 0023 (W2.71, S2-20; в ветке — 0019) на реальном сервере под runtime-ролью API: обычная машина публикации — машина
// fleet.vehicles; режим машины запроса и его машины согласованы; брони предложения — группа и кому вместе, срок выбора
// только у предложения, hold предложения держится до срока выбора, подтверждённая бронь в группе одна; снятие — с
// причиной из списка и только у снятой брони.
func TestStage2W271Constraints(t *testing.T) {
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
		ok := func(what string, err error) {
			t.Helper()
			if err != nil {
				t.Errorf("%s: %v", what, err)
			}
		}

		yug := scalar[string](t, db, `insert into org.units (kind, name, time_zone)
			values ('company', 'Юг Транс', 'Europe/Moscow') returning id::text`)
		sever := scalar[string](t, db, `insert into org.units (kind, name, time_zone)
			values ('company', 'Север Логистик', 'Europe/Moscow') returning id::text`)
		driver := scalar[string](t, db, `insert into people.person_profiles (full_name, home_unit_id)
			values ('Олег Тарасов', $1) returning id::text`, yug)
		vehicle := func(unit, plate string) string {
			return scalar[string](t, db, `insert into fleet.vehicles (unit_id, plate, body_type, payload_kg, volume_m3,
				cargo_length_mm) values ($1, $2, 'reefer', 1800, 13, 3600) returning id::text`, unit, plate)
		}
		hd35, transit := vehicle(yug, "Н 384 ТК 77"), vehicle(sever, "М 608 КТ 77")

		// Обычная машина публикации — машина fleet.vehicles.
		pub := scalar[string](t, db, `insert into fleet.pool_publications (person_id, home_unit_id, available, published_by,
			usual_vehicle_id) values ($1, $2, tstzrange('2026-10-01 10:00Z', '2026-10-01 16:00Z'), $1, $3) returning id::text`,
			driver, yug, hd35)
		wantState("usual vehicle of a missing vehicle", exec(`update fleet.pool_publications set usual_vehicle_id = $2
			where id = $1`, pub, uuid.NewString()), "23503")

		// Режим машины запроса и его машины.
		req := func(mode, home, host any) error {
			return exec(`insert into fleet.driver_transfers (publication_id, source_unit_id, target_unit_id, period, state,
				requested_by, vehicle_mode, home_vehicle_id, host_vehicle_id) values ($1, $2, $3,
				tstzrange('2026-10-01 11:00Z', '2026-10-01 15:00Z'), 'expired', $4, $5, $6, $7)`,
				pub, yug, sever, driver, mode, home, host)
		}
		ok("request without vehicle (0.6.2)", req(nil, nil, nil))
		ok("host_or_home with both vehicles", req("host_or_home", hd35, transit))
		ok("home with the usual vehicle", req("home", hd35, nil))
		ok("host with the vehicle of the trip company", req("host", nil, transit))
		wantState("unknown mode", req("borrow", hd35, transit), "23514")
		wantState("host without the vehicle", req("host", nil, nil), "23514")
		wantState("home with the vehicle of the trip company", req("home", hd35, transit), "23514")
		wantState("host_or_home without the usual vehicle", req("host_or_home", nil, transit), "23514")
		wantState("vehicles without mode", req(nil, hd35, nil), "23514")
		wantState("decision without the usual vehicle", exec(`insert into fleet.driver_transfers (publication_id,
			source_unit_id, target_unit_id, period, state, requested_by, vehicle_mode, host_vehicle_id, vehicle_decision)
			values ($1, $2, $3, tstzrange('2026-10-01 11:00Z', '2026-10-01 15:00Z'), 'expired', $4, 'host', $5, 'approved')`,
			pub, yug, sever, driver, transit), "23514")
		wantState("unknown decision", exec(`insert into fleet.driver_transfers (publication_id, source_unit_id,
			target_unit_id, period, state, requested_by, vehicle_mode, home_vehicle_id, vehicle_decision)
			values ($1, $2, $3, tstzrange('2026-10-01 11:00Z', '2026-10-01 15:00Z'), 'expired', $4, 'home', $5, 'maybe')`,
			pub, yug, sever, driver, hd35), "23514")

		// Брони предложения.
		resource := func(v, unit string) string {
			return scalar[string](t, db, `insert into sched.resources (kind, ref_id, home_unit_id) values ('vehicle', $1, $2)
				returning id::text`, v, unit)
		}
		rHD, rTransit := resource(hd35, yug), resource(transit, sever)
		group, trip := uuid.NewString(), uuid.NewString()
		const window = "tstzrange('2026-10-01 11:00Z', '2026-10-01 15:00Z')"
		hold := func(res string, group, to any, until any, expires string) error {
			return exec(`insert into sched.reservations (resource_id, bundle_id, during, occupied, state, hold_expires_at,
				source_type, source_id, created_by, offer_group_id, offered_to, offer_kind, choose_until)
				values ($1, gen_random_uuid(), `+window+`, `+window+`, 'hold', $2, 'fleet.trip', $3, $4, $5, $6, $7, $8)`,
				res, expires, trip, driver, group, to, kindOf(group), until)
		}
		const until = "2026-10-01 10:30Z"
		wantState("offer without the driver", hold(rHD, group, nil, nil, until), "23514")
		wantState("choose_until without an offer", hold(rHD, nil, nil, until, until), "23514")
		wantState("hold of an offer outliving choose_until", hold(rHD, group, driver, until, "2026-10-01 11:00Z"), "23514")
		ok("hold of the usual vehicle", hold(rHD, group, driver, until, until))
		ok("hold of the vehicle of the trip company", hold(rTransit, group, driver, until, until))
		wantState("offer of an unknown person", hold(resource(vehicle(yug, "Т 001 ТТ 77"), yug), uuid.NewString(),
			uuid.NewString(), until, until), "23503")
		ok("choose one", exec(`update sched.reservations set state = 'confirmed', chosen_at = '2026-10-01 10:12Z'
			where offer_group_id = $1 and resource_id = $2`, group, rHD))
		wantState("a second confirmed reservation of the group", exec(`update sched.reservations set state = 'confirmed'
			where offer_group_id = $1 and resource_id = $2`, group, rTransit), "23505")
		wantState("unknown release reason", exec(`update sched.reservations set state = 'released', released_at = now(),
			release_reason = 'whim' where offer_group_id = $1 and resource_id = $2`, group, rTransit), "23514")
		wantState("release reason of a held reservation", exec(`update sched.reservations set release_reason = 'chosen'
			where offer_group_id = $1 and resource_id = $2`, group, rTransit), "23514")
		ok("release the other one", exec(`update sched.reservations set state = 'released', released_at = now(),
			release_reason = 'chosen' where offer_group_id = $1 and resource_id = $2`, group, rTransit))
		wantState("chosen_at of a released reservation", exec(`update sched.reservations set chosen_at = now()
			where offer_group_id = $1 and resource_id = $2`, group, rTransit), "23514")
	})
}

// kindOf is the offer kind of a seeded reservation: a reservation of an offer has one, a plain one has none.
func kindOf(group any) any {
	if group == nil {
		return nil
	}
	return "usual"
}
