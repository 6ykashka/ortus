//go:build integration

package main

// Сквозной тест шага 2.9 (W2.09, S2-18): браузер с cookie → BFF → шлюз (сессия, x-scope identity) → модуль home →
// членство в control DB → состояние модуля (W1.08) → источник логистики → tenant DB «Альты». Блокирующий дефект на
// проверке — карточка danger у владельца; модуль отключён — карточек логистики нет; чужая организация — 404.

import (
	"context"
	"database/sql"
	"maps"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
)

// seedBlockingDefect switches logistics on in «Альта» and writes a vehicle and a trip in «Дефект на проверке» with
// a blocking defect in review; everything is removed after the test.
func seedBlockingDefect(t *testing.T, db *sql.DB) (trip, defect uuid.UUID) {
	t.Helper()
	trip, defect, vehicle := uuid.New(), uuid.New(), uuid.New()
	owner := `(select id from people.person_profiles where email = 'd.zimina@alta.example')`
	now := time.Now().UTC()
	for _, s := range []struct {
		sql  string
		args []any
	}{
		{`insert into modules.installations (module_key, state, manifest_version, updated_by)
		  select 'logistics', 'enabled', '0.2', ` + owner + ` on conflict (module_key) do nothing`, nil},
		{`insert into fleet.vehicles (id, unit_id, plate, body_type, payload_kg, volume_m3, cargo_length_mm, display_name)
		  select $1, home_unit_id, 'М 609 КТ 77', 'van', 1500, 12, 3200, 'Газель Next' from people.person_profiles
		   where email = 'd.zimina@alta.example'`, []any{vehicle}},
		{`insert into fleet.trips (id, number, unit_id, state, vehicle_id, driver_person_id, planned)
		  select $1, 'Р-W209', unit_id, 'defect_review', id, ` + owner + `, tstzrange($3::timestamptz, $3::timestamptz + interval '8 hours')
		    from fleet.vehicles where id = $2`, []any{trip, vehicle, now}},
		{`insert into fleet.defects (id, vehicle_id, trip_id, zone, severity, description, state)
		  values ($1, $2, $3, 'Шины и колёса', 'blocking', 'Порез боковины', 'in_review')`, []any{defect, vehicle, trip}},
	} {
		if _, err := db.ExecContext(t.Context(), s.sql, s.args...); err != nil {
			t.Fatalf("%s: %v", s.sql, err)
		}
	}
	t.Cleanup(func() {
		ctx := context.WithoutCancel(t.Context())
		for _, q := range []struct {
			sql string
			arg uuid.UUID
		}{
			{`delete from fleet.defects where id = $1`, defect},
			{`delete from fleet.trips where id = $1`, trip},
			{`delete from fleet.vehicles where id = $1`, vehicle},
		} {
			if _, err := db.ExecContext(ctx, q.sql, q.arg); err != nil {
				t.Errorf("%s: %v", q.sql, err)
			}
		}
		if _, err := db.ExecContext(ctx, `delete from modules.installations where module_key = 'logistics'`); err != nil {
			t.Errorf("logistics: %v", err)
		}
	})
	return trip, defect
}

func TestStackHome(t *testing.T) { //nolint:paralleltest // one seeded stack; switches logistics on and off in t_alta
	srv := server(t)
	db := super(t, "t_alta")
	trip, defect := seedBlockingDefect(t, db)
	owner := newBrowser(t, srv).login("owner")
	path := "/api/v1/me/decisions?tenantId=" + seedAlta.String()
	checkBlockingCard(t, owner, path, trip, defect)
	checkQueueRefusals(t, owner, newBrowser(t, srv), path)

	// S2-18 п. 3: a disabled module gives no cards.
	if _, err := db.ExecContext(t.Context(), `update modules.installations set state = 'disabled' where module_key = 'logistics'`); err != nil {
		t.Fatal(err)
	}
	status, _, q := owner.fleetCall(http.MethodGet, path, "", "", nil)
	if status != http.StatusOK {
		t.Fatalf("queue with logistics off: %d %v", status, q)
	}
	for _, it := range asSlice(q["items"]) {
		if m, _ := it.(map[string]any); m["moduleKey"] == "fleet" {
			t.Fatalf("disabled logistics still gives %v", m)
		}
	}
}

// checkBlockingCard: the blocking defect is the first card of the owner (danger), with the fields of the client text.
func checkBlockingCard(t *testing.T, owner *browser, path string, trip, defect uuid.UUID) {
	t.Helper()
	status, h, q := owner.fleetCall(http.MethodGet, path+"&limit=1", "", "", nil)
	items := asSlice(q["items"])
	if status != http.StatusOK || q["tenantId"] != seedAlta.String() || len(items) != 1 || h.Get("Cache-Control") != "private, no-store" {
		t.Fatalf("getMyDecisionQueue: %d %v %v", status, h, q)
	}
	first, _ := items[0].(map[string]any)
	params, _ := first["params"].(map[string]any)
	object, _ := first["object"].(map[string]any)
	want := map[string]any{
		"key": "fleet.blocking_defect:" + defect.String(), "tone": "danger", "moduleKey": "fleet",
		"tripNumber": "Р-W209", "driverName": "Дарья Зимина", "entityId": trip.String(),
	}
	got := map[string]any{
		"key": first["key"], "tone": first["tone"], "moduleKey": first["moduleKey"],
		"tripNumber": params["tripNumber"], "driverName": params["driverName"], "entityId": object["entityId"],
	}
	if !maps.Equal(got, want) {
		t.Fatalf("first card %v", first)
	}
}

// checkQueueRefusals: limit outside 1…50 or not a number — 400; a foreign business — 404; no session — 401.
func checkQueueRefusals(t *testing.T, owner, anonymous *browser, path string) {
	t.Helper()
	for _, bad := range []string{"&limit=0", "&limit=51", "&limit=many"} {
		if status, _, p := owner.fleetCall(http.MethodGet, path+bad, "", "", nil); status != http.StatusBadRequest {
			t.Fatalf("%s: %d %v", bad, status, p)
		}
	}
	status, _, p := owner.fleetCall(http.MethodGet, "/api/v1/me/decisions?tenantId="+seedLotos.String(), "", "", nil)
	if status != http.StatusNotFound || p["code"] != "not_found" {
		t.Fatalf("foreign business: %d %v", status, p)
	}
	if status, _, p := anonymous.fleetCall(http.MethodGet, path, "", "", nil); status != http.StatusUnauthorized {
		t.Fatalf("anonymous: %d %v", status, p)
	}
}

func asSlice(v any) []any {
	s, _ := v.([]any)
	return s
}
