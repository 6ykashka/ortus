//go:build integration

package main

// W2.50 сквозь стек (ревью W2.50-r1): браузер с cookie → BFF → шлюз (CSRF, право, Idempotency-Key, If-Match) →
// fleet/csv → tenant DB «Альты» в состоянии пресета logistics-ready (Марина Котова — «Менеджер логистики» «Север
// Логистик»). Импорт CSV машин: без CSRF — 403 до хендлера; повтор createVehicleImport с тем же ключом — сохранённый
// ответ, второй импорт не создаётся; тот же ключ с другим файлом — 409; применение без If-Match — 428, по ETag — 200;
// тот же файл с новым ключом — новый предпросмотр «update». Выгрузка CSV: без CSRF — 403, с ним — файл с заголовком.

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"
)

const csvHeader = "registration_number;display_name;body_type;payload_kg;volume_m3;cargo_length_m;cargo_width_m;cargo_height_m;odometer_km"

// importBody is the body of createVehicleImport of one vehicle row.
func importBody(t *testing.T, unit, plate, name string) string {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"fileName": "w250-stack.csv", "defaultOrgUnitId": unit,
		"csv": csvHeader + "\r\n" + plate + ";" + name + ";tent;1500;16;3,1;2;1,9;1000\r\n",
	})
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

// cleanImports removes the imports of the test and the vehicles they created.
func cleanImports(t *testing.T, db *sql.DB, plate string) {
	t.Helper()
	t.Cleanup(func() {
		ctx := context.WithoutCancel(t.Context())
		for _, q := range []string{
			`delete from fleet.vehicle_imports where file_name = 'w250-stack.csv'`,
			`delete from sched.resources where ref_id in (select id from fleet.vehicles where plate = $1)`,
			`delete from fleet.vehicles where plate = $1`,
		} {
			args := []any{plate}
			if !strings.Contains(q, "$1") {
				args = nil
			}
			if _, err := db.ExecContext(ctx, q, args...); err != nil {
				t.Errorf("%s: %v", q, err)
			}
		}
	})
}

// stackPlate is a registration number the seed never has (Latin «W250-STACK-» and 8 hex digits, ревью W2.50-r2:
// «О NNN СК 77» had 1000 variants and could hit a seeded vehicle — the first row would be an update and cleanImports
// would delete the seeded vehicle). It must be absent before the test.
func stackPlate(t *testing.T, db *sql.DB) string {
	t.Helper()
	plate := "W250-STACK-" + strings.ToUpper(uuid.NewString()[:8])
	var n int
	if err := db.QueryRowContext(t.Context(), `select count(*) from fleet.vehicles where upper(plate) = $1`, plate).
		Scan(&n); err != nil || n != 0 {
		t.Fatalf("plate %s before the test: %d %v, want absent", plate, n, err)
	}
	return plate
}

// withoutCSRF posts body as b without the CSRF token: the gateway answers 403 csrf_failed before the handler.
func withoutCSRF(t *testing.T, b *browser, op, path, body string, headers map[string]string) {
	t.Helper()
	noCSRF := *b
	noCSRF.csrf = ""
	if status, out, _ := noCSRF.callH(http.MethodPost, path, body, headers); status != http.StatusForbidden || out["code"] != "csrf_failed" {
		t.Fatalf("%s without CSRF: %d %v, want 403 csrf_failed", op, status, out)
	}
}

func firstRowAction(body map[string]any) any {
	rows := asSlice(body["rows"])
	if len(rows) == 0 {
		return nil
	}
	r, _ := rows[0].(map[string]any)
	return r["action"]
}

func TestStackVehicleImportAndExport(t *testing.T) { //nolint:paralleltest // one seeded stack; switches logistics on in t_alta
	srv := server(t)
	db := super(t, "t_alta")
	presetLogisticsReady(t, db)
	var unit string
	if err := db.QueryRowContext(t.Context(), `select id::text from org.units where name = 'Север Логистик'`).Scan(&unit); err != nil {
		t.Fatal(err)
	}
	plate := stackPlate(t, db)
	cleanImports(t, db, plate)
	manager := newBrowser(t, srv).login("manager")
	path := altaPath("/fleet/vehicle-imports")
	body := importBody(t, unit, plate, "Сквозной импорт")
	first := stackImportReplay(t, manager, db, path, body, importBody(t, unit, plate, "Другой файл"))
	stackImportCommit(t, manager, path, body, first)
	stackExport(t, manager)
}

