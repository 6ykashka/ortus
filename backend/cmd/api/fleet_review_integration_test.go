//go:build integration

package main

// Приёмка смены на стенде (W2.06, путь показа 18.10): после смены водителя Ильи Васильева (W2.05) владелец Дарья
// Зимина принимает смену — машина «Газель Next» снова свободна, расходы подтверждены, решение — раунд приёмки.
// Повтор с тем же ключом отдаёт сохранённый ответ, второе решение — 409. Всё — через шлюз, BFF и idempotency cmd/api.

import (
	"context"
	"database/sql"
	"net/http"
	"testing"

	"github.com/google/uuid"
)

// cleanReview removes what the acceptance of trip f wrote (registered after seedReserveTrip: runs before its cleanup).
func cleanReview(t *testing.T, db *sql.DB, f reserveTrip) {
	t.Helper()
	t.Cleanup(func() {
		ctx := context.WithoutCancel(t.Context())
		for _, q := range []string{
			`delete from finance.earnings where trip_id = $1`,
			`delete from fleet.trip_reviews where trip_id = $1`,
		} {
			if _, err := db.ExecContext(ctx, q, f.trip); err != nil {
				t.Errorf("%s: %v", q, err)
			}
		}
	})
}

func TestStackShiftReview(t *testing.T) { //nolint:paralleltest // one seeded stack; switches logistics on in t_alta
	srv := server(t)
	db := super(t, "t_alta")
	f := seedReserveTrip(t, db)
	cleanShift(t, db, f)
	cleanReview(t, db, f)
	driver := newBrowser(t, srv).login("driver")
	base := "/api/v1/tenants/" + seedAlta.String() + "/fleet"
	reservation := reserveForTrip(t, driver, db, base, f)
	inspectDeparture(t, driver, db, base, reservation, f)
	trip := base + "/trips/" + f.trip.String()
	startShift(t, driver, db, base, reservation, f)
	recordExpenses(t, driver, db, trip, f)
	tag := planTag(t, driver, base, f, "on_route")
	if status, _, plan := driver.fleetCall(http.MethodPost, trip+"/route-completion", "w206-"+uuid.NewString(), tag, nil); status != http.StatusOK {
		t.Fatalf("finishTripRoute: %d %v", status, plan)
	}
	returnShift(t, driver, db, base, f)
	owner := newBrowser(t, srv).login("owner")
	if s := vehicleStatus(t, owner, base, f); s != "blocked" {
		t.Fatalf("vehicle waiting for the acceptance: %s, want blocked", s)
	}
	acceptShift(t, owner, driver, base, f)
	if s := vehicleStatus(t, owner, base, f); s != "available" {
		t.Fatalf("vehicle after the acceptance: %s, want available", s)
	}
	status, _, page := owner.fleetCall(http.MethodGet, trip+"/expenses", "", "", nil)
	for _, it := range asSlice(page["items"]) {
		if m, _ := it.(map[string]any); status != http.StatusOK || m["reviewState"] != "approved" {
			t.Fatalf("expenses after the acceptance: %d %v", status, page)
		}
	}
	setEarnings(t, owner, driver, f)
}

// setEarnings: the accepted shift has the draft of 0 ₽ at revision 1 (Q-55: the acceptance sets no amount); the
// driver does not see it — 403 function_blocked (D-10, AC-05); the owner writes 4 500 ₽ with its ETag by a separate
// command and the list of earnings shows it.
func setEarnings(t *testing.T, owner, driver *browser, f reserveTrip) {
	t.Helper()
	earnings := "/api/v1/tenants/" + seedAlta.String() + "/fleet/trips/" + f.trip.String() + "/earnings"
	status, h, draft := owner.fleetCall(http.MethodGet, earnings, "", "", nil)
	amount, _ := draft["amount"].(map[string]any)
	if status != http.StatusOK || amount["amountMinor"] != float64(0) || draft["revision"] != float64(1) || h.Get("ETag") != `"1"` {
		t.Fatalf("getTripEarnings after the acceptance: %d %v %v", status, h, draft)
	}
	if status, _, p := driver.fleetCall(http.MethodGet, earnings, "", "", nil); status != http.StatusForbidden || p["code"] != "function_blocked" {
		t.Fatalf("earnings of the driver: %d %v", status, p)
	}
	body := map[string]any{"amount": map[string]any{"amountMinor": 450000, "currency": "RUB"}, "calculationNote": "Ставка за рейс"}
	status, h, got := owner.fleetCall(http.MethodPut, earnings, "w206-"+uuid.NewString(), `"1"`, body)
	if status != http.StatusOK || got["revision"] != float64(2) || got["calculationNote"] != "Ставка за рейс" || h.Get("ETag") != `"2"` {
		t.Fatalf("setTripEarnings: %d %v %v", status, h, got)
	}
	listedEarnings(t, owner, f, 2)
}

