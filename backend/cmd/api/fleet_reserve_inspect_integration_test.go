//go:build integration

package main

// Путь водителя на стенде (W2.02 → W2.04, ревью W2.02 раунд 2): бронь машины на рейс через reserveVehicle, пять фото
// осмотра у брони и submitInspection(departure) по reservation.id из ответа брони — 201. id брони API — это bundle_id
// комплекта sched.reservations; строка машины комплекта носит тот же id, поэтому бронь находят и осмотр W2.04, и
// родитель файла fleet.reservation (W1.09).

import (
	"context"
	"database/sql"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/files"
)

// reserveTrip is a trip of «Альта» planned for the seeded driver Илья Васильев with a vehicle of his firm; the
// logistics module is switched on for the test. Everything is removed after it.
type reserveTrip struct {
	trip, vehicle, driver uuid.UUID
}

func seedReserveTrip(t *testing.T, db *sql.DB) reserveTrip {
	t.Helper()
	ctx := t.Context()
	f := reserveTrip{trip: uuid.New(), vehicle: uuid.New()}
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
	var unit uuid.UUID
	if err := db.QueryRowContext(ctx, `select id, home_unit_id from people.person_profiles where email = 'i.vasiliev@alta.example'`).
		Scan(&f.driver, &unit); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	for _, s := range []struct {
		sql  string
		args []any
	}{
		{`insert into fleet.vehicles (id, unit_id, plate, body_type, payload_kg, volume_m3, cargo_length_mm, odometer_km, display_name)
		  values ($1, $2, 'М 202 КТ 77', 'van', 1500, 12, 3200, 48210, 'Газель Next')`, []any{f.vehicle, unit}},
		{`insert into fleet.trips (id, number, unit_id, state, driver_person_id, planned)
		  values ($1, 'Р-W202', $2, 'planned', $3, tstzrange($4::timestamptz - interval '10 minutes', $4::timestamptz + interval '8 hours'))`,
			[]any{f.trip, unit, f.driver, now}},
	} {
		if _, err := db.ExecContext(ctx, s.sql, s.args...); err != nil {
			t.Fatalf("%s: %v", s.sql, err)
		}
	}
	t.Cleanup(func() {
		ctx := context.WithoutCancel(t.Context())
		for _, q := range []struct {
			sql string
			id  uuid.UUID
		}{
			{`update fleet.trips set departure_inspection_id = null where id = $1`, f.trip},
			{`delete from fleet.inspection_photos where inspection_id in (select id from fleet.inspections where trip_id = $1)`, f.trip},
			{`delete from fleet.defects where trip_id = $1`, f.trip},
			{`delete from fleet.inspections where trip_id = $1`, f.trip},
			{`delete from files.objects where owner_type = 'fleet.reservation' and owner_id in
			    (select bundle_id from sched.reservations where source_id = $1)`, f.trip},
			{`delete from sched.reservations where source_id = $1`, f.trip},
			{`delete from fleet.trips where id = $1`, f.trip},
			{`delete from sched.resources where ref_id = $1`, f.vehicle},
			{`delete from fleet.vehicles where id = $1`, f.vehicle},
		} {
			if _, err := db.ExecContext(ctx, q.sql, q.id); err != nil {
				t.Errorf("%s: %v", q.sql, err)
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

// reservationParentRows counts the rows the parent fleet.reservation of the files (W1.09) finds for id.
func reservationParentRows(t *testing.T, db *sql.DB, id string) int {
	t.Helper()
	for _, p := range files.FleetParents() {
		if p.Entity != "reservation" {
			continue
		}
		var n int
		q := `select count(*) from (` + strings.ReplaceAll(p.Rows, files.IDPlaceholder, "$1") + `) x`
		if err := db.QueryRowContext(t.Context(), q, id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	t.Fatal("no parent fleet.reservation")
	return 0
}

func TestStackReserveThenInspect(t *testing.T) { //nolint:paralleltest // one seeded stack; switches logistics on in t_alta
	srv := server(t)
	db := super(t, "t_alta")
	f := seedReserveTrip(t, db)
	owner := newBrowser(t, srv).login("owner")
	base := "/api/v1/tenants/" + seedAlta.String() + "/fleet"
	reservation := reserveForTrip(t, owner, db, base, f)
	if n := reservationParentRows(t, db, reservation); n != 1 {
		t.Fatalf("parent fleet.reservation %s of the files: %d rows, want 1", reservation, n)
	}
	inspectDeparture(t, owner, db, base, reservation, f)
	releaseAfterInspection(t, owner, db, base, reservation, f.trip)
}

// reserveForTrip reserves the vehicle of f for its trip and returns the id of the reservation; the repeat with the
// same Idempotency-Key replays the stored answer (platform/idem) and holds nothing more.
func reserveForTrip(t *testing.T, owner *browser, db *sql.DB, base string, f reserveTrip) string {
	t.Helper()
	now := time.Now().UTC()
	key := "w202-" + uuid.NewString()
	reserve := map[string]any{
		"vehicleId": f.vehicle, "driverMemberId": f.driver, "tripId": f.trip,
		"window": map[string]any{
			"startsAt": now.Add(5 * time.Minute).Format(time.RFC3339), "endsAt": now.Add(6 * time.Hour).Format(time.RFC3339),
			"timeZone": "Europe/Moscow",
		},
	}
	status, h, res := owner.fleetCall(http.MethodPost, base+"/reservations", key, "", reserve)
	reservation, _ := res["id"].(string)
	if status != http.StatusCreated || reservation == "" || h.Get("Idempotency-Replayed") != "false" {
		t.Fatalf("reserveVehicle: %d %v %v", status, h, res)
	}
	status, h, again := owner.fleetCall(http.MethodPost, base+"/reservations", key, "", reserve)
	if status != http.StatusCreated || again["id"] != reservation || h.Get("Idempotency-Replayed") != "true" {
		t.Fatalf("replay of reserveVehicle: %d %v %v", status, h, again)
	}
	var rows int
	if err := db.QueryRowContext(t.Context(), `select count(*) from sched.reservations where source_id = $1`, f.trip).Scan(&rows); err != nil ||
		rows != 2 {
		t.Fatalf("rows of the trip after the replay: %d %v, want the vehicle and the driver", rows, err)
	}
	return reservation
}

// inspectDeparture puts five ready photos on the reservation and submits the departure inspection by its id: 201,
// and the trip points at the inspection.
func inspectDeparture(t *testing.T, owner *browser, db *sql.DB, base, reservation string, f reserveTrip) {
	t.Helper()
	photos := make([]uuid.UUID, 0, 5)
	for range 5 {
		id := uuid.New()
		if _, err := db.ExecContext(t.Context(), `insert into files.objects (id, object_key, state, purpose, owner_type, owner_id,
		       declared_mime, bytes, uploaded_by, ready_at)
		    values ($1::uuid, 'files/'||$1::text, 'ready', 'inspection', 'fleet.reservation', $2, 'image/jpeg', 2048, $3, now())`,
			id, reservation, f.driver); err != nil {
			t.Fatal(err)
		}
		photos = append(photos, id)
	}

	status, _, list := owner.fleetCall(http.MethodGet, base+"/inspection-checklist?vehicleId="+f.vehicle.String()+"&kind=departure", "", "", nil)
	if status != http.StatusOK {
		t.Fatalf("getInspectionChecklist: %d %v", status, list)
	}
	at := time.Now().UTC().Format(time.RFC3339)
	shots := []map[string]any{}
	for i, role := range []string{"front", "rear", "left", "right", "odometer"} {
		shots = append(shots, map[string]any{"role": role, "fileId": photos[i], "capturedAt": at})
	}
	status, _, insp := owner.fleetCall(http.MethodPost, base+"/inspections", "w202-"+uuid.NewString(), "", map[string]any{
		"checklistVersionId": list["versionId"], "vehicleId": f.vehicle, "reservationId": reservation, "kind": "departure",
		"odometerKm": "48250", "fuelPercent": 75, "capturedAt": at, "photos": shots,
		"checks": []map[string]any{{"key": "body", "result": "pass"}, {"key": "tires", "result": "pass"}, {"key": "docs", "result": "pass"}},
	})
	if status != http.StatusCreated {
		t.Fatalf("submitInspection(departure) by reservation.id %s: %d %v", reservation, status, insp)
	}
	var departure string
	if err := db.QueryRowContext(t.Context(), `select coalesce(departure_inspection_id::text, '') from fleet.trips where id = $1`, f.trip).
		Scan(&departure); err != nil || departure != insp["id"] {
		t.Fatalf("trip departure inspection %q (%v), want %v", departure, err, insp["id"])
	}
}

// releaseAfterInspection releases the reservation of the inspected trip: the trip goes back to planning without its
// departure inspection (the next departure is inspected again), and the repeat with the same key replays.
func releaseAfterInspection(t *testing.T, owner *browser, db *sql.DB, base, reservation string, trip uuid.UUID) {
	t.Helper()
	key, body := "w202-"+uuid.NewString(), map[string]any{"action": "release", "reason": "Водитель заболел"}
	status, h, out := owner.fleetCall(http.MethodPatch, base+"/reservations/"+reservation, key, `"1"`, body)
	if status != http.StatusOK || out["state"] != "released" || h.Get("ETag") != `"2"` {
		t.Fatalf("releaseReservation: %d %v %v", status, h, out)
	}
	if status, h, _ := owner.fleetCall(http.MethodPatch, base+"/reservations/"+reservation, key, `"1"`, body); status != http.StatusOK ||
		h.Get("Idempotency-Replayed") != "true" {
		t.Fatalf("replay of releaseReservation: %d %v", status, h)
	}
	var state string
	var inspected bool
	if err := db.QueryRowContext(t.Context(), `select state, departure_inspection_id is not null from fleet.trips where id = $1`, trip).
		Scan(&state, &inspected); err != nil || state != "planned" || inspected {
		t.Fatalf("trip after the release: %s, inspected %v (%v), want planned without the inspection", state, inspected, err)
	}
}
