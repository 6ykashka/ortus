//go:build integration

package main

// Перемещение машины на стенде (W2.42, модель данных 2): владелец «Альты» переводит машину «Север Логистик» в
// «Юг Транс» через шлюз, BFF и idempotency cmd/api. Без If-Match — 428 до хендлера; повтор с тем же Idempotency-Key
// отдаёт сохранённый ответ и второй период не открывает; история — два периода, новый первым.

import (
	"context"
	"database/sql"
	"net/http"
	"testing"

	"github.com/google/uuid"
)

// moveFixture is a vehicle of «Север Логистик» (the home of the seeded driver Илья Васильев) and the company «Юг
// Транс» it moves to; the logistics module is switched on for the test. Everything is removed after it.
type moveFixture struct {
	vehicle, home, target uuid.UUID
}

func seedMoveVehicle(t *testing.T, db *sql.DB) moveFixture {
	t.Helper()
	ctx := t.Context()
	f := moveFixture{vehicle: uuid.New()}
	res, err := db.ExecContext(ctx, `insert into modules.installations (module_key, state, manifest_version, updated_by)
		select 'logistics', 'enabled', '0.2', id from people.person_profiles where email = 'd.zimina@alta.example'
		on conflict (module_key) do nothing`)
	if err != nil {
		t.Fatal(err)
	}
	installed, err := res.RowsAffected()
	if err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, `select (select home_unit_id from people.person_profiles where email = 'i.vasiliev@alta.example'),
		(select id from org.units where name = 'Юг Транс')`).Scan(&f.home, &f.target); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `insert into fleet.vehicles (id, unit_id, plate, body_type, payload_kg, volume_m3, cargo_length_mm,
		odometer_km, display_name) values ($1, $2, 'П 242 ЕХ 77', 'van', 1500, 12, 3200, 30100, 'Газель Next')`, f.vehicle, f.home); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx := context.WithoutCancel(t.Context())
		for _, q := range []string{`delete from sched.resources where ref_id = $1`, `delete from fleet.vehicles where id = $1`} {
			if _, err := db.ExecContext(ctx, q, f.vehicle); err != nil {
				t.Errorf("%s: %v", q, err)
			}
		}
		if installed > 0 {
			if _, err := db.ExecContext(ctx, `delete from modules.installations where module_key = 'logistics'`); err != nil {
				t.Errorf("logistics: %v", err)
			}
		}
	})
	return f
}

func TestStackMoveVehicle(t *testing.T) { //nolint:paralleltest // one seeded stack; switches logistics on in t_alta
	srv := server(t)
	db := super(t, "t_alta")
	f := seedMoveVehicle(t, db)
	owner := newBrowser(t, srv).login("owner")
	path := "/api/v1/tenants/" + seedAlta.String() + "/fleet/vehicles/" + f.vehicle.String() + "/assignments"
	body := map[string]any{"orgUnitId": f.target, "reason": "Передана в «Юг Транс»"}

	if status, _, out := owner.fleetCall(http.MethodPost, path, "w242-"+uuid.NewString(), "", body); status != http.StatusPreconditionRequired {
		t.Fatalf("moveVehicle without If-Match: %d %v, want 428", status, out)
	}
	moveAndReplay(t, owner, db, path, body, f)
	historyOnStack(t, owner, path, f)
}

// moveAndReplay moves the vehicle and repeats the command with the same Idempotency-Key: the stored answer, one move.
func moveAndReplay(t *testing.T, owner *browser, db *sql.DB, path string, body map[string]any, f moveFixture) {
	t.Helper()
	key := "w242-" + uuid.NewString()
	status, h, moved := owner.fleetCall(http.MethodPost, path, key, `"1"`, body)
	if status != http.StatusOK || moved["orgUnitId"] != f.target.String() || moved["orgUnitSince"] == nil ||
		h.Get("ETag") != `"2"` || h.Get("Idempotency-Replayed") != "false" || h.Get("Cache-Control") != "private, no-store" {
		t.Fatalf("moveVehicle: %d %v %v", status, h, moved)
	}
	status, h, again := owner.fleetCall(http.MethodPost, path, key, `"1"`, body)
	if status != http.StatusOK || h.Get("Idempotency-Replayed") != "true" || again["revision"] != moved["revision"] ||
		again["orgUnitSince"] != moved["orgUnitSince"] {
		t.Fatalf("replay of moveVehicle: %d %v %v, want the stored answer", status, h, again)
	}
	var periods int
	if err := db.QueryRowContext(t.Context(), `select count(*) from fleet.vehicle_assignments where vehicle_id = $1`, f.vehicle).
		Scan(&periods); err != nil || periods != 2 {
		t.Fatalf("periods after the move and its replay: %d %v, want 2", periods, err)
	}
}

// historyOnStack reads the two periods, the new one first, with the name of the company and the reason.
func historyOnStack(t *testing.T, owner *browser, path string, f moveFixture) {
	t.Helper()
	status, _, page := owner.fleetCall(http.MethodGet, path, "", "", nil)
	items, _ := page["items"].([]any)
	if status != http.StatusOK || len(items) != 2 || page["nextCursor"] != nil {
		t.Fatalf("listVehicleAssignments: %d %v", status, page)
	}
	first, _ := items[0].(map[string]any)
	second, _ := items[1].(map[string]any)
	if first["orgUnitId"] != f.target.String() || first["orgUnitName"] != "Юг Транс" || first["validTo"] != nil ||
		first["reason"] != "Передана в «Юг Транс»" || second["orgUnitId"] != f.home.String() || second["validTo"] != first["validFrom"] {
		t.Fatalf("history: %v", items)
	}
}
