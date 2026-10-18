//go:build integration

package main

// Сквозной тест шага 2.11 (W2.08, S2-16, AC-14): браузер с cookie → BFF → шлюз (data.catalog.read, data.query) →
// модуль data → провайдер логистики → tenant DB «Альты» на Go-сиде стенда. В состоянии пресета logistics-ready MSW
// (Марина Котова — «Менеджер логистики» «Север Логистик», «Логистика» включена) ответы совпадают с примерами
// listDatasets/ok и queryDataset/ok контракта 0.6.0-stage2 (паритет mock ↔ stand); версия прав — своя у стенда.

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/google/uuid"
)

// presetLogisticsReady puts «Альта» into the state of the preset logistics-ready (cmd/seed demo.go, W2.90):
// «Логистика» on, Котова «Менеджер логистики» of her firm with its subtree; policy_version + 1. Cleanup undoes both.
func presetLogisticsReady(t *testing.T, db *sql.DB) {
	t.Helper()
	var person string
	if err := super(t, controlDB).QueryRowContext(t.Context(),
		`select person_profile_id::text from memberships where account_id = $1 and tenant_id = $2`, seedKotova, seedAlta).
		Scan(&person); err != nil {
		t.Fatal(err)
	}
	assignment := uuid.New()
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{`insert into modules.installations (module_key, state, manifest_version, updated_by)
		  select 'logistics', 'enabled', '1.0.0', id from people.person_profiles where email = 'd.zimina@alta.example'
		  on conflict (module_key) do update set state = 'enabled'`, nil},
		{`insert into access.role_assignments (id, principal_kind, principal_id, role_id, role_version, scope_kind, scope_ref,
		    include_descendants, granted_by)
		  select $1, 'person', p.id, r.id, 1, 'unit', p.home_unit_id, true, p.id
		    from people.person_profiles p, access.roles r where p.id = $2 and r.name = 'Менеджер логистики'`, []any{assignment, person}},
		{`update access.policy_state set policy_version = policy_version + 1`, nil},
	} {
		if _, err := db.ExecContext(t.Context(), q.sql, q.args...); err != nil {
			t.Fatalf("%s: %v", q.sql, err)
		}
	}
	t.Cleanup(func() {
		ctx := context.WithoutCancel(t.Context())
		for _, q := range []string{
			`delete from access.role_assignments where id = '` + assignment.String() + `'`,
			`delete from modules.installations where module_key = 'logistics'`,
			`update access.policy_state set policy_version = policy_version + 1`,
		} {
			if _, err := db.ExecContext(ctx, q); err != nil {
				t.Errorf("%s: %v", q, err)
			}
		}
	})
}

