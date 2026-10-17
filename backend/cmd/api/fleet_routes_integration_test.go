//go:build integration

package main

// Путь логиста на стенде (W2.03 → W2.02): владелец «Альты» планирует рейс на сидового водителя Илью Васильева
// (createTripPlan, повтор с тем же Idempotency-Key — тот же рейс), назначает машину (assignTripVehicle с If-Match из
// getTripPlan), затем водитель бронирует машину на этот рейс (reserveVehicle с tripId W2.02) — бронь водителя заменяет
// hold логиста, рейс переходит к осмотру.

import (
	"context"
	"database/sql"
	"maps"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
)

// planTrip is the vehicle and the driver of the trip the test plans; the logistics module is switched on for the test.
// Everything is removed after it.
type planTrip struct {
	vehicle, driver, unit uuid.UUID
	trip                  string
}

func seedPlanTrip(t *testing.T, db *sql.DB) *planTrip {
	t.Helper()
	ctx := t.Context()
	f := &planTrip{vehicle: uuid.New()}
	res, err := db.ExecContext(ctx, `insert into modules.installations (module_key, state, manifest_version, updated_by)
		select 'logistics', 'enabled', '0.2', id from people.person_profiles where email = 'd.zimina@alta.example'
		on conflict (module_key) do nothing`)
	if err != nil {
		t.Fatal(err)
	}
	installed, err := res.RowsAffected() // 0: switched on before the test, left as it was
	if err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, `select id, home_unit_id from people.person_profiles where email = 'i.vasiliev@alta.example'`).
		Scan(&f.driver, &f.unit); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `insert into fleet.vehicles (id, unit_id, plate, body_type, payload_kg, volume_m3,
		cargo_length_mm, odometer_km, display_name) values ($1, $2, 'Т 903 ПЛ 77', 'van', 1500, 16, 4200, 48210, 'Газель Next')`,
		f.vehicle, f.unit); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx := context.WithoutCancel(t.Context())
		for _, q := range []string{
			`delete from sched.reservations where source_id::text = $1`,
			`delete from fleet.trip_stops where trip_id::text = $1`,
			`delete from fleet.trips where id::text = $1`,
		} {
			if f.trip == "" {
				break
			}
			if _, err := db.ExecContext(ctx, q, f.trip); err != nil {
				t.Errorf("%s: %v", q, err)
			}
		}
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

func TestStackPlanAssignReserve(t *testing.T) { //nolint:paralleltest // one seeded stack; switches logistics on in t_alta
	srv := server(t)
	db := super(t, "t_alta")
	f := seedPlanTrip(t, db)
	owner := newBrowser(t, srv).login("owner")
	base := "/api/v1/tenants/" + seedAlta.String() + "/fleet"
	planOnStack(t, owner, base, f)
	assignOnStack(t, owner, db, base, f)
	listedOnStack(t, owner, base, f)
	reserveAfterAssign(t, owner, db, base, f)
}

// planOnStack plans the trip of Илья Васильев for the next hours; the repeat with the same Idempotency-Key replays the
// stored trip and plans nothing more.
func planOnStack(t *testing.T, owner *browser, base string, f *planTrip) {
	t.Helper()
	now := time.Now().UTC()
	key := "w203-" + uuid.NewString()
	body := map[string]any{
		"orgUnitId": f.unit, "title": "Склад Север → ТЦ Восток", "driverMemberId": f.driver,
		"plannedWindow": map[string]any{
			"startsAt": now.Add(-10 * time.Minute).Format(time.RFC3339), "endsAt": now.Add(8 * time.Hour).Format(time.RFC3339),
			"timeZone": "Europe/Moscow",
		},
		"cargo": map[string]any{"description": "Сухой груз · 14 паллет-мест", "weightKg": "1100", "volumeM3": "12", "lengthM": "3"},
		"stops": []map[string]any{
			{"sequence": 1, "op": "load", "address": "Склад Север", "weightKg": "1100", "volumeM3": "12"},
			{"sequence": 2, "op": "unload", "address": "ТЦ Восток", "weightKg": "1100", "volumeM3": "12"},
		},
	}
	status, h, trip := owner.fleetCall(http.MethodPost, base+"/trip-plans", key, "", body)
	f.trip, _ = trip["id"].(string)
	if status != http.StatusCreated || f.trip == "" || trip["state"] != "planned" || h.Get("Idempotency-Replayed") != "false" {
		t.Fatalf("createTripPlan: %d %v %v", status, h, trip)
	}
	status, h, again := owner.fleetCall(http.MethodPost, base+"/trip-plans", key, "", body)
	if status != http.StatusCreated || again["id"] != f.trip || again["number"] != trip["number"] ||
		h.Get("Idempotency-Replayed") != "true" {
		t.Fatalf("replay of createTripPlan: %d %v %v", status, h, again)
	}
	bad := maps.Clone(body)
	bad["stops"] = []map[string]any{
		{"sequence": 1, "op": "load", "address": "Склад Север", "weightKg": "100", "volumeM3": "1"},
		{"sequence": 2, "op": "unload", "address": "ТЦ Восток", "weightKg": "200", "volumeM3": "1"},
	}
	status, _, refusal := owner.fleetCall(http.MethodPost, base+"/trip-plans", "w203-"+uuid.NewString(), "", bad)
	if status != http.StatusUnprocessableEntity ||
		refusal["detail"] != "Точка 2: выгрузка больше, чем в кузове после предыдущей точки (масса)." {
		t.Fatalf("createTripPlan with an overloaded unload: %d %v", status, refusal)
	}
}