// listedEarnings requires the earnings of trip f at revision in listTripEarnings of the subject.
func listedEarnings(t *testing.T, b *browser, f reserveTrip, revision int) {
	t.Helper()
	status, _, list := b.fleetCall(http.MethodGet, "/api/v1/tenants/"+seedAlta.String()+"/fleet/earnings", "", "", nil)
	for _, it := range asSlice(list["items"]) {
		if m, _ := it.(map[string]any); m["tripId"] == f.trip.String() && m["revision"] == float64(revision) {
			return
		}
	}
	t.Fatalf("listTripEarnings: %d %v, want the trip at revision %d", status, list, revision)
}

// acceptShift: the driver cannot accept his own shift (no fleet.trips.review — 403); the owner accepts it with the
// ETag of the trip card, the repeat with the same key replays, a second decision is 409; the card says accepted with
// the round of the review.
func acceptShift(t *testing.T, owner, driver *browser, base string, f reserveTrip) {
	t.Helper()
	tag := planTag(t, owner, base, f, "submitted")
	review := base + "/trips/" + f.trip.String() + "/review"
	body := map[string]any{"decision": "approve"}
	if status, _, p := driver.fleetCall(http.MethodPost, review, "w206-"+uuid.NewString(), tag, body); status != http.StatusForbidden {
		t.Fatalf("review by the driver: %d %v", status, p)
	}
	key := "w206-" + uuid.NewString()
	status, h, got := owner.fleetCall(http.MethodPost, review, key, tag, body)
	if status != http.StatusOK || got["status"] != "approved" || h.Get("Idempotency-Replayed") != "false" || h.Get("ETag") == tag {
		t.Fatalf("reviewTrip: %d %v %v", status, h, got)
	}
	repeatReview(t, owner, review, key, tag, h.Get("ETag"), got)
	status, _, plan := owner.fleetCall(http.MethodGet, base+"/trip-plans/"+f.trip.String(), "", "", nil)
	last, _ := plan["lastReview"].(map[string]any)
	if status != http.StatusOK || plan["state"] != "accepted" || last["decision"] != "approve" || last["attempt"] != float64(1) {
		t.Fatalf("getTripPlan after the acceptance: %d %v", status, plan)
	}
}

// repeatReview: the repeat of the acceptance with its key replays the stored answer; a new decision with the fresh
// ETag is 409 — the shift is processed.
func repeatReview(t *testing.T, owner *browser, review, key, tag, fresh string, got map[string]any) {
	t.Helper()
	body := map[string]any{"decision": "approve"}
	if status, h, again := owner.fleetCall(http.MethodPost, review, key, tag, body); status != http.StatusOK ||
		h.Get("Idempotency-Replayed") != "true" || again["revision"] != got["revision"] {
		t.Fatalf("replay of reviewTrip: %d %v %v", status, h, again)
	}
	if status, _, p := owner.fleetCall(http.MethodPost, review, "w206-"+uuid.NewString(), fresh, body); status != http.StatusConflict ||
		p["code"] != "invalid_transition" {
		t.Fatalf("second review: %d %v", status, p)
	}
}

// vehicleStatus is the status of the vehicle of f in listVehicles of the subject.
func vehicleStatus(t *testing.T, b *browser, base string, f reserveTrip) string {
	t.Helper()
	status, _, page := b.fleetCall(http.MethodGet, base+"/vehicles", "", "", nil)
	if status != http.StatusOK {
		t.Fatalf("listVehicles: %d %v", status, page)
	}
	for _, it := range asSlice(page["items"]) {
		if m, _ := it.(map[string]any); m["id"] == f.vehicle.String() {
			s, _ := m["status"].(string)
			return s
		}
	}
	t.Fatalf("vehicle %s is not listed: %v", f.vehicle, page)
	return ""
}
