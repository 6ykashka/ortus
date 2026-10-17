//go:build integration

package main

// Смена водителя на стенде целиком (W2.05, путь показа 18.10): водитель Илья Васильев бронирует машину на рейс
// (W2.02), отправляет осмотр выезда с пятью фото (W2.04), выезжает (startTrip потребляет бронь), записывает расход
// («прочее» без комментария — 422), завершает рейс, сдаёт машину с осмотром при сдаче (W2.04) и returnTrip — смена
// ждёт приёмки менеджером (W2.06). Всё — через шлюз, BFF и idempotency cmd/api.

import (
	"context"
	"database/sql"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
)

// cleanShift removes what the shift of trip f wrote, children first.
func cleanShift(t *testing.T, db *sql.DB, f reserveTrip) {
	t.Helper()
	t.Cleanup(func() {
		ctx := context.WithoutCancel(t.Context())
		for _, q := range []string{
			`delete from fleet.expenses where trip_id = $1`,
			`update fleet.trips set departure_inspection_id = null, return_inspection_id = null where id = $1`,
			`delete from fleet.inspection_photos where inspection_id in (select id from fleet.inspections where trip_id = $1)`,
			`delete from files.objects where owner_type = 'fleet.trip' and owner_id = $1`,
		} {
			if _, err := db.ExecContext(ctx, q, f.trip); err != nil {
				t.Errorf("%s: %v", q, err)
			}
		}
	})
}

