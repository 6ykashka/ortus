//go:build integration

package main

// Пул водителей на стенде (W2.07, S2-14, AUTH-07, AC-06): владелец «Альты» публикует Илью Васильева («Север
// Логистик») в пул, запрашивает его на рейс «Юг Транс» и одобряет. Временное назначение открывает водителю рейс
// другой фирмы только в своём сроке; бронь машины «Юг Транс» на этот рейс — команда W2.02 через надстройку пула —
// открывает верхнюю границу назначения (рейс начат, Q-W2.51-15); отзыв закрывает рейс сразу — 404 (AC-06). Всё — через
// шлюз, BFF и idempotency cmd/api.

import (
	"context"
	"database/sql"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"
)

// poolTrip is a trip of «Юг Транс» without a driver, with a vehicle of its company, and the seeded driver of «Север
// Логистик» Илья Васильев; the logistics module is switched on for the test. Everything is removed after it.
type poolTrip struct {
	trip, other, vehicle, driver, home, target uuid.UUID
	starts, ends                               time.Time
}

func seedPoolTrip(t *testing.T, db *sql.DB) poolTrip {
	t.Helper()
	ctx := t.Context()
	f := poolTrip{trip: uuid.New(), other: uuid.New(), vehicle: uuid.New()}
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
	if err := db.QueryRowContext(ctx, `select p.id, p.home_unit_id, (select id from org.units where name = 'Юг Транс')
		  from people.person_profiles p where p.email = 'i.vasiliev@alta.example'`).Scan(&f.driver, &f.home, &f.target); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Second)
	// After the seeded trip Р-208 of the driver (it starts an hour before the hour of the seed and lasts four hours).
	f.starts, f.ends = now.Add(5*time.Hour), now.Add(12*time.Hour)
	for _, s := range []struct {
		sql  string
		args []any
	}{
		{`insert into fleet.vehicles (id, unit_id, plate, body_type, payload_kg, volume_m3, cargo_length_mm, odometer_km, display_name)
		  values ($1, $2, 'Ю 207 ПЛ 77', 'van', 1500, 12, 3200, 30100, 'Газель Юг')`, []any{f.vehicle, f.target}},
		{`insert into fleet.trips (id, number, unit_id, state, planned) values ($1, 'Р-W207', $2, 'planned', tstzrange($3, $4))`,
			[]any{f.trip, f.target, f.starts, f.ends}},
		{`insert into fleet.trips (id, number, unit_id, state, planned) values ($1, 'Р-W207-2', $2, 'planned', tstzrange($3, $4))`,
			[]any{f.other, f.target, f.starts, f.ends}},
	} {
		if _, err := db.ExecContext(ctx, s.sql, s.args...); err != nil {
			t.Fatalf("%s: %v", s.sql, err)
		}
	}
	t.Cleanup(func() { cleanPool(t, db, f, installed > 0) })
	return f
}

// cleanPool removes what the pool path of f wrote, children first.
func cleanPool(t *testing.T, db *sql.DB, f poolTrip, logistics bool) {
	t.Helper()
	ctx := context.WithoutCancel(t.Context())
	for _, q := range []struct {
		sql string
		id  uuid.UUID
	}{
		{`delete from notify.notifications where entity_type = 'driver_transfer' and entity_id in
		    (select x.id from fleet.driver_transfers x join fleet.pool_publications p on p.id = x.publication_id where p.person_id = $1)`, f.driver},
		{`delete from fleet.driver_transfers where publication_id in (select id from fleet.pool_publications where person_id = $1)`, f.driver},
		{`delete from access.role_assignments where principal_id = $1 and source = 'transfer'`, f.driver},
		{`delete from fleet.pool_publications where person_id = $1`, f.driver},
		{`delete from sched.reservations where source_id = $1`, f.trip},
		{`delete from fleet.trips where id = $1`, f.trip},
		{`delete from fleet.trips where id = $1`, f.other},
		{`delete from sched.resources where ref_id = $1`, f.vehicle},
		{`delete from fleet.vehicles where id = $1`, f.vehicle},
	} {
		if _, err := db.ExecContext(ctx, q.sql, q.id); err != nil {
			t.Errorf("%s: %v", q.sql, err)
		}
	}
	if logistics {
		if _, err := db.ExecContext(ctx, `delete from modules.installations where module_key = 'logistics'`); err != nil {
			t.Errorf("logistics: %v", err)
		}
	}
}

