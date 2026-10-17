//go:build integration

package main

// Сквозной тест шага 2.4 (W2.04, S2-04, S2-05, S2-17, AC-04): браузер с cookie → BFF → шлюз (CSRF, право, модуль,
// Idempotency-Key) → модуль fleet/inspections → tenant DB «Альты». Чек-лист, осмотр выезда с блокирующим дефектом,
// очередь, решение с If-Match; повтор команды с тем же ключом не меняет состояние второй раз (S2-17 п. 6).

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
)

// fleetCall sends a request of the browser with an Idempotency-Key (commands) and an If-Match; it returns the status,
// the headers and the body.
func (b *browser) fleetCall(method, path, key, ifMatch string, body any) (int, http.Header, map[string]any) {
	b.t.Helper()
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	req, err := http.NewRequestWithContext(b.t.Context(), method, b.base+path, bytes.NewReader(raw))
	if err != nil {
		b.t.Fatal(err)
	}
	req.Header.Set("Origin", "http://127.0.0.1:5213")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", b.csrf)
	if key != "" {
		req.Header.Set("Idempotency-Key", key)
	}
	if ifMatch != "" {
		req.Header.Set("If-Match", ifMatch)
	}
	resp, err := b.http.Do(req)
	if err != nil {
		b.t.Fatal(err)
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	var m map[string]any
	_ = json.Unmarshal(out, &m)
	return resp.StatusCode, resp.Header, m
}

// seedFleetTrip switches logistics on in «Альта» and writes a vehicle, a trip of the owner in «Осмотр перед выездом»
// with a held reservation and five ready photos of the reservation; everything is removed after the test.
func seedFleetTrip(t *testing.T, db *sql.DB) (vehicle, reservation uuid.UUID, photos []uuid.UUID) {
	t.Helper()
	ctx := t.Context()
	trip, resource := uuid.New(), uuid.New()
	vehicle, reservation = uuid.New(), uuid.New()
	now := time.Now().UTC()
	stmts := []struct {
		sql  string
		args []any
	}{
		{`insert into modules.installations (module_key, state, manifest_version, updated_by)
		  select 'logistics', 'enabled', '0.2', id from people.person_profiles where email = 'd.zimina@alta.example'
		  on conflict (module_key) do nothing`, nil},
		{`insert into fleet.vehicles (id, unit_id, plate, body_type, payload_kg, volume_m3, cargo_length_mm, odometer_km, display_name)
		  select $1, home_unit_id, 'М 608 КТ 77', 'van', 1500, 12, 3200, 48210, 'Газель Next' from people.person_profiles
		   where email = 'd.zimina@alta.example'`, []any{vehicle}},
		{`insert into sched.resources (id, kind, ref_id, home_unit_id) select $1, 'vehicle', id, unit_id from fleet.vehicles where id = $2`,
			[]any{resource, vehicle}},
		{`insert into fleet.trips (id, number, unit_id, state, vehicle_id, driver_person_id, planned)
		  select $1, 'Р-W204', unit_id, 'inspection', id, (select id from people.person_profiles where email = 'd.zimina@alta.example'),
		         tstzrange($3::timestamptz, $3::timestamptz + interval '8 hours') from fleet.vehicles where id = $2`, []any{trip, vehicle, now}},
		{`insert into sched.reservations (id, resource_id, bundle_id, during, occupied, state, hold_expires_at, source_type, source_id, created_by)
		  values ($1, $2, gen_random_uuid(), tstzrange($3::timestamptz, $3::timestamptz + interval '8 hours'), tstzrange($3::timestamptz, $3::timestamptz + interval '8 hours'), 'hold',
		          $3::timestamptz + interval '30 minutes', 'fleet.trip', $4, $4)`, []any{reservation, resource, now, trip}},
	}
	for _, s := range stmts {
		if _, err := db.ExecContext(ctx, s.sql, s.args...); err != nil {
			t.Fatalf("%s: %v", s.sql, err)
		}
	}
	for range 5 {
		id := uuid.New()
		if _, err := db.ExecContext(ctx, `insert into files.objects (id, object_key, state, purpose, owner_type, owner_id, declared_mime,
		                                       bytes, uploaded_by, ready_at)
		    values ($1::uuid, 'files/'||$1::text, 'ready', 'inspection', 'fleet.reservation', $2, 'image/jpeg', 2048, $2, now())`,
			id, reservation); err != nil {
			t.Fatal(err)
		}
		photos = append(photos, id)
	}
	t.Cleanup(func() {
		ctx := context.WithoutCancel(t.Context())
		for _, q := range []string{
			`delete from notify.notifications where entity_id = $1`,
			`delete from fleet.defects where trip_id = $1`,
			`update fleet.trips set departure_inspection_id = null where id = $1`,
			`delete from fleet.inspection_photos where inspection_id in (select id from fleet.inspections where trip_id = $1)`,
			`delete from fleet.inspections where trip_id = $1`,
			`delete from sched.reservations where source_id = $1`,
			`delete from fleet.trips where id = $1`,
		} {
			if _, err := db.ExecContext(ctx, q, trip); err != nil {
				t.Errorf("%s: %v", q, err)
			}
		}
		for _, q := range []string{`delete from files.objects where owner_id = $1`} {
			if _, err := db.ExecContext(ctx, q, reservation); err != nil {
				t.Errorf("%s: %v", q, err)
			}
		}
		for _, q := range []string{`delete from sched.resources where ref_id = $1`, `delete from fleet.vehicles where id = $1`} {
			if _, err := db.ExecContext(ctx, q, vehicle); err != nil {
				t.Errorf("%s: %v", q, err)
			}
		}
		if _, err := db.ExecContext(ctx, `delete from modules.installations where module_key = 'logistics'`); err != nil {
			t.Errorf("logistics: %v", err)
		}
	})
	return vehicle, reservation, photos
}

func TestStackFleetInspections(t *testing.T) { //nolint:paralleltest // one seeded stack; switches logistics on in t_alta
	srv := server(t)
	db := super(t, "t_alta")
	vehicle, reservation, photos := seedFleetTrip(t, db)
	owner := newBrowser(t, srv).login("owner")
	base := "/api/v1/tenants/" + seedAlta.String() + "/fleet"
	inspection := submitBlocked(t, owner, db, base, vehicle, reservation, photos)
	decideOnce(t, owner, base, vehicle)
	status, h, read := owner.fleetCall(http.MethodGet, base+"/inspections/"+inspection, "", "", nil)
	if status != http.StatusOK || read["status"] != "approved" || h.Get("ETag") != `"2"` {
		t.Fatalf("getInspection: %d %v %v", status, h, read)
	}
	if status, _, other := owner.fleetCall(http.MethodGet, base+"/vehicles", "", "", nil); status != http.StatusNotImplemented {
		t.Fatalf("listVehicles before W2.02: %d %v", status, other)
	}
}

// submitBlocked reads the checklist and submits a departure with a blocking defect twice with one Idempotency-Key:
// the repeat replays the stored answer and writes nothing. It returns the id of the inspection.
func submitBlocked(t *testing.T, owner *browser, db *sql.DB, base string, vehicle, reservation uuid.UUID, photos []uuid.UUID) string {
	t.Helper()
	status, _, list := owner.fleetCall(http.MethodGet, base+"/inspection-checklist?vehicleId="+vehicle.String()+"&kind=departure", "", "", nil)
	if status != http.StatusOK {
		t.Fatalf("getInspectionChecklist: %d %v", status, list)
	}
	now := time.Now().UTC().Format(time.RFC3339)
	roles := []string{"front", "rear", "left", "right", "odometer"}
	shots := []map[string]any{}
	for i, id := range photos {
		shots = append(shots, map[string]any{"role": roles[i], "fileId": id, "capturedAt": now})
	}
	body := map[string]any{
		"checklistVersionId": list["versionId"], "vehicleId": vehicle, "reservationId": reservation, "kind": "departure",
		"odometerKm": "48250", "fuelPercent": 75, "capturedAt": now, "photos": shots,
		"checks":  []map[string]any{{"key": "body", "result": "pass"}, {"key": "tires", "result": "fail"}, {"key": "docs", "result": "pass"}},
		"defects": []map[string]any{{"zone": "Шины и колёса", "description": "Порез боковины", "severity": "blocking"}},
	}
	key := "w204-" + uuid.NewString()
	status, h, insp := owner.fleetCall(http.MethodPost, base+"/inspections", key, "", body)
	if status != http.StatusCreated || insp["status"] != "requires_review" || h.Get("ETag") != `"1"` || h.Get("Cache-Control") != "private, no-store" {
		t.Fatalf("submitInspection: %d %v %v", status, h, insp)
	}
	status, h, again := owner.fleetCall(http.MethodPost, base+"/inspections", key, "", body)
	if status != http.StatusCreated || again["id"] != insp["id"] || h.Get("Idempotency-Replayed") != "true" {
		t.Fatalf("replay of submitInspection: %d %v %v", status, h, again)
	}
	id, _ := insp["id"].(string)
	var n int
	if err := db.QueryRowContext(t.Context(), `select count(*) from fleet.inspections where trip_id =
	                                             (select trip_id from fleet.inspections where id = $1)`, id).Scan(&n); err != nil || n != 1 {
		t.Fatalf("inspections after the replay: %d %v", n, err)
	}
	return id
}

// decideOnce takes the defect from the queue and allows the departure; the repeat with the same key replays, a new
// decision is 409 invalid_transition (S2-17 п. 4, 6).
func decideOnce(t *testing.T, owner *browser, base string, vehicle uuid.UUID) {
	t.Helper()
	status, _, queue := owner.fleetCall(http.MethodGet, base+"/defects?state=in_review&vehicleId="+vehicle.String(), "", "", nil)
	items, _ := queue["items"].([]any)
	if status != http.StatusOK || len(items) != 1 {
		t.Fatalf("listInspectionDefects: %d %v", status, queue)
	}
	defect, _ := items[0].(map[string]any)
	id, _ := defect["id"].(string)
	if status, h, _ := owner.fleetCall(http.MethodGet, base+"/defects/"+id, "", "", nil); status != http.StatusOK || h.Get("ETag") != `"1"` {
		t.Fatalf("getInspectionDefect: %d %v", status, h)
	}
	key := "w204-" + uuid.NewString()
	decision := map[string]any{"decision": "allow_departure", "comment": "Доедет до шиномонтажа"}
	status, h, decided := owner.fleetCall(http.MethodPost, base+"/defects/"+id+"/decision", key, `"1"`, decision)
	if status != http.StatusOK || decided["state"] != "resolved" || h.Get("ETag") != `"2"` {
		t.Fatalf("decideInspectionDefect: %d %v %v", status, h, decided)
	}
	if status, h, _ := owner.fleetCall(http.MethodPost, base+"/defects/"+id+"/decision", key, `"1"`, decision); status != http.StatusOK ||
		h.Get("Idempotency-Replayed") != "true" {
		t.Fatalf("replay of the decision: %d %v", status, h)
	}
	status, _, conflict := owner.fleetCall(http.MethodPost, base+"/defects/"+id+"/decision", "w204-"+uuid.NewString(), `"2"`,
		map[string]any{"decision": "confirm_out_of_service"})
	if status != http.StatusConflict || conflict["code"] != "invalid_transition" {
		t.Fatalf("second decision: %d %v", status, conflict)
	}
}
