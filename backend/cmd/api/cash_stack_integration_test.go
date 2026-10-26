//go:build integration

package main

// «Касса» на стенде (W5.31): браузер с cookie → BFF → шлюз (CSRF, право с областью «касса», модуль cash, Idempotency-Key) →
// модуль cash → tenant DB «Альты». Владелец заводит кассу и вводит остаток; менеджер без роли кассы — 403; роль на одну кассу
// даёт ей проводить оплату и скрывает остаток; свою операцию он не сторнирует (self_approval), владелец — сторнирует.

import (
	"context"
	"database/sql"
	"net/http"
	"testing"

	"github.com/google/uuid"
)

func TestStackCash(t *testing.T) { //nolint:paralleltest,gocyclo // one seeded stack; switches the cash module on in t_alta; one scenario
	srv := server(t)
	db := super(t, "t_alta")
	unit := cashStand(t, db)
	base := "/api/v1/tenants/" + seedAlta.String() + "/cash"
	owner := newBrowser(t, srv).login("owner")
	manager := newBrowser(t, srv).login("manager")

	// the owner creates a drawer: 201, ETag, the repeat of the key replays the answer
	name := "Касса стенда " + uuid.NewString()[:8]
	body := map[string]any{"name": name, "kind": "cash_drawer", "currency": "RUB", "orgUnitId": unit, "shiftMode": "none", "kktMode": "none"}
	key := "w531-" + uuid.NewString()
	status, h, drawer := owner.fleetCall(http.MethodPost, base+"/accounts", key, "", body)
	if status != http.StatusCreated || h.Get("ETag") != `"rev-1"` || h.Get("Idempotency-Replayed") != "false" || drawer["name"] != name {
		t.Fatalf("createCashAccount: %d %v %v", status, h, drawer)
	}
	if status, h, again := owner.fleetCall(http.MethodPost, base+"/accounts", key, "", body); status != http.StatusCreated ||
		h.Get("Idempotency-Replayed") != "true" || again["id"] != drawer["id"] {
		t.Fatalf("replay of createCashAccount: %d %v %v", status, h, again)
	}
	if status, _, p := owner.fleetCall(http.MethodPost, base+"/accounts", "", "", body); status != http.StatusBadRequest {
		t.Fatalf("a command without Idempotency-Key: %d %v", status, p)
	}
	id, _ := drawer["id"].(string)

	// a manager without a role of the cash is refused by the gateway
	if status, _, p := manager.fleetCall(http.MethodGet, base+"/accounts", "", "", nil); status != http.StatusForbidden || p["code"] != "forbidden_action" {
		t.Fatalf("listCashAccounts without a role: %d %v", status, p)
	}
	cashierOf(t, db, "m.kotova@alta.example", id)
	status, _, list := manager.fleetCall(http.MethodGet, base+"/accounts", "", "", nil)
	items := asSlice(list["items"])
	if status != http.StatusOK || len(items) != 1 {
		t.Fatalf("listCashAccounts by the cashier: %d %v", status, list)
	}
	if mine, _ := items[0].(map[string]any); mine["id"] != id || mine["balance"] != nil {
		t.Fatalf("the cashier sees the account without the balance: %v", mine)
	}

	// the owner enters the opening balance, the cashier takes a payment, reverses nothing of his own
	opening := map[string]any{"accountId": id, "type": "opening", "direction": "in", "category": "opening_balance", "basis": "Начальный остаток",
		"amount": map[string]any{"amountMinor": 500000, "currency": "RUB"}, "occurredAt": "2026-10-01T10:00:00Z"}
	if status, _, op := owner.fleetCall(http.MethodPost, base+"/operations", "w531-"+uuid.NewString(), "", opening); status != http.StatusCreated || op["type"] != "opening" {
		t.Fatalf("opening balance: %d %v", status, op)
	}
	payment := map[string]any{"accountId": id, "direction": "in", "category": "service_payment", "basis": "Абонемент № 215",
		"amount": map[string]any{"amountMinor": 150000, "currency": "RUB"}, "occurredAt": "2026-10-01T10:05:00Z"}
	status, _, op := manager.fleetCall(http.MethodPost, base+"/operations", "w531-"+uuid.NewString(), "", payment)
	if status != http.StatusCreated || op["type"] != "in" || op["method"] != "cash" {
		t.Fatalf("payment by the cashier: %d %v", status, op)
	}
	opID, _ := op["id"].(string)
	if status, _, p := manager.fleetCall(http.MethodPost, base+"/operations/"+opID+"/reverse", "w531-"+uuid.NewString(), "", map[string]any{"reason": "Ошибка"}); status != http.StatusForbidden {
		t.Fatalf("reverse without cash.reverse: %d %v", status, p)
	}
	status, _, storno := owner.fleetCall(http.MethodPost, base+"/operations/"+opID+"/reverse", "w531-"+uuid.NewString(), "", map[string]any{"reason": "Ошибка ввода"})
	if status != http.StatusCreated || storno["type"] != "storno" || storno["reversesOperationId"] != opID {
		t.Fatalf("reverse by the owner: %d %v", status, storno)
	}
	// the owner reads the journal and the balance: 500 000 after the opening and a payment reversed
	status, _, accounts := owner.fleetCall(http.MethodGet, base+"/accounts?kind=cash_drawer", "", "", nil)
	var balance float64
	for _, a := range asSlice(accounts["items"]) {
		if m, _ := a.(map[string]any); m["id"] == id {
			b, _ := m["balance"].(map[string]any)
			balance, _ = b["amountMinor"].(float64)
		}
	}
	if status != http.StatusOK || balance != 500000 {
		t.Fatalf("balance of the owner: %d %v %v", status, balance, accounts)
	}
	if status, _, cats := owner.fleetCall(http.MethodGet, base+"/categories", "", "", nil); status != http.StatusOK || len(asSlice(cats["items"])) != 14 {
		t.Fatalf("listCashCategories: %d %v", status, cats)
	}
}

