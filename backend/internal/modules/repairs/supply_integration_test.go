//go:build integration

package repairs

import (
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: the clock of the suites
)

// W6.13: the supply over the warehouse. The roles on top of main_integration_test.go: «Снабжение» (a.region-msk over
// Москва: reads objects and holds repairs.supply.manage), «Прораб: заявки» (a.manager-msk1, «своё»: repairs.supply.request).
// A storekeeper is granted a warehouse per test (inventory.movements.read/post in the scope warehouse, a.driver-msk2).
// The warehouse side is written by the superuser: a warehouse, an item named as the price item, a balance.

var (
	supplyOnce sync.Once
	errSupply  error
)

// supplyRoles writes the roles of the supply once for the package.
func supplyRoles(t *testing.T) {
	t.Helper()
	supplyOnce.Do(func() {
		ctx := t.Context()
		for _, r := range []struct {
			id      uuid.UUID
			name    string
			actions []string
			actor   string
			kind    string
		}{
			{uuid.New(), "Снабжение", []string{actRead, actSupply}, "a.region-msk", "unit"},
			{uuid.New(), "Прораб: заявки", []string{actSupplyRequest}, "a.manager-msk1", "self"},
		} {
			if _, errSupply = superA.Exec(ctx, `insert into access.roles (id, name, kind) values ($1, $2, 'custom')`, r.id, r.name); errSupply != nil {
				return
			}
			if _, errSupply = superA.Exec(ctx, `insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`,
				r.id, r.actions, person("a.owner")); errSupply != nil {
				return
			}
			var scope any
			if r.kind == "unit" {
				scope = unit("msk")
			}
			if _, errSupply = superA.Exec(ctx, `insert into access.role_assignments (principal_kind, principal_id, role_id, role_version,
				scope_kind, scope_ref, include_descendants, valid, granted_by) values ('person', $1, $2, 1, $3, $4, true,
				tstzrange($5::timestamptz, null), $6)`, person(r.actor), r.id, r.kind, scope, harness.Now().Add(-time.Hour), person("a.owner")); errSupply != nil {
				return
			}
		}
	})
	if errSupply != nil {
		t.Fatal(errSupply)
	}
}

func sfx() string { return uuid.NewString()[:8] }

// warehouseAt writes a warehouse of the unit.
func warehouseAt(t *testing.T, unitKey string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := superA.Exec(t.Context(), `insert into inventory.warehouses (id, org_unit_id, name) values ($1, $2, $3)`, id, unit(unitKey), "Склад "+sfx()); err != nil {
		t.Fatal(err)
	}
	return id
}

// shelf writes an item of the warehouse named name (the link with the price item) with onHand on the balance.
func shelf(t *testing.T, wh uuid.UUID, name, onHand string) uuid.UUID {
	t.Helper()
	item := uuid.New()
	if _, err := superA.Exec(t.Context(), `insert into inventory.items (id, org_unit_id, name, sku, base_unit) values ($1, $2, $3, $4, 'piece')`,
		item, unit("msk1"), name, "SKU-"+sfx()); err != nil {
		t.Fatal(err)
	}
	if onHand != "0" {
		if _, err := superA.Exec(t.Context(), `insert into inventory.balances (warehouse_id, item_id, on_hand) values ($1, $2, $3)`, wh, item, onHand); err != nil {
			t.Fatal(err)
		}
	}
	return item
}

// grantStore makes member a storekeeper of the warehouse.
func grantStore(t *testing.T, member string, wh uuid.UUID, actions ...string) {
	t.Helper()
	role := uuid.New()
	by := person("a.owner")
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{`insert into access.roles (id, name, kind) values ($1, $2, 'custom')`, []any{role, "Кладовщик " + sfx()}},
		{`insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`, []any{role, actions, by}},
		{`insert into access.role_assignments (principal_kind, principal_id, role_id, role_version, scope_kind, scope_ref,
			include_descendants, valid, granted_by) values ('person', $1, $2, 1, 'warehouse', $3, false, tstzrange('2026-01-01 00:00Z', null), $4)`,
			[]any{person(member), role, wh, by}},
	} {
		if _, err := superA.Exec(t.Context(), q.sql, q.args...); err != nil {
			t.Fatal(err)
		}
	}
}

var storekeeper = []string{"inventory.movements.read", "inventory.movements.post"}

// balanceOf is the balance of the item in the warehouse in thousandths: on hand and reserved.
func balanceOf(t *testing.T, wh, item uuid.UUID) (onHand, reserved int64) {
	t.Helper()
	if err := superA.QueryRow(t.Context(), `select coalesce(sum(on_hand * 1000), 0)::bigint, coalesce(sum(reserved * 1000), 0)::bigint
		from inventory.balances where warehouse_id = $1 and item_id = $2`, wh, item).Scan(&onHand, &reserved); err != nil {
		t.Fatal(err)
	}
	return onHand, reserved
}

// stockOf is the stock of the object in thousandths and its cost in kopecks.
func stockOf(t *testing.T, project, priceItem uuid.UUID) (qty, cost int64) {
	t.Helper()
	if err := superA.QueryRow(t.Context(), `select coalesce(sum(quantity * 1000), 0)::bigint, coalesce(sum(cost_minor), 0)::bigint
		from repairs.project_stock where project_id = $1 and price_item_id = $2`, project, priceItem).Scan(&qty, &cost); err != nil {
		t.Fatal(err)
	}
	return qty, cost
}

