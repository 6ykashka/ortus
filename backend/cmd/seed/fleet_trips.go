package main

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// Trips part of the seed (W2.05, S2-06…S2-09; Q-W2.02-5): the trips of «Альта» as mock-data.js 14.10
// (logistics/seed.ts W0.12, testdata/fleet-rules/fleet.json W2.01) with the ids of PD-30 — the MSW adapter builds the
// same ids (seedUuid of t-alta). Р-208 «Северный маршрут» is the trip of Илья Васильев, Р-211 «Охлаждённая продукция»
// waits for a driver; both are planned, without a vehicle: the driver reserves it on the stand (W2.02) and goes the
// path of the demo — inspection, start, expenses, return, acceptance.
//
// The prototype lives on 01.10.2026 at 10:30 with Р-208 at 09:00–13:00. The stand runs on the real clock, so the
// windows follow the run of the seed: Р-208 started an hour before the hour of the run and keeps the four hours of
// the prototype, Р-211 and every stop keep their offsets. A trip already in the database is left as it is: to start
// the demo afresh the stand is recreated (stand.mjs down -v, up, migrate, seed) shortly before it.

// stopSeed is a stop of a trip: the time label of the prototype, the address, load or unload, kg and m³.
type stopSeed struct{ at, address, op, weightKg, volumeM3 string }

// tripSeed is a trip of the prototype: measures as exact decimals (kg, m³, km, °C), the body length in mm.
type tripSeed struct {
	proto, unit, title, driver string // driver: the member proto, "" — no driver yet
	from, until                string // the window labels of the prototype (Moscow)
	distanceKm, cargo          string
	weightKg, volumeM3         string
	lengthMM                   int
	tempMin, tempMax           string // "" — no temperature mode
	stops                      []stopSeed
}

// tripSeeds are the trips of the tenants (mock-data.js:229–230, logistics/seed.ts).
var tripSeeds = map[string][]tripSeed{
	protoAlta: {
		{"Р-208", homeAlta, "Северный маршрут", "m-vasiliev", "09:00", "13:00", "46", "Сухой груз · 14 паллет-мест",
			"1100", "12", 3000, "", "", []stopSeed{
				{"09:00", "Склад № 1, Лобня", opLoad, "1100", "12"},
				{"10:15", "Химки, ул. Заводская, 8", opUnload, "700", "8"},
				{"11:30", "Долгопрудный, Лихачёвский пр., 4", opUnload, "400", "4"},
			}},
		{"Р-211", homeAlta, "Охлаждённая продукция", "", "14:00", "18:00", "31", "Молочная продукция · +2…+6 °C",
			"600", "7", 2400, "2", "6", []stopSeed{
				{"14:00", "Склад № 1, Лобня", opLoad, "600", "7"},
				{"15:10", "Мытищи, ул. Колпакова, 2", opUnload, "350", "4"},
				{"16:20", "Королёв, пр. Космонавтов, 20", opUnload, "250", "3"},
			}},
	},
}

// Operations of a stop (fleet.trip_stops.op).
const (
	opLoad   = "load"
	opUnload = "unload"
)

// prototypeStart is the start of the first trip of the prototype (Р-208, 09:00).
const prototypeStart = 9

// tripClock maps a time label of the prototype to the moment on the day of now: the labels move together so that the
// first trip starts an hour before the hour of now.
func tripClock(now time.Time) func(string) time.Time {
	local := now.In(msk)
	day := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, msk)
	start := local.Truncate(time.Hour).Add(-time.Hour)
	shift := start.Sub(day.Add(prototypeStart * time.Hour))
	return func(label string) time.Time {
		t, err := time.ParseInLocation("15:04", label, msk)
		if err != nil {
			panic("seed: time label " + label) // the labels are constants of this file
		}
		return day.Add(time.Duration(t.Hour())*time.Hour + time.Duration(t.Minute())*time.Minute + shift)
	}
}

// writeFleetTrips writes the trips of td for the run of the seed now.
func writeFleetTrips(ctx context.Context, tx *sql.Tx, td tenantData) error {
	return writeFleetTripsAt(ctx, tx, td, time.Now())
}

// writeFleetTripsAt writes the trips of td with the windows of now (tripClock); a second run changes nothing.
func writeFleetTripsAt(ctx context.Context, tx *sql.Tx, td tenantData, now time.Time) error {
	at := tripClock(now)
	for i, s := range tripSeeds[td.tenant.proto] {
		var driver, lo, hi any
		if s.driver != "" {
			driver = seedID(td.tenant.proto, s.driver)
		}
		if s.tempMin != "" {
			lo, hi = s.tempMin, s.tempMax
		}
		id := seedID(td.tenant.proto, s.proto)
		if _, err := tx.ExecContext(ctx, `insert into fleet.trips (id, number, unit_id, state, driver_person_id, planned, title,
			cargo_description, cargo_weight_kg, cargo_volume_m3, cargo_length_mm, cargo_temp_min_c, cargo_temp_max_c,
			distance_km, created_at)
			values ($1, $2, $3, 'planned', $4, tstzrange($5, $6, '[)'), $7, $8, $9::numeric, $10::numeric, $11,
			        $12::numeric, $13::numeric, $14::numeric, $15)
			on conflict (id) do nothing`,
			id, s.proto, td.unitID(s.unit), driver, at(s.from), at(s.until), s.title, s.cargo, s.weightKg, s.volumeM3,
			s.lengthMM, lo, hi, s.distanceKm, fleetRegistered.Add(time.Duration(i)*time.Second)); err != nil {
			return fmt.Errorf("trip %s: %w", s.proto, err)
		}
		for n, st := range s.stops {
			if _, err := tx.ExecContext(ctx, `insert into fleet.trip_stops (trip_id, seq, op, address, time_window, weight_kg, volume_m3)
				values ($1, $2, $3, $4, tstzrange($5, $5, '[]'), $6::numeric, $7::numeric)
				on conflict (trip_id, seq) do nothing`,
				id, n+1, st.op, st.address, at(st.at), st.weightKg, st.volumeM3); err != nil {
				return fmt.Errorf("trip %s stop %d: %w", s.proto, n+1, err)
			}
		}
	}
	return nil
}
