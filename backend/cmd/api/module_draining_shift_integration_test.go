//go:build integration

package main

// W2.60 (AC-12, Q-W2.32-3) сквозь стек: водитель Илья Васильев начинает смену (бронь, осмотр выезда, старт),
// владелец отключает «Логистику» — модуль в draining. Новое закрыто (осмотр перед выездом и старт рейса — 403
// module_read_only; осмотр выезда закрывает обработчик осмотра — шлюз вид осмотра не различает), начатая смена
// завершается через шлюз, BFF и idempotency cmd/api: «Завершить рейс», осмотр при сдаче с пятью фото, «Сдать машину».
// Смена ждёт приёмки — модуль остаётся в draining.

import (
	"net/http"
	"testing"

	"github.com/google/uuid"
)

const drainingDetail = "Модуль «Логистика» отключается: можно только завершить начатую работу."

func TestStackDrainingShift(t *testing.T) { //nolint:paralleltest // one seeded stack; switches logistics on and off in t_alta
	srv := server(t)
	db := super(t, "t_alta")
	f := seedReserveTrip(t, db)
	cleanShift(t, db, f) // registered after seedReserveTrip: runs before its cleanup (it removes the module row)
	driver := newBrowser(t, srv).login("driver")
	owner := newBrowser(t, srv).login("owner")
	base := "/api/v1/tenants/" + seedAlta.String() + "/fleet"
	reservation := reserveForTrip(t, driver, db, base, f)
	inspectDeparture(t, driver, db, base, reservation, f)
	startShift(t, driver, db, base, reservation, f)

	if status, body := setFleet(t, owner, `{"enabled": false, "reason": "W2.60: отключение при начатой смене"}`); status != http.StatusOK ||
		body["state"] != "draining" {
		t.Fatalf("disable with a started shift: %d %v", status, body)
	}
	closedWhileDraining(t, driver, base, reservation)

	trip := base + "/trips/" + f.trip.String()
	tag := planTag(t, driver, base, f, "on_route")
	status, h, plan := driver.fleetCall(http.MethodPost, trip+"/route-completion", "w260-"+uuid.NewString(), tag, nil)
	if status != http.StatusOK || plan["state"] != "returning" {
		t.Fatalf("finishTripRoute while draining: %d %v %v", status, h, plan)
	}
	returnShift(t, driver, db, base, f)
	if status, body, _ := owner.callH(http.MethodGet, altaPath("/modules/fleet"), "", nil); status != http.StatusOK || body["state"] != "draining" {
		t.Errorf("module after the return: %d %v, want draining until the acceptance", status, body)
	}
}

// closedWhileDraining: new work is closed while the module drains — a departure inspection (by the handler of the
// inspection, before its body is checked) and a new start.
func closedWhileDraining(t *testing.T, driver *browser, base, reservation string) {
	t.Helper()
	for name, call := range map[string]func() (int, map[string]any){
		"submitInspection(departure)": func() (int, map[string]any) {
			status, _, p := driver.fleetCall(http.MethodPost, base+"/inspections", "w260-"+uuid.NewString(), "",
				map[string]any{"kind": "departure", "reservationId": reservation})
			return status, p
		},
		"startTrip": func() (int, map[string]any) {
			status, _, p := driver.fleetCall(http.MethodPost, base+"/trips", "w260-"+uuid.NewString(), "",
				map[string]any{"reservationId": reservation})
			return status, p
		},
	} {
		if status, p := call(); status != http.StatusForbidden || p["code"] != "module_read_only" || p["detail"] != drainingDetail {
			t.Errorf("%s while draining: %d %v", name, status, p)
		}
	}
}
