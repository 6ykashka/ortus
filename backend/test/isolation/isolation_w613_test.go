//go:build isolation

package isolation

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures"
)

// W6.13: what the rows of repairs_w600.yaml cannot carry — the commands with If-Match, the bodies that fail validation
// (a row has no 422) and the path of a request over the whole supply through HTTP. The fixtures are those of W6.11
// (content_repairs.go): «Квартира на Лесной» (repair_project:a.flat, a.repairs-foreman) and «Дом на Речной»
// (repair_project:a.other, a.repairs-foreman-two). The foremen of the fixtures hold neither repairs.supply.request nor
// repairs.supply.manage: the gate refuses them every operation of the supply (the rows say so, here also for the commands).
//   - the path: the owner asks for a material on «Лесная», reserves it on a warehouse, the owner (a storekeeper by right)
//     issues it, the object holds the stock, the material is written off; then a purchase for two objects is ordered and
//     received, and the stock of both objects grows by the cost;
//   - a foreign foreman: every command of the supply on that request answers 403 and the request stays as it was;
//   - validation: a body that fails answers 422 with the field, after the access.

// Not parallel: the requests change the lists of the supply that the rows of repairs_w600.yaml read in parallel.
//
//nolint:paralleltest // see above
func TestIsolationRepairsW613(t *testing.T) {
	w, ok := suite.Refs.(*fixtures.World)
	if !ok {
		t.Fatalf("suite refs %T, want the fixtures", suite.Refs)
	}
	s := w613Seed(t, w)
	t.Run("path", func(t *testing.T) { w613Path(t, s) })
	t.Run("foreign foreman", func(t *testing.T) { w613Foreign(t, s) })
	t.Run("validation", func(t *testing.T) { w613Validation(t, s) })
}

// supply is what the DB of tenant A holds for the test: a material of the price list, a warehouse with the item of the
// same name and its stock.
type supply struct {
	material, warehouse uuid.UUID
	name                string
}

func w613Seed(t *testing.T, w *fixtures.World) supply {
	t.Helper()
	db := w.Cluster.DB(t, w.TenantDBs[fixtures.TenantA], migratetest.Super)
	s := supply{material: uuid.New(), warehouse: uuid.New(), name: "Изоляция снабжения " + uuid.NewString()[:8]}
	item := uuid.New()
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{`insert into repairs.price_items (id, section, name, unit, kind, price_minor) values ($1, 'Материалы', $2, 'piece', 'material', 25000)`, []any{s.material, s.name}},
		{`insert into inventory.warehouses (id, org_unit_id, name) values ($1, (select org_unit_id from repairs.projects where id = $2), $3)`,
			[]any{s.warehouse, refID(t, "repair_project:a.flat"), "Склад изоляции " + s.name}},
		{`insert into inventory.items (id, org_unit_id, name, sku, base_unit) values ($1, (select org_unit_id from repairs.projects where id = $2), $3, $4, 'piece')`,
			[]any{item, refID(t, "repair_project:a.flat"), s.name, "ISO-" + s.name}},
		{`insert into inventory.balances (warehouse_id, item_id, on_hand) values ($1, $2, 20)`, []any{s.warehouse, item}},
	} {
		if _, err := db.ExecContext(t.Context(), q.sql, q.args...); err != nil {
			t.Fatalf("%s: %v", q.sql, err)
		}
	}
	return s
}

// supplyOf is the part of a supply request that the test reads.
type supplyOf struct {
	ID       uuid.UUID `json:"id"`
	State    string    `json:"state"`
	Revision int       `json:"revision"`
}

func w613Do(t *testing.T, actor, method, path, body string, want int, hdr map[string]string) (http.Header, string) {
	t.Helper()
	status, h, raw := formsCall(t, actor, method, path, body, hdr)
	if status != want {
		t.Fatalf("%s %s by %s: %d %s, want %d", method, path, actor, status, raw, want)
	}
	return h, raw
}

func w613Ask(t *testing.T, s supply, project, qty string) (supplyOf, http.Header) {
	t.Helper()
	h, raw := w613Do(t, "a.owner", http.MethodPost, repairsA+"projects/{{"+project+"}}/supply-requests",
		`{"priceItemId":"`+s.material.String()+`","quantity":"`+qty+`","needBy":"2999-01-01"}`, http.StatusCreated, nil)
	var r supplyOf
	if err := json.Unmarshal([]byte(raw), &r); err != nil || r.State != "request" {
		t.Fatalf("created request: %s (%v)", raw, err)
	}
	return r, h
}

