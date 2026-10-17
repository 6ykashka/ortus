//go:build integration

package main

// W1.08 сквозь стек (testcontainers, Go-сид): паритет modules и tenantState /me/context с mock (примеры
// getMyContext, которые отдаёт MSW), AC-12 (отключение модуля с начатым рейсом: draining, новый рейс закрыт, сдача
// проходит, после сдачи — «только чтение») и AC-11 (подписка кончилась → grace → read_only: чтение проходит,
// изменения 403 tenant_read_only). Стенд пакета общий: каждый тест возвращает его в исходное состояние.

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/control/subscriptions"
)

// callH is browser.call with extra request headers (If-Match, Idempotency-Key).
func (b *browser) callH(method, path, body string, headers map[string]string) (int, map[string]any, http.Header) {
	b.t.Helper()
	return b.callCtx(b.t.Context(), method, path, body, headers)
}

// callCtx is callH with its own context (t.Cleanup runs after t.Context is cancelled).
func (b *browser) callCtx(ctx context.Context, method, path, body string, headers map[string]string) (int, map[string]any, http.Header) {
	b.t.Helper()
	req, err := http.NewRequestWithContext(ctx, method, b.base+path, strings.NewReader(body))
	if err != nil {
		b.t.Fatal(err)
	}
	req.Header.Set("Origin", "http://127.0.0.1:5213")
	req.Header.Set("Content-Type", "application/json")
	if b.csrf != "" {
		req.Header.Set("X-CSRF-Token", b.csrf)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := b.http.Do(req)
	if err != nil {
		b.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return resp.StatusCode, out, resp.Header
}

type tenantExtras struct {
	TenantID    string            `json:"tenantId"`
	Modules     []json.RawMessage `json:"modules"`
	TenantState json.RawMessage   `json:"tenantState"`
}

// altaExtras returns modules and tenantState of «Альта» in a /me/context body, each re-encoded.
func altaExtras(t *testing.T, raw []byte) (modules []string, state string) {
	t.Helper()
	var me struct {
		Tenants []tenantExtras `json:"tenants"`
	}
	if err := json.Unmarshal(raw, &me); err != nil {
		t.Fatal(err)
	}
	for _, tn := range me.Tenants {
		if tn.TenantID == seedAlta.String() {
			for _, m := range tn.Modules {
				modules = append(modules, canonicalJSON(t, m))
			}
			return modules, canonicalJSON(t, tn.TenantState)
		}
	}
	t.Fatalf("no «Альта» in %s", raw)
	return nil, ""
}

func canonicalJSON(t *testing.T, raw []byte) string {
	t.Helper()
	if len(raw) == 0 {
		return ""
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	out, _ := json.Marshal(v)
	return string(out)
}

// П-14 для W1.08: модули и состояние организации на стенде = примеры getMyContext, которые отдаёт mock.
func TestStackModulesParity(t *testing.T) { //nolint:paralleltest // one seeded stack
	srv := server(t)
	for _, persona := range []string{"owner", "manager", "driver"} {
		t.Run(persona, func(t *testing.T) {
			t.Parallel()
			root, err := os.OpenRoot(filepath.Join("..", "..", "..", "api", "openapi", "examples", "getMyContext"))
			if err != nil {
				t.Fatal(err)
			}
			defer root.Close()
			want, err := root.ReadFile(persona + ".json")
			if err != nil {
				t.Fatal(err)
			}
			status, body := newBrowser(t, srv).login(persona).call(http.MethodGet, "/api/v1/me/context", "")
			raw, _ := json.Marshal(body)
			if status != http.StatusOK {
				t.Fatalf("/me/context: %d %s", status, raw)
			}
			gotModules, gotState := altaExtras(t, raw)
			wantModules, wantState := altaExtras(t, want)
			if !slices.Equal(gotModules, wantModules) {
				t.Errorf("%s modules:\n stand %v\n mock  %v", persona, gotModules, wantModules)
			}
			if gotState != wantState {
				t.Errorf("%s tenantState: stand %s, mock %s", persona, gotState, wantState)
			}
		})
	}
}

const idemKey = "w108-stack-key-0001"

func altaPath(path string) string { return "/api/v1/tenants/" + seedAlta.String() + path }

// startedTrip puts a trip on route in t_alta (a vehicle and the driver Васильев); cleanup removes both.
func startedTrip(t *testing.T) (tripID uuid.UUID) {
	t.Helper()
	db := super(t, "t_alta")
	var unit, driver string
	if err := db.QueryRowContext(t.Context(), `select home_unit_id::text, id::text from people.person_profiles
		where email = 'i.vasiliev@alta.example'`).Scan(&unit, &driver); err != nil {
		t.Fatal(err)
	}
	vehicle, trip := uuid.New(), uuid.New()
	if _, err := db.ExecContext(t.Context(), `insert into fleet.vehicles (id, unit_id, plate, body_type, payload_kg, volume_m3,
		cargo_length_mm) values ($1, $2, 'А108ВС77', 'van', 1500, 12, 3000)`, vehicle, unit); err != nil {
		t.Fatalf("vehicle: %v", err)
	}
	if _, err := db.ExecContext(t.Context(), `insert into fleet.trips (id, number, unit_id, state, vehicle_id, driver_person_id,
		planned, started_at) values ($1, 'TR-2026-000108', $2, 'on_route', $3, $4, tstzrange(now(), now() + interval '8 hours'), now())`,
		trip, unit, vehicle, driver); err != nil {
		t.Fatalf("trip: %v", err)
	}
	t.Cleanup(func() {
		ctx := context.WithoutCancel(t.Context())
		_, _ = db.ExecContext(ctx, `delete from fleet.trips where id = $1`, trip)
		_, _ = db.ExecContext(ctx, `delete from fleet.vehicles where id = $1`, vehicle)
	})
	return trip
}

// setFleet sends setModuleInstallation for «Логистика» with the current ETag.
func setFleet(t *testing.T, owner *browser, body string) (int, map[string]any) {
	t.Helper()
	status, got, h := owner.callH(http.MethodGet, altaPath("/modules/fleet"), "", nil)
	if status != http.StatusOK {
		t.Fatalf("get fleet: %d %v", status, got)
	}
	status, got, _ = owner.callH(http.MethodPut, altaPath("/modules/fleet"), body,
		map[string]string{"If-Match": h.Get("ETag"), "Idempotency-Key": idemKey + uuid.NewString()[:8]})
	return status, got
}

// AC-12 (серверная часть): подключить «Логистику», отключить при начатом рейсе — draining: новый рейс 403
// module_read_only, сдача рейса проходит гейт модуля (до хендлера W2.05: тело без осмотра — 422), предпросмотр
// показывает рейс; рейс принят — «Отключён · только чтение»: чтение проходит, сдача 403; модуль в /me/context.
func TestStackModuleDraining(t *testing.T) { //nolint:paralleltest // changes modules of t_alta
	srv := server(t)
	owner := newBrowser(t, srv).login("owner")
	tenantDB := super(t, "t_alta")
	t.Cleanup(func() {
		_, _ = tenantDB.ExecContext(context.WithoutCancel(t.Context()), `delete from modules.installations where module_key = 'fleet'`)
	})
	if status, body := setFleet(t, owner, `{"enabled": true}`); status != http.StatusOK || body["state"] != "active" {
		t.Fatalf("enable: %d %v", status, body)
	}
	trip := startedTrip(t)
	status, preview, _ := owner.callH(http.MethodGet, altaPath("/modules/fleet/deactivation-preview"), "", nil)
	items, _ := preview["activeItems"].([]any)
	if status != http.StatusOK || len(items) != 1 || !strings.Contains(canonicalJSON(t, mustJSON(t, items[0])), trip.String()) {
		t.Fatalf("preview: %d %v", status, preview)
	}
	if status, body := setFleet(t, owner, `{"enabled": false, "reason": "Сезон закончился"}`); status != http.StatusOK || body["state"] != "draining" {
		t.Fatalf("disable: %d %v", status, body)
	}
	checkDraining(t, owner, trip)
	checkReadOnlyModule(t, owner, trip)
}

// checkDraining: a new trip is closed, returning the started one passes the module gate and reaches the handler of
// W2.05 (a body without the return inspection is 422).
func checkDraining(t *testing.T, owner *browser, trip uuid.UUID) {
	t.Helper()
	key := map[string]string{"Idempotency-Key": idemKey + "-trip"}
	if status, body, _ := owner.callH(http.MethodPost, altaPath("/fleet/trips"), `{}`, key); status != http.StatusForbidden || body["code"] != "module_read_only" {
		t.Errorf("startTrip while draining: %d %v", status, body)
	}
	patch := map[string]string{"Idempotency-Key": idemKey + "-return", "If-Match": `"1"`}
	if status, body, _ := owner.callH(http.MethodPatch, altaPath("/fleet/trips/"+trip.String()), `{}`, patch); status != http.StatusUnprocessableEntity ||
		body["code"] != "validation_failed" {
		t.Errorf("returnTrip while draining: %d %v", status, body)
	}
}

// checkReadOnlyModule: the trip is accepted, draining ends — «Отключён · только чтение»: reads pass, changes 403.
func checkReadOnlyModule(t *testing.T, owner *browser, trip uuid.UUID) {
	t.Helper()
	key := map[string]string{"Idempotency-Key": idemKey + "-trip"}
	if _, err := super(t, "t_alta").ExecContext(t.Context(), `update fleet.trips set state = 'accepted', returned_at = now() where id = $1`, trip); err != nil {
		t.Fatal(err)
	}
	if status, body, _ := owner.callH(http.MethodGet, altaPath("/modules/fleet"), "", nil); status != http.StatusOK || body["state"] != "read_only" {
		t.Fatalf("after the trip: %d %v", status, body)
	}
	if status, body, _ := owner.callH(http.MethodPatch, altaPath("/fleet/trips/"+trip.String()), `{}`, key); status != http.StatusForbidden || body["code"] != "module_read_only" {
		t.Errorf("returnTrip read_only: %d %v", status, body)
	}
	if status, body, _ := owner.callH(http.MethodGet, altaPath("/fleet/trips"), "", nil); status != http.StatusOK {
		t.Errorf("listTrips read_only: %d %v", status, body)
	}
	_, me := owner.call(http.MethodGet, "/api/v1/me/context", "")
	raw, _ := json.Marshal(me)
	mods, _ := altaExtras(t, raw)
	if !slices.Contains(mods, `{"accessMode":"read","moduleKey":"fleet","reason":"disabled","state":"read_only"}`) {
		t.Errorf("/me/context modules: %v", mods)
	}
	if n := countRows(t, "t_alta", `select count(*) from audit.events where action in ('modules.module.enable',
		'modules.module.disable', 'modules.module.drained') and diff->>'moduleKey' = 'fleet'`); n < 3 {
		t.Errorf("audit rows: %d", n)
	}
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func countRows(t *testing.T, db, q string) int {
	t.Helper()
	var n int
	if err := super(t, db).QueryRowContext(t.Context(), q).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// AC-11 (серверная часть): оператор переводит подписку «Лотоса» в grace со сроком в прошлом; жизненный цикл
// переводит организацию в read_only. Чтение проходит, изменение — 403 tenant_read_only, /me/context показывает
// read_only и plan_expired. Затем оператор возвращает подписку.
func TestStackSubscriptionReadOnly(t *testing.T) { //nolint:paralleltest // changes the subscription of t-lotos
	srv := server(t)
	op := newBrowser(t, srv).login("operator")
	sub := "/api/v1/platform/tenants/" + seedLotos.String() + "/subscription"
	put := func(ctx context.Context, body string) (int, map[string]any) {
		_, _, h := op.callCtx(ctx, http.MethodGet, sub, "", nil)
		status, out, _ := op.callCtx(ctx, http.MethodPut, sub, body,
			map[string]string{"If-Match": h.Get("ETag"), "Idempotency-Key": idemKey + uuid.NewString()[:8]})
		return status, out
	}
	// The clock of the run is the moment of the seed (01.10.2026, as MSW): the trial of «Альта» (till 13.10) is not
	// due, the grace of «Лотос» (till 01.09) is.
	seedNow := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	past := "2026-09-01T00:00:00Z"
	if status, body := put(t.Context(), `{"planKey": "team", "status": "grace", "graceEndsAt": "`+past+`", "cancelAtPeriodEnd": false,
		"manualEntitlements": [], "reason": "Проверка AC-11"}`); status != http.StatusOK || body["status"] != "grace" {
		t.Fatalf("grace: %d %v", status, body)
	}
	t.Cleanup(func() {
		if status, body := put(context.WithoutCancel(t.Context()), `{"planKey": "team", "status": "active", "periodEndsAt": "2027-03-31T21:00:00Z",
			"cancelAtPeriodEnd": false, "manualEntitlements": [], "reason": "Возврат стенда"}`); status != http.StatusOK {
			t.Errorf("restore: %d %v", status, body)
		}
	})
	store := subscriptions.Store{DB: super(t, controlDB), Now: func() time.Time { return seedNow }}
	if n, err := store.Advance(t.Context()); err != nil || n != 1 {
		t.Fatalf("advance: %d %v", n, err)
	}
	owner := newBrowser(t, srv).login("owner@t-lotos")
	lotos := "/api/v1/tenants/" + seedLotos.String()
	if status, body, _ := owner.callH(http.MethodGet, lotos+"/modules", "", nil); status != http.StatusOK {
		t.Errorf("read in read_only: %d %v", status, body)
	}
	if status, body := setLotosSpa(t, owner, lotos); status != http.StatusForbidden || body["code"] != "tenant_read_only" {
		t.Errorf("write in read_only: %d %v", status, body)
	}
	_, me := owner.call(http.MethodGet, "/api/v1/me/context", "")
	raw, _ := json.Marshal(me)
	if !strings.Contains(string(raw), `"status":"read_only"`) || !strings.Contains(string(raw), `"plan_expired"`) {
		t.Errorf("/me/context: %s", raw)
	}
}

func setLotosSpa(t *testing.T, owner *browser, lotos string) (int, map[string]any) {
	t.Helper()
	_, _, h := owner.callH(http.MethodGet, lotos+"/modules/spa", "", nil)
	status, body, _ := owner.callH(http.MethodPut, lotos+"/modules/spa", `{"enabled": false}`,
		map[string]string{"If-Match": h.Get("ETag"), "Idempotency-Key": idemKey + "-lotos"})
	return status, body
}