func putStock(t *testing.T, project, priceItem uuid.UUID, qty string, cost int64) {
	t.Helper()
	if _, err := superA.Exec(t.Context(), `insert into repairs.project_stock (project_id, price_item_id, quantity, cost_minor) values ($1, $2, $3, $4)
		on conflict (project_id, price_item_id) do update set quantity = excluded.quantity, cost_minor = excluded.cost_minor`, project, priceItem, qty, cost); err != nil {
		t.Fatal(err)
	}
}

// needBy is the day of the clock of the suites plus days.
func needBy(days int) time.Time { return harness.Now().AddDate(0, 0, days).Truncate(24 * time.Hour) }

func ask(priceItem uuid.UUID, qty string, days int) rapi.SupplyRequestCreate {
	b := rapi.SupplyRequestCreate{PriceItemId: priceItem, Quantity: qty}
	b.NeedBy.Time = needBy(days)
	return b
}

// shop is an object of the foreman a.manager-msk1 and a material of the price list (25000 kopecks) with its name.
type shop struct {
	project uuid.UUID
	item    uuid.UUID
	name    string
}

func newShop(t *testing.T, label string) shop {
	t.Helper()
	supplyRoles(t)
	me := person("a.manager-msk1")
	name := "Плитка " + sfx()
	return shop{project: project(t, "Снабжение/"+label, seedOpts{foreman: &me}), item: material(t, name), name: name}
}

func (p shop) ask(t *testing.T, qty string) rapi.SupplyRequest {
	t.Helper()
	return must(service().CreateSupplyRequest(t.Context(), as(t, "a.manager-msk1"), p.project, ask(p.item, qty, 7))).of(t)
}

func money(m *rapi.Money) int {
	if m == nil {
		return -1
	}
	return m.AmountMinor
}

func TestCreateSupplyRequest(t *testing.T) { //nolint:gocyclo // one operation: the answer, the feed, the outbox and the numbers
	t.Parallel()
	ctx, s := t.Context(), service()
	p := newShop(t, "заявка")
	foreman := as(t, "a.manager-msk1")

	r := must(s.CreateSupplyRequest(ctx, foreman, p.project, ask(p.item, "12.5", 7))).of(t)
	if r.State != "request" || r.Revision != 1 || len(r.Number) < 3 || r.Number[:len("З-")] != "З-" || r.ProjectId != p.project ||
		r.PriceItemId != p.item || r.Name != p.name || r.Unit != rapi.RepairUnit("piece") || r.Quantity != "12.5" || r.WarehouseId != nil || r.Cost != nil {
		t.Fatalf("created: %+v", r)
	}
	if r.ProjectName != "Снабжение/заявка" {
		t.Fatalf("project name %q", r.ProjectName)
	}
	if n := count(t, `select count(*) from repairs.project_events where project_id = $1 and kind = 'supply.requested'`, p.project); n != 1 {
		t.Fatalf("feed rows %d", n)
	}
	if n := count(t, `select count(*) from outbox.events where type = 'repairs.supply_request.created.v1' and aggregate_id = $1`, r.Id); n != 1 {
		t.Fatalf("events %d", n)
	}
	// numbers go on
	if r2 := p.ask(t, "1"); r2.Number == r.Number {
		t.Fatalf("the same number %s", r.Number)
	}
}

func TestCreateSupplyRequestRefusals(t *testing.T) {
	t.Parallel()
	ctx, s := t.Context(), service()
	p := newShop(t, "заявка/отказы")
	foreman := as(t, "a.manager-msk1")

	for _, q := range []string{"0", "-1", "1.5.5", "abc", "1.2345", ""} {
		_, err := s.CreateSupplyRequest(ctx, foreman, p.project, ask(p.item, q, 7))
		wantField(t, err, "quantity", "")
	}
	_, err := s.CreateSupplyRequest(ctx, foreman, p.project, ask(p.item, "1", -3))
	wantField(t, err, "needBy", "")
	_, err = s.CreateSupplyRequest(ctx, foreman, p.project, ask(uuid.New(), "1", 7))
	wantField(t, err, "priceItemId", "")
	work := uuid.New()
	if _, e := superA.Exec(ctx, `insert into repairs.price_items (id, section, name, unit, kind, price_minor) values ($1, 'Работы', $2, 'm2', 'work', 100)`, work, "Работа "+sfx()); e != nil {
		t.Fatal(e)
	}
	_, err = s.CreateSupplyRequest(ctx, foreman, p.project, ask(work, "1", 7))
	wantField(t, err, "priceItemId", "")

	// no right: the office without repairs.supply.request; the foreman of another object (as a missing one); a missing object
	_, err = s.CreateSupplyRequest(ctx, as(t, "ab.member"), p.project, ask(p.item, "1", 7))
	wantCode(t, err, "forbidden_action", "")
	stranger := project(t, "Снабжение/чужой", seedOpts{foreman: new(person("a.driver-msk1"))})
	_, err = s.CreateSupplyRequest(ctx, foreman, stranger, ask(p.item, "1", 7))
	wantCode(t, err, "not_found", "")
	_, err = s.CreateSupplyRequest(ctx, foreman, uuid.New(), ask(p.item, "1", 7))
	wantCode(t, err, "not_found", "")

	// a handed over object takes no requests
	me := person("a.manager-msk1")
	done := project(t, "Снабжение/сдан", seedOpts{foreman: &me, status: "handed_over"})
	_, err = s.CreateSupplyRequest(ctx, foreman, done, ask(p.item, "1", 7))
	wantReason(t, err, reasonHandedOver)
	if n := count(t, `select count(*) from repairs.supply_requests where project_id = any($1)`, []uuid.UUID{p.project, stranger, done}); n != 0 {
		t.Fatalf("refused requests were written: %d", n)
	}
}