// example reads api/openapi/examples/<op>/<name>.json.
func example(t *testing.T, op, name string) map[string]any {
	t.Helper()
	root, err := os.OpenRoot(filepath.Join("..", "..", "..", "api", "openapi", "examples", op))
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	raw, err := root.ReadFile(name + ".json")
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// sameBody compares a response body with want as canonical JSON.
func sameBody(t *testing.T, what string, got, want map[string]any) {
	t.Helper()
	if g, w := canonicalJSON(t, mustJSON(t, got)), canonicalJSON(t, mustJSON(t, want)); g != w {
		t.Fatalf("%s\n got %s\nwant %s", what, g, w)
	}
}

func TestStackData(t *testing.T) { //nolint:paralleltest // one seeded stack; switches logistics on in t_alta
	srv := server(t)
	db := super(t, "t_alta")
	presetLogisticsReady(t, db)
	var version string
	if err := db.QueryRowContext(t.Context(), `select policy_version::text from access.policy_state`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	manager := newBrowser(t, srv).login("manager")

	status, cat := manager.call(http.MethodGet, altaPath("/datasets"), "")
	want := example(t, "listDatasets", "ok")
	for _, it := range asSlice(want["items"]) {
		it.(map[string]any)["permissionVersion"] = version //nolint:forcetypeassert // the example is an object of datasets
	}
	if status != http.StatusOK {
		t.Fatalf("listDatasets: %d %v", status, cat)
	}
	sameBody(t, "listDatasets/ok", cat, want)

	status, rows := manager.call(http.MethodPost, altaPath("/datasets/fleet.trips/query"),
		`{"select": ["trip", "driverName", "state", "mileageKm"], "filters": [], "sort": [], "limit": 50, "includeCount": true}`)
	want = example(t, "queryDataset", "ok")
	want["schemaVersion"] = version
	if status != http.StatusOK {
		t.Fatalf("queryDataset: %d %v", status, rows)
	}
	sameBody(t, "queryDataset/ok", rows, want)

	status, bad := manager.call(http.MethodPost, altaPath("/datasets/fleet.trips/query"),
		`{"select": ["plate"], "filters": [], "sort": [], "limit": 50}`)
	want = example(t, "queryDataset", "validation_failed")
	if status != http.StatusUnprocessableEntity || bad["requestId"] == "" {
		t.Fatalf("unknown field: %d %v", status, bad)
	}
	bad["requestId"] = want["requestId"]
	sameBody(t, "queryDataset/validation_failed", bad, want)

	checkVehicles(t, manager)
	if status, body := newBrowser(t, srv).login("driver").call(http.MethodGet, altaPath("/datasets"), ""); status != http.StatusForbidden ||
		body["code"] != "forbidden_action" {
		t.Fatalf("driver: %d %v", status, body)
	}
	checkLogisticsOff(t, newBrowser(t, srv).login("owner"), db)
}

// checkLogisticsOff: «Логистика» switched off — no dataset, the query of a known dataset is 404 (S2-16, a disabled
// module).
func checkLogisticsOff(t *testing.T, owner *browser, db *sql.DB) {
	t.Helper()
	if _, err := db.ExecContext(t.Context(), `update modules.installations set state = 'disabled' where module_key = 'logistics'`); err != nil {
		t.Fatal(err)
	}
	if status, body := owner.call(http.MethodGet, altaPath("/datasets"), ""); status != http.StatusOK || len(asSlice(body["items"])) != 0 {
		t.Fatalf("logistics off: %d %v", status, body)
	}
	if status, body := owner.call(http.MethodPost, altaPath("/datasets/fleet.vehicles/query"),
		`{"select": ["displayName"], "filters": [], "sort": [], "limit": 50}`); status != http.StatusNotFound || body["detail"] != "Набор не найден." {
		t.Fatalf("query with logistics off: %d %v", status, body)
	}
}

// checkVehicles: «Автомобили» of «Север Логистик» — five vehicles of the seven of the seed in the order of MSW
// (cases/data.ts W2.51), search «газ» and a page of two by volume.
func checkVehicles(t *testing.T, manager *browser) {
	t.Helper()
	names := func(body map[string]any) []string {
		var out []string
		for _, r := range asSlice(body["rows"]) {
			cells := asSlice(r.(map[string]any)["cells"])                //nolint:forcetypeassert // DatasetRow of the contract
			value := cells[0].(map[string]any)["value"].(map[string]any) //nolint:forcetypeassert // FieldEntry of the contract
			s, _ := value["value"].(string)
			out = append(out, s)
		}
		return out
	}
	q := func(extra string) map[string]any {
		status, body := manager.call(http.MethodPost, altaPath("/datasets/fleet.vehicles/query"),
			`{"select": ["displayName", "status", "volumeM3"], "filters": [], "sort": [], "limit": 50`+extra+`}`)
		if status != http.StatusOK {
			t.Fatalf("vehicles %s: %d %v", extra, status, body)
		}
		return body
	}
	all := q(`, "includeCount": true`)
	if got := names(all); !slices.Equal(got, []string{"ГАЗель Next", "ГАЗон Next", "Ford Transit", "Hyundai Porter", "Mercedes Sprinter"}) ||
		all["visibleCount"] != float64(5) {
		t.Fatalf("vehicles %v, count %v", got, all["visibleCount"])
	}
	if got := names(q(`, "search": "газ"`)); !slices.Equal(got, []string{"ГАЗель Next", "ГАЗон Next"}) {
		t.Fatalf("search: %v", got)
	}
	first := q(`, "sort": [{"fieldKey": "volumeM3", "direction": "desc"}], "limit": 2`)
	if got := names(first); !slices.Equal(got, []string{"ГАЗон Next", "ГАЗель Next"}) || first["nextCursor"] == nil {
		t.Fatalf("by volume: %v %v", got, first["nextCursor"])
	}
}
