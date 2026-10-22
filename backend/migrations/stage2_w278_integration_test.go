//go:build integration

package migrations_test

import (
	"database/sql"
	"testing"
	"time"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// releasedAt is the moment of the return inspection of the seeded trips.
var releasedAt = time.Date(2026, time.October, 1, 14, 5, 0, 0, time.UTC)

// w278 is a tenant DB at 0026 with two companies (Юг Транс — the home company of the temporary driver, Север Логистик —
// the company of the trips), a driver of Юг Транс published in the pool and a return checklist.
type w278 struct {
	t                    *testing.T
	mig                  *sql.DB
	yug, sever, driver   string
	publication, version string
	n                    int
}

func newW278(t *testing.T, mig *sql.DB) *w278 {
	t.Helper()
	w := &w278{t: t, mig: mig}
	w.yug = scalar[string](t, mig, `insert into org.units (kind, name, time_zone) values ('company', 'Юг Транс', 'Europe/Moscow')
		returning id::text`)
	w.sever = scalar[string](t, mig, `insert into org.units (kind, name, time_zone) values ('company', 'Север Логистик',
		'Europe/Moscow') returning id::text`)
	w.driver = scalar[string](t, mig, `insert into people.person_profiles (full_name, home_unit_id) values ('Олег Тарасов', $1)
		returning id::text`, w.yug)
	w.publication = scalar[string](t, mig, `insert into fleet.pool_publications (person_id, home_unit_id, available, published_by)
		values ($1, $2, tstzrange('2026-10-01 06:00Z', '2026-10-01 20:00Z'), $1) returning id::text`, w.driver, w.yug)
	w.version = scalar[string](t, mig, `insert into fleet.checklist_versions (kind, version, items) values ('return', 9001, '[]')
		returning id::text`)
	return w
}

func (w *w278) exec(q string, args ...any) {
	w.t.Helper()
	if _, err := w.mig.ExecContext(w.t.Context(), q, args...); err != nil {
		w.t.Fatalf("%s: %v", q, err)
	}
}

func (w *w278) vehicle(unit string) string {
	w.t.Helper()
	w.n++
	return scalar[string](w.t, w.mig, `insert into fleet.vehicles (unit_id, plate, body_type, payload_kg, volume_m3,
		cargo_length_mm) values ($1, 'Н 3'||$2::int::text||' ТК 77', 'van', 1500, 12, 3200) returning id::text`, unit, w.n+10)
}

// trip writes a started trip of Север Логистик in state on vehicle v.
func (w *w278) trip(state, v string) string {
	w.t.Helper()
	w.n++
	return scalar[string](w.t, w.mig, `insert into fleet.trips (number, unit_id, state, vehicle_id, driver_person_id, planned,
		started_at) values ('Р-W278-'||$1::int::text, $2, $3, $4, $5, tstzrange('2026-10-01 08:00Z', '2026-10-01 16:00Z'),
		'2026-10-01 08:10Z') returning id::text`, w.n, w.sever, state, v, w.driver)
}

// returned writes the return inspection of trip tr on v at releasedAt.
func (w *w278) returned(tr, v string) {
	w.t.Helper()
	insp := scalar[string](w.t, w.mig, `insert into fleet.inspections (trip_id, vehicle_id, kind, checklist_version_id,
		odometer_km, fuel_level, answers, state, submitted_by, submitted_at) values ($1, $2, 'return', $3, 48500, 'half',
		'{}', 'submitted', $4, $5) returning id::text`, tr, v, w.version, w.driver, releasedAt)
	w.exec(`update fleet.trips set return_inspection_id = $2 where id = $1`, tr, insp)
}

// transfer writes the request of the trip tr with the usual vehicle home approved by Юг Транс.
func (w *w278) transfer(tr, home string) {
	w.t.Helper()
	w.exec(`insert into fleet.driver_transfers (publication_id, source_unit_id, target_unit_id, trip_id, period, state,
		requested_by, vehicle_mode, home_vehicle_id, vehicle_decision)
		values ($1, $2, $3, $4, tstzrange('2026-10-01 08:00Z', '2026-10-01 16:00Z'), 'expired', $5, 'home', $6, 'approved')`,
		w.publication, w.yug, w.sever, tr, w.driver, home)
}

func (w *w278) mark(tr string) sql.NullTime {
	w.t.Helper()
	var v sql.NullTime
	if err := w.mig.QueryRowContext(w.t.Context(), `select vehicle_released_at from fleet.trips where id = $1`, tr).Scan(&v); err != nil {
		w.t.Fatal(err)
	}
	return v
}

// w278Cases are the vehicles and the trips of the test.
type w278Cases struct {
	usual, onRoute, foreign, own, accepted string // vehicles
	released, driving, plain, mine, done   string // trips
}

func (w *w278) seed() w278Cases {
	w.t.Helper()
	c := w278Cases{usual: w.vehicle(w.yug), onRoute: w.vehicle(w.yug), foreign: w.vehicle(w.yug), own: w.vehicle(w.sever),
		accepted: w.vehicle(w.yug)}
	c.released = w.trip("submitted", c.usual)
	w.transfer(c.released, c.usual)
	w.returned(c.released, c.usual)
	c.driving = w.trip("on_route", c.onRoute)
	w.transfer(c.driving, c.onRoute)
	c.plain = w.trip("rework", c.foreign)
	w.returned(c.plain, c.foreign)
	c.mine = w.trip("submitted", c.own)
	w.returned(c.mine, c.own)
	c.done = w.trip("accepted", c.accepted)
	w.transfer(c.done, c.accepted)
	w.returned(c.done, c.accepted)
	return c
}

// moves checks under the runtime role of the API that another trip of Юг Транс takes the released usual vehicle to an
// inspection and no vehicle still held; it returns the trip on the usual vehicle.
func (w *w278) moves(api *sql.DB, c w278Cases) string {
	w.t.Helper()
	move := func(v string) (string, error) {
		w.n++
		next := scalar[string](w.t, api, `insert into fleet.trips (number, unit_id, state, planned)
			values ('Р-W278-'||$1::int::text, $2, 'planned', tstzrange('2026-10-02 08:00Z', '2026-10-02 16:00Z')) returning id::text`,
			w.n, w.yug)
		_, err := api.ExecContext(w.t.Context(), `update fleet.trips set state = 'inspection', vehicle_id = $2 where id = $1`, next, v)
		return next, err
	}
	next, err := move(c.usual)
	if err != nil {
		w.t.Errorf("another trip on the released usual vehicle: %v", err)
	}
	for what, v := range map[string]string{"the usual vehicle twice": c.usual, "on the route": c.onRoute,
		"another company without a transfer": c.foreign, "the trip company": c.own} {
		if _, err := move(v); sqlState(err) != "23505" {
			w.t.Errorf("%s: SQLSTATE %q (%v), want 23505", what, sqlState(err), err)
		}
	}
	if _, err := move(c.accepted); err != nil {
		w.t.Errorf("the vehicle of an accepted shift: %v", err)
	}
	_, err = api.ExecContext(w.t.Context(), `update fleet.trips set vehicle_id = null, vehicle_released_at = $2 where id = $1`,
		next, releasedAt)
	if sqlState(err) != "23514" {
		w.t.Errorf("a release mark without a vehicle: SQLSTATE %q (%v), want 23514", sqlState(err), err)
	}
	return next
}

// downIndex is trips_active_vehicle_uq of tenant 0002.
const downIndex = "CREATE UNIQUE INDEX trips_active_vehicle_uq ON fleet.trips USING btree (vehicle_id) WHERE (state = ANY " +
	"(ARRAY['inspection'::text, 'defect_review'::text, 'on_route'::text, 'returning'::text, 'submitted'::text, 'rework'::text]))"

// tenant 0027 (W2.78, Q-W2.72-1) на живых строках 0026: Up отмечает «машина отпущена» только у рейса, ждущего приёмки
// после осмотра сдачи на обычной машине одобренного перевода (момент — осмотр сдачи); рейс в пути, машина другой фирмы
// без перевода, машина фирмы рейса и принятая смена отметки не получают. Затем под runtime-ролью API: другой рейс фирмы
// обычной машины переходит по ней в «Осмотр», по остальным — 23505; отметка без машины — 23514. Down возвращает схему
// 0026 (индекс 0002), повторный Up проходит.
func TestStage2W278ReleasedVehicle(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		ctx := t.Context()
		name := c.NewDatabase(t, "released")
		mig := c.DB(t, name, migrations.RoleMigrator)
		if _, err := migrations.UpTo(ctx, mig, migrations.Tenant, 26); err != nil {
			t.Fatalf("up to 26: %v", err)
		}
		w := newW278(t, mig)
		cs := w.seed()
		if _, err := migrations.Up(ctx, mig, migrations.Tenant); err != nil {
			t.Fatalf("up 0027 over live trips: %v", err)
		}
		if m := w.mark(cs.released); !m.Valid || !m.Time.Equal(releasedAt) {
			t.Errorf("released usual vehicle: mark %v, want %s", m, releasedAt)
		}
		for what, tr := range map[string]string{"on the route": cs.driving, "another company without a transfer": cs.plain,
			"the trip company": cs.mine, "accepted": cs.done} {
			if m := w.mark(tr); m.Valid {
				t.Errorf("%s: mark %v, want none", what, m)
			}
		}
		next := w.moves(c.DB(t, name, migrations.RoleAPI), cs)

		// Down: the index of 0002 holds the vehicle until the acceptance again, so the second trip on it leaves first.
		w.exec(`update fleet.trips set state = 'cancelled' where id = $1`, next)
		if _, err := migrations.DownTo(ctx, mig, migrations.Tenant, 26); err != nil {
			t.Fatalf("down to 26: %v", err)
		}
		if got := scalar[int](t, mig, `select count(*)::int from information_schema.columns
			where table_schema = 'fleet' and table_name = 'trips' and column_name = 'vehicle_released_at'`); got != 0 {
			t.Errorf("vehicle_released_at after Down: %d columns, want 0", got)
		}
		if def := scalar[string](t, mig, `select indexdef from pg_indexes where schemaname = 'fleet'
			and indexname = 'trips_active_vehicle_uq'`); def != downIndex {
			t.Errorf("index after Down:\n got %s\nwant %s", def, downIndex)
		}
		if _, err := migrations.Up(ctx, mig, migrations.Tenant); err != nil {
			t.Fatalf("up again: %v", err)
		}
		if m := w.mark(cs.released); !m.Valid {
			t.Error("the mark after Up again: none, want the return inspection")
		}
	})
}
