//go:build integration

package main

// Сквозной тест W4.81 (контракт 0.11.1-stage4): браузер с cookie → BFF → шлюз (x-scope identity) → модуль home →
// источник задач → порт модуля «Задачи» → tenant DB «Альты» сида. Логист Марина Котова: срочная T-64 «Найти водителя на
// рейс Р-211» — карточка tasks.task_new (danger, срок 01.10); сводка задач — счётчики и бейдж; чужая организация — 404,
// без сессии — 401. Счётчики сида меняют соседние сквозные тесты задач, поэтому проверяются нижние границы.

import (
	"net/http"
	"testing"

	"github.com/google/uuid"
)

func TestStackHomeTasks(t *testing.T) { //nolint:paralleltest // one seeded stack
	srv := server(t)
	manager := newBrowser(t, srv).login("manager")
	checkTaskCard(t, manager)
	path := "/api/v1/me/task-summary?tenantId=" + seedAlta.String()
	checkTaskSummary(t, manager, path)
	if status, _, p := manager.fleetCall(http.MethodGet, "/api/v1/me/task-summary?tenantId="+seedLotos.String(), "", "", nil); status != http.StatusNotFound || p["code"] != "not_found" {
		t.Fatalf("foreign business: %d %v", status, p)
	}
	if status, _, p := newBrowser(t, srv).fleetCall(http.MethodGet, path, "", "", nil); status != http.StatusUnauthorized {
		t.Fatalf("anonymous: %d %v", status, p)
	}
}

// checkTaskCard: T-64 of the manager is a card tasks.task_new — danger, the number, the title, the deadline, the task.
func checkTaskCard(t *testing.T, manager *browser) {
	t.Helper()
	t64 := uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:t-alta:T-64")).String()
	status, _, q := manager.fleetCall(http.MethodGet, "/api/v1/me/decisions?tenantId="+seedAlta.String()+"&limit=50", "", "", nil)
	if status != http.StatusOK {
		t.Fatalf("getMyDecisionQueue: %d %v", status, q)
	}
	var card map[string]any
	for _, it := range asSlice(q["items"]) {
		if m, _ := it.(map[string]any); m["key"] == "tasks.task_new:"+t64 {
			card = m
		}
	}
	params, _ := card["params"].(map[string]any)
	object, _ := card["object"].(map[string]any)
	got := []any{card["tone"], card["moduleKey"], params["taskKey"], params["title"], params["dueAt"], object["entityId"]}
	want := []any{"danger", "tasks", "T-64", "Найти водителя на рейс Р-211", "2026-10-01T21:00:00Z", t64}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("card of T-64 %v in %v", card, q["items"])
		}
	}
}

// checkTaskSummary: the counters of the manager — each at least one in the seed (T-64; T-58, T-66; T-63, T-65), never
// cached.
func checkTaskSummary(t *testing.T, manager *browser, path string) {
	t.Helper()
	status, h, s := manager.fleetCall(http.MethodGet, path, "", "", nil)
	if status != http.StatusOK || s["tenantId"] != seedAlta.String() || h.Get("Cache-Control") != "private, no-store" {
		t.Fatalf("getMyTaskSummary: %d %v %v", status, h, s)
	}
	for _, k := range []string{"new", "inProgress", "review", "myNew"} {
		if n, _ := s[k].(float64); n < 1 {
			t.Fatalf("%s = %v, want at least 1: %v", k, s[k], s)
		}
	}
}