func TestSupplyFromWarehouse(t *testing.T) { //nolint:gocyclo // one scenario of three operations over the warehouse
	t.Parallel()
	ctx, s := t.Context(), service()
	p := newShop(t, "со склада")
	office, foreman, keeper := as(t, "a.region-msk"), as(t, "a.manager-msk1"), as(t, "a.driver-msk2")
	wh := warehouseAt(t, "msk1")
	item := shelf(t, wh, p.name, "10")
	grantStore(t, "a.driver-msk2", wh, storekeeper...)

	r := p.ask(t, "4")
	r1 := must(s.ReserveSupply(ctx, office, r.Id, rev(r.Revision), wh)).of(t)
	if r1.State != "reserved" || r1.WarehouseId == nil || *r1.WarehouseId != wh || r1.Revision != 2 {
		t.Fatalf("reserved: %+v", r1)
	}
	if on, held := balanceOf(t, wh, item); on != 10000 || held != 4000 {
		t.Fatalf("after the reserve on hand %d, reserved %d", on, held)
	}
	if n := count(t, `select count(*) from outbox.events where aggregate_id = $1 and type = 'repairs.supply_request.reserved.v1'`, r.Id); n != 1 {
		t.Fatalf("reserved events %d", n)
	}
	if n := count(t, `select count(*) from repairs.supply_requests where id = $1 and cost_minor is null`, r.Id); n != 1 {
		t.Fatalf("cost before the issue")
	}
	if n := count(t, `select count(*) from inventory.reservations where source_module = 'repairs' and source_type = 'supply_request' and source_id = $1 and status = 'active'`, r.Id); n != 1 {
		t.Fatalf("reservations %d", n)
	}

	r2 := must(s.IssueSupply(ctx, keeper, r.Id, rev(r1.Revision))).of(t)
	if r2.State != "issued" || r2.Revision != 3 || r2.Cost != nil {
		t.Fatalf("issued: %+v", r2)
	}
	if on, held := balanceOf(t, wh, item); on != 6000 || held != 0 {
		t.Fatalf("after the issue on hand %d, reserved %d", on, held)
	}
	if n := count(t, `select count(*) from inventory.movements where kind = 'issue' and warehouse_id = $1 and source_module = 'repairs' and source_type = 'supply_request' and source_id = $2`, wh, r.Id); n != 1 {
		t.Fatalf("movements %d", n)
	}
	if n := count(t, `select count(*) from inventory.reservations where source_id = $1 and status = 'consumed'`, r.Id); n != 1 {
		t.Fatalf("consumed reservations %d", n)
	}
	// the cost is the supply's: the storekeeper (no supply.manage) does not get it, the office does
	if n := count(t, `select count(*) from repairs.supply_requests where id = $1 and cost_minor = 100000`, r.Id); n != 1 {
		t.Fatalf("cost is not kept for the supply")
	}
	if seen := must(s.SupplyRequests(ctx, office, SupplyQuery{Project: &p.project})).of(t); len(seen.Items) != 1 || money(seen.Items[0].Cost) != 100000 {
		t.Fatalf("the office does not see the cost")
	}
	if qty, cost := stockOf(t, p.project, p.item); qty != 4000 || cost != 100000 {
		t.Fatalf("stock of the object %d / %d", qty, cost)
	}

	r3 := must(s.ConsumeSupply(ctx, foreman, r.Id, rev(r2.Revision))).of(t)
	if r3.State != "used" || r3.Revision != 4 || r3.Cost != nil {
		t.Fatalf("used: %+v", r3)
	}
	if qty, cost := stockOf(t, p.project, p.item); qty != 0 || cost != 0 {
		t.Fatalf("stock after the write-off %d / %d", qty, cost)
	}
	if n := count(t, `select count(*) from outbox.events where aggregate_id = $1 and type in ('repairs.supply_request.issued.v1', 'repairs.supply_request.consumed.v1')`, r.Id); n != 2 {
		t.Fatalf("events %d", n)
	}
}

