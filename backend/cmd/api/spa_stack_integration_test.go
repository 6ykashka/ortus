//go:build integration

package main

// «Салон и SPA» на стенде (W5.20): браузер с cookie → BFF → шлюз (CSRF, права x-permissions, модуль spa, Idempotency-Key) →
// модуль spa → tenant DB «Альты». Услуга с техкартой, склад с остатком, запись практика в кабинет, занятый кабинет — 409,
// факт выполнения, завершение: материалы списаны один раз, повтор и чужой ключ ничего не списывают, касса получила
// предложение «визит» на цену услуги; менеджер без роли — 403.

import (
	"context"
	"database/sql"
	"maps"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestStackSpa(t *testing.T) { //nolint:paralleltest,gocyclo // one seeded stack; switches the spa module on in t_alta; one scenario
	srv := server(t)
	db := super(t, "t_alta")
	unit, owner, manager := spaStand(t, db)
	b := newBrowser(t, srv).login("owner")
	mgr := newBrowser(t, srv).login("manager")
	tenant := "/api/v1/tenants/" + seedAlta.String()
	spa, inv := tenant+"/spa", tenant+"/inventory"

	post := func(path string, body any) map[string]any {
		t.Helper()
		status, _, out := b.fleetCall(http.MethodPost, path, "w520-"+uuid.NewString(), "", body)
		if status != http.StatusCreated && status != http.StatusOK {
			t.Fatalf("POST %s: %d %v", path, status, out)
		}
		return out
	}
	str := func(m map[string]any, k string) string { s, _ := m[k].(string); return s }

	// the stock: a warehouse, a material, 100 ml of it
	sfx := uuid.NewString()[:8]
	wh := post(inv+"/warehouses", map[string]any{"name": "Склад салона " + sfx, "orgUnitId": unit})
	item := post(inv+"/items", map[string]any{"name": "Масло " + sfx, "sku": "W520-" + sfx, "baseUnit": "ml", "trackLots": false, "orgUnitId": unit})
	post(inv+"/movements", map[string]any{"kind": "receipt", "warehouseId": wh["id"], "lines": []any{map[string]any{"itemId": item["id"], "quantity": "100"}}})

	// the service with its recipe (25 ml per visit), the room, the visit yesterday
	svc := post(spa+"/services", map[string]any{"orgUnitId": unit, "name": "Массаж " + sfx, "durationMinutes": 60, "bufferBeforeMinutes": 5,
		"bufferAfterMinutes": 15, "price": map[string]any{"amountMinor": 450000, "currency": "RUB"}, "requiredEquipmentIds": []any{},
		"recipe": []any{map[string]any{"itemId": item["id"], "quantity": "25", "unit": "ml"}}})
	var room uuid.UUID
	if err := db.QueryRowContext(t.Context(), `insert into sched.resources (kind, home_unit_id, label) values ('room', $1, $2) returning id`,
		unit, "Кабинет "+sfx).Scan(&room); err != nil {
		t.Fatal(err)
	}
	msk := time.FixedZone("MSK", 3*60*60)
	day := time.Now().In(msk).AddDate(0, 0, -1-int(uuid.New()[0])%200)
	start := time.Date(day.Year(), day.Month(), day.Day(), 10, 0, 0, 0, msk).UTC()
	visit := map[string]any{"orgUnitId": unit, "serviceId": svc["id"], "clientId": uuid.NewString(), "practitionerMemberId": owner, "roomId": room.String(),
		"equipmentIds": []any{}, "startsAt": start.Format(time.RFC3339), "timeZone": "Europe/Moscow"}
	key := "w520-" + uuid.NewString()
	status, h, appt := b.fleetCall(http.MethodPost, spa+"/appointments", key, "", visit)
	if status != http.StatusCreated || h.Get("ETag") != `"rev-1"` || appt["status"] != "confirmed" || h.Get("Idempotency-Replayed") != "false" {
		t.Fatalf("createAppointment: %d %v %v", status, h, appt)
	}
	if status, h, again := b.fleetCall(http.MethodPost, spa+"/appointments", key, "", visit); status != http.StatusCreated ||
		h.Get("Idempotency-Replayed") != "true" || again["id"] != appt["id"] {
		t.Fatalf("replay of createAppointment: %d %v %v", status, h, again)
	}
	id := str(appt, "id")

	// the room is busy for the next visit (the cleaning holds it until 11:15)
	clash := map[string]any{}
	maps.Copy(clash, visit)
	clash["practitionerMemberId"], clash["clientId"], clash["startsAt"] = manager, uuid.NewString(), start.Add(70*time.Minute).Format(time.RFC3339)
	status, _, p := b.fleetCall(http.MethodPost, spa+"/appointments", "w520-"+uuid.NewString(), "", clash)
	if status != http.StatusConflict || p["code"] != "resources_unavailable" || p["retryable"] != true {
		t.Fatalf("a taken room: %d %v", status, p)
	}

	// the fact first, the accounting second
	if status, _, p := b.fleetCall(http.MethodPost, spa+"/appointments/"+id+"/completion", "w520-"+uuid.NewString(), `"rev-1"`,
		map[string]any{"warehouseId": wh["id"], "overrides": []any{}}); status != http.StatusConflict || p["reason"] != "not_in_status" {
		t.Fatalf("completion before the performance: %d %v", status, p)
	}
	status, h, done := b.fleetCall(http.MethodPost, spa+"/appointments/"+id+"/performance", "w520-"+uuid.NewString(), `"rev-1"`,
		map[string]any{"performedAt": start.Add(time.Hour).Format(time.RFC3339)})
	if status != http.StatusOK || done["status"] != "performed_pending_posting" || h.Get("ETag") != `"rev-2"` {
		t.Fatalf("recordAppointmentPerformance: %d %v %v", status, h, done)
	}
	if status, _, list := b.fleetCall(http.MethodGet, spa+"/appointments?status=performed_pending_posting&practitionerMemberId="+owner, "", "", nil); status != http.StatusOK ||
		len(asSlice(list["items"])) == 0 {
		t.Fatalf("the unfinished accounting: %d %v", status, list)
	}

	// the completion issues the recipe once; the same key replays, a new key with a stale revision answers the same
	complete := map[string]any{"warehouseId": wh["id"], "overrides": []any{}}
	ckey := "w520-" + uuid.NewString()
	status, h, got := b.fleetCall(http.MethodPost, spa+"/appointments/"+id+"/completion", ckey, `"rev-2"`, complete)
	movements := asSlice(got["inventoryMovementIds"])
	if status != http.StatusOK || h.Get("ETag") != `"rev-3"` || len(movements) != 1 {
		t.Fatalf("completeAppointment: %d %v %v", status, h, got)
	}
	if status, h, again := b.fleetCall(http.MethodPost, spa+"/appointments/"+id+"/completion", ckey, `"rev-2"`, complete); status != http.StatusOK ||
		h.Get("Idempotency-Replayed") != "true" || len(asSlice(again["inventoryMovementIds"])) != 1 {
		t.Fatalf("replay of completeAppointment: %d %v %v", status, h, again)
	}
	status, _, other := b.fleetCall(http.MethodPost, spa+"/appointments/"+id+"/completion", "w520-"+uuid.NewString(), `"rev-2"`, complete)
	if again := asSlice(other["inventoryMovementIds"]); status != http.StatusOK || len(again) != 1 || again[0] != movements[0] {
		t.Fatalf("a second completion: %d %v", status, other)
	}
	status, _, bal := b.fleetCall(http.MethodGet, inv+"/balances?warehouseId="+str(wh, "id")+"&itemId="+str(item, "id"), "", "", nil)
	if rows := asSlice(bal["items"]); status != http.StatusOK || len(rows) != 1 || rows[0].(map[string]any)["onHand"] != "75" { //nolint:forcetypeassert // the shape of the contract
		t.Fatalf("the stock after the completion: %d %v", status, bal)
	}
	var proposals, amount int
	if err := db.QueryRowContext(t.Context(), `select count(*), coalesce(max(amount_minor), 0) from cash.proposals where key = $1 and kind = 'visit'`,
		"visit:"+id).Scan(&proposals, &amount); err != nil || proposals != 1 || amount != 450000 {
		t.Fatalf("the proposal of the cash desk: %d x %d (%v)", proposals, amount, err)
	}

	// a manager without a role of the salon is refused by the gateway
	if status, _, p := mgr.fleetCall(http.MethodGet, spa+"/services", "", "", nil); status != http.StatusForbidden || p["code"] != "forbidden_action" {
		t.Fatalf("listSpaServices without a role: %d %v", status, p)
	}
}

// spaStand switches the spa module on in «Альта» (left as it was when already on) and returns the home unit and the
// person ids of the owner and of a manager.
func spaStand(t *testing.T, db *sql.DB) (unit, owner, manager string) {
	t.Helper()
	res, err := db.ExecContext(t.Context(), `insert into modules.installations (module_key, state, manifest_version, updated_by)
		select 'spa', 'enabled', '0.1', id from people.person_profiles where email = 'd.zimina@alta.example'
		on conflict (module_key) do nothing`)
	if err != nil {
		t.Fatal(err)
	}
	if installed, _ := res.RowsAffected(); installed > 0 {
		t.Cleanup(func() {
			if _, err := db.ExecContext(context.WithoutCancel(t.Context()), `delete from modules.installations where module_key = 'spa'`); err != nil {
				t.Errorf("spa: %v", err)
			}
		})
	}
	if err := db.QueryRowContext(t.Context(), `select home_unit_id::text, id::text from people.person_profiles where email = 'd.zimina@alta.example'`).
		Scan(&unit, &owner); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(t.Context(), `select id::text from people.person_profiles where email = 'm.kotova@alta.example'`).Scan(&manager); err != nil {
		t.Fatal(err)
	}
	return unit, owner, manager
}
