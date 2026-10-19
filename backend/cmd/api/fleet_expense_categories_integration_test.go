//go:build integration

package main

// Справочник категорий расходов на стенде (W2.41, D-12 комплекта): через шлюз, BFF и idempotency cmd/api водитель
// читает шесть категорий посева, владелец добавляет свою (ETag "rev-1", повтор ключа — тот же ответ) и убирает её в
// архив по If-Match; «Прочее» — 409; менеджер без modules.settings.manage — 403.

import (
	"context"
	"database/sql"
	"net/http"
	"slices"
	"testing"

	"github.com/google/uuid"
)

func TestStackExpenseCategories(t *testing.T) { //nolint:paralleltest // one seeded stack; switches logistics on in t_alta
	srv := server(t)
	db := super(t, "t_alta")
	label := "Стоянка на ночь " + uuid.NewString()[:8]
	logisticsWithCategory(t, db, label)
	base := "/api/v1/tenants/" + seedAlta.String() + "/fleet/expense-categories"
	driver := newBrowser(t, srv).login("driver")
	seedCategories(t, driver, base)
	code := createCategory(t, newBrowser(t, srv).login("owner"), base, label)
	manager := newBrowser(t, srv).login("manager")
	if status, _, p := manager.fleetCall(http.MethodPost, base, "w241-"+uuid.NewString(), "", map[string]any{
		"label": label + " 2", "commentRequired": false}); status != http.StatusForbidden || p["code"] != "forbidden_action" {
		t.Fatalf("manager creates: %d %v", status, p)
	}
	archiveCategory(t, newBrowser(t, srv).login("owner"), base, code)
	status, _, all := driver.fleetCall(http.MethodGet, base+"?includeArchived=true", "", "", nil)
	if status != http.StatusOK || !slices.ContainsFunc(asSlice(all["items"]), func(x any) bool {
		m, _ := x.(map[string]any)
		return m["code"] == code && m["state"] == "archived"
	}) {
		t.Fatalf("includeArchived: %d %v", status, all)
	}
}

// logisticsWithCategory switches logistics on in «Альта» (left as it was when already on) and removes the category
// label of the test afterwards.
func logisticsWithCategory(t *testing.T, db *sql.DB, label string) {
	t.Helper()
	res, err := db.ExecContext(t.Context(), `insert into modules.installations (module_key, state, manifest_version, updated_by)
		select 'logistics', 'enabled', '0.2', id from people.person_profiles where email = 'd.zimina@alta.example'
		on conflict (module_key) do nothing`)
	if err != nil {
		t.Fatal(err)
	}
	installed, _ := res.RowsAffected() // 0: switched on before the test, left as it was
	t.Cleanup(func() {
		ctx := context.WithoutCancel(t.Context())
		if _, err := db.ExecContext(ctx, `delete from fleet.expense_categories where label = $1`, label); err != nil {
			t.Errorf("categories: %v", err)
		}
		if installed > 0 {
			if _, err := db.ExecContext(ctx, `delete from modules.installations where module_key = 'logistics'`); err != nil {
				t.Errorf("logistics: %v", err)
			}
		}
	})
}

// seedCategories: the driver reads the six seed categories first, in the order of the catalogue.
func seedCategories(t *testing.T, driver *browser, base string) {
	t.Helper()
	status, h, page := driver.fleetCall(http.MethodGet, base, "", "", nil)
	var got []string
	for _, c := range asSlice(page["items"]) {
		m, _ := c.(map[string]any)
		code, _ := m["code"].(string)
		got = append(got, code)
	}
	if status != http.StatusOK || h.Get("Cache-Control") != "private, no-store" || len(got) < 6 ||
		!slices.Equal(got[:6], []string{"fuel", "wash", "parking", "toll", "tire_service", "other"}) {
		t.Fatalf("listExpenseCategories by the driver: %d %v %v", status, h, page)
	}
}

// createCategory: the owner adds a category (201, ETag "rev-1"), the repeat of the key replays it, an active label of
// the seed in another case is 422. It returns the code.
func createCategory(t *testing.T, owner *browser, base, label string) string {
	t.Helper()
	key := "w241-" + uuid.NewString()
	body := map[string]any{"label": label, "commentRequired": true}
	status, h, c := owner.fleetCall(http.MethodPost, base, key, "", body)
	if status != http.StatusCreated || h.Get("ETag") != `"rev-1"` || h.Get("Idempotency-Replayed") != "false" ||
		c["label"] != label || c["state"] != "active" || c["commentRequired"] != true {
		t.Fatalf("createExpenseCategory: %d %v %v", status, h, c)
	}
	if status, h, again := owner.fleetCall(http.MethodPost, base, key, "", body); status != http.StatusCreated ||
		h.Get("Idempotency-Replayed") != "true" || again["code"] != c["code"] {
		t.Fatalf("replay of createExpenseCategory: %d %v %v", status, h, again)
	}
	if status, _, p := owner.fleetCall(http.MethodPost, base, "w241-"+uuid.NewString(), "", map[string]any{
		"label": " МОЙКА ", "commentRequired": false}); status != http.StatusUnprocessableEntity || p["detail"] != "Такая категория уже есть." {
		t.Fatalf("duplicate label: %d %v", status, p)
	}
	code, _ := c["code"].(string)
	return code
}

// archiveCategory: without If-Match — 428, with the ETag of the category — 200 "rev-2" archived; «Прочее» — 409.
func archiveCategory(t *testing.T, owner *browser, base, code string) {
	t.Helper()
	archive := base + "/" + code + "/archive"
	if status, _, p := owner.fleetCall(http.MethodPost, archive, "w241-"+uuid.NewString(), "", nil); status != http.StatusPreconditionRequired ||
		p["code"] != "revision_required" {
		t.Fatalf("archive without If-Match: %d %v", status, p)
	}
	status, h, a := owner.fleetCall(http.MethodPost, archive, "w241-"+uuid.NewString(), `"rev-1"`, nil)
	if status != http.StatusOK || h.Get("ETag") != `"rev-2"` || a["state"] != "archived" || a["archivedAt"] == nil {
		t.Fatalf("archiveExpenseCategory: %d %v %v", status, h, a)
	}
	if status, _, p := owner.fleetCall(http.MethodPost, base+"/other/archive", "w241-"+uuid.NewString(), `"rev-1"`, nil); status != http.StatusConflict ||
		p["detail"] != "Категорию «Прочее» нельзя убрать." {
		t.Fatalf("archive other: %d %v", status, p)
	}
}