func TestReserveRefusals(t *testing.T) {
	t.Parallel()
	ctx, s := t.Context(), service()
	p := newShop(t, "резерв/отказы")
	office, foreman := as(t, "a.region-msk"), as(t, "a.manager-msk1")
	wh, empty := warehouseAt(t, "msk1"), warehouseAt(t, "msk1")
	item := shelf(t, wh, p.name, "3")
	r := p.ask(t, "4")

	_, err := s.ReserveSupply(ctx, office, r.Id, rev(r.Revision), wh)
	wantReason(t, err, reasonStock) // 3 free, 4 asked
	_, err = s.ReserveSupply(ctx, office, r.Id, rev(r.Revision), empty)
	wantReason(t, err, reasonStock) // no item on that warehouse
	_, err = s.ReserveSupply(ctx, office, r.Id, rev(r.Revision), uuid.New())
	wantField(t, err, "warehouseId", "")
	_, err = s.ReserveSupply(ctx, foreman, r.Id, rev(r.Revision), wh)
	wantCode(t, err, "forbidden_action", "")
	_, err = s.ReserveSupply(ctx, as(t, "ab.member"), r.Id, rev(r.Revision), wh)
	wantCode(t, err, "forbidden_action", "")
	_, err = s.ReserveSupply(ctx, office, uuid.New(), rev(1), wh)
	wantCode(t, err, "not_found", "")
	_, err = s.ReserveSupply(ctx, office, r.Id, rev(7), wh)
	wantCode(t, err, "revision_mismatch", "")
	if on, held := balanceOf(t, wh, item); on != 3000 || held != 0 {
		t.Fatalf("a refused reserve moved the balance: %d / %d", on, held)
	}
	if n := count(t, `select count(*) from repairs.supply_requests where id = $1 and state = 'request' and revision = 1 and warehouse_id is null`, r.Id); n != 1 {
		t.Fatalf("a refused reserve changed the request")
	}

	// enough now; a second reserve of the same request is a wrong state; free stock counts what is reserved already
	if _, err := superA.Exec(ctx, `update inventory.balances set on_hand = 5 where warehouse_id = $1 and item_id = $2`, wh, item); err != nil {
		t.Fatal(err)
	}
	r1 := must(s.ReserveSupply(ctx, office, r.Id, rev(r.Revision), wh)).of(t)
	_, err = s.ReserveSupply(ctx, office, r.Id, rev(r1.Revision), wh)
	wantReason(t, err, reasonSupplyState)
	again := p.ask(t, "2")
	_, err = s.ReserveSupply(ctx, office, again.Id, rev(again.Revision), wh)
	wantReason(t, err, reasonStock) // 5 on hand, 4 reserved: 1 free
}

func TestIssueAndConsumeRefusals(t *testing.T) {
	t.Parallel()
	ctx, s := t.Context(), service()
	p := newShop(t, "выдача/отказы")
	office, foreman, keeper := as(t, "a.region-msk"), as(t, "a.manager-msk1"), as(t, "a.driver-msk2")
	wh := warehouseAt(t, "msk1")
	shelf(t, wh, p.name, "10")
	grantStore(t, "a.driver-msk2", wh, storekeeper...)
	r := p.ask(t, "2")

	// the wrong state: nothing is reserved yet, nothing is issued yet
	_, err := s.IssueSupply(ctx, keeper, r.Id, rev(r.Revision))
	wantReason(t, err, reasonSupplyState)
	_, err = s.ConsumeSupply(ctx, foreman, r.Id, rev(r.Revision))
	wantReason(t, err, reasonSupplyState)
	r1 := must(s.ReserveSupply(ctx, office, r.Id, rev(r.Revision), wh)).of(t)
	_, err = s.ConsumeSupply(ctx, foreman, r.Id, rev(r1.Revision))
	wantReason(t, err, reasonSupplyState)

	// who issues: a storekeeper of the warehouse; the office and a stranger do not
	_, err = s.IssueSupply(ctx, office, r.Id, rev(r1.Revision))
	wantCode(t, err, "not_found", "") // the office holds no right over the warehouse, even to read it
	_, err = s.IssueSupply(ctx, as(t, "a.driver-msk1"), r.Id, rev(r1.Revision))
	wantCode(t, err, "not_found", "")
	_, err = s.IssueSupply(ctx, keeper, uuid.New(), rev(1))
	wantCode(t, err, "not_found", "")
	_, err = s.IssueSupply(ctx, keeper, r.Id, rev(9))
	wantCode(t, err, "revision_mismatch", "")
	if on, held := balanceOf(t, wh, shelfOf(t, wh, p.name)); on != 10000 || held != 2000 {
		t.Fatalf("a refused issue moved the balance: %d / %d", on, held)
	}
	r2 := must(s.IssueSupply(ctx, keeper, r.Id, rev(r1.Revision))).of(t)
	_, err = s.IssueSupply(ctx, keeper, r.Id, rev(r2.Revision))
	wantReason(t, err, reasonSupplyState)

	// who writes off: the foreman of the object (supply.request) or the reviewer; the office without the right does not
	_, err = s.ConsumeSupply(ctx, as(t, "a.manager-msk2"), r.Id, rev(r2.Revision))
	wantCode(t, err, "not_found", "")                                         // reads objects of Москва-2 only
	_, err = s.ConsumeSupply(ctx, as(t, "ab.member"), r.Id, rev(r2.Revision)) // desk: work_logs.review — allowed
	if err != nil {
		t.Fatalf("the reviewer writes off: %v", err)
	}
	_, err = s.ConsumeSupply(ctx, foreman, r.Id, rev(r2.Revision+1))
	wantReason(t, err, reasonSupplyState)
}

