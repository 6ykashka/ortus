//go:build integration

package main

import (
	"testing"
	"time"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// The trips of «Альта» (W2.05) are written into a fresh tenant DB with the ids of PD-30, planned, twice without
// duplicates; Р-208 is the trip of Илья Васильев with its three stops, Р-211 waits for a driver.
func TestWriteFleetTripsTwice(t *testing.T) {
	t.Parallel()
	name := cluster.NewDatabase(t, "fleet_trips_seed")
	db := cluster.DB(t, name, migrations.RoleMigrator)
	if _, err := migrations.Up(t.Context(), db, migrations.Tenant); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 10, 18, 12, 40, 0, 0, msk)
	for pass := 1; pass <= 2; pass++ {
		tx, err := db.BeginTx(t.Context(), nil)
		if err != nil {
			t.Fatal(err)
		}
		for _, step := range []func() error{
			func() error { return writeUnits(t.Context(), tx, alta) },
			func() error { return writePeople(t.Context(), tx, alta) },
			func() error { return writeFleetTripsAt(t.Context(), tx, alta, now.Add(time.Duration(pass)*time.Hour)) },
		} {
			if err := step(); err != nil {
				_ = tx.Rollback()
				t.Fatalf("pass %d: %v", pass, err)
			}
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
	}
	r208 := seedID(protoAlta, "Р-208").String()
	for q, want := range map[string]int{
		`select count(*) from fleet.trips`:                         2,
		`select count(*) from fleet.trips where state = 'planned'`: 2,
		`select count(*) from fleet.trip_stops`:                    6,
		`select count(*) from fleet.trips where id = '` + r208 + `' and number = 'Р-208' and driver_person_id = '` +
			seedID(protoAlta, "m-vasiliev").String() + `' and distance_km = 46 and cargo_weight_kg = 1100`: 1,
		`select count(*) from fleet.trips where number = 'Р-211' and driver_person_id is null
		   and cargo_temp_min_c = 2 and cargo_temp_max_c = 6`: 1,
		// The first pass decides the windows: 12:40 + 1 h → Р-208 from 12:00 to 16:00 MSK.
		`select count(*) from fleet.trips where id = '` + r208 + `' and lower(planned) = '2026-10-18 12:00+03'
		   and upper(planned) = '2026-10-18 16:00+03'`: 1,
		`select count(*) from fleet.trip_stops where trip_id = '` + r208 + `' and seq = 2 and op = 'unload'
		   and lower(time_window) = '2026-10-18 13:15+03' and weight_kg = 700 and volume_m3 = 8`: 1,
	} {
		var got int
		if err := db.QueryRowContext(t.Context(), q).Scan(&got); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
		if got != want {
			t.Errorf("%s = %d, want %d", q, got, want)
		}
	}
}
