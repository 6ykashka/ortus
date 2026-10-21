//go:build integration

package main

// W2.57 (Q-W2.07-17, Q-W2.07-1): досчёт пула по расписанию под ролью ortus_worker пишет всё, что требует «только рейс»:
// завершение перевода по сроку с событием fleet.transfer.expired.v1 и снятием водителя с не начатого рейса, назначение
// роли «Временный водитель» на машину рейса (область resource) — DML воркера по roles/grants.sql.

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/pool"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/migrations"
)

// poolSeed is a driver of «Север Логистик» published in the pool and two approved transfers of his to trips of «Юг
// Транс»: one whose window is over (the trip not started), one in its window whose trip has a vehicle.
type poolSeed struct {
	driver, ended, current, endedTrip, vehicle uuid.UUID
}

func seedPool(t *testing.T, db *sql.DB, now time.Time) poolSeed {
	t.Helper()
	ctx := t.Context()
	var s poolSeed
	var home, target, owner uuid.UUID
	if err := db.QueryRowContext(ctx, `select (select id from org.units where name = 'Север Логистик'),
		(select id from org.units where name = 'Юг Транс'), (select id from people.person_profiles order by id limit 1)`).
		Scan(&home, &target, &owner); err != nil {
		t.Fatal(err)
	}
	q := func(dst *uuid.UUID, sql string, args ...any) {
		t.Helper()
		if err := db.QueryRowContext(ctx, sql, args...).Scan(dst); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	q(&s.driver, `insert into people.person_profiles (full_name, home_unit_id) values ('Водитель пула воркера', $1) returning id`, home)
	var pub, role, grantEnded, grantCurrent, currentTrip uuid.UUID
	q(&pub, `insert into fleet.pool_publications (person_id, home_unit_id, available, published_by, display_name)
		values ($1, $2, tstzrange($3, $4), $5, $6) returning id`, s.driver, home, now.Add(-10*time.Hour), now.Add(10*time.Hour),
		owner, "Водитель #"+uuid.NewString()[:8])
	q(&role, `with r as (insert into access.roles (name, kind, template_key) values ('Временный водитель', 'system', 'temporary_driver')
		on conflict do nothing returning id) select id from r union all
		select id from access.roles where template_key = 'temporary_driver' and archived_at is null limit 1`)
	if _, err := db.ExecContext(ctx, `insert into access.role_versions (role_id, version, actions, created_by)
		values ($1, 1, $2, $3) on conflict do nothing`, role, pool.TemporaryDriverActions, owner); err != nil {
		t.Fatal(err)
	}
	q(&s.vehicle, `insert into fleet.vehicles (unit_id, plate, body_type, payload_kg, volume_m3, cargo_length_mm)
		values ($1, $2, 'van', 1500, 12, 3200) returning id`, target, "В "+uuid.NewString()[:6])
	q(&s.endedTrip, `insert into fleet.trips (number, unit_id, state, driver_person_id, planned)
		values ($1, $2, 'planned', $3, tstzrange($4, $5)) returning id`, "Р-W257-"+uuid.NewString()[:6], target, s.driver,
		now.Add(-6*time.Hour), now.Add(-2*time.Hour))
	q(&currentTrip, `insert into fleet.trips (number, unit_id, state, driver_person_id, vehicle_id, planned)
		values ($1, $2, 'assigned', $3, $4, tstzrange($5, $6)) returning id`, "Р-W257-"+uuid.NewString()[:6], target, s.driver,
		s.vehicle, now.Add(-time.Hour), now.Add(3*time.Hour))
	grant := `insert into access.role_assignments (principal_kind, principal_id, role_id, role_version, scope_kind,
		include_descendants, valid, source, granted_by) values ('person', $1, $2, 1, 'self', false, tstzrange($3, $4, '[)'),
		'transfer', $5) returning id`
	q(&grantEnded, grant, s.driver, role, now.Add(-6*time.Hour), now.Add(-2*time.Hour), owner)
	q(&grantCurrent, grant, s.driver, role, now.Add(-time.Hour), now.Add(3*time.Hour), owner)
	transfer := `insert into fleet.driver_transfers (publication_id, source_unit_id, target_unit_id, trip_id, period, state,
		requested_by, decided_by, decided_at, assignment_id) values ($1, $2, $3, $4, tstzrange($5, $6, '[)'), 'approved',
		$7, $7, $8, $9) returning id`
	q(&s.ended, transfer, pub, home, target, s.endedTrip, now.Add(-6*time.Hour), now.Add(-2*time.Hour), owner,
		now.Add(-7*time.Hour), grantEnded)
	q(&s.current, transfer, pub, home, target, currentTrip, now.Add(-time.Hour), now.Add(3*time.Hour), owner,
		now.Add(-7*time.Hour), grantCurrent)
	return s
}

// onePool is the tenant pools of one tenant DB (pool.Pools) for the service of the pool in a test.
type onePool struct{ p *pgxpool.Pool }

func (o onePool) For(context.Context, uuid.UUID) (*pgxpool.Pool, error) { return o.p, nil }

// W2.72 (S2-20 правило 4): срок выбора прошёл без выбора — досчёт под ролью ortus_worker подтверждает машину фирмы
// рейса (chosen_at — срок) и снимает обычную (deadline), рейс получает машину.
func TestPoolOffersAsWorker(t *testing.T) {
	t.Parallel()
	super := superDB(t, "t_alta")
	now := time.Now().UTC().Truncate(time.Second)
	var home, target, owner uuid.UUID
	if err := super.QueryRowContext(t.Context(), `select (select id from org.units where name = 'Север Логистик'),
		(select id from org.units where name = 'Юг Транс'), (select id from people.person_profiles order by id limit 1)`).
		Scan(&home, &target, &owner); err != nil {
		t.Fatal(err)
	}
	q := func(sql string, args ...any) uuid.UUID {
		t.Helper()
		var id uuid.UUID
		if err := super.QueryRowContext(t.Context(), sql, args...).Scan(&id); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return id
	}
	driver := q(`insert into people.person_profiles (full_name, home_unit_id) values ('Водитель предложения', $1) returning id`, home)
	from := now.Add(20 * time.Minute)
	deadline := from.Add(-pool.ChooseBefore)
	trip := q(`insert into fleet.trips (number, unit_id, state, driver_person_id, planned) values ($1, $2, 'planned', $3,
		tstzrange($4, $5)) returning id`, "Р-W272-"+uuid.NewString()[:6], target, driver, from, from.Add(4*time.Hour))
	group := uuid.New()
	offer := func(unit uuid.UUID, kind string) (uuid.UUID, uuid.UUID) {
		t.Helper()
		v := q(`insert into fleet.vehicles (unit_id, plate, body_type, payload_kg, volume_m3, cargo_length_mm)
			values ($1, $2, 'van', 1500, 12, 3200) returning id`, unit, "П "+uuid.NewString()[:6])
		r := q(`insert into sched.resources (kind, ref_id, home_unit_id) values ('vehicle', $1, $2) returning id`, v, unit)
		id := uuid.New()
		if _, err := super.ExecContext(t.Context(), `insert into sched.reservations (id, resource_id, bundle_id, during,
			occupied, state, hold_expires_at, source_type, source_id, created_by, offer_group_id, offered_to, offer_kind,
			choose_until) values ($1, $2, $1, tstzrange($3, $4), tstzrange($3, $4), 'hold', $5, 'fleet.trip', $6, $7, $8, $9,
			$10, $5)`, id, r, from, from.Add(4*time.Hour), deadline, trip, owner, group, driver, kind); err != nil {
			t.Fatal(err)
		}
		return v, id
	}
	hostVehicle, host := offer(target, "host")
	_, usual := offer(home, "usual")
	// Wired as main.go wires it (W2.72, return 1): the recipients and the owners through the control DB, the audience
	// and the evaluator through the tenant DB — all as ortus_worker.
	pools := onePool{tenantPool(t, "t_alta", migrations.RoleWorker)}
	control := tenantPool(t, controlDB, migrations.RoleWorker)
	clock := func() time.Time { return now }
	src := authz.PGSource{Pools: pools}
	ev := authz.New(src, src, clock)
	svc := &pool.Service{Pools: pools, Authz: ev, Recipients: inbox.PGRecipients{Control: control},
		Owners: pool.ControlOwners{Control: control}, Audience: inbox.AuthzAudience{E: ev}, Now: clock}
	if n, err := svc.SettleOffers(t.Context(), seedAlta); err != nil || n < 1 {
		t.Fatalf("SettleOffers as ortus_worker: %d %v, want the offer closed", n, err)
	}
	if n := count(t, super, `select count(*) from sched.reservations where id = $1 and state = 'confirmed' and chosen_at = $2`,
		host, deadline); n != 1 {
		t.Error("the vehicle of the trip company is not confirmed at the deadline")
	}
	if n := count(t, super, `select count(*) from sched.reservations where id = $1 and state = 'released'
		and release_reason = 'deadline'`, usual); n != 1 {
		t.Error("the usual vehicle is not released at the deadline")
	}
	if n := count(t, super, `select count(*) from fleet.trips where id = $1 and vehicle_id = $2 and state = 'assigned'`,
		trip, hostVehicle); n != 1 {
		t.Error("the trip has not got the vehicle of the trip company")
	}
	if n := count(t, super, `select count(*) from notify.notifications where kind = 'fleet.reservation.released'
		and entity_id = $1`, trip); n < 1 {
		t.Error("the company of the usual vehicle is not told «машина освобождена» by the worker")
	}
}

func TestPoolSettleAsWorker(t *testing.T) {
	t.Parallel()
	super := superDB(t, "t_alta")
	now := time.Now().UTC().Truncate(time.Second)
	s := seedPool(t, super, now)
	res, err := pool.SettleDB(t.Context(), tenantPool(t, "t_alta", migrations.RoleWorker), seedAlta, now)
	if err != nil {
		t.Fatalf("SettleDB as ortus_worker: %v", err)
	}
	if res.Completed < 1 || res.Unassigned < 1 {
		t.Fatalf("settlement %+v, want the ended transfer completed and its driver taken off the trip", res)
	}
	if n := count(t, super, `select count(*) from fleet.driver_transfers where id = $1 and state = 'completed'`, s.ended); n != 1 {
		t.Error("the transfer whose window is over is not completed")
	}
	if n := count(t, super, `select count(*) from fleet.trips where id = $1 and driver_person_id is null`, s.endedTrip); n != 1 {
		t.Error("the driver stays on the trip he did not start")
	}
	if n := count(t, super, `select count(*) from outbox.events where type = 'fleet.transfer.expired.v1' and payload->>'id' = $1`,
		s.ended.String()); n != 1 {
		t.Errorf("fleet.transfer.expired.v1 of the ended transfer: %d, want 1", n)
	}
	if n := count(t, super, `select count(*) from fleet.driver_transfers x join access.role_assignments va
		on va.id = x.vehicle_assignment_id where x.id = $1 and va.scope_kind = 'resource' and va.scope_ref = $2
		and va.principal_id = $3 and va.source = 'transfer' and upper(va.valid) = $4`, s.current, s.vehicle, s.driver,
		now.Add(3*time.Hour)); n != 1 {
		t.Error("no assignment of the vehicle of the trip in the window written by the worker")
	}
}
