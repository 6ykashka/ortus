//go:build integration

package fleet_test

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: clock of the suites
)

// seedIDs are the ids of the seeded objects: vehicles by key, trips by number, expenses by key.
type seedIDs struct {
	vehicles map[string]uuid.UUID
	trips    map[string]uuid.UUID
	expenses map[string]uuid.UUID
}

// vehicleRow is a seeded vehicle.
type vehicleRow struct {
	key, tenant, unit, name, plate, volume, service string
	archived                                        bool
}

// tripRow is a seeded trip: dep and ret are the odometers of its inspections ("" — none), earnings its ledger row
// (0 — none).
type tripRow struct {
	number, tenant, unit, state, driver, vehicle, title string
	dep, ret                                            string
	earnings                                            int64
}

// expenseRow is a seeded expense of a trip.
type expenseRow struct {
	key, tenant, trip, kind string
	amount                  int64
	on                      string
}

// The world of the tests (tenant A unless said; Москва-1 is the firm of a.manager-msk1):
//   - Москва-1: «ГАЗель Next» (free), «Ford Transit» (on the route of Р-701), «ГАЗон Next» (maintenance), «Hyundai
//     Porter» (handed in with Р-702), «Mercedes Sprinter» (assigned to Р-704), an archived «Старая Газель»;
//   - Москва-2: «Isuzu Elf» with a blocking defect in review; Самара-2: «ГАЗель Бизнес»; tenant B Москва-1: its own
//     «ГАЗель Next» and Самара-2 — 10 001 vehicles for the cap of visibleCount;
//   - trips Р-701…Р-708 (Р-707 cancelled), Р-801 in B; earnings of Р-703 (Москва-1) and Р-705 (Москва-2), the accepted
//     Р-706 without a ledger row;
//   - expenses E1…E4 in A, E5 in B;
//   - a.region-msk is put into the group «Финансы» (fleet.earnings.read on Москва-1).
var (
	vehicleRows = []vehicleRow{
		{"gazel", "a", "msk1", "ГАЗель Next", "А 412 МР 77", "16", "ok", false},
		{"ford", "a", "msk1", "Ford Transit", "М 608 КТ 77", "11", "ok", false},
		{"gazon", "a", "msk1", "ГАЗон Next", "Е 905 НА 77", "30", "maintenance", false},
		{"porter", "a", "msk1", "Hyundai Porter", "В 233 ОС 77", "9", "ok", false},
		{"sprinter", "a", "msk1", "Mercedes Sprinter", "Т 771 ЕХ 77", "14", "ok", false},
		{"isuzu", "a", "msk2", "Isuzu Elf", "К 120 РУ 77", "20", "ok", false},
		{"biz", "a", "smr2", "ГАЗель Бизнес", "О 318 ХС 163", "14", "ok", false},
		{"old", "a", "msk1", "Старая Газель", "У 001 УУ 77", "10", "ok", true},
		{"b-gazel", "b", "msk1", "ГАЗель Next", "А 412 МР 77", "16", "ok", false},
	}
	tripRows = []tripRow{
		{"Р-701", "a", "msk1", "on_route", "a.driver-msk1", "ford", "Северный маршрут", "1000", "", 0},
		{"Р-702", "a", "msk1", "submitted", "a.driver-msk2", "porter", "Химки", "500", "546", 0},
		{"Р-703", "a", "msk1", "accepted", "a.driver-msk1", "gazel", "Лобня", "100", "160", 250000},
		{"Р-704", "a", "msk1", "assigned", "", "sprinter", "Мытищи", "", "", 0},
		{"Р-705", "a", "msk2", "accepted", "a.driver-msk2", "isuzu", "Юг", "", "", 120000},
		{"Р-706", "a", "msk1", "accepted", "a.driver-msk1", "gazel", "Королёв", "", "", 0},
		{"Р-707", "a", "msk1", "cancelled", "", "", "Отменённый", "", "", 0},
		{"Р-708", "a", "smr2", "planned", "", "", "Самара", "", "", 0},
		{"Р-801", "b", "msk1", "planned", "b.driver-msk1", "", "Чужой", "", "", 0},
	}
	expenseRows = []expenseRow{
		{"E1", "a", "Р-701", "fuel", 250000, "2026-09-30"},
		{"E2", "a", "Р-703", "wash", 80000, "2026-09-29"},
		{"E3", "a", "Р-705", "parking", 30000, "2026-09-28"},
		{"E4", "a", "Р-708", "toll", 15000, "2026-09-27"},
		{"E5", "b", "Р-801", "fuel", 99900, "2026-09-30"},
	}
)

// started are the states of a trip with a vehicle that has left (fleet.trips check).
var started = map[string]bool{"on_route": true, "returning": true, "submitted": true, "rework": true, "accepted": true}

type seeder struct {
	ctx context.Context //nolint:containedctx // one seed run of TestMain
	err error
}

func (s *seeder) exec(tenant, q string, args ...any) {
	if s.err != nil {
		return
	}
	if _, err := dbs[tenant].ExecContext(s.ctx, q, args...); err != nil {
		s.err = fmt.Errorf("%s: %w", q, err)
	}
}