func TestStackDriverPool(t *testing.T) { //nolint:paralleltest // one seeded stack; switches logistics on in t_alta
	srv := server(t)
	db := super(t, "t_alta")
	f := seedPoolTrip(t, db)
	owner := newBrowser(t, srv).login("owner")
	driver := newBrowser(t, srv).login("driver")
	base := "/api/v1/tenants/" + seedAlta.String() + "/fleet"
	plan := base + "/trip-plans/" + f.trip.String()
	transfer := approvePool(t, owner, base, f)
	if status, _, body := driver.fleetCall(http.MethodGet, plan, "", "", nil); status != http.StatusNotFound {
		t.Fatalf("trip of «Юг Транс» for the driver before his window: %d %v, want 404", status, body)
	}
	// The window of the assignment starts now (the clock of the stack is the real one); the evaluator cache of cmd/api
	// (realtime.PolicyCache, at most a second) sees it at the next policy version.
	for _, q := range []string{
		`update access.role_assignments set valid = tstzrange(now() - interval '1 minute', upper(valid)) where principal_id = $1 and source = 'transfer'`,
		`update access.policy_state set policy_version = policy_version + 1 where $1::uuid is not null`,
	} {
		if _, err := db.ExecContext(t.Context(), q, f.driver); err != nil {
			t.Fatal(err)
		}
	}
	if status, _, body := driver.fleetCall(http.MethodGet, plan, "", "", nil); status != http.StatusOK || body["state"] != "planned" {
		t.Fatalf("trip of «Юг Транс» for the temporary driver: %d %v, want 200", status, body)
	}
	exposedInWindow(t, driver, base, f)
	reservePoolVehicle(t, driver, db, base, f)
	revoked := decidePool(t, owner, base, transfer, "revoke", http.StatusOK)
	if revoked["status"] != "revoked" {
		t.Fatalf("revoked transfer: %v", revoked)
	}
	if status, _, body := driver.fleetCall(http.MethodGet, plan, "", "", nil); status != http.StatusNotFound {
		t.Fatalf("trip of «Юг Транс» after the revocation: %d %v, want 404 (AC-06)", status, body)
	}
	if status, _, vehicles := driver.fleetCall(http.MethodGet, base+"/vehicles", "", "", nil); status != http.StatusOK ||
		hasItem(vehicles, "id", f.vehicle.String()) {
		t.Fatalf("vehicles for the driver after the revocation: %d %v, want 200 without the vehicle of «Юг Транс» (AC-06)", status, vehicles)
	}
}

// exposedInWindow pins what the temporary assignment opens in «Юг Транс» (Q-W2.07-1): the trips the driver drives
// only — another trip of the company is 404 and is not listed (D22 of the trip modules); the vehicles of the company,
// which he takes for his trip himself (reserveVehicle, W2.02).
func exposedInWindow(t *testing.T, driver *browser, base string, f poolTrip) {
	t.Helper()
	if status, _, body := driver.fleetCall(http.MethodGet, base+"/trip-plans/"+f.other.String(), "", "", nil); status != http.StatusNotFound {
		t.Fatalf("another trip of «Юг Транс» for the temporary driver: %d %v, want 404 (D22)", status, body)
	}
	status, _, plans := driver.fleetCall(http.MethodGet, base+"/trip-plans", "", "", nil)
	if status != http.StatusOK || !hasItem(plans, "id", f.trip.String()) || hasItem(plans, "id", f.other.String()) {
		t.Fatalf("trip plans of the temporary driver: %d %v, want his trip only (D22)", status, plans)
	}
	status, _, vehicles := driver.fleetCall(http.MethodGet, base+"/vehicles", "", "", nil)
	if status != http.StatusOK || !hasItem(vehicles, "id", f.vehicle.String()) {
		t.Fatalf("vehicles of «Юг Транс» for the temporary driver: %d %v, want the vehicle of the company (Q-W2.07-1)", status, vehicles)
	}
}

