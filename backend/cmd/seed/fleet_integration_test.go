//go:build integration

package main

import (
	"database/sql"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// The vehicles of «Альта» (W2.02) are written into a fresh tenant DB with the ids of PD-30 (as the MSW adapter: seedUuid
// of t-alta), twice without duplicates; «ГАЗон Next» is in maintenance «Плановое ТО до 03.10».
func TestWriteFleetTwice(t *testing.T) {
	t.Parallel()
	name := cluster.NewDatabase(t, "fleet_seed")
	db := cluster.DB(t, name, migrations.RoleMigrator)
	if _, err := migrations.Up(t.Context(), db, migrations.Tenant); err != nil {
		t.Fatal(err)
	}
	for pass := 1; pass <= 2; pass++ {
		seedFleetOnce(t, db, pass)
	}
	for q, want := range map[string]int{
		`select count(*) from fleet.vehicles`: 7,
		`select count(*) from fleet.vehicles where service_state = 'maintenance' and service_note = 'Плановое ТО до 03.10'
		   and id = '` + seedID(protoAlta, "v4").String() + `'`: 1,
		`select count(*) from fleet.vehicles where body_type = 'reefer' and temp_min_c = -18 and temp_max_c = 8`: 1,
		`select count(*) from fleet.vehicles where unit_id = '` + alta.unitID(homeAlta).String() + `'`:           5,
		`select count(*) from fleet.vehicles where cargo_width_mm = 2000 and cargo_height_mm = 2000`:             7,
	} {
		var got int
		if err := db.QueryRowContext(t.Context(), q).Scan(&got); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
		if got != want {
			t.Errorf("%s = %d, want %d", q, got, want)
		}
	}
	checkFleetOrder(t, db)
}

func seedFleetOnce(t *testing.T, db *sql.DB, pass int) {
	t.Helper()
	tx, err := db.BeginTx(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := writeUnits(t.Context(), tx, alta); err != nil {
		t.Fatal(err)
	}
	if err := writeFleet(t.Context(), tx, alta); err != nil {
		t.Fatalf("pass %d: %v", pass, err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

// checkFleetOrder: the order of registration is the order of the prototype (listVehicles pages by created_at, id).
func checkFleetOrder(t *testing.T, db *sql.DB) {
	t.Helper()
	rows, err := db.QueryContext(t.Context(), `select id from fleet.vehicles order by created_at, id`)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rows.Close() }()
	i := 0
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		if want := seedID(protoAlta, fleetSeeds[protoAlta][i].proto).String(); id != want {
			t.Errorf("vehicle %d: %s, want %s (%s)", i, id, want, fleetSeeds[protoAlta][i].proto)
		}
		i++
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
}