// stackImportReplay: CSRF before the handler, the replay of createVehicleImport with the same key (one import) and
// the key with another file (409); it returns the preview.
func stackImportReplay(t *testing.T, manager *browser, db *sql.DB, path, body, other string) map[string]any {
	t.Helper()
	key := "w250-" + uuid.NewString()

	withoutCSRF(t, manager, "createVehicleImport", path, body, map[string]string{"Idempotency-Key": key})
	status, first, h := manager.callH(http.MethodPost, path, body, map[string]string{"Idempotency-Key": key})
	if status != http.StatusCreated || h.Get("ETag") != `"1"` || h.Get("Idempotency-Replayed") != "false" ||
		firstRowAction(first) != "create" {
		t.Fatalf("createVehicleImport: %d %v %v", status, h, first)
	}
	status, again, h := manager.callH(http.MethodPost, path, body, map[string]string{"Idempotency-Key": key})
	if status != http.StatusCreated || h.Get("Idempotency-Replayed") != "true" || again["id"] != first["id"] {
		t.Fatalf("replay of createVehicleImport: %d %v %v, want the stored answer", status, h, again)
	}
	var imports int
	if err := db.QueryRowContext(t.Context(), `select count(*) from fleet.vehicle_imports where file_name = 'w250-stack.csv'`).
		Scan(&imports); err != nil || imports != 1 {
		t.Fatalf("imports after the replay: %d %v, want 1", imports, err)
	}
	if status, out, _ := manager.callH(http.MethodPost, path, other, map[string]string{"Idempotency-Key": key}); status != http.StatusConflict ||
		out["code"] != "idempotency_key_reused" {
		t.Fatalf("the key with another file: %d %v, want 409 idempotency_key_reused", status, out)
	}
	return first
}

// stackImportCommit: the commit without If-Match (428) and by the ETag of the preview (200), then the same file with
// a new key — a new preview whose row is an update.
func stackImportCommit(t *testing.T, manager *browser, path, body string, first map[string]any) {
	t.Helper()
	commit := path + "/" + first["id"].(string) + "/commit" //nolint:forcetypeassert // VehicleImport.id of the contract
	if status, out, _ := manager.callH(http.MethodPost, commit, `{"skipInvalidRows": false}`,
		map[string]string{"Idempotency-Key": "w250-" + uuid.NewString()}); status != http.StatusPreconditionRequired {
		t.Fatalf("commit without If-Match: %d %v, want 428", status, out)
	}
	status, done, h := manager.callH(http.MethodPost, commit, `{"skipInvalidRows": false}`,
		map[string]string{"Idempotency-Key": "w250-" + uuid.NewString(), "If-Match": `"1"`})
	if status != http.StatusOK || done["state"] != "committed" || h.Get("ETag") != `"2"` {
		t.Fatalf("commitVehicleImport: %d %v %v", status, h, done)
	}

	status, fresh, _ := manager.callH(http.MethodPost, path, body, map[string]string{"Idempotency-Key": "w250-" + uuid.NewString()})
	if status != http.StatusCreated || fresh["id"] == first["id"] || firstRowAction(fresh) != "update" {
		t.Fatalf("the same file with a new key: %d %v, want a new preview with an update", status, fresh)
	}
}

// stackExport: exportDataset through the gateway — CSRF, then the file of «Расходы» with the header of the fields.
func stackExport(t *testing.T, manager *browser) {
	t.Helper()
	path := altaPath("/datasets/fleet.expenses/export")
	body := `{"select": ["trip", "kind", "occurredOn", "amount"], "filters": [], "sort": []}`
	withoutCSRF(t, manager, "exportDataset", path, body, nil)
	status, out, h := manager.callH(http.MethodPost, path, body, nil)
	content, _ := out["content"].(string)
	name, _ := out["fileName"].(string)
	if status != http.StatusOK || h.Get("Cache-Control") != "private, no-store" || !strings.HasPrefix(name, "Расходы-") ||
		!strings.HasPrefix(content, "Рейс;Категория;Дата;Сумма\r\n") {
		t.Fatalf("exportDataset: %d %v %v", status, h, out)
	}
}