// approvePool publishes the driver of f from his company, requests him for the trip of f and approves the request:
// the catalog of the owner shows the pool label, the approval puts the driver on the trip with a temporary assignment
// valid for the window.
func approvePool(t *testing.T, owner *browser, base string, f poolTrip) map[string]any {
	t.Helper()
	window := func(from, until time.Time) map[string]any {
		return map[string]any{"startsAt": from.Format(time.RFC3339), "endsAt": until.Format(time.RFC3339), "timeZone": "Europe/Moscow"}
	}
	status, _, pub := owner.fleetCall(http.MethodPost, base+"/driver-pool/publications", "w207-"+uuid.NewString(), "", map[string]any{
		"driverMemberId": f.driver, "homeOrgUnitId": f.home, "freeWindow": window(f.starts.Add(-time.Minute), f.ends),
		"qualifications": []string{"Кат. C"}, "terms": "По соглашению фирм группы",
	})
	if status != http.StatusCreated || pub["state"] != "active" {
		t.Fatalf("publishDriverToPool: %d %v", status, pub)
	}
	status, _, catalog := owner.fleetCall(http.MethodGet, base+"/driver-pool?availableFrom="+f.starts.Format(time.RFC3339)+
		"&availableUntil="+f.ends.Format(time.RFC3339), "", "", nil)
	if status != http.StatusOK || !hasItem(catalog, "publicationId", pub["id"]) {
		t.Fatalf("listAvailableDrivers: %d %v, want the publication %v", status, catalog, pub["id"])
	}
	status, h, x := owner.fleetCall(http.MethodPost, base+"/driver-transfer-requests", "w207-"+uuid.NewString(), "", map[string]any{
		"driverMemberId": f.driver, "sourceOrgUnitId": f.home, "targetOrgUnitId": f.target, "tripId": f.trip,
		"publicationId": pub["id"], "window": window(f.starts, f.ends), "reason": "Запрос на рейс Р-W207",
	})
	if status != http.StatusCreated || x["status"] != "requested" || h.Get("ETag") != `"1"` {
		t.Fatalf("requestDriverTransfer: %d %v %v", status, h, x)
	}
	approved := decidePool(t, owner, base, x, "approve", http.StatusOK)
	grant, _ := approved["grant"].(map[string]any)
	if approved["status"] != "approved" || grant["state"] != "scheduled" || grant["tripId"] != f.trip.String() {
		t.Fatalf("approved transfer: %v", approved)
	}
	return approved
}

func hasItem(page map[string]any, key string, value any) bool {
	for _, it := range asSlice(page["items"]) {
		if m, _ := it.(map[string]any); m[key] == value {
			return true
		}
	}
	return false
}

// decidePool decides transfer x with its ETag and requires status.
func decidePool(t *testing.T, b *browser, base string, x map[string]any, decision string, status int) map[string]any {
	t.Helper()
	rev, _ := x["revision"].(float64)
	id, _ := x["id"].(string)
	tag := `"` + strconv.FormatInt(int64(rev), 10) + `"`
	got, h, out := b.fleetCall(http.MethodPost, base+"/driver-transfer-requests/"+id+"/decision",
		"w207-"+uuid.NewString(), tag, map[string]any{"decision": decision})
	if got != status {
		t.Fatalf("decideDriverTransfer %s: %d %v %v, want %d", decision, got, h, out, status)
	}
	return out
}

// reservePoolVehicle: the temporary driver reserves the vehicle of «Юг Транс» for his trip (W2.02 through the
// overlay of the pool) — the trip goes to inspection, and the settlement after the command opens the upper bound of
// his assignment (a started trip keeps it until the acceptance, Q-W2.51-15).
func reservePoolVehicle(t *testing.T, driver *browser, db *sql.DB, base string, f poolTrip) {
	t.Helper()
	status, _, res := driver.fleetCall(http.MethodPost, base+"/reservations", "w207-"+uuid.NewString(), "", map[string]any{
		"vehicleId": f.vehicle, "driverMemberId": f.driver, "tripId": f.trip,
		"window": map[string]any{"startsAt": f.starts.Add(5 * time.Minute).Format(time.RFC3339),
			"endsAt": f.starts.Add(6 * time.Hour).Format(time.RFC3339), "timeZone": "Europe/Moscow"},
	})
	if status != http.StatusCreated {
		t.Fatalf("reserveVehicle by the temporary driver: %d %v", status, res)
	}
	var open bool
	if err := db.QueryRowContext(t.Context(), `select upper(valid) is null from access.role_assignments
		 where principal_id = $1 and source = 'transfer' and state = 'active'`, f.driver).Scan(&open); err != nil || !open {
		t.Fatalf("assignment after the start of the trip: open %v (%v), want open", open, err)
	}
}