// cashStand switches the cash module on in «Альта» (left as it was when already on), removes the rows of the test afterwards
// and returns the home unit of the owner.
func cashStand(t *testing.T, db *sql.DB) string {
	t.Helper()
	res, err := db.ExecContext(t.Context(), `insert into modules.installations (module_key, state, manifest_version, updated_by)
		select 'cash', 'enabled', '0.1', id from people.person_profiles where email = 'd.zimina@alta.example'
		on conflict (module_key) do nothing`)
	if err != nil {
		t.Fatal(err)
	}
	installed, _ := res.RowsAffected() // 0: switched on before the test, left as it was
	t.Cleanup(func() {
		ctx := context.WithoutCancel(t.Context())
		for _, q := range []string{
			`delete from access.role_assignments where role_id in (select id from access.roles where name like 'Кассир стенда %')`,
			`delete from access.role_versions where role_id in (select id from access.roles where name like 'Кассир стенда %')`,
			`delete from access.roles where name like 'Кассир стенда %'`,
			`update access.policy_state set policy_version = policy_version + 1`,
		} {
			if _, err := db.ExecContext(ctx, q); err != nil {
				t.Errorf("%s: %v", q, err)
			}
		}
		if installed > 0 {
			if _, err := db.ExecContext(ctx, `delete from modules.installations where module_key = 'cash'`); err != nil {
				t.Errorf("cash: %v", err)
			}
		}
	})
	var unit string
	if err := db.QueryRowContext(t.Context(), `select home_unit_id::text from people.person_profiles where email = 'd.zimina@alta.example'`).Scan(&unit); err != nil {
		t.Fatal(err)
	}
	return unit
}

// cashierOf gives the person with the email a role «cashier» over one account.
func cashierOf(t *testing.T, db *sql.DB, email, account string) {
	t.Helper()
	role := uuid.New()
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{`insert into access.roles (id, name, kind) values ($1, $2, 'custom')`, []any{role, "Кассир стенда " + role.String()[:8]}},
		{`insert into access.role_versions (role_id, version, actions, created_by)
		  select $1, 1, array['cash.read', 'cash.post', 'cash.proposals.post', 'cash.shift.operate'], id from people.person_profiles where email = 'd.zimina@alta.example'`, []any{role}},
		{`insert into access.role_assignments (principal_kind, principal_id, role_id, role_version, scope_kind, scope_ref, granted_by, valid)
		  select 'person', p.id, $1, 1, 'account', $2::uuid, o.id, tstzrange('2020-01-01', null)
		    from people.person_profiles p, people.person_profiles o where p.email = $3 and o.email = 'd.zimina@alta.example'`, []any{role, account, email}},
		// as a command does: the permission cache of cmd/api reuses a subject while policy_version holds
		{`update access.policy_state set policy_version = policy_version + 1`, nil},
	} {
		if _, err := db.ExecContext(t.Context(), q.sql, q.args...); err != nil {
			t.Fatalf("%s: %v", q.sql, err)
		}
	}
}