func w613Path(t *testing.T, s supply) {
	t.Helper()
	req, h := w613Ask(t, s, "repair_project:a.flat", "4")
	one := repairsA + "supply-requests/" + req.ID.String()
	h, raw := w613Do(t, "a.owner", http.MethodPost, one+"/reserve", `{"warehouseId":"`+s.warehouse.String()+`"}`, http.StatusOK, ifMatch(h))
	if !strings.Contains(raw, `"reserved"`) {
		t.Fatalf("reserve: %s", raw)
	}
	h, raw = w613Do(t, "a.owner", http.MethodPost, one+"/issue", "", http.StatusOK, ifMatch(h))
	if !strings.Contains(raw, `"issued"`) || !strings.Contains(raw, `"amountMinor":100000`) {
		t.Fatalf("issue: %s", raw)
	}
	_, raw = w613Do(t, "a.owner", http.MethodGet, repairsA+"project-stock", "", http.StatusOK, nil)
	if !strings.Contains(raw, s.name) {
		t.Fatalf("the stock of the object does not name %q: %s", s.name, raw)
	}
	_, raw = w613Do(t, "a.owner", http.MethodPost, one+"/consume", "", http.StatusOK, ifMatch(h))
	if !strings.Contains(raw, `"used"`) {
		t.Fatalf("consume: %s", raw)
	}

	// a purchase for two objects
	a, _ := w613Ask(t, s, "repair_project:a.flat", "3")
	b, _ := w613Ask(t, s, "repair_project:a.other", "2")
	h, raw = w613Do(t, "a.owner", http.MethodPost, repairsA+"purchases", `{"supplier":"ООО Изоляция","lines":[{"supplyRequestId":"`+a.ID.String()+
		`","price":{"amountMinor":30000,"currency":"RUB"}},{"supplyRequestId":"`+b.ID.String()+`"}]}`, http.StatusCreated, nil)
	var pu struct {
		ID    uuid.UUID `json:"id"`
		Total struct {
			Amount int `json:"amountMinor"`
		} `json:"total"`
	}
	if err := json.Unmarshal([]byte(raw), &pu); err != nil || pu.Total.Amount != 3*30000+2*25000 {
		t.Fatalf("purchase: %s (%v)", raw, err)
	}
	h, raw = w613Do(t, "a.owner", http.MethodPost, repairsA+"purchases/"+pu.ID.String()+"/receive", `{"receiptQr":"QR-ISO-1"}`, http.StatusOK, ifMatch(h))
	if !strings.Contains(raw, `"received"`) {
		t.Fatalf("receive: %s", raw)
	}
	w613Do(t, "a.owner", http.MethodPost, repairsA+"purchases/"+pu.ID.String()+"/receive", `{"receiptQr":"QR-ISO-1"}`, http.StatusConflict, ifMatch(h))
	_, raw = w613Do(t, "a.owner", http.MethodGet, repairsA+"purchases", "", http.StatusOK, nil)
	if !strings.Contains(raw, pu.ID.String()) {
		t.Fatalf("the purchase is not listed: %s", raw)
	}
}

func w613Foreign(t *testing.T, s supply) {
	t.Helper()
	req, h := w613Ask(t, s, "repair_project:a.flat", "1")
	one := repairsA + "supply-requests/" + req.ID.String()
	rev := ifMatch(h)
	for _, c := range []struct{ name, method, path, body string }{
		{"reserve", http.MethodPost, one + "/reserve", `{"warehouseId":"` + s.warehouse.String() + `"}`},
		{"issue", http.MethodPost, one + "/issue", ""},
		{"consume", http.MethodPost, one + "/consume", ""},
		{"create", http.MethodPost, repairsA + "projects/{{repair_project:a.flat}}/supply-requests", `{"priceItemId":"` + s.material.String() + `","quantity":"1","needBy":"2999-01-01"}`},
		{"purchase", http.MethodPost, repairsA + "purchases", `{"supplier":"X","lines":[{"supplyRequestId":"` + req.ID.String() + `"}]}`},
		{"return", http.MethodPost, repairsA + "projects/{{repair_project:a.flat}}/stock/return", `{"warehouseId":"` + s.warehouse.String() + `","items":[{"priceItemId":"` + s.material.String() + `","quantity":"1"}]}`},
		{"stock", http.MethodGet, repairsA + "project-stock", ""},
		{"list", http.MethodGet, repairsA + "supply-requests", ""},
	} {
		status, _, raw := formsCall(t, "a.repairs-foreman-two", c.method, c.path, c.body, rev)
		if status != http.StatusForbidden && status != http.StatusNotFound {
			t.Errorf("%s by a foreign foreman: %d %s, want 403 or 404", c.name, status, raw)
		}
	}
	_, raw := w613Do(t, "a.owner", http.MethodGet, repairsA+"supply-requests?projectId={{repair_project:a.flat}}&state=request", "", http.StatusOK, nil)
	if !strings.Contains(raw, req.ID.String()) {
		t.Errorf("the request is gone after the refused commands: %s", raw)
	}
}

func w613Validation(t *testing.T, s supply) {
	t.Helper()
	zero := uuid.Nil.String()
	for _, c := range []struct{ name, method, path, body, field string }{
		{"material", http.MethodPost, repairsA + "projects/{{repair_project:a.flat}}/supply-requests", `{"priceItemId":"` + zero + `","quantity":"1","needBy":"2999-01-01"}`, "priceItemId"},
		{"quantity", http.MethodPost, repairsA + "projects/{{repair_project:a.flat}}/supply-requests", `{"priceItemId":"` + s.material.String() + `","quantity":"0","needBy":"2999-01-01"}`, "quantity"},
		{"date", http.MethodPost, repairsA + "projects/{{repair_project:a.flat}}/supply-requests", `{"priceItemId":"` + s.material.String() + `","quantity":"1","needBy":"2001-01-01"}`, "needBy"},
		{"purchase line", http.MethodPost, repairsA + "purchases", `{"supplier":"X","lines":[{"supplyRequestId":"` + zero + `"}]}`, "lines[0].supplyRequestId"},
		{"warehouse", http.MethodPost, repairsA + "projects/{{repair_project:a.flat}}/stock/return", `{"warehouseId":"` + zero + `","items":[{"priceItemId":"` + s.material.String() + `","quantity":"1"}]}`, "warehouseId"},
		{"target", http.MethodPost, repairsA + "projects/{{repair_project:a.flat}}/stock/transfer", `{"toProjectId":"` + zero + `","items":[{"priceItemId":"` + s.material.String() + `","quantity":"1"}]}`, "toProjectId"},
	} {
		status, _, raw := formsCall(t, "a.owner", c.method, c.path, c.body, nil)
		if status != http.StatusUnprocessableEntity || !strings.Contains(raw, `"`+c.field+`"`) {
			t.Errorf("%s: %d %s, want 422 on %s", c.name, status, raw, c.field)
		}
	}
}