// assignOnStack assigns the vehicle with the ETag of getTripPlan: 200, assigned, the vehicle and the driver are held
// for the window of the trip; a stale If-Match is 412.
func assignOnStack(t *testing.T, owner *browser, db *sql.DB, base string, f *planTrip) {
	t.Helper()
	status, h, got := owner.fleetCall(http.MethodGet, base+"/trip-plans/"+f.trip, "", "", nil)
	if status != http.StatusOK || h.Get("ETag") != `"1"` {
		t.Fatalf("getTripPlan: %d %v %v", status, h, got)
	}
	body := map[string]any{"vehicleId": f.vehicle}
	status, h, out := owner.fleetCall(http.MethodPut, base+"/trips/"+f.trip+"/vehicle", "w203-"+uuid.NewString(), h.Get("ETag"), body)
	if status != http.StatusOK || out["state"] != "assigned" || out["vehicleId"] != f.vehicle.String() || h.Get("ETag") != `"2"` {
		t.Fatalf("assignTripVehicle: %d %v %v", status, h, out)
	}
	if status, _, out := owner.fleetCall(http.MethodPut, base+"/trips/"+f.trip+"/vehicle", "w203-"+uuid.NewString(), `"1"`, body); status != http.StatusPreconditionFailed {
		t.Fatalf("assignTripVehicle with a stale If-Match: %d %v", status, out)
	}
	var rows int
	if err := db.QueryRowContext(t.Context(), `select count(*) from sched.reservations where source_id::text = $1 and state = 'hold'`,
		f.trip).Scan(&rows); err != nil || rows != 2 {
		t.Fatalf("holds of the assigned trip: %d %v, want the vehicle and the driver", rows, err)
	}
}

// listedOnStack finds the assigned trip in listTripPlans filtered by its state.
func listedOnStack(t *testing.T, owner *browser, base string, f *planTrip) {
	t.Helper()
	status, _, page := owner.fleetCall(http.MethodGet, base+"/trip-plans?state=assigned", "", "", nil)
	items, _ := page["items"].([]any)
	found := false
	for _, it := range items {
		if m, ok := it.(map[string]any); ok && m["id"] == f.trip {
			found = true
		}
	}
	if status != http.StatusOK || !found {
		t.Fatalf("listTripPlans?state=assigned: %d, trip %s found %v: %v", status, f.trip, found, page)
	}
}

// reserveAfterAssign reserves the assigned vehicle for the trip as the driver path does (reserveVehicle with tripId,
// W2.02): the reservation takes the place of the hold of the logist and the trip goes to the inspection.
func reserveAfterAssign(t *testing.T, owner *browser, db *sql.DB, base string, f *planTrip) {
	t.Helper()
	now := time.Now().UTC()
	status, h, res := owner.fleetCall(http.MethodPost, base+"/reservations", "w203-"+uuid.NewString(), "", map[string]any{
		"vehicleId": f.vehicle, "driverMemberId": f.driver, "tripId": f.trip,
		"window": map[string]any{
			"startsAt": now.Add(5 * time.Minute).Format(time.RFC3339), "endsAt": now.Add(6 * time.Hour).Format(time.RFC3339),
			"timeZone": "Europe/Moscow",
		},
	})
	if status != http.StatusCreated {
		t.Fatalf("reserveVehicle for the assigned trip: %d %v %v", status, h, res)
	}
	var state string
	var live int
	if err := db.QueryRowContext(t.Context(), `select t.state, (select count(*) from sched.reservations r
		where r.source_id = t.id and r.state = 'hold') from fleet.trips t where t.id::text = $1`, f.trip).Scan(&state, &live); err != nil ||
		state != "inspection" || live != 2 {
		t.Fatalf("trip after the reservation: %s, %d live rows (%v), want inspection with the vehicle and the driver", state, live, err)
	}
	status, _, got := owner.fleetCall(http.MethodGet, base+"/trip-plans/"+f.trip, "", "", nil)
	if status != http.StatusOK || got["reservationId"] != res["id"] || got["state"] != "inspection" {
		t.Fatalf("getTripPlan after the reservation: %d %v, want reservation %v", status, got, res["id"])
	}
}