// shelfOf is the inventory item named name that the shelf made.
func shelfOf(t *testing.T, wh uuid.UUID, name string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := superA.QueryRow(t.Context(), `select i.id from inventory.items i join inventory.balances b on b.item_id = i.id where i.name = $1 and b.warehouse_id = $2`, name, wh).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestSupplyList(t *testing.T) { //nolint:gocyclo // one operation: filters, rights and the price
	t.Parallel()
	ctx, s := t.Context(), service()
	p := newShop(t, "список")
	office, foreman, keeper := as(t, "a.region-msk"), as(t, "a.manager-msk1"), as(t, "a.driver-msk2")
	wh := warehouseAt(t, "msk1")
	shelf(t, wh, p.name, "10")
	grantStore(t, "a.driver-msk2", wh, storekeeper...)
	other := project(t, "Снабжение/список/чужой", seedOpts{foreman: new(person("a.driver-msk1"))})

	a, b := p.ask(t, "1"), p.ask(t, "2")
	if _, err := superA.Exec(ctx, `insert into repairs.supply_requests (number, project_id, price_item_id, quantity, need_by, created_by) values ('З-x'||$3, $1, $2, 5, '2026-10-30', $4)`,
		other, p.item, sfx(), person("a.owner")); err != nil {
		t.Fatal(err)
	}
	r := must(s.ReserveSupply(ctx, office, b.Id, rev(b.Revision), wh)).of(t)
	must(s.IssueSupply(ctx, keeper, b.Id, rev(r.Revision))).of(t)

	mine := &p.project
	page := must(s.SupplyRequests(ctx, foreman, SupplyQuery{Project: mine})).of(t)
	if len(page.Items) != 2 || page.NextCursor != nil {
		t.Fatalf("foreman, own object: %+v", page.Items)
	}
	for _, it := range page.Items {
		if it.Cost != nil || it.Available != nil {
			t.Fatalf("the foreman reads prices or free stock: %+v", it)
		}
	}
	// the foreman asking for the object of another is not told about it
	page = must(s.SupplyRequests(ctx, foreman, SupplyQuery{Project: &other})).of(t)
	if len(page.Items) != 0 {
		t.Fatalf("foreman, another object: %+v", page.Items)
	}
	page = must(s.SupplyRequests(ctx, office, SupplyQuery{Project: mine})).of(t)
	byID := map[uuid.UUID]rapi.SupplyRequest{}
	for _, it := range page.Items {
		byID[it.Id] = it
	}
	if len(page.Items) != 2 || money(byID[b.Id].Cost) != 50000 || byID[b.Id].State != "issued" || byID[a.Id].Cost != nil {
		t.Fatalf("office: %+v", page.Items)
	}
	if av := byID[a.Id].Available; av == nil || len(*av) != 1 || (*av)[0].WarehouseId != wh || (*av)[0].Free != "8" {
		t.Fatalf("free stock of the request waiting for a decision: %+v", byID[a.Id].Available)
	}
	if byID[b.Id].Available != nil {
		t.Fatalf("a decided request names free stock: %+v", byID[b.Id])
	}

	st := "request"
	page = must(s.SupplyRequests(ctx, office, SupplyQuery{Project: mine, State: &st})).of(t)
	if len(page.Items) != 1 || page.Items[0].Id != a.Id {
		t.Fatalf("state filter: %+v", page.Items)
	}
	bad := "done"
	_, err := s.SupplyRequests(ctx, office, SupplyQuery{State: &bad})
	wantCode(t, err, "malformed_request", "")

	// paging
	one := 1
	first := must(s.SupplyRequests(ctx, office, SupplyQuery{Project: mine, Limit: &one})).of(t)
	if len(first.Items) != 1 || first.NextCursor == nil {
		t.Fatalf("first page: %+v", first)
	}
	second := must(s.SupplyRequests(ctx, office, SupplyQuery{Project: mine, Limit: &one, Cursor: first.NextCursor})).of(t)
	if len(second.Items) != 1 || second.NextCursor != nil || second.Items[0].Id == first.Items[0].Id {
		t.Fatalf("second page: %+v", second)
	}

	// no right at all
	_, err = s.SupplyRequests(ctx, as(t, "a.manager-msk2"), SupplyQuery{})
	wantCode(t, err, "forbidden_action", "")
}

func TestPurchase(t *testing.T) { //nolint:gocyclo // one scenario: order, list, receive, repeat
	t.Parallel()
	ctx, s := t.Context(), service()
	office, foreman := as(t, "a.region-msk"), as(t, "a.manager-msk1")
	one, two := newShop(t, "закупка/1"), newShop(t, "закупка/2")
	tile := one.item // one material for both objects
	two.item = tile
	r1, r2 := one.ask(t, "10"), two.ask(t, "6")

	pu := must(s.CreatePurchase(ctx, office, rapi.PurchaseCreate{Supplier: " ООО «Керамика» ", Lines: []rapi.PurchaseLineInput{
		{SupplyRequestId: r1.Id, Price: &rapi.Money{AmountMinor: 30000, Currency: "RUB"}},
		{SupplyRequestId: r2.Id}, // the default: no purchase yet, the price of the catalog
	}})).of(t)
	if pu.State != "ordered" || pu.Revision != 1 || pu.Supplier != "ООО «Керамика»" || len(pu.Lines) != 2 || pu.Total.AmountMinor != 10*30000+6*25000 || pu.Total.Currency != "RUB" ||
		pu.ReceivedAt != nil || pu.ReceiptQr != nil {
		t.Fatalf("ordered: %+v", pu)
	}
	for _, l := range pu.Lines {
		switch l.SupplyRequestId {
		case r1.Id:
			if l.ProjectId != one.project || l.Quantity != "10" || l.Price.AmountMinor != 30000 || l.PriceItemId != tile {
				t.Fatalf("line 1: %+v", l)
			}
		case r2.Id:
			if l.ProjectId != two.project || l.Quantity != "6" || l.Price.AmountMinor != 25000 {
				t.Fatalf("line 2: %+v", l)
			}
		default:
			t.Fatalf("line of nothing: %+v", l)
		}
	}
	if n := count(t, `select count(*) from repairs.supply_requests where id = any($1) and state = 'ordered' and purchase_id = $2 and revision = 2`, []uuid.UUID{r1.Id, r2.Id}, pu.Id); n != 2 {
		t.Fatalf("ordered requests %d", n)
	}
	list := must(s.Purchases(ctx, office, nil, nil)).of(t)
	if i := indexOfPurchase(list.Items, pu.Id); i < 0 {
		t.Fatalf("the purchase is not in the list: %+v", list)
	}
	if _, err := s.Purchases(ctx, foreman, nil, nil); err == nil {
		t.Fatal("a foreman lists purchases")
	}

	// the purchase takes the requests of the state request only
	_, err := s.CreatePurchase(ctx, office, rapi.PurchaseCreate{Supplier: "X", Lines: []rapi.PurchaseLineInput{{SupplyRequestId: r1.Id}}})
	wantReason(t, err, reasonSupplyState)

	_, err = s.ReceivePurchase(ctx, office, pu.Id, rev(5), "QR-1")
	wantCode(t, err, "revision_mismatch", "")
	_, err = s.ReceivePurchase(ctx, office, pu.Id, rev(pu.Revision), "  ")
	wantField(t, err, "receiptQr", "")
	_, err = s.ReceivePurchase(ctx, foreman, pu.Id, rev(pu.Revision), "QR-1")
	wantCode(t, err, "forbidden_action", "")
	_, err = s.ReceivePurchase(ctx, office, uuid.New(), rev(1), "QR-1")
	wantCode(t, err, "not_found", "")
	got := must(s.ReceivePurchase(ctx, office, pu.Id, rev(pu.Revision), " QR-2026-1 ")).of(t)
	if got.State != "received" || got.Revision != 2 || got.ReceiptQr == nil || *got.ReceiptQr != "QR-2026-1" || got.ReceivedAt == nil {
		t.Fatalf("received: %+v", got)
	}
	if qty, cost := stockOf(t, one.project, tile); qty != 10000 || cost != 300000 {
		t.Fatalf("stock of object 1: %d / %d", qty, cost)
	}
	if qty, cost := stockOf(t, two.project, tile); qty != 6000 || cost != 150000 {
		t.Fatalf("stock of object 2: %d / %d", qty, cost)
	}
	if n := count(t, `select count(*) from repairs.supply_requests where id = any($1) and state = 'bought' and cost_minor is not null`, []uuid.UUID{r1.Id, r2.Id}); n != 2 {
		t.Fatalf("bought requests %d", n)
	}
	_, err = s.ReceivePurchase(ctx, office, pu.Id, rev(got.Revision), "QR-2026-1")
	wantReason(t, err, reasonPurchaseState)

	// the next purchase of the material is priced by the last one (the default of Q-W6.13-1)
	r3 := one.ask(t, "1")
	next := must(s.CreatePurchase(ctx, office, rapi.PurchaseCreate{Supplier: "Другой", Lines: []rapi.PurchaseLineInput{{SupplyRequestId: r3.Id}}})).of(t)
	if next.Lines[0].Price.AmountMinor != 30000 {
		t.Fatalf("default price after a received purchase: %+v", next.Lines[0])
	}

	// the bought material is written off to the object
	used := must(s.ConsumeSupply(ctx, foreman, r1.Id, rev(3))).of(t)
	if used.State != "used" || used.Cost != nil {
		t.Fatalf("used: %+v", used)
	}
	if qty, cost := stockOf(t, one.project, tile); qty != 0 || cost != 0 {
		t.Fatalf("stock of object 1 after the write-off: %d / %d", qty, cost)
	}
}

func indexOfPurchase(items []rapi.Purchase, id uuid.UUID) int {
	for i, it := range items {
		if it.Id == id {
			return i
		}
	}
	return -1
}

func TestPurchaseRefusals(t *testing.T) {
	t.Parallel()
	ctx, s := t.Context(), service()
	office, foreman := as(t, "a.region-msk"), as(t, "a.manager-msk1")
	p := newShop(t, "закупка/отказы")
	r := p.ask(t, "3")
	line := rapi.PurchaseLineInput{SupplyRequestId: r.Id}

	_, err := s.CreatePurchase(ctx, office, rapi.PurchaseCreate{Supplier: "  ", Lines: []rapi.PurchaseLineInput{line}})
	wantField(t, err, "supplier", "")
	_, err = s.CreatePurchase(ctx, office, rapi.PurchaseCreate{Supplier: "X"})
	wantField(t, err, "lines", "")
	_, err = s.CreatePurchase(ctx, office, rapi.PurchaseCreate{Supplier: "X", Lines: []rapi.PurchaseLineInput{line, line}})
	wantField(t, err, "lines[1].supplyRequestId", "")
	_, err = s.CreatePurchase(ctx, office, rapi.PurchaseCreate{Supplier: "X", Lines: []rapi.PurchaseLineInput{{SupplyRequestId: uuid.New()}}})
	wantField(t, err, "lines[0].supplyRequestId", "")
	_, err = s.CreatePurchase(ctx, office, rapi.PurchaseCreate{Supplier: "X", Lines: []rapi.PurchaseLineInput{{SupplyRequestId: r.Id, Price: &rapi.Money{AmountMinor: -1, Currency: "RUB"}}}})
	wantField(t, err, "lines[0].price", "")
	_, err = s.CreatePurchase(ctx, office, rapi.PurchaseCreate{Supplier: "X", Lines: []rapi.PurchaseLineInput{{SupplyRequestId: r.Id, Price: &rapi.Money{AmountMinor: 100, Currency: "USD"}}}})
	wantField(t, err, "lines[0].price", "")
	_, err = s.CreatePurchase(ctx, foreman, rapi.PurchaseCreate{Supplier: "X", Lines: []rapi.PurchaseLineInput{line}})
	wantCode(t, err, "forbidden_action", "")
	_, err = s.CreatePurchase(ctx, as(t, "ab.member"), rapi.PurchaseCreate{Supplier: "X", Lines: []rapi.PurchaseLineInput{line}})
	wantCode(t, err, "forbidden_action", "")
	if n := count(t, `select count(*) from repairs.supply_requests where id = $1 and state = 'request' and purchase_id is null`, r.Id); n != 1 {
		t.Fatal("a refused purchase touched the request")
	}
}

func TestProjectStockList(t *testing.T) {
	t.Parallel()
	ctx, s := t.Context(), service()
	p := newShop(t, "остатки")
	putStock(t, p.project, p.item, "7", 175000)
	empty := newShop(t, "остатки/пусто")
	putStock(t, empty.project, empty.item, "0", 0)

	list := must(s.ProjectStock(ctx, as(t, "a.region-msk"))).of(t)
	var found bool
	for _, it := range list.Items {
		if it.ProjectId == empty.project {
			t.Fatalf("an empty stock is listed: %+v", it)
		}
		if it.ProjectId == p.project && it.PriceItemId == p.item {
			found = true
			if it.Quantity != "7" || it.Cost.AmountMinor != 175000 || it.Name != p.name || it.ProjectName != "Снабжение/остатки" || it.Unit != rapi.RepairUnit("piece") {
				t.Fatalf("stock row: %+v", it)
			}
		}
	}
	if !found {
		t.Fatalf("the stock is not listed: %+v", list.Items)
	}
	_, err := s.ProjectStock(ctx, as(t, "a.manager-msk1"))
	wantCode(t, err, "forbidden_action", "")
}

func TestReturnProjectStock(t *testing.T) {
	t.Parallel()
	ctx, s := t.Context(), service()
	p := newShop(t, "возврат")
	office, keeper := as(t, "a.region-msk"), as(t, "a.driver-msk2")
	wh := warehouseAt(t, "msk1")
	item := shelf(t, wh, p.name, "2")
	grantStore(t, "a.driver-msk2", wh, storekeeper...)
	putStock(t, p.project, p.item, "5", 125000)
	back := func(qty string) rapi.StockReturn {
		return rapi.StockReturn{WarehouseId: wh, Items: []rapi.StockItemInput{{PriceItemId: p.item, Quantity: qty}}}
	}

	// the office holds supply.manage but no right over the warehouse; the storekeeper holds the warehouse but no supply.manage
	_, err := s.ReturnStock(ctx, office, p.project, back("1"))
	wantCode(t, err, "not_found", "")
	_, err = s.ReturnStock(ctx, keeper, p.project, back("1"))
	wantCode(t, err, "not_found", "") // does not read the object
	grantStore(t, "a.region-msk", wh, storekeeper...)

	_, err = s.ReturnStock(ctx, office, p.project, back("6"))
	wantReason(t, err, reasonStock)
	_, err = s.ReturnStock(ctx, office, p.project, back("0"))
	wantField(t, err, "items[0].quantity", "")
	_, err = s.ReturnStock(ctx, office, p.project, rapi.StockReturn{WarehouseId: wh})
	wantField(t, err, "items", "")
	_, err = s.ReturnStock(ctx, office, p.project, rapi.StockReturn{WarehouseId: uuid.New(), Items: back("1").Items})
	wantField(t, err, "warehouseId", "")
	_, err = s.ReturnStock(ctx, office, p.project, rapi.StockReturn{WarehouseId: wh, Items: []rapi.StockItemInput{{PriceItemId: uuid.New(), Quantity: "1"}}})
	wantField(t, err, "items[0].priceItemId", "")
	_, err = s.ReturnStock(ctx, office, uuid.New(), back("1"))
	wantCode(t, err, "not_found", "")
	if qty, _ := stockOf(t, p.project, p.item); qty != 5000 {
		t.Fatalf("a refused return moved the stock: %d", qty)
	}

	res := must(s.ReturnStock(ctx, office, p.project, back("2"))).of(t)
	if len(res.MovementIds) != 1 || len(res.Items) != 1 || res.Items[0].Quantity != "3" || res.Items[0].Cost.AmountMinor != 75000 {
		t.Fatalf("returned: %+v", res)
	}
	if qty, cost := stockOf(t, p.project, p.item); qty != 3000 || cost != 75000 {
		t.Fatalf("stock of the object %d / %d", qty, cost)
	}
	if on, held := balanceOf(t, wh, item); on != 4000 || held != 0 {
		t.Fatalf("balance of the warehouse %d / %d", on, held)
	}
	if n := count(t, `select count(*) from inventory.movements where id = $1 and kind = 'receipt' and warehouse_id = $2 and source_module = 'repairs'`, res.MovementIds[0], wh); n != 1 {
		t.Fatal("no receipt movement")
	}
	if n := count(t, `select count(*) from outbox.events where type = 'repairs.project_stock.returned.v1' and aggregate_id = $1`, p.project); n != 1 {
		t.Fatalf("events %d", n)
	}
}

func TestTransferProjectStock(t *testing.T) { //nolint:gocyclo // one operation: success, requests of the target, every refusal
	t.Parallel()
	ctx, s := t.Context(), service()
	office := as(t, "a.region-msk")
	from, to := newShop(t, "перенос/откуда"), newShop(t, "перенос/куда")
	to.item = from.item
	putStock(t, from.project, from.item, "9", 225000)
	small, big := to.ask(t, "2"), to.ask(t, "5")
	move := func(qty string) rapi.StockTransfer {
		return rapi.StockTransfer{ToProjectId: to.project, Items: []rapi.StockItemInput{{PriceItemId: from.item, Quantity: qty}}}
	}

	_, err := s.TransferStock(ctx, office, from.project, move("10"))
	wantReason(t, err, reasonStock)
	_, err = s.TransferStock(ctx, office, from.project, rapi.StockTransfer{ToProjectId: from.project, Items: move("1").Items})
	wantField(t, err, "toProjectId", "")
	_, err = s.TransferStock(ctx, office, from.project, rapi.StockTransfer{ToProjectId: uuid.New(), Items: move("1").Items})
	wantField(t, err, "toProjectId", "")
	_, err = s.TransferStock(ctx, as(t, "a.manager-msk1"), from.project, move("1"))
	wantCode(t, err, "forbidden_action", "")
	_, err = s.TransferStock(ctx, office, from.project, move("0"))
	wantField(t, err, "items[0].quantity", "")
	if qty, _ := stockOf(t, to.project, to.item); qty != 0 {
		t.Fatalf("a refused transfer moved the stock: %d", qty)
	}

	// 4 moved: the oldest request of 2 is covered and closed, the next one of 5 is reduced by the rest, 2
	res := must(s.TransferStock(ctx, office, from.project, move("4"))).of(t)
	if len(res.MovementIds) != 0 || len(res.Items) != 2 {
		t.Fatalf("transferred: %+v", res)
	}
	if qty, cost := stockOf(t, from.project, from.item); qty != 5000 || cost != 125000 {
		t.Fatalf("source stock %d / %d", qty, cost)
	}
	if qty, cost := stockOf(t, to.project, to.item); qty != 4000 || cost != 100000 {
		t.Fatalf("target stock %d / %d", qty, cost)
	}
	list := must(s.SupplyRequests(ctx, office, SupplyQuery{Project: &to.project})).of(t)
	state := map[uuid.UUID]rapi.SupplyRequest{}
	for _, it := range list.Items {
		state[it.Id] = it
	}
	if state[small.Id].State != "used" || state[big.Id].State != "request" || state[big.Id].Quantity != "3" || state[big.Id].Revision != 2 {
		t.Fatalf("requests of the target: small %+v, big %+v", state[small.Id], state[big.Id])
	}
	if n := count(t, `select count(*) from outbox.events where type = 'repairs.project_stock.transferred.v1' and aggregate_id = $1`, from.project); n != 1 {
		t.Fatalf("events %d", n)
	}
	if n := count(t, `select count(*) from repairs.project_events where project_id = any($1) and kind = 'supply.transferred'`, []uuid.UUID{from.project, to.project}); n != 2 {
		t.Fatalf("feed rows %d", n)
	}
}

// Two reserves of the same warehouse run at once: the balances are locked, so only what is free is held.
func TestConcurrentReserves(t *testing.T) {
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	p := newShop(t, "резерв/гонка")
	wh := warehouseAt(t, "msk1")
	item := shelf(t, wh, p.name, "5")
	a, b := p.ask(t, "4"), p.ask(t, "4")
	errs := make(chan error, 2)
	for _, r := range []rapi.SupplyRequest{a, b} {
		go func() {
			_, err := s.ReserveSupply(ctx, office, r.Id, rev(r.Revision), wh)
			errs <- err
		}()
	}
	var failed int
	for range 2 {
		if err := <-errs; err != nil {
			wantReason(t, err, reasonStock)
			failed++
		}
	}
	if failed != 1 {
		t.Fatalf("%d reserves refused, want 1", failed)
	}
	if on, held := balanceOf(t, wh, item); on != 5000 || held != 4000 {
		t.Fatalf("balance %d / %d, want 5000 / 4000", on, held)
	}
}