func (s *seeder) id(tenant, q string, args ...any) uuid.UUID {
	var id uuid.UUID
	if s.err == nil {
		if err := dbs[tenant].QueryRowContext(s.ctx, q, args...).Scan(&id); err != nil {
			s.err = fmt.Errorf("%s: %w", q, err)
		}
	}
	return id
}

func seed(ctx context.Context) (seedIDs, error) {
	s := &seeder{ctx: ctx}
	ids := seedIDs{vehicles: map[string]uuid.UUID{}, trips: map[string]uuid.UUID{}, expenses: map[string]uuid.UUID{}}
	registered := harness.Now().Add(-30 * 24 * time.Hour)
	for i, v := range vehicleRows {
		ids.vehicles[v.key] = uuid.New()
		var archived any
		if v.archived {
			archived = registered
		}
		s.exec(v.tenant, `insert into fleet.vehicles (id, unit_id, plate, body_type, payload_kg, volume_m3, cargo_length_mm,
			display_name, service_state, archived_at, created_at) values ($1, $2, $3, 'van', 1500, $4::numeric, 3200, $5, $6, $7, $8)`,
			ids.vehicles[v.key], ref("unit:"+v.tenant+"."+v.unit), v.plate, v.volume, v.name, v.service, archived,
			registered.Add(time.Duration(i)*time.Second))
	}
	s.exec("a", `insert into fleet.defects (vehicle_id, zone, severity, description, state)
		values ($1, 'Шины и колёса', 'blocking', 'Порез боковины', 'in_review')`, ids.vehicles["isuzu"])
	s.exec("b", `insert into fleet.vehicles (unit_id, plate, body_type, payload_kg, volume_m3, cargo_length_mm, display_name)
		select $1, 'CAP-' || g, 'van', 1000, 10, 3000, 'Счётчик ' || g from generate_series(1, 10001) g`, ref("unit:b.smr2"))
	checklists := map[string]uuid.UUID{}
	for _, kind := range []string{"departure", "return"} {
		for _, t := range []string{"a", "b"} {
			checklists[t+kind] = s.id(t, `insert into fleet.checklist_versions (kind, version, items) values ($1, 1, '[]') returning id`, kind)
		}
	}
	for i, t := range tripRows {
		seedTrip(s, ids, checklists, t, i)
	}
	for _, e := range expenseRows {
		ids.expenses[e.key] = uuid.New()
		var liters any
		if e.kind == "fuel" {
			liters = "40"
		}
		s.exec(e.tenant, `insert into fleet.expenses (id, trip_id, category, amount_minor, liters, occurred_on, claimed_by)
			values ($1, $2, $3, $4, $5::numeric, $6::date, $7)`, ids.expenses[e.key], ids.trips[e.trip], e.kind, e.amount, liters, e.on,
			person("a.owner", "a"))
	}
	s.exec("a", `insert into access.group_members (group_id, person_id) values ($1, $2)`, ref("group:a.finance"),
		person("a.region-msk", "a"))
	return ids, s.err
}

// seedTrip writes a trip with its inspections and earnings.
func seedTrip(s *seeder, ids seedIDs, checklists map[string]uuid.UUID, t tripRow, i int) {
	id := uuid.New()
	ids.trips[t.number] = id
	now := harness.Now()
	var driver, vehicle, startedAt, reviewedAt, reviewer any
	if t.driver != "" {
		driver = person(t.driver, t.tenant)
	}
	if t.vehicle != "" {
		vehicle = ids.vehicles[t.vehicle]
	}
	if started[t.state] {
		startedAt = now.Add(-5 * time.Hour)
	}
	if t.state == "accepted" {
		reviewedAt, reviewer = now.Add(-time.Hour), person(t.tenant+".owner", t.tenant)
	}
	s.exec(t.tenant, `insert into fleet.trips (id, number, unit_id, state, vehicle_id, driver_person_id, planned, title, started_at,
		reviewed_at, reviewed_by, created_at) values ($1, $2, $3, $4, $5, $6, tstzrange($7, $8), $9, $10, $11, $12, $13)`,
		id, t.number, ref("unit:"+t.tenant+"."+t.unit), t.state, vehicle, driver, now.Add(-6*time.Hour), now.Add(2*time.Hour),
		t.title, startedAt, reviewedAt, reviewer, now.Add(time.Duration(i)*time.Second))
	for kind, odometer := range map[string]string{"departure": t.dep, "return": t.ret} {
		if odometer == "" {
			continue
		}
		insp := s.id(t.tenant, `insert into fleet.inspections (trip_id, vehicle_id, kind, checklist_version_id, odometer_km, fuel_level,
			answers, state, submitted_by) values ($1, $2, $3, $4, $5::numeric, 'full', '{}', 'submitted', $6) returning id`,
			id, vehicle, kind, checklists[t.tenant+kind], odometer, driver)
		s.exec(t.tenant, `update fleet.trips set `+kind+`_inspection_id = $2 where id = $1`, id, insp)
	}
	if t.earnings > 0 {
		s.exec(t.tenant, `insert into finance.earnings (trip_id, person_id, unit_id, amount_minor) values ($1, $2, $3, $4)`,
			id, driver, ref("unit:"+t.tenant+"."+t.unit), t.earnings)
	}
}