// shiftFile writes a ready file of the trip with purpose (inspection or expense_receipt).
func shiftFile(t *testing.T, db *sql.DB, f reserveTrip, purpose string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := db.ExecContext(t.Context(), `insert into files.objects (id, object_key, state, purpose, owner_type, owner_id,
	       declared_mime, bytes, uploaded_by, ready_at)
	    values ($1::uuid, 'files/'||$1::text, 'ready', $2, 'fleet.trip', $3, 'image/jpeg', 2048, $4, now())`,
		id, purpose, f.trip, f.driver); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestStackDriverShift(t *testing.T) { //nolint:paralleltest // one seeded stack; switches logistics on in t_alta
	srv := server(t)
	db := super(t, "t_alta")
	f := seedReserveTrip(t, db)
	cleanShift(t, db, f) // registered after seedReserveTrip: runs before its cleanup
	driver := newBrowser(t, srv).login("driver")
	base := "/api/v1/tenants/" + seedAlta.String() + "/fleet"
	reservation := reserveForTrip(t, driver, db, base, f)
	inspectDeparture(t, driver, db, base, reservation, f)
	trip := base + "/trips/" + f.trip.String()
	startShift(t, driver, db, base, reservation, f)
	recordExpenses(t, driver, db, trip, f)
	tag := planTag(t, driver, base, f, "on_route")
	status, h, plan := driver.fleetCall(http.MethodPost, trip+"/route-completion", "w205-"+uuid.NewString(), tag, nil)
	if status != http.StatusOK || plan["state"] != "returning" || h.Get("ETag") == tag {
		t.Fatalf("finishTripRoute: %d %v %v", status, h, plan)
	}
	returnShift(t, driver, db, base, f)
}

// startShift starts the trip by the reservation and its departure inspection: 201 in_progress, the repeat with the
// same key replays; a second start with a new key is 409.
func startShift(t *testing.T, driver *browser, db *sql.DB, base, reservation string, f reserveTrip) {
	t.Helper()
	var departure string
	if err := db.QueryRowContext(t.Context(), `select departure_inspection_id::text from fleet.trips where id = $1`, f.trip).
		Scan(&departure); err != nil {
		t.Fatal(err)
	}
	body := map[string]any{"reservationId": reservation, "departureInspectionId": departure}
	key := "w205-" + uuid.NewString()
	status, h, got := driver.fleetCall(http.MethodPost, base+"/trips", key, "", body)
	if status != http.StatusCreated || got["status"] != "in_progress" || got["id"] != f.trip.String() || h.Get("Idempotency-Replayed") != "false" {
		t.Fatalf("startTrip: %d %v %v", status, h, got)
	}
	if status, h, again := driver.fleetCall(http.MethodPost, base+"/trips", key, "", body); status != http.StatusCreated ||
		h.Get("Idempotency-Replayed") != "true" || again["id"] != got["id"] {
		t.Fatalf("replay of startTrip: %d %v %v", status, h, again)
	}
	if status, _, p := driver.fleetCall(http.MethodPost, base+"/trips", "w205-"+uuid.NewString(), "", body); status != http.StatusConflict ||
		p["code"] != "invalid_transition" {
		t.Fatalf("second start: %d %v", status, p)
	}
	var consumed int
	if err := db.QueryRowContext(t.Context(), `select count(*) from sched.reservations where bundle_id = $1 and state = 'consumed'`,
		reservation).Scan(&consumed); err != nil || consumed != 2 {
		t.Fatalf("consumed rows of the reservation: %d %v, want the vehicle and the driver", consumed, err)
	}
}

// recordExpenses: «прочее» without a comment is 422 (W2.40), a wash with its receipt is 201 and is listed.
func recordExpenses(t *testing.T, driver *browser, db *sql.DB, trip string, f reserveTrip) {
	t.Helper()
	at := time.Now().UTC().Format(time.RFC3339)
	other := map[string]any{"kind": "other", "occurredAt": at, "amount": map[string]any{"amountMinor": 30000, "currency": "RUB"},
		"receiptFileIds": []uuid.UUID{shiftFile(t, db, f, "expense_receipt")}}
	if status, _, p := driver.fleetCall(http.MethodPost, trip+"/expenses", "w205-"+uuid.NewString(), "", other); status != http.StatusUnprocessableEntity ||
		p["code"] != "validation_failed" || p["detail"] != "Для категории «Прочее» добавьте комментарий" {
		t.Fatalf("other without a comment: %d %v", status, p)
	}
	other["comment"] = "Замена лампы фары"
	status, _, x := driver.fleetCall(http.MethodPost, trip+"/expenses", "w205-"+uuid.NewString(), "", other)
	if status != http.StatusCreated || x["reviewState"] != "pending" || x["kind"] != "other" {
		t.Fatalf("createTripExpense: %d %v", status, x)
	}
	status, _, page := driver.fleetCall(http.MethodGet, trip+"/expenses", "", "", nil)
	if items := asSlice(page["items"]); status != http.StatusOK || len(items) != 1 {
		t.Fatalf("listTripExpenses: %d %v", status, page)
	}
}

// planTag reads the trip card of the driver and returns its ETag; the trip is in state.
func planTag(t *testing.T, driver *browser, base string, f reserveTrip, state string) string {
	t.Helper()
	status, h, plan := driver.fleetCall(http.MethodGet, base+"/trip-plans/"+f.trip.String(), "", "", nil)
	if status != http.StatusOK || plan["state"] != state || h.Get("ETag") == "" {
		t.Fatalf("getTripPlan: %d %v %v, want %s", status, h, plan, state)
	}
	status, _, list := driver.fleetCall(http.MethodGet, base+"/trip-plans", "", "", nil)
	found := false
	for _, it := range asSlice(list["items"]) {
		if m, _ := it.(map[string]any); m["id"] == f.trip.String() {
			found = true
		}
	}
	if status != http.StatusOK || !found {
		t.Fatalf("listTripPlans of the driver: %d %v", status, list)
	}
	return h.Get("ETag")
}

// returnShift submits the return inspection with five photos of the trip and returns the vehicle: the shift waits for
// the acceptance (submitted), the 0.1 Trip says returned_pending_review.
func returnShift(t *testing.T, driver *browser, db *sql.DB, base string, f reserveTrip) {
	t.Helper()
	status, _, list := driver.fleetCall(http.MethodGet, base+"/inspection-checklist?vehicleId="+f.vehicle.String()+"&kind=return", "", "", nil)
	if status != http.StatusOK {
		t.Fatalf("getInspectionChecklist(return): %d %v", status, list)
	}
	at := time.Now().UTC().Format(time.RFC3339)
	shots := []map[string]any{}
	for _, role := range []string{"front", "rear", "left", "right", "odometer"} {
		shots = append(shots, map[string]any{"role": role, "fileId": shiftFile(t, db, f, "inspection"), "capturedAt": at})
	}
	status, _, insp := driver.fleetCall(http.MethodPost, base+"/inspections", "w205-"+uuid.NewString(), "", map[string]any{
		"checklistVersionId": list["versionId"], "vehicleId": f.vehicle, "tripId": f.trip, "kind": "return",
		"odometerKm": "48296", "fuelPercent": 50, "capturedAt": at, "photos": shots,
		"checks": []map[string]any{{"key": "cargo", "result": "pass"}, {"key": "personal", "result": "pass"}, {"key": "keys", "result": "pass"}},
	})
	if status != http.StatusCreated {
		t.Fatalf("submitInspection(return): %d %v", status, insp)
	}
	trip := base + "/trips/" + f.trip.String()
	tag := planTag(t, driver, base, f, "returning")
	body := map[string]any{"action": "return", "returnInspectionId": insp["id"]}
	status, h, got := driver.fleetCall(http.MethodPatch, trip, "w205-"+uuid.NewString(), tag, body)
	if status != http.StatusOK || got["status"] != "returned_pending_review" || got["returnInspectionId"] != insp["id"] {
		t.Fatalf("returnTrip: %d %v %v", status, h, got)
	}
	if status, _, g := driver.fleetCall(http.MethodGet, trip, "", "", nil); status != http.StatusOK || g["status"] != "returned_pending_review" {
		t.Fatalf("getTrip after the return: %d %v", status, g)
	}
	planTag(t, driver, base, f, "submitted")
}
